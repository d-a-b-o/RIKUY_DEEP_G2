# Autenticación

Inicio de sesión, bloqueo por intentos y recuperación de contraseña con [Better Auth](https://www.better-auth.com) 1.7. HU19 · RIKDP-30: RIKDP-132, RIKDP-133, RIKDP-134, RIKDP-137 y RIKDP-138.

## Piezas

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Configuración | `apps/web/src/lib/auth/server.ts` | Instancia de Better Auth con el adaptador de Prisma, creada al primer uso con `getAuth()` |
| Reglas | `apps/web/src/lib/auth/config.ts` | Duraciones, límites, rutas y mensajes de error. Se puede usar desde el cliente |
| Bloqueo | `apps/web/src/lib/auth/lockout.ts` | Contador de intentos fallidos por cuenta |
| Correo | `apps/web/src/lib/auth/emails.ts` | Enlace de recuperación por Resend |
| Sesión en páginas | `apps/web/src/lib/auth/session.ts` | `getCurrentUser()`: comprueba la sesión en la base y redirige al login si no hay |
| Endpoints | `apps/web/src/app/api/auth/[...all]/route.ts` | API de Better Auth en `/api/auth/*` |
| Proxy | `apps/web/src/proxy.ts` | Comprobación optimista de la cookie en `/panel/*` |
| Pantallas | `/ingresar`, `/recuperar`, `/restablecer`, `/panel` | Formularios de cliente con `authClient` |

## Decisiones

- **Sin registro público.** `disableSignUp: true`. Las cuentas las crea un administrador (HU23, HU30). Mientras tanto, el seed y las pruebas crean usuarios con `createCredentialUser()`, que usa el mismo hash scrypt que Better Auth.
- **Sesión en base de datos**, cookie `HttpOnly`. Dura 8 horas (un turno) y se renueva cada hora de uso.
- **Las pantallas llaman a `/api/auth` desde el navegador** y no desde una Server Action. Así el rate limit de Better Auth, que solo actúa sobre peticiones HTTP, protege también el formulario.
- **Doble comprobación.** `proxy.ts` solo mira si existe la cookie, sin ir a la base, para redirigir rápido. La comprobación que cuenta la hace `getCurrentUser()` en cada página: valida la sesión y que la cuenta siga activa. Los permisos por rol se añaden en HU32.
- **Instancia perezosa.** `getAuth()` crea Better Auth en la primera petición, así `next build` no necesita la base ni `BETTER_AUTH_SECRET`.

## Inicio de sesión y bloqueo (criterio 1)

```mermaid
sequenceDiagram
  participant U as Navegador
  participant A as /api/auth/sign-in/email
  participant DB as Postgres
  U->>A: correo y contraseña
  A->>A: rate limit por IP (10 por minuto)
  A->>DB: ¿cuenta bloqueada o desactivada? (hook before)
  alt bloqueada
    A-->>U: 401 ACCOUNT_LOCKED
  else
    A->>DB: verificar contraseña
    alt incorrecta
      A->>DB: failed_login_count + 1 (hook after)
      A-->>U: 401 INVALID_EMAIL_OR_PASSWORD, o ACCOUNT_LOCKED en el 5.º fallo
    else correcta
      A->>DB: contador a 0 y nueva sesión
      A-->>U: 200 + cookie de sesión
    end
  end
```

- **5 fallos seguidos** bloquean la cuenta **15 minutos**, aunque luego se escriba la contraseña correcta. El contador vive en `user.failed_login_count` y `user.locked_until`. Se incrementa con una sola sentencia SQL `UPDATE … FOR UPDATE`, así dos intentos simultáneos no pueden saltarse el límite.
- Un login correcto o un cambio de contraseña ponen el contador a cero. Al vencer el bloqueo, el siguiente fallo vuelve a contar desde 1.
- Un correo que no existe responde igual que una contraseña incorrecta. Un usuario desactivado (`active = false`) también.
- El bloqueo responde 401 con el código `ACCOUNT_LOCKED`. Usa el mismo estado que una contraseña incorrecta porque Better Auth conserva el estado original cuando el error sale del hook posterior; la pantalla distingue los casos por el código.

### Rate limit (RIKDP-134)

Por IP, guardado en la tabla `rate_limit` para que valga entre las instancias serverless de Vercel:

| Ruta | Límite |
| --- | --- |
| `/sign-in/email` | 10 por minuto |
| `/request-password-reset` | 5 cada 15 minutos |
| `/reset-password` | 10 cada 15 minutos |
| Resto de `/api/auth` | 60 por minuto |

La IP sale de `x-forwarded-for`, que en Vercel pone la propia plataforma. El límite de las demás acciones que escriben datos, por ejemplo el formulario de demo, queda para HU48 (RIKDP-59).

## Recuperación de contraseña (criterios 2 y 3)

1. En `/recuperar` el usuario escribe su correo. La respuesta es **la misma exista o no la cuenta**, y solo se envía correo si existe.
2. El correo, de texto plano y enviado por Resend, lleva el enlace `/restablecer?token=…`. El token **vence en 30 minutos** y es de **un solo uso**: Better Auth borra la verificación al usarla.
3. En `/restablecer` se elige la nueva contraseña (10 a 128 caracteres). Al guardarla, en una sola transacción, se **revocan todas las sesiones** del usuario (`revokeSessionsOnPasswordReset`) y se quita el bloqueo.
4. La página `/restablecer` usa `referrer: no-referrer` para que el token no salga a otros sitios.

Sin `RESEND_API_KEY`, en desarrollo el enlace se escribe en la consola del servidor y en producción solo queda un aviso.

## Pruebas

- `src/lib/auth/auth.test.ts` (integración con Postgres, a través del handler HTTP): login, conteo y bloqueo, desbloqueo al vencer, usuario desactivado, rate limit, mensaje neutro, vencimiento a 30 minutos, revocación de sesiones, token reutilizado y token vencido.
- `src/lib/auth/config.test.ts`: destino seguro tras el login y mensajes de error.
- `e2e/auth.spec.ts` (Playwright):
  - `@smoke`: entrar al panel, cerrar sesión y contraseña incorrecta.
  - `@regression`: bloqueo en pantalla, `?next=` externo, recuperación con mensaje neutro y enlace inválido.

Los casos formales siguen en PT2 (RIKDP-135) y PT4 (RIKDP-136, RIKDP-139).
