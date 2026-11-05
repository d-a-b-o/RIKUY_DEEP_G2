"""Publicación TF.js con gate obligatorio, objetos inmutables y activación al final."""

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from ml.quality_gate import evaluate_quality_gate, require_quality_gate


def publication_json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False).encode("utf-8")


def publication_digest(value):
    return hashlib.sha256(publication_json(value)).hexdigest()


def validate_model_catalog(catalog):
    """Validar el contrato compartido con apps/web/src/lib/model/manifest.ts."""
    if not isinstance(catalog, dict) or catalog.get("schemaVersion") != 1:
        raise ValueError("Manifest remoto con schemaVersion inválido.")
    versions = catalog.get("versions")
    if not isinstance(versions, list) or not versions:
        raise ValueError("El manifest remoto no contiene versiones válidas.")
    seen = set()
    for version in versions:
        if not isinstance(version, dict) or not re.fullmatch(r"\d+\.\d+\.\d+", version.get("version", "")):
            raise ValueError("Versión inválida en manifest.")
        if version["version"] in seen:
            raise ValueError("Versión repetida en manifest.")
        seen.add(version["version"])
        path = version.get("modelPath")
        if (
            not isinstance(path, str)
            or not path.endswith("model.json")
            or path.startswith("/")
            or ".." in path
            or ":" in path
        ):
            raise ValueError("modelPath inválido en manifest.")
        timestamp = datetime.fromisoformat(version["publishedAt"].replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError("publishedAt debe incluir zona horaria.")
        input_spec = version.get("input", {})
        for axis in ("width", "height"):
            if type(input_spec.get(axis)) is not int or input_spec[axis] <= 0:
                raise ValueError("Dimensiones inválidas en manifest.")
        if input_spec.get("channels") != 3:
            raise ValueError("El manifest debe declarar entrada RGB.")
        if (
            not probability_number(input_spec.get("scale"))
            or input_spec["scale"] <= 0
            or not probability_number(input_spec.get("offset"))
        ):
            raise ValueError("Normalización inválida en manifest.")
        output_spec = version.get("output", {})
        if output_spec != {"activation": "sigmoid", "positiveLabel": "DEFECTIVE", "negativeLabel": "OK"}:
            raise ValueError("Etiquetas o activación inválidas en manifest.")
        threshold = version.get("threshold")
        if not probability_number(threshold) or not 0 < threshold < 1:
            raise ValueError("Umbral inválido en manifest.")
        sha = version.get("modelSha256")
        if sha is not None and (not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha)):
            raise ValueError("Hash inválido en manifest.")
    if catalog.get("activeVersion") not in seen:
        raise ValueError("activeVersion no existe en el catálogo.")


def probability_number(value):
    # JSON estricto rechaza NaN/Infinity; también excluir bool, que es una subclase de int.
    return type(value) in (int, float) and float("-inf") < value < float("inf")


def publication_snapshot(export_dir, run_dir, report):
    """Capturar los mismos bytes que se subirán y ligarlos al reporte del gate."""
    web = (Path(export_dir) / "web").resolve()
    graph_bytes = (web / "model.json").read_bytes()
    graph = json.loads(graph_bytes)
    if graph.get("format") != "graph-model":
        raise ValueError("Sólo se publica un TF.js graph-model.")
    contract_bytes = (web / "preprocessing.json").read_bytes()
    contract = json.loads(contract_bytes)
    if contract.get("labels") != {"ok_front": 0, "def_front": 1} or contract.get("positive_class") != "def_front":
        raise ValueError("Etiquetas de exportación incompatibles.")
    if contract.get("threshold") != report.get("threshold"):
        raise ValueError("El umbral exportado no coincide con el quality gate.")
    names = {"model.json", "preprocessing.json"}
    groups = graph.get("weightsManifest")
    if not isinstance(groups, list) or not groups or not any(group.get("paths") for group in groups):
        raise ValueError("El modelo no contiene shards de pesos.")
    for group in groups:
        names.update(group["paths"])
    files = {}
    for name in sorted(names):
        if not isinstance(name, str) or "\\" in name:
            raise ValueError("Ruta de pesos inválida.")
        path = (web / name).resolve()
        if not path.is_relative_to(web) or path == web:
            raise ValueError("Ruta de pesos fuera de la exportación.")
        files[name] = path.read_bytes()
    hashes = {name: hashlib.sha256(body).hexdigest() for name, body in files.items()}
    model_sha = publication_digest(
        {"keras": hashlib.sha256((Path(run_dir) / "best.keras").read_bytes()).hexdigest(), "web": hashes}
    )
    if report.get("model_sha256") != model_sha:
        raise RuntimeError("Publicación bloqueada: los bytes del modelo cambiaron tras el gate.")
    return files, model_sha, hashes["model.json"]


