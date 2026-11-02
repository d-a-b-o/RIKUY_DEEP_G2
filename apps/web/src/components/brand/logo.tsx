type LogoMarkProps = {
  className?: string;
  /** Texto alternativo. Vacío si el logo es decorativo y ya hay texto al lado. */
  title?: string;
};

/**
 * Marca de RikuyDeep: un ojo («rikuy» significa «ver» en quechua) cuyo iris es
 * una pieza fundida hexagonal. Usa los tokens semánticos, así que se adapta al
 * tema claro y oscuro.
 */
export function LogoMark({ className, title = "RikuyDeep" }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
    >
      <path
        d="M4 32C12.5 17.5 22 11 32 11s19.5 6.5 28 21c-8.5 14.5-18 21-28 21S12.5 46.5 4 32Z"
        fill="none"
        className="stroke-primary"
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <path d="M32 19.5 42.8 25.75v12.5L32 44.5 21.2 38.25v-12.5Z" className="fill-accent" />
      <circle cx="32" cy="32" r="4.5" className="fill-background" />
    </svg>
  );
}

type LogoProps = {
  className?: string;
  /** Clases del nombre «RikuyDeep», por ejemplo para ocultarlo en pantallas estrechas. */
  wordmarkClassName?: string;
};

/** Logo completo: marca + nombre. */
export function Logo({ className, wordmarkClassName }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}>
      <LogoMark className="h-[1.6em] w-[1.6em]" title="" />
      <span className={wordmarkClassName}>
        <span className="text-foreground">Rikuy</span>
        <span className="text-accent">Deep</span>
      </span>
    </span>
  );
}
