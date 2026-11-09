import { describe, expect, it } from "vitest";
import { DEFAULT_STATION_CONFIG, parseStationConfig } from "./config";
import {
  averageFrames,
  createDetector,
  frameDifference,
  piecesPerMinute,
  suggestThresholds,
  toGrayscale,
  WARNING_DOUBTFUL_COUNT,
  WARNING_MOTION,
  type FrameStats,
} from "./detector";

const config = DEFAULT_STATION_CONFIG;

/** Escena simulada: cada letra es un fotograma a 10 fps. */
const SCENES = {
  e: { presence: 0.01, motion: 0.005 }, // cinta vacía
  m: { presence: 0.3, motion: 0.2 }, // pieza moviéndose
  q: { presence: 0.3, motion: 0.005 }, // pieza quieta
};

function run(script: string, change: (i: number) => number = () => 0) {
  const detector = createDetector(config);
  const events: { frame: number; warnings: string[] }[] = [];
  [...script].forEach((ch, i) => {
    const frame: FrameStats = { ...SCENES[ch as keyof typeof SCENES], change: change(i), at: i * 100 };
    const event = detector.step(frame);
    if (event) events.push({ frame: i, warnings: event.warnings });
  });
  return { events, phase: detector.phase };
}

describe("detector de piezas (HU44-T02)", () => {
  it("inspecciona una pieza una sola vez: llega, se detiene 3 fotogramas y sale", () => {
    const { events, phase } = run("eeemmmqqqqqqqqmmmeee");
    expect(events).toEqual([{ frame: 8, warnings: [] }]);
    expect(phase).toBe("EMPTY");
  });

  it("no vuelve a inspeccionar mientras la pieza sigue en el encuadre", () => {
    expect(run("emqqq" + "q".repeat(100)).events).toHaveLength(1);
  });

  it("una pieza que solo se tocó (cambio pequeño) no se cuenta dos veces", () => {
    expect(run("emqqqqmqqqqqeee", () => 0.03).events).toHaveLength(1);
  });

  it("dos piezas separadas por cinta vacía son dos inspecciones", () => {
    const { events } = run("emqqqmeee" + "emqqqmeee");
    expect(events.map((e) => e.frame)).toEqual([4, 13]);
  });

  it("si la pieza no se detiene en maxWaitMs, se inspecciona con aviso de movimiento", () => {
    const { events } = run("e" + "m".repeat(30));
    expect(events).toEqual([{ frame: 21, warnings: [WARNING_MOTION] }]);
  });

  it("una pieza nueva sin que la escena se vacíe se registra con aviso de conteo dudoso", () => {
    // Tras la primera inspección, la escena cambia mucho respecto de la pieza inspeccionada.
    const { events } = run("emqqqmmqqqeee", (i) => (i > 5 ? 0.4 : 0));
    expect(events).toEqual([
      { frame: 4, warnings: [] },
      { frame: 9, warnings: [WARNING_DOUBTFUL_COUNT] },
    ]);
  });

  it("un destello que no llega a quedarse quieto vuelve a vacía sin inspeccionar", () => {
    expect(run("eemmeeeee").events).toHaveLength(0);
  });

  it("hasta 1 pieza por segundo con el presupuesto del documento (≈ 650 ms por pieza)", () => {
    // 10 fotogramas por pieza = 1 s: llega, queda quieta y sale.
    const piece = "mqqqqmeeee";
    expect(run(piece.repeat(60)).events).toHaveLength(60);
  });
});

describe("medidas de fotogramas", () => {
  it("toGrayscale usa la luminancia", () => {
    const gray = toGrayscale(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]));
    expect([...gray]).toEqual([255, 0, 76]);
  });

  it("frameDifference va de 0 (iguales) a 1 (opuestos)", () => {
    const black = new Uint8Array(16);
    const white = new Uint8Array(16).fill(255);
    expect(frameDifference(black, black)).toBe(0);
    expect(frameDifference(black, white)).toBe(1);
    expect(() => frameDifference(black, new Uint8Array(4))).toThrow(RangeError);
  });

  it("averageFrames promedia el fondo", () => {
    expect([...averageFrames([new Uint8Array([0, 100]), new Uint8Array([10, 200])])]).toEqual([5, 150]);
  });

  it("suggestThresholds parte del ruido y respeta los mínimos", () => {
    expect(suggestThresholds({ presence: 0, motion: 0 })).toEqual({ presenceThreshold: 0.06, motionThreshold: 0.01 });
    expect(suggestThresholds({ presence: 0.04, motion: 0.015 })).toEqual({ presenceThreshold: 0.12, motionThreshold: 0.03 });
  });

  it("piecesPerMinute cuenta solo el último minuto", () => {
    expect(piecesPerMinute([0, 30_000, 50_000, 61_000], 70_000)).toBe(3);
  });
});

describe("configuración de la estación (HU44-T04)", () => {
  it("sin configuración usa los valores del documento", () => {
    expect(parseStationConfig({})).toEqual(DEFAULT_STATION_CONFIG);
    expect(parseStationConfig(null)).toEqual(DEFAULT_STATION_CONFIG);
  });

  it("reemplaza solo los campos no válidos", () => {
    expect(parseStationConfig({ presenceThreshold: 0.2, stableFrames: 0, okPhotoEvery: "x" })).toEqual({
      ...DEFAULT_STATION_CONFIG,
      presenceThreshold: 0.2,
    });
  });
});
