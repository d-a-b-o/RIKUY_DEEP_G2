# RikuyDeep · Aplicación web (apps/web)

Next.js 16 (App Router) + TypeScript + Tailwind CSS 4. Creada en HU08-T04 (RIKDP-267).

## Requisitos

- Node.js 20.9 o superior

## Comandos

```bash
cd apps/web
npm install      # instalar dependencias
npm run dev      # servidor local en http://localhost:3000
npm run build    # compilación de producción
npm run lint     # ESLint
npm test         # pruebas unitarias (Vitest)
```

## Estructura

```
apps/web/
├── src/app/         # rutas (App Router): layout.tsx, page.tsx, globals.css
├── public/          # archivos estáticos
└── next.config.ts
```

Alias de importación: `@/` apunta a `src/`, por ejemplo `import { authorize } from "@/lib/authz"`.

## Despliegue en Vercel

Al importar el repositorio en Vercel, configurar **Root Directory = `apps/web`**. El resto (framework, comando de build) se detecta solo.

## Nota sobre Next.js 16

El antiguo `middleware.ts` ahora se llama **`proxy.ts`** (va en `src/proxy.ts`). Las protecciones por rol de HU32 deben ir ahí.
