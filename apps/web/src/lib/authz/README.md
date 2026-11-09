# authz · Control de acceso por rol (HU32 · RIKDP-43)

Fuente única de permisos de RikuyDeep. Middleware, server actions, rutas de API y menús consultan este módulo; ninguno compara nombres de rol por su cuenta.

## Matriz de permisos

Los roles son los del enum `Role` de Prisma: `SUPERADMIN`, `ADMIN` (admin de planta), `INSPECTOR`, `VIEWER` (visualizador) y `STATION` (cuenta técnica de una estación, ADR 0007).

| Permiso | SUPERADMIN | ADMIN | INSPECTOR | VIEWER | STATION |
|---|:-:|:-:|:-:|:-:|:-:|
| empresas:gestionar | ✅ | | | | |
| modelos:gestionar | ✅ | | | | |
| leads:gestionar | ✅ | | | | |
| monitoreo:ver | ✅ | | | | |
| auditoria:ver | ✅ | ✅ | | | |
| usuarios:gestionar | | ✅ | | | |
| catalogos:gestionar | | ✅ | | | |
| estaciones:gestionar | | ✅ | | | |
| inspecciones:crear | | ✅ | ✅ | | ✅ |
| estacion:operar | | | | | ✅ |
| veredictos:corregir | | ✅ | ✅ | | |
| catalogos:ver | | ✅ | ✅ | ✅ | ✅ |
| inspecciones:ver | | ✅ | ✅ | ✅ | |
| dashboard:ver | | ✅ | ✅ | ✅ | |
| reportes:descargar | | ✅ | | ✅ | |

El Superadmin opera la plataforma (empresas, modelos, leads, monitoreo y auditoría), no la planta: no pertenece a ninguna empresa, así que no inspecciona, no corrige veredictos y no ve datos de los clientes. Coincide con las reglas de trazabilidad de `src/lib/inspections/rules.ts` (HU24).

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

## Dónde se protege (HU32-T02 · RIKDP-180)

Tres barreras, de fuera hacia dentro. Cada una consulta esta matriz:

1. **Proxy** (`src/proxy.ts`, el antiguo `middleware.ts` en Next.js 16). Para `/panel/*` lee la sesión de Better Auth y, si la ruta está en `ROUTE_RULES` y el rol no alcanza, responde **403** antes de renderizar:
   - Navegación directa: la página `/panel/sin-permiso` con estado 403. La URL no cambia.
   - Navegación interna (RSC o prefetch): reescritura a la misma página.
   - Otros métodos (p. ej. el POST de una server action): `{"error":"forbidden"}` con 403.

   La decisión está en `route-access.ts` para probarla sin levantar Next.js.
2. **Páginas**: `getPageAccess(path, permiso)` (`src/lib/auth/session.ts`) muestra el aviso si el rol no alcanza.
3. **Server actions y servicios**: `authorize()` antes de tocar datos. Por ejemplo, `src/app/panel/inspeccion/actions.ts` exige `inspecciones:crear` o `veredictos:corregir`, y `src/lib/companies/service.ts` exige `empresas:gestionar`.

Los menús (`src/components/panel/role-nav.tsx`) usan `can()` solo para ocultar enlaces.

Para una pantalla nueva:
- Agrega su prefijo a `ROUTE_RULES` (`routes.ts`).
- Llama a `getPageAccess` en la página y a `authorize` en sus acciones.
- Agrega el enlace con su permiso en `role-nav.tsx`.

## Registro de accesos denegados (HU32-T03 · RIKDP-181)

Cada intento denegado, venga del proxy, de una página o de una acción, se guarda en la tabla `access_denied_log`:

| Columna | Contenido |
|---|---|
| `user_id`, `company_id` | Usuario y empresa del intento |
| `method` | `GET`, `POST`… o `ACTION` si viene de una server action o un servicio |
| `path` | Ruta o nombre de la acción |
| `action` | `permiso · MOTIVO`, p. ej. `empresas:gestionar · SIN_PERMISO` |
| `ip_hash` | HMAC-SHA256 de la IP con `BETTER_AUTH_SECRET`; la IP no se guarda |

- `src/instrumentation.ts` instala el registrador de base de datos al arrancar el servidor (`denied-log.ts`). El registrador vive en `globalThis` porque Next.js empaqueta por separado `instrumentation.ts`, las páginas y las acciones.
- Si el registro falla, el acceso sigue denegado.
- **Consulta:** `/panel/admin/auditoria`, con el permiso `auditoria:ver`. El Admin de planta ve los intentos de su empresa; el Superadmin, los de todas.

## Pruebas

| Archivo | Qué cubre |
|---|---|
| `authz.test.ts` (Vitest) | Matriz, aislamiento por empresa, 403, registro de denegados, `clientIp` y reglas de rutas |
| `route-access.test.ts` (Vitest) | Decisiones del proxy |
| `denied-log.test.ts` (Vitest + Postgres) | Formato de la fila, hash de la IP, escritura en `access_denied_log` y filtro por empresa de la consulta |
| `e2e/authz.spec.ts` (Playwright) | 403 real en el navegador y la pantalla de auditoría |
