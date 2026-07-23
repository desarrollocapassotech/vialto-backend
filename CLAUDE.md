## Aislamiento multi-tenant (obligatorio antes de tocar la base)

Antes de escribir cualquier consulta a la base de datos, seguí las reglas de aislamiento
multi-tenant. **No las dupliques acá**: la fuente de verdad es un solo archivo.

@docs/reglas-multitenant.md

---

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
- Venturini (NyM): `{ "ctg": "10130658234", "cartaDePorte": "CP 1-3726", "grano": "Soja", "tnOrigen": 31420, "tnDestino": 31400, "tarifaPorTn": 48000 }`

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
6. **Migraciones Prisma** — se crean y prueban con `prisma migrate dev` en la rama **develop** de Neon (entorno QA); en **producción** se aplican solas con `prisma migrate deploy` vía el **Pre-Deploy Command** de Render al mergear a `main`. Nunca correr `migrate dev` ni `migrate reset` contra producción. Guía completa en `MIGRATIONS.md`.

### Configuración del tenant en PostgreSQL

```prisma
model Tenant {
  id               String    @id @default(cuid())
  clerkOrgId       String    @unique
  name             String
  idFiscal         String?   @unique          // CUIT u otro identificador fiscal (antes "cuit")
  modules          String[]  @default([])     // módulos activos — ver VIALTO_MODULES en shared/types/modules.ts
  maxUsers         Int       @default(10)
  billingStatus    String    @default("trial") // trial | active | suspended | expired
  billingRenewsAt  DateTime?
  whiteLabelDomain String?
  createdAt        DateTime  @default(now())
}
```

> El identificador de módulo persistido en `Tenant.modules` y usado por `RequireModule`/`ModuleGuard` es la **fuente de verdad única**: `shared/types/modules.ts` exporta `VIALTO_MODULES` con los slugs válidos exactos. Antes de usar un slug en código, docs o Postman, verificar ahí — no asumirlo por el nombre de la carpeta en `src/modules/`.

### Roles en Clerk

| Rol Clerk | Equivalente | Permisos |
|---|---|---|
| `org:admin` | Admin | Gestión completa de su empresa |
| `org:member` | Operador / Chofer | Solo registra y ve sus propias operaciones |

---

## Entidades del Core (SIEMPRE presentes, no son módulos opcionales)

Estas entidades son compartidas por todos los módulos. Deben estar perfectas desde el inicio porque todo depende de ellas.

```prisma
// Empresa cliente (a quien se factura)
model Cliente {
  id                  String   @id @default(cuid())
  tenantId            String
  nombre              String
  idFiscal            String?                   // CUIT u otro identificador fiscal (antes "cuit")
  email               String?
  telefono            String?
  direccion           String?
  pais                String?
  condicionIva        Int?     // AFIP: 1=IVA RI, 4=IVA Exento, 5=Consumidor Final, 6=Monotributo
  condicionTributaria String?  // condición tributaria genérica (países no AR)
  createdAt           DateTime @default(now())

  @@index([tenantId])
}

// Transportista externo (a quien se paga el flete; siempre tipo "externo")
model Transportista {
  id                      String    @id @default(cuid())
  tenantId                String
  nombre                  String
  idFiscal                String?                     // CUIT u otro identificador fiscal
  email                   String?
  telefono                String?
  tipo                    String    @default("externo")
  paut                    String?                     // N° de PAUT
  permisoInternacional    String?
  fechaVencimientoPermiso DateTime?
  pais                    String?                     // AR | UY | PY | CL | BR
  domicilio               String?
  condicionIva            Int?
  condicionTributaria     String?
  comisionPct             Float?                       // % comisión NyM; si null usa el default de ArcaConfig
  createdAt               DateTime  @default(now())

  @@index([tenantId])
}

// Chofer (puede ser propio o de un transportista)
model Chofer {
  id              String    @id @default(cuid())
  tenantId        String
  nombre          String
  dni             String?
  cuit            String?   // requerido para PAUT
  licencia        String?
  licenciaVence   DateTime?
  telefono        String?
  transportistaId String?   // null si es chofer propio
  pin             String?   // hash salt:hash del PIN de login para la app vialto-combustible; nunca se expone en la API
  createdAt       DateTime  @default(now())

  @@index([tenantId])
}

// Destinatario de la mercadería (catálogo simple, reutilizable entre viajes/stock)
model Destinatario {
  id        String   @id @default(cuid())
  tenantId  String
  nombre    String
  createdAt DateTime @default(now())

  @@index([tenantId])
}

// Dirección de entrega (catálogo simple, reutilizable entre viajes/stock)
model DireccionEntrega {
  id        String   @id @default(cuid())
  tenantId  String
  direccion String
  createdAt DateTime @default(now())

  @@index([tenantId])
}

// Vehículo (tractor, semirremolque, camión, utilitario, etc.)
model Vehiculo {
  id                String   @id @default(cuid())
  tenantId          String
  patente           String
  tipo              String   // tractor | semirremolque | camion | utilitario | otro
  marca             String?
  modelo            String?
  anio              Int?
  kmActual          Int      @default(0)
  nroChasis         String?
  poliza            String?
  vencimientoPoliza DateTime?
  tara              Float?
  precinto          String?
  transportistaId   String?  // null si es flota propia
  createdAt         DateTime @default(now())

  @@index([tenantId])
  @@unique([tenantId, patente])
}
```

