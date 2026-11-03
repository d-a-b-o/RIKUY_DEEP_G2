import { describe, expect, it } from "vitest";
import { presignUrl } from "./sigv4";

describe("presignUrl (AWS Signature V4 en query)", () => {
  // Ejemplo oficial de AWS: "Authenticating Requests: Using Query Parameters".
  it("reproduce la firma del ejemplo de la documentación de AWS", () => {
    const url = presignUrl({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      credentials: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
      region: "us-east-1",
      expiresIn: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });

    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  const base = {
    url: "https://cuenta.r2.cloudflarestorage.com/imagenes/companies/c1/inspections/2026/11/a.jpg",
    credentials: { accessKeyId: "id", secretAccessKey: "secreto" },
    region: "auto",
    expiresIn: 300,
    now: new Date("2026-11-02T12:00:00Z"),
  };

  it("el método forma parte de la firma", () => {
    const put = presignUrl({ ...base, method: "PUT" });
    const get = presignUrl({ ...base, method: "GET" });
    expect(put).not.toBe(get);
    expect(put.split("?")[0]).toBe(get.split("?")[0]);
  });

  it("incluye el alcance de R2 (región auto) y la caducidad", () => {
    const url = new URL(presignUrl({ ...base, method: "GET" }));
    expect(url.searchParams.get("X-Amz-Credential")).toBe("id/20261102/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("rechaza caducidades fuera de rango y URLs con query", () => {
    expect(() => presignUrl({ ...base, method: "GET", expiresIn: 0 })).toThrow(RangeError);
    expect(() => presignUrl({ ...base, method: "GET", expiresIn: 8 * 24 * 3600 })).toThrow(RangeError);
    expect(() => presignUrl({ ...base, method: "GET", url: `${base.url}?x=1` })).toThrow();
  });
});
