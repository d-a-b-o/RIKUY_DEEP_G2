"""RIKDP-101: comparar dos fits independientes o ejecutarlos explícitamente."""

import argparse
import csv
import math
from dataclasses import fields
from pathlib import Path

from ml.regression import write_json
from ml.workflow import Config, check_artifacts, digest, read_json, train

TOLERANCE = 1e-6


def compare_runs(left, right):
    left, right = Path(left).resolve(), Path(right).resolve()
    if left == right:
        raise ValueError("Se necesitan dos corridas independientes, no reutilizar una carpeta.")
    records = []
    for directory in (left, right):
        started, completed = read_json(directory / "started.json"), read_json(directory / "completed.json")
        check_artifacts(directory, completed)
        if started["identity"] != completed["identity"]:
            raise ValueError("Identidad de corrida inconsistente.")
        params = {k: v for k, v in started["params"].items() if k not in {"root", "experiment_tag"}}
        if not isinstance(params.get("seed"), int) or not started.get("code") or not started.get("versions"):
            raise ValueError("Semilla, código y versiones obligatorios.")
        identity = digest(
            {
                "params": started["params"],
                "manifest": started["manifest"],
                "code": started["code"],
                "versions": started["versions"],
            }
        )
        if identity != completed["identity"]:
            raise ValueError("La identidad no corresponde al contenido de la corrida.")
        with (directory / "history.csv").open(encoding="utf-8", newline="") as stream:
            history = list(csv.DictReader(stream))
        validation = read_json(directory / "validation.json")
        if not history or not {"threshold", "recall", "accuracy"} <= validation.keys():
            raise ValueError("Faltan épocas o métricas de validación.")
        records.append(
            {
                "identity": identity,
                "params": params,
                "manifest": started["manifest"],
                "code": started["code"],
                "versions": started["versions"],
                "history": history,
                "validation": validation,
                "artifacts": completed["artifacts"],
            }
        )
    a, b = records
    if a["identity"] == b["identity"]:
        raise ValueError("Una copia de la misma corrida no acredita dos entrenamientos.")
    for key in ("params", "manifest", "code", "versions"):
        if a[key] != b[key]:
            raise ValueError(f"Corridas no comparables: {key}")
    differences = []

    def compare_values(x, y, prefix):
        if isinstance(x, dict) and isinstance(y, dict):
            if x.keys() != y.keys():
                differences.append(prefix + ": campos distintos")
            else:
                for key in x:
                    compare_values(x[key], y[key], f"{prefix}.{key}")
        elif isinstance(x, list) and isinstance(y, list):
            if len(x) != len(y):
                differences.append(prefix + ": longitud distinta")
            else:
                for i, (one, two) in enumerate(zip(x, y, strict=True)):
                    compare_values(one, two, f"{prefix}[{i}]")
        else:
            try:
                one, two = float(x), float(y)
                equal = math.isfinite(one) and math.isfinite(two) and abs(one - two) <= TOLERANCE
            except (TypeError, ValueError):
                equal = False
            if not equal:
                differences.append(prefix + ": valores distintos/no finitos")

    compare_values(a["history"], b["history"], "history")
    compare_values(a["validation"], b["validation"], "validation")
    return {
        "passed": not differences,
        "scope": "two_independent_training_runs",
        "absolute_tolerance": TOLERANCE,
        "differences": differences,
        "seed": a["params"]["seed"],
        "params": a["params"],
        "dataset_sha256": digest(a["manifest"]),
        "code": a["code"],
        "versions": a["versions"],
        "runs": [
            {
                "identity": r["identity"],
                "epochs": len(r["history"]),
                "validation": r["validation"],
                "artifacts": r["artifacts"],
            }
            for r in records
        ],
    }


def train_twice(root, reference):
    # Las dos etiquetas producen identidades diferentes; train debe ejecutar dos fits.
    params = read_json(Path(reference) / "started.json")["params"]
    config_fields = {f.name for f in fields(Config)} - {"root", "experiment_tag"}
    kwargs = {key: params[key] for key in config_fields}
    results = []
    for index in (1, 2):
        config = Config(root=Path(root), experiment_tag=f"pt1-repro-{index}", **kwargs)
        # No aceptar la caché como evidencia de una nueva ejecución de este comando.
        parent = config.root / "models/experiments"
        previous = set(parent.iterdir()) if parent.exists() else set()
        directory = train(
            config,
            kind=params["kind"],
            augmentation=params["augmentation"],
            learning_rate=params["learning_rate"],
            dropout=params["dropout"],
            fraction=params["fraction"],
        )
        if directory in previous:
            raise ValueError(
                "La etiqueta de prueba ya existe; compara sus evidencias, no reutilices un fit como nuevo."
            )
        results.append(directory)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--left")
    parser.add_argument("--right")
    parser.add_argument("--train-twice", action="store_true")
    parser.add_argument("--root", default=".")
    parser.add_argument("--reference")
    parser.add_argument("--output", default="reports/reproducibility/RIKDP-101.json")
    args = parser.parse_args()
    try:
        if args.train_twice:
            if not args.reference or args.left or args.right:
                raise ValueError("Entrenar requiere --reference y excluye --left/--right.")
            left, right = train_twice(args.root, args.reference)
        else:
            if not args.left or not args.right:
                raise ValueError("Indica --left y --right, o --train-twice --reference.")
            left, right = args.left, args.right
        report = compare_runs(left, right)
        write_json(args.output, report)
        return 0 if report["passed"] else 1
    except Exception as exc:
        write_json(args.output, {"passed": False, "status": "incomplete", "error": str(exc)})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
