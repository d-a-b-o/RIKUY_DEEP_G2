import { ThemeToggle } from "@/components/ui/theme-toggle";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { InspectionPreview } from "@/components/landing/inspection-preview";

type AuthShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function AuthShell({
  title,
  description,
  children,
  footer,
}: AuthShellProps) {
  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-2">
      <aside
        aria-label="RikuyDeep"
        className="industrial-grid hidden flex-col justify-between border-r border-border p-10 xl:p-14 lg:flex"
      >
        <Link
          href="/"
          className="w-fit rounded-md text-2xl"
          aria-label="RikuyDeep, ir al inicio"
        >
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-lg flex-col gap-8 py-12">
          <div>
            <p className="ui-eyebrow">Calidad en cada pieza</p>
            <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-tight">
              Una mirada constante.
              <br />
              <span className="text-primary">Un criterio de calidad.</span>
            </h2>
          </div>
          <InspectionPreview />
          <p className="text-sm leading-6 text-muted-foreground">
            Inspección visual con inteligencia artificial para plantas de
            fundición.
          </p>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          RIKUYDEEP / CONTROL DE CALIDAD
        </p>
      </aside>
      <div className="flex flex-col px-5 py-8 sm:px-10 lg:px-12">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-primary"
          >
            <span aria-hidden="true">←</span> Volver al inicio
          </Link>
          <ThemeToggle />
        </div>
        <div className="mx-auto my-auto w-full max-w-md py-12">
          <Link
            href="/"
            className="mb-10 inline-flex rounded-md text-xl lg:hidden"
            aria-label="RikuyDeep, ir al inicio"
          >
            <Logo />
          </Link>
          <p className="ui-eyebrow">Acceso a tu planta</p>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 leading-7 text-muted-foreground">
              {description}
            </p>
          ) : null}
          <div className="mt-8 rounded-2xl border border-border bg-surface-raised p-5 sm:p-7">
            {children}
          </div>
          {footer ? (
            <div className="mt-6 text-sm leading-6 text-muted-foreground">
              {footer}
            </div>
          ) : null}
        </div>
        <p className="text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          RikuyDeep · Inspección visual de calidad
        </p>
      </div>
    </main>
  );
}
