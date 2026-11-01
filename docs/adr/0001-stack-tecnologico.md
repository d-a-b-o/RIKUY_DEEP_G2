# 0001 · Stack tecnológico de la aplicación web

- **Estado:** Propuesta
- **Fecha:** 2026-11-01
- **Tareas:** RIKDP-86 (HU07-T01), HU08

## Contexto

Un equipo de tres personas, con poco tiempo por semana, debe construir en unas ocho semanas una aplicación multiempresa con autenticación, catálogos, inspección con cámara, trazabilidad, dashboards y reportes. Hace falta un stack que minimice la infraestructura que hay que operar, tenga capas gratuitas suficientes para un piloto y permita compartir tipos entre el frontend y el backend.

## Decisión

| Capa | Elección |
| --- | --- |
| Framework web | **Next.js 16** (App Router) con React 19 y TypeScript, en `apps/web` |
| Estilos | **Tailwind CSS v4** con tokens de diseño en `globals.css` |
| Hosting | **Vercel**: preview por PR y producción desde `main` |
| Base de datos | **Neon** (Postgres serverless) con ramas `main` y `dev` |
| ORM | **Prisma**, con migraciones versionadas en el repositorio |
| Autenticación | **Better Auth**: email y contraseña, sesiones, bloqueo por intentos y plugin de 2FA (TOTP y códigos de respaldo) |
| Almacenamiento de objetos | **Cloudflare R2**: imágenes de inspecciones y artefactos del modelo |
| Correo | **Resend** |
| Inferencia | **TensorFlow.js** en el navegador ([ADR 0002](0002-inferencia-en-el-navegador.md)) |
| Pruebas | **Vitest** (componente) y **Playwright** (sistema/E2E) |
| CI | **GitHub Actions**: workflow `ci.yml` con el job puerta `CI` |
| Monitoreo | **UptimeRobot** |
| ML | Keras, DVC, MLflow en DagsHub, `tensorflowjs_converter` |

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Backend separado (FastAPI) + SPA | Dos despliegues y dos lenguajes en la web; además, la inferencia ya no se hace en servidor ([ADR 0002](0002-inferencia-en-el-navegador.md)) |
| Supabase (BD + auth + storage) | Concentra todo en un proveedor y su auth es menos flexible para 2FA obligatorio por empresa; Neon + Better Auth deja el control del esquema en Prisma |
| Auth.js (NextAuth) | Sin bloqueo por intentos ni 2FA integrados; Better Auth los trae como plugins |
| AWS S3 | R2 no cobra egress, que es el coste dominante al servir modelos e imágenes |
| Drizzle en lugar de Prisma | Ambos sirven; Prisma tiene mejor soporte en Better Auth y el equipo ya lo conoce |

## Consecuencias

- Positivas: un solo lenguaje (TypeScript) en la web; sin servidores que mantener; previews automáticas por PR; capas gratuitas suficientes para el piloto.
- Negativas o riesgos:
  - Dependencia de varios proveedores (Vercel, Neon, R2, Resend). Se mitiga con variables de entorno y sin código propietario fuera de adaptadores.
  - Límites de las Server Actions en Vercel (tamaño del cuerpo y duración): por eso las imágenes van directas a R2 ([ADR 0005](0005-subida-directa-a-r2.md)).
  - Next.js 16 cambia convenciones respecto a versiones anteriores (`middleware.ts` → `proxy.ts`, tipos globales como `LayoutProps` generados con `next typegen`). La documentación de referencia es `node_modules/next/dist/docs/`.
