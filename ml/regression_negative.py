"""RIKDP-145: degradar una copia del checkpoint y exigir rechazo del gate real."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from ml.regression import sha256, validate_golden, write_json


def prepare(config_path, output):
    import tensorflow as tf

    config_path, output = Path(config_path).resolve(), Path(output).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    golden = (config_path.parent / config["golden"]).resolve()
    if validate_golden(golden)["kind"] != "real":
        raise ValueError("Se requiere el conjunto real.")
    config["golden"] = str(golden)
    for role in ("baseline", "candidate"):
        spec = config[role]
        source = (config_path.parent / spec["path"]).resolve()
        if sha256(source) != spec["sha256"] or spec["contract"] != config["contract"]:
            raise ValueError("Checkpoint/contrato distinto del configurado.")
        spec["path"] = str(source)
    source = Path(config["candidate"]["path"])
    model = tf.keras.models.load_model(source, compile=False, safe_mode=True)
    head = model.layers[-1]
    if not isinstance(head, tf.keras.layers.Dense) or head.units != 1 or head.activation.__name__ != "sigmoid":
        raise ValueError("Se esperaba una cabeza Dense sigmoid de una unidad.")
    kernel, bias = head.get_weights()
    head.set_weights([np.zeros_like(kernel), np.full_like(bias, -12)])
    output.mkdir(parents=True, exist_ok=True)
    degraded = output / "degraded.keras"
    if degraded == source:
        raise ValueError("Nunca sobrescribir el modelo original.")
    model.save(degraded)
    source_sha = config["candidate"]["sha256"]
    config["candidate"].update(path=str(degraded), sha256=sha256(degraded))
    target = output / "config.json"
    write_json(target, config)
    write_json(
        output / "provenance.json",
        {
            "scope": "deliberately_degraded_copy",
            "source_sha256": source_sha,
            "degraded_sha256": sha256(degraded),
            "mutation": "zero sigmoid kernel, bias=-12",
            "source_unchanged": sha256(source) == source_sha,
        },
    )
    return target


def verify_rejection(exit_code, report):
    return (
        exit_code == 1
        and report.get("passed") is False
        and report.get("scope") == "real_keras_baseline_vs_candidate"
        and len(report.get("rows", [])) == 50
        and report.get("discrepancies", 0) > 2
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="ml/regression-config.json")
    parser.add_argument("--output", default="reports/pt1-negative")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    output = Path(args.output)
    try:
        config = prepare(args.config, output)
        if args.prepare_only:
            return 0
        result = subprocess.run(
            [sys.executable, "-m", "ml.regression", "--config", str(config), "--output", str(output / "regression")],
            timeout=1200,
            check=False,
        )
        report = json.loads((output / "regression/regression.json").read_text(encoding="utf-8"))
        proof = {
            "passed": verify_rejection(result.returncode, report),
            "gate_exit_code": result.returncode,
            "scope": "local_negative_control_not_remote_ci",
            "regression": report,
            "provenance": json.loads((output / "provenance.json").read_text(encoding="utf-8")),
        }
        write_json(output / "RIKDP-145.json", proof)
        return 0 if proof["passed"] else 1
    except Exception as exc:
        write_json(output / "RIKDP-145.json", {"passed": False, "status": "incomplete", "error": str(exc)})
        return 2


if __name__ == "__main__":
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
    os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
    raise SystemExit(main())
