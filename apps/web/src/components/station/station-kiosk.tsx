"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  refreshStationContext,
  requestStationUploads,
  saveStationCalibration,
  syncStationBatch,
} from "@/app/panel/estacion/actions";
import { Icon } from "@/components/ui/icon";
import { type InspectionModel, loadInspectionModel, modelLoadFailure } from "@/lib/model/loader";
import { drawModelInput } from "@/lib/model/preprocess";
import type { StationConfig } from "@/lib/station/config";
import {
  averageFrames,
  DETECTION_INTERVAL_MS,
  DETECTION_SIZE,
  PHASE_LABELS,
  piecesPerMinute,
  suggestThresholds,
  toGrayscale,
  type Phase,
} from "@/lib/station/detector";
import { measureNoise, StationEngine, type InspectedPiece } from "@/lib/station/engine";
import {
  createIndexedDbQueue,
  createMemoryQueue,
  flushQueue,
  QUEUE_WARNING_SIZE,
  shouldFlush,
  type InspectionQueue,
} from "@/lib/station/queue";
import type { StationContextData } from "@/lib/station/service";

/**
 * Pantalla de la estación automática (HU44, RIKDP-55). La abre la cuenta
 * técnica; un operario pulsa «Iniciar» al empezar el turno y la estación
 * inspecciona sola cada pieza (docs/arquitectura/inferencia-navegador.md).
 */

const AUTOSTART_KEY = "rikuydeep-station-autostart";
const BACKGROUND_KEY = "rikuydeep-station-background";
const CALIBRATION_FRAMES = 20;
const CONTEXT_REFRESH_MS = 60_000;
const SYNC_CHECK_MS = 1_000;
const ALARM_EVERY_MS = 2_000;
const RECOVERY_DELAY_MS = 5_000;
const CAMERA_RETRIES = 6;

type Status =
  | { name: "setup" }
  | { name: "calibrating" }
  | { name: "running" }
  | { name: "problem"; kind: "camera" | "model" | "permission"; message: string };

type Counters = { total: number; ok: number; defective: number };

const percent = (value: number) =>
  new Intl.NumberFormat("es-PE", { style: "percent", maximumFractionDigits: 1 }).format(value);

function storeBackground(frame: Uint8Array) {
  try {
    sessionStorage.setItem(BACKGROUND_KEY, btoa(String.fromCharCode(...frame)));
  } catch {
    /* sin almacenamiento de sesión: se recalibra al recargar */
  }
}

function readBackground(): Uint8Array | null {
  try {
    const raw = sessionStorage.getItem(BACKGROUND_KEY);
    if (!raw) return null;
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    return bytes.length === DETECTION_SIZE * DETECTION_SIZE ? bytes : null;
  } catch {
    return null;
  }
}

function flag(key: string, value?: "1" | null): string | null {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* ignorado */
  }
  return null;
}

/** Recarga la página conservando la cola (está en IndexedDB) y vuelve a arrancar sola. */
function recover() {
  flag(AUTOSTART_KEY, "1");
  window.setTimeout(() => window.location.reload(), RECOVERY_DELAY_MS);
}

