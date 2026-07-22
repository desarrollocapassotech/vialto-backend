# Backups y recuperación — Vialto

Guía operativa para el equipo. Cualquier persona con los accesos listados abajo debería poder entender el backup y ejecutar un restore **sin depender de quien lo armó**.

Workflow: `.github/workflows/db-backup.yml`  
Repo: https://github.com/desarrollocapassotech/vialto-backend

> **Storage:** Cloudflare **R2** (no Backblaze B2). Los secrets de GitHub se llaman `S3_*` porque R2 usa API compatible con S3; el destino real es solo Cloudflare.

---

## 1. Cómo funciona el backup

### Qué se respalda

- Dump lógico completo (`pg_dump -Fc`) de la rama **production** de Neon (proyecto `vialto`, DB `neondb`).
- Incluye **toda** la base: todos los tenants, facturas, pagos, cuenta corriente, viajes, stock, etc.
- **No** incluye: Firestore (checklist en tiempo real), Cloudinary, Clerk, ni variables de Render.

### Cuándo corre

| Modo | Cuándo |
|---|---|
| Automático | Todas las noches a las **01:00 ART** (04:00 UTC). Cron: `0 4 * * *` |
| Manual | GitHub → **Actions** → **DB Backup (producción)** → **Run workflow** |

Los schedules de GitHub Actions **solo corren desde `main`**. Si el workflow no está mergeado a `main`, no hay backup nocturno.

### Dónde queda guardado

| Dato | Valor |
|---|---|
| Proveedor | Cloudflare R2 |
| Dashboard | https://dash.cloudflare.com/02191c7fc6065df27a1a363ff14bab2d/home |
| Account ID | `02191c7fc6065df27a1a363ff14bab2d` |
| Bucket | `vialto-db-backups` |
| Endpoint S3 | `https://02191c7fc6065df27a1a363ff14bab2d.r2.cloudflarestorage.com` |

Estructura:

```
vialto-db-backups/
  daily/vialto_prod_AAAA-MM-DD_HHMMSS.dump
  weekly/vialto_prod_AAAA-Www.dump
  monthly/vialto_prod_AAAA-MM.dump
```

### Cómo está cifrado

R2 cifra los objetos **en reposo** por defecto (SSE de Cloudflare). El acceso al bucket es privado: hace falta API token o login al dashboard. No hay dumps en el repositorio Git.

### Rotación (cuánto tiempo se conserva)

La hace el mismo workflow (no usar lifecycle de “borrar a los 30 días”):

| Prefijo | Conserva | Cuándo se escribe |
|---|---|---|
| `daily/` | **7** dumps más recientes | Cada corrida nocturna |
| `weekly/` | **4** dumps más recientes | Domingos UTC |
| `monthly/` | **6** dumps más recientes | Día 1 de cada mes UTC |

### RPO (pérdida máxima de datos)

Con dump nocturno se pueden perder hasta **~24 h** de datos posteriores al último dump. Para errores recientes dentro de Neon, usar también la **Capa 1** (PITR / restore de branch en Neon; historial limitado en plan free).

### Conexión usada

Siempre la URL **directa / unpooled** de production (`PROD_DATABASE_URL_UNPOOLED` en GitHub Secrets). Nunca el host con `-pooler`.

---

## 2. Restore por tenant (un solo cliente)

**Sí.** Podés recuperar **solo** un tenant desde un dump nocturno **sin** restaurar toda production ni pisar otros clientes.

### Idea general

| Paso | Qué pasa |
|---|---|
| 1 | Descargás el dump de R2 (igual que un restore completo) |
| 2 | Restaurás el dump en una **rama scratch** de Neon (`pg_restore`) |
| 3 | Corrés el script `scripts/tenant-restore/restore-tenant.sh` |
| 4 | El script **borra solo ese tenant** en el destino e **inserta** sus filas desde la scratch |

La production (u otra rama destino) **no** recibe `pg_restore --clean` completo. Solo se tocan filas con `"tenantId" = clerkOrgId` del tenant elegido (más la fila en `tenants`).

**Requisitos:** `psql` ≥ 17 (PostgreSQL client). En Windows: **Git Bash** + PostgreSQL 17 en PATH (ver §2.1).

### Archivos del script

