import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";

export type PanelLink = { href: string; label: string; icon: IconName };

function isCurrent(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return href === "/panel" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Lista de enlaces del panel. Sin `pathname` no marca ninguno (versión estática del menú). */
export function PanelLinks({ links, pathname }: { links: readonly PanelLink[]; pathname: string | null }) {
  return (
    <nav aria-label="Panel">
      <ul className="flex flex-wrap gap-2 lg:flex-col lg:flex-nowrap">
        {links.map((link) => (
          <li key={link.href} className="min-w-[8.5rem] flex-1 lg:min-w-0">
            <Link
              href={link.href}
              aria-current={isCurrent(pathname, link.href) ? "page" : undefined}
              className="flex min-h-12 items-center gap-3 rounded-lg border border-transparent px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface aria-[current=page]:border-primary/30 aria-[current=page]:border-l-4 aria-[current=page]:border-l-primary aria-[current=page]:bg-primary/15 aria-[current=page]:text-foreground"
            >
              <Icon name={link.icon} />
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