export function StationKiosk({ initial, manifestUrl }: { initial: StationContextData; manifestUrl: string }) {
  const [context, setContext] = useState(initial);
  const [model, setModel] = useState<InspectionModel | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ name: "setup" });
  const [phase, setPhase] = useState<Phase>("EMPTY");
  const [counters, setCounters] = useState<Counters>(initial.shiftCounts);
  const [last, setLast] = useState<InspectedPiece | null>(null);
  const [alarm, setAlarm] = useState<InspectedPiece | null>(null);
  const [rate, setRate] = useState(0);
  const [queueInfo, setQueueInfo] = useState({ pending: 0, rejected: 0, offline: false });
  const [tensors, setTensors] = useState<number | null>(null);
  const [suggested, setSuggested] = useState<{ presenceThreshold: number; motionThreshold: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const modelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const smallCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const queueRef = useRef<InspectionQueue | null>(null);
  const engineRef = useRef<StationEngine | null>(null);
  const backgroundRef = useRef<Uint8Array | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const contextRef = useRef(context);
  const configRef = useRef<StationConfig>(initial.config);
  useEffect(() => {
    contextRef.current = context;
    configRef.current = context.config;
  }, [context]);

  // ─── Modelo y cola ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    let owned: InspectionModel | null = null;
    loadInspectionModel(manifestUrl)
      .then((loaded) => {
        if (cancelled) return loaded.dispose();
        owned = loaded;
        setModel(loaded);
      })
      .catch((error: unknown) => !cancelled && setModelError(modelLoadFailure(error).message));
    return () => {
      cancelled = true;
      owned?.dispose();
    };
  }, [manifestUrl]);

  useEffect(() => {
    let cancelled = false;
    (typeof indexedDB === "undefined" ? Promise.reject(new Error("sin IndexedDB")) : createIndexedDbQueue())
      .catch(() => {
        setNotice("Este navegador no guarda la cola en el equipo: si se cierra, se perderán las inspecciones sin enviar.");
        return createMemoryQueue();
      })
      .then((queue) => {
        if (!cancelled) queueRef.current = queue;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Cámara ─────────────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (!navigator.mediaDevices) throw new Error("Este navegador no permite usar la cámara (se necesita HTTPS).");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    streamRef.current = stream;
    const video = videoRef.current!;
    video.srcObject = stream;
    await video.play();
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      setStatus({ name: "problem", kind: "camera", message: "Se desconectó la cámara. Reintentando…" });
    });
  }, []);

  /** Fotograma actual reducido a 64×64 en gris, o null si la cámara no da imagen. */
  const grabFrame = useCallback((): Uint8Array | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
    const canvas = (smallCanvasRef.current ??= Object.assign(document.createElement("canvas"), {
      width: DETECTION_SIZE,
      height: DETECTION_SIZE,
    }));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    // Mismo recorte cuadrado central que ve el modelo.
    const size = Math.min(video.videoWidth, video.videoHeight);
    ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, DETECTION_SIZE, DETECTION_SIZE);
    return toGrayscale(ctx.getImageData(0, 0, DETECTION_SIZE, DETECTION_SIZE).data);
  }, []);

  // ─── Motor ──────────────────────────────────────────────────────────────────

  const buildEngine = useCallback(async () => {
    const ctx = contextRef.current;
    const queue = queueRef.current;
    if (!model || !queue || !ctx.batch || !backgroundRef.current) {
      engineRef.current = null;
      return;
    }
    const queued = await queue.maxPieceNumber(ctx.batch.id);
    const canvas = (modelCanvasRef.current ??= document.createElement("canvas"));
    engineRef.current = new StationEngine({
      config: configRef.current,
      context: {
        batchId: ctx.batch.id,
        modelVersion: model.info.version,
        threshold: model.info.threshold,
        ...(model.info.backend === "webgl" ? { backend: "WEBGL" as const } : model.info.backend === "wasm" ? { backend: "WASM" as const } : {}),
      },
      background: backgroundRef.current,
      queue,
      newId: () => crypto.randomUUID(),
      now: () => new Date(),
      lastPieceNumber: Math.max(ctx.lastPieceNumber, queued),
      async classify() {
        drawModelInput(videoRef.current!, canvas, model.info.input);
        const prediction = await model.predict(canvas);
        return {
          verdict: prediction.verdict,
          confidence: prediction.confidence,
          inferenceMs: prediction.inferenceMs,
          photo: () =>
            new Promise<Blob>((resolve, reject) =>
              canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Sin foto"))), "image/jpeg", 0.85),
            ),
        };
      },
    });
  }, [model]);

  // Se reconstruye cuando cambia el lote asignado o la configuración.
  const batchId = context.batch?.id ?? null;
  const configKey = JSON.stringify(context.config);
  useEffect(() => {
    if (status.name === "running") void buildEngine();
  }, [batchId, configKey, status.name, buildEngine]);

  const canInspect = Boolean(context.batch && context.shift);

  useEffect(() => {
    if (status.name !== "running") return;
    let stopped = false;
    let missing = 0;
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      const frame = grabFrame();
      if (!frame) {
        if (++missing * DETECTION_INTERVAL_MS > 3_000) setStatus({ name: "problem", kind: "camera", message: "La cámara no envía imagen. Reintentando…" });
        return;
      }
      missing = 0;
      if (!engine || !contextRef.current.batch || !contextRef.current.shift) return;
      engine
        .processFrame(frame, performance.now())
        .then((piece) => {
          if (stopped) return;
          setPhase(engine.phase);
          if (!piece) return;
          setLast(piece);
          setCounters((c) => ({
            total: c.total + 1,
            ok: c.ok + (piece.verdict === "OK" ? 1 : 0),
            defective: c.defective + (piece.verdict === "DEFECTIVE" ? 1 : 0),
          }));
          setRate(piecesPerMinute(engine.recent, performance.now()));
          if (piece.verdict === "DEFECTIVE") setAlarm(piece);
          if (model) setTensors(model.tensorCount());
        })
        .catch((error: unknown) => {
          if (stopped) return;
          console.error("[estacion] fallo de inferencia", error);
          // Contexto WebGL perdido u otro fallo del modelo: se recarga sola.
          setStatus({ name: "problem", kind: "model", message: "Se perdió la aceleración gráfica del modelo. La estación se reiniciará sola." });
          recover();
        });
    }, DETECTION_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [status.name, grabFrame, model]);

  // Recuperación de la cámara.
  useEffect(() => {
    if (status.name !== "problem" || status.kind !== "camera") return;
    let attempt = 0;
    let cancelled = false;
    const retry = async () => {
      while (!cancelled && attempt < CAMERA_RETRIES) {
        attempt += 1;
        await new Promise((r) => window.setTimeout(r, RECOVERY_DELAY_MS));
        try {
          await startCamera();
          // Sin calibración previa, el operario vuelve a iniciar con la cinta vacía.
          if (!cancelled) setStatus(backgroundRef.current ? { name: "running" } : { name: "setup" });
          return;
        } catch {
          /* siguiente intento */
        }
      }
      if (!cancelled) recover();
    };
    void retry();
    return () => {
      cancelled = true;
    };
  }, [status, startCamera]);

  // ─── Envío en segundo plano ─────────────────────────────────────────────────

  useEffect(() => {
    let lastFlush = 0;
    let flushing = false;
    const timer = window.setInterval(async () => {
      const queue = queueRef.current;
      if (!queue || flushing) return;
      const pending = await queue.size();
      if (!shouldFlush(pending, lastFlush, Date.now())) {
        setQueueInfo((info) => ({ ...info, pending }));
        return;
      }
      flushing = true;
      lastFlush = Date.now();
      try {
        const result = await flushQueue(queue, {
          requestUploads: (count) => requestStationUploads(count),
          async upload(target, photo) {
            const response = await fetch(target.uploadUrl, { method: "PUT", headers: target.headers, body: photo });
            if (!response.ok) throw new Error(`R2 respondió ${response.status}`);
          },
          save: (items) => syncStationBatch(items),
        });
        setQueueInfo({ pending: await queue.size(), rejected: await queue.rejectedSize(), offline: result.offline });
      } finally {
        flushing = false;
      }
    }, SYNC_CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Lote y turno por el reloj: se consultan cada minuto.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const result = await refreshStationContext();
        if (!result.ok) return;
        setContext((previous) => {
          if (previous.shift?.id !== result.data.shift?.id) setCounters(result.data.shiftCounts);
          return result.data;
        });
      } catch {
        /* sin red: se mantiene el último contexto */
      }
    }, CONTEXT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  // ─── Pantalla encendida y alarma ────────────────────────────────────────────

  useEffect(() => {
    if (status.name === "setup") return;
    const lock = async () => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {
        /* sin wake lock: depende de la configuración del equipo */
      }
    };
    void lock();
    const onVisible = () => document.visibilityState === "visible" && void lock();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void wakeLockRef.current?.release().catch(() => {});
    };
  }, [status.name]);

  const beep = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.state === "suspended") void audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.4);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.4);
  }, []);

  const acknowledge = useCallback(() => setAlarm(null), []);

  useEffect(() => {
    if (!alarm) return;
    beep();
    const timer = window.setInterval(beep, ALARM_EVERY_MS);
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      acknowledge();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [alarm, beep, acknowledge]);

  // ─── Inicio y calibración ───────────────────────────────────────────────────

  const calibrate = useCallback(async () => {
    setStatus({ name: "calibrating" });
    const frames: Uint8Array[] = [];
    for (let i = 0; i < CALIBRATION_FRAMES * 3 && frames.length < CALIBRATION_FRAMES; i += 1) {
      await new Promise((r) => window.setTimeout(r, DETECTION_INTERVAL_MS));
      const frame = grabFrame();
      if (frame) frames.push(frame);
    }
    if (frames.length < CALIBRATION_FRAMES) {
      setStatus({ name: "problem", kind: "camera", message: "La cámara no envía imagen. Reintentando…" });
      return;
    }
    const background = averageFrames(frames);
    backgroundRef.current = background;
    storeBackground(background);
    setSuggested(suggestThresholds(measureNoise(frames, background)));
    setStatus({ name: "running" });
  }, [grabFrame]);

  const start = useCallback(
    async (fromRecovery = false) => {
      setNotice(null);
      if (!fromRecovery) {
        // Gesto del operario: pantalla completa y sonido habilitado.
        await rootRef.current?.requestFullscreen?.().catch(() => {});
      }
      try {
        audioRef.current ??= new AudioContext();
        void audioRef.current.resume().catch(() => {});
      } catch {
        /* sin audio: queda la alerta visual */
      }
      try {
        await startCamera();
      } catch (error) {
        const denied = error instanceof DOMException && error.name === "NotAllowedError";
        setStatus({
          name: "problem",
          kind: denied ? "permission" : "camera",
          message: denied
            ? "El navegador no tiene permiso para usar la cámara. Actívalo y vuelve a iniciar."
            : "No se encontró una cámara disponible. Reintentando…",
        });
        return;
      }
      const saved = fromRecovery ? readBackground() : null;
      if (saved) {
        backgroundRef.current = saved;
        setStatus({ name: "running" });
      } else {
        await calibrate();
      }
    },
    [startCamera, calibrate],
  );

  // Tras una recuperación automática, arranca sin esperar al operario.
  useEffect(() => {
    if (!model || status.name !== "setup" || flag(AUTOSTART_KEY) !== "1") return;
    const timer = window.setTimeout(() => {
      flag(AUTOSTART_KEY, null);
      void start(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [model, status.name, start]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void audioRef.current?.close().catch(() => {});
    },
    [],
  );

  async function keepThresholds() {
    if (!suggested) return;
    const result = await saveStationCalibration(suggested);
    if (result.ok) {
      setContext((c) => ({ ...c, config: result.data }));
      setSuggested(null);
      setNotice("Umbrales guardados.");
    } else {
      setNotice(result.message);
    }
  }

  // ─── Vista ──────────────────────────────────────────────────────────────────

  const defectRate = counters.total ? counters.defective / counters.total : 0;
  const tooFast = rate > context.config.targetPiecesPerSecond * 60;
  const running = status.name === "running" || status.name === "calibrating" || status.name === "problem";

  return (
    <div ref={rootRef} className="flex min-h-[80vh] flex-col gap-4 bg-background text-foreground [&:fullscreen]:p-6">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
        <span className="text-base font-semibold">
          {context.station.name} · {context.station.line}
        </span>
        <span data-testid="estacion-lote">
          Lote:{" "}
          <strong>{context.batch ? `${context.batch.code} (${context.batch.partCode} · ${context.batch.moldCode})` : "sin asignar"}</strong>
        </span>
        <span data-testid="estacion-turno">
          Turno: <strong>{context.shift?.name ?? "ninguno activo"}</strong>
        </span>
        <span>Modelo: {model ? model.info.version : modelError ? "no disponible" : "cargando…"}</span>
        <span className={queueInfo.offline ? "font-semibold text-warning" : "text-muted-foreground"} role="status">
          {queueInfo.offline ? "Sin conexión · " : ""}
          {queueInfo.pending} por enviar
          {queueInfo.rejected ? ` · ${queueInfo.rejected} rechazadas` : ""}
        </span>
      </header>

      {modelError ? (
        <p role="alert" className="rounded-lg border border-defect/40 bg-defect/5 px-4 py-3 text-sm text-defect">
          {modelError}
        </p>
      ) : null}
      {!canInspect ? (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          {!context.batch
            ? "La estación no tiene un lote abierto asignado. Pide al Admin de planta que lo asigne en Estaciones."
            : "Ningún turno está activo a esta hora. La estación inspeccionará cuando empiece el siguiente turno."}
        </p>
      ) : null}
      {queueInfo.pending > QUEUE_WARNING_SIZE ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          Hay {queueInfo.pending} inspecciones sin enviar. Revisa la conexión a internet del equipo.
        </p>
      ) : null}
      {tooFast ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          La línea va más rápido ({rate} piezas/min) de lo que la estación puede inspeccionar.
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          {notice}
        </p>
      ) : null}

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-label="Cámara de la estación" className="relative overflow-hidden rounded-xl bg-acero-950">
          <video ref={videoRef} muted playsInline aria-label="Vista de la cámara" className="aspect-video w-full object-cover" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="aspect-square h-full rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(11,27,41,0.45)]" />
          </div>
          {running ? (
            <p data-testid="estacion-fase" className="absolute left-3 top-3 rounded-md bg-black/60 px-3 py-1 text-sm font-medium text-white">
              {status.name === "calibrating" ? "Calibrando: deja la cinta vacía…" : PHASE_LABELS[phase]}
            </p>
          ) : null}
          {status.name === "setup" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-acero-950/90 p-6 text-center text-white">
              <p className="max-w-md leading-7">
                Al iniciar, la pantalla pasa a modo completo y la estación toma la imagen de la cinta vacía para calibrarse.
                Deja la cinta sin piezas.
              </p>
              <button type="button" className="ui-button" disabled={!model} onClick={() => void start()}>
                {model ? "Iniciar la estación" : "Preparando el modelo…"}
              </button>
            </div>
          ) : null}
        </section>

        <section aria-label="Resultado y contadores" className="flex flex-col gap-4">
          <div aria-live="polite">
            {last ? (
              <p
                data-testid="estacion-veredicto"
                data-verdict={last.verdict}
                className={`flex items-center gap-3 rounded-xl border px-4 py-4 text-3xl font-bold ${
                  last.verdict === "DEFECTIVE" ? "border-defect/50 bg-defect/10 text-defect" : "border-ok/50 bg-ok/10 text-ok"
                }`}
              >
                <Icon name={last.verdict === "DEFECTIVE" ? "alert" : "check"} className="h-8 w-8 shrink-0" />
                {last.verdict === "DEFECTIVE" ? "Defectuosa" : "OK"}
                <span className="ml-auto text-base font-medium tabular-nums">Pieza {last.pieceNumber}</span>
              </p>
            ) : (
              <p className="rounded-xl border border-border px-4 py-4 text-muted-foreground">Aún no se inspeccionó ninguna pieza.</p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="estacion-contadores">
            <Stat label="Inspeccionadas" value={counters.total} />
            <Stat label="OK" value={counters.ok} />
            <Stat label="Defectuosas" value={counters.defective} />
            <Stat label="% defectos" value={percent(defectRate)} />
            <Stat label="Ritmo" value={`${rate}/min`} />
            <Stat label="Tensores" value={tensors ?? "—"} />
          </dl>
          {status.name === "problem" ? (
            <p role="alert" className="rounded-lg border border-defect/40 bg-defect/5 px-4 py-3 text-sm text-defect">
              {status.message}
            </p>
          ) : null}
          {suggested && status.name === "running" ? (
            <div className="rounded-lg border border-border px-4 py-3 text-sm">
              <p>
                Calibración: umbral de presencia {suggested.presenceThreshold} (actual {context.config.presenceThreshold}) y de
                movimiento {suggested.motionThreshold} (actual {context.config.motionThreshold}).
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" className="ui-button ui-button-secondary" onClick={() => void keepThresholds()}>
                  Guardar estos umbrales
                </button>
                <button type="button" className="ui-button ui-button-secondary" onClick={() => setSuggested(null)}>
                  Mantener los actuales
                </button>
              </div>
            </div>
          ) : null}
          {status.name === "running" ? (
            <button type="button" className="ui-button ui-button-secondary self-start" onClick={() => void calibrate()}>
              Recalibrar con la cinta vacía
            </button>
          ) : null}
        </section>
      </div>

      {alarm ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="alarma-titulo"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-defect p-6 text-center text-white"
        >
          <Icon name="alert" className="h-20 w-20" />
          <p id="alarma-titulo" className="text-6xl font-black tracking-tight sm:text-8xl">
            DEFECTUOSA
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            Pieza {alarm.pieceNumber} · confianza {percent(alarm.confidence)}
          </p>
          <p className="max-w-md text-lg">Retira la pieza de la línea y confirma.</p>
          <button
            type="button"
            autoFocus
            onClick={acknowledge}
            className="min-h-14 rounded-xl bg-white px-8 py-3 text-xl font-bold text-defect shadow-lg"
          >
            Pieza retirada
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
