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
   - **OJO — la base develop es compartida entre ramas.** `migrate dev` puede detectar *drift* / "migration modified after applied" / "migration missing" cuando otra rama aplicó una migración que no tenés local. **Nunca resetear** (borra la base compartida y todos sus datos). Para resolver: sincronizar migraciones con `git pull`; y si solo necesitás agregar una columna aislada sin pelear con el drift, aplicarla con `npx prisma db execute --file ...` (ALTER TABLE aditivo e idempotente) + `npx prisma generate`. A futuro conviene una base por rama/dev (Neon branching).

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
  // 3 indicadores independientes (reemplazan al viejo `estado` combinado — ver
  // "Estados de un viaje" más abajo). `estado` ya no se lee ni se escribe desde
  // código nuevo; queda deprecado en la tabla hasta una migración de limpieza futura.
  etapa                            String    @default("pendiente") // pendiente | en_curso | finalizado | cancelado
  facturacionEstado                String    @default("sin_facturar") // sin_facturar | esperando_afip | facturado | cobrado | error_afip | anulado
  liquidacionEstado                String?   // null si no aplica (sin transportista externo o tenant sin integracion-arca); sino: sin_liquidar | esperando_afip | liquidado | error_afip | anulado
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
  @@index([tenantId, etapa])
  @@index([tenantId, facturacionEstado])
  @@index([tenantId, liquidacionEstado])
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

#### Estados de un viaje: etapa, facturación y liquidación (independientes) — jul-ago 2026

El viejo campo único `Viaje.estado` mezclaba tres preguntas distintas (en qué etapa va el viaje, si está facturado, si está cobrado) y no permitía combinaciones reales (viaje en curso ya liquidado, viaje finalizado sin facturar), ni mostraba errores de AFIP o anulaciones. Se reemplazó por 3 indicadores 100% independientes — ninguno espera a otro ni lo pisa:

- **`etapa`**: `pendiente | en_curso | finalizado | cancelado`. Se mueve solo por fechas (`viajes-auto-estado.service.ts`) o edición manual; nunca la tocan los flujos de facturación/liquidación.
- **`facturacionEstado`**: `sin_facturar | esperando_afip | facturado | cobrado | error_afip | anulado`.
- **`liquidacionEstado`**: `null` (no aplica: sin transportista externo o tenant sin `integracion-arca`) | `sin_liquidar | esperando_afip | liquidado | error_afip | anulado`.

**Sync**: `modules/viajes/viaje-estado-financiero.ts` expone las funciones puras `mapFacturacionEstado`/`mapLiquidacionEstado` (calculan el indicador a partir de `Factura.arcaEstado` / `Liquidacion.estado` + si el tenant tiene ARCA) y las funciones que tocan DB `syncFacturacionEstadoViaje(s)`/`syncLiquidacionEstadoViaje(s)`. **Toda** operación que crea, vincula, desvincula, emite, anula o elimina una Factura o Liquidación debe llamar al sync correspondiente para los viajes afectados — ya está wired en `facturacion.service.ts` (create/update/removeFactura/pagos/marcarComoCobrada) y `liquidaciones.service.ts` (create/emitir/anular/deleteLiquidacion, emitir/anularFacturaArca). Un bug histórico real (re-facturar tras anular quedaba bloqueado) fue justamente un `anularFacturaArca` que no llamaba al sync — si se agrega un nuevo punto de mutación de Factura/Liquidación, hay que sumar la llamada ahí también.

**También hay que llamar `syncLiquidacionEstadoViaje` al CREAR un viaje** (`viajes.service.ts#create` y `importaciones/processors/viajes.processor.ts#insert`), aunque todavía no tenga ninguna Liquidación — `liquidacionEstado` no tiene `@default` en el schema (a propósito, porque su valor correcto depende de si aplica o no), así que sin esa llamada un viaje con transportista externo en un tenant con ARCA queda en `null` en vez de `sin_liquidar` hasta el primer evento de liquidación. Bug real encontrado y corregido en ago 2026 (afectaba viajes recién creados de NyM, bloqueando el flujo de liquidación).

