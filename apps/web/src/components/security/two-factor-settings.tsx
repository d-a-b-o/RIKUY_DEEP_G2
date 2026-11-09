"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState, useTransition } from "react";
import { revokeOtherSessionsAction } from "@/app/panel/cuenta/seguridad/actions";
import { Field, FormAlert, inputClass } from "@/components/auth/fields";
import { Icon } from "@/components/ui/icon";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/auth/config";
import { BackupCodes } from "./backup-codes";

type Props = { enabled: boolean; required: boolean };

type Step =
  | { name: "idle" }
  | { name: "scan"; totpURI: string; backupCodes: string[] }
  | { name: "codes"; backupCodes: string[]; title: string };

/** Secreto en texto, para quien no puede escanear el QR. */
function secretFrom(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: 224, errorCorrectionLevel: "M" })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- data URL generada en el navegador
    <img src={src} width={224} height={224} alt="Código QR para la app autenticadora" className="rounded-lg bg-white p-2" />
  ) : (
    <div className="h-56 w-56 animate-pulse rounded-lg bg-surface" aria-hidden="true" />
  );
}

/** Activar, regenerar códigos y desactivar la verificación en dos pasos (HU29). */
export function TwoFactorSettings({ enabled, required }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function readPassword(form: HTMLFormElement): string {
    return String(new FormData(form).get("password") ?? "");
  }

  function startEnable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = readPassword(event.currentTarget);
    setAlert(null);
    if (!password) return setAlert("Escribe tu contraseña para continuar.");
    startTransition(async () => {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data || !("totpURI" in data) || !data.totpURI) {
        setAlert(authErrorMessage(error, "two-factor"));
        return;
      }
      setStep({ name: "scan", totpURI: data.totpURI, backupCodes: data.backupCodes ?? [] });
    });
  }

  function confirmCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.name !== "scan") return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    setAlert(null);
    if (!/^\d{6}$/.test(code)) return setAlert("Escribe los 6 dígitos que muestra tu app.");
    const codes = step.backupCodes;
    startTransition(async () => {
      const { error } = await authClient.twoFactor.verifyTotp({ code });
      if (error) {
        setAlert(authErrorMessage(error, "two-factor"));
        return;
      }
      await revokeOtherSessionsAction();
      setStep({ name: "codes", backupCodes: codes, title: "Verificación en dos pasos activada" });
    });
  }

  function regenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = readPassword(event.currentTarget);
    setAlert(null);
    if (!password) return setAlert("Escribe tu contraseña para generar códigos nuevos.");
    startTransition(async () => {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
      if (error || !data) {
        setAlert(authErrorMessage(error, "two-factor"));
        return;
      }
      setStep({ name: "codes", backupCodes: data.backupCodes, title: "Códigos de respaldo nuevos" });
    });
  }

  function disable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = readPassword(event.currentTarget);
    setAlert(null);
    if (!password) return setAlert("Escribe tu contraseña para desactivarla.");
    if (!window.confirm("¿Desactivar la verificación en dos pasos? Tu cuenta quedará protegida solo por la contraseña.")) return;
    startTransition(async () => {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) {
        setAlert(authErrorMessage(error, "two-factor"));
        return;
      }
      await revokeOtherSessionsAction();
      router.refresh();
    });
  }

  if (step.name === "codes") {
    return (
      <div className="flex flex-col gap-5">
        <p role="status" className="flex items-center gap-2 font-semibold text-ok">
          <Icon name="check" className="h-5 w-5" />
          {step.title}
        </p>
        <BackupCodes codes={step.backupCodes} />
        <button
          type="button"
          className="ui-button self-start"
          onClick={() => {
            setStep({ name: "idle" });
            router.refresh();
          }}
        >
          Ya los guardé
        </button>
      </div>
    );
  }

  if (step.name === "scan") {
    const secret = secretFrom(step.totpURI);
    return (
      <div className="flex flex-col gap-6">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>Abre Google Authenticator, Microsoft Authenticator u otra app compatible.</li>
          <li>Escanea el código QR, o escribe la clave a mano.</li>
          <li>Escribe el código de 6 dígitos que aparece en la app.</li>
        </ol>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <QrImage value={step.totpURI} />
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Clave para escribir a mano</p>
            <p className="mt-1 break-all font-mono text-sm" data-testid="clave-totp">
              {secret}
            </p>
          </div>
        </div>
        <form onSubmit={confirmCode} noValidate className="flex flex-col gap-4">
          <Field id="code" label="Código de la app">
            {(props) => (
              <input
                {...props}
                autoFocus
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className={`${inputClass} max-w-48 font-mono tracking-widest`}
              />
            )}
          </Field>
          <FormAlert message={alert} />
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={pending} className="ui-button">
              {pending ? "Verificando…" : "Activar"}
            </button>
            <button type="button" className="ui-button ui-button-secondary" onClick={() => setStep({ name: "idle" })}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (!enabled) {
    return (
      <form onSubmit={startEnable} noValidate className="flex flex-col gap-4">
        {required ? (
          <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
            Tu cuenta debe usar la verificación en dos pasos. Actívala para seguir usando RikuyDeep.
          </p>
        ) : null}
        <p className="text-sm leading-6 text-muted-foreground">
          Además de tu contraseña, al ingresar te pediremos un código de tu app autenticadora.
        </p>
        <Field id="password" label="Tu contraseña">
          {(props) => (
            <input {...props} type="password" required autoComplete="current-password" className={`${inputClass} max-w-sm`} />
          )}
        </Field>
        <FormAlert message={alert} />
        <button type="submit" disabled={pending} className="ui-button self-start">
          {pending ? "Preparando…" : "Activar la verificación en dos pasos"}
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <p role="status" className="flex items-center gap-2 font-medium text-ok">
        <Icon name="check" className="h-5 w-5" />
        Activada{required ? " · obligatoria para tu cuenta" : ""}
      </p>
      <FormAlert message={alert} />
      <form onSubmit={regenerate} noValidate className="flex flex-col gap-4">
        <h3 className="font-semibold">Códigos de respaldo</h3>
        <p className="-mt-2 text-sm leading-6 text-muted-foreground">
          Genera códigos nuevos si gastaste los tuyos o crees que alguien los vio. Los anteriores dejarán de servir.
        </p>
        <Field id="password-regenerar" label="Tu contraseña">
          {(props) => (
            <input
              {...props}
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={`${inputClass} max-w-sm`}
            />
          )}
        </Field>
        <button type="submit" disabled={pending} className="ui-button ui-button-secondary self-start">
          Generar códigos nuevos
        </button>
      </form>
      {required ? null : (
        <form onSubmit={disable} noValidate className="flex flex-col gap-4 border-t border-border pt-6">
          <h3 className="font-semibold">Desactivar</h3>
          <Field id="password-desactivar" label="Tu contraseña">
            {(props) => (
              <input
                {...props}
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className={`${inputClass} max-w-sm`}
              />
            )}
          </Field>
          <button
            type="submit"
            disabled={pending}
            className="ui-button ui-button-secondary self-start border-defect/60 text-defect"
          >
            Desactivar la verificación en dos pasos
          </button>
        </form>
      )}
    </div>
  );
}
