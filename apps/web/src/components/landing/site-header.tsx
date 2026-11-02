import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const links = [
  { href: "#problema", label: "Problema" },
  { href: "#solucion", label: "Solución" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#planes", label: "Planes" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6">
        <a href="#inicio" className="rounded-md text-lg" aria-label="RikuyDeep, ir al inicio">
          {/* En pantallas de menos de 360 px solo cabe la marca; el nombre queda para lectores de pantalla. */}
          <Logo wordmarkClassName="max-[359px]:sr-only" />
        </a>
        <nav aria-label="Secciones" className="hidden md:block">
          <ul className="flex items-center gap-7 text-sm text-muted-foreground">
            {links.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="transition-colors hover:text-foreground">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-1 sm:gap-4">
          <Link
            href="/ingresar"
            className="inline-flex h-10 items-center whitespace-nowrap rounded-lg px-2 text-sm font-semibold text-foreground transition-colors hover:text-primary"
          >
            Ingresar
          </Link>
          <a
            href="#demo"
            className="inline-flex h-10 items-center whitespace-nowrap rounded-lg bg-accent px-3 text-sm sm:px-4 font-semibold text-accent-foreground transition-opacity hover:opacity-90"
          >
            Solicitar demo
          </a>
        </div>
      </div>
    </header>
  );
}