> `Destinatario` y `DireccionEntrega` son catálogos de apoyo, no imprescindibles como Cliente/Transportista/Chofer/Vehículo, pero viven en `core/` porque los usan varios módulos (viajes, stock) y se exponen también vía `PlatformController` para superadmin.

---

## Arquitectura del backend (NestJS)

### Estructura de carpetas

```
src/
  core/
    auth/                   ← ✅ ClerkAuthGuard, decoradores de rol
    chofer-auth/            ← ✅ login DNI+PIN para choferes (JWT propio, no Clerk) — usado por la app vialto-combustible
    tenants/                ← ✅ CRUD de empresas, configuración
    users/                  ← ✅ sync con Clerk
    billing/                ← ✅ planes, módulos activos
    clientes/               ← ✅ entidad compartida
    transportistas/         ← ✅ entidad compartida
    choferes/               ← ✅ entidad compartida
    vehiculos/              ← ✅ entidad compartida
    destinatarios/          ← ✅ catálogo compartido (viajes, stock)
    direcciones-entrega/    ← ✅ catálogo compartido (viajes, stock)
    platform/               ← ✅ superadmin: CRUD cross-tenant sobre casi todas las entidades (viajes, clientes, choferes, vehículos, transportistas, destinatarios, direcciones, users, facturas/pagos, stock completo, config/liquidaciones/facturas/logs ARCA)

  modules/
    viajes/                 ← ✅ implementado — multi-vehículo/destino/producto, moneda, MIC·CRT
    facturacion/            ← ✅ implementado — extiende viajes, campos ARCA (CAE) en Factura
    cuenta-corriente/       ← ✅ implementado
    stock/                  ← ✅ implementado — operaciones (ingreso/egreso/división), lotes, presentaciones por producto, remito interno
    combustible/            ← ✅ implementado — CRUD, detección de cargas sospechosas, dashboard, export Excel, fotos (Cloudinary), API paralela para choferes vía chofer-auth. El tag Swagger "[Próximamente]" quedó desactualizado: el módulo está activo.
    mantenimiento/          ← ✅ implementado (parcial) — CRUD de `Intervencion` en Postgres; el checklist diario en Firestore que describe este documento NO está implementado todavía
    remitos/                ← ✅ implementado — CRUD de `Remito` con firma (`firmaUrl`); el flujo PWA de firma desde el celular es responsabilidad del frontend, no confirmado acá
    liquidaciones-arca/     ← ✅ implementado — OJO: el slug de módulo real (`RequireModule`, `Tenant.modules`) es `integracion-arca`, no `liquidaciones-arca` — ver nota de VIALTO_MODULES arriba
    turnos/                 ← 🔲 stub real — solo un endpoint estático (`GET turnos/estado`), sin modelo Prisma ni service (Fase 7 — Pereyra, módulo aislado)
    reportes/               ← ⚠️ parcial — 2 endpoints reales (`resumen`, `tablero-general`) con agregaciones cross-módulo; falta el resto de la visión (Fase 8: builder de reportes, exports)
    dashboard/              ← ✅ implementado — KPIs y alertas del tenant (`GET dashboard/resumen`); no es un módulo vendible (no gateado por `RequireModule`, disponible para todo tenant)
    importaciones/          ← ✅ implementado — motor de importación desde Excel (parser/validator/processors por módulo), preview/confirm, templates y logs; uso admin, no gateado como módulo vendible

  shared/
    guards/                 ← ClerkAuthGuard, TenantGuard, ModuleGuard
    decorators/             ← @CurrentTenant(), @RequireModule()
    prisma/                 ← PrismaService singleton
    types/                  ← interfaces, enums compartidos (incluye `VIALTO_MODULES`, la lista canónica de slugs de módulo)

  app.module.ts
  main.ts
```