**Tenant sin `integracion-arca`**: `liquidacionEstado` es `null` únicamente si el viaje no tiene transportista externo — **no** por falta de ARCA. `CrearLiquidacionManualModal` con `hasArca=false` sigue creando una `Liquidacion` real (registro manual, queda en `estado: 'borrador'` para siempre porque no hay paso de "emitir" sin ARCA), así que estos tenants sí tienen liquidaciones genuinas que hay que reflejar. `mapLiquidacionEstado(estado, tieneArca)` maneja esto: con `tieneArca=false`, cualquier registro no-anulado (`borrador`, y por herencia `pendiente_cae`/`autorizado`/`error` si quedaron de datos viejos) mapea directo a `liquidado` — nunca a vocabulario de AFIP (`esperando_afip`/`error_afip`). Bug real encontrado y corregido en ago 2026: la versión anterior forzaba `liquidacionEstado = null` para todo tenant sin ARCA (confundiendo "no aplica AFIP" con "no aplica liquidación"), lo que hacía que `FacturarSelectorModal` mostrara "Liquidación a transportista" como **siempre completada** ("Ya registrado") incluso en viajes sin ninguna liquidación real — bloqueando de hecho la creación de liquidaciones manuales nuevas. `facturacionEstado` sigue el mismo criterio y no tiene este problema porque nunca dependió de si existía o no un registro: nunca expone valores AFIP (`esperando_afip`/`error_afip`) para tenants sin ARCA — cae directo a `facturado`/`cobrado`/`anulado`.

**Edit-lock por campo, no todo-o-nada**: `viajes.service.ts` define `CAMPOS_FISCALES_VIAJE` (cliente, transportista, montos, gastos, pagos a transportista) — bloqueados con `ConflictException` mientras `facturacionEstado ∉ {sin_facturar, anulado}` o `liquidacionEstado ∉ {null, sin_liquidar, anulado}`. Los campos operativos (fechas, km, litros, chofer, vehículos, observaciones, **incluida `etapa`**) siempre son editables, esté o no facturado/liquidado.

**Frontend** (`vialto-frontend/src/lib/viajesIndicadores.ts`): centraliza labels/clases/tooltips de los 3 indicadores y `facturacionPermiteVincular`/`liquidacionPermiteVincular` (`sin_facturar`/`anulado` cuentan como "disponible para vincular una factura/liquidación nueva"). Los badges de la grilla de Viajes (`ViajeFacturacionIndicador`/`ViajeLiquidacionIndicador`) son clickeables: si el viaje ya tiene factura/liquidación vinculada, el click trae el registro completo (fetch on click) y abre directo `FacturaViewModal`/`LiquidacionViewModal` — sin modal intermedio; si todavía no hay nada vinculado, muestra un modal de detalle liviano (`ViajeFacturacionDetalleModal`/`ViajeLiquidacionDetalleModal`) que solo informa el estado. **Estos badges nunca agregan acciones de mutación** (ej. "marcar como cobrada", emitir, anular) — eso vive únicamente en las pantallas de Facturas/Liquidaciones; desde Viajes es solo lectura/navegación.

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
  estado           String         @default("pendiente") // valor crudo en BD, no autoritativo — ver "Estado de una Factura en lectura" abajo
  diferencia       Float?
  ivaPct           Float?         @default(21)
  comprobanteUrl   String?        // PDF/imagen en Cloudinary
  // Campos ARCA — nulos para tenants sin módulo integracion-arca
  cbteTipo         Int?           // 1=Factura A, 6=Factura B
  cbteNro          Int?
  ptoVenta         Int?
  cae              String?
  caeFechaVto      DateTime?
  arcaEstado       String?        // pendiente_cae | autorizado | error | anulado
  arcaError        String?
  // Ambiente ARCA con el que se autorizó (snapshot al emitir; homologacion | produccion).
  // No se re-escribe en la anulación. Mismo patrón que Liquidacion.ambiente (ver abajo).
  ambiente         String?
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

#### Estado de una Factura en lectura — dos ejes independientes, badges aditivos (ago 2026)

`computeEstadoFacturaLectura` (`shared/util/factura-estado-lectura.ts`) es la única fuente de verdad del estado de una Factura al leerla (el valor crudo en la columna `estado` no se mantiene). Separa dos preguntas que antes se mezclaban en un solo campo:

