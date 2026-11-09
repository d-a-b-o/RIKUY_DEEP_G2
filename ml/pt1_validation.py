"""Revalidar evidencia original de 195 imágenes sin confundirla con nueva inferencia."""

import argparse
import importlib.metadata
import math
import platform
from pathlib import Path

from ml.quality_gate import evaluate_quality_gate
from ml.regression import write_json
from ml.workflow import check_artifacts, digest, file_hash, read_json, scores


def audit(source_report, run, export):
    run, export = Path(run), Path(export)
    started, completed = read_json(run / "started.json"), read_json(run / "completed.json")
    check_artifacts(run, completed)
    if started["identity"] != completed["identity"]:
        raise ValueError("Identidades de corrida diferentes.")
    report = read_json(source_report)
    contract = read_json(export / "web/preprocessing.json")
    threshold = read_json(run / "validation.json")["threshold"]
    if (
        contract["threshold"] != threshold
        or contract["labels"] != {"ok_front": 0, "def_front": 1}
        or contract["run_identity"] != completed["identity"]
    ):
        raise ValueError("Exportación de otra corrida/contrato.")
    graph = read_json(export / "web/model.json")
    if graph.get("format") != "graph-model" or not graph.get("weightsManifest"):
        raise ValueError("Se requiere graph-model con pesos.")
    names = {"model.json", "preprocessing.json"}
    for group in graph["weightsManifest"]:
        names.update(group["paths"])
    weights = {}
    for name in sorted(names):
        path = (export / "web" / name).resolve()
        if not path.is_relative_to((export / "web").resolve()):
            raise ValueError("Pesos fuera de la exportación.")
        weights[name] = file_hash(path)
    model_sha = digest({"keras": file_hash(run / "best.keras"), "web": weights})
    manifest = started["manifest"]
    rows = [
        {"id": r["path"], "label": r["label"], "source_sha256": r["sha256"]}
        for r in sorted(manifest["rows"], key=lambda r: r["path"])
        if r["split"] == "test"
    ]
    golden_sha = digest({"dataset_identity": manifest["identity"], "rows": rows})
    if (
        report.get("golden_rows") != rows
        or report.get("model_sha256") != model_sha
        or report.get("golden_sha256") != golden_sha
        or report.get("threshold") != threshold
    ):
        raise ValueError("Reporte no corresponde al modelo/exportación/test reservado.")
    recalculated = evaluate_quality_gate(rows, report["predictions"], threshold)
    for key in (
        "passed",
        "failures",
        "sample_count",
        "classification_discrepancies",
        "max_absolute_difference",
        "python",
        "tensorflowjs",
    ):
        if report.get(key) != recalculated.get(key):
            raise ValueError(f"Reporte alterado: {key}")
    predictions = {p["id"]: p for p in report["predictions"]}
    independent = scores([r["label"] for r in rows], [predictions[r["id"]]["python"] for r in rows], threshold)
    original_test = read_json(run / "test.json")
    if (
        original_test["run_identity"] != completed["identity"]
        or original_test["threshold_from_validation"] != threshold
    ):
        raise ValueError("Reporte test de otra corrida/umbral.")
    for key, value in independent.items():
        original = original_test[key]
        if isinstance(value, list):
            equal = original == value
        else:
            # test.json usa lotes de 16; el gate infiere de una en una.
            equal = math.isfinite(original) and math.isclose(
                original, value, abs_tol=1e-6 if key == "brier" else 1e-10, rel_tol=0
            )
        if not equal:
            raise ValueError(f"Métrica test no coincide: {key}")
    return {
        "passed": recalculated["passed"],
        "scope": "original_inference_evidence_revalidated",
        "fresh_inference": False,
        "runtime": {"python": platform.python_version(), "scikit_learn": importlib.metadata.version("scikit-learn")},
        "human_independent_reviewer": None,
        "run_identity": completed["identity"],
        "sample_count": len(rows),
        "threshold": threshold,
        "model_sha256": model_sha,
        "keras_sha256": file_hash(run / "best.keras"),
        "golden_sha256": golden_sha,
        "source_report_sha256": file_hash(source_report),
        "test_report_sha256": file_hash(run / "test.json"),
        "independent_sklearn_metrics": independent,
        "brier_absolute_difference": abs(original_test["brier"] - independent["brier"]),
        "brier_tolerance": 1e-6,
        "classification_discrepancies": recalculated["classification_discrepancies"],
        "max_absolute_difference": recalculated["max_absolute_difference"],
        "checks": [
            "completed artifact hashes",
            "selected run and export identity",
            "195 reserved test rows",
            "Keras and TF.js weight hashes",
            "policy recomputation",
            "independent sklearn metrics",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-report", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--export", required=True)
    parser.add_argument("--output", default="reports/pt1-validation.json")
    args = parser.parse_args()
    try:
        report = audit(args.source_report, args.run, args.export)
        write_json(args.output, report)
        return 0 if report["passed"] else 1
    except Exception as exc:
        write_json(args.output, {"passed": False, "status": "incomplete", "error": str(exc)})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