> **Nota sobre `turnos`:** Módulo para sindicatos/cooperativas de choferes (Pereyra). No es para empresas de logística. Se desarrolla aislado y no se incluye en los planes standard de Vialto por ahora.
>
> Los ✅/⚠️/🔲 de arriba describen **estado del código**, no si el cliente ya lo tiene contratado/activo — eso está en la tabla de "Clientes actuales y estado" más abajo, que puede ir por detrás o por delante del código según el momento comercial.

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

> Esta sección refleja `prisma/schema.prisma` real (resync jul 2026). Ante cualquier duda de un campo puntual, el schema es la fuente de verdad — esto es una copia que puede volver a desactualizarse.

### `viajes` — Gestión de viajes
Soporta múltiples vehículos, destinos y productos por viaje (antes era 1:1), monto en ARS/USD, otros gastos y pagos a transportista en JSON, y datos aduaneros MIC·CRT independientes del monto operativo.

```prisma
model Viaje {
  id                               String    @id @default(cuid())
  tenantId                         String
  numero                           String
  estado                           String    @default("pendiente") // pendiente | en_curso | finalizado_sin_facturar | facturado_sin_cobrar | cobrado | cancelado
  clienteId                        String
  transportistaId                  String?   // transportista contratante
  transportistaEfectivoId          String?   // quien realmente hace el flete, si difiere del contratante
  choferId                         String?
  vehiculosViaje                   ViajeVehiculo[]
  origen                           String?
  destino                          String?
  destinosViaje                    ViajeDestino[]  // destinos múltiples ordenados
  fechaCarga                       DateTime?
  fechaDescarga                    DateTime?
  productosViaje                   ViajeProducto[] // productos múltiples (cantidad, pesoKg)
  detalleCarga                     String?
  kmRecorridos                     Int?
  litrosConsumidos                 Float?
  monto                            Float?
  monedaMonto                      String    @default("ARS") // ARS | USD
  precioTransportistaExterno       Float?
  monedaPrecioTransportistaExterno String    @default("ARS")
  gananciaBrutaManual              Float?    // solo si monedaMonto ≠ monedaPrecioTransportistaExterno
  monedaGananciaBrutaManual        String?
  observaciones                    String?
  otrosGastos                      Json      @default("[]")
  pagosTransportista                Json     @default("[]")
  documentoAduanero                Json      @default("{}") // MIC/CRT
  fechaFinalizado                  DateTime?
  createdAt                        DateTime  @default(now())
  createdBy                        String

  facturaId                  String?
  nroFactura                 String?
  movimientosCuentaCorriente MovimientoCuentaCorriente[]
  liquidacionesViaje         LiquidacionViaje[]

  @@unique([tenantId, numero])
  @@index([tenantId])
  @@index([tenantId, estado])
  @@index([tenantId, clienteId])
  @@index([tenantId, transportistaId])
  @@index([tenantId, fechaCarga])
  @@index([tenantId, fechaDescarga])
  @@index([tenantId, fechaFinalizado])
}

model ViajeVehiculo {
  id         String @id @default(cuid())
  tenantId   String
  viajeId    String
  vehiculoId String
  orden      Int    @default(0)

  @@unique([viajeId, vehiculoId])
}

model ViajeProducto {
  id         String @id @default(cuid())
  tenantId   String
  viajeId    String
  productoId String
  orden      Int    @default(0)
  cantidad   Float?
  pesoKg     Float?

  @@unique([viajeId, productoId])
}

model ViajeDestino {
  id        String   @id @default(cuid())
  tenantId  String
  viajeId   String
  orden     Int      @default(0)
  etiqueta  String
  createdAt DateTime @default(now())

  @@unique([viajeId, orden])
}
```

---

