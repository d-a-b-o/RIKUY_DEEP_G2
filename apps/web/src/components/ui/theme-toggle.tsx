"use client";

export function ThemeToggle() {
  return (
    <button
      type="button"
      aria-label="Cambiar entre modo claro y oscuro"
      title="Cambiar entre modo claro y oscuro"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-input-border text-foreground hover:bg-surface"
      onClick={() => {
        const root = document.documentElement;
        const theme =
          getComputedStyle(root).colorScheme === "dark" ? "light" : "dark";
        root.dataset.theme = theme;
        try {
          localStorage.setItem("rikuy-theme", theme);
        } catch {
          /* La selección funciona sin almacenamiento. */
        }
      }}
    >
      <svg
        className="theme-sun"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </svg>
      <svg
        className="theme-moon"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="M20.5 13.5A9 9 0 0 1 10.5 3a9 9 0 1 0 10 10.5Z" />
      </svg>
    </button>
  );
}
