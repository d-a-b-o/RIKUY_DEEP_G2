"""Compare Keras and the production browser loader on 50 reserved square images.

Use identical decoded RGB pixels (lossless PNG transport) to isolate inference
from JPEG decoder differences. This does not replace physical camera testing.
"""

import argparse
import base64
import hashlib
import io
import json
import mimetypes
import platform
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlparse

import numpy as np
from ml.preprocessing import preprocess_image
from ml.quality_gate import evaluate_quality_gate, require_quality_gate
from ml.workflow import digest
from PIL import Image


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args):
    import tensorflow as tf
    from playwright.sync_api import sync_playwright

    root = Path(__file__).resolve().parents[1]
    web = root / "apps/web"
    export = args.export.resolve()
    completed = json.loads((export / "completed.json").read_text(encoding="utf-8"))
    for name, expected_hash in completed["artifacts"].items():
        if name.startswith("web/") and sha256(export / name) != expected_hash:
            raise ValueError(f"Exportación modificada: {name}")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    if sha256(args.model) != config["candidate"]["sha256"]:
        raise ValueError("El checkpoint no corresponde al candidato versionado.")
    source_gate = json.loads(args.source_gate.read_text(encoding="utf-8"))
    graph = json.loads((export / "web/model.json").read_text(encoding="utf-8"))
    names = {"model.json", "preprocessing.json"}
    for group in graph["weightsManifest"]:
        names.update(group["paths"])
    weights = {name: sha256(export / "web" / name) for name in sorted(names)}
    identity = digest({"keras": sha256(args.model), "web": weights})
    require_quality_gate(source_gate, identity, source_gate["golden_sha256"], source_gate["golden_rows"])
    golden = json.loads((args.golden / "manifest.json").read_text(encoding="utf-8"))
    rows = golden["rows"]
    original = {row["id"]: row for row in source_gate["golden_rows"]}
    for row in rows:
        reference = original.get(row["source"], {})
        if reference.get("label") != row["label"] or reference.get("source_sha256") != row["sha256"]:
            raise ValueError("Imagen ajena al test reservado aprobado.")
    if len(rows) != 50 or len({row["id"] for row in rows}) != 50:
        raise ValueError("Se requieren las 50 imágenes doradas, sin duplicados.")
    threshold = config["contract"]["threshold"]
    contract = json.loads((export / "web/preprocessing.json").read_text(encoding="utf-8"))
    if (
        contract.get("threshold") != threshold
        or source_gate["threshold"] != threshold
        or contract.get("labels") != {"ok_front": 0, "def_front": 1}
        or config["contract"]["classes"] != contract["labels"]
    ):
        raise ValueError("El umbral o las etiquetas difieren del contrato aprobado.")
    model = tf.keras.models.load_model(args.model, compile=False)
    model.get_layer("resnet50v2")
    images, predictions = [], []
    for index, row in enumerate(rows):
        path = (args.golden / row["path"]).resolve()
        if not path.is_relative_to(args.golden.resolve()) or sha256(path) != row["sha256"]:
            raise ValueError(f"Imagen dorada inválida: {row['id']}")
        with Image.open(path) as source:
            rgb = source.convert("RGB")
            if rgb.width != rgb.height:
                raise ValueError("Esta prueba requiere imágenes cuadradas.")
            output = io.BytesIO()
            rgb.save(output, format="PNG")
            images.append("data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii"))
            value = float(np.asarray(model(preprocess_image(rgb)[None], training=False)).reshape(-1)[0])
        predictions.append({"id": row["id"], "python": value})
        print(f"Keras: {index + 1}/50", flush=True)
    print("Compilando el cargador de producción...", flush=True)
    bundle = subprocess.run(
        ["node", str(root / "ml/browser_model_harness.cjs"), str(web)],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    ).stdout
    manifest = {
        "schemaVersion": 1,
        "activeVersion": "1.0.0",
        "versions": [
            {
                "version": "1.0.0",
                "modelPath": "model/model.json",
                "modelSha256": sha256(export / "web/model.json"),
                "publishedAt": "2026-11-16T00:00:00Z",
                "input": {"width": 400, "height": 400, "channels": 3, "scale": 1 / 255, "offset": 0},
                "output": {"activation": "sigmoid", "positiveLabel": "DEFECTIVE", "negativeLabel": "OK"},
                "threshold": threshold,
            }
        ],
    }

    def serve(route):
        path = unquote(urlparse(route.request.url).path)
        if path == "/":
            route.fulfill(content_type="text/html", body="<!doctype html><title>PT1 parity</title>")
            return
        if path == "/manifest.json":
            route.fulfill(json=manifest)
            return
        if path.startswith("/model/"):
            directory, name = export / "web", path.removeprefix("/model/")
        elif path.startswith("/tfjs-wasm/"):
            directory = web / "node_modules/@tensorflow/tfjs-backend-wasm/dist"
            name = path.removeprefix("/tfjs-wasm/")
        else:
            route.abort()
            return
        file = (directory / name).resolve()
        if not file.is_relative_to(directory.resolve()) or not file.is_file():
            route.abort()
            return
        route.fulfill(
            body=file.read_bytes(), content_type=mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        )

    with sync_playwright() as playwright:
        print("Iniciando Chromium...", flush=True)
        browser = playwright.chromium.launch(
            args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
        )
        try:
            page = browser.new_page()
            page.on(
                "console",
                lambda message: print(f"Chromium: {message.text}", flush=True) if message.type == "error" else None,
            )
            page.set_default_timeout(180_000)
            page.route("**/*", serve)
            page.goto("https://pt1.invalid/")
            page.add_script_tag(content=bundle)
            print("Cargando el modelo real...", flush=True)
            info = page.evaluate(
                "async backend => PT1Browser.open(location.origin + '/manifest.json', backend)", args.backend
            )
            counts = []
            for index, (image, prediction) in enumerate(zip(images, predictions, strict=True)):
                result = page.evaluate("image => PT1Browser.predict(image)", image)
                prediction["tfjs"] = result["defectProbability"]
                counts.append(result["tensors"])
                print(f"Chromium {args.backend}: {index + 1}/50", flush=True)
            remaining = page.evaluate("PT1Browser.dispose()")
            report = evaluate_quality_gate(rows, predictions, threshold, expected_count=50)
            report.update(
                scope="production_browser_loader_same_decoded_rgb",
                browser=browser.version,
                runtime=info,
                versions={
                    "python": platform.python_version(),
                    "tensorflow": tf.__version__,
                    "keras": tf.keras.__version__,
                },
                model_sha256=sha256(args.model),
                export_identity=completed["identity"],
                source_gate_sha256=sha256(args.source_gate),
                export_artifacts={k: v for k, v in completed["artifacts"].items() if k.startswith("web/")},
                golden_manifest_sha256=sha256(args.golden / "manifest.json"),
                source_sha256={
                    name: sha256(web / "src/lib/model" / name)
                    for name in (
                        "loader.ts",
                        "preprocess.ts",
                        "graph-compatibility.ts",
                    )
                },
                tensor_counts=counts,
                tensors_after_dispose=remaining,
                excludes=["native JPEG decoder parity", "physical camera captures", "human independent acceptance"],
            )
            if len(set(counts)) != 1 or remaining != 0:
                report["failures"].append("Los tensores no se mantienen estables o no se liberan.")
                report["passed"] = False
        finally:
            browser.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0 if report["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--export", type=Path, required=True, help="Carpeta con completed.json y web/.")
    parser.add_argument("--golden", type=Path, required=True)
    parser.add_argument("--source-gate", type=Path, required=True, help="Gate aprobado de las 195 imágenes.")
    parser.add_argument("--config", type=Path, default=Path("ml/regression-config.json"))
    parser.add_argument("--backend", choices=("wasm", "webgl"), default="wasm")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        return run(args)
    except Exception as exc:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps({"passed": False, "status": "incomplete", "error": str(exc)}, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Paridad incompleta: {exc}", flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
