## Arquitectura del proyecto

A continuación se incluye el contenido completo del documento de arquitectura
que debés respetar en todo momento:

# Vialto — Arquitectura del Sistema

> Sistema SaaS modular para empresas de transporte y logística.
> Este archivo es la fuente de verdad arquitectónica del proyecto.
> Leerlo antes de hacer cualquier cambio estructural.

---

## Stack tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | React (SPA) + Tailwind CSS | Deploy en Render (Static Site) |
| Backend | Node.js + NestJS + Prisma | Deploy en Render (Web Service) |
| Base de datos principal | PostgreSQL | Neon.tech (serverless Postgres) |
| Base de datos tiempo real | Firestore | Solo para datos en vivo (panel de flota, checklist diario) |
| Autenticación | Clerk | Organizaciones = tenants, roles por org |
| Storage | Cloudinary | Fotos, documentos, firmas digitales |
| CI/CD | GitHub Actions | Deploy automático en push a main |
| Monitoring | Sentry | Errores frontend y backend |

### Cuándo usar PostgreSQL vs Firestore

- **PostgreSQL (Neon):** Todo dato transaccional — viajes, facturas, pagos, stock, cuenta corriente, choferes, vehículos. Relaciones claras, integridad referencial, migraciones controladas.
- **Firestore:** Solo cuando el frontend necesita actualizaciones en tiempo real sin polling — panel de estado de flota en vivo, checklist diario del conductor, notificaciones push. Si el dato no necesita verse actualizado al instante, va en PostgreSQL.

---

## Modelo multi-tenant (CRÍTICO)

Cada empresa cliente es una **organización de Clerk**. El `organizationId` de Clerk es el `tenantId` en toda la base de datos.

## Configuración de funcionalidades por tenant

Para manejar comportamientos específicos por tenant sin ramificar el código ni crear modelos separados, Vialto usa una arquitectura de tres capas:

### Capa 1 — Campos genéricos (modelo base)
Los campos comunes a todos los tenants van en el modelo Prisma con tipado fuerte e integridad referencial. Son obligatorios para todos y nunca se omiten.

### Capa 2 — Feature flags (configuración del tenant)
Los comportamientos y reglas de negocio que algunos tenants necesitan y otros no se controlan mediante flags en una tabla de configuración. El código tiene la lógica implementada, pero la ejecuta solo si el flag está activo para ese tenant.
```prisma
model TenantConfig {
  id       String @id @default(cuid())
  tenantId String @unique
  flags    Json   @default("{}")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId])
}
```

Ejemplo de flags para el módulo de viajes:
```json
{
  "viajes": {
    "requiereDespacho": true,
    "requiereContenedor": true,
    "autoFinalizacion48hs": true,
    "tarifaPorHoraFinalizacion": true,
    "calculoGananciaBruta": false
  }
}
```

La lectura de flags se centraliza en un servicio del core:
```typescript
// core/tenants/tenant-config.service.ts
async getFlag(tenantId: string, module: string, flag: string): Promise {
  const config = await this.prisma.tenantConfig.findUnique({ where: { tenantId } });
  return config?.flags?.[module]?.[flag] ?? false;
}
```

### Capa 3 — Metadata por registro (campos específicos)
Los campos que solo usa un subconjunto de tenants y que no tienen sentido en el modelo base van en un campo `metadata: Json` en el modelo correspondiente. No tienen validación a nivel de base de datos — la validación se aplica en la capa de servicio según los flags activos del tenant.
```prisma
// Ejemplo en el modelo Viaje
metadata Json @default("{}")
```

Ejemplos de uso:
- Fernández: `{ "mic": "25AR319519Y", "crt": "AR1135010120", "kgCarga": 30760, "kgDescarga": 30100, "valorTnUsd": 280 }`
- Riedel: `{ "despacho": "IC05 030782P", "contenedor": "OOCU 478298 0", "remitoFisico": true, "escaneado": false }`

### Reglas de uso