- **`estado`** (ciclo de vida del comprobante): `borrador | esperando_afip | facturado | error_afip | anulado`. Sigue el mismo orden de prioridad que `mapFacturacionEstado` en `viaje-estado-financiero.ts` — mantener ambos sincronizados si cambia la regla. Para tenants sin `integracion-arca` siempre es `facturado` (no hay borrador ni error AFIP fuera de ese módulo).
- **`cobrado`** / **`vencida`** (booleanos, eje de cobro, independiente del ciclo de vida): se puede estar cobrado en cualquier `estado` (ej. cobrado antes de anular); `vencida` solo puede ser `true` si no está cobrada y ya se llegó a `facturado`.

**Regla de UI obligatoria**: el badge de `cobrado`/`vencida` es **aditivo** — se muestra junto al badge de `estado`, nunca lo reemplaza (mismo criterio para `AmbienteTestBadge`, ver frontend). Implementado en `FacturacionTenantPage.tsx` (`renderEstadoBadges`), `FacturaViewModal.tsx` y `FacturaEditModal.tsx` — reusar ese patrón en pantallas nuevas en vez de volver a un único badge combinado. Los labels de estos badges van en **MAYÚSCULA** (`BORRADOR`, `ESPERANDO AFIP`, `FACTURADO`, `ERROR DE AFIP`, `ANULADO`, `COBRADO`, `VENCIDA`), y el badge `ANULADO` usa `line-through` — mismo estilo gris que usa `Liquidacion.estado === 'anulado'`.

`tieneArca` se resuelve siempre consultando `Tenant.modules` (nunca infiriendo por presencia de `arcaEstado`), igual que en `viaje-estado-financiero.ts` — ver `FacturacionService.tieneArca()`. El filtro `?estado=` de `facturas-paginated-query.dto.ts` sigue aceptando los 7 valores conceptuales (incluye `cobrado`/`vencida`); el service los resuelve contra los campos booleanos, no contra `estado`.

`Liquidacion.estado` sigue siendo un solo eje (`borrador|pendiente_cae|autorizado|error|anulado`, ver más abajo) porque no tiene una noción de "cobro" separada del comprobante — no se dividió en dos.

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

**Anulación de un CVLP (importante — no obvio):** AFIP **no** permite anular un CVLP (tipo 60) por web service con el código 065 (no existe en wsfev1 → error `11001`) ni con importes en negativo (error `10065`). Se anula emitiendo un comprobante **estándar asociado** (`CbtesAsoc`) al 060/061 original: Nota de Crédito (tipo **3** clase A / **8** clase B) o Nota de Débito (tipo **2** clase A / **7** clase B). La clase A/B sale de la condición IVA del transportista. El usuario elige NC o ND en el **modal de anulación** (no es config global); el backend lo recibe en el body (`AnularLiquidacionDto.tipoAnulacion`) y `getCbteTipoAnulacionCvlp(condicionIva, tipo)` mapea al código. Que NC vs ND sea lo fiscalmente correcto es decisión del contador del cliente (AFIP acepta ambos) — por eso es elegible por operación.

**Gotchas operativos de ARCA (verificados en producción con NyM, jul 2026):**

