"""Preprocesamiento compartido HU06 para fundición.
Entrada: imagen decodificada RGB. Resize bilinear a 400x400. RGB float32 en [0,1].
TensorFlow.js: tf.image.resizeBilinear(rgb, [400, 400]).div(255).
Augmentation solo se activa con training=True en el conjunto train.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageOps

TARGET_SIZE = (400, 400)


def preprocess_image(image):
    """Acepta ruta, PIL.Image o ndarray RGB; retorna float32 (400,400,3) en [0,1]."""
    if isinstance(image, (str, Path)):
        image = Image.open(image)
    elif isinstance(image, np.ndarray):
        image = Image.fromarray(np.asarray(image, dtype=np.uint8))
    image = image.convert("RGB").resize(TARGET_SIZE, Image.Resampling.BILINEAR)
    return np.asarray(image, dtype=np.float32) / 255.0


def augment_training_image(image, seed=None):
    """Rotacion, flip horizontal y brillo; llamar solo con ejemplos de train."""
    if isinstance(image, (str, Path)):
        image = Image.open(image)
    image = image.convert("RGB")
    rng = np.random.default_rng(seed)
    if rng.random() < 0.5:
        image = ImageOps.mirror(image)
    image = image.rotate(
        float(rng.uniform(-12.0, 12.0)), resample=Image.Resampling.BILINEAR, expand=False, fillcolor=(0, 0, 0)
    )
    return ImageEnhance.Brightness(image).enhance(float(rng.uniform(0.85, 1.15)))


def make_tf_dataset(paths, labels, training=False, batch_size=32, seed=42):
    """Dataset tf.data; flip/rotacion/brillo ocurren unicamente si training=True."""
    import tensorflow as tf

    paths = [str(p) for p in paths]
    labels = np.asarray(labels, dtype=np.int32)
    ds = tf.data.Dataset.from_tensor_slices((paths, labels))
    if training:
        ds = ds.shuffle(len(paths), seed=seed, reshuffle_each_iteration=True)
    rotation = tf.keras.layers.RandomRotation(0.04, fill_mode="reflect", seed=seed)

    def decode(path, label):
        image = tf.io.decode_image(tf.io.read_file(path), channels=3, expand_animations=False)
        image.set_shape([None, None, 3])
        image = tf.image.resize(image, TARGET_SIZE, method="bilinear")
        image = tf.cast(image, tf.float32) / 255.0
        if training:
            image = tf.image.random_flip_left_right(image, seed=seed)
            image = rotation(image, training=True)
            image = tf.image.random_brightness(image, max_delta=0.15, seed=seed)
            image = tf.clip_by_value(image, 0.0, 1.0)
        return image, label

    return ds.map(decode, num_parallel_calls=tf.data.AUTOTUNE).batch(batch_size).prefetch(tf.data.AUTOTUNE)
