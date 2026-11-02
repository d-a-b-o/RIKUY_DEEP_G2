"""HU22: comparación de checkpoints Keras sobre un inventario dorado inmutable."""

import argparse
import csv
import hashlib
import json
import os
from pathlib import Path

import numpy as np
from ml.preprocessing import preprocess_image
from ml.quality_gate import probability
from PIL import Image

CLASSES = {"ok_front": 0, "def_front": 1}
PREPROCESSING = "ml.preprocessing.preprocess_image:rgb-bilinear-400x400-float32-0-1:v1"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(
        json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8", newline="\n"
    )


def validate_golden(directory, expected_count=50):
    directory = Path(directory).resolve()
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    rows = manifest.get("rows", [])
    if manifest.get("classes") != CLASSES or manifest.get("schema_version") != 1:
        raise ValueError("Clases o versión de inventario incompatibles.")
    if manifest.get("kind") not in {"real", "synthetic"}:
        raise ValueError("Declarar kind real o synthetic.")
    if len(rows) != expected_count or not rows:
        raise ValueError("Cantidad de imágenes distinta de la esperada.")
    ids, paths = set(), set()
    for row in rows:
        identifier = row.get("id")
        if not isinstance(identifier, str) or not identifier or identifier in ids:
            raise ValueError("Identificador vacío o duplicado.")
        ids.add(identifier)
        if type(row.get("label")) is not int or row["label"] not in CLASSES.values():
            raise ValueError("Etiqueta incompatible.")
        path = (directory / row["path"]).resolve()
        if not path.is_relative_to(directory) or path in paths:
            raise ValueError("Ruta fuera del conjunto o repetida.")
        paths.add(path)
        if sha256(path) != row["sha256"]:
            raise ValueError("Integridad SHA256 inválida.")
        with Image.open(path) as image:
            image.convert("RGB").load()
    if {row["label"] for row in rows} != {0, 1}:
        raise ValueError("Se requieren ambas clases.")
    return manifest


def predict(directory, manifest, predictor):
    """Un solo camino de preprocesamiento para ambos modelos; sin augmentation."""
    result = []
    for row in sorted(manifest["rows"], key=lambda row: row["id"]):
        tensor = preprocess_image(Path(directory) / row["path"])[None, ...]
        output = np.asarray(predictor(tensor))
        if output.shape != (1, 1):
            raise ValueError("Se requiere salida sigmoid [1,1].")
        value = float(output[0, 0])
        if not probability(value):
            raise ValueError("Probabilidad no finita o fuera de rango.")
        result.append({"id": row["id"], "probability": value})
    return result


def compare(rows, baseline, candidate, threshold):
    if not probability(threshold) or not 0 < threshold < 1:
        raise ValueError("Umbral inválido.")
    ids = [row["id"] for row in rows]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("Inventario vacío o IDs duplicados.")
    for predictions in (baseline, candidate):
        keys = [row["id"] for row in predictions]
        if len(keys) != len(set(keys)) or set(keys) != set(ids):
            raise ValueError("Predicciones incompletas, duplicadas o ajenas al conjunto.")
        if any(not probability(row.get("probability")) for row in predictions):
            raise ValueError("Probabilidad inválida.")
    old = {row["id"]: row["probability"] for row in baseline}
    new = {row["id"]: row["probability"] for row in candidate}
    differences = [
        {
            "id": key,
            "original_probability": old[key],
            "new_probability": new[key],
            "original_prediction": int(old[key] >= threshold),
            "new_prediction": int(new[key] >= threshold),
            "changed": (old[key] >= threshold) != (new[key] >= threshold),
        }
        for key in sorted(ids)
    ]
    count = sum(row["changed"] for row in differences)
    return {"passed": count <= 2, "discrepancies": count, "max_discrepancies": 2, "rows": differences}


def reports(directory, report):
    directory = Path(directory)
    write_json(directory / "regression.json", report)
    if report.get("rows"):
        with (directory / "differences.csv").open("w", newline="", encoding="utf-8") as output:
            writer = csv.DictWriter(output, fieldnames=list(report["rows"][0]))
            writer.writeheader()
            writer.writerows(report["rows"])
    elif (directory / "differences.csv").exists():
        (directory / "differences.csv").unlink()  # No conservar CSV de una ejecución anterior tras un error.


def run(config_path, output):
    """Paths relativos al JSON; ambos contratos deben coincidir exactamente."""
    config_path = Path(config_path).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    root = config_path.parent
    contract = config["contract"]
    if contract.get("classes") != CLASSES or contract.get("preprocessing") != PREPROCESSING:
        raise ValueError("Contrato de clases/preprocesamiento incompatible.")
    threshold = contract.get("threshold")
    if not probability(threshold) or not 0 < threshold < 1:
        raise ValueError("Umbral inválido.")
    golden = root / config["golden"]
    manifest = validate_golden(golden)
    if manifest["kind"] != "real":
        raise ValueError("El gate real no acepta fixtures sintéticos.")
    paths = {}
    for role in ("baseline", "candidate"):
        spec = config[role]
        if spec["contract"] != contract:
            raise ValueError("Contratos distintos entre modelos.")
        path = root / spec["path"]
        if sha256(path) != spec["sha256"]:
            raise ValueError(f"Hash del modelo {role} inválido.")
        paths[role] = path
    # TensorFlow se importa sólo para la inferencia real, nunca en las pruebas unitarias.
    import tensorflow as tf

    tf.keras.utils.set_random_seed(42)
    tf.config.experimental.enable_op_determinism()
    predictions = {}
    for role, path in paths.items():
        model = tf.keras.models.load_model(path, compile=False, safe_mode=True)
        predictions[role] = predict(golden, manifest, lambda tensor, model=model: model(tensor, training=False))
    report = compare(manifest["rows"], predictions["baseline"], predictions["candidate"], threshold)
    report.update(
        scope="real_keras_baseline_vs_candidate",
        contract=contract,
        golden_manifest_sha256=sha256(golden / "manifest.json"),
        model_sha256={role: sha256(path) for role, path in paths.items()},
        config_sha256=sha256(config_path),
    )
    reports(output, report)
    return 0 if report["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="ml/regression-config.json")
    parser.add_argument("--output", default="reports/regression")
    args = parser.parse_args()
    try:
        return run(args.config, args.output)
    except Exception as exc:
        # Guardar evidencia de fallo, nunca un resultado aprobado por falta de configuración.
        reports(args.output, {"passed": False, "status": "configuration_or_inference_error", "error": str(exc)})
        print(f"Regresión bloqueada: {exc}")
        return 2


if __name__ == "__main__":
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
    os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
    raise SystemExit(main())
