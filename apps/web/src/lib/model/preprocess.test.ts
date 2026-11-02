import { describe, expect, it } from "vitest";
import { centerSquareCrop } from "./preprocess";

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