1. Si un campo es necesario para **todos** los tenants → va en el modelo base.
2. Si una **regla de negocio** aplica solo a algunos tenants → se controla con un feature flag.
3. Si un **campo de datos** aplica solo a algunos tenants → va en `metadata`.
4. La validación de campos en `metadata` siempre ocurre en la capa de servicio, nunca en el controller.
5. Nunca leer `metadata` directamente en el frontend — el backend siempre expone los campos tipados que correspondan según el tenant.

### Reglas absolutas

1. **Toda query Prisma DEBE incluir `where: { tenantId }`** — nunca consultar datos sin filtrar por tenant.
2. **El `tenantId` siempre viene del token de Clerk** (`orgId`) — nunca del body del request.
3. **Todo endpoint de módulo DEBE tener `@UseGuards(ModuleGuard)`** con el nombre del módulo.
4. **Nuevos módulos van en `src/modules/{nombre}/`** con su propio NestJS module, controller, service y schema Prisma.
5. **El core no depende de módulos** — los módulos pueden depender del core pero no entre sí (salvo `reportes`).
6. **Migraciones Prisma** — siempre `prisma migrate dev` en local y `prisma migrate deploy` en CI/CD.

### Configuración del tenant en PostgreSQL

```prisma
model Tenant {
  id               String    @id @default(cuid())
  clerkOrgId       String    @unique
  name             String
  cuit             String?   @unique
  modules          String[]                        // módulos activos
  maxUsers         Int       @default(10)
  billingStatus    String    @default("trial")     // trial | active | suspended
  billingRenewsAt  DateTime?
  whiteLabelDomain String?
  createdAt        DateTime  @default(now())
}
```

### Roles en Clerk

| Rol Clerk | Equivalente | Permisos |
|---|---|---|
| `org:admin` | Admin | Gestión completa de su empresa |
| `org:supervisor` | Supervisor | Ve todo, no puede eliminar |
| `org:member` | Operador / Chofer | Solo registra y ve sus propias operaciones |

---

## Entidades del Core (SIEMPRE presentes, no son módulos opcionales)

Estas entidades son compartidas por todos los módulos. Deben estar perfectas desde el inicio porque todo depende de ellas.

```prisma
// Empresa cliente (a quien se factura)
model Cliente {
  id        String   @id @default(cuid())
  tenantId  String
  nombre    String
  cuit      String?
  email     String?
  telefono  String?
  direccion String?
  createdAt DateTime @default(now())

  @@index([tenantId])
}

// Transportista externo o proveedor (a quien se paga)
model Transportista {
  id        String   @id @default(cuid())
  tenantId  String
  nombre    String
  cuit      String?
  email     String?
  telefono  String?
  tipo      String   @default("externo")  // externo | propio
  createdAt DateTime @default(now())

  @@index([tenantId])
}

// Chofer (puede ser propio o de un transportista)
model Chofer {
  id              String    @id @default(cuid())
  tenantId        String
  nombre          String
  dni             String?
  licencia        String?
  licenciaVence   DateTime?
  telefono        String?
  transportistaId String?   // null si es chofer propio
  createdAt       DateTime  @default(now())

  @@index([tenantId])
}

// Vehículo (tractor, semirremolque, camión, utilitario, etc.)
model Vehiculo {
  id              String   @id @default(cuid())
  tenantId        String
  patente         String
  tipo            String   // tractor | semirremolque | camion | utilitario | otro
  marca           String?
  modelo          String?
  año             Int?
  kmActual        Int      @default(0)
  transportistaId String?  // null si es flota propia
  createdAt       DateTime @default(now())

  @@index([tenantId])
  @@unique([tenantId, patente])
}
```

---

## Arquitectura del backend (NestJS)

### Estructura de carpetas

