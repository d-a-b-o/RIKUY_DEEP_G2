"""RIKDP-85: report policy; real browser execution is a separate workflow job."""

import json
from unittest.mock import patch

import numpy as np
import pytest
from ml.preprocessing_parity import ATOL, compare_tensors, run, square_fixtures
from PIL import Image


def tensor():
    return np.zeros((1, 400, 400, 3), dtype=np.float32)


def test_identical_and_float32_rounding_pass():
    assert compare_tensors(tensor(), tensor())["passed"]
    rounded = tensor()
    rounded[0, 0, 0, 0] = ATOL / 2
    assert compare_tensors(tensor(), rounded)["passed"]


def test_one_channel_over_tolerance_is_not_hidden_by_average():
    different = tensor()
    different[0, 0, 0, 0] = 1 / 255
    report = compare_tensors(tensor(), different)
    assert not report["passed"]
    assert report["channels_over_tolerance"] == 1


@pytest.mark.parametrize("fault", ["shape", "dtype", "nan", "range"])
def test_invalid_tensors_fail(fault):
    actual = tensor()
    if fault == "shape":
        actual = actual[0]
    elif fault == "dtype":
        actual = actual.astype(np.float64)
    else:
        actual[0, 0, 0, 0] = float("nan") if fault == "nan" else 2
    with pytest.raises(ValueError):
        compare_tensors(tensor(), actual)


def test_fixtures_include_square_nonuniform_resize_cases(tmp_path):
    paths = square_fixtures(tmp_path)
    assert len(paths) == 6
    for path in paths:
        with Image.open(path) as image:
            assert image.width == image.height
            assert image.width in (400, 512)
            assert image.mode == "RGB"
            if "edges" in path.name:
                assert np.asarray(image).min() == 0
                assert np.asarray(image).max() == 255


@pytest.mark.parametrize("passed,expected", [(True, 0), (False, 1)])
def test_cli_exit_matches_real_report(tmp_path, passed, expected):
    with patch("ml.preprocessing_parity.measure", return_value={"status": "completed", "passed": passed}):
        assert run(tmp_path, tmp_path / "report") == expected
    assert json.loads((tmp_path / "report/RIKDP-85.json").read_text())["passed"] == passed


def test_missing_runtime_is_incomplete_not_a_pass(tmp_path):
    with patch("ml.preprocessing_parity.measure", side_effect=RuntimeError("missing browser")):
        assert run(tmp_path, tmp_path / "report") == 2
    assert json.loads((tmp_path / "report/RIKDP-85.json").read_text())["status"] == "incomplete"
