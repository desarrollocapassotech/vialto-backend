# Vialto Backend

API NestJS + Prisma + PostgreSQL + Clerk para el SaaS de logística y transporte. La arquitectura de producto y dominio está descrita en [`ARCHITECTURE.md`](./ARCHITECTURE.md); este README es una **guía operativa** para instalar, configurar y volver a levantar todo desde cero.

---

## Checklist: reconfigurar desde cero

1. **Repo:** clonar, `cd vialto-backend`, `npm install`.
2. **Entorno:** copiar `.env.example` → `.env`; completar `CLERK_SECRET_KEY`, `DATABASE_URL` y el resto según la tabla de la [sección 2](#2-variables-de-entorno).
3. **Base de datos:** `npx prisma migrate deploy` y `npx prisma generate` (misma `DATABASE_URL` que usará la app).
4. **Clerk:** Organizations activas; en el usuario superadmin, `public_metadata.vialtoRole: "superadmin"`; en **Customize session token**, claim `metadata` como en la [sección 4.2](#42-superadmin-de-plataforma-rutas-post-apitenants-etc).
5. **JWT nuevo:** tras cambiar metadata o claims (sesión nueva o `POST .../sessions/{id}/tokens` con la secret key).
6. **Tenant:** con ese JWT, `POST /api/tenants` con `name`, `clerkOrgId` (`org_...` de Clerk) y `modules` ([sección 6](#6-crear-el-tenant-en-postgres)).
7. **Datos core:** en orden clientes → transportistas → choferes → vehículos ([sección 7](#7-datos-core-orden-recomendado)).
8. **Arranque:** `npm run start:dev`; comprobar `GET /api/health`; si usás front en otro origen, revisar CORS en `src/main.ts`.
9. **Producción (deploy):** mismas env vars, `prisma migrate deploy`, `node dist/main` (o el comando del host); ver [sección 10](#10-despliegue-ej-render).

Los detalles, troubleshooting y slugs de módulos están en las secciones siguientes.

---

## Requisitos

- Node.js **≥ 18**
- Cuenta **PostgreSQL** (recomendado: [Neon](https://neon.tech))
- Cuenta **[Clerk](https://clerk.com)** (aplicación con **Organizations** habilitadas)

---

## 1. Clonar e instalar

```bash
git clone <repo>
cd vialto-backend
npm install
```

---

## 2. Variables de entorno

Copiá `.env.example` a `.env` y completá valores reales.

| Variable | Uso |
|----------|-----|
| `CLERK_SECRET_KEY` | Obligatorio. Backend valida JWTs con `verifyToken`. |
| `DATABASE_URL` | Obligatorio. Cadena PostgreSQL (ej. `?sslmode=require`). |
| `PORT` | Opcional. Por defecto el código usa `8080`. |
| `FRONTEND_URL` | Invitaciones de usuarios (Clerk). URL del SPA en prod. |
| `SENTRY_DSN` | Opcional. Si existe, se inicializa Sentry en `main.ts`. |
| `FIREBASE_*`, `CLOUDINARY_*`, `STRIPE_*` | Opcionales; según `ARCHITECTURE.md`. |

**Importante:** no subas `.env` al repositorio. En `.env.example` deberían ir **solo placeholders**, nunca claves ni URLs con contraseña.

**Nota:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` es solo para **frontend**; Nest no la usa.

---

## 3. Base de datos y Prisma

```bash
# Aplicar migraciones (misma DATABASE_URL que usará la app)
npx prisma migrate deploy

# Regenerar cliente (tras cambios de schema)
npx prisma generate
```

Explorar datos: `npm run prisma:studio`.

---

## 4. Clerk — configuración mínima

### 4.1 Organizations

- En **Organizations**, modo acorde al producto: para B2B típico, **membership required** (cada usuario en al menos una org).
- Cada **organización** tiene un id `org_...` = **`clerkOrgId`** en la tabla `tenants`.

### 4.2 Superadmin de plataforma (rutas `POST /api/tenants`, etc.)

1. **Users** → tu usuario → **Public metadata**:

   ```json
   { "vialtoRole": "superadmin" }
   ```

2. **Sessions** → **Customize session token** → en **Claims** agregá (para que el JWT lleve metadata):

   ```json
   {
     "metadata": "{{user.public_metadata}}"
   }
   ```

3. Tras cambiar metadata o claims, pedí un **JWT nuevo** (sesión nueva o `POST .../sessions/{sess}/tokens`).

El backend lee `metadata.vialtoRole` o `public_metadata.vialtoRole` y, si es `superadmin`, asigna rol `superadmin`.

### 4.3 Tenant y rol en el JWT

El **`tenantId`** en la API es el id de organización de Clerk. Los tokens de sesión pueden traer:

- `org_id` / `org_role`, **o**
- en tokens v2: objeto **`o`** con `o.id` (org) y `o.rol` (rol).

El `ClerkAuthGuard` contempla **ambos** formatos.

### 4.4 Usuario miembro de la org

Para rutas con tenant (clientes, viajes, etc.): el usuario debe ser **miembro** de la organización cuyo `org_...` coincide con `tenants.clerkOrgId`, y el JWT debe incluir esa org (ver `tenantId` no nulo).

### 5. Obtener un JWT sin frontend (Postman / curl)

1. Iniciar sesión al menos una vez por la **URL de Sign-in** del **Account Portal** (Clerk Dashboard → Account Portal → copiar URL de **Sign-in**).
2. Listar sesiones:

   `GET https://api.clerk.com/v1/sessions?user_id=<USER_ID>`  
   Header: `Authorization: Bearer <CLERK_SECRET_KEY>`

3. Con un `sess_...` obtenido:

   `POST https://api.clerk.com/v1/sessions/<SESSION_ID>/tokens`  
   Mismo header; body `{}` si aplica.

4. Usar el campo **`jwt`** de la respuesta como:

   `Authorization: Bearer <jwt>`

---

## 6. Crear el tenant en Postgres

**Superadmin** con JWT válido:

```http
POST /api/tenants
Authorization: Bearer <jwt>
Content-Type: application/json
```

```json
{
  "name": "Nombre comercial",
  "clerkOrgId": "org_XXXXXXXXX",
  "plan": "basico",
  "modules": ["combustible", "viajes"]
}
```

- **`clerkOrgId`:** debe ser **exactamente** el `org_...` de Clerk (y coincidir con la org activa en el token cuando probás como cliente).
- **`modules`:** slugs exactos:  
  `viajes`, `facturacion`, `cuenta-corriente`, `stock`, `combustible`, `mantenimiento`, `remitos`, `turnos`, `reportes`.

Sin fila en `tenants` para ese `clerkOrgId`, el **TenantGuard** bloquea el uso normal del producto.

---

## 7. Datos core (orden recomendado)

Antes de módulos que referencian FKs:

1. `POST /api/clientes`
2. `POST /api/transportistas` (si aplica)
3. `POST /api/choferes`
4. `POST /api/vehiculos` (necesario para **combustible**)

Todos los cuerpos van en JSON; ver `src/core/*/dto` para validaciones.

---

## 8. Ejecutar en local

```bash
npm run build
npm run start:dev
# o: npm run start  (tras build, usa dist/)
```

- Health: `GET http://localhost:8080/api/health` (sin auth).
- API con prefijo global: **`/api`**.

---

## 9. CORS

En `src/main.ts`, `enableCors` lista orígenes permitidos. Si el front corre en otro dominio/puerto, agregá esa URL.

---

## 10. Despliegue (ej. Render)

- Mismas variables que en local (`DATABASE_URL`, `CLERK_SECRET_KEY`, `NODE_ENV=production`, `PORT`).
- Build: `npm install && npx prisma generate && npm run build`.
- Antes o al arrancar: **`npx prisma migrate deploy`** contra la DB de producción.
- Start: `node dist/main` (o el comando que use el host).

---

## 11. CI (GitHub)

Workflow: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) — `npm ci`, `prisma generate`, `build`. Usa un `DATABASE_URL` ficticio solo para generar el cliente; no requiere Postgres en el runner para ese flujo.

---

## 12. Errores frecuentes

| Síntoma | Causa probable |
|---------|----------------|
| `403` — *No tenés permisos* en `POST /api/tenants` | Falta `metadata.vialtoRole: superadmin` en el JWT o token viejo. |
| `403` — *organización activa* | `tenantId` null: token sin org, o falta `o.id`/`org_id`; o usuario no miembro de la org. |
| `403` — *organización no registrada* | No existe fila en `tenants` con ese `clerkOrgId`. |
| `403` — módulo no habilitado | `modules` del tenant no incluye el slug del módulo. |
| `400` en `POST /api/tenants` | Body JSON vacío o sin `name` / `clerkOrgId`. Usar **Body → raw → JSON**. |

---

## 13. Estructura del código (resumen)

- `src/core/auth/` — Clerk, roles, `AuthModule` global.
- `src/core/` — `tenants`, `users`, `billing`, `clientes`, `transportistas`, `choferes`, `vehiculos`.
- `src/modules/` — módulos vendibles (viajes, facturación, stock, combustible, etc.).
- `src/shared/` — `ModuleGuard`, `TenantGuard`, Prisma, servicios opcionales (Firebase/Cloudinary stubs).
- `prisma/schema.prisma` — modelo de datos alineado a `ARCHITECTURE.md`.

---

## 14. Documentación adicional

- [ARCHITECTURE.md](./ARCHITECTURE.md) — modelo multi-tenant, módulos, planes, roadmap.

---

*Última actualización del README: marzo 2026.*