### `facturacion` — Facturación y cobranzas
Se construye sobre `viajes` (relación N:M, una factura puede cubrir varios viajes). Incluye moneda, IVA, comprobante adjunto y los campos de emisión ARCA (nulos si el tenant no tiene `integracion-arca`).

```prisma
model Factura {
  id               String         @id @default(cuid())
  tenantId         String
  numero           String
  tipo             String         // cliente | transportista_externo
  clienteId        String?
  transportistaId  String?
  viajes           Viaje[]
  importe          Float
  moneda           String         @default("ARS") // ARS | USD
  fechaEmision     DateTime
  fechaVencimiento DateTime?
  estado           String         @default("pendiente") // pendiente | cobrada | vencida
  diferencia       Float?
  ivaPct           Float?         @default(21)
  comprobanteUrl   String?        // PDF/imagen en Cloudinary
  // Campos ARCA — nulos para tenants sin módulo integracion-arca
  cbteTipo         Int?           // 1=Factura A, 6=Factura B
  cbteNro          Int?
  ptoVenta         Int?
  cae              String?
  caeFechaVto      DateTime?
  arcaEstado       String?        // pendiente_cae | autorizado | error
  arcaError        String?
  createdAt        DateTime       @default(now())
  pagos            Pago[]

  @@unique([tenantId, numero])
  @@index([tenantId])
  @@index([tenantId, clienteId])
  @@index([tenantId, transportistaId])
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

  @@index([tenantId])
  @@index([tenantId, facturaId])
}
```

---

### `cuenta-corriente` — Cuenta corriente por cliente
`origen` distingue movimientos manuales de los generados automáticamente al cerrar un viaje (uno por viaje, `@@unique([tenantId, viajeId])`). Ya no calcula/persiste `saldoPost` por movimiento.

```prisma
model MovimientoCuentaCorriente {
  id         String   @id @default(cuid())
  tenantId   String
  clienteId  String
  viajeId    String?
  tipo       String   // cargo | pago
  origen     String   @default("manual") // manual | viaje
  concepto   String
  importe    Float
  fecha      DateTime
  referencia String?
  createdAt  DateTime @default(now())

  @@unique([tenantId, viajeId])
  @@index([tenantId])
  @@index([tenantId, clienteId])
  @@index([tenantId, clienteId, tipo])
}
```

---

### `stock` — Gestión de stock

El modelo cambió de forma respecto a versiones anteriores de este documento: ya no hay un producto con "dos contadores configurables" (`cantidad1`/`cantidad2`) fijos. Ahora:

- **`Producto`** es el artículo en sí (nombre, código autogenerado `P-001…`, peso unitario opcional).
- **`Presentacion`** es el catálogo de unidades de medida por tenant (ej. "Pallet", "Bolsa", "Kg").
- **`ProductoPresentacion`** vincula un producto con una o más presentaciones, cada una con su propio `unidadesPorBulto` (ej. "Pallet" = 40 bolsas de este producto).
- **`StockOperacion`** es el encabezado de una operación (ingreso/egreso/división): cliente, depósito, fecha, fotos, remito (interno y del proveedor), y los datos de entrega (`entregadoPor`, `destinatario`, `destinoFinal`, `numeroDocumentoExterno`) — estos campos que documentos anteriores marcaban como "pendientes" **ya están implementados**, y viven acá, no en `MovimientoStock`.
- **`MovimientoStock`** es el detalle línea a línea dentro de una operación: producto + presentación + `bultos`/`unidades` + `lote` opcional (también ya implementado) + vencimiento opcional.
- **`StockItem`** es el snapshot de disponible, ahora clave por `(productoId, presentacionId, clienteId, depositoId)`.

Los egresos generan un número de remito interno automático (`remitoPrefix-YYYY-NNNNN`), vía `StockEgresoRemitoConfig` + `StockRemitoSecuencia`, y pueden vincularse a un `Remito` del módulo `remitos` (`remitoId`).

