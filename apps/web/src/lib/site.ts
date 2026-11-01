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
  title: "RikuyDeep · Inspección automática con IA para fundición",
  description:
    "Inspecciona el 100 % de tus piezas de fundición con una cámara sobre la línea y un modelo de IA en el navegador. Detección de defectos en menos de un segundo, alerta inmediata y trazabilidad por lote, turno y molde.",
  locale: "es_PE",
} as const;
