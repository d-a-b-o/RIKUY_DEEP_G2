import copy

import pytest
from ml.quality_gate import evaluate_quality_gate, require_quality_gate


def evidence():
    rows = [{"id": f"sample-{i}", "label": int(i >= 78)} for i in range(195)]
    predictions = [
        {"id": row["id"], "python": 0.9 if row["label"] else 0.1, "tfjs": 0.90000001 if row["label"] else 0.10000001}
        for row in rows
    ]
    return rows, predictions


def test_passes_complete_evidence_and_rejects_a_single_reference():
    rows, predictions = evidence()
    report = evaluate_quality_gate(rows, predictions, 0.2437)
    assert report["passed"]
    assert report["tensorflowjs"]["recall"] == 1.0
    assert report["tensorflowjs"]["accuracy"] == 1.0
    assert not evaluate_quality_gate(rows[:1], predictions[:1], 0.2437)["passed"]


@pytest.mark.parametrize(
    "field,value", [("python", float("nan")), ("tfjs", float("inf")), ("tfjs", -0.1), ("tfjs", None)]
)
def test_rejects_invalid_probabilities(field, value):
    rows, predictions = evidence()
    predictions[0][field] = value
    assert not evaluate_quality_gate(rows, predictions, 0.5)["passed"]


def test_missing_duplicate_extra_and_single_class_samples_block():
    rows, predictions = evidence()
    for modified in (predictions[:-1], predictions + predictions[:1], predictions[:-1] + predictions[:1]):
        assert not evaluate_quality_gate(rows, modified, 0.5)["passed"]
    assert not evaluate_quality_gate([{**r, "label": 0} for r in rows], predictions, 0.5)["passed"]


def test_more_than_two_decision_discrepancies_fail_even_with_tiny_probability_error():
    rows, predictions = evidence()
    for prediction in predictions[:3]:
        prediction.update(python=0.499999, tfjs=0.500001)
    report = evaluate_quality_gate(rows, predictions, 0.5)
    assert report["classification_discrepancies"] == 3
    assert not report["passed"]


def test_two_near_threshold_discrepancies_are_allowed_if_metrics_pass():
    rows, predictions = evidence()
    for prediction in predictions[:2]:
        prediction.update(python=0.499999, tfjs=0.500001)
    assert evaluate_quality_gate(rows, predictions, 0.5)["passed"]


def test_metrics_fail_when_both_backends_agree_on_bad_predictions():
    rows, predictions = evidence()
    for prediction in predictions:
        prediction.update(python=0.1, tfjs=0.1)
    report = evaluate_quality_gate(rows, predictions, 0.5)
    assert report["classification_discrepancies"] == 0
    assert not report["passed"]


def test_numerical_difference_fails_even_without_classification_change():
    rows, predictions = evidence()
    predictions[0]["tfjs"] = 0.2
    report = evaluate_quality_gate(rows, predictions, 0.5)
    assert report["classification_discrepancies"] == 0
    assert not report["passed"]


def test_publication_guard_recomputes_evidence_and_binds_artifacts():
    rows, predictions = evidence()
    report = evaluate_quality_gate(rows, predictions, 0.5)
    report.update(model_sha256="model-hash", golden_sha256="golden-hash")
    require_quality_gate(report, "model-hash", "golden-hash", rows)
    for model, golden in (("modified", "golden-hash"), ("model-hash", "modified")):
        with pytest.raises(RuntimeError, match="cambió"):
            require_quality_gate(report, model, golden, rows)
    tampered = copy.deepcopy(report)
    tampered["predictions"][0]["tfjs"] = float("nan")
    with pytest.raises(RuntimeError):
        require_quality_gate(tampered, "model-hash", "golden-hash", rows)
    tampered["passed"] = False
    with pytest.raises(RuntimeError):
        require_quality_gate(tampered, "model-hash", "golden-hash", rows)
