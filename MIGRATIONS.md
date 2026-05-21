# Guía de migraciones — Vialto (Neon: develop / production)

## Concepto base

- **Rama `develop` de Neon = entorno QA.** Acá se crean y prueban las migraciones.
- **Rama `production` de Neon = entorno producción.** Acá **solo se aplican** migraciones ya probadas. Nunca se crean ni se resetea.
- Las migraciones corren siempre por la **URL directa (sin pooler)**. Ya está resuelto en `schema.prisma` con `directUrl = env("DATABASE_URL_UNPOOLED")` — no hay que tocar nada.

---

## 1. Entorno QA (rama develop)

Trabajás localmente con tu `.env` apuntando a la rama **develop** de Neon.

**Crear una migración nueva** (después de editar `schema.prisma`):

```bash
npx prisma migrate dev --name descripcion_corta
```

Esto hace 3 cosas: genera la carpeta de la migración, la aplica en la rama develop y regenera el cliente Prisma.

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

> **Importante:** las variables `DATABASE_URL` y `DATABASE_URL_UNPOOLED` en *Settings → Environment* de Render deben apuntar a la **rama production de Neon**, y `DATABASE_URL_UNPOOLED` tiene que ser la **URL directa (sin `-pooler`)**, porque `migrate deploy` usa esa.

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

- Toda migración se crea **primero en develop (QA)**, se prueba, y recién después se mergea a `main` → producción.
- **Nunca** editar una migración ya mergeada/aplicada. Si algo está mal, se crea una **nueva** migración que lo corrija.
- **Nunca** correr `migrate dev` ni `migrate reset` contra producción.
- Siempre commitear la carpeta de la migración junto al cambio de `schema.prisma`.