```prisma
model Producto {
  id                String   @id @default(cuid())
  tenantId          String
  nombre            String
  nombreNormalizado String   // lower/trim, unicidad case-insensitive
  codigo            String?  // P-001, P-002… generado por el sistema
  descripcion       String?
  pesoUnitarioKg    Float?
  activo            Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([tenantId, nombreNormalizado])
  @@unique([tenantId, codigo])
}

model Presentacion {
  id                String   @id @default(cuid())
  tenantId          String
  nombre            String   // ej. "Pallet", "Bolsa", "Kg"
  nombreNormalizado String
  activo            Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([tenantId, nombreNormalizado])
}

/** Vincula un producto a una presentación con cantidad de unidades por bulto. */
model ProductoPresentacion {
  id               String   @id @default(cuid())
  tenantId         String
  productoId       String
  presentacionId   String
  unidadesPorBulto Float
  activo           Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([productoId, presentacionId])
}

model ProductoSecuencia {
  id        String @id @default(cuid())
  tenantId  String @unique
  lastValue Int    @default(0)
}

model Deposito {
  id          String   @id @default(cuid())
  tenantId    String
  nombre      String
  descripcion String?
  activo      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

/** Encabezado de una operación de stock (ingreso, egreso o división). */
model StockOperacion {
  id                     String   @id @default(cuid())
  tenantId               String
  clienteId              String
  depositoId             String
  tipo                   String   // ingreso | egreso | division
  fecha                  DateTime
  observaciones          String?
  remitoUrl              String?  // remito interno PDF (Cloudinary), solo egresos
  fotosUrls              String[] // fotos del producto en ingresos (hasta 2, Cloudinary)
  numeroRemito           String?  // remito interno generado (ej. R-2026-00001)
  numeroRemitoProveedor  String?  // informado manualmente en ingresos
  remitoId               String?  // vínculo opcional a Remito (módulo remitos)
  entregadoPor           String?
  destinatario           String?
  destinoFinal           String?
  numeroDocumentoExterno String?  // pedido/nota de despacho externa; "No tiene" si no aplica
  createdBy              String   @default("")
  createdAt              DateTime @default(now())

  @@unique([tenantId, numeroRemito])
  @@index([tenantId])
  @@index([tenantId, clienteId])
  @@index([tenantId, depositoId])
  @@index([tenantId, tipo])
  @@index([tenantId, fecha])
}

model MovimientoStock {
  id                    String    @id @default(cuid())
  tenantId              String
  operacionId           String    // header StockOperacion
  productoId            String
  presentacionId         String?
  fechaVencimiento      DateTime?
  bultos                Float     @default(0)
  unidades              Float     @default(0)
  lote                  String?
  observaciones         String?
  movimientoVinculadoId String?   // en divisiones: apunta al movimiento par (origen ↔ destino)
  remitoId              String?
  createdBy             String    @default("")
  fecha                 DateTime
  createdAt             DateTime  @default(now())

  @@index([tenantId])
  @@index([tenantId, operacionId])
  @@index([tenantId, productoId])
  @@index([tenantId, presentacionId])
  @@index([tenantId, remitoId])
  @@index([tenantId, fecha])
}

// Snapshot de stock disponible — se actualiza atómicamente con cada movimiento
model StockItem {
  id             String   @id @default(cuid())
  tenantId       String
  productoId     String
  presentacionId String?
  clienteId      String
  depositoId     String
  cantidad1      Float    @default(0)
  cantidad2      Float    @default(0)
  updatedAt      DateTime @updatedAt

  @@unique([productoId, presentacionId, clienteId, depositoId])
}

model StockEgresoRemitoConfig {
  tenantId      String   @id
  remitoPrefix  String   @default("R")
  remitoDigitos Int      @default(5)
  updatedAt     DateTime @updatedAt
}

model StockRemitoSecuencia {
  id        String @id @default(cuid())
  tenantId  String
  year      Int
  lastValue Int    @default(0)

  @@unique([tenantId, year])
}
```

---

### `combustible` — Control de combustible
Implementado en el stack nuevo (no solo planeado). Incluye detección heurística de cargas sospechosas (litros/importe/precio-por-litro fuera de rango, salto de km inválido) con auto-corrección de errores de tipeo comunes (litros ÷1000, km ÷10/÷100/÷1000 validado contra cargas vecinas) y registro del valor original. Fotos de tacómetro y ticket vía Cloudinary. Expone además una **API paralela para choferes** (`chofer-combustible.controller.ts`, autenticada con `chofer-auth`, no Clerk) para que la app `vialto-combustible`/futuros clientes carguen combustible desde el celular.

