import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site";

export const alt = siteConfig.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#0b1b29",
          color: "#e8eef3",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="88" height="88" viewBox="0 0 64 64">
            <path
              d="M4 32C12.5 17.5 22 11 32 11s19.5 6.5 28 21c-8.5 14.5-18 21-28 21S12.5 46.5 4 32Z"
              fill="none"
              stroke="#74a2c3"
              strokeWidth="5"
              strokeLinejoin="round"
            />
            <path d="M32 19.5 42.8 25.75v12.5L32 44.5 21.2 38.25v-12.5Z" fill="#ff8a4c" />
            <circle cx="32" cy="32" r="4.5" fill="#0b1b29" />
          </svg>
          <div style={{ display: "flex", fontSize: 52, fontWeight: 700 }}>
            <span>Rikuy</span>
            <span style={{ color: "#ff8a4c" }}>Deep</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 66, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>
            Detecta piezas defectuosas antes de que salgan de tu planta
          </div>
          <div style={{ fontSize: 30, color: "#a9b8c6" }}>
            Inspección visual con IA para fundición · Veredicto en menos de 2 segundos
          </div>
        </div>
      </div>
    ),
    size,
  );
}
