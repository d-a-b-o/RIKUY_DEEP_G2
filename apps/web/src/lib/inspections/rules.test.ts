import { describe, expect, it } from "vitest";
import {
  canCorrect,
  canReadTrace,
  canRecord,
  DEFAULT_OK_PHOTO_EVERY,
  findActiveShift,
  isImageRequired,
  isShiftActiveAt,
  localMinuteOfDay,
  okPhotoEveryFromConfig,
  shouldKeepOkPhoto,
} from "./rules";

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);

describe("quién registra (reglas 8 y 10)", () => {
  it.each([
    ["STATION", "LINE", true],
    ["STATION", "CAMERA", false],
    ["INSPECTOR", "CAMERA", true],
    ["INSPECTOR", "UPLOAD", true],
    ["INSPECTOR", "BATCH", true],
    ["INSPECTOR", "LINE", false],
    ["ADMIN", "UPLOAD", true],
    ["VIEWER", "UPLOAD", false],
    ["SUPERADMIN", "UPLOAD", false],
  ] as const)("%s con origen %s → %s", (role, source, expected) => {
    expect(canRecord(role, source)).toBe(expected);
  });

  it("corrigen el inspector y el admin; consultan además el visualizador", () => {
    expect([canCorrect("INSPECTOR"), canCorrect("ADMIN"), canCorrect("VIEWER"), canCorrect("STATION")]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([canReadTrace("VIEWER"), canReadTrace("STATION"), canReadTrace("SUPERADMIN")]).toEqual([true, false, false]);
  });
});

describe("foto obligatoria (regla 9)", () => {
  it.each([
    ["CAMERA", "OK", true],
    ["UPLOAD", "OK", true],
    ["BATCH", "DEFECTIVE", true],
    ["LINE", "DEFECTIVE", true],
    ["LINE", "OK", false],
  ] as const)("%s %s → obligatoria: %s", (source, verdict, expected) => {
    expect(isImageRequired(source, verdict)).toBe(expected);
  });

  it("la estación guarda 1 de cada N piezas OK", () => {
    const kept = Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => shouldKeepOkPhoto(((n - 1) % 20) + 1, 20));
    expect(kept).toEqual([20, 40, 60]);
    expect(shouldKeepOkPhoto(1, 1)).toBe(true);
    expect(() => shouldKeepOkPhoto(0, 20)).toThrow(RangeError);
  });

  it("lee okPhotoEvery de la configuración de la estación con valor por defecto 20", () => {
    expect(okPhotoEveryFromConfig({ okPhotoEvery: 5 })).toBe(5);
    expect(okPhotoEveryFromConfig({})).toBe(DEFAULT_OK_PHOTO_EVERY);
    expect(okPhotoEveryFromConfig({ okPhotoEvery: 0 })).toBe(DEFAULT_OK_PHOTO_EVERY);
    expect(okPhotoEveryFromConfig(null)).toBe(DEFAULT_OK_PHOTO_EVERY);
  });
});

describe("turno activo (regla 5)", () => {
  const morning = { id: "m", startTime: time("06:00"), endTime: time("14:00") };
  const afternoon = { id: "t", startTime: time("14:00"), endTime: time("22:00") };
  const night = { id: "n", startTime: time("22:00"), endTime: time("06:00") };
  const shifts = [morning, afternoon, night];

  it("el inicio está incluido y el fin excluido", () => {
    expect(isShiftActiveAt(morning, 6 * 60)).toBe(true);
    expect(isShiftActiveAt(morning, 14 * 60)).toBe(false);
    expect(isShiftActiveAt(afternoon, 14 * 60)).toBe(true);
  });

  it("el turno noche cruza la medianoche", () => {
    expect(isShiftActiveAt(night, 23 * 60)).toBe(true);
    expect(isShiftActiveAt(night, 0)).toBe(true);
    expect(isShiftActiveAt(night, 5 * 60 + 59)).toBe(true);
    expect(isShiftActiveAt(night, 6 * 60)).toBe(false);
  });

  it("usa la hora local de la empresa, no la del servidor", () => {
    // 03:30 UTC = 22:30 del día anterior en Lima (UTC−5).
    const instant = new Date("2026-11-03T03:30:00Z");
    expect(localMinuteOfDay(instant, "America/Lima")).toBe(22 * 60 + 30);
    expect(findActiveShift(shifts, instant, "America/Lima")?.id).toBe("n");
    expect(findActiveShift(shifts, instant, "UTC")?.id).toBe("n");
    expect(findActiveShift(shifts, new Date("2026-11-02T15:00:00Z"), "America/Lima")?.id).toBe("m");
  });

  it("responde null si ningún turno cubre la hora", () => {
    expect(findActiveShift([morning], new Date("2026-11-02T23:00:00Z"), "UTC")).toBeNull();
    expect(isShiftActiveAt({ id: "x", startTime: time("08:00"), endTime: time("08:00") }, 8 * 60)).toBe(false);
  });
});
