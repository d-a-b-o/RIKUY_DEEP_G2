import csv
import json
import sys
from types import SimpleNamespace

import numpy as np
import pytest
from ml.golden import build
from ml.regression import (
    CLASSES,
    PREPROCESSING,
    compare,
    main,
    predict,
    reports,
    run,
    sha256,
    validate_golden,
    write_json,
)


@pytest.fixture
def golden(tmp_path):
    directory = tmp_path / "synthetic"
    build(directory)
    return directory


@pytest.mark.parametrize("changes", [0, 1, 2, 3, 10])
def test_acceptance_and_reports(tmp_path, changes):
    rows = [{"id": str(i)} for i in range(50)]
    baseline = [{"id": r["id"], "probability": 0.1} for r in rows]
    candidate = [{"id": str(i), "probability": 0.9 if i < changes else 0.1} for i in range(50)]
    report = compare(rows, baseline, list(reversed(candidate)), 0.2649)
    assert report["passed"] == (changes <= 2)
    assert report["discrepancies"] == changes
    reports(tmp_path, report)
    assert json.loads((tmp_path / "regression.json").read_text()) == report
    with (tmp_path / "differences.csv").open(newline="") as source:
        output = list(csv.DictReader(source))
    assert len(output) == 50
    assert sum(r["changed"] == "True" for r in output) == changes
    assert output[0]["original_prediction"] == "0"
    before = (tmp_path / "regression.json").read_bytes()
    reports(tmp_path, compare(rows, baseline, candidate, 0.2649))
    assert (tmp_path / "regression.json").read_bytes() == before


@pytest.mark.parametrize("fault", ["missing", "duplicate", "foreign", "nan", "range", "bool"])
def test_invalid_predictions(fault):
    rows = [{"id": "a"}, {"id": "b"}]
    baseline = [{"id": "a", "probability": 0.2}, {"id": "b", "probability": 0.8}]
    candidate = [r.copy() for r in baseline]
    if fault == "missing":
        candidate.pop()
    elif fault == "duplicate":
        candidate[1]["id"] = "a"
    elif fault == "foreign":
        candidate[1]["id"] = "c"
    else:
        candidate[0]["probability"] = {"nan": float("nan"), "range": 2, "bool": True}[fault]
    with pytest.raises(ValueError):
        compare(rows, baseline, candidate, 0.2649)


@pytest.mark.parametrize("threshold", [0, 1, None, True, float("nan")])
def test_invalid_threshold(threshold):
    with pytest.raises(ValueError):
        compare([], [], [], threshold)


def test_threshold_boundary():
    result = compare([{"id": "a"}], [{"id": "a", "probability": 0.2649}], [{"id": "a", "probability": 0.1}], 0.2649)
    assert result["rows"][0]["original_prediction"] == 1


def test_reproducible_fixture_and_shared_preprocessing(golden, tmp_path):
    other = tmp_path / "other"
    build(other)
    assert sha256(other / "manifest.json") == sha256(golden / "manifest.json")
    manifest = validate_golden(golden)
    assert manifest["kind"] == "synthetic"

    def predictor(tensor):
        assert tensor.shape == (1, 400, 400, 3)
        assert tensor.dtype == np.float32
        assert 0 <= tensor.min() <= tensor.max() <= 1
        return [[float(tensor.mean())]]

    baseline = predict(golden, manifest, predictor)
    candidate = predict(golden, manifest, predictor)
    assert compare(manifest["rows"], baseline, candidate, 0.2649)["discrepancies"] == 0


@pytest.mark.parametrize("fault", ["missing", "corrupt", "hash", "duplicate", "classes", "traversal", "label"])
def test_invalid_golden(golden, fault):
    path = golden / "manifest.json"
    manifest = json.loads(path.read_text())
    row = manifest["rows"][0]
    image = golden / row["path"]
    if fault == "missing":
        image.unlink()
    elif fault == "corrupt":
        image.write_bytes(b"not-an-image")
        row["sha256"] = sha256(image)
    elif fault == "hash":
        row["sha256"] = "0" * 64
    elif fault == "duplicate":
        manifest["rows"][1]["id"] = row["id"]
    elif fault == "classes":
        manifest["classes"] = {"wrong": 0}
    elif fault == "traversal":
        row["path"] = "../outside.png"
    else:
        row["label"] = 2
    write_json(path, manifest)
    with pytest.raises((ValueError, OSError)):
        validate_golden(golden)


