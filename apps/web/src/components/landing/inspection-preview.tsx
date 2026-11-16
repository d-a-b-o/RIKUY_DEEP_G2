"use client";

import { useEffect, useRef, useState } from "react";

const blades = Array.from({ length: 8 }, (_, i) => i * 45);

/** Demostración visual; no ejecuta inferencia ni representa defectos localizados. */
export function InspectionPreview() {
  const frame = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const node = frame.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <figure ref={frame} className="inspection-demo" data-paused={paused || !visible} aria-label="Vista ilustrativa del proceso de inspección">
      <div className="inspection-demo__top">
        <div>
          <span className="inspection-demo__eyebrow">RIKUYDEEP / VISIÓN INDUSTRIAL</span>
          <p className="inspection-demo__title">Inspección visual</p>
        </div>
        <span className="inspection-demo__badge"><span aria-hidden="true">●</span> Vista ilustrativa</span>
      </div>
      <div className="inspection-demo__viewport">
        <div className="inspection-demo__viewport-label"><span aria-hidden="true">◉</span> CÁMARA · EJEMPLO</div>
        <svg viewBox="0 0 400 300" className="inspection-demo__piece" role="img" aria-labelledby="illustration-title">
          <title id="illustration-title">Ilustración de una pieza de fundición bajo la guía de encuadre.</title>
          <defs>
            <radialGradient id="preview-metal" cx="40%" cy="35%" r="70%"><stop offset="0%" stopColor="#d2dce2"/><stop offset="60%" stopColor="#8595a0"/><stop offset="100%" stopColor="#4b5b67"/></radialGradient>
            <radialGradient id="preview-hub"><stop offset="0%" stopColor="#e4eaed"/><stop offset="100%" stopColor="#8798a3"/></radialGradient>
          </defs>
          <g transform="translate(200 150)">
            <circle r="104" fill="url(#preview-metal)" stroke="#40525e" strokeWidth="4"/>
            <circle r="89" fill="none" stroke="#c3d2da" strokeOpacity=".28" strokeWidth="2"/>
            {blades.map((angle) => <path key={angle} d="M0 -30 C 22 -48, 30 -72, 22 -98" fill="none" stroke="#526471" strokeWidth="9" strokeLinecap="round" transform={`rotate(${angle})`}/>)}
            <circle r="34" fill="url(#preview-hub)" stroke="#4a5c68" strokeWidth="2"/>
            <circle r="13" fill="#1d303c"/>
          </g>
          <g fill="none" stroke="#d9faff" strokeWidth="3" strokeLinecap="round"><path d="M79 58 V38 H99"/><path d="M301 38 H321 V58"/><path d="M321 242 V262 H301"/><path d="M99 262 H79 V242"/></g>
        </svg>
        <div className="inspection-demo__scan" aria-hidden="true" />
        <div className="inspection-demo__stage" aria-hidden="true"><span className="inspection-demo__capture">Captura</span><span className="inspection-demo__analysis">Analizando</span><span className="inspection-demo__complete">Análisis completado</span></div>
      </div>
      <div className="inspection-demo__bottom">
        <div className="inspection-demo__result"><span className="inspection-demo__caption">RESULTADO DE EJEMPLO</span><p className="inspection-demo__verdict"><span aria-hidden="true">✓</span> OK</p><p className="inspection-demo__detail">Confianza ilustrativa: 94 %</p></div>
        <button type="button" className="inspection-demo__pause" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? "Reanudar animación" : "Pausar animación"}</button>
      </div>
      <figcaption className="sr-only">Demostración ilustrativa: captura, análisis y resultado de ejemplo. No es una inspección real.</figcaption>
    </figure>
  );
}
