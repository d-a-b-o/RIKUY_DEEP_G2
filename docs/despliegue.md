# Base de datos y despliegue

Cómo poner en marcha la base de datos en Neon y el despliegue automático en Vercel.

Tareas: HU13 (RIKDP-24): RIKDP-110 (Neon), RIKDP-111 (esquema y migración), RIKDP-112 (seed), RIKDP-118 (Vercel) y RIKDP-119 (variables de entorno). Autenticación: HU19 (RIKDP-30).

## Resumen

| Entorno | Web | Base de datos | Cuándo se despliega |
| --- | --- | --- | --- |
| Producción | Vercel, dominio de producción | Neon, rama `main` | Al fusionar en `main` |
| Preview | Vercel, una URL por PR | Neon, rama `dev` (o una rama por PR con la integración de Neon) | En cada push a una PR |
| Desarrollo | `npm run dev` | Neon rama `dev` o PostgreSQL local | En tu equipo |

El repositorio no contiene ningún secreto: las variables se configuran en Vercel por entorno y en `apps/web/.env.local` en local (ignorado por git).

## 1. Neon (RIKDP-110)

1. Entra en [console.neon.tech](https://console.neon.tech) y crea el proyecto **rikuydeep**:
   - PostgreSQL 16.
   - La región disponible más cercana a las plantas.
   - Base de datos `rikuydeep`.
2. El proyecto se crea con la rama **`main`**: será la de producción.
3. En *Branches → Create branch*, crea la rama **`dev`** a partir de `main`. Es la de desarrollo y previews.
4. En cada rama, abre *Connect* y copia dos cadenas de conexión:
   - **Con pooler** (el host contiene `-pooler`): va en `DATABASE_URL`, la usa la aplicación.
   - **Directa** (sin `-pooler`): va en `DIRECT_URL`, la usan las migraciones de Prisma.
5. Aplica las migraciones a cada rama desde `apps/web`:

   ```bash
   DIRECT_URL="<cadena directa de dev>" npm run db:deploy
   ```

   ```bash
   DIRECT_URL="<cadena directa de main>" npm run db:deploy
   ```

6. Carga los datos de demostración **solo en `dev`**:

   ```bash
   DIRECT_URL="<cadena directa de dev>" npm run db:seed
   ```

   El seed se niega a ejecutarse en producción salvo que se fuerce con `ALLOW_PRODUCTION_SEED=true`.

   Con `SEED_DEMO_PASSWORD="<contraseña>"` crea además un usuario por rol para probar el login: `superadmin@`, `admin@`, `inspector@` y `consulta@demo.rikuydeep.test`, todos con esa contraseña.

## 2. Vercel (RIKDP-118)

1. En [vercel.com/new](https://vercel.com/new), importa el repositorio `d-a-b-o/RIKUY_DEEP_G2`.
2. Configura el proyecto:

   | Ajuste | Valor |
   | --- | --- |
   | Root Directory | `apps/web` |
   | Framework Preset | Next.js |
   | Build Command | `npm run build:vercel` |
   | Install Command | `npm install` (por defecto) |
   | Node.js Version | 22.x |

   `build:vercel` ejecuta `prisma migrate deploy` antes de `next build`, así cada despliegue aplica las migraciones pendientes a su base de datos. `npm install` genera el cliente de Prisma automáticamente (`postinstall`).

3. Crea las variables de entorno (*Settings → Environment Variables*), cada una en su entorno:

   | Variable | Production | Preview | Development |
   | --- | --- | --- | --- |
   | `DATABASE_URL` | Neon `main` con pooler | Neon `dev` con pooler | Neon `dev` con pooler |
   | `DIRECT_URL` | Neon `main` directa | Neon `dev` directa | Neon `dev` directa |
   | `BETTER_AUTH_SECRET` | Secreto propio | Otro secreto propio | Otro secreto propio |
   | `RESEND_API_KEY` | Clave de producción | Clave de pruebas (opcional) | — |
   | `LEAD_NOTIFICATION_TO` | Correo del equipo comercial | Correo del equipo | — |
   | `LEAD_NOTIFICATION_FROM` | Remitente verificado | `RikuyDeep <onboarding@resend.dev>` | — |
   | `NEXT_PUBLIC_SITE_URL` | Dominio propio, si lo hay | — | — |

   `BETTER_AUTH_SECRET` es **obligatoria**: sin ella el sitio compila, pero el login y `/panel` fallan en producción. Genera un valor distinto para cada entorno con `openssl rand -base64 32`. Si se cambia, se cierran todas las sesiones abiertas.

4. Despliega. Desde ahí:
   - cada PR recibe una **URL de preview** que Vercel comenta en la PR;
   - cada fusión en `main` despliega a **producción**.

### Alternativa recomendada: una base por PR

En vez de compartir la rama `dev` entre todas las previews, la [integración de Neon con Vercel](https://vercel.com/integrations/neon) crea una rama de base de datos por cada preview y configura sola sus variables, `DATABASE_URL` y `DATABASE_URL_UNPOOLED`. Prisma acepta ambas (`prisma.config.ts`), así que no hay que tocar código. Evita que dos PRs con migraciones distintas se pisen en la misma base.

## 3. Correo con Resend (aviso de solicitudes de demo)

1. Crea una cuenta en [resend.com](https://resend.com) y una API key con permiso de envío.
2. Para enviar desde un dominio propio, verifícalo en *Domains* y usa ese remitente en `LEAD_NOTIFICATION_FROM`. Sin dominio, `onboarding@resend.dev` solo puede enviar al correo de la cuenta de Resend.
3. Sin `RESEND_API_KEY`, las solicitudes de demo **se guardan igual** en la tabla `lead`; solo se omite el aviso por correo.

## 4. Variables de entorno

Referencia completa con valores de ejemplo en [`apps/web/.env.example`](../apps/web/.env.example).

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | Sí | Conexión de la aplicación (con pooler en Neon) |
| `DIRECT_URL` | Para migraciones y seed | Conexión directa para Prisma Migrate. Si falta, se usa `DATABASE_URL_UNPOOLED` o `DATABASE_URL` |
| `BETTER_AUTH_SECRET` | Sí, en producción | Firma de sesiones y tokens de Better Auth (HU19) |
| `AUTH_EMAIL_FROM` | No | Remitente del correo de recuperación de contraseña. Si falta, se usa `LEAD_NOTIFICATION_FROM` |
| `SEED_DEMO_PASSWORD` | No | Contraseña de los usuarios de demostración del seed |
| `RESEND_API_KEY` | No | Envío del aviso de nuevos leads y del correo de recuperación de contraseña. Sin ella, en desarrollo el enlace de recuperación se escribe en la consola |
| `LEAD_NOTIFICATION_TO` | Con Resend | Destinatarios del aviso, separados por comas |
| `LEAD_NOTIFICATION_FROM` | No | Remitente del aviso |
| `NEXT_PUBLIC_SITE_URL` | No | URL pública para metadatos y sitemap. En Vercel se deduce del dominio de producción |

Sin `DATABASE_URL`, la web funciona pero el formulario de demo avisa de que el envío no está activo y no guarda nada.

## 5. Cambiar el esquema

1. Edita `apps/web/prisma/schema.prisma`.
2. Ejecuta `npm run db:migrate -- --name descripcion-del-cambio`: crea la migración en `prisma/migrations/` y la aplica a tu base local.
3. Haz commit del esquema y de la migración juntos.
4. El CI comprueba que la migración se aplica sobre una base vacía (`db:deploy`) y que no quedan cambios sin migrar (`db:check`). Al fusionar, Vercel la aplica en producción.

La migración inicial añade reglas que Prisma no expresa, escritas a mano en SQL: los triggers de inmutabilidad de `inspection` e `inspection_event` (ADR 0004) y las restricciones de integridad. Están cubiertas por `apps/web/prisma/integrity.test.ts`. Prisma no las elimina en migraciones posteriores.

## 6. Comprobación tras el primer despliegue

- [ ] La URL de producción carga la landing.
- [ ] `/robots.txt` y `/sitemap.xml` usan el dominio de producción.
- [ ] Enviar el formulario de demo muestra «Recibimos tu solicitud».
- [ ] El lead aparece en la tabla `lead` de la rama `main` (*Neon → Tables*).
- [ ] Si Resend está configurado, llega el correo de aviso.
- [ ] Una PR nueva recibe su URL de preview.
- [ ] `/ingresar` permite entrar con un usuario creado por el seed (en `dev`) y `/panel` muestra su nombre y rol.
- [ ] «¿Olvidaste tu contraseña?» envía el correo de recuperación (con Resend configurado).