| Archivo | Uso |
|---|---|
| [`restore-tenant.sh`](./scripts/tenant-restore/restore-tenant.sh) | Export CSV desde SOURCE → purge + insert en TARGET |
| [`count-tenant-rows.sh`](./scripts/tenant-restore/count-tenant-rows.sh) | Conteos por tabla / comparar SOURCE vs TARGET |
| [`run-test.sh`](./scripts/tenant-restore/run-test.sh) | Wrapper que lee `.test-env.local` |
| [`test-env.example`](./scripts/tenant-restore/test-env.example) | Plantilla de config (copiar a `.test-env.local`) |
| [`tables.conf`](./scripts/tenant-restore/tables.conf) | Orden de tablas FK (actualizar al agregar modelos Prisma) |

### Variables

| Variable | Descripción |
|---|---|
| `SOURCE_DATABASE_URL` | Connection string **Direct** de la scratch con el dump restaurado |
| `TARGET_DATABASE_URL` | Connection string **Direct** del destino (production u otra rama) |
| `TENANT_CLERK_ORG_ID` | `clerkOrgId` del org en Clerk — **copiar del SQL**, no escribir a mano |
| `DRY_RUN=1` | Solo muestra conteos; **no escribe** |
| `CONFIRM_APPLY=YES` | Obligatorio para aplicar cambios en TARGET |

---

### 2.1 Guía Windows (probada en Git Bash)

#### Prerrequisitos

- PostgreSQL **17** instalado (`C:\Program Files\PostgreSQL\17\bin\psql.exe`)
- **Git Bash** (no PowerShell para el script de restore)
- Acceso Neon + dump en R2

Agregar al PATH en Git Bash (opcional):

```bash
export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
```

#### Dos ramas Neon (prueba completa)

| Rama | Rol | Qué hacer |
|---|---|---|
| `restore-tenant-source` (nombre libre) | **SOURCE** | `pg_restore` del dump nocturno |
| `restore-tenant-target` (nombre libre) | **TARGET** | Destino de prueba — **no** usar `production` la primera vez |

Ambas: **Branches → Create branch → Parent: production**.

#### URLs: Direct, sin pooler, entre comillas

En Neon → **Connect** → **Direct connection** (host **sin** `-pooler`).

En `.test-env.local` las URLs van **entre comillas dobles** (obligatorio si llevan `&`):

```bash
SOURCE_DATABASE_URL="postgresql://neondb_owner:PASSWORD@ep-xxx.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require"
TARGET_DATABASE_URL="postgresql://neondb_owner:PASSWORD@ep-yyy.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require"
TENANT_CLERK_ORG_ID=org_XXXXXXXXXXXXXXXXXXXXX
```

**No commitear** `.test-env.local` (está en `.gitignore`).

#### Config rápida

```bash
cd vialto-backend/scripts/tenant-restore
cp test-env.example .test-env.local
# Editar .test-env.local con las URLs Direct y el clerkOrgId
chmod +x *.sh
```

#### Elegir el tenant correcto

El tenant debe existir **en el dump** (rama SOURCE), no solo en production actual.

```sql
-- En la rama SOURCE (después del pg_restore)
SELECT "clerkOrgId", name FROM tenants ORDER BY name;
```

Copiá el `clerkOrgId` **desde el resultado SQL** (Ctrl+C). Un carácter mal → `tenant no encontrado en SOURCE`.

> Si un cliente se creó **después** del dump, no estará en SOURCE. Elegí otro dump o fecha.

#### pg_restore en SOURCE (CMD, no Git Bash)

```cmd
"C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -v --no-owner --no-privileges --clean --if-exists -d "postgresql://USER:PASS@HOST-SOURCE-DIRECT/neondb?sslmode=require" "C:\Users\TU_USUARIO\Downloads\vialto_prod_XXXX.dump"
```

#### Controles antes de aplicar (rama TARGET)

Anotar conteos de **otros** tenants (reemplazá el ID del tenant que vas a restaurar):

```sql
SELECT COUNT(*) AS facturas_otros FROM facturas WHERE "tenantId" <> 'org_TENANT_A_RESTAURAR';
SELECT COUNT(*) AS viajes_otros   FROM viajes   WHERE "tenantId" <> 'org_TENANT_A_RESTAURAR';
SELECT COUNT(*) AS clientes_otros FROM clientes WHERE "tenantId" <> 'org_TENANT_A_RESTAURAR';
```

#### Ejecutar el script (Git Bash)

```bash
DRY_RUN=1 bash run-test.sh              # preview — no escribe
CONFIRM_APPLY=YES bash run-test.sh      # aplicar en TARGET
```

