# Backups — Vialto (Capa 2: dumps externos)

Estrategia en capas:

- **Capa 1 — PITR / snapshots de Neon:** "deshacer" interno ante un error reciente (limitado en plan free; ver consola de Neon).
- **Capa 2 — este documento:** `pg_dump` nocturno de la rama **production**, guardado en **Cloudflare R2** (storage externo, independiente de Neon).

El backup corre automáticamente vía GitHub Actions: `.github/workflows/db-backup.yml`.

**Dashboard de backups (Cloudflare):**  
https://dash.cloudflare.com/02191c7fc6065df27a1a363ff14bab2d/home

Account ID: `02191c7fc6065df27a1a363ff14bab2d`  
Endpoint S3 de R2: `https://02191c7fc6065df27a1a363ff14bab2d.r2.cloudflarestorage.com`  
Bucket: `vialto-db-backups`

> Los secrets se llaman `S3_*` porque R2 habla el protocolo S3 y el workflow usa `aws s3`. El storage real es **solo Cloudflare R2**, no AWS ni otro proveedor.

---

## Setup inicial (una sola vez)

### 1. Crear / verificar el bucket en Cloudflare R2

1. Entrá al [dashboard de Cloudflare](https://dash.cloudflare.com/02191c7fc6065df27a1a363ff14bab2d/home).
2. Menú → **R2 Object Storage**.
3. Si no hay bucket: **Create bucket** → nombre `vialto-db-backups`. Location: Automatic.
4. **Cifrado en reposo:** R2 cifra los objetos en reposo por defecto (SSE). No hace falta un toggle extra.

### 2. Crear un API Token de R2

1. R2 → **Overview** → **Account Details** → **API Tokens** → **Manage**.
2. **Create API token**.
3. Permisos: **Object Read & Write**; alcance: solo el bucket `vialto-db-backups`.
4. Al crearlo te muestra (una sola vez) **Access Key ID** y **Secret Access Key** — copialos.
5. El token necesita poder **listar y borrar** objetos del bucket (la rotación elimina dumps vencidos).

### 3. Cargar los secrets en GitHub

En el repo → **Settings → Secrets and variables → Actions**:

| Secret | Valor |
|---|---|
| `PROD_DATABASE_URL_UNPOOLED` | Connection string **directa (sin `-pooler`)** de la rama production de Neon |
| `S3_ENDPOINT` | `https://02191c7fc6065df27a1a363ff14bab2d.r2.cloudflarestorage.com` |
| `S3_BUCKET` | `vialto-db-backups` |
| `S3_ACCESS_KEY_ID` | Access Key ID del API Token de R2 |
| `S3_SECRET_ACCESS_KEY` | Secret Access Key del API Token de R2 |

> Estos secrets viven **solo** en GitHub Actions, nunca en el repo.  
> Si había valores viejos de pruebas con otro proveedor, **editá** (Update) cada secret con los valores de R2.

### 4. Rotación (en el workflow, no lifecycle de 30 días)

La rotación la hace el mismo job de backup (no uses una lifecycle rule de “borrar a los 30 días” que contradiga esto):

| Prefijo | Cuántos se conservan | Cuándo se escribe |
|---|---|---|
| `daily/` | **7** más recientes | Cada corrida nocturna |
| `weekly/` | **4** más recientes | Domingos UTC (copia del dump del día) |
| `monthly/` | **6** más recientes | Día 1 de cada mes UTC |

Estructura en el bucket:

```
vialto-db-backups/
  daily/vialto_prod_AAAA-MM-DD_HHMMSS.dump
  weekly/vialto_prod_AAAA-Www.dump
  monthly/vialto_prod_AAAA-MM.dump
```

Si en el bucket hay una lifecycle rule antigua de borrado por días, **eliminála** para no pelear con esta política.

---

## Cómo corre

- **Automático:** todas las noches a las **01:00 ART** (04:00 UTC). Los workflows con `schedule` solo se ejecutan desde la rama **`main`**.
- **Manual:** pestaña **Actions → DB Backup (producción) → Run workflow**.
- Tras dump + upload: promo weekly/monthly si corresponde, y prune 7/4/6.

> Los workflows programados pueden demorarse en horarios de alta carga de GitHub y se desactivan tras 60 días de inactividad del repo. Si dejás de ver backups, revisá que el workflow siga activo.

---

## Cómo restaurar

1. Descargar el dump deseado desde R2 (consola web o aws cli), desde `daily/`, `weekly/` o `monthly/`:

   ```bash
   aws s3 cp s3://vialto-db-backups/daily/<archivo>.dump ./ \
     --endpoint-url https://02191c7fc6065df27a1a363ff14bab2d.r2.cloudflarestorage.com
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
- **Cifrado:** los objetos en R2 están cifrados en reposo (SSE por defecto de Cloudflare).
