# Backups — Vialto (Capa 2: dumps externos)

Estrategia en capas:

- **Capa 1 — PITR / snapshots de Neon:** "deshacer" interno ante un error reciente (limitado en plan free; ver consola de Neon).
- **Capa 2 — este documento:** `pg_dump` nocturno de la rama **production**, guardado en **Cloudflare R2** (storage externo, independiente de Neon).

El backup corre automáticamente vía GitHub Actions: `.github/workflows/db-backup.yml`.

---

## Setup inicial (una sola vez)

### 1. Crear el bucket en Cloudflare R2

1. En el dashboard de Cloudflare, ir a **R2** (si es la primera vez, habilitar R2 — pide una tarjeta pero el tier de 10 GB es gratis).
2. **Create bucket** → nombre (ej. `vialto-db-backups`). Location: Automatic.
3. Anotar el **endpoint S3** del bucket. Tiene la forma:
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   (lo ves en *R2 → Overview* o en la pestaña *Settings* del bucket, como "S3 API").

### 2. Crear un API Token de R2

1. **R2 → Manage R2 API Tokens → Create API Token**.
2. Permisos: **Object Read & Write**; alcance: solo ese bucket.
3. Al crearlo te muestra (una sola vez) un **Access Key ID** y un **Secret Access Key** — copialos.

### 3. Cargar los secrets en GitHub

En el repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor |
|---|---|
| `PROD_DATABASE_URL_UNPOOLED` | Connection string **directa (sin `-pooler`)** de la rama production de Neon |
| `S3_ENDPOINT` | Endpoint S3 de R2 (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`) |
| `S3_BUCKET` | Nombre del bucket |
| `S3_ACCESS_KEY_ID` | Access Key ID del API Token |
| `S3_SECRET_ACCESS_KEY` | Secret Access Key del API Token |

> La `PROD_DATABASE_URL_UNPOOLED` vive **solo** acá (en los secrets), nunca en el repo.
> Los secrets usan nombres genéricos `S3_*`, así que si en el futuro cambiás de proveedor S3-compatible solo actualizás los valores, no el workflow.

### 4. Configurar la rotación (Lifecycle Rule del bucket)

En el bucket de R2 → **Settings → Object lifecycle rules → Add rule**:

- Aplicar a todos los objetos (o al prefijo `daily/`).
- Acción: **Delete objects** N días después de creados (ej. **30 días**).

Con eso, los dumps de más de 30 días se borran solos y no hace falta lógica de rotación en el workflow.

---

## Cómo corre

- **Automático:** todas las noches a las **01:00 ART** (04:00 UTC). Los workflows con `schedule` solo se ejecutan desde la rama **`main`**, así que el archivo debe estar mergeado a main.
- **Manual:** pestaña **Actions → DB Backup (producción) → Run workflow**.
- Cada corrida sube un archivo `vialto_prod_AAAA-MM-DD_HHMMSS.dump` a `s3://<bucket>/daily/`.

> Los workflows programados pueden demorarse en horarios de alta carga de GitHub y se desactivan tras 60 días de inactividad del repo. Si dejás de ver backups, revisá que el workflow siga activo.

---

## Cómo restaurar

1. Descargar el dump deseado desde R2 (consola web o aws cli):

   ```bash
   aws s3 cp s3://<bucket>/daily/<archivo>.dump ./ \
     --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

2. **Importante:** restaurar **siempre en una base/rama de prueba primero**, nunca directo sobre producción. Lo más seguro es crear una rama scratch en Neon y restaurar ahí:

   ```bash
   pg_restore -v --no-owner --no-privileges -d "<connection_string_rama_scratch>" <archivo>.dump
   ```

3. Verificar la data (ej. contar facturas, revisar totales de algún tenant) antes de tomar cualquier acción sobre producción.

---

## Test de restore (mensual)

Un dump que nunca se restauró no es un backup. Una vez por mes:

1. Crear una rama scratch en Neon (ej. `restore-test`).
2. Restaurar el último dump ahí con el comando de arriba.
3. Validar un par de registros (facturas / cuenta corriente de un tenant).
4. Borrar la rama scratch.

---

## Notas

- **Versión de `pg_dump`:** el workflow instala el client 17, que sirve para dumpear servidores PG 16 o 17 (la regla es: versión del client ≥ versión del servidor). Si tu Neon usa una versión mayor, actualizar el `postgresql-client-XX` en el workflow.
- **RPO:** con dump nocturno se pueden perder hasta 24 h de datos. Para una ventana más fina, combinar con la Capa 1 (PITR de Neon).
- **Conexión:** siempre la URL **unpooled** (directa), nunca el pooler.