```prisma
model CargaCombustible {
  id             String    @id @default(cuid())
  tenantId       String
  vehiculoId     String?
  choferId       String?
  estacion       String
  litros         Float
  precioPorLitro Float     @default(0)
  importe        Float
  km             Int
  formaPago      String?   // transferencia | cheque | efectivo
  fecha          DateTime
  createdAt      DateTime  @default(now())
  createdBy      String
  fotoTacometro  String?
  fotoTicket     String?

  sospechoso     Boolean   @default(false)
  motivoSospecha String?   // litros_extremo | importe_invalido | precio_litro_fuera_de_rango | km_delta_invalido
  litrosOriginal Float?    // valor previo a la corrección automática, null si nunca se corrigió
  kmOriginal     Int?      // ídem para km

  @@index([tenantId])
  @@index([tenantId, vehiculoId])
  @@index([tenantId, choferId])
  @@index([tenantId, fecha])
  @@index([tenantId, sospechoso])
}
```

---

### `mantenimiento` — Flota y mantenimiento (Wichi Toledo)
**Solo está implementado el lado Postgres** (CRUD simple de `Intervencion`). El checklist diario en tiempo real vía Firestore que describe este documento es la visión original del módulo, todavía **no implementada** — no asumir que existe.

```prisma
// PostgreSQL — intervenciones y alertas (implementado)
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
  createdBy   String

  @@index([tenantId])
  @@index([tenantId, vehiculoId])
  @@index([tenantId, fecha])
}
```

```
// Firestore — checklist diario en tiempo real (NO IMPLEMENTADO, diseño original)
/tenants/{tenantId}/checklist/{fecha}/{vehiculoId}
  → estado, novedades, incidentes, choferId, timestamp
```

---

### `remitos` — Remitos digitales (Melisa)
CRUD del backend implementado, incluyendo `firmaUrl` para la firma del cliente. El flujo de PWA para que el chofer complete y el cliente firme desde el celular es responsabilidad del frontend — su estado no está confirmado en este documento (verificar en `vialto-frontend` antes de asumirlo). Un `Remito` puede vincularse a movimientos/operaciones de `stock` (relación inversa).

```prisma
model Remito {
  id          String    @id @default(cuid())
  tenantId    String
  numero      String
  clienteId   String
  choferId    String?
  vehiculoId  String?
  descripcion String
  fecha       DateTime
  firmaUrl    String?   // URL en Cloudinary (firma digital del cliente)
  estado      String    @default("emitido") // emitido | firmado | facturado
  createdAt   DateTime  @default(now())

  @@unique([tenantId, numero])
  @@index([tenantId])
  @@index([tenantId, clienteId])
  @@index([tenantId, estado])
  @@index([tenantId, fecha])
}
```

---

### `integracion-arca` — Liquidaciones CVLP + Facturas A/B vía AFIP SDK (carpeta `liquidaciones-arca/`)
Implementado, no planeado. **El slug de gating real es `integracion-arca`** (ver nota sobre `VIALTO_MODULES` más arriba) aunque la carpeta del módulo, los nombres de archivo y varios comentarios del schema sigan diciendo `liquidaciones-arca` — inconsistencia de nombres conocida, no corregida a propósito por decisión del equipo (jul 2026). Para cualquier `Tenant.modules` o `@RequireModule(...)` nuevo, usar siempre `integracion-arca`.

Motor: `liquidaciones.service.ts` (liquidación CVLP tipo 60 a transportistas) + `arca-client.service.ts` (integración AFIP SDK, CAE) + `arca-config.service.ts` + `liquidacion-pdf.service.ts`, con auditoría completa de cada request/response a AFIP en `ArcaLog`.

