"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type InspectionModel,
  type LoadStage,
  type Prediction,
  loadInspectionModel,
} from "@/lib/model/loader";
import { type PixelSource, drawModelInput } from "@/lib/model/preprocess";
import { Icon } from "@/components/ui/icon";

type ModelState =
  | { status: "loading"; stage: LoadStage; progress?: number }
  | { status: "ready"; model: InspectionModel }
  | { status: "error"; message: string };

type Mode = "upload" | "camera";

type Result = Prediction & { label: string };

const stageText: Record<LoadStage, string> = {
  manifest: "Consultando la versión activa del modelo…",
  backend: "Preparando la aceleración del navegador…",
  cache: "Buscando el modelo guardado en este equipo…",
  download: "Descargando el modelo…",
  warmup: "Preparando la primera inspección…",
};

const backendText = {
  webgl: "WebGL (GPU)",
  wasm: "WebAssembly",
  cpu: "CPU (lento)",
} as const;

const percent = (value: number) =>
  `${(value * 100).toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`;

export function Inspector({ manifestUrl }: { manifestUrl: string }) {
  const [modelState, setModelState] = useState<ModelState>({
    status: "loading",
    stage: "manifest",
  });
  const [mode, setMode] = useState<Mode>("upload");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const modelRef = useRef<InspectionModel | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const reportInputError = useCallback((message: string | null) => {
    setInputError(message);
    if (message) setResult(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadInspectionModel(manifestUrl, (stage, progress) => {
      if (!cancelled) setModelState({ status: "loading", stage, progress });
    })
      .then((model) => {
        if (cancelled) return model.dispose();
        modelRef.current = model;
        setModelState({ status: "ready", model });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setModelState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
      modelRef.current?.dispose();
      modelRef.current = null;
    };
  }, [manifestUrl]);

  const inspect = useCallback(async (source: PixelSource, label: string) => {
    const model = modelRef.current;
    const canvas = previewRef.current;
    if (!model || !canvas) return;
    setBusy(true);
    setInputError(null);
    setResult(null);
    try {
      drawModelInput(source, canvas, model.info.input);
      const prediction = await model.predict(canvas);
      setResult({ ...prediction, label });
    } catch {
      setInputError(
        "No se pudo inspeccionar la imagen. Comprueba el encuadre y vuelve a intentarlo.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const ready = modelState.status === "ready";

  return (
    <div className="flex flex-col gap-6">
      <ModelStatus state={modelState} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-labelledby="entrada" className="ui-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="entrada" className="text-lg font-semibold">
              Pieza a inspeccionar
            </h2>
            <div
              role="group"
              aria-label="Origen de la imagen"
              className="flex rounded-lg border border-input-border bg-background p-1 text-sm"
            >
              {(["upload", "camera"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => {
                    setInputError(null);
                    setMode(value);
                  }}
                  className="flex min-h-11 items-center gap-2 rounded-md px-3 py-2 font-medium text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                >
                  <Icon
                    name={value === "upload" ? "upload" : "camera"}
                    className="h-4 w-4"
                  />
                  {value === "upload" ? "Subir imagen" : "Cámara"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5">
            {mode === "upload" ? (
              <UploadInput
                disabled={!ready || busy}
                onImage={inspect}
                onError={reportInputError}
              />
            ) : (
              <CameraInput
                disabled={!ready || busy}
                onFrame={inspect}
                onError={reportInputError}
              />
            )}
          </div>
          {inputError ? (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-defect/40 bg-defect/5 px-4 py-3 text-sm text-defect"
            >
              {inputError}
            </p>
          ) : null}
        </section>

        <section aria-labelledby="resultado" className="ui-card p-5 sm:p-6">
          <h2 id="resultado" className="text-lg font-semibold">
            Resultado
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-1 xl:grid-cols-[160px_minmax(0,1fr)]">
            <figure className="flex flex-col gap-2">
              <canvas
                ref={previewRef}
                width={400}
                height={400}
                aria-label="Imagen que analizó el modelo"
                className="aspect-square w-40 max-w-full rounded-lg border border-border bg-background"
              />
              <figcaption className="text-xs text-muted-foreground">
                Lo que ve el modelo: recorte cuadrado a 400×400.
              </figcaption>
            </figure>
            <div aria-live="polite" aria-busy={busy}>
              {busy ? (
                <p
                  role="status"
                  className="rounded-xl border border-primary/40 bg-primary/5 p-4 text-primary"
                >
                  Inspeccionando…
                </p>
              ) : result ? (
                <Verdict result={result} />
              ) : (
                <p className="leading-7 text-muted-foreground">
                  Sube una foto de la pieza o usa la cámara. El análisis se hace
                  en este navegador: la imagen no sale de tu equipo.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ModelStatus({ state }: { state: ModelState }) {
  if (state.status === "error") {
    return (
      <p
        role="alert"
        className="rounded-lg border border-defect/40 bg-defect/5 px-4 py-3 text-sm text-defect"
      >
        No se pudo cargar el modelo: {state.message}
      </p>
    );
  }
  if (state.status === "loading") {
    const progress =
      state.stage === "download" && state.progress !== undefined
        ? ` ${Math.round(state.progress * 100)} %`
        : "";
    return (
      <p
        role="status"
        className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-4 text-sm text-muted-foreground"
      >
        <Icon
          name="scan"
          className="h-5 w-5 shrink-0 text-primary motion-safe:animate-pulse"
        />
        {stageText[state.stage]}
        {progress}
      </p>
    );
  }
  const { info } = state.model;
  const provisional = info.version.startsWith("0.");
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-4 text-sm"
    >
      <Icon name="check" className="h-5 w-5 shrink-0 text-ok" />
      <span className="font-medium">
        Modelo {info.version}
        {provisional ? (
          <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
            Provisional
          </span>
        ) : null}
      </span>
      <span className="text-muted-foreground">{backendText[info.backend]}</span>
      <span className="text-muted-foreground">
        Umbral{" "}
        {info.threshold.toLocaleString("es-PE", { maximumFractionDigits: 4 })}
      </span>
      <span className="text-muted-foreground">
        {info.source === "cache" ? "Desde este equipo" : "Descargado"} en{" "}
        {(info.loadMs / 1000).toLocaleString("es-PE", {
          maximumFractionDigits: 1,
        })}{" "}
        s
      </span>
      {info.offline ? (
        <span className="font-medium text-warning">
          Sin conexión: usando la última versión guardada
        </span>
      ) : null}
    </div>
  );
}

function Verdict({ result }: { result: Result }) {
  const defective = result.verdict === "DEFECTIVE";
  return (
    <div className="flex flex-col gap-4">
      <p
        data-testid="veredicto"
        data-verdict={result.verdict}
        className={`flex items-center gap-3 rounded-xl border px-4 py-4 text-2xl font-bold tracking-tight ${
          defective
            ? "border-defect/50 bg-defect/10 text-defect"
            : "border-ok/50 bg-ok/10 text-ok"
        }`}
      >
        <Icon
          name={defective ? "alert" : "check"}
          className="h-7 w-7 shrink-0"
        />
        {defective ? "Defectuosa" : "OK"}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Confianza</dt>
          <dd className="text-base font-semibold tabular-nums">
            {percent(result.confidence)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Probabilidad de defecto</dt>
          <dd
            data-testid="probabilidad"
            className="text-base font-semibold tabular-nums"
          >
            {percent(result.defectProbability)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tiempo de análisis</dt>
          <dd className="font-medium tabular-nums">
            {Math.round(result.inferenceMs)} ms
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Imagen</dt>
          <dd className="truncate font-medium" title={result.label}>
            {result.label}
          </dd>
        </div>
      </dl>
    </div>
  );
}

type InputProps = {
  disabled: boolean;
  onError: (message: string | null) => void;
};

function UploadInput({
  disabled,
  onImage,
  onError,
}: InputProps & { onImage: (source: PixelSource, label: string) => void }) {
  const [dragging, setDragging] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("El archivo no es una imagen. Usa JPG, PNG o WebP.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      onImage(bitmap, file.name);
    } catch {
      onError("No se pudo leer la imagen. Prueba con otro archivo.");
    }
  }

  return (
    <label
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) void handle(event.dataTransfer.files[0]);
      }}
      className={`flex min-h-72 cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-background px-5 py-10 text-center transition-colors focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-ring ${
        dragging
          ? "border-primary bg-primary/5"
          : "border-input-border hover:border-primary"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
        <Icon name="upload" className="h-6 w-6" />
      </span>
      <span className="max-w-xs text-base font-semibold">
        Arrastra una foto de la pieza o haz clic para elegirla
      </span>
      <span className="text-sm text-muted-foreground">
        JPG, PNG o WebP. Si no es cuadrada, se usa el centro.
      </span>
      <input
        type="file"
        accept="image/*"
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          void handle(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </label>
  );
}

function CameraInput({
  disabled,
  onFrame,
  onError,
}: InputProps & { onFrame: (source: PixelSource, label: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);
  const [active, setActive] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [cameraStatus, setCameraStatus] = useState(
    "Esperando permiso y el primer fotograma de la cámara…",
  );

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;
    let failed = false;
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(frameTimer);
      stream?.getTracks().forEach((track) => {
        track.removeEventListener("ended", disconnected);
        track.stop();
      });
      if (video) video.srcObject = null;
    };
    const fail = (message: string) => {
      if (cancelled || failed) return;
      failed = true;
      release();
      setLive(false);
      setCameraStatus("Cámara no disponible. Puedes volver a intentarlo.");
      onError(message);
    };
    const disconnected = () => fail(
      "La cámara se desconectó o se revocó el permiso. Comprueba la conexión y vuelve a intentarlo.",
    );
    const firstFrame = () => {
      if (
        cancelled || failed || !video || video.readyState < 2 ||
        !video.videoWidth || !video.videoHeight
      ) return;
      clearTimeout(frameTimer);
      setLive(true);
      setCameraStatus("Cámara lista para capturar.");
    };
    video?.addEventListener("loadeddata", firstFrame);
    video?.addEventListener("playing", firstFrame);
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          fail("Este navegador no permite usar la cámara. Abre la aplicación mediante HTTPS en un navegador compatible.");
          return;
        }
        const media = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled)
          return media.getTracks().forEach((track) => track.stop());
        stream = media;
        if (!video || !media.getVideoTracks().length || media.getVideoTracks().some((track) => track.readyState === "ended")) {
          disconnected();
          return;
        }
        media.getVideoTracks().forEach((track) => track.addEventListener("ended", disconnected));
        video.srcObject = media;
        frameTimer = setTimeout(() => fail(
          "La cámara no envía imágenes. Comprueba que no esté ocupada y vuelve a intentarlo.",
        ), 15_000);
        await video.play();
        firstFrame();
      } catch (error: unknown) {
        const denied =
          error instanceof DOMException && error.name === "NotAllowedError";
        fail(
          denied
            ? "El navegador no tiene permiso para usar la cámara. Actívalo en la barra de direcciones y vuelve a intentarlo."
            : "No se pudo iniciar una cámara disponible. Comprueba la conexión y que no esté ocupada por otra aplicación.",
        );
      }
    }
    void start();
    return () => {
      cancelled = true;
      video?.removeEventListener("loadeddata", firstFrame);
      video?.removeEventListener("playing", firstFrame);
      release();
    };
  }, [onError, active, attempt]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-xl bg-acero-950">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Vista de la cámara"
          className="aspect-video w-full object-cover"
        />
        {/* Guía de encuadre: el modelo solo ve este cuadrado central. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="aspect-square h-full rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(11,27,41,0.45)]" />
        </div>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {cameraStatus}
      </p>
      <button
        type="button"
        disabled={disabled || !live}
        onClick={() => {
          const video = videoRef.current;
          const stream = video?.srcObject as MediaStream | null;
          if (
            !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight ||
            !stream?.getVideoTracks().some((track) => track.readyState === "live" && !track.muted)
          ) {
            onError("La cámara no tiene un fotograma disponible. Comprueba la conexión y vuelve a intentarlo.");
            return;
          }
          onFrame(
            video,
            `Cámara · ${new Date().toLocaleTimeString("es-PE")}`,
          );
        }}
        className="ui-button"
      >
        Inspeccionar
      </button>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="ui-button"
          onClick={() => {
            setLive(false);
            onError(null);
            setCameraStatus("Esperando permiso y el primer fotograma de la cámara…");
            setActive(true);
            setAttempt((value) => value + 1);
          }}
        >
          Reintentar cámara
        </button>
        <button
          type="button"
          className="ui-button"
          disabled={!active}
          onClick={() => {
            setLive(false);
            setActive(false);
            onError(null);
            setCameraStatus("Cámara detenida.");
          }}
        >
          Detener cámara
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Centra la pieza dentro del cuadro, con buena luz y sin movimiento.
      </p>
    </div>
  );
}
