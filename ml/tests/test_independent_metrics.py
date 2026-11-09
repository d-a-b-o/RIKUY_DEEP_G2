import numpy as np
import pytest
from ml.independent_metrics import evaluate_predictions


def samples():
    rows = [{"path": str(i), "label": int(i >= 78), "split": "test"} for i in range(195)]
    return rows, np.array([0.9 if r["label"] else 0.1 for r in rows])


def test_held_out_metrics_and_wrong_predictions_are_distinguished():
    rows, probabilities = samples()
    report = evaluate_predictions(rows, probabilities, 0.5)
    assert report["passed"] and report["metrics"]["confusion_matrix_0_ok_1_defect"] == [[78, 0], [0, 117]]
    assert not evaluate_predictions(rows, np.zeros(195), 0.5)["passed"]


@pytest.mark.parametrize("fault", ["train", "duplicate", "missing", "nan", "range"])
def test_incomplete_or_non_test_evidence_is_rejected(fault):
    rows, probabilities = samples()
    if fault == "train":
        rows[0]["split"] = "train"
    elif fault == "duplicate":
        rows[0]["path"] = rows[1]["path"]
    elif fault == "missing":
        probabilities = probabilities[:-1]
    else:
        probabilities[0] = float("nan") if fault == "nan" else 2
    with pytest.raises(ValueError):
        evaluate_predictions(rows, probabilities, 0.5)
