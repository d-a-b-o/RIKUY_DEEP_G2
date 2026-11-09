import { ThemeToggle } from "@/components/ui/theme-toggle";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/brand/logo";
import { Icon } from "@/components/ui/icon";
import { Suspense } from "react";
import { PanelLinks } from "./panel-links";
import { BASE_LINKS, RoleNav } from "./role-nav";

export function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <a
        href="#contenido-panel"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Saltar al contenido
      </a>
      <aside className="flex flex-col border-b border-border bg-surface-raised lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r">
        <div className="flex min-h-20 items-center justify-between gap-4 px-5 lg:px-6">
          <Link
            href="/panel"
            className="rounded-md text-lg"
            aria-label="RikuyDeep, ir al panel"
          >
            <Logo />
          </Link>
          <div className="lg:hidden">
            <SignOutButton />
          </div>
        </div>
        <div className="px-4 pb-4 lg:pt-8">
          <div className="mb-3 flex justify-end lg:hidden">
            <ThemeToggle />
          </div>
          <p className="mb-4 hidden px-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground lg:block">
            Espacio de trabajo
          </p>
          <Suspense fallback={<PanelLinks links={BASE_LINKS} pathname={null} />}>
            <RoleNav />
          </Suspense>
        </div>
        <div className="mt-auto hidden p-5 lg:block">
          <div className="rounded-xl border border-border p-4">
            <Icon name="shield" className="mb-3 h-5 w-5 text-primary" />
            <p className="text-sm font-medium">Análisis en tu equipo</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Las imágenes se procesan en el navegador.
            </p>
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <SignOutButton />
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="hidden h-20 items-center justify-between border-b border-border px-8 lg:flex">
          <p className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Espacio de trabajo</span>
            <span aria-hidden="true" className="text-border">
              /
            </span>
            <span>Control de calidad</span>
          </p>
          <ThemeToggle />
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            RikuyDeep / Visión industrial
          </p>
        </header>
        <main
          id="contenido-panel"
          className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