**Salida esperada al OK:**

- Varios `COPY N` al exportar desde SOURCE
- `Control OK: otros tenants sin cambios`
- Conteos SOURCE vs TARGET iguales para el tenant
- `Restore por tenant completado.`

#### Limpiar

Neon → borrar ramas `restore-tenant-source` y `restore-tenant-target`.

---

### 2.2 Procedimiento incidente real (resumen)

1. Identificar `clerkOrgId` en Clerk / production.
2. Descargar dump de R2 → `pg_restore` en rama scratch (**SOURCE**).
3. Dry-run contra production (o scratch de prueba primero).
4. `CONFIRM_APPLY=YES` con TARGET = production (solo tras prueba OK).
5. Verificar app + conteos de otros tenants.

| Fase | Tiempo típico |
|---|---|
| Dump + scratch + `pg_restore` | 15–30 min |
| Dry-run + apply + verificación | 15–25 min |
| **Total** | **~35–75 min** |

RPO del tenant: hasta **~24 h** (último dump nocturno).

---

### 2.3 Troubleshooting restore por tenant

| Error / síntoma | Causa | Solución |
|---|---|---|
| `definí SOURCE_DATABASE_URL` | URL con `&` sin comillas en `.test-env.local` | Envolver URLs en `"..."`; no usar placeholders `HOST-...` |
| `tenant no encontrado en SOURCE` | ID incorrecto o tenant posterior al dump | `SELECT` en SOURCE; copiar ID exacto; verificar fecha del dump |
| `zero-length delimited identifier ""` | `tables.conf` con CRLF Windows | Actualizar scripts (ya normalizan `\r`); usar repo reciente |
| `pg_dump: illegal option -- where=...` | `pg_dump --where` no funciona en Git Bash/Windows | Script actual usa `psql \copy` + CSV (no requiere pg_dump) |
| `violates foreign key ... viajes_vehiculos_vehiculoId_fkey` | Purge con solo `DELETE FROM tenants CASCADE` | Script actual borra tablas en **orden inverso** a `tables.conf` |
| `could not translate host name "HOST-..."` | Placeholder sin reemplazar en `.test-env.local` | Pegar URL Direct real de Neon |
| Pooler / timeout en script | URL con `-pooler` | Usar **Direct connection** en Neon |
| Conteos otros tenants cambiaron | Algo salió mal en TARGET | **No usar prod**; revisar ramas; el script aborta si detecta cambio |

---

### Limitaciones y seguridad

- Solo **PostgreSQL**. No Firestore, Cloudinary ni Clerk.
- El `clerkOrgId` debe ser el **mismo** en backup y destino (si recrearon la org en Clerk, el ID cambia).
- Tras agregar tablas en Prisma, actualizá `tables.conf`.
- **Nunca** `pg_restore --clean` en production para un solo cliente.
- El script verifica que filas de **otros** tenants no cambien; si cambian, aborta.

| Pregunta | Respuesta |
|---|---|
| ¿Modifica otros tenants? | **No**, si pasa el control de conteos |
| ¿Reversible? | No automático; probar en scratch antes de prod |

---

## 3. Accesos y credenciales necesarios

| Para qué | Dónde | Quién suele tenerlo |
|---|---|---|
| Ver / descargar dumps | Cloudflare R2 (dashboard o API token) | Admin Cloudflare del proyecto (cuenta vinculada a CapassoTech; ver doc de entornos) |
| Crear rama scratch + connection string | Neon Console → org **Desarrollo_CapassoTech** → proyecto **vialto** | Quien tenga acceso a Neon |
| Correr restore | PC local con `pg_restore` ≥ versión del servidor (hoy client **17**) | Quien ejecute el incidente |
| Disparar backup manual / ver logs | GitHub → repo `vialto-backend` → Actions | Quien tenga acceso al repo |
| URL unpooled de production (solo si hace falta dump manual) | GitHub Secret `PROD_DATABASE_URL_UNPOOLED` o Neon → branch production → Direct | Secrets: admins del repo; Neon: miembros del proyecto |

**Secrets de GitHub (Actions)** — no van en el repo:

| Secret | Uso |
|---|---|
| `PROD_DATABASE_URL_UNPOOLED` | `pg_dump` nocturno |
| `S3_ENDPOINT` | Endpoint R2 |
| `S3_BUCKET` | `vialto-db-backups` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Token R2 (Read & Write al bucket) |

