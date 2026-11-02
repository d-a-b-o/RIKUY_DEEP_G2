"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";

const links = [
  { href: "/panel", label: "Inicio", icon: "grid" as const },
  { href: "/panel/inspeccion", label: "Inspeccionar", icon: "scan" as const },
];

export function PanelNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Panel">
      <ul className="flex gap-2 lg:flex-col">
        {links.map((link) => (
          <li key={link.href} className="flex-1">
            <Link
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              className="flex min-h-12 items-center gap-3 rounded-lg border border-transparent px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface aria-[current=page]:border-primary/30 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
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