- **CVLP tipo 61 (clase B) no se emite — solo se emite 060.** En producción no se pudo autorizar el 061 vía AFIP SDK para transportistas no Responsables Inscriptos. `getCbteTipoCvlp()` (`arca.util.ts`) devuelve siempre `60`, sin importar la condición IVA del transportista; el selector manual 60/61 que existía en el modal de creación de liquidación (`CrearLiquidacionManualModal.tsx`) se sacó (era además dead code: `createLiquidacion`/`emitirLiquidacion` recalculaban el tipo con `getCbteTipoCvlp` e ignoraban el override del DTO). Si se retoma el 061 a futuro, hay que revertir `getCbteTipoCvlp` y reintroducir la selección en el frontend.
- `cms.sign.invalid` ("firma inválida o algoritmo no soportado") al autenticar = el cert y la clave guardados en `ArcaConfig` **no son pareja** (típico de re-pegar uno solo). La firma la hace afipsdk en la nube; casi nunca es el algoritmo. Solución: re-cargar **ambos** (cert + clave juntos) desde el par correcto (verificar con un test de auth que el par del `.env` funciona).
- El cert/clave se guardan cifrados con `ARCA_ENCRYPTION_KEY` (AES-256-GCM). Debe ser **la misma en todos los entornos que compartan base**; si difiere, falla el descifrado. En producción no puede estar vacía (fail-fast).
- La config **solo re-guarda cert/clave si se envía contenido**; dejar un campo vacío conserva el valor anterior.
- El PEM se normaliza antes de firmar (`normalizePem` en `arca-client.service.ts`): pegar la versión con `\n` literales (como en el `.env`) sin normalizar da `Invalid PEM formatted message`.
- El punto de venta que usa el web service es de tipo **RECE/Web Services** y **no** aparece en "Comprobantes en Línea" (regímenes separados y permanentes). Verificar los habilitados con `FEParamGetTiposCbte` / `getSalesPoints`.
- Al armar payloads, el CVLP va con `Concepto: 1` (Productos); con `Concepto: 2` (Servicios) AFIP exige fechas de servicio (`FchServDesde/Hasta/VtoPago`, error `10049`).

**Homologación: CUIT de prueba para todos los tenants, sin certificado propio (jul 2026).** Registrar un certificado autofirmado por tenant en el portal de homologación de AFIP (`wsaahomo.afip.gov.ar`) requiere la clave fiscal real del tenant, que en la práctica casi nunca está disponible durante el onboarding — esto bloqueaba probar la integración antes de que el cliente tuviera todo el trámite fiscal resuelto. Solución adoptada: en homologación, **todos** los tenants (sin excepción) autentican con el CUIT de prueba estándar de AFIP SDK, **sin certificado propio** — el mismo mecanismo que ya usaban los scripts de este repo (`scripts/test-tipo65.js` y similares). Esto vive en `ArcaConfigService.findWithApiKey()` (`arca-config.service.ts`): si `ambiente !== 'produccion'`, sustituye `cuitEmisor` por `CUIT_TEST_HOMOLOGACION` (constante en `arca.util.ts`, valor `'20409378472'`) y fuerza `certPem`/`keyPem` a `null`, sin tocar el resto de la config. En producción se sigue usando el CUIT real del tenant + su certificado (`certPemProduccion`/`keyPemProduccion` en `ArcaConfig` — **un solo par**, ya no hay slot de certificado de homologación; se eliminó por innecesario en la migración `20260731220000_drop_arca_config_cert_homologacion`). Como `findWithApiKey()` es el único punto de entrada usado por los tres flujos de emisión (`emitirLiquidacion`, `anularLiquidacion`, `emitirFacturaArca`), el comportamiento es automático y no requiere lógica condicional en cada uno. Al emitir con éxito se persiste el ambiente usado en `Liquidacion.ambiente` (snapshot, no se re-escribe en la anulación) — es lo que el frontend usa para marcar un comprobante como "de prueba". **Importante para cualquier flujo de emisión nuevo (ej. UI de Facturas A/B):** el punto de venta configurado por el tenant para producción muy probablemente no sea válido para el CUIT de prueba en homologación — el usuario debe poder ingresarlo manualmente al emitir (no asumir el `ptoVentaCvlp`/`ptoVentaFactura` de la config).

**Errores de ARCA — mensaje amigable + detalle técnico:** todo error de emisión/anulación viaja como `{ message, detalle }`: `message` es amigable (para el usuario), `detalle` es la respuesta cruda de AFIP SDK (para "ver error completo"). `ArcaException` deriva `detalle` de su `raw` en el constructor; los `catch` del service lo devuelven en el body del `UnprocessableEntityException` (422). En la liquidación se persisten los dos (`arcaError` = amigable, `arcaErrorDetalle` = crudo), así el modal de vista muestra el detalle incluso tiempo después. En el frontend: componente `ArcaErrorMessage` (mensaje + botón "Ver error completo" + copiar) y helper `getArcaErrorDetalle(err)` (lo saca de `ApiError.body.detalle`), usados en los modales de emisión (`EmitirLiquidacionModal`, `EmitirCvlpModal`), la grilla y el `LiquidacionViewModal`. Para sumar el patrón a un flujo nuevo, reusar esos dos en vez de mostrar el error pelado.

