import numpy as np
import pytest
from ml.capture_evaluation import capture_tensor, compare_metrics, prepare, validate_capture_manifest
from ml.workflow import file_hash, read_json, write_json
from PIL import Image, PngImagePlugin


@pytest.fixture
def captures(tmp_path):
    # Fixtures sintéticos de contrato: nunca son evidencia de capturas reales.
    for label, name in enumerate(("ok_front", "def_front")):
        (tmp_path / name).mkdir()
        for index in range(50):
            Image.new("RGB", (8, 8), (label * 120, index * 4, 30)).save(tmp_path / name / f"{index}.png")
    return tmp_path


def test_manifest_requires_human_labelled_unique_images(captures):
    path = prepare(captures, "unit fixture, not a physical camera")
    assert len(validate_capture_manifest(path)["rows"]) == 100
    with pytest.raises(ValueError, match="ya existe"):
        prepare(captures, "unit fixture")


@pytest.mark.parametrize("fault", ["count", "class", "duplicate", "reencoded", "hash", "path"])
def test_invalid_capture_inventory_does_not_count_as_evidence(captures, fault):
    path = prepare(captures, "unit fixture")
    value = read_json(path)
    if fault == "count":
        value["rows"].pop()
    elif fault == "class":
        for row in value["rows"]:
            row["label"] = 0
    elif fault == "duplicate":
        value["rows"][0] = value["rows"][1].copy()
    elif fault == "reencoded":
        first, second = value["rows"][:2]
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("note", "same pixels, different file bytes")
        with Image.open(captures / first["path"]) as image:
            image.save(captures / second["path"], pnginfo=metadata)
        second.update(sha256=file_hash(captures / second["path"]), pixel_sha256=first["pixel_sha256"])
        assert second["sha256"] != first["sha256"]
    elif fault == "hash":
        value["rows"][0]["sha256"] = "changed"
    else:
        value["rows"][0]["path"] = "../outside.png"
    write_json(path, value)
    with pytest.raises(ValueError):
        validate_capture_manifest(path)


def test_incomplete_prepare_does_not_leave_a_final_manifest(tmp_path):
    with pytest.raises(ValueError, match=">=100"):
        prepare(tmp_path, "unit fixture")
    assert not (tmp_path / "manifest.json").exists()
    assert not (tmp_path / "manifest.pending.json").exists()


def test_capture_crop_matches_center_square_before_resize(tmp_path):
    pixels = np.zeros((4, 8, 3), dtype=np.uint8)
    pixels[:, 2:6] = [255, 0, 51]
    image = tmp_path / "capture.png"
    Image.fromarray(pixels).save(image)
    tensor = capture_tensor(image)
    assert tensor.shape == (1, 400, 400, 3)
    np.testing.assert_allclose(tensor, np.broadcast_to([1, 0, 0.2], tensor.shape), rtol=0, atol=1e-6)


def test_metric_drop_is_reported_without_hiding_an_improvement():
    result = compare_metrics({"accuracy": 0.98, "recall": 0.95}, {"accuracy": 0.90, "recall": 0.97})
    assert result["accuracy_drop_percentage_points"] == pytest.approx(8)
    assert result["recall_drop_percentage_points"] == pytest.approx(-2)
