"""RIKDP-131: inferencia nueva del test reservado, sin reutilizar test.json ni entrenar."""

import argparse
import platform
from pathlib import Path

import numpy as np
from ml.preprocessing import make_tf_dataset
from ml.regression import write_json
from ml.workflow import Config, check_artifacts, file_hash, load_manifest, read_json, scores


def evaluate_predictions(rows, probabilities, threshold):
    probabilities = np.asarray(probabilities)
    if (
        len(rows) != 195
        or len({r["path"] for r in rows}) != 195
        or {r["label"] for r in rows} != {0, 1}
        or any(r["split"] != "test" for r in rows)
    ):
        raise ValueError("Se requieren las 195 imágenes únicas del test reservado y ambas clases.")
    if (
        probabilities.shape != (195,)
        or not np.isfinite(probabilities).all()
        or np.any(probabilities < 0)
        or np.any(probabilities > 1)
    ):
        raise ValueError("Predicciones incompletas, no finitas o fuera de rango.")
    if not np.isfinite(threshold) or not 0 < threshold < 1:
        raise ValueError("Umbral inválido.")
    metrics = scores([r["label"] for r in rows], probabilities, threshold)
    return {
        "passed": metrics["recall"] >= 0.95 and metrics["accuracy"] >= 0.97,
        "metrics": metrics,
        "policy": {"min_recall": 0.95, "min_accuracy": 0.97},
        "sample_count": len(rows),
        "threshold_from_validation": threshold,
        "predictions": [
            {"id": r["path"], "label": r["label"], "probability": float(p)}
            for r, p in zip(rows, probabilities, strict=True)
        ],
    }


def measure(root, run):
    import tensorflow as tf

    root, run = Path(root).resolve(), Path(run).resolve()
    started, completed = read_json(run / "started.json"), read_json(run / "completed.json")
    check_artifacts(run, completed)
    config = Config(root, seed=started["params"]["seed"])
    manifest = load_manifest(config)
    if started["manifest"] != manifest or started["identity"] != completed["identity"]:
        raise ValueError("La corrida y el dataset no coinciden.")
    rows = sorted((r for r in manifest["rows"] if r["split"] == "test"), key=lambda r: r["path"])
    threshold = read_json(run / "validation.json")["threshold"]
    dataset = make_tf_dataset(
        [root / r["path"] for r in rows],
        [r["label"] for r in rows],
        training=False,
        augment=False,
        batch_size=16,
        seed=config.seed,
    )
    model = tf.keras.models.load_model(run / "best.keras", compile=False, safe_mode=True)
    output = np.asarray(model.predict(dataset, verbose=0))
    if output.shape != (195, 1):
        raise ValueError("Salida del modelo distinta de [195,1].")
    report = evaluate_predictions(rows, output[:, 0], threshold)
    report.update(
        scope="fresh_inference_reserved_test",
        fresh_inference=True,
        human_independent_reviewer=None,
        run_identity=completed["identity"],
        keras_sha256=file_hash(run / "best.keras"),
        dataset_identity=manifest["identity"],
        manifest_sha256=file_hash(config.prepared / "manifest.json"),
        runtime={"python": platform.python_version(), "tensorflow": tf.__version__},
        source_sha256=file_hash(Path(__file__)),
    )
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--run", required=True)
    parser.add_argument("--output", default="reports/independent-metrics/RIKDP-131.json")
    args = parser.parse_args()
    try:
        report = measure(args.root, args.run)
        write_json(args.output, report)
        print({"passed": report["passed"], "metrics": report["metrics"]})
        return 0 if report["passed"] else 1
    except Exception as exc:
        write_json(args.output, {"passed": False, "status": "incomplete", "error": str(exc)})
        print(f"Evaluación incompleta: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