class R2ModelStore:
    """Adaptador S3/R2; crear el cliente no sustituye el gate del publicador."""

    def __init__(self, client, bucket):
        if not bucket:
            raise ValueError("Configura R2_MODELS_BUCKET.")
        self.client = client
        self.bucket = bucket

    def read_manifest(self):
        try:
            response = self.client.get_object(Bucket=self.bucket, Key="manifest.json")
        except Exception as exc:
            if getattr(exc, "response", {}).get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
                return None, None
            raise
        stream = response["Body"]
        try:
            catalog = json.loads(stream.read())
        finally:
            stream.close()
        etag = response.get("ETag")
        if not etag:
            raise ValueError("El manifest remoto no tiene ETag para activación condicional.")
        return catalog, etag

    def put_immutable(self, key, body, content_type):
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                ContentType=content_type,
                CacheControl="public, max-age=31536000, immutable",
                IfNoneMatch="*",
            )
        except Exception as exc:
            if getattr(exc, "response", {}).get("Error", {}).get("Code") not in {"PreconditionFailed", "412"}:
                raise
            # Reintentar una publicación parcial sólo si los objetos existentes son idénticos.
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            stream = response["Body"]
            try:
                identical = stream.read() == body
            finally:
                stream.close()
            if not identical:
                raise RuntimeError(f"Versión inmutable: el objeto {key} ya existe con otros bytes.") from exc

    def activate_manifest(self, catalog, expected_etag):
        condition = {"IfMatch": expected_etag} if expected_etag else {"IfNoneMatch": "*"}
        self.client.put_object(
            Bucket=self.bucket,
            Key="manifest.json",
            Body=publication_json(catalog),
            ContentType="application/json",
            CacheControl="no-cache",
            **condition,
        )


def publish_tfjs_version(export_dir, run_dir, version, assert_ready, open_store, dry_run=True):
    """Única entrada: gate antes de subir, gate otra vez antes de activar, manifest siempre al final.

    assert_ready debe ser assert_publication_ready del notebook (rehace hashes y política).
    open_store es una fábrica perezosa de R2ModelStore: no se llama en dry-run ni si falla el gate.
    """
    report = assert_ready()  # Obligatorio: no confiar en PUBLICATION_ALLOWED ni en un booleano del kernel.
    if not isinstance(version, str) or not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("La versión debe tener formato X.Y.Z sin prefijo v.")
    files, model_sha, graph_sha = publication_snapshot(export_dir, run_dir, report)
    require_quality_gate(report, model_sha, report["golden_sha256"], report["golden_rows"])
    evaluated = evaluate_quality_gate(report["golden_rows"], report["predictions"], report["threshold"])
    metrics = evaluated["tensorflowjs"]
    entry = {
        "version": version,
        "modelPath": f"v{version}/model.json",
        "modelSha256": graph_sha,
        "publishedAt": datetime.now(UTC).isoformat(),
        "input": {"width": 400, "height": 400, "channels": 3, "scale": 1 / 255, "offset": 0},
        "output": {"activation": "sigmoid", "positiveLabel": "DEFECTIVE", "negativeLabel": "OK"},
        "threshold": report["threshold"],
        "metrics": {"testAccuracy": metrics["accuracy"], "testDefectRecall": metrics["recall"]},
    }
    proof = {
        key: value for key, value in report.items() if key not in {"golden_rows", "predictions", "discrepancy_ids"}
    }
    proof.update(
        {key: value for key, value in evaluated.items() if key not in {"golden_rows", "predictions", "discrepancy_ids"}}
    )
    files["quality_gate.json"] = publication_json(proof)
    plan = {"version": version, "model": entry, "files": [f"v{version}/{name}" for name in sorted(files)]}
    validate_model_catalog({"schemaVersion": 1, "activeVersion": version, "versions": [entry]})
    if dry_run:
        return {"status": "dry_run", "published": False, "plan": plan}
    store = open_store()  # Se alcanza sólo después del gate y de validar los bytes que se publicarán.
    catalog, etag = store.read_manifest()
    if catalog is None:
        catalog = {"schemaVersion": 1, "activeVersion": version, "versions": []}
    else:
        validate_model_catalog(catalog)
        if any(item["version"] == version for item in catalog["versions"]):
            raise ValueError(f"La versión {version} ya está publicada; usa una versión nueva.")
        catalog = json.loads(publication_json(catalog))
    catalog["versions"].append(entry)
    catalog["activeVersion"] = version
    validate_model_catalog(catalog)
    for name, body in sorted(files.items()):
        store.put_immutable(
            f"v{version}/{name}", body, "application/json" if name.endswith(".json") else "application/octet-stream"
        )
    # Si cambian los artefactos/datos mientras se suben, dejar objetos inactivos, no activarlos.
    current = assert_ready()
    require_quality_gate(current, model_sha, report["golden_sha256"], report["golden_rows"])
    if current["threshold"] != report["threshold"]:
        raise RuntimeError("Publicación bloqueada: el umbral cambió durante la subida.")
    store.activate_manifest(catalog, expected_etag=etag)
    return {"status": "published", "published": True, "activeVersion": version, "plan": plan}