```
src/
  core/
    auth/                   ← ClerkAuthGuard, decoradores de rol
    tenants/                ← CRUD de empresas, configuración
    users/                  ← sync con Clerk
    billing/                ← planes, módulos activos
    clientes/               ← entidad compartida
    transportistas/         ← entidad compartida
    choferes/               ← entidad compartida
    vehiculos/              ← entidad compartida

  modules/
    viajes/                 ← ✅ Fase 1 — Fernández
    facturacion/            ← ✅ Fase 5 — González (extiende viajes)
    cuenta-corriente/       ← ✅ Fase 2 — Riedel, Melisa
    stock/                  ← 🔲 Fase 2 — Riedel
    combustible/            ← 🔲 Fase 4 — Wichi Toledo, Altamirano
    mantenimiento/          ← 🔲 Fase 4 — Wichi Toledo
    remitos/                ← 🔲 Fase 3 — Melisa
    turnos/                 ← 🔲 Fase 7 — Pereyra (módulo aislado)
    reportes/               ← 🔲 Fase 8 — cross-módulo

  shared/
    guards/                 ← ClerkAuthGuard, TenantGuard, ModuleGuard
    decorators/             ← @CurrentTenant(), @RequireModule()
    prisma/                 ← PrismaService singleton
    types/                  ← interfaces, enums compartidos

  app.module.ts
  main.ts
```

> **Nota sobre `turnos`:** Módulo para sindicatos/cooperativas de choferes (Pereyra). No es para empresas de logística. Se desarrolla aislado y no se incluye en los planes standard de Vialto por ahora.

### Patrón estándar de un módulo

```typescript
@Controller('viajes')
@UseGuards(ClerkAuthGuard, ModuleGuard('viajes'))
export class ViajesController {
  // tenantId viene inyectado en request.auth por ClerkAuthGuard
  // ModuleGuard verifica que 'viajes' esté en tenant.modules
}
```

---

## Módulos vendibles — esquema de datos

### `viajes` — Gestión de viajes
El módulo más demandado. Presente en 5 de 8 clientes potenciales.

```prisma
model Viaje {
  id              String    @id @default(cuid())
  tenantId        String
  numero          String
  estado          String    @default("pendiente") // pendiente | en_transito | despachado | cerrado
  clienteId       String
  transportistaId String?
  choferId        String?
  vehiculoId      String?
  origen          String?
  destino         String?
  fechaSalida     DateTime?
  fechaLlegada    DateTime?
  mercaderia      String?
  kmRecorridos    Int?
  litrosConsumidos Float?
  precioCliente   Float?    // lo que cobra al cliente
  precioTransportistaExterno Float? // lo que paga al transportista externo
  gananciaBruta   Float?    // calculado: precioCliente - precioTransportistaExterno
  documentacion   String[]  // URLs en Cloudinary
  observaciones   String?
  createdAt       DateTime  @default(now())
  createdBy       String

  @@index([tenantId])
  @@index([tenantId, estado])
  @@index([tenantId, clienteId])
  @@unique([tenantId, numero])
}
```

---

### `facturacion` — Facturación y cobranzas
Se construye sobre `viajes`. Añade el cruce viaje ↔ factura y el control de cobros.

```prisma
model Factura {
  id               String    @id @default(cuid())
  tenantId         String
  numero           String
  tipo             String    // cliente | transportista_externo
  clienteId        String?
  viajeId          String?
  importe          Float
  fechaEmision     DateTime
  fechaVencimiento DateTime?
  estado           String    @default("pendiente") // pendiente | cobrada | vencida
  diferencia       Float?
  createdAt        DateTime  @default(now())
  pagos            Pago[]

  @@index([tenantId])
  @@index([tenantId, clienteId])
  @@index([tenantId, estado])
}

model Pago {
  id        String   @id @default(cuid())
  tenantId  String
  facturaId String
  importe   Float
  fecha     DateTime
  formaPago String?  // transferencia | cheque | efectivo
  createdAt DateTime @default(now())
  factura   Factura  @relation(fields: [facturaId], references: [id])

  @@index([tenantId])
}
```

---

### `cuenta-corriente` — Cuenta corriente por cliente
Puede usarse solo (Riedel) o integrado con `remitos` (Melisa) o `facturacion` (González).

```prisma
model MovimientoCuentaCorriente {
  id         String   @id @default(cuid())
  tenantId   String
  clienteId  String
  tipo       String   // cargo | pago | nota_credito
  concepto   String
  importe    Float
  saldoPost  Float    // saldo después del movimiento
  fecha      DateTime
  referencia String?  // número de remito, factura, etc.
  createdAt  DateTime @default(now())

  @@index([tenantId])
  @@index([tenantId, clienteId])
}
```

