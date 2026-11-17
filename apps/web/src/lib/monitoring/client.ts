import type { TelemetryEvent } from "./schema";

// Best effort, memory only: telemetry must never delay or fail an inspection.
type EventInput = TelemetryEvent extends infer T ? T extends TelemetryEvent ? Omit<T, "id"> : never : never;
export function createTelemetryReporter(transport: (events: TelemetryEvent[]) => Promise<boolean>) {
  let queue: TelemetryEvent[] = [];
  let sending = false;
  let stoppedUntil = 0;
  return {
    record(event: EventInput) {
      queue.push({ ...event, id: crypto.randomUUID() } as TelemetryEvent);
      if (queue.length > 200) queue.splice(0, queue.length - 200);
    },
    async flush() {
      if (sending || !queue.length || Date.now() < stoppedUntil) return;
      sending = true;
      const batch = queue.splice(0, 50);
      try {
        if (!await transport(batch)) throw new Error("unavailable");
      } catch {
        // IDs allow safe retries after a lost server acknowledgement.
        queue = [...batch, ...queue].slice(-200);
        stoppedUntil = Date.now() + 60_000;
      } finally {
        sending = false;
      }
    },
    drain() { return queue.splice(0, 50); },
  };
}

let reporter: ReturnType<typeof createTelemetryReporter> | undefined;
export function recordModelTelemetry(event: EventInput): void {
  if (typeof window === "undefined") return;
  try {
    if (!reporter) {
      reporter = createTelemetryReporter(async (events) => {
        const response = await fetch("/api/telemetry/model", {
          method: "POST", credentials: "same-origin", keepalive: true,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ events }),
          signal: AbortSignal.timeout(5000),
        });
        // Invalid data or an ended session must not cause perpetual retries.
        return response.ok || [400, 401, 403, 413].includes(response.status);
      });
      window.setInterval(() => { void reporter?.flush(); }, 15_000);
      window.addEventListener("pagehide", () => {
        const events = reporter?.drain() ?? [];
        if (events.length) navigator.sendBeacon?.("/api/telemetry/model",
          new Blob([JSON.stringify({ events })], { type: "application/json" }));
      });
    }
    reporter.record(event);
    if (event.type === "LOAD_ERROR") void reporter.flush();
  } catch {
    // Browser privacy controls may disable storage/network/UUID APIs.
  }
}
