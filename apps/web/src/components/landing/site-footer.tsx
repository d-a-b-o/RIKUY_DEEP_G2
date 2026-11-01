import { Logo } from "@/components/brand/logo";

const links = [
  { href: "#problema", label: "Problema" },
  { href: "#solucion", label: "Solución" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#comparativa", label: "Comparativa" },
  { href: "#planes", label: "Planes" },
  { href: "#demo", label: "Solicitar demo" },
];

export function SiteFooter() {
  return (
    <footer className="bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-sm flex-col gap-3">
          <span className="text-lg">
            <Logo />
          </span>
          <p className="text-sm leading-6 text-muted-foreground">
            Inspección visual de calidad con inteligencia artificial para plantas de fundición.
          </p>
        </div>
        <nav aria-label="Pie de página">
          <ul className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm text-muted-foreground">
            {links.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="transition-colors hover:text-foreground">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6">© 2026 RikuyDeep</p>
      </div>
    </footer>
  );
}
