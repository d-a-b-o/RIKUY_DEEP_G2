"""RIKDP-154: repetir inferencia Keras/TF.js real en las 50 imágenes versionadas."""

import argparse
import functools
import http.server
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from ml.preprocessing import make_tf_dataset
from ml.pt1_validation import audit
from ml.quality_gate import evaluate_quality_gate
from ml.regression import sha256, validate_golden, write_json
from ml.workflow import read_json


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def measure(config_path, run, export, web, source_report):
    import tensorflow as tf

    root = Path(__file__).resolve().parents[1]
    config_path, run, export = Path(config_path).resolve(), Path(run).resolve(), Path(export).resolve()
    proof = audit(source_report, run, export)
    if not proof["passed"]:
        raise ValueError("La evidencia de la exportación no está aprobada.")
    config = read_json(config_path)
    golden = config_path.parent / config["golden"]
    manifest = validate_golden(golden)
    if manifest["kind"] != "real" or sha256(run / "best.keras") != config["candidate"]["sha256"]:
        raise ValueError("Modelo o imágenes distintos de la referencia.")
    contract = read_json(export / "web/preprocessing.json")
    if contract["run_identity"] != read_json(run / "completed.json")["identity"]:
        raise ValueError("La exportación pertenece a otra corrida.")
    if contract["threshold"] != read_json(run / "validation.json")["threshold"]:
        raise ValueError("Umbral distinto del validado.")
    rows = manifest["rows"]
    tf.keras.utils.set_random_seed(42)
    model = tf.keras.models.load_model(run / "best.keras", compile=False, safe_mode=True)
    handler = functools.partial(QuietHandler, directory=str(export / "web"))
    with tempfile.TemporaryDirectory(prefix="pt1-inference-") as temporary:
        work = Path(temporary)
        dataset = make_tf_dataset(
            [golden / r["path"] for r in rows], [r["label"] for r in rows], training=False, augment=False, batch_size=1
        )
        samples = []
        for i, (row, (tensor, _)) in enumerate(zip(rows, dataset, strict=True)):
            filename = f"{i:03}.bin"
            tensor.numpy().astype("<f4").tofile(work / filename)
            samples.append(
                {"id": row["id"], "tensor_file": filename, "python": float(model(tensor, training=False).numpy()[0, 0])}
            )
        write_json(work / "samples.json", samples)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            subprocess.run(
                [
                    shutil.which("node") or "node",
                    str(root / "ml/pt1_inference.cjs"),
                    str(Path(web).resolve()),
                    f"http://127.0.0.1:{server.server_port}/model.json",
                    str(work),
                ],
                check=True,
                timeout=3600,
            )
        finally:
            server.shutdown()
            server.server_close()
        result = read_json(work / "predictions.json")
    python = {s["id"]: s["python"] for s in samples}
    predictions = [{**p, "python": python.get(p["id"])} for p in result["predictions"]]
    report = evaluate_quality_gate(rows, predictions, contract["threshold"], expected_count=50)
    # Este caso evalúa paridad; las métricas objetivo usan el test completo (RIKDP-131).
    parity_failures = [f for f in report["failures"] if "accuracy" not in f and "recall" not in f]
    graph = read_json(export / "web/model.json")
    names = {"model.json", "preprocessing.json"}
    for group in graph["weightsManifest"]:
        names.update(group["paths"])
    hashes = {}
    for name in sorted(names):
        path = (export / "web" / name).resolve()
        if not path.is_relative_to((export / "web").resolve()):
            raise ValueError("Ruta fuera de la exportación.")
        hashes[name] = sha256(path)
    return {
        "passed": not parity_failures,
        "scope": "fresh_keras_vs_tfjs_cpu_identical_tensors_50",
        "parity_failures": parity_failures,
        "model_sha256": sha256(run / "best.keras"),
        "export_sha256": hashes,
        "golden_manifest_sha256": sha256(golden / "manifest.json"),
        "tensorflow": tf.__version__,
        "source_report_sha256": proof["source_report_sha256"],
        "runtime": {k: v for k, v in result.items() if k != "predictions"},
        "measurement": report,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="ml/regression-config.json")
    parser.add_argument("--run", required=True)
    parser.add_argument("--export", required=True)
    parser.add_argument("--source-report", required=True)
    parser.add_argument("--web", default="apps/web")
    parser.add_argument("--output", default="reports/pt1-inference.json")
    args = parser.parse_args()
    try:
        report = measure(args.config, args.run, args.export, args.web, args.source_report)
        write_json(args.output, report)
        return 0 if report["passed"] else 1
    except Exception as exc:
        write_json(args.output, {"passed": False, "status": "incomplete", "error": str(exc)})
        return 2


if __name__ == "__main__":
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
    os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
    raise SystemExit(main())
