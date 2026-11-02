import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/brand/logo";

const links = [
  { href: "/panel", label: "Inicio" },
  { href: "/panel/inspeccion", label: "Inspeccionar" },
];

/** Marco de las páginas privadas: cabecera con navegación y cierre de sesión. */
export function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/panel" className="rounded-md" aria-label="RikuyDeep, ir al panel">
              <Logo wordmarkClassName="max-[479px]:sr-only" />
            </Link>
            <nav aria-label="Panel">
              <ul className="flex items-center gap-1 text-sm font-medium sm:gap-4">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
