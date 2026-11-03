"""RIKDP-84: actual TensorFlow input pipeline, without fitting a model.

Lightweight ML CI may skip these tests when TensorFlow is not installed.
The real-model workflow sets PT1_REQUIRE_TENSORFLOW=1 so a missing/broken
TensorFlow installation fails rather than silently skipping the contract.
"""

import os

import numpy as np
import pytest
from ml.preprocessing import make_tf_dataset
from PIL import Image


@pytest.fixture(scope="module")
def tf():
    if os.environ.get("PT1_REQUIRE_TENSORFLOW") == "1":
        import tensorflow
    else:
        tensorflow = pytest.importorskip("tensorflow", reason="TensorFlow se verifica en HU22 real model gate")
    return tensorflow


def assert_batch(images, labels, count, tf):
    assert tuple(images.shape) == (count, 400, 400, 3)
    assert images.dtype == tf.float32
    array = images.numpy()
    assert np.isfinite(array).all()
    assert array.min() >= 0.0
    assert array.max() <= 1.0
    assert tuple(labels.shape) == (count,)
    assert labels.dtype == tf.int32


@pytest.mark.parametrize("size", [128, 400, 512])
def test_square_rgb_input_contract(tmp_path, tf, size):
    path = tmp_path / "square.png"
    Image.new("RGB", (size, size), (255, 0, 51)).save(path)
    dataset = make_tf_dataset([path], [1], training=False, batch_size=1)
    images, labels = next(iter(dataset))
    assert_batch(images, labels, 1, tf)
    np.testing.assert_allclose(images.numpy(), np.broadcast_to([1.0, 0.0, 0.2], images.shape), atol=1e-6)
    np.testing.assert_array_equal(labels.numpy(), [1])


@pytest.mark.parametrize("mode", ["L", "RGBA"])
def test_decoding_produces_three_rgb_channels(tmp_path, tf, mode):
    path = tmp_path / "channels.png"
    color = 128 if mode == "L" else (255, 0, 51, 255)
    Image.new(mode, (512, 512), color).save(path)
    images, labels = next(iter(make_tf_dataset([path], [0], training=False)))
    assert_batch(images, labels, 1, tf)
    expected = [128 / 255] * 3 if mode == "L" else [1.0, 0.0, 0.2]
    np.testing.assert_allclose(images.numpy(), np.broadcast_to(expected, images.shape), atol=1e-6)


def test_batches_keep_order_labels_and_pixel_extremes_without_augmentation(tmp_path, tf):
    paths = []
    for index, color in enumerate([(0, 0, 0), (255, 255, 255), (255, 0, 51)]):
        path = tmp_path / f"sample-{index}.png"
        Image.new("RGB", (512, 512), color).save(path)
        paths.append(path)
    dataset = make_tf_dataset(paths, [0, 1, 0], training=False, batch_size=2)
    batches = list(dataset)
    assert len(batches) == 2
    assert_batch(*batches[0], 2, tf)
    assert_batch(*batches[1], 1, tf)
    np.testing.assert_array_equal(batches[0][1].numpy(), [0, 1])
    np.testing.assert_array_equal(batches[1][1].numpy(), [0])
    np.testing.assert_array_equal(batches[0][0][0].numpy(), 0.0)
    np.testing.assert_array_equal(batches[0][0][1].numpy(), 1.0)
    for (images, labels), (again, labels_again) in zip(batches, dataset, strict=True):
        np.testing.assert_array_equal(images.numpy(), again.numpy())
        np.testing.assert_array_equal(labels.numpy(), labels_again.numpy())


def test_augmented_training_inputs_stay_in_contract(tmp_path, tf):
    path = tmp_path / "training.png"
    pixels = np.zeros((512, 512, 3), dtype=np.uint8)
    pixels[:, 256:] = 255
    Image.fromarray(pixels).save(path)
    images, labels = next(iter(make_tf_dataset([path], [1], training=True, batch_size=1, seed=84)))
    assert_batch(images, labels, 1, tf)
    np.testing.assert_array_equal(labels.numpy(), [1])