```prisma
/** Configuración AFIP SDK por tenant. La API key viene de AFIP_SDK_API_KEY (env var). */
model ArcaConfig {
  tenantId           String   @id
  cuitEmisor         String
  razonSocial        String?
  domicilioEmisor    String?
  condicionIvaEmisor String?
  ingBrutos          String?
  inicActEmisor      String?
  ptoVentaCvlp       Int      // punto de venta para CVLP tipo 60
  ptoVentaFactura    Int      // punto de venta para Facturas A/B
  ambiente           String   @default("homologacion") // homologacion | produccion
  comisionPctDefault Float    @default(8)
  comisionPctAlt     Float    @default(7)
  ivaGastosAdmin     Float    @default(21)
  certPem            String?  // nunca se expone en la API pública
  keyPem             String?
  updatedAt          DateTime @updatedAt
}

/** Liquidación CVLP tipo 60 — emitida al transportista (fletero). */
model Liquidacion {
  id              String        @id @default(cuid())
  tenantId        String
  transportistaId String

  periodoDesde DateTime
  periodoHasta DateTime

  // Montos snapshot al crear la liquidación
  cantViajes     Int
  bruto          Float   // sum(tnDestino * tarifaTransportista)
  comisionPct    Float
  comision       Float
  gastosAdmin    Float
  gastosAdminIva Float
  liquido        Float   // neto al transportista

  cbteTipo    Int       @default(60)
  cbteNro     Int?
  ptoVenta    Int?
  cae         String?
  caeFechaVto DateTime?

  estado     String  @default("borrador") // borrador | pendiente_cae | autorizado | error | anulado
  arcaError  String?
  reintentos Int     @default(0)

  comprobanteUrl String?
  payloadHash    String?  // idempotencia: evita duplicar en reintento

  createdAt DateTime @default(now())
  createdBy String
  updatedAt DateTime @updatedAt

  @@index([tenantId])
  @@index([tenantId, transportistaId])
  @@index([tenantId, estado])
}

/** Viajes incluidos en una liquidación (snapshot de montos al liquidar). */
model LiquidacionViaje {
  id            String @id @default(cuid())
  tenantId      String
  liquidacionId String
  viajeId       String

  tnOrigen            Float?
  tnDestino           Float?
  tarifaTransportista Float?
  subtotal            Float?
  gastosAdmin         Float?

  @@unique([liquidacionId, viajeId])
}

/** Log de auditoría de cada request/response a AFIP SDK. */
model ArcaLog {
  id            String   @id @default(cuid())
  tenantId      String
  liquidacionId String?
  facturaId     String?  // referencial, sin FK formal

  method       String  // afip/auth | FECompUltimoAutorizado | FECAESolicitar
  ambiente     String  // homologacion | produccion
  cuit         String
  requestBody  Json     // sin la API key
  responseBody Json?
  httpStatus   Int?
  durationMs   Int?
  exitoso      Boolean @default(false)
  error        String?

  createdAt DateTime @default(now())

  @@index([tenantId])
  @@index([tenantId, liquidacionId])
  @@index([tenantId, facturaId])
}
```

---

### `dashboard` — KPIs del tenant (no es un módulo vendible)
No está gateado por `RequireModule`; disponible para todos los tenants. `GET dashboard/resumen` agrega KPIs, últimos viajes y alertas desde las tablas de Viaje/Factura/MovimientoCuentaCorriente ya existentes (sin modelo Prisma propio), con soporte de rango de fechas/período. Es la base de datos que consume el dashboard real del frontend (`TenantOwnerDashboard.tsx`).

---

### `importaciones` — Carga masiva desde Excel (uso admin)
Tampoco es un módulo vendible por tenant. Motor de importación con parser + validator + un `processor` por módulo destino (hoy: `clientes`, `viajes`), flujo de preview/confirm con sesión de staging temporal, y templates de columnas configurables por tenant/módulo.

```prisma
model ImportTemplate {
  id        String   @id @default(cuid())
  tenantId  String
  modulo    String   // viajes | clientes | choferes | vehiculos | stock | etc.
  nombre    String
  config    Json     // sheet, headerRow, columns[]
  activo    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([tenantId, modulo])
}

model ImportSession {
  id            String   @id @default(cuid())
  tenantId      String
  templateId    String
  nombreArchivo String
  filasValidas  Json     // filas ya validadas, listas para insertar
  errores       Json
  totalFilas    Int
  expiresAt     DateTime // sesión de staging temporal
  createdAt     DateTime @default(now())
}

model ImportLog {
  id            String   @id @default(cuid())
  tenantId      String
  templateId    String?
  modulo        String
  nombreArchivo String
  estado        String   @default("completado") // completado | con_errores | fallido
  totalFilas    Int
  exitosas      Int      @default(0)
  errores       Int      @default(0)
  detalles      Json
  createdAt     DateTime @default(now())
  createdBy     String

  @@index([tenantId, modulo])
}
```