---

### `stock` — Gestión de stock (Riedel)

```prisma
model Producto {
  id        String   @id @default(cuid())
  tenantId  String
  nombre    String
  unidad    String   // kg | unidad | palet | rollo | otro
  createdAt DateTime @default(now())

  @@index([tenantId])
}

model MovimientoStock {
  id         String   @id @default(cuid())
  tenantId   String
  productoId String
  clienteId  String
  tipo       String   // ingreso | egreso | division
  cantidad   Float
  pesoKg     Float?
  remito     String?
  fecha      DateTime
  createdAt  DateTime @default(now())

  @@index([tenantId])
  @@index([tenantId, productoId])
  @@index([tenantId, clienteId])
}
```

---

### `combustible` — Control de combustible
Ya existe para Bressan en el stack viejo. Se reimplementa en el nuevo stack.

```prisma
model CargaCombustible {
  id         String   @id @default(cuid())
  tenantId   String
  vehiculoId String
  choferId   String?
  estacion   String
  litros     Float
  importe    Float
  km         Int
  formaPago  String?
  fecha      DateTime
  createdAt  DateTime @default(now())
  createdBy  String

  @@index([tenantId])
  @@index([tenantId, vehiculoId])
}
```

---

### `mantenimiento` — Flota y mantenimiento (Wichi Toledo)
Único módulo con componente de tiempo real relevante. El checklist diario se guarda en Firestore para visibilidad inmediata en el panel.

```prisma
// PostgreSQL — intervenciones y alertas
model Intervencion {
  id          String   @id @default(cuid())
  tenantId    String
  vehiculoId  String
  tipo        String   // service | aceite | filtro | cubiertas | otro
  descripcion String?
  km          Int?
  proximoKm   Int?
  fecha       DateTime
  createdAt   DateTime @default(now())

  @@index([tenantId])
  @@index([tenantId, vehiculoId])
}
```

```
// Firestore — checklist diario en tiempo real
/tenants/{tenantId}/checklist/{fecha}/{vehiculoId}
  → estado, novedades, incidentes, choferId, timestamp
```

---

### `remitos` — Remitos digitales (Melisa)
Requiere PWA para que el chofer complete y el cliente firme desde el celular.

```prisma
model Remito {
  id          String   @id @default(cuid())
  tenantId    String
  numero      String
  clienteId   String
  choferId    String?
  vehiculoId  String?
  descripcion String
  fecha       DateTime
  firmaUrl    String?  // URL en Cloudinary (firma digital del cliente)
  estado      String   @default("emitido") // emitido | firmado | facturado
  createdAt   DateTime @default(now())

  @@index([tenantId])
  @@index([tenantId, clienteId])
  @@unique([tenantId, numero])
}
```

---

## Clientes actuales y estado

| Cliente | Estado | Módulos contratados | Prioridad |
|---|---|---|---|
| Bressan | ✅ Activo (stack viejo) | combustible | Migrar a Vialto en el futuro |
| Sebastián Fernández | ✅ Cerrado | viajes | 1 — construir ya |
| Matías Riedel | ⏳ Cierra mañana | stock, cuenta-corriente | 2 |
| Melisa (Desagotes) | ⏳ Muy probable | remitos, cuenta-corriente | 3 |
| Wichi Toledo SRL | ⏳ Muy probable | mantenimiento, combustible | 4 |
| Gabriel González e Hijo | 🔲 Interesado | facturacion (viajes + cobranzas) | 5 |
| Javier Altamirano | 🔲 Pendiente | viajes, facturacion, combustible | 6 |
| Mailen Matilla | 🔲 Pendiente | viajes, facturacion | 7 |
| Hernán Pereyra | 🔲 Pendiente | turnos (PWA) | 8 — módulo aislado |

---

## Mapa de módulos por cliente

