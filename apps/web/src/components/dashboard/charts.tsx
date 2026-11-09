import type { Breakdown, DayPoint } from "@/lib/dashboard/service";

/**
 * Gráficos del dashboard (HU37-T03, RIKDP-203). SVG generado en el servidor:
 * - Colores validados para daltonismo (--chart-ok / --chart-defect en
 *   globals.css), y las defectuosas además van rayadas: no dependen solo del color.
 * - Cada barra tiene su <title> (tooltip al pasar el mouse) y cada gráfico,
 *   su tabla equivalente.
 */

const nf = new Intl.NumberFormat("es-PE");
const pf = new Intl.NumberFormat("es-PE", { style: "percent", maximumFractionDigits: 1 });

function HatchDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--chart-defect)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="1.5" strokeOpacity="0.55" />
      </pattern>
    </defs>
  );
}

export function Legend() {
  return (
    <ul className="flex flex-wrap gap-4 text-sm text-muted-foreground" aria-label="Leyenda">
      <li className="flex items-center gap-2">
        <svg width="14" height="14" aria-hidden="true">
          <rect width="14" height="14" rx="3" fill="var(--chart-ok)" />
        </svg>
        OK
      </li>
      <li className="flex items-center gap-2">
        <svg width="14" height="14" aria-hidden="true">
          <HatchDefs id="leyenda-rayado" />
          <rect width="14" height="14" rx="3" fill="url(#leyenda-rayado)" />
        </svg>
        Defectuosas
      </li>
    </ul>
  );
}

/** Escala «bonita» para el eje: 0 y 3 marcas redondas. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  return [0, step, step * 2, step * 3];
}

const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Tendencia diaria: barras apiladas OK + defectuosas. */
export function TrendChart({ data }: { data: DayPoint[] }) {
  const W = 720;
  const H = 240;
  const pad = { top: 12, right: 8, bottom: 28, left: 48 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const ticks = niceTicks(Math.max(...data.map((d) => d.inspected), 0));
  const top = ticks.at(-1) || 1;
  const slot = innerW / Math.max(data.length, 1);
  const bar = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const labelEvery = Math.ceil(data.length / 8);
  const r = Math.min(4, bar / 2);

  return (
    <figure className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby="tendencia-titulo">
        <title id="tendencia-titulo">Inspecciones por día: OK y defectuosas</title>
        <HatchDefs id="tendencia-rayado" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">
              {nf.format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.left + i * slot + (slot - bar) / 2;
          const okTop = y(d.ok);
          const defTop = y(d.inspected);
          const gap = d.ok > 0 && d.defective > 0 ? 2 : 0;
          return (
            <g key={d.day}>
              <title>{`${shortDay(d.day)}: ${nf.format(d.inspected)} inspeccionadas · ${nf.format(d.ok)} OK · ${nf.format(d.defective)} defectuosas (${pf.format(d.defectRate)}) · ${nf.format(d.corrected)} corregidas`}</title>
              {/* Zona de contacto más grande que la barra, para el tooltip. */}
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent" />
              {d.ok > 0 ? (
                <path
                  d={roundedTop(x, okTop, bar, y(0) - okTop, d.defective > 0 ? 0 : r)}
                  fill="var(--chart-ok)"
                />
              ) : null}
              {d.defective > 0 ? (
                <path d={roundedTop(x, defTop, bar, Math.max(1, okTop - defTop - gap), r)} fill="url(#tendencia-rayado)" />
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={x + bar / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
                  {shortDay(d.day)}
                </text>
              ) : null}
            </g>
          );
        })}
        <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth="1" />
      </svg>
      <Legend />
    </figure>
  );
}

/**
 * % de defectos por día. Va en un gráfico aparte (no en un segundo eje del de
 * tendencia): con ~3 % de defectuosas, en las barras apiladas casi no se ven.
 */
export function DefectRateChart({ data }: { data: DayPoint[] }) {
  const W = 720;
  const H = 200;
  const pad = { top: 12, right: 8, bottom: 28, left: 48 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const maxRate = Math.max(...data.map((d) => d.defectRate), 0);
  const top = maxRate <= 0 ? 0.05 : Math.min(1, Math.ceil((maxRate * 100) / 5) * 0.05 || 0.05);
  const ticks = [0, top / 2, top];
  const slot = innerW / Math.max(data.length, 1);
  const bar = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby="tasa-titulo">
      <title id="tasa-titulo">Porcentaje de piezas defectuosas por día</title>
      <HatchDefs id="tasa-rayado" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">
            {pf.format(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad.left + i * slot + (slot - bar) / 2;
        const h = y(0) - y(d.defectRate);
        return (
          <g key={d.day}>
            <title>{`${shortDay(d.day)}: ${pf.format(d.defectRate)} defectuosas (${nf.format(d.defective)} de ${nf.format(d.inspected)})`}</title>
            <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent" />
            {d.defective > 0 ? <path d={roundedTop(x, y(d.defectRate), bar, Math.max(1, h), 4)} fill="url(#tasa-rayado)" /> : null}
            {i % labelEvery === 0 ? (
              <text x={x + bar / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
                {shortDay(d.day)}
              </text>
            ) : null}
          </g>
        );
      })}
      <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth="1" />
    </svg>
  );
}

/** Rectángulo con las esquinas superiores redondeadas (el extremo de datos). */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Ranking de moldes con más defectuosas: barras horizontales con su valor escrito. */
export function MoldRanking({ data }: { data: Breakdown[] }) {
  const max = Math.max(...data.map((m) => m.defective), 1);
  return (
    <ol className="flex flex-col gap-3">
      {data.map((m, i) => (
        <li key={m.id ?? i} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr]">
          <span className="truncate" title={m.label}>
            {i + 1}. {m.label}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-3 min-w-0 flex-1 items-center">
              <span
                role="img"
                aria-label={`${m.label}: ${m.defective} defectuosas de ${m.inspected}`}
                title={`${m.label}: ${nf.format(m.defective)} defectuosas de ${nf.format(m.inspected)} (${pf.format(m.defectRate)})`}
                className="block h-3 rounded-r"
                style={{
                  width: `${Math.max(1, (m.defective / max) * 100)}%`,
                  // Mismo rayado que en los gráficos SVG: identidad sin depender solo del color.
                  background:
                    "repeating-linear-gradient(45deg, var(--chart-defect) 0 4px, color-mix(in srgb, var(--chart-defect) 55%, var(--surface)) 4px 6px)",
                }}
              />
            </span>
            <span className="w-28 shrink-0 text-right tabular-nums">
              {nf.format(m.defective)} <span className="text-muted-foreground">({pf.format(m.defectRate)})</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