**UI de "esto es de prueba" — reusar, no reinventar (jul-ago 2026):** para cualquier pantalla nueva que muestre o emita un comprobante ARCA, reusar los dos componentes ya construidos en `vialto-frontend/src/components/liquidaciones/`:

- `AmbienteTestBadge` — badge ámbar "Ambiente de pruebas" que se renderiza solo si `ambiente === 'homologacion'`. Dos familias de uso, no confundir:
  - **Snapshot por comprobante** (informativo, nunca clickeable): `Liquidacion.ambiente` (grilla y título de `LiquidacionViewModal`) y `Factura.ambiente` (grilla, `FacturaViewModal`, `FacturaEditModal` — campo agregado en ago 2026, migración `20260808120000_add_factura_ambiente`, seteado en `emitirFacturaArca` igual que ya hacía `emitirLiquidacion`).
  - **Config actual del tenant** (accionable): `ArcaConfig.ambiente`, en los banners de página tipo "Emisión electrónica vía ARCA" (`FacturacionTenantPage.tsx`, `LiquidacionesTenantPage.tsx`) y en los modales de emisión. Estas instancias pasan `to="/configuracion/arca?tab=ambiente"` al badge — el componente acepta un `to?: string` opcional que lo vuelve un `<Link>` clickeable; sin `to` sigue siendo un `<span>` estático. Solo wirear `to` en vistas de tenant (no en las variantes `embeddedInSuperadmin`, que no tienen una ruta de config alcanzable para un tenant elegido). `ArcaConfigTenantPage.tsx` lee `?tab=` de la URL para abrir directo en la pestaña pedida (`general | ambiente | conceptos`).
- `AmbienteHomologacionWarning` — banner ámbar de advertencia ("el comprobante no va a tener validez fiscal") que se muestra antes de confirmar la emisión cuando `config.ambiente === 'homologacion'`; ubicado al final del cuerpo del modal, justo antes de los botones de acción. Usado en `EmitirLiquidacionModal`, `EmitirCvlpModal`, `CrearLiquidacionManualModal` y `EmitirFacturaModal`.

Ninguno de los dos renderiza nada si el ambiente es `'produccion'`.

Además, cada emisión exitosa (CVLP o su reintento) debe mostrar un toast de confirmación vía `useToast()` (`@/lib/toast`) — antes no había ningún feedback visible al terminar de emitir; ahora `onEmitirSuccess`/equivalentes en `LiquidacionesTenantPage.tsx`, `SuperadminArcaPage.tsx` y `CrearLiquidacionManualModal.tsx` llaman `showToast('Comprobante emitido correctamente...')` (incluye el CAE si está disponible). Mantener este toast al tocar esos flujos.

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
  ivaGastosAdmin     Float    @default(21)
  // Solo hace falta para producción — en homologación se usa el CUIT de prueba de AFIP
  // sin certificado propio (ver "Homologación: CUIT de prueba" arriba). Nunca se exponen
  // en la API pública.
  certPemProduccion String?
  keyPemProduccion  String?
  updatedAt         DateTime @updatedAt
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
  // Ambiente ARCA con el que se emitió (snapshot al autorizar; homologacion | produccion).
  // No se re-escribe en la anulación. Lo usa el frontend para el badge "Ambiente de pruebas".
  ambiente    String?

  // Labels en UI (todas en MAYÚSCULA, ver "Estado de una Factura en lectura" arriba para
  // el mismo criterio del lado de Facturas): borrador→BORRADOR, pendiente_cae→ESPERANDO AFIP,
  // autorizado→LIQUIDADO, error→ERROR DE AFIP, anulado→ANULADO (gris + line-through).
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

*Última actualización: agosto 2026 (rediseño de estados de Viaje en 3 indicadores independientes — etapa/facturación/liquidación —, split de estado de Factura en ciclo de vida + cobrado/vencida, y `Factura.ambiente`)*
*Desarrollado por Elias N. Capasso — CapassoTech / Vialto*
