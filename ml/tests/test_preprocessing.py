import numpy as np
import pytest
from ml.preprocessing import TARGET_SIZE, augment_training_image, preprocess_image, preprocess_regression_image
from PIL import Image


def _sample_image(size=(640, 480), color=(200, 100, 50)):
    return Image.new("RGB", size, color)


def _assert_model_input(array):
    assert array.shape == (400, 400, 3)
    assert array.dtype == np.float32
    assert np.isfinite(array).all()
    assert array.min() >= 0.0
    assert array.max() <= 1.0


def test_model_input_size_contract():
    assert TARGET_SIZE == (400, 400)


@pytest.mark.parametrize("size", [128, 400, 512])
def test_square_images_preserve_rgb_and_normalization(size):
    image = _sample_image(size=(size, size), color=(255, 0, 51))
    result = preprocess_image(image)
    _assert_model_input(result)
    np.testing.assert_allclose(result, np.broadcast_to([1.0, 0.0, 0.2], result.shape), atol=1e-6)


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


def test_historical_regression_keeps_pil_v1_pixels():
    pixels = np.random.default_rng(85).integers(0, 256, (512, 512, 3), dtype=np.uint8)
    image = Image.fromarray(pixels)
    expected = np.asarray(image.resize(TARGET_SIZE, Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
    np.testing.assert_array_equal(preprocess_regression_image(image), expected)
    assert np.max(np.abs(preprocess_image(image) - expected)) > 1e-3