Si no tenés acceso a Cloudflare o Neon, pedilo al administrador del proyecto antes de un incidente.

---

## 4. Cómo conseguir el dump más reciente

### Opción A — Dashboard (más simple)

1. Entrá a https://dash.cloudflare.com/02191c7fc6065df27a1a363ff14bab2d/home
2. **R2 Object Storage** → bucket **`vialto-db-backups`**
3. Abrí la carpeta **`daily/`** (o `weekly/` / `monthly/` si necesitás más atrás)
4. Ordená por fecha y **descargá** el `.dump` más reciente  
   Ejemplo real de prueba: `vialto_prod_2026-07-13_192344.dump`

### Opción B — AWS CLI (compatible con R2)

```bash
# Listar diarios
aws s3 ls s3://vialto-db-backups/daily/ \
  --endpoint-url https://02191c7fc6065df27a1a363ff14bab2d.r2.cloudflarestorage.com

# Descargar uno concreto
aws s3 cp s3://vialto-db-backups/daily/vialto_prod_2026-07-13_192344.dump ./ \
  --endpoint-url https://02191c7fc6065df27a1a363ff14bab2d.r2.cloudflarestorage.com
```

Credenciales: Access Key / Secret del token R2 (mismas que GitHub Secrets, o un token personal de solo lectura).

---

## 5. Procedimiento de restore completo (paso a paso)

### Regla de oro

Restaurá **siempre primero en una rama scratch de Neon**. Nunca el primer intento contra production.

### Prerrequisitos

- [ ] `pg_restore` instalado (versión **17.x** recomendada; la prueba se hizo con `pg_restore (PostgreSQL) 17.10`)
- [ ] Acceso a Cloudflare R2 (descargar dump)
- [ ] Acceso a Neon (crear branch + connection string **directa**)
- [ ] Dump descargado en disco

Windows (CMD), si el instalador quedó en Program Files:

```cmd
"C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" --version
```

### Paso 1 — Descargar el dump

Desde R2 → `vialto-db-backups` → `daily/` → guardar p. ej. en:

`C:\Users\<usuario>\Downloads\vialto_prod_AAAA-MM-DD_HHMMSS.dump`

### Paso 2 — Crear rama scratch en Neon

1. https://console.neon.tech → org **Desarrollo_CapassoTech** → proyecto **vialto**
2. **Branches** → **Create branch**
3. Name: `restore-test-AAAA-MM-DD` (ej. `restore-test-2026-07-13`)
4. Parent: `production` (o empty, según el caso)
5. Create

### Paso 3 — Connection string de la scratch (Direct / unpooled)

Con la rama scratch seleccionada → **Connect** → **Direct connection** (host **sin** `-pooler`) → copiar el string completo.

**Verificá dos veces** que no sea la URL de production ni la de Render.

### Paso 4 — Ejecutar `pg_restore`

**Windows (CMD)** — ejemplo real usado en la prueba:

```cmd
"C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -v --no-owner --no-privileges --clean --if-exists -d "postgresql://USER:PASSWORD@HOST/neondb?sslmode=require" "C:\Users\joaco\Downloads\vialto_prod_2026-07-13_192344.dump"
```

**Linux / macOS / WSL:**

```bash
pg_restore -v --no-owner --no-privileges --clean --if-exists \
  -d "postgresql://USER:PASSWORD@HOST/neondb?sslmode=require" \
  ./vialto_prod_2026-07-13_192344.dump
```

Flags:

| Flag | Por qué |
|---|---|
| `--no-owner` | Evita errores de ownership en Neon |
| `--no-privileges` | Evita conflictos de GRANT |
| `--clean --if-exists` | Limpia objetos antes; **solo en scratch**, nunca a ciegas en prod |

Pueden aparecer **warnings**; un error fatal que aborte el proceso hay que investigar (ver §7).

### Paso 5 — Checklist post-restore

En Neon → rama scratch → **SQL Editor** (las tablas usan nombres mapeados en minúsculas):

```sql
SELECT COUNT(*) AS tenants FROM tenants;
SELECT COUNT(*) AS facturas FROM facturas;
SELECT COUNT(*) AS pagos FROM pagos;
SELECT COUNT(*) AS movimientos_cc FROM movimientos_cuenta_corriente;
SELECT COUNT(*) AS viajes FROM viajes;
```

Opcional — comparar órdenes de magnitud con production (mismas queries en el branch `production`). Pueden diferir un poco si hubo actividad después del dump.