| Módulo | Fernández | Riedel | Melisa | González | Wichi Toledo | Altamirano | Matilla | Pereyra |
|---|---|---|---|---|---|---|---|---|
| viajes | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| facturacion | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | — |
| cuenta-corriente | — | ✓ | ✓ | ✓ | — | — | — | — |
| choferes / vehículos | — | — | — | — | — | ✓ | ✓ | ✓ |
| mantenimiento | — | — | — | — | ✓ | — | — | — |
| combustible | — | — | — | — | ✓ | ✓ | — | — |
| stock | — | ✓ | — | — | — | — | — | — |
| remitos | — | — | ✓ | — | — | — | — | — |
| turnos | — | — | — | — | — | — | — | ✓ |

---

## Roadmap de desarrollo

```
FASE 0 — Base (antes de cualquier módulo)
  → Proyecto NestJS + Prisma + Clerk configurado
  → Multi-tenant middleware funcionando
  → Entidades core: Cliente, Transportista, Chofer, Vehículo
  → ARCHITECTURE.md en el repo

FASE 1 — Fernández (primer cliente confirmado)
  → módulo: viajes
  → Tablero, registro de cargas, estados, vinculación cliente/transportista
  → Cálculo de ganancia bruta por operación

FASE 2 — Riedel
  → módulo: stock (ingresos, egresos, remitos, división de bultos)
  → módulo: cuenta-corriente (saldo por cliente, pagos, historial)

FASE 3 — Melisa
  → módulo: remitos (PWA para chofer, firma digital)
  → cuenta-corriente ya construida en Fase 2 → reutilizar

FASE 4 — Wichi Toledo
  → módulo: mantenimiento (checklist diario con Firestore, alertas km)
  → módulo: combustible (cargas, rendimiento por vehículo)

FASE 5 — González
  → módulo: facturacion (cruce viajes-facturas, cobranzas, alertas)
  → viajes ya construido en Fase 1 → extender

FASE 6 — Altamirano / Matilla
  → viajes + facturacion ya construidos → solo onboarding

FASE 7 — Pereyra
  → módulo: turnos (PWA para choferes, panel admin, listas de turno)
  → Módulo aislado, no depende de los anteriores

FASE 8 — Transversal
  → módulo: reportes (dashboards cross-módulo, exportación, KPIs)
  → Integración AFIP/ARCA (facturación electrónica)
  → App móvil nativa para choferes
  → Migración de Bressan al nuevo stack
```

---

## Modelo de suscripción SaaS (por módulos)

- No hay planes fijos (`Básico`, `Pro`, `Enterprise`).
- Cada cliente paga una suscripción según:
  - cantidad de módulos habilitados
  - tipo de módulos habilitados
- `modules` en `Tenant` es la fuente de verdad comercial/funcional.
- `maxUsers` se configura por tenant según acuerdo comercial.
- Los precios en ARS se ajustan por inflación.

---

## Infraestructura y costos

### Hoy (hasta ~5 clientes)
- **Frontend:** Render Static Site — gratis
- **Backend:** Render Web Service — gratis (cold starts) o $7/mes sin cold starts
- **PostgreSQL:** Neon.tech — gratis hasta 0.5 GB / 190 hs compute/mes
- **Firestore:** Google — gratis hasta ~50k lecturas/día
- **Auth:** Clerk — gratis hasta 10.000 MAU

### Al escalar (5+ clientes)
- Render: plan pago cuando el cold start sea inaceptable
- Neon: escala automáticamente (serverless, pay-per-use)
- Clerk: plan Pro a partir de 10.000 MAU activos
- Evaluar migración de backend a **Cloud Run** — mejor integración con Firestore, sin cold starts con `minInstances: 1`

---

## Variables de entorno requeridas

```env
# Clerk
CLERK_SECRET_KEY=
CLERK_PUBLISHABLE_KEY=           # solo frontend

# PostgreSQL (Neon.tech)
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/vialto?sslmode=require

# Firebase / Firestore (módulos con tiempo real)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Cloudinary (storage de archivos y firmas)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# App
PORT=8080
NODE_ENV=production

# Futuro — Stripe para billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

---

*Última actualización: abril 2026*
*Desarrollado por Elias N. Capasso — CapassoTech / Vialto*
