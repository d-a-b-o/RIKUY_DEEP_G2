/**
 * URL pública del sitio, usada en metadatos, Open Graph, sitemap y robots.
 * En Vercel se toma del dominio de producción; en local, de localhost.
 * Se puede fijar con NEXT_PUBLIC_SITE_URL.
 */
export function getSiteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL("http://localhost:3000");
}

export const siteConfig = {
  name: "RikuyDeep",
  title: "RikuyDeep · Inspección visual con IA para fundición",
  description:
    "Detecta piezas de fundición defectuosas con la cámara de un computador y un modelo de visión en el navegador. Veredicto en menos de 2 segundos y trazabilidad por lote, turno y molde.",
  locale: "es_PE",
} as const;