> **`TenantFieldConfig` / `TenantFieldConfigAuditLog`** también existen en el schema pero están **fuera del alcance de este documento**: el comentario en `prisma/schema.prisma` indica que otro integrante del equipo los está desarrollando y que no hay que modificar su forma — solo están declarados para que Prisma coincida con las tablas ya existentes en QA. No asumir comportamiento sobre ellos sin consultar.

---

## Clientes actuales y estado

| Cliente | Estado | Módulos contratados | Prioridad |
|---|---|---|---|
| Bressan | ✅ Activo (stack viejo) | combustible | Migrar a Vialto en el futuro |
| Sebastián Fernández | ✅ Cerrado | viajes | 1 — construir ya |
| Matías Riedel | ✅ Activo | stock, cuenta-corriente | 2 |
| Melisa (Desagotes) | ⏳ Muy probable | remitos, cuenta-corriente | 3 |
| Marcos Venturini (NyM Logística) | ⏳ Presupuesto enviado | integracion-arca, viajes | 4 |
| Wichi Toledo SRL | ⏳ Muy probable | mantenimiento, combustible | 5 |
| Gabriel González e Hijo | 🔲 Interesado | facturacion (viajes + cobranzas) | 6 |
| Javier Altamirano | 🔲 Pendiente | viajes, facturacion, combustible | 7 |
| Mailen Matilla | 🔲 Pendiente | viajes, facturacion | 8 |
| Hernán Pereyra | 🔲 Pendiente | turnos (PWA) | 9 — módulo aislado |

---

## Mapa de módulos por cliente

| Módulo | Fernández | Riedel | Melisa | González | Wichi Toledo | Altamirano | Matilla | Pereyra | NyM |
|---|---|---|---|---|---|---|---|---|---|
| viajes | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| facturacion | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | — | — |
| cuenta-corriente | — | ✓ | ✓ | ✓ | — | — | — | — | — |
| choferes / vehículos | — | — | — | — | — | ✓ | ✓ | ✓ | — |
| mantenimiento | — | — | — | — | ✓ | — | — | — | — |
| combustible | — | — | — | — | ✓ | ✓ | — | — | — |
| stock | — | ✓ | — | — | — | — | — | — | — |
| remitos | — | — | ✓ | — | — | — | — | — | — |
| turnos | — | — | — | — | — | — | — | ✓ | — |
| integracion-arca | — | — | — | — | — | — | — | — | ✓ |

---

## Roadmap de desarrollo

```
FASE 0 — Base (antes de cualquier módulo)
  → Proyecto NestJS + Prisma + Clerk configurado
  → Multi-tenant middleware funcionando
  → Entidades core: Cliente, Transportista, Chofer, Vehículo
  → CLAUDE.md en el repo

FASE 1 — Fernández (primer cliente confirmado)
  → módulo: viajes
  → Tablero, registro de cargas, estados, vinculación cliente/transportista
  → Cálculo de ganancia bruta por operación

FASE 2 — Riedel
  → módulo: stock ✅ (inventario por depósito, ingresos, egresos con remito automático, divisiones, presentaciones configurables)
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

FASE NyM — Venturini (NyM Logística)
  → módulo: integracion-arca (carpeta src/modules/liquidaciones-arca/) — ✅ implementado
  → Campos de granel en metadata del viaje: ctg, cartaDePorte, grano, tnOrigen, tnDestino, tarifaPorTn
  → Feature flag: liquidaciones.habilitarGranel = true para este tenant
  → Motor de liquidación CVLP: agrupamiento por transportista, cálculo comisión, líquido producto, IVA
  → Integración AfipSDK: emisión comprobante tipo 60 con CAE vía WSFEv1
  → Facturas A/B a clientes vía AfipSDK
  → PDF del comprobante con formato NyM Logística

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

# Módulo integracion-arca / carpeta liquidaciones-arca (NyM Logística) — fail-fast si falta en runtime
ARCA_ENCRYPTION_KEY=              # clave AES-256 (hex 64 chars) para cifrar cert/key/credenciales AFIP en DB
AFIP_SDK_API_KEY=                 # token de AfipSDK (afipsdk.com)

# Futuro — Stripe para billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

---

*Última actualización: julio 2026 (resync de estructura de módulos y esquema Prisma contra el código real)*
*Desarrollado por Elias N. Capasso — CapassoTech / Vialto*
