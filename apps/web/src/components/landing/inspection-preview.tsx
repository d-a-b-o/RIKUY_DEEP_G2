"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

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
        <Image src="/brand/pieza-referencia.png" width={1320} height={1160} priority className="inspection-demo__piece" alt="Pieza metálica de ejemplo, tomada de la referencia visual del proyecto." />
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
