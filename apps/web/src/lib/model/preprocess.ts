/**
 * Preprocesamiento de la web, equivalente a ml/preprocessing.py (RIKDP-156).
 * Detalle: docs/arquitectura/inferencia-navegador.md, «Preprocesamiento».
 */

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
 * Dibuja el recorte centrado en un canvas del tamaño de entrada del modelo.
 * Se usa el canvas con suavizado alto y no tf.image.resizeBilinear porque al
 * reducir (p. ej. 1280×720 → 400×400) el bilineal de TF.js no suaviza y PIL sí.
 */
export function drawModelInput(
  source: PixelSource,
  target: HTMLCanvasElement,
  input: { width: number; height: number },
): SquareCrop {
  const { width, height } = sourceSize(source);
  const crop = centerSquareCrop(width, height);
  target.width = input.width;
  target.height = input.height;
  const context = target.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("El navegador no permite dibujar en un canvas 2D.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, crop.sx, crop.sy, crop.size, crop.size, 0, 0, input.width, input.height);
  return crop;
}
