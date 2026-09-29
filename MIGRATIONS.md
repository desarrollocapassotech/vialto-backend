# Guía de migraciones — Vialto (Neon: QA / producción)

## Concepto base

QA y producción viven en **proyectos de Neon separados** (no en ramas del mismo proyecto):

| Entorno | Proyecto Neon | Rama | Host |
|---|---|---|---|
| QA / desarrollo | `vialto-desarrollo` | `develop` | `ep-odd-king-b41rulri…` |
| Producción | `vialto` | `production` | `ep-long-cloud-aercb23b…` |

- **QA (`vialto-desarrollo` / `develop`).** Acá se crean y prueban las migraciones.
- **Producción (`vialto` / `production`).** Acá **solo se aplican** migraciones ya probadas. Nunca se crean ni se resetea.
- Las migraciones corren siempre por la **URL directa (sin pooler)**. Ya está resuelto en `schema.prisma` con `directUrl = env("DATABASE_URL_UNPOOLED")` — no hay que tocar nada.

> **Por qué están separados (sep 2026):** hasta el 29/09/2026 develop era una rama dentro del proyecto de producción, y la cuota de cómputo de Neon es **por proyecto**. El uso de desarrollo agotó la cuota y Neon suspendió también producción (`HTTP 402 — exceeded the quota`, que en los logs de Render aparece como `Can't reach database server`). **No volver a crear ramas de desarrollo/QA dentro del proyecto `vialto`**; cualquier base de prueba nueva va en `vialto-desarrollo`.
>
> Límites de autoscaling: producción máx. 2 CU, QA máx. 1 CU. Al crear una rama nueva, revisar su máximo (el default del proyecto es 8 CU).

---

## 1. Entorno QA (proyecto `vialto-desarrollo`)

Trabajás localmente con tu `.env` apuntando a la rama **develop** del proyecto **`vialto-desarrollo`** de Neon (`DATABASE_URL` = URL con `-pooler`, `DATABASE_URL_UNPOOLED` = URL directa). Verificalo con `npx prisma migrate status`: tiene que mostrar el host `ep-odd-king-…`.

**Crear una migración nueva** (después de editar `schema.prisma`):

```bash
npx prisma migrate dev --name descripcion_corta
```

Esto hace 3 cosas: genera la carpeta de la migración, la aplica en la base de QA y regenera el cliente Prisma.

**Aplicar migraciones pendientes** (por ejemplo, después de un `git pull` con migraciones de otro):

```bash
npx prisma migrate dev
```

**Verificar el estado:**

```bash
npx prisma migrate status
```

Cuando la migración quedó OK en QA, commiteás **el `schema.prisma` + la carpeta de migración juntos** y mergeás a `main`.

---

## 2. Entorno Producción (rama production)

**No se corre a mano.** Al mergear a `main`, Render despliega y aplica las migraciones automáticamente mediante el **Pre-Deploy Command**, configurado en *Settings → Deploy*:

```bash
npx prisma migrate deploy
```

Cómo funciona el deploy:

1. **Build Command:** `npm install` (genera el cliente Prisma con `prisma generate`) + `npm run build`.
2. **Pre-Deploy Command:** `npx prisma migrate deploy` → aplica **solo las migraciones pendientes** contra la rama production de Neon. No crea migraciones ni borra datos.
3. **Start Command:** `node dist/main` → levanta la app.

Si una migración falla en el paso 2, el deploy se aborta y **la versión anterior sigue en línea** (no queda media migrada).

> **Importante:** las variables `DATABASE_URL` y `DATABASE_URL_UNPOOLED` en *Settings → Environment* del servicio de producción de Render deben apuntar a la **rama production del proyecto `vialto`** de Neon (el servicio de QA apunta a `vialto-desarrollo`), y `DATABASE_URL_UNPOOLED` tiene que ser la **URL directa (sin `-pooler`)**, porque `migrate deploy` usa esa.

---

## 3. Estructura de las migraciones

```
prisma/
├── schema.prisma
└── migrations/
    ├── 20260513120000_stock_egreso_numero_remito/
    │   └── migration.sql
    └── migration_lock.toml
```

Cada migración es una carpeta con el formato `AAAAMMDDHHMMSS_descripcion` (el prefijo de timestamp lo genera Prisma automáticamente y garantiza el orden de aplicación) y su `migration.sql` adentro. El nombre descriptivo después del guion bajo es el que pasás en `--name`.

---

## 4. Reglas clave

- Toda migración se crea **primero en QA (`vialto-desarrollo`)**, se prueba, y recién después se mergea a `main` → producción.
- **Nunca** editar una migración ya mergeada/aplicada. Si algo está mal, se crea una **nueva** migración que lo corrija.
- **Nunca** correr `migrate dev` ni `migrate reset` contra producción.
- Siempre commitear la carpeta de la migración junto al cambio de `schema.prisma`.