Checklist:

- [ ] `pg_restore` terminó sin error fatal
- [ ] Las tablas principales existen y tienen filas coherentes
- [ ] Al menos un tenant conocido aparece en `tenants`
- [ ] Facturas / pagos / CC de un tenant de prueba se ven razonables
- [ ] (Si el incidente era por tenant) los datos del tenant afectado están en la scratch

### Paso 6 — Qué hacer después según el incidente

| Situación | Acción |
|---|---|
| Solo validar que el dump sirve | Borrar la rama scratch. Listo. |
| Recuperar un tenant | Extraer de la scratch e integrar a prod con `restore-tenant.sh` (§2) |
| Desastre total de production | Coordinar con el equipo: plan de downtime, restore a rama nueva / promote, o restore a prod **solo** con aprobación explícita |

### Paso 7 — Limpiar

Neon → Branches → `restore-test-...` → **Delete branch**.

---

## 6. Restore validado (registro)

| Fecha | Dump / prueba | Destino | Resultado |
|---|---|---|---|
| 2026-07-13 | `vialto_prod_2026-07-13_192344.dump` (~158 KB, R2 `daily/`) | Rama scratch `restore-test-2026-07-13` | OK — restore **completo** (`pg_restore` 17.10) |
| 2026-07-22 | Dump nocturno R2 → rama SOURCE; `restore-tenant.sh` → rama TARGET | Tenant **LSF Cargas** (`org_3DzdRQzKt6oJgxpV1b0CncaVVA2`), 154 filas | OK — SOURCE = TARGET; 2 otros tenants sin cambios (Git Bash + psql 17, Windows) |

Ritual recomendado: repetir un restore de prueba **una vez al mes** y anotar la fila acá.

---

## 7. Troubleshooting

| Problema | Qué revisar |
|---|---|
| `pg_restore: command not found` | Instalar PostgreSQL client 17 (Windows: instalador EDB; no alcanza Stack Builder solo). Usar ruta completa a `pg_restore.exe`. |
| Version mismatch / “unsupported version” | Client de restore debe ser **≥** versión del servidor Neon. El workflow dumpea con client 17. Actualizar `postgresql-client-XX` en el workflow si Neon sube de major. |
| `password authentication failed` | Connection string vieja o de otra rama. Regenerar desde Neon → Connect → Direct. |
| Timeout / connection refused | Usar host **unpooled** (sin `-pooler`). Confirmar `sslmode=require`. |
| Errores de owner / privilege | Asegurar `--no-owner --no-privileges`. |
| “relation already exists” sin `--clean` | En scratch usar `--clean --if-exists`, o partir de rama vacía. |
| Workflow de backup falla al subir a R2 | Revisar secrets `S3_*` (endpoint R2, bucket `vialto-db-backups`, keys del token). Nombres `S3_*` = protocolo; destino = Cloudflare. |
| No hay dumps nuevos en `daily/` | Actions → último run del workflow; schedules solo desde `main`; GitHub puede pausar crons tras 60 días sin actividad del repo. |
| Lifecycle de R2 borró dumps “viejos” | No debe haber rule de “Delete after 30 days”. La rotación la hace el workflow (7/4/6). Dejar solo “Default Multipart Abort” si existe. |
| Quiero solo un tenant | `scripts/tenant-restore/` + §2 y §2.3 de este doc |
| Restore tenant: FK viajes_vehiculos | Actualizar script; purge en orden inverso (no DELETE tenants CASCADE solo) |

---

## 8. Setup inicial (referencia; ya hecho)

No hace falta repetirlo en un incidente. Detalle por si hay que recrear infra:

1. Bucket R2 `vialto-db-backups` + token Object Read & Write (solo ese bucket).
2. Secrets en GitHub Actions (tabla §3).
3. Workflow mergeado a `main`.
4. Sin lifecycle de borrado a 30 días que pelee con la rotación 7/4/6.

---

## 9. Notificar al equipo

Al mergear o actualizar esta guía, avisar por el canal del equipo (Slack / Discord / lo que usen) con:

- Link a este archivo en el repo: `vialto-backend/BACKUPS.md`
- Dónde viven los dumps: Cloudflare R2 → bucket `vialto-db-backups`
- Recordatorio: restore primero en rama scratch; restore por tenant con `scripts/tenant-restore/`

---

*Última actualización: julio 2026 — Capa 2 en R2; restore completo y restore por tenant documentados.*
