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

## 2. ¿Se puede restaurar un solo tenant / cliente?

**No.** El backup es un dump de la **base completa**. `pg_restore` no ofrece “restaurar solo el tenant X” sobre production.

| Pregunta | Respuesta |
|---|---|
| ¿Restore parcial por tenant con un solo comando? | **No** |
| ¿Qué hace el restore? | Reemplaza/aplica el esquema + datos de **toda** la DB en el destino |

### Alternativa si solo falló un tenant

1. Restaurar el dump en una **rama scratch** de Neon (ver §4).
2. En la scratch, consultar/exportar solo las filas de ese tenant (`tenantId` = `clerkOrgId` de la org en Clerk).
3. Reinyectar a mano (o con script) en production **solo** lo necesario, con mucho cuidado de FKs y de no pisar datos buenos de otros tenants.

Ejemplo de extracción (en la rama scratch), reemplazando el `tenantId`:

```sql
-- Listar tenants
SELECT id, "clerkOrgId", name FROM tenants;

-- Datos del tenant afectado (tenantId = clerkOrgId)
SELECT COUNT(*) FROM facturas WHERE "tenantId" = 'org_XXXX';
SELECT COUNT(*) FROM pagos WHERE "tenantId" = 'org_XXXX';
SELECT COUNT(*) FROM movimientos_cuenta_corriente WHERE "tenantId" = 'org_XXXX';
SELECT COUNT(*) FROM viajes WHERE "tenantId" = 'org_XXXX';
```

Export CSV / `COPY` desde la scratch y merge controlado a production es trabajo de ingeniería; **no** hay un botón de “restore tenant”.

> **Nunca** corras `pg_restore --clean` contra production “para recuperar un solo cliente”: borraría/reescribiría datos de **todos** los tenants.

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
| Recuperar un tenant | Extraer de la scratch e integrar a prod con cuidado (§2) |
| Desastre total de production | Coordinar con el equipo: plan de downtime, restore a rama nueva / promote, o restore a prod **solo** con aprobación explícita |

### Paso 7 — Limpiar

Neon → Branches → `restore-test-...` → **Delete branch**.

---

## 6. Restore validado (registro)

| Fecha | Dump | Destino | Resultado |
|---|---|---|---|
| 2026-07-13 | `vialto_prod_2026-07-13_192344.dump` (~158 KB, R2 `daily/`) | Rama scratch `restore-test-2026-07-13` en Neon | OK (`pg_restore` 17.10) |

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
| Quiero solo un tenant | No se puede con `pg_restore` solo. Ver §2. |

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
- Recordatorio: restore primero en rama scratch; no hay restore por tenant nativo

---

*Última actualización: julio 2026 — Capa 2 operativa en R2; restore de prueba documentado.*
