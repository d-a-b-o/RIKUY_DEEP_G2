"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Logo } from "@/components/brand/logo";

const links = [
  { href: "#problema", label: "Problema" },
  { href: "#solucion", label: "Solución" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#planes", label: "Planes" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <a
          href="#inicio"
          className="rounded-md text-xl"
          aria-label="RikuyDeep, ir al inicio"
        >
          <Logo wordmarkClassName="max-[359px]:sr-only" />
        </a>
        <nav
          aria-label="Secciones"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              toggle.current?.focus();
            }
          }}
          className="order-last lg:order-none"
        >
          <ul className="hidden items-center gap-7 text-sm text-muted-foreground lg:flex">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-flex min-h-11 items-center transition-colors hover:text-primary"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <button
            ref={toggle}
            type="button"
            aria-label="Menú de secciones"
            aria-expanded={open}
            aria-controls="mobile-sections"
            onClick={() => setOpen(!open)}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-input-border lg:hidden"
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path
                d={open ? "M6 6l12 12M6 18L18 6" : "M4 7h16M4 12h16M4 17h16"}
              />
            </svg>
          </button>
          <div
            id="mobile-sections"
            hidden={!open}
            className="absolute inset-x-0 top-full border-b border-border bg-background p-5 shadow-2xl lg:hidden"
          >
            <ul className="mx-auto grid max-w-7xl gap-1">
              {[...links, { href: "#demo", label: "Solicitar demo" }].map(
                (link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="flex min-h-12 items-center rounded-lg px-4 text-sm hover:bg-surface"
                    >
                      {link.label}
                      <span aria-hidden="true" className="ml-auto text-primary">
                        ↗
                      </span>
                    </a>
                  </li>
                ),
              )}
            </ul>
          </div>
        </nav>
        <div className="ml-auto flex items-center gap-5 lg:ml-0">
          <Link
            href="/ingresar"
            className="inline-flex min-h-11 items-center text-sm font-medium hover:text-primary"
          >
            Ingresar
          </Link>
          <a href="#demo" className="ui-button hidden sm:inline-flex">
            Solicitar demo <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </header>
  );
}
