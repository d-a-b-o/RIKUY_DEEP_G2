import { beforeAll, describe, expect, it, vi } from "vitest";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import { centerSquareCrop, drawModelInput, resizeModelPixels } from "./preprocess";

beforeAll(async () => {
  await tf.setBackend("cpu");
  await tf.ready();
});

it("conserva el recorte nativo sin resize ni cuantización del canvas", () => {
  const context = { imageSmoothingEnabled: true, drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  const source = { width: 1280, height: 720 } as HTMLCanvasElement;
  drawModelInput(source, canvas, { width: 400, height: 400 });
  expect([canvas.width, canvas.height]).toEqual([720, 720]);
  expect(context.imageSmoothingEnabled).toBe(false);
  expect(context.drawImage).toHaveBeenCalledWith(source, 280, 0, 720, 720, 0, 0, 720, 720);
});

it("half-pixel interpola en float32 y libera sus intermedios", () => {
  const baseline = tf.memory().numTensors;
  for (let iteration = 0; iteration < 3; iteration++) {
    const output = tf.tidy(() => resizeModelPixels(tf, tf.tensor3d([0, 255, 255, 0], [2, 2, 1]), {
      width: 4, height: 4,
    }));
    expect(output.shape).toEqual([4, 4, 1]);
    expect(Array.from(output.dataSync())).toEqual([
      0, 63.75, 191.25, 255,
      63.75, 95.625, 159.375, 191.25,
      191.25, 159.375, 95.625, 63.75,
      255, 191.25, 63.75, 0,
    ]);
    output.dispose();
    expect(tf.memory().numTensors).toBe(baseline);
  }
});

describe("centerSquareCrop", () => {
  it("deja igual una imagen cuadrada", () => {
    expect(centerSquareCrop(300, 300)).toEqual({ sx: 0, sy: 0, size: 300 });
  });

  it("recorta por los lados un fotograma apaisado de la cámara", () => {
    expect(centerSquareCrop(1280, 720)).toEqual({ sx: 280, sy: 0, size: 720 });
  });

  it("recorta arriba y abajo una foto vertical del celular", () => {
    expect(centerSquareCrop(1080, 1920)).toEqual({ sx: 0, sy: 420, size: 1080 });
  });

  it("rechaza tamaños vacíos, por ejemplo un video que aún no carga", () => {
    expect(() => centerSquareCrop(0, 720)).toThrow(RangeError);
  });
});
