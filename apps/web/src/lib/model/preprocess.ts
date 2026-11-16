/**
 * Preprocesamiento de la web, equivalente a ml/preprocessing.py (RIKDP-156).
 * Detalle: docs/arquitectura/inferencia-navegador.md, «Preprocesamiento».
 */
import type * as TensorFlow from "@tensorflow/tfjs-core";

export type SquareCrop = { sx: number; sy: number; size: number };

/**
 * Recorte cuadrado centrado. El dataset de entrenamiento es cuadrado; un
 * fotograma 16:9 de la cámara se recorta por los lados en vez de deformarse.
 */
export function centerSquareCrop(width: number, height: number): SquareCrop {
  if (!(width > 0) || !(height > 0)) throw new RangeError(`Tamaño de imagen inválido: ${width}×${height}`);
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

export type PixelSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

/** Float32 en cada operación: el kernel CPU resizeBilinear de TF.js usa
 * coordenadas JavaScript double y difiere de TensorFlow en bordes finos.
 * Invocar dentro de tf.tidy para liberar los tensores intermedios.
 */
export function resizeModelPixels(
  tf: typeof TensorFlow,
  pixels: TensorFlow.Tensor3D,
  input: { width: number; height: number },
): TensorFlow.Tensor3D {
  const [height, width] = pixels.shape;
  const coordinates = (length: number, target: number) => {
    const positions = tf.maximum(
      tf.sub(tf.mul(tf.add(tf.range(0, target, 1, "float32"), 0.5), Math.fround(length / target)), 0.5),
      0,
    );
    const lower = tf.cast(tf.floor(positions), "int32");
    const upper = tf.cast(tf.minimum(tf.add(lower, 1), length - 1), "int32");
    const fraction = tf.sub(positions, tf.cast(lower, "float32"));
    return { lower, upper, fraction };
  };
  const x = coordinates(width, input.width);
  const y = coordinates(height, input.height);
  const rowsTop = tf.gather(pixels, y.lower, 0);
  const rowsBottom = tf.gather(pixels, y.upper, 0);
  const topLeft = tf.gather(rowsTop, x.lower, 1);
  const topRight = tf.gather(rowsTop, x.upper, 1);
  const bottomLeft = tf.gather(rowsBottom, x.lower, 1);
  const bottomRight = tf.gather(rowsBottom, x.upper, 1);
  const fx = tf.reshape(x.fraction, [1, input.width, 1]);
  const fy = tf.reshape(y.fraction, [input.height, 1, 1]);
  const top = tf.add(topLeft, tf.mul(tf.sub(topRight, topLeft), fx));
  const bottom = tf.add(bottomLeft, tf.mul(tf.sub(bottomRight, bottomLeft), fx));
  return tf.add(top, tf.mul(tf.sub(bottom, top), fy)) as TensorFlow.Tensor3D;
}

export function sourceSize(source: PixelSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/**
 * Conserva los píxeles del recorte nativo. El loader redimensiona en float32
 * con bilinear half-pixel, igual que el TensorFlow usado al entrenar.
 */
export function drawModelInput(
  source: PixelSource,
  target: HTMLCanvasElement,
  input: { width: number; height: number },
): SquareCrop {
  const { width, height } = sourceSize(source);
  const crop = centerSquareCrop(width, height);
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1) {
    throw new RangeError("Dimensiones de entrada del modelo inválidas.");
  }
  target.width = crop.size;
  target.height = crop.size;
  const context = target.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("El navegador no permite dibujar en un canvas 2D.");
  context.imageSmoothingEnabled = false;
  context.drawImage(source, crop.sx, crop.sy, crop.size, crop.size, 0, 0, crop.size, crop.size);
  return crop;
}
