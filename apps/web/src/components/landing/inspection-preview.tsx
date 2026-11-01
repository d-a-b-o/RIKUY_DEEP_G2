const blades = Array.from({ length: 8 }, (_, i) => i * 45);

/**
 * Ilustración de la pantalla de inspección: un impulsor de fundición visto desde
 * arriba, con la guía de encuadre y el veredicto del modelo superpuesto.
 */
export function InspectionPreview() {
  return (
    <figure className="relative w-full max-w-[34rem]">
      <div className="overflow-hidden rounded-2xl border border-border bg-acero-950 shadow-xl shadow-acero-950/20">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5 text-xs text-acero-200">
          <span className="min-w-0 truncate font-mono">ESTACIÓN L2-01 · LOTE L-0417 · TURNO B</span>
          <span className="flex flex-none items-center gap-1.5 whitespace-nowrap">
            <span className="h-2 w-2 rounded-full bg-[#4ade80]" aria-hidden="true" />
            En línea
          </span>
        </div>

        <svg viewBox="0 0 400 300" className="block w-full" role="img" aria-labelledby="preview-title">
          <title id="preview-title">
            Impulsor de fundición pasando por la estación, con un poro marcado y el veredicto «Defectuosa»
          </title>
          <defs>
            <radialGradient id="metal" cx="45%" cy="40%" r="65%">
              <stop offset="0%" stopColor="#c9d3db" />
              <stop offset="60%" stopColor="#8e9aa5" />
              <stop offset="100%" stopColor="#5e6b77" />
            </radialGradient>
            <radialGradient id="hub" cx="45%" cy="40%" r="70%">
              <stop offset="0%" stopColor="#d7dee4" />
              <stop offset="100%" stopColor="#7b8792" />
            </radialGradient>
          </defs>

          <rect width="400" height="300" fill="#16232f" />
          <g stroke="#ffffff" strokeOpacity="0.05">
            {Array.from({ length: 9 }, (_, i) => (
              <line key={`v${i}`} x1={i * 50} y1="0" x2={i * 50} y2="300" />
            ))}
            {Array.from({ length: 7 }, (_, i) => (
              <line key={`h${i}`} x1="0" y1={i * 50} x2="400" y2={i * 50} />
            ))}
          </g>

          <g transform="translate(200 150)">
            <circle r="104" fill="url(#metal)" />
            <circle r="104" fill="none" stroke="#3d4853" strokeWidth="3" />
            {blades.map((angle) => (
              <path
                key={angle}
                d="M0 -30 C 22 -48, 30 -72, 22 -98"
                fill="none"
                stroke="#56626d"
                strokeWidth="9"
                strokeLinecap="round"
                transform={`rotate(${angle})`}
              />
            ))}
            <circle r="34" fill="url(#hub)" stroke="#4a5560" strokeWidth="2" />
            <circle r="13" fill="#1d2a35" />
            <circle cx="58" cy="-44" r="5" fill="#2a2f33" />
            <circle cx="58" cy="-44" r="16" fill="none" stroke="#ff8a4c" strokeWidth="2.5" strokeDasharray="5 4" />
          </g>

          <g fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="3" strokeLinecap="round">
            <path d="M80 50 v-20 h20" />
            <path d="M300 30 h20 v20" />
            <path d="M320 250 v20 h-20" />
            <path d="M100 270 h-20 v-20" />
          </g>
        </svg>

        <div className="grid grid-cols-3 border-t border-white/10 text-xs text-acero-200">
          <div className="px-4 py-3">
            <div className="text-acero-300">Pieza</div>
            <div className="mt-0.5 font-mono text-sm text-white tabular-nums">#1.284</div>
          </div>
          <div className="border-x border-white/10 px-4 py-3">
            <div className="text-acero-300">Confianza</div>
            <div className="mt-0.5 font-mono text-sm text-white tabular-nums">0,94</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-acero-300">Defectos hoy</div>
            <div className="mt-0.5 font-mono text-sm text-white tabular-nums">1,6 %</div>
          </div>
        </div>
      </div>

      <div className="absolute left-4 top-14 flex items-center gap-2 rounded-full bg-[#b91c1c] px-3.5 py-1.5 text-sm font-semibold text-white shadow-lg sm:left-5">
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        Defectuosa
      </div>

      <figcaption className="sr-only">
        Ejemplo de estación automática: la pieza 1.284 del turno se marca como defectuosa con confianza 0,94.
      </figcaption>
    </figure>
  );
}