def test_cli_missing_config_records_failure(tmp_path, monkeypatch):
    (tmp_path / "differences.csv").write_text("stale previous run")
    monkeypatch.setattr("sys.argv", ["regression", "--config", str(tmp_path / "absent"), "--output", str(tmp_path)])
    assert main() == 2
    assert json.loads((tmp_path / "regression.json").read_text())["passed"] is False
    assert not (tmp_path / "differences.csv").exists()


def test_real_gate_rejects_synthetic(golden, tmp_path):
    config = tmp_path / "config.json"
    write_json(
        config,
        {"golden": "synthetic", "contract": {"classes": CLASSES, "preprocessing": PREPROCESSING, "threshold": 0.2649}},
    )
    with pytest.raises(ValueError, match="sintéticos"):
        run(config, tmp_path / "reports")


@pytest.mark.parametrize("fault", ["contract", "hash"])
def test_model_configuration(golden, tmp_path, fault):
    manifest = validate_golden(golden)
    manifest["kind"] = "real"  # Validation-only fixture: never run real inference here.
    write_json(golden / "manifest.json", manifest)
    contract = {"classes": CLASSES, "preprocessing": PREPROCESSING, "threshold": 0.2649}
    model = tmp_path / "fixture.keras"
    model.write_bytes(b"not-a-real-model")
    spec = {"path": model.name, "sha256": "0" * 64, "contract": contract if fault == "hash" else {}}
    config = tmp_path / "config.json"
    write_json(config, {"golden": "synthetic", "contract": contract, "baseline": spec, "candidate": spec})
    with pytest.raises(ValueError, match="Hash|Contratos"):
        run(config, tmp_path / "reports")


def test_build_from_existing_test_manifest(golden, tmp_path):
    manifest = validate_golden(golden)
    for row in manifest["rows"]:
        row["split"] = "test"
    source = tmp_path / "test-manifest.json"
    write_json(source, manifest)
    target = tmp_path / "selected"
    build(target, source, golden)
    result = validate_golden(target)
    assert result["source_manifest_sha256"] == sha256(source)
    assert len(result["rows"]) == 50
    # Synthetic source used only to exercise copying; no claim of real imagery.


@pytest.mark.parametrize("output", [[[float("nan")]], [[1, 0]], [[1.5]]])
def test_invalid_model_output(golden, output):
    with pytest.raises(ValueError):
        predict(golden, validate_golden(golden), lambda tensor: output)


@pytest.mark.parametrize("changes", [0, 1, 2, 3])
def test_runner_exit_codes_with_fake_keras(golden, tmp_path, monkeypatch, changes):
    """Exercise orchestration and reporting; fake engine is not real model evidence."""
    manifest = validate_golden(golden)
    manifest["kind"] = "real"
    write_json(golden / "manifest.json", manifest)
    contract = {"classes": CLASSES, "preprocessing": PREPROCESSING, "threshold": 0.2649}
    specs = {}
    for role in ("baseline", "candidate"):
        path = tmp_path / f"{role}.keras"
        path.write_bytes(role.encode())
        specs[role] = {"path": path.name, "sha256": sha256(path), "contract": contract}
    config = tmp_path / "config.json"
    write_json(config, {"golden": "synthetic", "contract": contract, **specs})

    def load_model(path, **kwargs):
        index = 0

        def model(tensor, training):
            nonlocal index
            value = 0.9 if path.name == "candidate.keras" and index < changes else 0.1
            index += 1
            assert training is False
            return [[value]]

        return model

    fake = SimpleNamespace(
        keras=SimpleNamespace(
            models=SimpleNamespace(load_model=load_model), utils=SimpleNamespace(set_random_seed=lambda seed: None)
        ),
        config=SimpleNamespace(experimental=SimpleNamespace(enable_op_determinism=lambda: None)),
    )
    monkeypatch.setitem(sys.modules, "tensorflow", fake)
    monkeypatch.setattr("sys.argv", ["regression", "--config", str(config), "--output", str(tmp_path / "report")])
    assert main() == (0 if changes <= 2 else 1)
    report = json.loads((tmp_path / "report/regression.json").read_text())
    assert report["discrepancies"] == changes
    assert report["model_sha256"]["baseline"] == specs["baseline"]["sha256"]
