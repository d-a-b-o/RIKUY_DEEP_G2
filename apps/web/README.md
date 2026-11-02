# RikuyDeep · Aplicación web (apps/web)

Next.js 16 (App Router) + TypeScript + Tailwind CSS 4. Creada en HU08-T04 (RIKDP-267).

## Requisitos

- Node.js 20.9 o superior

## Primera vez

```bash
cd apps/web
cp .env.example .env.local   # completa DATABASE_URL y DIRECT_URL
npm install                  # también genera el cliente de Prisma
npm run db:migrate           # aplica las migraciones a tu base de datos
npm run db:seed              # datos de demostración (idempotente)
```

La base de datos puede ser la rama `dev` de Neon o un PostgreSQL 16 local. Detalle en [docs/despliegue.md](../../docs/despliegue.md).

## Comandos

```bash
npm run dev          # servidor local en http://localhost:3000
npm run build        # compilación de producción
npm run lint         # ESLint
npm run typecheck    # tipos (next typegen + tsc)
npm test             # pruebas (Vitest); las de base de datos se ejecutan si hay DATABASE_URL
npm run test:e2e     # pruebas de sistema (Playwright); requiere npm run build antes
npm run test:smoke   # solo la prueba de humo (@smoke), la misma que corre en CI
npm run db:migrate   # crea y aplica una migración tras cambiar prisma/schema.prisma
npm run db:deploy    # aplica migraciones pendientes (CI y Vercel)
npm run db:check     # falla si el esquema tiene cambios sin migración
npm run db:seed      # datos de demostración
```

## Estructura

```
apps/web/
├── e2e/                  # pruebas de sistema con Playwright (Page Objects en e2e/pages/)
├── prisma/
│   ├── schema.prisma     # modelo de datos (docs/arquitectura/modelo-datos.md)
│   ├── migrations/       # migraciones versionadas
│   └── seed.ts           # datos de demostración
├── src/app/              # rutas (App Router)
├── src/components/       # componentes (landing, marca)
├── src/lib/              # lógica compartida: db.ts, leads/, model/
├── src/generated/        # cliente de Prisma generado (no se versiona)
├── public/               # archivos estáticos
├── playwright.config.ts
├── prisma.config.ts
└── next.config.ts
```

Estrategia, niveles y criterios de prueba: [docs/pruebas/plan-de-pruebas.md](../../docs/pruebas/plan-de-pruebas.md). La primera vez, instala el navegador con `npx playwright install chromium`.

Alias de importación: `@/` apunta a `src/`, por ejemplo `import { authorize } from "@/lib/authz"`.

## Despliegue en Vercel

Al importar el repositorio en Vercel, configurar **Root Directory = `apps/web`** y **Build Command = `npm run build:vercel`**, que aplica las migraciones antes de compilar. Variables de entorno y pasos completos en [docs/despliegue.md](../../docs/despliegue.md).

## Nota sobre Next.js 16

El antiguo `middleware.ts` ahora se llama **`proxy.ts`** (va en `src/proxy.ts`). Las protecciones por rol de HU32 deben ir ahí.
