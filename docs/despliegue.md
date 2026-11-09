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

7. Crea el **superadministrador de producción** con tu correo real (HU23). Desde `apps/web`:

   ```bash
   DIRECT_URL="<cadena directa de main>" npm run create:superadmin
   ```

   El script muestra a qué base se va a conectar y pide escribir `SI` antes de escribir nada. Luego pide el nombre, el correo y la contraseña (de 10 a 128 caracteres), que no se muestra en pantalla ni queda en el historial. Usa `DIRECT_URL` antes que `DATABASE_URL`, y lo pasado en la línea de comandos tiene prioridad sobre `.env.local`. Si el correo ya tiene cuenta, no cambia nada. Para cambiar la contraseña después, usa «¿Olvidaste tu contraseña?» en `/ingresar`.

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
   | `NEXT_PUBLIC_MODEL_MANIFEST_URL` | URL del manifest en R2 | La misma | La misma |
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

## 3. Modelos de IA en Cloudflare R2

El navegador descarga el modelo TF.js desde un bucket público de R2 ([ADR 0006](adr/0006-manifest-de-modelos.md), [inferencia en el navegador](arquitectura/inferencia-navegador.md)).

| Dato | Valor |
| --- | --- |
| URL pública | `https://bucket.d-a-b-o.dev` (dominio propio conectado al bucket) |
| Manifest oficial | `manifest.json` en la raíz: lo escribe la publicación del notebook tras el quality gate (HU25) |
| Manifest provisional | `dev/manifest.json` con la versión 0.9.0, sin quality gate, para demos y desarrollo |

Configuración del bucket:

1. **Acceso público** por el dominio propio (*Settings → Public access → Custom domains*). `r2.dev` sirve para pruebas pero tiene límites de uso.
2. **CORS** (*Settings → CORS Policy*): solo lectura para cualquier origen. El contenido es público y la escritura la protege el token, así que restringir orígenes solo rompería las previews de Vercel.

   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag", "Content-Length"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

3. **Sin desafíos de Cloudflare** en ese subdominio. TF.js descarga con `fetch` y no puede resolver un desafío de bots: si el dominio tiene reglas de seguridad, añadir una regla WAF que haga *Skip* para `bucket.d-a-b-o.dev`.
4. **Token de publicación** (*R2 → Manage R2 API Tokens*): permiso *Object Read & Write* solo sobre este bucket. Sus cuatro valores (`R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_MODELS_BUCKET`) van en los secretos de Colab, nunca en el repositorio ni en Vercel. `R2_ENDPOINT_URL` es `https://<account-id>.r2.cloudflarestorage.com`, sin el nombre del bucket.

Comprobación:

```bash
curl -sI -H "Origin: https://ejemplo.com" https://bucket.d-a-b-o.dev/dev/v0.9.0/model.json
```

Debe responder `200`, `access-control-allow-origin: *` y `cache-control: public, max-age=31536000, immutable`.

En Vercel, `NEXT_PUBLIC_MODEL_MANIFEST_URL` apunta al manifest. Como empieza por `NEXT_PUBLIC_`, se fija al compilar: después de cambiarla hay que volver a desplegar.

### Imágenes de inspección (HU24, RIKDP-150)

Las fotos de las inspecciones van en un bucket **distinto y privado** ([ADR 0005](adr/0005-subida-directa-a-r2.md)). El navegador nunca recibe credenciales: el servidor firma URLs que caducan a los 5 minutos (`src/lib/storage/r2.ts`) y decide la clave del objeto (`companies/{company_id}/inspections/{yyyy}/{mm}/{uuid}.jpg`).

1. **Bucket privado**, sin acceso público ni dominio propio (por ejemplo `rikuy-imagenes` y `rikuy-imagenes-dev`).
2. **CORS** para que el navegador suba la foto con `PUT`. Aquí sí se restringen los orígenes, porque la URL firmada permite escribir:

   ```json
   [
     {
       "AllowedOrigins": ["https://<dominio-de-produccion>", "https://*.vercel.app", "http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. **Token** con permiso *Object Read & Write* solo sobre el bucket de imágenes. En Vercel, por entorno: `R2_ENDPOINT_URL`, `R2_IMAGES_BUCKET`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`. Es un token distinto del de publicación de modelos, que vive en los secretos de Colab.
4. **Regla de ciclo de vida** opcional para borrar objetos huérfanos (subidos pero nunca registrados), como indica el ADR 0005.

Sin estas variables la app funciona, pero no puede registrar inspecciones que guardan foto: responde `STORAGE_NOT_CONFIGURED`.

## 4. Correo con Resend (aviso de solicitudes de demo)

1. Crea una cuenta en [resend.com](https://resend.com) y una API key con permiso de envío.
2. Para enviar desde un dominio propio, verifícalo en *Domains* y usa ese remitente en `LEAD_NOTIFICATION_FROM`. Sin dominio, `onboarding@resend.dev` solo puede enviar al correo de la cuenta de Resend.
3. Sin `RESEND_API_KEY`, las solicitudes de demo **se guardan igual** en la tabla `lead`; solo se omite el aviso por correo.

## 5. Variables de entorno

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
| `NEXT_PUBLIC_MODEL_MANIFEST_URL` | Para inspeccionar | URL del manifest de modelos en R2. Sin ella, `/panel/inspeccion` avisa de que falta |

Sin `DATABASE_URL`, la web funciona pero el formulario de demo avisa de que el envío no está activo y no guarda nada.

## 6. Cambiar el esquema

1. Edita `apps/web/prisma/schema.prisma`.
2. Ejecuta `npm run db:migrate -- --name descripcion-del-cambio`: crea la migración en `prisma/migrations/` y la aplica a tu base local.
3. Haz commit del esquema y de la migración juntos.
4. El CI comprueba que la migración se aplica sobre una base vacía (`db:deploy`) y que no quedan cambios sin migrar (`db:check`). Al fusionar, Vercel la aplica en producción.

La migración inicial añade reglas que Prisma no expresa, escritas a mano en SQL: los triggers de inmutabilidad de `inspection` e `inspection_event` (ADR 0004) y las restricciones de integridad. Están cubiertas por `apps/web/prisma/integrity.test.ts`. Prisma no las elimina en migraciones posteriores.

## 7. Comprobación tras el primer despliegue

- [ ] La URL de producción carga la landing.
- [ ] `/robots.txt` y `/sitemap.xml` usan el dominio de producción.
- [ ] Enviar el formulario de demo muestra «Recibimos tu solicitud».
- [ ] El lead aparece en la tabla `lead` de la rama `main` (*Neon → Tables*).
- [ ] Si Resend está configurado, llega el correo de aviso.
- [ ] Una PR nueva recibe su URL de preview.
- [ ] `/ingresar` permite entrar con un usuario creado por el seed (en `dev`) y `/panel` muestra su nombre y rol.
- [ ] «¿Olvidaste tu contraseña?» envía el correo de recuperación (con Resend configurado).
- [ ] `/panel/inspeccion` carga el modelo y clasifica una foto de una pieza.
