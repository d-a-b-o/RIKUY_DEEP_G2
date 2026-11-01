# authz · Control de acceso por rol (HU32 · RIKDP-43)

Fuente única de permisos de RikuyDeep. Middleware, server actions, rutas de API y menús consultan este módulo; ninguno compara nombres de rol por su cuenta.

## Matriz de permisos

| Permiso | Superadmin | Admin de planta | Inspector | Visualizador |
|---|:-:|:-:|:-:|:-:|
| empresas:gestionar | ✅ | | | |
| modelos:gestionar | ✅ | | | |
| usuarios:gestionar | ✅ | ✅ | | |
| catalogos:gestionar | ✅ | ✅ | | |
| auditoria:ver | ✅ | ✅ | | |
| inspecciones:crear | ✅ | ✅ | ✅ | |
| veredictos:corregir | ✅ | ✅ | ✅ | |
| catalogos:ver | ✅ | ✅ | ✅ | ✅ |
| inspecciones:ver | ✅ | ✅ | ✅ | ✅ |
| dashboard:ver | ✅ | ✅ | ✅ | ✅ |
| reportes:descargar | ✅ | ✅ | ✅ | ✅ |

Salvo el Superadmin, nadie puede actuar sobre recursos de otra empresa (`OTRA_EMPRESA`).

## Uso

```ts
import { authorize, can, ForbiddenError, forbiddenResponse } from "@/lib/authz";

// Server action o ruta de API: corta con 403 y registra el intento
await authorize(user, "catalogos:gestionar", { empresaId: pieza.empresaId, path: "crearPieza" });

// Ruta de API
try { await authorize(user, "usuarios:gestionar"); }
catch (e) { if (e instanceof ForbiddenError) return forbiddenResponse(e); throw e; }

// Interfaz: solo para ocultar botones; la protección real es authorize()
{can(user, "usuarios:gestionar") && <BotonNuevoUsuario />}
```

## Pendiente (depende de HU08, HU13 y HU19)

- **HU32-T02 · RIKDP-180:** `src/proxy.ts` (en Next.js 16 reemplaza a `middleware.ts`) que use `requiredPermission(pathname)` con la sesión de Better Auth y responda 403.
- **HU32-T03 · RIKDP-181:** tabla `AccesoDenegado` en Prisma y `setDeniedAccessLogger()` para guardar cada intento.

## Pruebas

`authz.test.ts` (Vitest): matriz, aislamiento por empresa, 403 y registro de denegados.
