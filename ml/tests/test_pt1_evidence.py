"""Contratos de evidencia con fixtures sintéticos; no acreditan un modelo real."""

import copy

import pytest
from ml.pt1_validation import audit
from ml.quality_gate import evaluate_quality_gate
from ml.regression_negative import verify_rejection
from ml.reproducibility import compare_runs
from ml.workflow import digest, file_hash, read_json, scores, write_json


def make_run(directory, tag="first", seed=42, recall=1.0):
    directory.mkdir(parents=True)
    (directory / "best.keras").write_bytes(b"unit-test-model-not-real")
    (directory / "history.csv").write_text("epoch,loss,val_accuracy\n0,0.1,1.0\n", encoding="utf-8")
    write_json(directory / "validation.json", {"threshold": 0.5, "recall": recall, "accuracy": 1.0})
    started = {
        "params": {"seed": seed, "experiment_tag": tag, "root": None},
        "manifest": {"identity": "test-dataset", "rows": []},
        "code": {"workflow.py": "unit-fixture"},
        "versions": {"tensorflow": "unit-fixture"},
    }
    started["identity"] = digest(started)
    write_json(directory / "started.json", started)
    reseal(directory)
    return directory


def reseal(directory):
    started = read_json(directory / "started.json")
    started.pop("identity")
    started["identity"] = digest(started)
    write_json(directory / "started.json", started)
    write_json(
        directory / "completed.json",
        {
            "identity": started["identity"],
            "artifacts": {
                name: file_hash(directory / name)
                for name in ("best.keras", "history.csv", "started.json", "validation.json")
            },
        },
    )


def test_two_independent_runs_match_but_copies_do_not(tmp_path):
    left, right = make_run(tmp_path / "a"), make_run(tmp_path / "b", tag="second")
    assert compare_runs(left, right)["passed"]
    with pytest.raises(ValueError, match="independientes"):
        compare_runs(left, left)
    make_run(tmp_path / "copy")
    with pytest.raises(ValueError, match="misma corrida"):
        compare_runs(left, tmp_path / "copy")


def test_different_seed_is_not_reproducibility(tmp_path):
    left, right = make_run(tmp_path / "a"), make_run(tmp_path / "b", tag="second", seed=43)
    with pytest.raises(ValueError, match="params"):
        compare_runs(left, right)


def test_different_metrics_fail_and_tampering_is_rejected(tmp_path):
    left, right = make_run(tmp_path / "a"), make_run(tmp_path / "b", tag="second", recall=0.94)
    assert not compare_runs(left, right)["passed"]
    (right / "best.keras").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="Artefacto"):
        compare_runs(left, right)


@pytest.mark.parametrize(
    "exit_code,discrepancies,accepted", [(0, 25, False), (2, 25, False), (1, 2, False), (1, 25, True)]
)
def test_negative_control_requires_real_gate_rejection(exit_code, discrepancies, accepted):
    report = {
        "passed": False,
        "scope": "real_keras_baseline_vs_candidate",
        "rows": [{}] * 50,
        "discrepancies": discrepancies,
    }
    assert verify_rejection(exit_code, report) is accepted
    report["scope"] = "configuration_or_inference_error"
    assert not verify_rejection(exit_code, report)


@pytest.fixture
def original_evidence(tmp_path):
    run = make_run(tmp_path / "run")
    export = tmp_path / "export"
    web = export / "web"
    web.mkdir(parents=True)
    (web / "weights.bin").write_bytes(b"unit-fixture")
    write_json(web / "model.json", {"format": "graph-model", "weightsManifest": [{"paths": ["weights.bin"]}]})
    started = read_json(run / "started.json")
    rows = [{"path": str(i), "label": int(i >= 78), "sha256": f"image-{i}", "split": "test"} for i in range(195)]
    started["manifest"]["rows"] = rows
    write_json(run / "started.json", started)
    reseal(run)
    started = read_json(run / "started.json")
    write_json(
        web / "preprocessing.json",
        {"run_identity": started["identity"], "threshold": 0.5, "labels": {"ok_front": 0, "def_front": 1}},
    )
    golden = [
        {"id": r["path"], "label": r["label"], "source_sha256": r["sha256"]}
        for r in sorted(rows, key=lambda r: r["path"])
    ]
    predictions = [
        {"id": r["id"], "python": 0.9 if r["label"] else 0.1, "tfjs": 0.9 if r["label"] else 0.1} for r in golden
    ]
    report = evaluate_quality_gate(golden, predictions, 0.5)
    report.update(
        model_sha256=digest(
            {"keras": file_hash(run / "best.keras"), "web": {p.name: file_hash(p) for p in web.iterdir()}}
        ),
        golden_sha256=digest({"dataset_identity": "test-dataset", "rows": golden}),
    )
    source = tmp_path / "report.json"
    write_json(source, report)
    write_json(
        run / "test.json",
        {
            "run_identity": started["identity"],
            "threshold_from_validation": 0.5,
            **scores([r["label"] for r in golden], [p["python"] for p in predictions], 0.5),
        },
    )
    return source, run, export


def test_original_report_revalidated_without_claiming_fresh_inference(original_evidence):
    proof = audit(*original_evidence)
    assert proof["passed"]
    assert proof["fresh_inference"] is False
    assert proof["human_independent_reviewer"] is None


@pytest.mark.parametrize("fault", ["weights", "row", "metric", "test"])
def test_report_and_artifact_tampering_rejected(original_evidence, fault):
    source, run, export = original_evidence
    if fault == "weights":
        (export / "web/weights.bin").write_bytes(b"changed")
    elif fault == "test":
        value = read_json(run / "test.json")
        value["recall"] = 0.5
        write_json(run / "test.json", value)
    else:
        value = copy.deepcopy(read_json(source))
        if fault == "row":
            value["golden_rows"][0]["label"] = 1
        else:
            value["python"]["recall"] = 0.5
        write_json(source, value)
    with pytest.raises(ValueError):
        audit(source, run, export)
