import numpy as np
import pytest
from ml.preprocessing import TARGET_SIZE, augment_training_image, preprocess_image
from PIL import Image


def _sample_image(size=(640, 480), color=(200, 100, 50)):
    return Image.new("RGB", size, color)


def _assert_model_input(array):
    assert array.shape == (*TARGET_SIZE, 3)
    assert array.dtype == np.float32
    assert array.min() >= 0.0
    assert array.max() <= 1.0


def test_preprocess_pil_image():
    _assert_model_input(preprocess_image(_sample_image()))


def test_preprocess_ndarray():
    array = np.asarray(_sample_image(), dtype=np.uint8)
    _assert_model_input(preprocess_image(array))


@pytest.mark.parametrize("as_str", [True, False])
def test_preprocess_path(tmp_path, as_str):
    path = tmp_path / "pieza.png"
    _sample_image().save(path)
    _assert_model_input(preprocess_image(str(path) if as_str else path))


def test_preprocess_converts_grayscale_to_rgb():
    _assert_model_input(preprocess_image(Image.new("L", (100, 100), 128)))


def test_preprocess_scales_pixel_values():
    result = preprocess_image(_sample_image(color=(255, 0, 51)))
    np.testing.assert_allclose(result[0, 0], [1.0, 0.0, 0.2], atol=1e-6)


def test_augment_is_deterministic_with_seed():
    image = _sample_image()
    first = np.asarray(augment_training_image(image, seed=7))
    second = np.asarray(augment_training_image(image, seed=7))
    np.testing.assert_array_equal(first, second)


def test_augment_keeps_size_and_mode():
    image = _sample_image(size=(320, 240))
    augmented = augment_training_image(image, seed=1)
    assert augmented.size == image.size
    assert augmented.mode == "RGB"
