## Aislamiento multi-tenant (obligatorio antes de tocar la base)

Antes de escribir cualquier consulta a la base de datos, seguí las reglas de aislamiento
multi-tenant. **No las dupliques acá**: la fuente de verdad es un solo archivo.

@docs/reglas-multitenant.md

---

## Arquitectura del proyecto

A continuación se incluye el contenido completo del documento de arquitectura
que debés respetar en todo momento:

# Vialto - Arquitectura del Sistema

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
5. **El core no depende de módulos** — los módulos pueden depender del core pero no entre sí.
   - **Excepción (oct 2026): módulos transversales.** Un módulo vendible puede depender de `notificaciones` (y de `dashboard`), **nunca al revés**. Para sumar avisos, el módulo registra su propio evaluator con `NotificacionesCronService.registrarEvaluator` en `onModuleInit` (ver Mantenimiento, `modules/mantenimiento/notificaciones/`), en vez de meter un evaluator que lo conozca dentro de `notificaciones`. Así el aviso reusa el cálculo del módulo sin duplicarlo y `notificaciones` no conoce a ningún módulo vendible. Combustible ya dependía de `notificaciones` (`notificarAhora`). Mismo patrón para el "Resumen de alertas" del dashboard: el módulo registra un proveedor en `DashboardAlertasRegistry` (`modules/dashboard/dashboard-alertas.registry.ts`) y el dashboard lo suma con `sumarBloqueAlerta` (ver Mantenimiento, `modules/mantenimiento/dashboard/`).
6. **Migraciones Prisma** — se crean y prueban con `prisma migrate dev` en la rama **develop** del proyecto Neon **`vialto-desarrollo`** (entorno QA — proyecto separado del de producción desde sep 2026, ver `MIGRATIONS.md`); en **producción** se aplican solas con `prisma migrate deploy` vía el **Pre-Deploy Command** de Render al mergear a `main`. Nunca correr `migrate dev` ni `migrate reset` contra producción. Guía completa en `MIGRATIONS.md`.
   - **OJO — la base develop (QA) es compartida entre ramas de git.** `migrate dev` puede detectar *drift* / "migration modified after applied" / "migration missing" cuando otra rama aplicó una migración que no tenés local. **Nunca resetear** (borra la base compartida y todos sus datos). Para resolver: sincronizar migraciones con `git pull`; y si solo necesitás agregar una columna aislada sin pelear con el drift, aplicarla con `npx prisma db execute --file ...` (ALTER TABLE aditivo e idempotente) + `npx prisma generate`. A futuro conviene una base por rama/dev (Neon branching).

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

// Transporte externo (a quien se paga el flete; siempre tipo "externo")
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

### Unicidad de ID Fiscal / DNI por tenant (Cliente, Transportista, Chofer) — sep 2026

`Cliente.idFiscal`, `Transportista.idFiscal` y `Chofer.dni` **no tienen `@@unique` a nivel Prisma** (a diferencia de `Vehiculo.patente`) — la unicidad se valida a nivel de aplicación, no de base, y se decidió a propósito no agregar el constraint (evita una migración sobre la base compartida de develop; el `findFirst` previo alcanza para el caso de uso real). `ClientesService`/`TransportistasService` (`assertIdFiscalDisponible`) y `ChoferesService` (`assertDniDisponible`) hacen un `findFirst({ where: { tenantId, idFiscal|dni, id: { not: excludeId } } })` antes de `create()`/`update()` y tiran `ConflictException` (409) si ya existe otro registro del mismo tenant con ese valor. **Siempre scopeado por `tenantId`**: dos tenants distintos pueden tener el mismo CUIT/DNI sin ningún conflicto — nunca comparar entre empresas. Sin constraint de DB no hay protección contra una condición de carrera de dos requests simultáneos con el mismo valor nuevo (aceptado, caso extremadamente raro en alta manual). El mismo criterio corre en la importación masiva — ver `importaciones`, "Conflicto de campo único".

---

## Fechas y zona horaria (oct 2026)

**Regla global — "hoy" y los días calendario se calculan en hora de Argentina, nunca en UTC.** El server corre en UTC (Render): `new Date().toISOString().slice(0, 10)`, `setUTCHours(0, 0, 0, 0)` sobre "ahora" o `setHours(0, 0, 0, 0)` dan el día UTC, que **desde las 21 h de Argentina ya es el día siguiente**.

Helpers únicos en `src/shared/util/fecha-ar.util.ts`:

- **`ymdAr(d?)`** → `YYYY-MM-DD` del instante en hora de Argentina (sin argumento, hoy). Para strings de fecha (ej. `fechaEmision` de una factura generada, períodos).
- **`fechaCalendarioAr(input?)`** → `Date` a medianoche UTC del día calendario. Normaliza lo que manda el cliente: `YYYY-MM-DD` o medianoche UTC exacta se toman literal; un instante con hora se lleva a su día en Argentina; sin input, hoy en Argentina. Usarlo para todo campo "día sin hora" que se guarde o se compare (ej. `vencido = fechaVencimiento < fechaCalendarioAr()`).

**Convención de almacenamiento por campo** (verificada contra prod, oct 2026 — el front depende de esto, ver `vialto-frontend/CLAUDE.md`, "Fechas"):

| Convención | Campos |
| --- | --- |
| Medianoche UTC (día sin hora) | `CargaCombustible.fecha`, `VehiculoKmEdicion.fecha`, `Factura.fechaEmision/fechaVencimiento/caeFechaVto`, `MovimientoCuentaCorriente.fechaVencimiento`, `Liquidacion.periodoDesde/periodoHasta/caeFechaVto`, `Transportista.fechaVencimientoPermiso`, `Vehiculo.vencimientoPoliza`, `OrdenTrabajo.fecha`, `VehiculoPlan.baseFecha` |
| String `YYYY-MM-DD` dentro de JSON | `Viaje.pagosTransportista[].fecha`, `Viaje.otrosGastos[].fecha` |
| Medianoche Argentina (03:00Z) o instante con hora | `Viaje.fechaCarga/fechaDescarga` (con hora a propósito desde oct 2026), `MovimientoStock`/`StockOperacion` (`stock-fecha.util.ts`), `Chofer.licenciaVence` (mezcla) |
| Instante real | `Pago.fecha`, `createdAt`/`updatedAt`, `AsignacionVehiculo.fechaDesde/Hasta`, `Factura.anulacionFecha` |
| Mezcla (día o instante) | `MovimientoCuentaCorriente.fecha` (cargos autogenerados heredan el instante del origen) |

Un campo nuevo "día sin hora" va a **medianoche UTC vía `fechaCalendarioAr`**, no a una convención nueva.

**Excepción — ARCA:** la fecha de comprobante (`CbteFch`) tiene su propia lógica en `arca.util.ts` (`formatFechaCbteArgentina`, `resolveFechaCbteFactura`, ventana de ±5 días); no reemplazarla por estos helpers.

Historia: oct 2026, Bressan reportó una carga de combustible con 14/10 en el listado y 13/10 en el detalle. La auditoría corrigió en el backend: carga de combustible sin fecha o con hora (crear/editar, admin y chofer, límites de km), fecha de la corrección manual de km (`VehiculosService.hoyUtc`), fecha de emisión de las facturas generadas al importar viajes y período del import (`importaciones-post-viajes.service.ts`), y "vencido" del tablero de cuenta corriente. Datos: 1.821 cargas legacy (jul–ago 2026, migradas con hora) se normalizaron en prod y en QA a medianoche UTC de su día en Argentina (281 cambiaron de día en cada una); respaldo en `_backup_cargas_combustible_fecha_20261014` en ambas bases (borrar una vez validado).

---

## Listados: orden por columna (oct 2026)

Las grillas ordenan con click en el título de cada columna (regla completa y estado por grilla en `vialto-frontend/CLAUDE.md`, "Grillas: ordenar con click en el título de la columna"). Del lado backend, en un listado paginado:

- `sortBy` validado contra una lista de campos permitidos (ej. `VIAJES_SORT_FIELDS`, `FACTURAS_SORT_FIELDS`, `COMBUSTIBLE_SORT_FIELDS_COLUMNA`) y `sortDir` `asc|desc`.
- Se ordena **sobre todo lo filtrado**, no sobre la página: `select` mínimo con id + claves (siempre con el `where` del tenant), `ordenarPorClaves` de `shared/util/orden-listado.util.ts`, cortar la página y traer solo esos registros completos. Ver `ViajesService.findAllPaginatedOrdenTexto`, `CombustibleService.findPaginaOrdenColumna`, `FacturacionService.ordenarFacturas`.
- El criterio de comparación (sin mayúsculas ni acentos, números como números, vacíos al final) vive solo en `orden-listado.util.ts`, espejo de `lib/ordenListado.ts` del front. No ordenar texto con `orderBy` de Prisma: la collation de la base no ignora acentos ni mayúsculas, y el front y el back darían órdenes distintos.
- Las claves son lo que muestra la celda (nombre, no id) y los estados van en orden del circuito.

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
    padron/                 ← ✅ consulta de CUIT al padrón de ARCA (nombre/domicilio/estado) con certificado de plataforma, para todo tenant — ver sección "`core/padron`"
    platform/               ← ✅ superadmin: CRUD cross-tenant sobre casi todas las entidades (viajes, clientes, choferes, vehículos, transportistas, destinatarios, direcciones, users, facturas/pagos, stock completo, config/liquidaciones/facturas/logs ARCA)

  modules/
    viajes/                 ← ✅ implementado — multi-vehículo/destino/producto, moneda, MIC·CRT
    facturacion/            ← ✅ implementado — extiende viajes, campos ARCA (CAE) en Factura
    cuenta-corriente/       ← ✅ implementado — por cliente (a cobrar) y proveedor/fletero (a pagar), imputación de pagos a cargos, sync bidireccional con viajes/facturación, tablero, alertas por email, export PDF/Excel
    stock/                  ← ✅ implementado — operaciones (ingreso/egreso/división), lotes, presentaciones por producto, remito interno
    combustible/            ← ✅ implementado — CRUD, detección de cargas sospechosas, dashboard, export Excel, fotos (Cloudinary), API paralela para choferes vía chofer-auth. El tag Swagger "[Próximamente]" quedó desactualizado: el módulo está activo.
    mantenimiento/          ← ✅ implementado (parcial) — CRUD de `Intervencion` en Postgres; el checklist diario en Firestore que describe este documento NO está implementado todavía
    liquidaciones-arca/     ← ✅ implementado — OJO: los slugs de módulo reales (`RequireModule`, `Tenant.modules`) son `emision-facturas-arca` y `emision-liquido-producto-arca` (divididos en ago 2026, antes era un solo `integracion-arca`), no `liquidaciones-arca` — ver nota de VIALTO_MODULES arriba y la sección propia del módulo más abajo
    dashboard/              ← ✅ implementado — KPIs y alertas del tenant (`GET dashboard/resumen`); no es un módulo vendible (no gateado por `RequireModule`, disponible para todo tenant)
    importaciones/          ← ✅ implementado — motor de importación desde Excel (parser/validator/processors por módulo), preview/confirm, templates y logs; uso admin, no gateado como módulo vendible
    notificaciones/         ← ✅ implementado — alertas por email vía Resend, catálogo + config on/off por tenant; ver sección propia más abajo

  shared/
    guards/                 ← ClerkAuthGuard, TenantGuard, ModuleGuard
    decorators/             ← @CurrentTenant(), @RequireModule()
    prisma/                 ← PrismaService singleton
    types/                  ← interfaces, enums compartidos (incluye `VIALTO_MODULES`, la lista canónica de slugs de módulo)

  app.module.ts
  main.ts
```

> **Nota sobre `turnos`:** Módulo para sindicatos/cooperativas de choferes (Pereyra), no para empresas de logística — se pensaba desarrollar aislado, fuera de los planes standard de Vialto. El stub que existía (`GET turnos/estado`, sin modelo Prisma ni service) se borró por completo en ago 2026 — código y slug en `VIALTO_MODULES` — porque no tenía nada real detrás y Pereyra sigue "🔲 Pendiente" (ver "Clientes actuales y estado"). Si se retoma, es desde cero.
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
  facturacionEstado                String    @default("sin_facturar") // sin_facturar | borrador | esperando_afip | facturado | cobrado | error_afip | anulado
  liquidacionEstado                String?   // null si no aplica (sin transportista externo o tenant sin emision-liquido-producto-arca); sino: sin_liquidar | borrador | esperando_afip | liquidado | error_afip | anulado
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
  precioTransportistaIvaIncluidoPct Float    @default(0) // % de IVA que el transportista suma en efectivo por encima del precio (neto); ver "precioTransportistaExterno con % de IVA a sumar en efectivo" más abajo
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
- **`facturacionEstado`**: `sin_facturar | borrador | esperando_afip | facturado | cobrado | error_afip | anulado`.
- **`liquidacionEstado`**: `null` (no aplica: sin transportista externo o tenant sin `emision-liquido-producto-arca`) | `sin_liquidar | borrador | esperando_afip | liquidado | error_afip | anulado`.

**`borrador` (oct 2026, solo tenants con ARCA)**: el viaje tiene un comprobante vinculado que todavía no se intentó emitir (`Factura.arcaEstado == null` / `Liquidacion.estado === 'borrador'`). Antes la factura borrador caía en `sin_facturar` (la grilla ofrecía "Facturar" de nuevo, invitando a duplicar) y la liquidación borrador en `esperando_afip` (como si ya se hubiera mandado a AFIP). Ahora la grilla de Viajes muestra el badge "en borrador" y la acción "Continuar factura/liquidación", que abre la emisión de ese comprobante. Reglas: (1) facturación `borrador` está en `FACTURACION_ESTADOS_DISPONIBLES` (no bloquea campos fiscales, gastos ni clientes — mismo comportamiento que cuando era `sin_facturar`); liquidación `borrador` NO está en `LIQUIDACION_ESTADOS_DISPONIBLES` (mismo bloqueo que tenía como `esperando_afip`). (2) Para conteos y filtros "sin facturar" (dashboard, resumen y filtro `facturacionEstado=sin_facturar` del paginado) usar `FACTURACION_ESTADOS_PENDIENTES` (`sin_facturar` + `borrador`): un borrador sigue pendiente de facturar. (3) Vincular el viaje a una factura NUEVA sigue dependiendo del FK (`facturaDisponibleWhere`), no del estado. Tenants sin ARCA nunca ven `borrador` (la factura manual cuenta como `facturado` y la liquidación manual como `liquidado`). Backfill en la migración `20261007160000_viaje_estado_borrador`.

**Sync**: `modules/viajes/viaje-estado-financiero.ts` expone las funciones puras `mapFacturacionEstado`/`mapLiquidacionEstado` (calculan el indicador a partir de `Factura.arcaEstado` / `Liquidacion.estado` + si el tenant tiene ARCA) y las funciones que tocan DB `syncFacturacionEstadoViaje(s)`/`syncLiquidacionEstadoViaje(s)`. **Toda** operación que crea, vincula, desvincula, emite, anula o elimina una Factura o Liquidación debe llamar al sync correspondiente para los viajes afectados — ya está wired en `facturacion.service.ts` (create/update/removeFactura/pagos/marcarComoCobrada) y `liquidaciones.service.ts` (create/emitir/anular/deleteLiquidacion, emitir/anularFacturaArca). Un bug histórico real (re-facturar tras anular quedaba bloqueado) fue justamente un `anularFacturaArca` que no llamaba al sync — si se agrega un nuevo punto de mutación de Factura/Liquidación, hay que sumar la llamada ahí también.

**También hay que llamar `syncLiquidacionEstadoViaje` al CREAR un viaje** (`viajes.service.ts#create` y `importaciones/processors/viajes.processor.ts#insert`), aunque todavía no tenga ninguna Liquidación — `liquidacionEstado` no tiene `@default` en el schema (a propósito, porque su valor correcto depende de si aplica o no), así que sin esa llamada un viaje con transportista externo en un tenant con ARCA queda en `null` en vez de `sin_liquidar` hasta el primer evento de liquidación. Bug real encontrado y corregido en ago 2026 (afectaba viajes recién creados de NyM, bloqueando el flujo de liquidación).

**Tenant sin `emision-liquido-producto-arca`**: `liquidacionEstado` es `null` únicamente si el viaje no tiene transportista externo — **no** por falta de ARCA. `CrearLiquidacionManualModal` con `hasArca=false` sigue creando una `Liquidacion` real (registro manual, queda en `estado: 'borrador'` para siempre porque no hay paso de "emitir" sin ARCA), así que estos tenants sí tienen liquidaciones genuinas que hay que reflejar. `mapLiquidacionEstado(estado, tieneArca)` maneja esto: con `tieneArca=false`, cualquier registro no-anulado (`borrador`, y por herencia `pendiente_cae`/`autorizado`/`error` si quedaron de datos viejos) mapea directo a `liquidado` — nunca a vocabulario de AFIP (`esperando_afip`/`error_afip`). Bug real encontrado y corregido en ago 2026: la versión anterior forzaba `liquidacionEstado = null` para todo tenant sin ARCA (confundiendo "no aplica AFIP" con "no aplica liquidación"), lo que hacía que `FacturarSelectorModal` mostrara "Liquidación a transportista" como **siempre completada** ("Ya registrado") incluso en viajes sin ninguna liquidación real — bloqueando de hecho la creación de liquidaciones manuales nuevas. `facturacionEstado` sigue el mismo criterio y no tiene este problema porque nunca dependió de si existía o no un registro: nunca expone valores AFIP (`esperando_afip`/`error_afip`) para tenants sin ARCA — cae directo a `facturado`/`cobrado`/`anulado`.

**Edit-lock por campo, no todo-o-nada**: `viajes.service.ts` define `CAMPOS_FISCALES_VIAJE` (cliente, transportista, montos, gastos, pagos a transportista) — bloqueados con `ConflictException` mientras `facturacionEstado ∉ {sin_facturar, borrador, anulado}` o `liquidacionEstado ∉ {null, sin_liquidar, anulado}`. Los campos operativos (fechas, km, litros, chofer, vehículos, observaciones, **incluida `etapa`**) siempre son editables, esté o no facturado/liquidado.

**Frontend** (`vialto-frontend/src/lib/viajesIndicadores.ts`): centraliza labels/clases/tooltips de los 3 indicadores y `facturacionPermiteVincular`/`liquidacionPermiteVincular` (`sin_facturar`/`anulado` cuentan como "disponible para vincular una factura/liquidación nueva"). Los badges de la grilla de Viajes (`ViajeFacturacionIndicador`/`ViajeLiquidacionIndicador`) son clickeables: si el viaje ya tiene factura/liquidación vinculada, el click trae el registro completo (fetch on click) y abre directo `FacturaViewModal`/`LiquidacionViewModal` — sin modal intermedio; si todavía no hay nada vinculado, muestra un modal de detalle liviano (`ViajeFacturacionDetalleModal`/`ViajeLiquidacionDetalleModal`) que solo informa el estado. **Estos badges nunca agregan acciones de mutación** (ej. "marcar como cobrada", emitir, anular) — eso vive únicamente en las pantallas de Facturas/Liquidaciones; desde Viajes es solo lectura/navegación.

**"Marcar como cobrada" apagable por empresa (oct 2026)**: `Tenant.marcarCobradaHabilitada` (default `false`, migración `20261009140000_tenant_marcar_cobrada_habilitada`, switch en superadmin "Configuración por empresa" → General). Sin habilitar, `FacturacionService.marcarComoCobrada` tira `BadRequestException` (aplica también al endpoint de `platform`).

#### `precioTransportistaExterno` con % de IVA a sumar en efectivo — ago 2026 (v3: engrosar, reemplaza al neteo de la v2)

**`precioTransportistaExterno` (y, en modo desglose, `cantidadTransportista × precioUnitarioTransportista`) es y siempre fue el precio NETO/base (sin IVA) del flete** — el que se usa tal cual para Liquidación/CVLP, dashboard y MIC/CRT. `Viaje.precioTransportistaIvaIncluidoPct` (`Float @default(0)`) es un dato aparte: 0 = el transportista no suma IVA al cobrar (comportamiento de siempre, sin cambios); >0 = % de IVA que el transportista **suma en efectivo por encima** de ese precio neto al cobrarlo (ej. `21`) — solo afecta cuánto hay que pagarle en mano y la ganancia bruta automática, nunca el precio guardado ni el cálculo fiscal de la Liquidación.

**Historia del campo (2 diseños descartados antes de llegar a este)**:
1. **v1 (boolean, descartada)**: checkbox que excluía mutuamente al viaje de cualquier Liquidación ARCA/CVLP — bloqueaba directamente la operación. Se sacó porque el usuario quería poder liquidar igual.
2. **v2 (% + "neteo", descartada)**: interpretaba `precioTransportistaExterno` como el TOTAL ya con IVA adentro, y "neteaba" (dividía) para descontarlo antes de sumarlo al `bruto` de la Liquidación. Se descartó tras un mensaje real del cliente LSF: el precio que se carga en el viaje **siempre fue pensado como la base sin IVA** (lo que factura el transportista antes de sumar su alícuota), no como un total con IVA ya adentro — confundir esa dirección hacía que el "pago en efectivo" mostrado fuera menor al real, y de paso escondía una ganancia bruta automática inflada (ver caso real abajo).

**Caso real que motivó la v3 (cliente LSF, ago 2026)**: cliente paga al tenant $1.300.000 por un viaje; el transportista cobra $1.100.000 de flete **más 21% de IVA** = $1.100.000 × 1,21 = **$1.331.000** en efectivo. Antes de la v3, el sistema calculaba la ganancia bruta como $1.300.000 − $1.100.000 = **+$200.000** (falso, ignoraba el IVA que hay que pagarle al transportista) en vez de la pérdida real: $1.300.000 − $1.331.000 = **−$31.000**.

**Fórmula — "engrosar", la inversa del neteo** (`engrosarConIva(precioNeto, pct)`, única fuente de verdad en `viajes/viaje-ganancia-bruta.util.ts` — importada por `viajes.service.ts` y `dashboard-financiero.service.ts`; espejada en frontend por `lib/viajesTransportistaPagos.ts`, misma exportación con el mismo nombre):
```ts
export function engrosarConIva(precioNeto: number, pct: number | null | undefined): number {
  const p = Number(pct) || 0;
  if (p <= 0) return precioNeto;
  return Math.round(precioNeto * (1 + p / 100) * 100) / 100;
}
```
Ejemplo: precio neto $1.100.000, 21% → $1.331.000 (cuánto se le paga en efectivo al transportista).

**Dónde se aplica el engrosado (y dónde NO)**:
- **`viajes.service.ts#calcularAcordado`** (reconstruye "cuánto se le debe/pagó al transportista", para saldo pendiente/validación de pagos — espejado en frontend por `totalPagadoTransportistaEnMonedaAcordada` de `lib/viajesTransportistaPagos.ts`): en el caso base (sin Liquidación vigente todavía), engrosa `precioTransportistaExterno` con el % del viaje antes de comparar contra los pagos registrados — ese es el monto real en efectivo a entregar. **Cuando el viaje ya tiene una Liquidación vigente, el acordado pasa a reconstruirse 100% desde los montos reales de esa Liquidación (`bruto`/`comisionPct`/`ivaPct`/`conceptosLineas` de la Liquidación en sí, que tiene su propia alícuota de IVA independiente) — ahí NO se vuelve a aplicar `engrosarConIva`, sería doble conteo.**
- **`viaje-ganancia-bruta.util.ts#calcularGananciaAutomatica`** (`monto cliente − precio transportista − otros gastos`): usa el precio transportista **engrosado** con `precioTransportistaIvaIncluidoPct`, no el neto crudo — es la corrección directa del bug del caso LSF. Se propaga a `findAllPaginatedOrdenGananciaBruta`/`getGananciaBruta` de `viajes.service.ts` (ambos ya seleccionan y pasan `precioTransportistaIvaIncluidoPct`) y a los dos cálculos manuales de "acordado" en `dashboard-financiero.service.ts` (funnel de viajes pendientes/liquidados y liquidaciones por transportista).
- **Si el viaje tiene `costoLiquidadoReal`** (ya liquidado, el costo real ya viene de la Liquidación): el % se fuerza a `0` antes de engrosar en `findAllPaginatedOrdenGananciaBruta`/`getGananciaBruta` — el costo real de la Liquidación ya es el número correcto, engrosarlo de nuevo sería doble conteo (mismo motivo que el punto anterior).
- **Liquidación/CVLP — SIN CAMBIOS, vuelve a su comportamiento previo a toda esta serie de rediseños**: `liquidaciones-arca/liquidaciones.service.ts#createLiquidacion` suma `precioTransportistaExterno`/`subtotal` tal cual al agregado `bruto`, sin ajustar por el % del viaje — porque ese precio ya es neto, y el IVA que declara la Liquidación es un campo totalmente aparte (`ArcaConfig.ivaGastosAdmin`/`ivaPct` de la Liquidación), configurado independientemente del % del viaje. **Ya no hay ninguna validación de "viajes con distinto % no se pueden liquidar juntos"** (existió brevemente durante la v2, se sacó por completo) — el % del viaje nunca entra al cálculo de la Liquidación, así que mezclar viajes con distinto % en una misma Liquidación no genera ninguna inconsistencia. `arca-iva.util.ts`, `cvlp-conceptos.util.ts`, `liquidacion-pdf.service.ts`, `update()` y `emitirLiquidacion()` no se tocaron.
- **Fuera de alcance a propósito** (siguen mostrando el neto, sin engrosar): los agregados SQL `_sum` de `getStats()` (`viajes.service.ts`) y `sumAPagarPorMoneda`/`sumAPagarTransportistas` (`dashboard.service.ts`) — son `_sum: { precioTransportistaExterno: true }` a nivel de Prisma aggregate, no iteran fila por fila, así que aplicar el engrosado ahí requeriría restructurar la query; y los documentos MIC/CRT, que reflejan el dato operativo tal cual se cargó. Si en el futuro se decide corregir esto, hay que traer las filas y engrosar en memoria (mismo patrón que ya usa `dashboard-financiero.service.ts`).
- **Aplica a ambos modos de carga**: precio simple (`precioTransportistaExterno`) y modo desglose (`cantidadTransportista × precioUnitarioTransportista`, usado por NyM/granel).

**Lock angosto, distinto al resto de `CAMPOS_FISCALES_VIAJE`**: `precioTransportistaIvaIncluidoPct` **NO** está en `CAMPOS_FISCALES_VIAJE` — tiene su propio guard en `update()`, bloqueado **solo** por `liquidacionEstado` (no por `facturacionEstado`). Es intencional: facturación al cliente y liquidación al transportista son ejes independientes, y bloquear este campo por una factura al cliente (sin relación con el transportista) dejaría el campo atascado para siempre en viajes viejos de un tenant que recién adopta `emision-liquido-producto-arca`. Una vez que el viaje tiene liquidación vigente, el % queda fijo porque el "pago en efectivo" ya se le comunicó al transportista con ese valor — cambiarlo después desincronizaría el acordado ya conocido (aunque, como se explica arriba, la Liquidación en sí nunca leyó este %). Si se agrega un campo nuevo relacionado solo al transportista (no al cliente), evaluar si también necesita este lock angosto en vez de sumarlo sin más a `CAMPOS_FISCALES_VIAJE`.

**Frontend**: input numérico "% de IVA ya incluido en el precio" (`ViajeCreatePage.tsx`, `ViajeEditModal.tsx`; `0` o vacío = no suma IVA), bloqueado solo cuando `liquidacionVigente` (mismo criterio de arriba). El trío "Pago bruto / Pago neto / Monto IVA" del modo desglose (`ViajeEditModal.tsx`, `ViajeCreatePage.tsx`) muestra: bruto = `engrosarConIva(neto, pct)` (lo que se paga en efectivo, mayor), neto = cantidad × precio unitario tal cual se tipeó (el valor guardado), IVA = bruto − neto. `CrearLiquidacionManualModal.tsx` ya no ajusta su resumen por este %, porque la Liquidación tampoco lo hace — el bruto ahí es la suma simple de `precioTransportistaExterno` de los viajes seleccionados. Ningún patrón de advertencia por módulo ARCA aplica a este campo (no tiene incompatibilidad con `emision-liquido-producto-arca`).

**Migraciones**: `20260818120000_viaje_precio_transportista_incluye_iva` (v1, boolean, descartada) seguida de `20260819120000_viaje_precio_transportista_iva_incluido_pct` (dropea el boolean, agrega el float que sigue vigente) — sin dato de producción en juego, la v1 nunca llegó a producción. La v2→v3 (neteo→engrosar) fue puramente un cambio de interpretación en código, sin tocar el schema ni requerir migración nueva.

**Pagos al transportista con liquidación vigente — resumen real en vez de fieldset editable** (`ViajeEditModal.tsx`, ago 2026, sin cambios por el rediseño de arriba — sigue vigente tal cual): el "Acordado/Pagado/Saldo" en vivo de `PagosTransportistaFieldset` (`calcularSaldoTransportistaDesdeDraft`) siempre calculó sobre el precio plano del draft, sin mirar `liquidacionesViaje` — y `pagosTransportista` está en `CAMPOS_FISCALES_VIAJE`, así que editar filas ahí ya fallaba igual al guardar una vez que el viaje tiene liquidación vigente. La sección "Pagos al transportista" de `ViajeEditModal.tsx` bifurca por `liquidacionVigente`: si hay liquidación vigente, en vez del fieldset editable muestra `PagosTransportistaSummary` (solo lectura, `calcularSaldoTransportista` con la Liquidación real) + el badge `ViajeLiquidacionIndicador` reusado tal cual de la grilla de Viajes (fetch-on-click, abre `LiquidacionViewModal` completo — comisión, IVA, conceptos, líquido, CAE). Sin liquidación vigente, sigue el fieldset editable de siempre — ahí el draft y el real coinciden, no hace falta el resumen.
  - `PagosTransportistaSummary.onRegistrarPago` es opcional: si el host no lo pasa, el botón "+ Registrar pago" no se muestra. `ViajeEditModal` recibe `onRegistrarPago?: () => void` por prop, wireado en `ViajesTenantPage.tsx` (que ya tenía `RegistrarPagoTransportistaModal` montado a nivel página) contra `viajeEditor.viajeSnapshot`; `TenantHomePage.tsx` no lo pasa (no tiene ese modal montado) — ahí el resumen queda de solo lectura sin el botón, no se agregó el modal completo solo para esto.
  - `useViajeEditor.ts` expone `patchViajeSnapshot(updated: Viaje)` — sin esto, registrar un pago mientras el editor sigue abierto para el mismo viaje dejaba `viajeSnapshot` desactualizado. Se llama junto a `setDraft(...)` en el `onSuccess` de `RegistrarPagoTransportistaModal`.

---

### `facturacion` — Facturación y cobranzas
Se construye sobre `viajes` (relación N:M, una factura puede cubrir varios viajes). Incluye moneda, IVA, comprobante adjunto y los campos de emisión ARCA (nulos si el tenant no tiene `emision-facturas-arca`).

```prisma
model Factura {
  id               String         @id @default(cuid())
  tenantId         String
  numero           String
  tipo             String         // cliente | transportista_externo
  clienteId        String?
  transportistaId  String?
  viajes           Viaje[]
  importe          Float          // neto (suma completa de viajes)
  ivaMonto         Float?         // IVA persistido; solo por-tramo sin ARCA — ver abajo
  moneda           String         @default("ARS") // ARS | USD
  fechaEmision     DateTime
  fechaVencimiento DateTime?
  estado           String         @default("pendiente") // valor crudo en BD, no autoritativo — ver "Estado de una Factura en lectura" abajo
  diferencia       Float?
  ivaPct           Float?         @default(21)
  facturarPorTramo Boolean        @default(false)
  comprobanteUrl   String?        // PDF/imagen en Cloudinary
  // Campos ARCA — nulos para tenants sin módulo emision-facturas-arca
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

#### Facturas por tramo (LSF / Uruguay) — IVA persistido (sep 2026)

Pedido real de LSF: facturan a clientes separando cada viaje en tramos con distinto IVA (tramo AR exento, tramo UY 22%), como exige la normativa uruguaya. El PDF lo emiten ellos afuera y lo suben como comprobante — Vialto no arma ese PDF.

- **`importe` (neto)**: siempre la suma **completa** de los viajes (`cantidadFactura × precioUnitarioFactura` si hay). Los tramos **no reemplazan** el monto del viaje. Si LSF carga solo el tramo gravado (factura A 18), el resto del viaje no se pierde: queda en el neto y se trata como tramo implícito con `ivaPct` de cabecera (en LSF es 0% = parte exenta). **No** se valida que la suma de tramos coincida con el viaje ("completar solo", no "exigir todos los tramos").
- **`ivaMonto`**: IVA total **persistido al guardar** (create/update recalculan neto + IVA juntos). Solo se llena en facturas por tramo de tenants **sin** `emision-facturas-arca`. `null` = no aplica, tenant ARCA, o todavía no backfilleado — en ese caso el cobro recalcula en vivo.
- **Cobro** (`importeOperativoFactura` / `importeACobrar` / `saldoPendiente` / `cobrado`): tenants sin ARCA + por tramo = `importe + ivaMonto` (o recálculo live si `ivaMonto` es null). Tenants con ARCA y facturas simples **no cambian**: el cobro sigue midiendo el neto (lo que se declara ante AFIP).
- Lectura: todas las pantallas y el dashboard financiero leen esos dos valores guardados; no rearman la cuenta tramo a tramo cada uno por su lado.
- Histórico: `npm run backfill:factura-iva-tramos:dry` (preview) / `npm run backfill:factura-iva-tramos` (aplica). Recalcula `importe`/`ivaMonto` y lista las facturas que quedan con diferencia a cobrar para que LSF confirme si ya se cobró afuera.

---

#### Estado de una Factura en lectura — dos ejes independientes, badges aditivos (ago 2026)

`computeEstadoFacturaLectura` (`shared/util/factura-estado-lectura.ts`) es la única fuente de verdad del estado de una Factura al leerla (el valor crudo en la columna `estado` no se mantiene). Separa dos preguntas que antes se mezclaban en un solo campo:

- **`estado`** (ciclo de vida del comprobante): `borrador | esperando_afip | facturado | error_afip | anulado`. Sigue el mismo orden de prioridad que `mapFacturacionEstado` en `viaje-estado-financiero.ts` — mantener ambos sincronizados si cambia la regla. Para tenants sin `emision-facturas-arca` siempre es `facturado` (no hay borrador ni error AFIP fuera de ese módulo).
- **`cobrado`** / **`vencida`** (booleanos, eje de cobro, independiente del ciclo de vida): se puede estar cobrado en cualquier `estado` (ej. cobrado antes de anular); `vencida` solo puede ser `true` si no está cobrada y ya se llegó a `facturado`.

**Regla de UI obligatoria**: el badge de `cobrado`/`vencida` es **aditivo** — se muestra junto al badge de `estado`, nunca lo reemplaza (mismo criterio para `AmbienteTestBadge`, ver frontend). Implementado en `FacturacionTenantPage.tsx` (`renderEstadoBadges`), `FacturaViewModal.tsx` y `FacturaEditModal.tsx` — reusar ese patrón en pantallas nuevas en vez de volver a un único badge combinado. Los labels de estos badges van en **MAYÚSCULA** (`BORRADOR`, `ESPERANDO AFIP`, `FACTURADO`, `ERROR DE AFIP`, `ANULADO`, `COBRADO`, `VENCIDA`), y el badge `ANULADO` usa `line-through` — mismo estilo gris que usa `Liquidacion.estado === 'anulado'`.

`tieneArca` se resuelve siempre consultando `Tenant.modules` (nunca infiriendo por presencia de `arcaEstado`), igual que en `viaje-estado-financiero.ts` — ver `FacturacionService.tieneArca()`. El filtro `?estado=` de `facturas-paginated-query.dto.ts` sigue aceptando los 7 valores conceptuales (incluye `cobrado`/`vencida`); el service los resuelve contra los campos booleanos, no contra `estado`.

`Liquidacion.estado` sigue siendo un solo eje (`borrador|pendiente_cae|autorizado|error|anulado`, ver más abajo) porque no tiene una noción de "cobro" separada del comprobante — no se dividió en dos.

---

### `cuenta-corriente` — Cuenta corriente por cliente y por proveedor/fletero (rediseñado sep 2026)

Reescrito desde cero respecto a la versión inicial (que era solo por cliente, un movimiento por viaje, sin moneda/vencimiento/estados). Hoy cubre ambos lados: **cliente** (a cobrar) y **proveedor/fletero** — un `Transportista` actuando como proveedor, ej. Riedel pagándole a sus fleteros — (a pagar), con el mismo modelo.

- **`contraparteId`** = `clienteId ?? proveedorId`, columna auxiliar no nula para agrupar por cuenta sin distinguir lado.
- **Dos ejes de estado independientes, nunca mezclados**: un `cargo` (venta/compra) usa `estadoDisponibilidad` (`pendiente|parcial|cancelado|anulado`, cuánto de su importe cubren las imputaciones recibidas); un `pago` (cobro/pago) usa `estadoImputacion` (`no_imputado|imputado_parcial|imputado`). Ambos se recalculan siempre vía `ImputacionCuentaCorriente`, nunca se editan a mano.
- **`tipo`**: `cargo` (Debe) | `pago` (Haber) | `credito` (Haber: anulación / nota de crédito, ver abajo). **`origen`**: `manual | factura | liquidacion | anulacion` (`viaje` solo en datos viejos, ver abajo).
- **La cuenta corriente depende SOLO de facturas y liquidaciones (oct 2026).** Crear, editar, finalizar o cancelar un viaje no genera movimientos. El movimiento nace al crear el comprobante, con o sin ARCA (también un borrador con ARCA), y se actualiza con sus cambios:
  - **Factura de cliente** → `FacturacionService.upsertCargoFactura`: una fila por factura (`origen: 'factura'`, `facturaId`), por el mismo importe contra el que Facturas mide el cobro (`importeCargoFactura`: neto, o neto + IVA en facturas por tramo sin ARCA). El número de ARCA se completa al emitir. Desde Cuenta corriente (`PATCH cuenta-corriente/movimientos/:id/comprobante`) se puede corregir el número (solo sin `emision-facturas-arca`, obligatorio) y el vencimiento: se guardan en la factura vía `FacturacionService.updateFactura` (mismo camino que editarla desde Facturas) y el movimiento se refresca desde ahí.
  - **Liquidación a proveedor** → `sincronizarCargoLiquidacionCc` (`liquidaciones-arca/liquidacion-cuenta-corriente.ts`), llamada por `LiquidacionesService` después de cada cambio (crear, editar, emitir, anular): una fila por liquidación (`origen: 'liquidacion'`, `liquidacionId`) por el líquido. Su estado de pago suma los `pagosTransportista` de todos sus viajes (`actualizarEstadoCargoLiquidacionCc`). **N° de comprobante**: con ARCA es el del CVLP; sin ARCA es `Liquidacion.numeroComprobanteProveedor` (la factura que emite el proveedor), que se carga en el alta/edición de la liquidación o desde Cuenta corriente (`PATCH cuenta-corriente/movimientos/:id/comprobante`, que lo guarda en la liquidación y refresca el movimiento — un solo número, nunca dos). Ese endpoint también edita el número de una venta/compra manual; `comprobanteEditable` en el listado dice cuándo se ofrece. El mismo endpoint edita el **vencimiento** (`fechaVencimiento`, se guarda en el movimiento: la liquidación no tiene uno propio y el sync no lo pisa) en compras de liquidación —con o sin ARCA— y ventas/compras manuales (`vencimientoEditable`).
  - **Anular o eliminar nunca borra ni edita (VTO-431)**: `compensarMovimientoCc` (`shared/cuenta-corriente/movimiento-cc.util.ts`) deja el original intacto (solo `anulado`), crea un **crédito en el Haber** por el mismo importe (`tipo: 'credito'`, `origen: 'anulacion'`, `anulaMovimientoId` único → no se anula dos veces; queda aplicado a ese original) y deja a cuenta los cobros/pagos imputados. Un crédito NO es un cobro/pago: no se ofrece para imputar, no cuenta como cobranza ni genera `Pago` en Facturación. Aplica a factura anulada con ARCA (comprobante = nota de crédito) o eliminada (borrador, o anulación interna sin ARCA, `anularCargoFacturaCc`) y a liquidación anulada (NC/ND o manual) o eliminada.
  - Un viaje facturado o liquidado no se puede cancelar: primero se anula el comprobante.
  - **Ventas/compras manuales ("Nueva venta"/"Nueva compra") solo si la empresa NO tiene el módulo que las genera** (`CuentaCorrienteService.assertCargoManualPermitido`): con Facturación (`facturacion` o `emision-facturas-arca`) las ventas salen únicamente de las facturas; con Liquidaciones (`liquidaciones` o `emision-liquido-producto-arca`) las compras salen únicamente de las liquidaciones. Así el mismo flete nunca se carga dos veces. Cobros y pagos manuales se permiten siempre. Empresas con cuenta corriente sin esos módulos (ej. stock + cuenta corriente) siguen cargando ventas/compras a mano. El front oculta los botones con `ventasNacenDeFacturas`/`comprasNacenDeLiquidaciones` (`lib/tenantModules.ts`).
  - **Venta/compra manual por líneas (oct 2026)**: como una factura, varias líneas con su importe neto y su IVA % (`POST movimientos` con `lineas`; el front reusa `FacturaLineasEditor`). `calcularLineas` totaliza igual que el pie de Facturas (base agrupada por alícuota, IVA redondeado por alícuota); `importe` = total, `importeNeto`/`ivaMonto` = sumas, `ivaPct` = la alícuota si es una sola (null si hay varias) y el detalle queda en `MovimientoCuentaCorriente.lineas` (Json). El viejo `importe` + `ivaPct` sigue aceptado.
  - **Conceptos**: venta por factura "FACTURA" o "FACTURA A/B/C" (letra del `cbteTipo`, se completa al emitir con ARCA); compra por liquidación "LIQUIDO PRODUCTO" si se emitió el CVLP con ARCA, "LIQUIDACION" si es manual (`conceptoCargoLiquidacion`; mientras espera la anulación manual no cambia: la CC no muestra el "pendiente"); el crédito que anula una liquidación dice la NC/ND emitida, "ANULACION MANUAL" (método manual) o "ANULACION" (`conceptoAnulacionLiquidacion`); anulación con nota de AFIP "NOTA DE CRÉDITO/DÉBITO A/B" (solo la nota, sin la palabra "ANULACION"), y sin nota (interna o manual) "ANULACION" (`conceptoAnulacion`); cobro/pago manual sin concepto "COBRO"/"PAGO". El número nunca va en el concepto: va en `numeroComprobante` (columna Comprobante, para clientes y proveedores).
  - **Saldos**: los saldos/tablero excluyen todo lo `anulado` (el par original + crédito suma 0). El saldo acumulado del historial (grilla y exportación) cuenta el par completo: cargo en Debe, pago y crédito en Haber; solo excluye un anulado SIN crédito (`cuentaEnHistorialCc`, espejado en el front). Los movimientos automáticos o anulados no se editan ni se borran a mano, y no se les imputa nada.
  - **Backfill**: `scripts/backfill-cuenta-corriente.ts` genera los movimientos que falten para facturas y liquidaciones existentes (idempotente).
- **Liquidación "PAGADA" / "PAGO PARCIAL" (oct 2026)**: no es un estado de la liquidación (`Liquidacion.estado` sigue siendo solo del comprobante). `findAll`/`findById` de `LiquidacionesService` devuelven `estadoPago` (`pagada | pago_parcial | pendiente | null`) calculado del movimiento de la compra en Cuenta corriente (`conEstadoPago`, `liquidacion-cuenta-corriente.ts`); Liquidaciones solo lo muestra (badge aditivo `LiquidacionPagoBadge` en el front), nunca lo cambia.
- **Registrar un cobro/pago imputándolo (oct 2026)**: `POST movimientos` con `tipo: 'pago'` acepta `imputarACargoIds` (facturas/liquidaciones de la misma cuenta y moneda, con saldo). En una sola transacción crea el cobro y lo imputa del cargo más viejo al más nuevo, cada uno hasta su saldo (`aplicarImputacion`, mismo camino que imputar a mano, así también genera el `Pago` en Facturación); lo que sobra queda a cuenta. Sin ids = "No imputar". El cobro no lleva concepto libre: queda "COBRO"/"PAGO".
- **PDFs de estado de cuenta y "Pendientes de cobro / de pago" (`estado-cuenta-pdf.service.ts`, oct 2026)**: el segundo era un único "Listado de deudores" con los dos lados (parecía solo de clientes). Ahora son dos PDF, uno por lado: `GET listado-deudores/pdf?lado=cliente` (default) → "Pendientes de cobro", solo clientes y su total; `?lado=proveedor` → "Pendientes de pago", solo proveedores. El endpoint conserva el nombre. En la página de Cuenta corriente el botón descarga el del lado de la pestaña (Clientes / Proveedores); el tablero del dashboard ofrece los dos botones.
  - Columnas: estado de cuenta = Fecha · **Tipo** (el `concepto`) · **Comprobante** · Debe · Haber · Saldo; deudores = Contraparte · Tipo · Comprobante · Vencimiento · Pendiente. El número de comprobante es el dato principal de cada fila (texto largo con "…").
  - **Saldos por moneda, nunca sumados entre sí**: `exportarMovimientos` acumula por moneda (`saldoAcumulado` de cada fila = el de SU moneda) y devuelve `saldoInicial`/`saldoFinal` como `{ moneda, saldo }[]`. Con una moneda el PDF tiene una columna "Saldo acumulado"; con varias, una columna "Saldo {moneda}" por moneda (`layoutEstadoCuenta`), cada fila con el saldo de todas a ese momento, y Debe/Haber con la moneda al lado. El Excel del front sigue el mismo criterio.
  - **Logo arriba a la derecha** (`drawLogo`, en los dos PDF): el de la empresa (`ArcaConfig.logoUrl`, el mismo de las facturas) o, si no tiene o falla la descarga, el de Vialto (`vialto-backend/assets/vialto-logo.png`, fuera de `src`: el build no lo copia y se lee con `process.cwd()`, que en Render y en local es la carpeta del backend). Si ninguno se puede leer, sale sin logo.
  - **Pendiente (a futuro)**: hoy el logo de la empresa solo se carga desde Configuración ARCA, así que una empresa sin módulo ARCA no tiene dónde subirlo y siempre sale el de Vialto. Está previsto incorporar una funcionalidad **global** para subir el logo de la empresa, que no dependa de la configuración de ARCA (ej. un campo en `Tenant`, editable desde la configuración general de la empresa). Cuando exista, `logoEmpresa()` debe leer primero ese logo global y usar `ArcaConfig.logoUrl` solo como respaldo (o dejar de usarlo), y lo mismo los PDF de facturas/liquidaciones.
- **Totales del tablero = suma de saldos (oct 2026)**: `tablero().totales.porCobrarPendiente`/`porPagarPendiente` salen de `saldosTotalesLado` (cargos − pagos sin lo anulado, a la fecha, sin el período ni el `take` de las listas), el mismo criterio que `saldoContraparte`. Así "Por cobrar" del dashboard (y del PDF de deudores) es exactamente la suma de los saldos de los clientes: un cobro a cuenta sin imputar resta. Antes sumaba solo lo pendiente de las ventas (sin restar cobros a cuenta) y filtrado por período, y no coincidía. Las listas (vencidos / próximos / sin vencimiento) siguen por período.
- **Imputar con tope, sin rechazar por exceso (oct 2026)**: `crearImputacion` imputa `min(importe pedido, saldo pendiente del comprobante, disponible del cobro/pago)`. Un importe mayor no es error: lo que sobra del cobro queda sin imputar (a cuenta) y lo que falta del comprobante queda pendiente. Solo se rechaza si el comprobante ya no tiene saldo o el cobro/pago ya no tiene disponible. Mismo criterio que ya seguían "registrar cobro imputándolo" (`imputarACargoIds`) y la imputación con dos cobros (`repartirImputacion`). El front (`ImputarPagoModal`) manda el importe ya topeado y el aviso de éxito informa lo imputado de verdad.
- **Importar ventas/compras desde AFIP (`POST movimientos/importar-afip`, `importarAfip`, oct 2026)**: el front lee el Excel "Mis Comprobantes" (Emitidos → ventas, `lado: 'cliente'`; Recibidos → compras, `lado: 'proveedor'`) y manda cada comprobante ya armado (CUIT, número "Factura C 00001-00000094", fecha, moneda, líneas por alícuota). Acá: mismo bloqueo que la carga a mano (`assertCargoManualPermitido`), la contraparte se busca por CUIT (solo dígitos) entre los clientes/proveedores de la empresa, se omite lo ya cargado (mismo número en la misma cuenta, no anulado) y cada fila va por `create` (mismas validaciones). `simular: true` = vista previa sin crear. Una fila que falla no corta las demás; la respuesta trae `{ creados, filas: [{ estado: importar|importado|omitido, motivo }] }`. No crea clientes/proveedores que no existan ni importa notas de crédito (una venta manual no puede ser negativa).
- **Eliminar un movimiento manual imputado (`remove`, oct 2026)**: se permite. En una transacción deshace cada imputación con `deshacerImputacionTx` (el mismo camino que `DELETE imputaciones/:id`: recalcula estados y revierte el `Pago` de Facturación / el pago al transportista del viaje) y después borra el movimiento; el cobro/pago queda sin imputar o la venta/compra pendiente. Facturas, liquidaciones y anulaciones siguen sin poder borrarse a mano (`assertEditableAMano`).
- **Edición de un movimiento manual (`update`, oct 2026)**: comprobante, fechas, medio de cobro e **importe/`lineas`** se editan siempre; moneda, tipo y contraparte solo sin imputaciones (`assertSinImputaciones`). Si cambia el importe y hay imputaciones, `ajustarImputacionesAlImporte` (en la misma transacción) recalcula estados y, si lo imputado supera el importe nuevo, recorta las imputaciones de la más nueva a la más vieja (deshacer + volver a imputar por menos, así se ajustan también el `Pago` de Facturación y el pago al transportista); lo recortado vuelve a quedar disponible. El vencimiento no puede quedar antes de la fecha (`assertVencimientoNoAnterior`, también en `create` y `actualizarComprobante`). Con `lineas` recalcula igual que el alta (`calcularLineas`). Factura/liquidación siguen editándose solo por `PATCH .../comprobante` (número y vencimiento).
- **Número de comprobante obligatorio (oct 2026)**: todo movimiento manual (venta, compra, cobro, pago) exige `numeroComprobante` al crearlo (factura, recibo u orden de pago), y se puede cargar o corregir después con `PATCH movimientos/:id/comprobante` (`comprobanteEditable` incluye cobros/pagos manuales; en un manual no se puede vaciar). Mismo criterio en `FacturacionService.createFactura` para empresas sin ARCA (con ARCA lo asigna AFIP).
- **Comprobante propio del cobro/pago**: La columna Comprobante de la grilla muestra ese número —ya no el de la factura/liquidación que cancela, que queda en el tooltip "Imputado a"— y "Imputar cobro" lo muestra en la lista de cobros a elegir. Los cobros viejos sin número se ven como "—" / "Sin comprobante".
- **Sync con Facturación y Viajes**: imputar un cobro a un cargo con `facturaId` genera el `Pago` en Facturación (`registrarPagoDesdeCuentaCorriente`/`eliminarPagoDesdeCuentaCorriente`, `ImputacionCuentaCorriente.pagoFacturacionId`); imputar un pago a la compra de una liquidación lo refleja en `Viaje.pagosTransportista` (`registrarPagoTransportistaDesdeCuentaCorriente`), y los pagos al transportista cargados desde Viajes recalculan el estado de la liquidación (`sincronizarCargoCcTransportista`).
- **Cobro cargado desde Facturas → cobro en CC (oct 2026)**: `createPago` y "Marcar como cobrada" crean, en la misma transacción que el `Pago`, un "COBRO" manual en CC imputado a la venta de la factura con `pagoFacturacionId` = ese pago (`registrarCobroCcDesdeFactura`, `facturacion/factura-cuenta-corriente.ts`); lo que supere el saldo de la venta queda a cuenta. Si la venta ya está saldada en CC no crea nada (un cobro sin imputación quedaría sin vínculo con el pago): el sobrepago queda solo en Facturas. `removePago` lo deshace (`quitarCobroCcDeFactura`): borra la imputación y también el cobro si queda sin imputaciones y no era mayor que el pago. Antes el `Pago` ponía la venta en `cancelado` sin cobro ni imputación y en CC no se podía imputar ni "Ver imputación" (LSF). Backfill de pagos viejos: `npm run backfill:cobros-cc-facturas[:dry]` (idempotente: saltea pagos ya espejados). `registrarPagoDesdeCuentaCorriente` (el camino inverso) NO crea cobro: el cobro ya existe en CC.
- **Borrar un pago devuelve la factura a pendiente (oct 2026)**: `removePago` y `eliminarPagoDesdeCuentaCorriente` (deshacer imputación / borrar el cobro en CC) llaman a `syncViajesEstadoTrasPago` con `soloPagos: true`: el cobro sale solo de los `Pago` que quedan. Sin eso `computeEstadoFacturaLectura` también la daba por cobrada porque todos sus viajes ya estaban en `cobrado` (`cobradoPorViajes`, pensado para datos históricos sin `Pago`), estado que había escrito ese mismo sync al cobrarla: la factura y su venta en CC quedaban cobradas para siempre. Alta de pagos y lecturas siguen considerando `cobradoPorViajes`.
- **`Cliente.condicionPagoDias`/`Transportista.condicionPagoDias`** (`Int?`) alimentan la `fechaVencimiento` por defecto de los cargos que se autogeneran.
- **Moneda por movimiento** (`moneda`, default `ARS`) — los saldos y el tablero agrupan/suman por moneda, nunca la mezclan.

```prisma
model MovimientoCuentaCorriente {
  id                   String         @id @default(cuid())
  tenantId             String
  clienteId            String?
  proveedorId          String?        // Transportista actuando como proveedor/fletero
  contraparteId        String         // = clienteId ?? proveedorId (ver arriba)
  viajeId              String?
  facturaId            String?
  tipo                 String         // cargo | pago
  origen               String         @default("manual") // manual | viaje | factura
  concepto             String
  importe              Float
  moneda               String         @default("ARS")
  fecha                DateTime
  fechaVencimiento     DateTime?
  numeroComprobante    String?        // comprobante externo (sin módulo Facturación) — no confundir con facturaId
  referencia           String?
  estadoDisponibilidad String         @default("pendiente") // cargos: pendiente|parcial|cancelado|anulado
  estadoImputacion     String         @default("no_imputado") // pagos: no_imputado|imputado_parcial|imputado
  createdAt            DateTime       @default(now())
  createdBy            String?

  imputacionesComoCargo ImputacionCuentaCorriente[] @relation("ImputacionCargo")
  imputacionesComoPago  ImputacionCuentaCorriente[] @relation("ImputacionPago")

  @@unique([tenantId, viajeId, contraparteId])
  @@unique([tenantId, facturaId])
}

/** Aplica un pago/cobro a un cargo puntual (factura/comprobante) — N a N entre pagos y cargos. */
model ImputacionCuentaCorriente {
  id                String                    @id @default(cuid())
  tenantId          String
  pagoId            String
  cargoId           String
  importe           Float
  createdAt         DateTime                  @default(now())
  createdBy         String?
  pagoFacturacionId String?  // espejo del Pago de Facturación cuando el cargo tiene facturaId

  @@unique([pagoId, cargoId])
}
```

**Endpoints** (`cuenta-corriente.controller.ts`): CRUD de movimientos, `POST pagos` (registrar cobro/pago), `GET saldo/cliente/:id` / `GET saldo/proveedor/:id`, `GET tablero` (vencidos / próximos a vencer / sin vencimiento, cada uno `{cobrar, pagar}`, filtrable por período), `POST/DELETE imputaciones`, `GET movimientos/exportar` (movimientos de un período con saldo inicial/final ya calculados — usado tanto por el PDF como por el Excel del frontend), `GET estado-cuenta/pdf` (estado de cuenta de una contraparte por período) y `GET listado-deudores/pdf` (listado agregado de todo lo pendiente de cobro y de pago del tenant) — ambos PDF vía `pdfkit` en `estado-cuenta-pdf.service.ts`, mismo patrón que `liquidaciones-arca/factura-pdf.service.ts`.

**Notificación**: `cuenta-corriente.vencimiento` en el catálogo de `notificaciones/` — avisa por email cuando un cargo vence en los próximos días y sigue con saldo pendiente (evaluator `CuentaCorrienteVencimientoEvaluator`).

---

### `stock` — Gestión de stock

El modelo cambió de forma respecto a versiones anteriores de este documento: ya no hay un producto con "dos contadores configurables" (`cantidad1`/`cantidad2`) fijos. Ahora:

- **`Producto`** es el artículo en sí (nombre, código autogenerado `P-001…`, peso unitario opcional).
- **`Presentacion`** es el catálogo de unidades de medida por tenant (ej. "Pallet", "Bolsa", "Kg").
- **`ProductoPresentacion`** vincula un producto con una o más presentaciones, cada una con su propio `unidadesPorBulto` (ej. "Pallet" = 40 bolsas de este producto). Un mismo producto puede repetir la misma presentación con distinto `unidadesPorBulto` (ej. "Pallet x8" y "Pallet x12" del mismo producto, pedido real de Riedel ago 2026) — cada combinación es un `ProductoPresentacion` (SKU) independiente con su propio stock (`MovimientoStock`/`StockItem` referencian el `id` de `ProductoPresentacion`, no el de `Presentacion`). Lo único que sigue bloqueado es repetir la misma presentación con el mismo `unidadesPorBulto` dos veces en el mismo producto (`@@unique([productoId, presentacionId, unidadesPorBulto])`) — validado en `StockService.createProducto`/`updateProducto` antes de tocar la base, y reflejado también en el frontend (`ProductoModal.tsx`).
- **`StockOperacion`** es el encabezado de una operación (ingreso/egreso/división): cliente, depósito, fecha, fotos, remito (interno y del proveedor), y los datos de entrega (`entregadoPor`, `destinatario`, `destinoFinal`, `numeroDocumentoExterno`) — estos campos que documentos anteriores marcaban como "pendientes" **ya están implementados**, y viven acá, no en `MovimientoStock`.
- **`MovimientoStock`** es el detalle línea a línea dentro de una operación: producto + presentación + `bultos`/`unidades` + `lote` opcional (también ya implementado) + vencimiento opcional.
- **`StockItem`** es el snapshot de disponible, ahora clave por `(productoId, presentacionId, clienteId, depositoId)`.

Los egresos generan un número de remito interno automático (`remitoPrefix-YYYY-NNNNN`), vía `StockEgresoRemitoConfig` + `StockRemitoSecuencia`. (El vínculo opcional `remitoId` hacia el módulo standalone `remitos` existió hasta ago 2026 — se borró junto con ese módulo, ver sección "`remitos` — eliminado" más abajo; no confundir con este remito interno, que sigue igual.)

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

  @@unique([productoId, presentacionId, unidadesPorBulto])
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
  createdBy             String    @default("")
  fecha                 DateTime
  createdAt             DateTime  @default(now())

  @@index([tenantId])
  @@index([tenantId, operacionId])
  @@index([tenantId, productoId])
  @@index([tenantId, presentacionId])
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

#### Registro de errores de la app de choferes (oct 2026)

`CombustibleSyncErrorLog` nació solo para la cola offline (la app reporta vía `POST combustible/chofer/errores-sincronizacion` una carga guardada en el celular que el backend rechazó al sincronizar). Ante reclamos de "la app no funciona" no había rastro de nada más: un rechazo con conexión era solo un toast en el celular. Ahora el backend registra por su cuenta **todo** error de la app, con una columna `origen` (migración `20261005120000_combustible_error_log_origen`):

- `sincronizacion_offline` (default, lo que ya existía, reportado por la app) — **es el único origen que alimenta las Alertas del dashboard** (`buildSyncErrorAlertas`) y el default de `GET combustible/errores-sincronizacion`; el resto es diagnóstico, no alerta para el admin del tenant.
- `carga` | `edicion_carga` | `eliminacion_carga` | `foto` | `consulta` — `ChoferErrorLogInterceptor` (`modules/combustible/`) sobre `ChoferCombustibleController`: cualquier excepción (validación del DTO, regla de negocio, multer, 500) se guarda con `payload = { ...body, http: { metodo, ruta, status, query, archivo? } }` y se re-lanza intacta. Excluye `errores-sincronizacion/*` y el alta con `localId` (reintento offline: ya lo reporta la app).
- `login` — `ChoferAuthService`: PIN incorrecto, chofer sin PIN configurado o desactivado, contra cada chofer con ese DNI (uno por tenant). DNI inexistente → solo log de servidor (no hay tenant al que atribuirlo).
- `sesion` — `ChoferAuthGuard`: token vencido (identidad confiable: se re-verifica la firma con `ignoreExpiration`) o chofer desactivado. Token con firma inválida → solo log de servidor: nunca confiar en el `tenantId` de un token no verificado.

Para el admin, la alerta se explica en palabras simples en el frontend (`vialto-frontend/src/lib/combustibleErrorExplicacion.ts`, `explicarErrorChofer`: título corto + qué pasó + cómo quedó + qué hacer, reconociendo por regex los mensajes de este service y de chofer-auth). **Si se agrega o cambia el texto de un rechazo al chofer (`BadRequestException` en `combustible.service.ts`, mensajes de login), actualizar su regla ahí** — si no, cae a una explicación genérica que muestra el motivo crudo. Por eso `buildSyncErrorAlertas` expone también `origen`, `km`, `precioPorLitro` y `formaPago` del payload.

Helper único: `registrarErrorChofer()` en `core/chofer-auth/chofer-error-log.ts` (función plana con `PrismaService`, sin DI, para poder usarla desde el guard). Best-effort: nunca tira. `sanitizarBody` descarta `pin`/`password`/`token` — **nunca guardar el PIN**. Consultar: `GET combustible/errores-sincronizacion?origen=todos` (o un origen puntual), o SQL directo por `origen`.

#### Asignación de vehículo a chofer, con historial (sep 2026)

Pedido real de un tenant (Bressan/NyM): la app vieja permitía fijar qué vehículo maneja cada chofer; en el rediseño de `vialto-combustible` esto se había perdido — el "default" de patente al cargar combustible dependía únicamente de la última carga real del chofer (`CombustibleService.getUltimaCargaChofer`), sin ningún lugar del panel admin para verlo o cambiarlo, y sin historial de qué vehículo usó cada chofer y cuándo.

```prisma
/** Un chofer tiene a lo sumo una asignación activa (fechaHasta: null) a la vez.
 *  Asignar un vehículo nuevo cierra la anterior en la misma transacción — el
 *  historial es simplemente el conjunto de filas con fechaHasta seteado. */
model AsignacionVehiculo {
  id         String    @id @default(cuid())
  tenantId   String
  choferId   String
  vehiculoId String
  fechaDesde DateTime  @default(now())
  fechaHasta DateTime? // null = asignación activa
  createdAt  DateTime  @default(now())
  createdBy  String

  @@index([tenantId, choferId, fechaHasta])
  @@index([tenantId, vehiculoId])
}
```

- **Regla de negocio** (decidida a propósito, sep 2026): un vehículo puede pasar por muchos choferes en el tiempo, pero un chofer solo puede tener **un** vehículo activo a la vez — no hay soporte para turnos rotativos donde 2+ choferes comparten el mismo camión en simultáneo sin cerrar la asignación anterior. Si eso se necesita a futuro, hay que sacar el `updateMany` de cierre automático de `CombustibleService.asignarVehiculo` y dejarlo opt-in.
- **`CombustibleService.getUltimaCargaChofer`** ahora prioriza la asignación activa del chofer sobre su última carga real — solo cae al comportamiento viejo (última carga) si el chofer no tiene ninguna asignación cargada. Mismo endpoint de siempre (`GET combustible/chofer/ultima-carga`), sin cambios de contrato para la app `vialto-combustible`.
- **Km por vehículo**: no fue necesario ningún modelo nuevo — `Vehiculo.kmActual` ya se sincronizaba con cada carga real (`syncVehiculoKmActual`), y el historial de km por vehículo ya se puede leer filtrando `CargaCombustible` por `vehiculoId`.
- **Endpoints admin**, duplicados en `combustible-tenant.controller.ts` (`/api/combustible/asignaciones...`, org:admin de su propio tenant) y `combustible.controller.ts` (`/api/platform/combustible/asignaciones...`, superadmin cross-tenant — el mismo patrón `requiredTenantId`/`scopedAuth` que el resto de ese controller): `GET asignaciones` (vigente por chofer), `GET asignaciones/historial?choferId=|vehiculoId=`, `POST asignaciones` (asignar/reasignar), `DELETE asignaciones/:choferId` (dejar sin vehículo asignado). **OJO de orden de rutas**: en `combustible.controller.ts`, las rutas estáticas `asignaciones`/`asignaciones/historial` están declaradas *antes* de `@Get(":id")` (`findOne`) — si no, Nest las matchea como si "asignaciones" fuera un `:id` (mismo problema documentado en `combustible.module.ts` sobre el orden de controllers).
- **Frontend**: `CombustibleTenantPage.tsx` (la página real detrás de la ruta `/combustible`, tanto para tenant-admin como embebida en superadmin) ahora tiene dos pestañas — "Cargas" (comportamiento de siempre) y "Asignación de vehículos" (`AsignacionVehiculoSection.tsx`, nueva) — siguiendo el mismo patrón visual de sub-pestañas que ya usa el dashboard de Combustible. Reusa las listas de `choferes`/`vehiculos` que la página ya traía para los filtros, sin fetch duplicado. Igual que el resto de esta página, pega siempre contra `/api/platform/combustible/...` con `?tenantId=` (nunca contra `/api/combustible/...` directo), así que el endpoint tenant-facing existe por paridad de API pero hoy no lo consume ningún frontend.

---

### `mantenimiento` — Flota y mantenimiento (Wichi Toledo)
> ⚠️ Desactualizada: el módulo se reconstruyó (planes, asignaciones, talleres, órdenes de trabajo, vencimientos). Fuente de verdad hasta reescribir esta sección (MANT-05): `docs/mantenimiento-plan.md`.

**Planes apagables por empresa (oct 2026)**: `Tenant.mantenimientoPlanesHabilitados` (default `true`, migración `20261023120000_tenant_mantenimiento_planes_habilitados`, switch en superadmin "Configuración por empresa" → General). Con `false`, `VencimientosService.calcular` devuelve `[]` antes de consultar nada: así quedan en cero el semáforo, `vencimientos/resumen`, el bloque `alertas.mantenimiento` del dashboard y los avisos por mail (todos pasan por `calcular`). Las rutas de planes/asignaciones no se bloquean y los datos no se borran: al volver a prender aparece todo como estaba.
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

### `remitos` — eliminado (ago 2026)

Existió un módulo standalone `remitos` (modelo `Remito` con `firmaUrl` para firma digital del cliente, CRUD completo en el backend). Se borró por completo — módulo, controller/service/DTOs, modelo Prisma y las columnas `remitoId` (FK opcional, `onDelete: SetNull`) que `MovimientoStock`/`StockOperacion` tenían hacia él — porque, pese a estar terminado del lado backend, **nunca tuvo ninguna pantalla de frontend** (cero rutas, cero componentes) y ningún tenant real lo tuvo contratado en producción (solo el tenant interno de testing `CapassoTech`). Migración: `20260828164256_drop_remito_module`, aplicada en la rama `develop` de Neon.

**No confundir con el "remito interno" de Stock**, que sigue intacto y es una feature completamente distinta: `StockOperacion.remitoUrl`/`numeroRemito`/`numeroRemitoProveedor` + `StockEgresoRemitoConfig` + `StockRemitoSecuencia` — el PDF que se genera automáticamente al hacer un egreso de stock. Ese no se tocó.

Si en el futuro Melisa (Desagotes, ver "Clientes actuales y estado" más abajo) confirma como cliente y necesita remitos con firma digital del chofer/cliente vía PWA, hay que reconstruir el módulo desde cero (no queda nada reusable salvo este historial).

---

### Liquidaciones CVLP + Facturas A/B vía AFIP SDK (carpeta `liquidaciones-arca/`)
Implementado, no planeado. La carpeta del módulo, los nombres de archivo y varios comentarios del schema dicen `liquidaciones-arca` — inconsistencia de nombres conocida, no corregida a propósito por decisión del equipo (jul 2026).

**División del módulo en dos slugs independientes (ago 2026).** Hasta ago 2026 un único slug `integracion-arca` gateaba TODO: emisión de Facturas A/B y emisión de Liquidaciones CVLP juntas, sin poder contratar una sin la otra. Se dividió en dos módulos vendibles independientes en `VIALTO_MODULES`:

- **`emision-facturas-arca`** — emisión de Facturas A/B con CAE. Gatea en `liquidaciones.controller.ts`: `facturas/:facturaId/{emitir,anular,pdf,pdf-anulacion}` (y sus espejos en `platform/arca/facturas/...` de `platform.controller.ts`, sin guard propio porque ese controller es solo-superadmin). También: `facturacion.service.ts#tieneArca()`, `mapFacturacionEstado`/`syncFacturacionEstadoViaje(s)` en `viaje-estado-financiero.ts`, `dashboard.service.ts#buildAlertas()`, `factura-por-vencer.evaluator.ts`, y la mitad "facturas" de `importaciones-post-viajes.service.ts` (`preview/confirmarFacturasClientes`).
- **`emision-liquido-producto-arca`** — emisión de Liquidaciones CVLP tipo 60. Gatea: `liquidaciones/:id/{emitir,anular,pdf,pdf-anulacion}` (y sus espejos `platform/arca/liquidaciones/...`). También: `mapLiquidacionEstado`/`syncLiquidacionEstadoViaje(s)`, `dashboard-financiero.service.ts#hasIntegracionArca` (nombre de variable sin actualizar a propósito, es interno), y la mitad "liquidaciones" de `importaciones-post-viajes.service.ts` — que además se corrigió de paso: antes exigía el módulo ARCA estricto sin aceptar `facturacion` como alternativa, ahora acepta `facturacion OR emision-liquido-producto-arca`, igual que ya aceptaba el resto del CRUD de liquidaciones.
- **Compartido (OR de ambos)**: `GET/POST config`, `POST/DELETE config/logo`, `GET logs` — un solo `ArcaConfig` por tenant (CUIT/certificado/ambiente son del emisor, no de un tipo de comprobante puntual) y un solo `ArcaLog`. El CRUD de Liquidaciones (`GET/POST/PATCH/DELETE liquidaciones`, conceptos) sigue con su gate `facturacion OR emision-liquido-producto-arca` de siempre (liquidaciones manuales sin ARCA), solo cambió cuál de los dos slugs ARCA acepta. `upload-comprobante` acepta los tres (`facturacion`, `emision-facturas-arca`, `emision-liquido-producto-arca`).
- **Frontend**: `canAccessIntegracionArca()` → `canAccessEmisionFacturasArca()` / `canAccessEmisionLiquidoProductoArca()` (`lib/tenantModules.ts`). Varios componentes/páginas mezclaban ambos conceptos en una sola variable `hasArca` y hubo que separarla en dos (no fue un rename mecánico) — los más riesgosos fueron `TenantHomePage.tsx` y `ViajesTenantPage.tsx` (esta última tenía una variable llamada `hasLiquidacionesArca` que en realidad controlaba el flujo de **Facturas**, no de Liquidaciones — nombre engañoso ya corregido). `ArcaConfigTenantPage.tsx` ahora oculta la sección "Puntos de venta Factura A/B" si el tenant no tiene `emision-facturas-arca`, oculta "Comisiones e IVA" y el tab "Conceptos de liquidación" si no tiene `emision-liquido-producto-arca`, y acepta un prop `modules?` para el caso `embeddedInSuperadmin` (viene de `SuperadminArcaPage.tsx`, que resuelve `tenants.find(t => t.clerkOrgId === tenantId)?.modules`).
- **Rutas HTTP sin cambios**: el prefijo `@Controller("integracion-arca")` (→ `/api/integracion-arca/...`) y `@Controller("platform/integracion-arca")` **no se tocaron** — son solo paths de URL, independientes del slug de `Tenant.modules`/`@RequireModule`. Ningún fetch del frontend cambió de URL por este split.
- **Migración de datos**: no fue un `prisma migrate` (el slug vive en `Tenant.modules: String[]`, no en el schema) — fue un `UPDATE` directo vía Neon MCP en ambas ramas (`production` y `develop`), aplicado a los únicos tenants que tenían `integracion-arca` (NyM Logística + el tenant interno de testing CapassoTech): se les asignaron ambos slugs nuevos, preservando exactamente la capacidad que ya tenían.

Motor: `liquidaciones.service.ts` (liquidación CVLP tipo 60 a transportistas) + `arca-client.service.ts` (integración AFIP SDK, CAE) + `arca-config.service.ts` + `liquidacion-pdf.service.ts`, con auditoría completa de cada request/response a AFIP en `ArcaLog`.

**Anulación de un CVLP (importante — no obvio):** AFIP **no** permite anular un CVLP (tipo 60) por web service con el código 065 (no existe en wsfev1 → error `11001`) ni con importes en negativo (error `10065`). Se anula emitiendo un comprobante **estándar asociado** (`CbtesAsoc`) al 060/061 original: Nota de Crédito (tipo **3** clase A / **8** clase B) o Nota de Débito (tipo **2** clase A / **7** clase B). La clase A/B sale de la condición IVA del transportista. El usuario elige NC o ND en el **modal de anulación** (no es config global); el backend lo recibe en el body (`AnularLiquidacionDto.tipoAnulacion`) y `getCbteTipoAnulacionCvlp(condicionIva, tipo)` mapea al código. Que NC vs ND sea lo fiscalmente correcto es decisión del contador del cliente (AFIP acepta ambos) — por eso es elegible por operación.

**Anulación con código 60 negativo — descartada por WS (probado exhaustivamente, ago 2026):** ARCA respondió por escrito a NyM (consulta N° 6637235) que el código 60 se anula "con el mismo comprobante pero con los importes con signo negativo". PERO eso no tiene canal técnico: (a) por web service, WSFEv1 rechaza cualquier total negativo con `10065` ("ImpTotal no puede ser menor a cero") y cualquier base de IVA ≤ 0 con `10020` ("BaseImp debe ser mayor a 0") — probado con tipos 60/63/64, Concepto 1 y 2, con y sin `CbtesAsoc`, y con total 0; son validaciones de campo, transversales y iguales en homologación y producción (no probar en producción: no cambia y gasta un comprobante real); (b) en "Comprobantes en Línea" el código 60 ni siquiera se puede emitir. Por eso NyM necesita el sistema, y por eso la NC/ND asociada es la única vía por WS. Follow-up técnico enviado a sri@arca.gob.ar (soporte de negocio de web services) pendiente de respuesta para confirmar si hay un método de WS que no conocemos o si la NC/ND es la vía aceptada. **Respaldo técnico (no definitivo):** el manual oficial de WSFEv1 (COMPG) confirma que todos los campos de importe deben ser ≥ 0 (no hay negativos) y que la anulación/ajuste de un comprobante clase A se hace "mediante una Nota de Crédito" asociada, con importes positivos (validaciones 10234 y 10237) — o sea, respalda la vía NC/ND que implementamos. **Jerarquía a tener en cuenta:** por sobre el manual general pesa la **respuesta oficial escrita de ARCA al CUIT de NyM** (consulta 6637235), que indica código 60 negativo; ante una eventual inspección vale lo respondido al contribuyente. Por eso, hasta que sri@arca.gob.ar aclare el "cómo técnico", la NC/ND se trata como **provisoria** y la decisión final la valida el contador de NyM.

**Gotchas operativos de ARCA (verificados en producción con NyM, jul 2026):**

- **CVLP tipo 61 (clase B) no se emite — solo se emite 060.** `getCbteTipoCvlp()` (`arca.util.ts`) devuelve siempre `60`. **Causa real** (homologación, oct 2026): la regla vieja era `condicionIva === 1 ? 60 : 61`, así que un **monotributista** iba a 061, y AFIP rechaza el 061 a un monotributista con `10243`: monotributo (6, 13, 16) es receptor **clase A** (`FEParamGetCondicionIvaReceptor`), igual que RI. El 061 sí se autoriza por WS para las condiciones clase B (4, 5, 7, 8, 9, 10, 15: exento, consumidor final, no categorizado…). Si se retoma el 061: 61 solo para esas condiciones. La anulación de un CVLP usa la clase del comprobante original (`getCbteTipoAnulacionCvlp(..., cbteTipoOriginal)`: 60 → NC/ND A), no la condición IVA.
- **Transportista monotributista = liquidación manual, sin Líquido Producto (pedido de NyM, oct 2026).** El monotributista le factura él mismo a la empresa, así que no se le emite CVLP: `createLiquidacion` marca `Liquidacion.manual = true` si la empresa tiene `emision-liquido-producto-arca` y `esCondicionIvaMonotributo(condicionIva)` (migración `20261029120000_liquidacion_manual`; un borrador viejo pasa a manual al guardarlo en `updateLiquidacion`). Una liquidación manual se comporta como la de una empresa sin ARCA: queda en `borrador` para siempre, `mapLiquidacionEstado(estado, tieneArca, manual)` la cuenta como `liquidado`, `emitirLiquidacion` la rechaza, lleva la factura del transportista adjunta (`comprobanteUrl` + `numeroComprobanteProveedor`, que es lo que muestra Cuenta corriente) y se deshace eliminándola. En el front, `liquidacionConArca(hasArca, liq)` (`lib/arcaCbteTipo.ts`) decide por liquidación si van las acciones de ARCA o las de "sin ARCA" (grilla, detalle, edición), y el modal "Nueva liquidación" cambia solo al elegir un transportista monotributista (botón "Marcar como liquidada").
- **Factura hecha por fuera del sistema = factura manual (pedido de NyM, oct 2026).** Mismo patrón que la liquidación manual, pero lo elige el usuario: tilde "Factura hecha por fuera del sistema" en "Nueva factura" (o en la edición de un borrador). `Factura.manual` (migración `20261029130000_factura_manual`) solo se activa con `emision-facturas-arca` y no se puede volver atrás; `createFactura`/`updateFactura` le exigen número (lo guarda como en una empresa sin ARCA) y `emitirFacturaArca` la rechaza. Se lee como sin ARCA: `computeEstadoFacturaLectura({ ..., manual })` y `mapFacturacionEstado` (lee `factura.manual`) dan `facturado`/`cobrado` en vez de `borrador`, y Cuenta corriente deja editar su número y adjunto. Todo lector nuevo de estado de factura tiene que seleccionar `manual` y pasarlo. En el front, `facturaConArca(hasArca, f)` (`lib/arcaCbteTipo.ts`) decide por factura (grilla, acciones, detalle); con el tilde, el modal "Nueva factura" pasa al formulario sin ARCA (botón "Marcar como facturada"). Limitación: los viajes en USD siguen fuera de la lista en empresas con ARCA, también para una factura manual.
- **Comprobante manual por separado, para el Libro IVA (oct 2026).** En la factura manual y en la liquidación manual (solo empresas con ARCA) el número no es texto libre: tipo AFIP (A/B/C/M/E/FCE), punto de venta y número son **obligatorios** y van en `Factura.manualCbteTipo/manualPtoVenta/manualCbteNro` y en `Liquidacion.proveedorCbteTipo/proveedorPtoVenta/proveedorCbteNro` + `proveedorCbteFecha` (fecha de la factura del transportista, medianoche UTC). Migración `20261029150000_comprobante_manual_estructurado`. `numero` / `numeroComprobanteProveedor` se arman con ellos ("A 0001-00000123") en `resolverComprobanteManual` (`shared/util/comprobante-manual.util.ts`, espejo del front en `lib/comprobanteManual.ts`; pruebas: `npm run test:comprobante-manual`). Si solo llega el texto (Cuenta corriente, que edita el número sin los campos), se interpreta con `parsearNumeroComprobante` y, si no se reconoce, se rechaza. Empresas sin ARCA siguen con el número libre. Los registros manuales anteriores quedan sin los campos hasta que se editen (el Libro IVA les interpreta el texto). En el front, `ComprobanteManualFields` (`components/shared/`) en Nueva/Editar factura, Nueva/Editar liquidación y `AdjuntarComprobanteModal` (prop `comprobanteManual`).
- **Libro IVA (pedido de la contadora de NyM, oct 2026).** Ventas = facturas (`GET facturacion/libro-iva/ventas[/txt]`, `libro-iva-ventas.ts`), Compras = liquidaciones (`GET integracion-arca/libro-iva/compras[/txt]`, `libro-iva-compras.ts`); query `desde`/`hasta` (máx. 13 meses) y `tenantId` (solo superadmin). Lógica común y formato en `shared/util/libro-iva.util.ts` (pruebas: `npm run test:libro-iva`). Reglas:
  - **Emitido en ARCA**: los montos salen del pedido que AFIP autorizó, leído de `ArcaLog`. Ojo: `exitoso` solo dice que el HTTP salió bien (AFIP puede haber rechazado), así que el log se busca por **CAE de la respuesta** (`logAutorizadoPorCae`). Sin log, se recalcula desde el registro con un aviso. La fecha del CVLP solo vive en el log (la liquidación no la guarda).
  - **Anulaciones**: la NC/ND va como comprobante propio, por su fecha; en el Excel en negativo, en el TXT en positivo con su tipo (regla de ARCA). La anulación manual de un CVLP (pre-impreso) no se incluye: queda un aviso.
  - **Manuales / sin ARCA**: tipo/punto de venta/número de los campos por separado o interpretando el texto; si no se reconoce, sale en el Excel pero queda **fuera del TXT** con el motivo (`incompleto`). Liquidaciones sin fecha de la factura del proveedor, igual.
  - **El libro sigue el ambiente de `ArcaConfig`**: en homologación trae solo los comprobantes de prueba (marcados "Prueba", TXT con `_PRUEBA` en el nombre, aviso en el modal); en producción, solo los reales. Los manuales (sin CAE) entran en los dos. Sin config ARCA cuenta como homologación.
  - **TXT** (diseño de registros RG 4597, verificado contra el PDF oficial): ventas 266/62, compras 325/84 caracteres, ANSI (Latin-1), CRLF. Compras B/C: 0 alícuotas y sin registros. Compras 060: CUIT/denominación del informante (`ArcaConfig`) e IVA de la comisión (`comision × ivaPct`). A validar por la contadora: código de operación cuando todas las alícuotas son 0 (`N`, o `E` si hay exento), ventas B con alícuotas (la especificación general dice 0 para B/C, la de ventas pide informar el IVA contenido).
  - Front: botón "Libro IVA" en Facturas y Liquidaciones → `LibroIvaExportModal` (`components/shared/`), Excel con `lib/libroIva.ts`.
- `cms.sign.invalid` ("firma inválida o algoritmo no soportado") al autenticar = el cert y la clave guardados en `ArcaConfig` **no son pareja** (típico de re-pegar uno solo). La firma la hace afipsdk en la nube; casi nunca es el algoritmo. Solución: re-cargar **ambos** (cert + clave juntos) desde el par correcto (verificar con un test de auth que el par del `.env` funciona).
- El cert/clave se guardan cifrados con `ARCA_ENCRYPTION_KEY` (AES-256-GCM). Debe ser **la misma en todos los entornos que compartan base**; si difiere, falla el descifrado. En producción no puede estar vacía (fail-fast).
- La config **solo re-guarda cert/clave si se envía contenido**; dejar un campo vacío conserva el valor anterior.
- El PEM se normaliza antes de firmar (`normalizePem` en `arca-client.service.ts`): pegar la versión con `\n` literales (como en el `.env`) sin normalizar da `Invalid PEM formatted message`.
- El punto de venta que usa el web service es de tipo **RECE/Web Services** y **no** aparece en "Comprobantes en Línea" (regímenes separados y permanentes). Verificar los habilitados con `FEParamGetTiposCbte` / `getSalesPoints`.
- Al armar payloads, el CVLP va con `Concepto: 1` (Productos); con `Concepto: 2` (Servicios) AFIP exige fechas de servicio (`FchServDesde/Hasta/VtoPago`, error `10049`).
- **AFIP 10061** (`ImpNeto` ≠ suma de `AlicIva.BaseImp`): `buildComprobanteCvlp` toma `ImpNeto` de las bases de `AlicIva`, no de la suma de todas las líneas. Los conceptos a 0% en contra (gastos/seguro) no entran a `AlicIva` (10020: `BaseImp` > 0) ni a `ImpOpEx` (tampoco negativo). Si se metían al neto del pie, AFIP rechazaba aunque el IVA de las gravadas estuviera bien.

**Homologación: CUIT de prueba para todos los tenants, sin certificado propio (jul 2026).** Registrar un certificado autofirmado por tenant en el portal de homologación de AFIP (`wsaahomo.afip.gov.ar`) requiere la clave fiscal real del tenant, que en la práctica casi nunca está disponible durante el onboarding — esto bloqueaba probar la integración antes de que el cliente tuviera todo el trámite fiscal resuelto. Solución adoptada: en homologación, **todos** los tenants (sin excepción) autentican con el CUIT de prueba estándar de AFIP SDK, **sin certificado propio** — el mismo mecanismo que ya usaban los scripts de este repo (`scripts/test-tipo65.js` y similares). Esto vive en `ArcaConfigService.findWithApiKey()` (`arca-config.service.ts`): si `ambiente !== 'produccion'`, sustituye `cuitEmisor` por `CUIT_TEST_HOMOLOGACION` (constante en `arca.util.ts`, valor `'20409378472'`) y fuerza `certPem`/`keyPem` a `null`, sin tocar el resto de la config. En producción se sigue usando el CUIT real del tenant + su certificado (`certPemProduccion`/`keyPemProduccion` en `ArcaConfig` — **un solo par**, ya no hay slot de certificado de homologación; se eliminó por innecesario en la migración `20260731220000_drop_arca_config_cert_homologacion`). Como `findWithApiKey()` es el único punto de entrada usado por los tres flujos de emisión (`emitirLiquidacion`, `anularLiquidacion`, `emitirFacturaArca`), el comportamiento es automático y no requiere lógica condicional en cada uno. Al emitir con éxito se persiste el ambiente usado en `Liquidacion.ambiente` (snapshot, no se re-escribe en la anulación) — es lo que el frontend usa para marcar un comprobante como "de prueba". **Importante para cualquier flujo de emisión nuevo (ej. UI de Facturas A/B):** el punto de venta configurado por el tenant para producción muy probablemente no sea válido para el CUIT de prueba en homologación — el usuario debe poder ingresarlo manualmente al emitir (no asumir el `ptoVentaCvlp`/`ptoVentaFactura` de la config).

**Errores de ARCA — mensaje amigable + detalle técnico:** todo error de emisión/anulación viaja como `{ message, detalle }`: `message` es amigable (para el usuario), `detalle` es la respuesta cruda de AFIP SDK (para "ver error completo"). `ArcaException` deriva `detalle` de su `raw` en el constructor; los `catch` del service lo devuelven en el body del `UnprocessableEntityException` (422). En la liquidación se persisten los dos (`arcaError` = amigable, `arcaErrorDetalle` = crudo), así el modal de vista muestra el detalle incluso tiempo después. En el frontend: componente `ArcaErrorMessage` (mensaje + botón "Ver error completo" + copiar) y helper `getArcaErrorDetalle(err)` (lo saca de `ApiError.body.detalle`), usados en los modales de emisión (`CrearLiquidacionManualModal`, `EmitirCvlpModal`), la grilla y el `LiquidacionViewModal`. Para sumar el patrón a un flujo nuevo, reusar esos dos en vez de mostrar el error pelado.

**UI de "esto es de prueba" — reusar, no reinventar (jul-ago 2026):** para cualquier pantalla nueva que muestre o emita un comprobante ARCA, reusar los dos componentes ya construidos en `vialto-frontend/src/components/liquidaciones/`:

- `AmbienteTestBadge` — badge ámbar "Ambiente de pruebas" que se renderiza solo si `ambiente === 'homologacion'`. Dos familias de uso, no confundir:
  - **Snapshot por comprobante** (informativo, nunca clickeable): `Liquidacion.ambiente` (grilla y título de `LiquidacionViewModal`) y `Factura.ambiente` (grilla, `FacturaViewModal`, `FacturaEditModal` — campo agregado en ago 2026, migración `20260808120000_add_factura_ambiente`, seteado en `emitirFacturaArca` igual que ya hacía `emitirLiquidacion`).
  - **Config actual del tenant** (accionable): `ArcaConfig.ambiente`, en los banners de página tipo "Emisión electrónica vía ARCA" (`FacturacionTenantPage.tsx`, `LiquidacionesTenantPage.tsx`) y en los modales de emisión. Estas instancias pasan `to="/configuracion/arca?tab=ambiente"` al badge — el componente acepta un `to?: string` opcional que lo vuelve un `<Link>` clickeable; sin `to` sigue siendo un `<span>` estático. Solo wirear `to` en vistas de tenant (no en las variantes `embeddedInSuperadmin`, que no tienen una ruta de config alcanzable para un tenant elegido). `ArcaConfigTenantPage.tsx` lee `?tab=` de la URL para abrir directo en la pestaña pedida (`general | ambiente | conceptos`).
- `AmbienteHomologacionWarning` — banner ámbar de advertencia ("el comprobante no va a tener validez fiscal") que se muestra antes de confirmar la emisión cuando `config.ambiente === 'homologacion'`; ubicado al final del cuerpo del modal, justo antes de los botones de acción. Usado en `EmitirCvlpModal`, `CrearLiquidacionManualModal` y `EmitirFacturaModal`.

**Pantalla de configuración ARCA — un solo componente para tenant-admin y superadmin (ago 2026).** Hasta ago 2026, `SuperadminArcaPage.tsx` tenía su propio `ConfigTab` interno, copiado y pegado de `ArcaConfigTenantPage.tsx` — desactualizado respecto al de tenant (sin logo de empresa, sin pestaña de Conceptos de liquidación, un solo formulario en vez de pestañas + tarjetas por sección). Se unificó siguiendo el mismo patrón que Facturación/Viajes/Notificaciones: `ArcaConfigTenantPage` ahora acepta `tenantId?`/`embeddedInSuperadmin?` como prop (arma sus URLs de config/logo con `?tenantId=` hacia `/api/platform/arca/...` cuando viene seteado; sin prop, sigue pegando contra `/api/integracion-arca/...` como siempre) y `SuperadminArcaPage.tsx` monta `<ArcaConfigTenantPage tenantId={tenantId} embeddedInSuperadmin />` en su pestaña "Configuración" en vez del `ConfigTab` duplicado (que se eliminó, ~550 líneas). `ConceptosLiquidacionConfigSection.tsx` sigue el mismo criterio con un prop `tenantId?` propio.

Para que esto funcionara hubo que sumar rutas nuevas en `PlatformController`/`PlatformService` (`core/platform/`) que antes solo existían para el tenant logueado (`LiquidacionesController` en `integracion-arca`, sin override de `tenantId` — a diferencia de `getArcaConfig`/`upsertArcaConfig`, que ya vivían en platform desde antes):

- `POST/DELETE /platform/arca/config/logo?tenantId=` → delega directo a `ArcaConfigService.uploadLogo`/`removeLogo` (mismo service que ya usaba `PlatformService` para `getArcaConfig`/`upsertArcaConfig`, sin pasar por `LiquidacionesService`).
- `GET/POST /platform/arca/conceptos-liquidacion` + `PATCH /platform/arca/conceptos-liquidacion/:id` (todos con `?tenantId=`) → delegan a `ConceptosLiquidacionService` (ya exportado por `IntegracionArcaModule`, que `PlatformModule` ya importaba — solo hizo falta inyectarlo en `PlatformService`).

Ninguna de estas rutas nuevas usa `resolveTenantId` (ese helper es para controllers de usuario normal que necesitan el override *condicionado* a `auth.role === 'superadmin'`) — viven en `PlatformController`, que ya es exclusivamente de superadmin, así que el `tenantId` de query se usa directo vía `PlatformService.requiredTenantId()`, igual que el resto de los métodos de ese service.

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
Tampoco es un módulo vendible por tenant. Motor de importación con parser + validator + un `processor` por módulo destino (`clientes`, `transportistas`, `choferes`, `vehiculos`, `viajes`), flujo de **preview/confirm en dos fases** con sesión de staging temporal, y templates de columnas configurables por tenant/módulo. Compartido entre tenant-admin y superadmin — el wizard del frontend (`vialto-frontend/CLAUDE.md`, sección "Importación masiva") es el mismo componente para ambos roles; el backend no tiene lógica distinta por rol salvo `resolveTenantId` (superadmin puede operar sobre cualquier tenant vía `?tenantId=`).

```prisma
model ImportTemplate {
  id        String   @id @default(cuid())
  tenantId  String
  modulo    String   // viajes | clientes | choferes | vehiculos | stock | etc.
  nombre    String
  config    Json     // sheet, headerRow, columns[] — ver ColumnConfig abajo
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
  detalles      Json     // ImportLogDetalle[]: {fila, estado, id?, creado?, facturado?, mensaje?} — ver InsertResult abajo
  createdAt     DateTime @default(now())
  createdBy     String

  @@index([tenantId, modulo])
}
```

> **`TenantFieldConfig` / `TenantFieldConfigAuditLog`** — implementados por completo (dejaron de ser "fuera de alcance"), no tienen relación con el motor de importaciones de esta sección. Documentados en su propia sección más abajo, "`core/tenant-field-config` — visibilidad de campos y features opt-in por tenant".

#### Arquitectura del motor (`src/modules/importaciones/`)

- **`ParserService`** — lee el Excel (`sheet`/`headerRow` del template) y devuelve `ParsedRow[]`. `sampleWorkbook(buffer, maxRows=10)` expone una muestra cruda por hoja, usada solo por la sugerencia IA (no por el flujo de import normal).
- **`ValidatorService`** — coerción de tipos, resolución de `lookup` (con `lookupFields` probando varios campos en orden, ej. `['nombre', 'idFiscal']`, y `multiple: true` para celdas con varios valores separados por `/`, ej. patente de tractor+semirremolque), y el mecanismo `warnIfEmpty` (ver abajo). Devuelve `ValidatedRow[]` + `RowError[]` + `advertencias: {fila, campos}[]`.
- **`IImportProcessor`** (`processors/import-processor.interface.ts`) — un `insert()` por módulo, invocado fila a fila desde `confirm()`:

  ```typescript
  export interface InsertResult {
    id: string;
    /** true = alta nueva, false = actualizó un registro ya existente. */
    creado: boolean;
    /** Solo Viajes: true = esta fila quedó con una factura individual adjunta. */
    facturado?: boolean;
  }
  export interface IImportProcessor {
    insert(row: ValidatedRow, tenantId: string, createdBy: string): Promise<InsertResult>;
    /** Opcional: cuenta cuántas de las filas ya existen en base (altas vs. actualizaciones), para el desglose del preview. */
    contarExistentes?(rows: ValidatedRow[], tenantId: string): Promise<number>;
  }
  ```

  Los 5 processors (`clientes`, `transportistas`, `choferes`, `vehiculos`, `viajes`) implementan ambos métodos — si se agrega un módulo nuevo, replicar el patrón (`insert()` nunca devuelve solo un `string`, siempre `InsertResult`, para que el resumen final tenga el desglose exacto de creados/actualizados). El interface real tiene además `filasNuevas?()` (usado por el preview de los módulos "simples" para marcar Nuevo/Actualiza fila por fila) y `detectarCampoUnicoDuplicado?()` (Clientes/Transportistas/Choferes — ver subsección propia más abajo); se omiten del snippet de arriba por brevedad, la fuente de verdad es `import-processor.interface.ts`.
- **Catálogo de templates dinámico** (`template-catalogo.ts` + `prisma-import-fields.ts`): la planilla de `GET /importaciones/templates/catalogo` ya no es una lista hardcodeada. La base sale del DMMF de Prisma (scalars del modelo, menos internos tipo `id`/`tenantId`/`createdAt` y un denylist chico por modelo). Encima hay overlays por módulo para lookups, labels, `warnIfEmpty` y columnas planas que no son un campo Prisma (`tipoFlota`, `productoId`/`cantidadProducto`, fechas de factura). **Si mañana se agrega un scalar a Cliente/Chofer/Vehículo/Viaje, aparece solo en la planilla.** Los processors de entidades simples copian esos scalars con `scalarDataFromRow` (no hace falta tocar el processor para un string/número/fecha nuevo); Viajes mergea extras igual, y reserva lógica propia para flota/producto/factura. Columnas que Prisma no puede inferir (lookups, enums de import) siguen yendo al overlay `extras` de ese módulo — no reinventar un catálogo paralelo.
- **Columnas que no aplican a la empresa** (oct 2026): `ImportacionesService.columnaImportOculta()` es el único filtro, usado por el catálogo de templates (`GET templates/catalogo`) y por la planilla descargable (`GET columnas-esperadas`, "Descargar planilla" del wizard). Oculta: campos ocultos en "Campos por empresa" (visibilidad compartida alta/edición/detalle de los 5 módulos, choferes incluido); ID Propio 1/2 sin habilitar; con `tipoFlota = 'propia'`, transportista y pago al transportista (Viajes) y "Transporte" (Choferes/Vehículos); "Tipo de flota" si no es `mixta`. Si el nombre de la columna no coincide con el campo del formulario (ej. `vehiculoId` ↔ `vehiculosRows`, `condicionIva` ↔ `condicionIvaTributaria`), el mapeo va en `visibilidadDesde` del módulo en `template-catalogo.ts`. En la planilla, una columna marcada obligatoria en la plantilla guardada no se oculta nunca, y si la empresa ocultó "Vehículos" en Viajes (`vehiculosRows`) la hoja Vehículos no se incluye. **País fijo** (`paisOrigenDestinoOculto` + país con código de 2 letras): la columna "País" de Clientes/Transportistas no se ofrece, y `getActiveTemplate` (paso 5) le pone `ColumnConfig.valorFijo` = código del país — el validador usa siempre ese valor, venga o no la columna en el Excel (igual que el alta manual, que oculta el selector y fija el país). Esto solo afecta qué se ofrece: el preview/confirm siguen aceptando cualquier columna de la plantilla, **salvo** las de comprobantes (`CAMPOS_COMPROBANTE_NO_IMPORTABLES`: n° y fechas de factura al cliente y de factura del transportista), que por ahora tampoco se importan — `getActiveTemplate` las saca en memoria aunque el template guardado las tenga. Para reactivarlas, vaciar ese Set.
- **Lookups normalizados y productos automáticos** (oct 2026): `ValidatorService.claveLookup()` compara sin acentos, sin mayúsculas y con espacios colapsados ("Maíz" = "MAIZ" = "maiz") — para todos los lookups (clientes, transportistas, choferes, productos). En Viajes, `getActiveTemplate` (paso 6) fuerza `createIfNotFound` en la columna Producto si la empresa no tiene Stock: un producto que no existe se crea solo con el nombre del Excel (primera grafía vista) en vez de ser un error de fila. En el confirm, cada placeholder `__pending__` se crea una sola vez y se reusa en todas las filas que lo referencian (antes se intentaba crear una vez por fila).
- **Flujo de dos fases**: `POST /importaciones/preview` (sube el Excel, valida, arma `PreviewResult`, no escribe nada de negocio — solo la `ImportSession` de staging) → `POST /importaciones/confirm` (recibe `sessionId` + confirmaciones pendientes, corre `processor.insert()` fila por fila, arma `ImportLog`). El frontend llama a estos dos endpoints **una vez por módulo**, en orden de dependencia (`clientes → transportistas → choferes → vehiculos → viajes`) — no hay una sesión "encadenada" en el backend, cada módulo es una `ImportSession` independiente.

#### `warnIfEmpty` — campos recomendados pero no bloqueantes

`ColumnConfig.warnIfEmpty` (hoy: `idFiscal`/`pais` en `clientes` y `transportistas`, ver `template-catalogo.ts`) marca un campo como "recomendado, no obligatorio": si la celda viene vacía, la fila se importa igual, pero se junta en `PreviewResult.advertenciasCamposFaltantes` y `confirm()` la rechaza salvo que el usuario confirme explícitamente (`ConfirmImportDto.confirmarCamposFaltantes`) — el frontend re-valida esto también server-side, no confía solo en el checkbox de UI. **El mismo criterio de "CUIT/país opcional con confirmación" aplica a la carga manual** (no solo import): `CreateClienteDto`/`UpdateClienteDto` y sus equivalentes de Transportista tienen `idFiscal`/`pais` como `@IsOptional()` + un flag `confirmarSinDatosFiscales?: boolean` que `ClientesService`/`TransportistasService` exigen en `assertXRequiredFields` cuando falta el dato fiscal — mismo patrón de "advertencia + checkbox de confirmación" en ambos lugares, no lo dupliques con una regla nueva si se agrega otro campo opcional-mostrado-como-advertencia.

#### Conflicto de campo único (ID Fiscal / DNI) — ignorar o actualizar en vez de rechazar (sep 2026)

Antes, si una fila del Excel traía un `idFiscal`/`dni` que ya pertenecía a OTRO registro existente (nombre distinto), el import la rechazaba con un `BadRequestException` genérico y el usuario tenía que corregir el Excel a mano y volver a subirlo entero. Ahora el preview detecta el conflicto y `confirm()` exige una decisión explícita por fila:

- **`IImportProcessor.detectarCampoUnicoDuplicado?(rows, tenantId): Promise<CampoUnicoConflicto[]>`** — opcional, implementado por `ClientesProcessor`/`TransportistasProcessor` (campo `idFiscal`) y `ChoferesProcessor` (campo `dni`). Compara cada fila con el campo no vacío contra los registros existentes del tenant; si el `nombre` de la fila coincide con el del registro encontrado, es el mismo registro actualizándose (no un conflicto) — solo cuenta cuando el nombre es distinto. Devuelve `CampoUnicoConflicto[]` (`{ fila, campoLabel, valor, entidadExistenteId, entidadExistenteNombre }`, `types/import.types.ts`).
- **Preview** (`ImportacionesService.preview()`): si el processor lo implementa, corre sobre `valid` y expone `PreviewResult.advertenciasCampoUnicoDuplicado`.
- **Confirm** (`ImportacionesService.confirm()`): recalcula los conflictos en vivo (no reusa el preview, la base pudo cambiar) contra las filas todavía no excluidas. Si hay conflictos sin decisión en `ConfirmImportDto.decisionesCampoUnicoDuplicado` (`{fila, accion: 'ignorar'|'actualizar'}[]`), rechaza con `BadRequestException` pidiendo resolverlos primero. `accion: 'ignorar'` suma la fila al mismo `Set` de exclusión que ya usa `filasExcluidas` (un solo lugar arma `detallesOmitidas` para ambos orígenes); `accion: 'actualizar'` guarda el id del registro existente en `fila._duplicadoEntidadId` (campo interno de `ValidatedRow`, mismo prefijo `_` que `_rowNum`).
- **Processor** (`insert()`): si `row._duplicadoEntidadId` viene seteado, pisa directo ese registro (incluido el `nombre` — a diferencia del upsert normal por nombre, que lo deja fijo) sin volver a buscar por nombre ni por campo único. Si no viene seteado, sigue el flujo normal (upsert por nombre) con un `findFirst` de red de seguridad final que sigue tirando `BadRequestException` si se cuela un duplicado no resuelto (ej. dos filas del mismo Excel con el mismo CUIT/DNI nuevo, ninguna existente todavía al armar el preview).

Mecanismo genérico a propósito — no hay ningún `if (modulo === 'clientes')` en `ImportacionesService`. Si se agrega otra entidad con un campo único por tenant, alcanza con implementar `detectarCampoUnicoDuplicado` en su processor.

#### País: normalización a código de 2 letras durante el import (sep 2026)

`Cliente.pais`/`Transportista.pais` son `String?` a nivel Prisma (por eso el catálogo los infiere como columna `type: 'string'`), pero el resto del sistema los trata como código de 2 letras (`AR|UY|PY|CL|BR` — el alta manual usa `PaisUbicacionSelect`, que solo permite elegir uno de esos códigos). Sin esta normalización, un Excel con "Argentina" en la columna País se guardaba tal cual — un cliente/transportista quedaba con un valor de país distinto según si se cargó a mano o se importó (bug real reportado: la grilla mostraba "Argentina" para unos registros y "AR" para otros), y de paso `validarIdFiscal` (que switchea por código exacto) no corría ningún chequeo de formato para esas filas. `ValidatorService.coerce()` normaliza por **nombre de campo** (`col.field === 'pais'`, no por `col.type` — así corrige también templates viejos ya guardados con `type: 'string'`, sin necesitar backfillear `ImportTemplate`): matchea contra el código directo o contra un alias reconocido (`ARGENTINA`, `ARG`, `URUGUAY`, `URY`, etc. — `ValidatorService.PAIS_ALIASES`); si no reconoce el texto, se comporta como un campo opcional inválido (no bloquea la fila, queda vacío y se avisa, mismo criterio que un valor numérico inválido en un campo opcional). Se corrigieron también en Neon (develop y producción) los `Cliente`/`Transportista` ya importados con `pais = 'Argentina'` → `'AR'`.

#### Sugerencia de template con IA — dos proveedores (`ia-template-suggestion.service.ts`)

Gemini como proveedor primario, **Groq como fallback automático** si Gemini falla (ambos con retry+backoff, `fetchConReintentos`). Desde oct 2026 las llamadas viven en `shared/ia/ia-json.service.ts` (`IaJsonService`, global en `VialtoSharedModule`) para que también las use el core (plural del label de Producto, ver "Label de Producto por tenant"); cualquier uso nuevo de IA va por ese servicio, no con un `fetch` propio. Devuelve `{proveedor, modelo, sheet, headerRow, columnas, headersNoUsados}` — además del mapeo de columnas, detecta la hoja y la fila de encabezados a partir de `ParserService.sampleWorkbook()`. Requiere `GROQ_API_KEY` en `.env` (agregar a la lista de variables de entorno del proyecto si se documenta ahí formalmente). **Modelo Groq**: `openai/gpt-oss-120b` — `llama-3.3-70b-versatile` quedó deprecado por Groq el 16/08/26; si Groq vuelve a devolver 404 en el futuro, es señal de otro modelo deprecado, no un bug del código (verificar contra la doc de deprecaciones de Groq antes de tocar el service).

#### Viajes — lo más particular del motor

- **Matching de fila existente** (`ViajesProcessor.resolverFilasExistentes`, devuelve `Map<fila, viajeId>`): primero por `numeroIdentificacionPersonalizado` (único por tenant a nivel DB, `@@unique([tenantId, numeroIdentificacionPersonalizado])`); si no hay match, fallback a clave compuesta `(clienteId, transportistaId, origen, destino, fechaCarga, fechaDescarga)` (origen/destino comparados case-insensitive). **No hay constraint de DB que garantice unicidad de esta clave compuesta** — es solo el criterio que usa el import para decidir alta vs. actualización; si dos filas de Excel distintas coinciden en los 6 campos, la segunda actualiza a la primera en vez de crear un viaje nuevo (comportamiento esperado, no un bug).
- **Normalización de ciudades**: si la empresa tiene `Tenant.recomendacionCiudadesHabilitada = false` (oct 2026, migración `20261008120000_tenant_recomendacion_ciudades`), el wizard ni siquiera valida y las ciudades se guardan tal cual vienen. Con el default (`true`): el motor NO valida `origen`/`destino` contra un catálogo en el backend — la resolución de ciudad ambigua ocurre 100% en el frontend (`vialto-frontend/src/lib/importacionViajesCiudades.ts`) contra un catálogo externo, antes de llamar a `confirm()`. El backend solo recibe `ConfirmImportDto.ciudadesNormalizadas` (overrides de texto por fila) y `filasExcluidas` (filas que el usuario decidió no importar, ej. destino multidestino tipo "PARANA+RAFAELA+CORDOBA" que nunca va a resolver a una sola ciudad).
- **Reutilización de Factura en vez de duplicarla** (`ViajesProcessor.create()`): si varias filas nuevas del mismo import comparten `nroFactura` para el mismo cliente, o si ya existe una `Factura` con ese `(tenantId, tipo:'cliente', numero, clienteId)`, el import **no crea una Factura nueva por cada viaje** — reutiliza la existente y suma el `importe`. Esto solo corre si el usuario confirmó explícitamente (`detectarFacturasDuplicadas()` + `ConfirmImportDto.confirmarFacturasDuplicadas`) — sin confirmación, `confirm()` rechaza con `BadRequestException`. Bug real corregido ago 2026: antes se creaba una `Factura` nueva por cada fila con `nroFactura`, aunque varias compartieran número.
- **Guard de protección fiscal** (`ViajesProcessor.update()`, preexistente, **no es un bug**): si el viaje ya tiene `facturacionEstado`/`liquidacionEstado` que indica que ya fue facturado/liquidado, `update()` tira error en vez de pisar los datos en un reimport — protege comprobantes fiscales ya emitidos de sobrescritura silenciosa. Si un reimport masivo reporta "N con error" contra viajes de test previos, verificar primero `SELECT "facturacionEstado", count(*) FROM viajes WHERE "tenantId" = '...' GROUP BY 1` antes de asumir una regresión.
- **Patente compuesta en Vehículos** (`VehiculosProcessor`): una celda tipo `"AC359ES/LHT523"` (tractor + semirremolque) se separa por `/` y crea/actualiza **dos** `Vehiculo` distintos (posición 0 = tractor, posición 1 = semirremolque) — antes se guardaba como un único vehículo inválido con la patente compuesta literal. Mismo criterio de split que ya usa el lookup `vehiculoId` de Viajes (`multiple: true, separador: "/"`).
- **Diff "antes/después" para el preview** (`ViajesProcessor.obtenerEstadoActual()` + `ImportacionesService.compararCamposViaje()`): para cada fila que va a actualizar un viaje existente, el preview trae el estado actual de BD (con nombres de cliente/transportista/chofer/patente ya resueltos) y arma `PreviewViaje.cambios: PreviewCambioCampo[]` (`{campo, antes, despues}`), solo con los campos que realmente cambian. `PreviewViaje.nuevo` distingue alta vs. actualización. El frontend lo consume en el modal "Ver cambios" — ver `vialto-frontend/CLAUDE.md`.
- **Desglose nuevas vs. actualizadas** (`PreviewResult.entidadesNuevas`/`entidadesActualizadas`, vía `IImportProcessor.contarExistentes()`): antes el preview siempre decía "N a crear" aunque la mayoría de las filas fueran a actualizar un registro ya existente (el processor hace upsert por nombre/patente/clave compuesta) — ahora se distingue.

#### `POST /importaciones/detectar-hojas` — primer paso del wizard (oct 2026)

El wizard ya no pide elegir módulos con checks. Arranca subiendo el Excel, y `ImportacionesService.detectarHojas(tenantId, buffer)` devuelve qué módulos trae y en qué hoja:

```ts
{
  hojas: { modulo, hoja, filas, faltantes, detectadaPor: 'nombre' | 'encabezados' }[]; // en orden de importación
  sinIdentificar: { hoja, filas, candidatos }[];
}
```

1. **Por nombre**, en dos pasadas para no asignar mal una hoja tipo "Viajes clientes":
   - primero, coincidencia exacta con la hoja de la plantilla del tenant (o la default de `SHEET_LABEL_DEFAULT`, ej. "Transportes");
   - después, una hoja cuyo nombre contenga el módulo o su label.
   Si la hoja no tiene las columnas obligatorias, vuelve igual con `faltantes` y el wizard la informa sin importarla.
2. **Por encabezados**, para las hojas que quedaron sin asignar (ej. "Hoja1"). Se asigna al módulo que tiene todas sus columnas obligatorias y más columnas coincidentes. Si hay empate (una hoja con solo "Nombre" encaja en Clientes, Transportes y Choferes), vuelve en `sinIdentificar` con sus `candidatos` y elige el usuario. Con `candidatos: []` no se parece a ningún módulo.
3. Las hojas sin filas de datos se ignoran.

El criterio de encabezados es el mismo que `ParserService.parse` (sin distinguir mayúsculas, con los encabezados y alias de la **plantilla**), para que lo que se detecta como válido no falle después en el preview.

**`hoja` en el preview**: `POST /importaciones/preview?modulo=&hoja=` lee la hoja indicada en vez de la de la plantilla (`PreviewImportDto.hoja`). El wizard manda la hoja detectada, así una hoja reconocida por encabezados se puede leer aunque se llame distinto.

Pruebas: `npm run test:importaciones-detectar` (`detectar-hojas.spec.ts`, plantillas por defecto del catálogo, sin DB).

`GET /importaciones/tenant-tiene-datos` y `POST /importaciones/pre-flight` ya no los usa el wizard (los reemplaza la detección). Siguen en el código; se pueden borrar si nadie más los consume.

---

### `notificaciones` — alertas por email vía Resend (ago 2026)

Tampoco es un módulo vendible (no gateado por `RequireModule`) — corre para cualquier tenant que tenga contratado el módulo del que depende cada tipo de aviso. Un cron diario (`NotificacionesCronService`, `@Cron('0 8 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })`) recorre todos los tenants, evalúa el catálogo de tipos de notificación aplicables y manda **un email agrupado por tipo** (no uno por entidad) a los miembros `org:admin` del tenant en Clerk.

```prisma
/** Override por tenant de si un tipo de notificación está activo. Sin fila = usa el default del catálogo. */
model NotificacionConfig {
  tenantId  String
  tipo      String
  activo    Boolean
  updatedBy String
  updatedAt DateTime @updatedAt

  @@unique([tenantId, tipo])
}

/** Dedup: qué entidad ya generó un email para un tipo de notificación, para no reenviar en cada corrida del cron. */
model NotificacionEnvio {
  tenantId      String
  tipo          String
  entidadId     String
  destinatarios String[]
  enviadoAt     DateTime @default(now())

  @@unique([tenantId, tipo, entidadId])
}
```

- **Catálogo en código** (`notificaciones-catalog.ts`, `NOTIFICACIONES_CATALOG`): cada entrada declara `tipo` (slug estable, persistido — no renombrar sin migrar datos), `modulo` (agrupa la pantalla de config), `defaultActivo` y `requiereModulo` (si el tenant no tiene ese módulo en `Tenant.modules`, la notificación ni se evalúa ni se muestra en la config — mismo criterio de "catálogo filtrado por módulos contratados" que ya usa `tenant-field-config`). Arranca con dos tipos: `facturacion.facturaPorVencer` (factura de cliente que vence en los próximos 3 días y sigue con saldo, sin cobrar ni anular — `FacturaPorVencerEvaluator`, reusa `computeEstadoFacturaLectura`/`importeOperativoFactura` de `factura-estado-lectura.ts`) y `combustible.cargaSospechosa` (`CargaSospechosaEvaluator`, reusa el flag `CargaCombustible.sospechoso` que ya calcula `combustible.service.ts` — no vuelve a correr la heurística de detección, solo lee el resultado).
- **Campana = único contador de avisos del sistema (oct 2026).** Antes había 3 badges con números distintos (campana, botón "Alertas" del panel principal, pestañas "Alertas" de combustible y financiero) que contaban cosas distintas. Ahora solo la campana (`NotificationBell`) muestra número y se pone en cero al abrirla; los paneles de Alertas quedan sin contador, como listas de lo que sigue abierto. Para que nada quede sin aviso se sumaron dos tipos: `facturacion.facturaVencida` (diaria, `FacturaVencidaEvaluator`, ventana de 30 días hacia atrás para no mandar el histórico en la primera corrida; comparte `evaluarFacturasConSaldo` con "por vencer") y `combustible.errorChofer` (frecuencia nueva **`inmediata`**: sin evaluator ni cron, la dispara `CombustibleService.logSyncError` vía `NotificacionesCronService.notificarAhora`, dedup por `payload.localId` para que los reintentos de la misma carga no avisen de nuevo). Si se agrega un panel de alertas nuevo, no ponerle badge propio: si necesita avisar, sumar un tipo al catálogo. El botón del panel principal se llama **"Resumen de alertas"** (`TenantOwnerDashboard`, datos de `DashboardService` → `alertas`) y tiene que resumir todo lo que listan las pestañas "Alertas" de cada módulo (hoy: facturas vencidas, viajes sin factura, cargas sospechosas, cargas de choferes sin registrar —`erroresChofer`—, margen bajo y mantenimiento —planes vencidos + próximos, los "sin datos" no cuentan—); si una pestaña suma un tipo de alerta, sumar su bloque al resumen con el mismo filtro (helper `sumarBloqueAlerta`), o el resumen y el detalle vuelven a no coincidir. Si el bloque necesita la lógica de un módulo vendible, no se calcula dentro de `DashboardService`: el módulo registra un proveedor en `DashboardAlertasRegistry` (clave tipada en `ClaveBloqueAlerta` + campo en `OwnerDashboardResponse['alertas']`, `requiereModulo`, `obtener(tenantId)`), que el dashboard corre solo para tenants con ese módulo y omite si falla.
- **Un evaluator por tipo** (`evaluators/`, interfaz `NotificacionEvaluator.evaluar(tenantId): Promise<NotificacionItem[]>`) — solo lee, nunca escribe ni decide envío/dedup; eso lo hace `NotificacionesCronService`. Para sumar un tipo nuevo: agregar la entrada al catálogo + un evaluator que implemente la interfaz, y registrarlo de una de dos formas: (a) si solo lee tablas con Prisma o utils de `shared/`, en el array `evaluators` del constructor de `NotificacionesCronService` (los 4 originales); (b) si necesita la lógica de un módulo vendible, el evaluator vive en ese módulo y se registra con `NotificacionesCronService.registrarEvaluator(this)` en `onModuleInit` (el módulo importa `NotificacionesModule`). `registrarEvaluator` tira al arrancar si el `tipo` no está en el catálogo o está repetido. Ejemplo de (b): `mantenimiento.vencimientoProximo` / `mantenimiento.vencido` (`modules/mantenimiento/notificaciones/vencimientos.evaluators.ts`, `entidadId = vehiculoPlanId:idReferencia`).
- **Cron semanal genérico (oct 2026)**: `NotificacionesCronService.cronSemanal` (lunes 8:00 AR) procesa los tipos `frecuencia: 'semanal'` del catálogo **sin** `cronPropio`. Los que tienen `cronPropio: true` los dispara el cron de su módulo, acotando con el 4º parámetro de `procesarTenant` (`tipos`) — hoy solo `combustible.cargaSospechosa`, desde `CombustibleCorreccionCronService.cronSemanal` (domingo 4:00, junto con la corrección). Primer tipo del cron genérico: `liquidaciones.pendienteAnulacion` (`LiquidacionPendienteAnulacionEvaluator`, requiere `emision-liquido-producto-arca`): liquidaciones en `pendiente_anulacion` (anulación manual). Es un **recordatorio**: su `entidadId` es `liquidacionId:semanaISO`, así que se repite cada lunes mientras siga pendiente (el dedup solo evita duplicar dentro de la misma semana). Pruebas: `npm run test:notif-liq-pendiente-anulacion`.
- **Dedup por entidad, no por corrida**: antes de enviar, el cron filtra los candidatos de `evaluar()` contra `NotificacionEnvio` (`tenantId + tipo + entidadId`) — una factura que sigue "por vencer" tres corridas seguidas del cron solo genera un email la primera vez. El email agrupa todos los ítems nuevos de un mismo tipo en un solo mensaje (no uno por entidad).
- **Destinatarios = admins de Clerk, no una lista propia**: `resolverDestinatarios()` llama `UsersService.listByTenant(tenantId)` (por eso `UsersModule` ahora exporta `UsersService` — antes solo lo usaba su propio controller) y filtra por `role === 'org:admin'` con email. Sin admins con email, el tipo se skipea con un log — no hay tabla de destinatarios propia del módulo.
- **`ResendEmailService`** (`shared/email/`) nunca rompe el flujo que lo llama: sin `RESEND_API_KEY` configurada, loguea y no envía (útil en dev/homologación sin cuenta de Resend armada) — ver variables de entorno más abajo.
- **Configuración estricta de la API Key y dominio verificado**: Para que los envíos masivos no fallen en los entornos productivos o QA, la `RESEND_API_KEY` debe pertenecer a una cuenta con el dominio **verificado** y estar enlazada al mismo (Permission: "Sending access", Domain: "vialto.uno"). Si la cuenta no tiene dominios verificados, Resend entra en modo "Sandbox" y rechaza (HTTP 403) el envío a cuentas de terceros.
- **Dominios de prueba (`@example.com`)**: Resend tiene políticas anti-spam inflexibles que rechazan el lote de emails completo (HTTP 422) si tan solo uno de los destinatarios posee el dominio ficticio `@example.com`. Para evitar bloqueos por usuarios de prueba creados en Clerk, `resolverDestinatarios` de `NotificacionesCronService` filtra y descarta silenciosamente cualquier correo terminado en `@example.com` (aplica a destinatarios por defecto y manuales). Si QA necesita recibir notificaciones de prueba, debe usar dominios reales.
- **Config por tenant** (`NotificacionesConfigService`, patrón calcado de `tenant-field-config`: catálogo en código + tabla de overrides, `overrides[tipo]?.activo ?? item.defaultActivo`): `GET /notificaciones/config` (catálogo efectivo filtrado por módulos del tenant) y `POST /notificaciones/config/toggle` — ambos `@Roles('admin', ...)`, sin `tenantId` en el request (viene del token, regla de siempre). `POST /notificaciones/ejecutar?tenantId=...` es `@Roles('superadmin')` — corre la evaluación de un tenant puntual fuera del horario del cron, para operar/testear sin esperar al día siguiente (único endpoint del módulo que lee `tenantId` de la query, y solo porque está gateado a superadmin).
- **Frontend**: `pages/ConfiguracionNotificacionesTenantPage.tsx` (`/configuracion/notificaciones`, tenant-admin) — lista el catálogo agrupado por módulo con un toggle on/off por tipo, guardado inmediato al tocar el switch (mismo patrón que `CamposEmpresaPage.tsx`, sin botón "Guardar" aparte). Acepta `tenantId?`/`embeddedInSuperadmin?` como prop (mismo componente reusado, no duplicado — patrón Facturación/Viajes) y arma sus 4 URLs (`config`, `config/toggle`, `config/destinatarios`, `/api/users`→`/api/platform/users`) con `?tenantId=` cuando viene seteado. **Pantalla superadmin (ago 2026)**: `pages/SuperadminNotificacionesPage.tsx` (`/superadmin/notificaciones`) — selector de tenant (`EmpresaFilterBar` + `useTenantsList`/`useTenantFiltroUrl`, mismo patrón que `campos-empresa`) que monta `ConfiguracionNotificacionesTenantPage` con el tenant elegido. El controller (`getConfig`/`toggle`/`setDestinatarios`) resuelve el tenant efectivo con `resolveTenantId(auth, tenantId)` (override solo si `auth.role === 'superadmin'`, mismo helper que `importaciones.controller.ts`) — no se creó un controller `/platform/notificaciones` nuevo, se extendió el mismo endpoint de siempre.

---

### Label de "Producto" por tenant (oct 2026)

`Tenant.productoLabel` / `productoLabelPlural` (ej. "Grano" / "Granos", `null` = "Producto") reemplazan la palabra "Producto" en todo el sistema **salvo el módulo Stock** y el término fiscal "Líquido Producto" de ARCA (slugs `emision-liquido-producto-arca`, títulos del CVLP: no se tocan nunca). Lo configura solo el superadmin ("Configuración por empresa" → General).

- **Plural con IA**: al guardar el singular sin mandar plural, `TenantsService.resolverProductoLabel` llama `ProductoLabelPluralService` (`core/tenants/`), que lo pide a `IaJsonService` y, si la IA no está configurada o falla, usa la regla `pluralizarCastellano`. Nunca tira: guardar el tenant no depende de la IA. Un plural mandado explícito (corrección del superadmin) se respeta.
- **Leerlo**: `productoLabels(tenant)` / `productoLabelsDeTenant(db, tenantId)` / `labelEnFrase` en `shared/util/producto-label.util.ts` (espejo de `lib/productoLabel.ts` del front). Tests: `npm run test:producto-label`.
- **Dónde se aplica hoy**: detalle de la factura PDF ("GRANO: …"), columna del PDF de liquidación, encabezados de import de Viajes (`labelDinamicoImport` en `importaciones.service.ts`: catálogo, planilla y alias en memoria al importar, así un Excel con "Producto" o con "Grano" matchea igual) y los mensajes de producto inexistente/inactivo de Viajes.
- **Género**: el label puede ser femenino ("Mercadería"). En frases, usar redacciones neutras ("Hay mercaderías que…"), nunca "Ese/Algún {label}".
- `Tenant.viajesColumnaProductosHabilitada` (default `false`) habilita la columna opcional `productos` en la grilla de Viajes (también ordenable, ver `VIAJES_COLUMNAS_ORDENABLES`).

---

### `core/tenant-field-config` — visibilidad de campos y features opt-in por tenant

Sistema genérico para que un superadmin oculte/muestre, por tenant y por formulario, campos opcionales de un módulo (ej. "Ganancia bruta manual", "Otros gastos" en Viajes) — pantalla `campos-empresa` en el frontend superadmin. **No confundir con la Capa 2 de feature flags (`TenantConfig.flags`) descripta en "Configuración de funcionalidades por tenant" más arriba: esa es documentación de un patrón, no está implementada en ningún módulo real; `tenant-field-config` sí está implementado y en uso.**

```prisma
model TenantFieldConfig {
  id          String   @id @default(cuid())
  tenantId    String
  modulo      String   // "viajes" | "stock" | ...
  formulario  String   // "alta_viaje" | "edicion_viaje" | "detalle_viaje" | ...
  campos      Json     // Record<campo, { visible: boolean }> — solo overrides, no el catálogo completo
  updatedBy   String
  updatedAt   DateTime @updatedAt

  @@unique([tenantId, modulo, formulario])
}

model TenantFieldConfigAuditLog {
  id             String   @id @default(cuid())
  tenantId       String
  modulo         String
  formulario     String
  campo          String
  configAnterior Json?
  configNuevo    Json
  changedBy      String
  changedAt      DateTime @default(now())
}
```

- **`field-catalog.ts`** (`FIELD_CATALOG`) es la fuente de verdad de qué campos existen por `(modulo, formulario)`, con `label`, `obligatorioSistema` (si es `true`, no se puede ocultar — `toggleCampo` rechaza el intento) y, opcional, **`defaultVisible`** (default `true` si se omite — comportamiento histórico, visible salvo que se oculte explícitamente). Un campo **opt-in** (una feature que solo algunos tenants necesitan, ej. `precioTransportistaIvaIncluidoPct`) declara `defaultVisible: false`: nace oculto para todo tenant y cada uno lo habilita explícitamente desde `campos-empresa`.
- **`TenantFieldConfigService.getConfigEfectiva`/`getConfigEfectivaModulo`** combinan el catálogo con los overrides guardados: `overrides[campo]?.visible ?? campoDef.defaultVisible ?? true`. `getAuditLogs` usa el mismo `defaultVisible` (no asume `true`) para reconstruir el "estado anterior" del primer toggle de un campo.
- **`isCampoVisible(tenantId, modulo, formulario, campo)`** — método liviano (una sola query) para que OTRO servicio (no solo el frontend) consulte la visibilidad efectiva de un campo puntual. Es el punto de entrada para el patrón de abajo.
- **Frontend**: `useFieldConfig(modulo)` (`hooks/useFieldConfig.ts`) trae `GET /field-config/:modulo` (cacheado en memoria por módulo) y expone `isVisible(formulario, campo)` — `true` si no cargó todavía o el campo no está en la config (mismo default que el backend). Usado para condicionar inputs/secciones enteras en los formularios (`ViajeCreatePage.tsx`, `ViajeEditModal.tsx`, `ViajeViewModal.tsx`, etc.) — ver el patrón `desgloseActivo`/`ivaTransportistaVisible` como referencia a copiar para un campo opt-in nuevo.

#### Patrón: feature opt-in que además debe ignorarse en cálculos de negocio (no solo ocultarse en el form)

Ocultar un campo en el formulario **no alcanza** cuando ese campo alimenta un cálculo de dinero (acordado, ganancia bruta, saldo, dashboard) que corre en el backend independientemente de qué formulario se usó para cargar el dato. Caso real: `precioTransportistaIvaIncluidoPct` (ago 2026) — al agregar el switch de visibilidad, un tenant que lo tuvo habilitado, cargó valores, y después lo deshabilita, **no debe perder el dato** (sigue en la base, íntegro) pero esos valores **tampoco deben seguir afectando ningún cálculo** hasta que se vuelva a habilitar.

- **Señal canónica única, no una por formulario**: aunque `TenantFieldConfig` permite visibilidad independiente por formulario (alta/edición/detalle), para gatear un CÁLCULO se elige **un solo formulario como señal canónica** — para este campo, `edicion_viaje` (es donde se mantiene/corrige el valor a lo largo de la vida del viaje, y ya era el criterio que usaba el lock por `liquidacionVigente`). Ver `ViajesService.ivaTransportistaHabilitado(tenantId)` / `DashboardFinancieroService`/`DashboardService` (mismo método privado, duplicado a propósito, mismo criterio).
- **Lectura**: `ViajesService.zerarIvaTransportistaSiDeshabilitado(item, habilitado)` — helper que, si el campo está deshabilitado, devuelve el objeto con `precioTransportistaIvaIncluidoPct: 0` (nunca `null`/`undefined`, para no romper cálculos que hacen `Number(x) || 0`). Se aplica en **todo** punto donde `ViajesService` responde un viaje (o lista) al frontend: `findAll`, `findAllPaginated` (los 4 caminos de sort — default, fecha, monto, ganancia_bruta — todos terminan en `findAllPaginatedPageFromSortedIds`, que también lo aplica), `findOne`, `getGananciaBruta`, y los retornos de `create`/`update`/`addPagoTransportista`/`deletePagoTransportista`/`getViajesSaldoPendienteTransportista`. Así, **cualquier consumidor** (grillas, badges de saldo, resumen de ganancia bruta, o el propio frontend recalculando en cliente vía `lib/viajesTransportistaPagos.ts`) ve "no aplica" sin tener que conocer la configuración del tenant — no hizo falta tocar el frontend más allá del gating de UI ya existente.
- **Escritura**: `update()` **ignora en silencio** cualquier `dto.precioTransportistaIvaIncluidoPct` entrante si el campo está deshabilitado — preserva `current.precioTransportistaIvaIncluidoPct` tal cual, nunca lo pisa con lo que venga en el body (que de todos modos el form tiene oculto). Nunca lanza error por esto — el guard de `liquidacionVigente` (`ConflictException`) es un caso aparte y solo corre si el campo SÍ está habilitado.
- **Cálculos server-side afectados** (todos reciben el flag ya resuelto una vez por método, no por fila — una sola query extra por request): `calcularAcordado`/`assertPagosTransportistaNoSuperanSaldo` (`viajes.service.ts`), `calcularGananciaAutomatica` vía el mismo ternario que ya zeroaba con `costoLiquidadoReal` (extendido con `|| !ivaTransportistaHabilitado`), y los 3 usos de `engrosarConIva`/`buildGananciaBrutaResumen` en `dashboard-financiero.service.ts` (`buildMargen`, `buildViajesFunnel`, `buildLiquidaciones`) + 1 en `dashboard.service.ts` (`buildMargenBajoAlerta`).
- **Fuera de alcance a propósito** (documentado también en la sección de `precioTransportistaExterno` con IVA): la Liquidación/CVLP nunca leyó este campo, así que no necesita ningún gating nuevo; los `_sum` agregados de `getStats()`/`sumAPagarPorMoneda` siguen sin aplicar el % (ya lo hacían así antes de este campo existir).
- **Replicar este patrón** para el próximo campo opt-in que alimente un cálculo: (1) `defaultVisible: false` en `field-catalog.ts`; (2) elegir UN formulario canónico; (3) un método privado `xHabilitado(tenantId)` por servicio que lo necesite (duplicado a propósito, no vale la pena una dependencia compartida para un one-liner); (4) un helper de zero-out aplicado en cada punto de lectura; (5) proteger el `update()` correspondiente para que ignore el dto en vez de pisar el valor guardado.

---

### `core/padron` — validación de CUIT contra el padrón de ARCA (sep 2026)

Al cargar/editar un CUIT argentino en Cliente o Transportista, el frontend consulta `GET /api/padron/cuit/:cuit` y autocompleta nombre (tal cual figura en ARCA), domicilio fiscal y condición IVA. **No depende de ningún módulo ARCA** — por eso vive en `core/` y no tiene `ModuleGuard` (solo `@Roles('admin','superadmin')`, los mismos que pueden crear/editar).

- **Opt-in por empresa, deshabilitado por defecto** (sep 2026): un único flag general `Tenant.validacionCuitArcaHabilitada` (`Boolean @default(false)`, migración `20260930120000_tenant_validacion_cuit_arca`), editable solo por superadmin (`PATCH /tenants/:orgId`) desde "Campos por empresa" → pestaña General. **No es por formulario a propósito** (decisión de producto: un switch y listo — se descartó usar `tenant-field-config`). `PadronController` lo exige también del lado del servidor (403 si la empresa no lo tiene; superadmin siempre pasa), así una empresa sin la opción no puede gastar la cuota de afipsdk llamando al endpoint a mano.

- **Certificado de plataforma, no del tenant**: consulta `ws_sr_constancia_inscripcion` (padrón A5) vía `@afipsdk/afip.js` (`RegisterInscriptionProof.getTaxpayerDetails`) con un único certificado de producción asociado al CUIT personal de Elias (ni CapassoTech ni Vialto tienen CUIT). Con el padrón A5 el consultante puede ser cualquiera: el `cuitRepresentada` es el dueño del certificado, no el tenant. **No usa `ArcaConfig` ni `ArcaClientService`** (el core no puede depender de `modules/liquidaciones-arca`) — cliente AFIP propio en `PadronService`.
- **Cuenta de afipsdk separada** (`PADRON_AFIP_SDK_API_KEY`), distinta de la de facturación de NyM (`AFIP_SDK_API_KEY`), para no consumir su cuota. Plan Free: 1 CUIT, 1.000 requests/mes.
- **Setup/prueba**: `scripts/setup-padron-cert.js` (automatizaciones afipsdk que crearon y autorizaron el certificado; no hace falta volver a correrlo salvo al renovar el certificado, que vence a los ~2 años) y `scripts/test-padron.js [CUIT]` (consulta real, gasta 1 request).
- **Estados** (`padron.types.ts`): `activo` (autocompleta todo) | `con_observaciones` (ARCA no emite la constancia pero el CUIT existe — aceptable, solo trae nombre) | `inactivo` (clave no ACTIVA — no autocompleta, aviso rojo) | `no_encontrado`. **Ojo:** un CUIT apócrifo / "no confiable" (RG 3832) **no** viene con `estadoClave: INACTIVO`: ARCA no manda `datosGenerales` y solo devuelve `errorConstancia` con "CUIT ... limitada ... Base Contribuyentes NO Confiable" / "La CUIT fue cancelada" (verificado con un CUIT real, oct 2026). `mapPersona` lo detecta por texto (`OBSERVACION_BLOQUEANTE`) y lo marca `inactivo`, no `con_observaciones`.
- **Protección de cuota**: caché en memoria por CUIT (7 días, solo respuestas exitosas) + tope de 100 consultas reales por tenant por día (429). En memoria a propósito: una sola instancia en Render; si se escala a varias, mover a DB.
- **Nunca bloquea la carga**: ARCA caído / sin configurar → 503 con mensaje amigable; el frontend muestra "No se pudo validar" y la carga manual sigue igual. El dígito verificador (`shared/util/cuit.ts`) se valida antes de consultar (400 sin gastar request).
- **Dígito verificador — dónde se exige**: en los formularios del frontend (`validarIdFiscal` de `lib/ciudades/paises.ts`) y en el **preview de la importación masiva** de clientes/transportistas (`ValidatorService.errorIdFiscal`: la fila sale como error de campo, antes de confirmar). **No** en `shared/util/validar-id-fiscal.ts` (create/update del API), a propósito, para no romper registros viejos al editarlos por API.
- **La importación NO consulta ARCA** (decisión sep 2026): 1.000 requests/mes y el tope de 100/día por tenant no alcanzan para planillas grandes, y cada consulta tarda 1-2 s. Si se pasa a un plan pago de afipsdk, la idea pendiente es un botón opt-in "Completar datos faltantes con ARCA" en el preview, solo para filas sin nombre/domicilio.
- Pruebas: `npm run test:padron` (mapeo, estados, caché, tope, errores — cliente AFIP mockeado).
- **Validar un registro ya guardado + marca de "validado" (oct 2026)**: `POST /api/padron/validar/:entidad/:id` (`entidad` = `clientes` | `transportistas`, `?tenantId=` solo para superadmin vía `resolveTenantId`), en `PadronValidacionService`. Lo usan "Nueva factura" (cliente) y "Nueva liquidación" (transportista y cliente) al elegir el registro (hook `useValidacionPadronRegistro` del front). Respeta el mismo opt-in `validacionCuitArcaHabilitada` (403 sin él, también para superadmin: valida la empresa elegida). Resultados: `no_aplica` (sin CUIT AR válido) | `validado` | `actualizado` | `rechazado` (inactivo / no encontrado — el front abre el modal para revisar el CUIT).
  - **`actualizado` — se guarda solo, sin confirmación (20/10/2026, a pedido de Elias; antes era `diferencias` + modal precargado)**: si la razón social, la condición IVA o el domicilio difieren de ARCA (o están vacíos), se pisan con los de ARCA en el mismo update que deja la huella, y se devuelven `cambios` + `padron` para que el front refresque su estado local. **El CUIT nunca se modifica.**
  - **`POST .../confirmar`**: el usuario abrió "Ver datos" tras una actualización automática y editó a mano (mismo CUIT). Marca la huella con lo que guardó, así la próxima validación no vuelve a pisar su edición. Exige que el CUIT siga activo (sale de la caché). Si cambió el CUIT, el front llama a `validar` de nuevo.
  - **La marca es una huella, no un booleano**: `arcaValidadoHuella` = `cuit|condicionIva|domicilio normalizado` + `arcaValidadoAt` en `clientes`/`transportistas` (migración `20261008150000_padron_validado_cliente_transportista`). Si la huella coincide con los datos actuales, `validar` responde `validado` **sin consultar ARCA**. Si cambia cualquiera de esos datos por cualquier vía (edición, importación, superadmin), deja de coincidir y se vuelve a consultar — por eso **no hace falta limpiar la marca en los `update`** de cada servicio; no agregar esa lógica.
  - Domicilio: se compara normalizado (sin tildes, mayúsculas ni puntuación), así un domicilio escrito distinto pero equivalente no se pisa. La razón social se compara exacta (se guarda tal cual figura en ARCA). La huella no incluye el nombre: un cambio de nombre posterior no fuerza otra consulta.
  - Pruebas: `npm run test:padron-validacion` (huella, reconsulta al cambiar datos, actualización automática sin tocar el CUIT, rechazado, confirmar respeta la edición manual, opt-in, aislamiento por tenant).
- **Chequeo del receptor antes de emitir por ARCA (oct 2026)**: `ReceptorPadronService` (`modules/liquidaciones-arca/receptor-padron.service.ts`, importa `PadronModule`, que ahora exporta `PadronService`). `emitirFacturaArca` (receptor = cliente) y `emitirLiquidacion` (receptor = transportista) lo llaman antes de marcar `pendiente_cae`: si el CUIT figura inactivo (caso real: "CUIT receptora inactiva por haber sido marcada como apócrifa") o no existe, cortan con 422 `{ message, detalle }` y el comprobante no se toca. Motivo: ese rechazo de ARCA llegaba recién al emitir. Reglas:
  - Solo tenants con `emision-facturas-arca` / `emision-liquido-producto-arca` (lo garantizan los guards de esos endpoints) y solo en **producción** (en homologación se emite con el CUIT de prueba). Excepción para probarlo: `PADRON_CHEQUEO_RECEPTOR_HOMOLOGACION=true` lo activa también en homologación — cargarla **solo en el backend de QA**, nunca en producción.
  - **No** depende del opt-in `validacionCuitArcaHabilitada` ni usa la huella `arcaValidadoHuella`: un CUIT validado puede pasar a apócrifo después. Usa `PadronService.consultar(..., { maxAgeMs })` con caché de 24 h como máximo (en vez de 7 días).
  - Si el padrón no responde (503, tope diario 429, sin configurar), **no bloquea**: loguea y emite igual.
  - Gasta cuota de la cuenta de afipsdk del padrón (1 consulta por CUIT cada 24 h).
  - **Aviso antes de emitir**: `GET integracion-arca/receptor-padron/:entidad/:id` (y `platform/integracion-arca/...?tenantId=`) → `ReceptorPadronService.verificarRegistro`, el mismo chequeo sin tirar (`{ bloqueado, mensaje }`). El front (`useReceptorPadronBloqueado`) lo usa en "Nueva liquidación" para deshabilitar "Emitir" y mostrar el aviso rojo en el pie (`AvisoFaltantesEmision` con `bloqueante`, con el zumbido de los datos faltantes).
  - Pruebas: `npm run test:receptor-padron`.

---

## Clientes actuales y estado

| Cliente | Estado | Módulos contratados | Prioridad |
|---|---|---|---|
| Bressan | ✅ Activo (stack viejo) | combustible | Migrar a Vialto en el futuro |
| Sebastián Fernández | ✅ Cerrado | viajes | 1 — construir ya |
| Matías Riedel | ✅ Activo | stock, cuenta-corriente | 2 |
| Melisa (Desagotes) | ⏳ Muy probable | remitos (⚠️ a reconstruir, ver sección "`remitos` — eliminado"), cuenta-corriente | 3 |
| Marcos Venturini (NyM Logística) | ⏳ Presupuesto enviado | emision-facturas-arca, emision-liquido-producto-arca, viajes | 4 |
| Wichi Toledo SRL | ⏳ Muy probable | mantenimiento, combustible | 5 |
| Gabriel González e Hijo | 🔲 Interesado | facturacion (viajes + cobranzas) | 6 |
| Javier Altamirano | 🔲 Pendiente | viajes, facturacion, combustible | 7 |
| Mailen Matilla | 🔲 Pendiente | viajes, facturacion | 8 |
| Hernán Pereyra | 🔲 Pendiente | turnos (⚠️ el stub se borró, a reconstruir desde cero) (PWA) | 9 — módulo aislado |

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
| emision-facturas-arca | — | — | — | — | — | — | — | — | ✓ |
| emision-liquido-producto-arca | — | — | — | — | — | — | — | — | ✓ |

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
  → módulo: cuenta-corriente ✅ (saldo por cliente y por proveedor/fletero, imputación de pagos, tablero, historial)

FASE 3 — Melisa
  → módulo: remitos (PWA para chofer, firma digital) — ⚠️ el que existía se borró en ago 2026 (sin uso real, sin frontend nunca conectado); reconstruir desde cero llegado el momento, ver "`remitos` — eliminado"
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
  → módulo: turnos (PWA para choferes, panel admin, listas de turno) — el stub que existía se borró en ago 2026 (sin nada real detrás); reconstruir desde cero llegado el momento
  → Módulo aislado, no depende de los anteriores

FASE NyM — Venturini (NyM Logística)
  → módulos: emision-facturas-arca + emision-liquido-producto-arca (carpeta src/modules/liquidaciones-arca/) — ✅ implementado, divididos en dos slugs independientes en ago 2026
  → Campos de granel en metadata del viaje: ctg, cartaDePorte, grano, tnOrigen, tnDestino, tarifaPorTn
  → Feature flag: liquidaciones.habilitarGranel = true para este tenant
  → Motor de liquidación CVLP: agrupamiento por transportista, cálculo comisión, líquido producto, IVA
  → Integración AfipSDK: emisión comprobante tipo 60 con CAE vía WSFEv1
  → Facturas A/B a clientes vía AfipSDK
  → PDF del comprobante con formato NyM Logística

FASE 8 — Transversal
  → módulo: reportes — el que existía (2 endpoints, sin frontend conectado) se borró en ago 2026 por no tener ningún consumidor real; si se retoma, es desde cero
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
- **PostgreSQL:** Neon.tech — plan pago por uso desde sep 2026 (el free agotó su cuota de cómputo y suspendió producción). Dos proyectos separados porque la cuota/consumo es por proyecto: `vialto` (solo rama `production`, máx. 2 CU) y `vialto-desarrollo` (QA, rama `develop`, máx. 1 CU). No crear ramas de desarrollo dentro de `vialto`.
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

# Módulos emision-facturas-arca / emision-liquido-producto-arca — carpeta liquidaciones-arca (NyM Logística) — fail-fast si falta en runtime
ARCA_ENCRYPTION_KEY=              # clave AES-256 (hex 64 chars) para cifrar cert/key/credenciales AFIP en DB
AFIP_SDK_API_KEY=                 # token de AfipSDK (afipsdk.com)

# core/padron — validación de CUIT contra el padrón de ARCA (todos los tenants). Sin estas
# variables el endpoint responde 503 y los formularios siguen funcionando a mano.
PADRON_AFIP_SDK_API_KEY=          # token de la cuenta de afipsdk dedicada al padrón (≠ AFIP_SDK_API_KEY)
PADRON_CUIT=                      # CUIT dueño del certificado de plataforma
PADRON_CERT=                      # certificado PEM (una línea con \n literales)
PADRON_KEY=                       # clave privada PEM (una línea con \n literales)
PADRON_CHEQUEO_RECEPTOR_HOMOLOGACION= # "true" SOLO en QA: chequea el CUIT del receptor al emitir también en homologación

# Módulo notificaciones (alertas por email vía Resend) — sin RESEND_API_KEY el cron
# sigue corriendo pero solo loguea, no envía nada (ver ResendEmailService)
RESEND_API_KEY=                   # API key de Resend (resend.com)
RESEND_FROM_EMAIL=                # remitente, ej. "Vialto <notificaciones@vialto.app>" — default hardcodeado si se omite

# Futuro — Stripe para billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

---

*Última actualización: octubre 2026 (fechas y zona horaria — "hoy" y días calendario en hora de Argentina vía `shared/util/fecha-ar.util.ts`, convención de almacenamiento por campo, ver sección "Fechas y zona horaria"; y, de una pasada anterior, unicidad de ID Fiscal/DNI por tenant en Cliente/Transportista/Chofer — validación de aplicación vía `ConflictException`, sin `@@unique` en Prisma, ver sección "Unicidad de ID Fiscal / DNI por tenant"; de la misma pasada, importaciones — conflicto de campo único ID Fiscal/DNI resuelto por el usuario fila a fila (`ignorar`/`actualizar`) en vez de rechazar la fila, mecanismo genérico vía `IImportProcessor.detectarCampoUnicoDuplicado`, ver "Conflicto de campo único (ID Fiscal / DNI) — ignorar o actualizar en vez de rechazar"; y, de la misma pasada, normalización del campo País a código de 2 letras durante el import (antes se guardaba el texto crudo del Excel, ej. "Argentina", distinto del código que usa el alta manual) + backfill de los registros ya importados en Neon, ver "País: normalización a código de 2 letras durante el import"; y, de una pasada anterior, facturas por tramo: `Factura.ivaMonto` persistido, cobro = neto + IVA para tenants sin ARCA, resto del viaje no cubierto por tramos se trata como implícito con `ivaPct` de cabecera — ver sección "Facturas por tramo (LSF / Uruguay)"; y, de una pasada anterior, el módulo `integracion-arca` se dividió en dos slugs independientes — `emision-facturas-arca` y `emision-liquido-producto-arca` — para que un tenant pueda contratar solo uno de los dos (caso real: cliente nuevo que quiere emisión de facturas ARCA sin liquidación CVLP, algo imposible con el flag único de antes); guards repartidos endpoint por endpoint en `liquidaciones.controller.ts`, variables `hasArca` mezcladas separadas en dos en el frontend (`TenantHomePage.tsx`/`ViajesTenantPage.tsx` eran las más riesgosas — esta última tenía una variable `hasLiquidacionesArca` que en realidad controlaba Facturas, no Liquidaciones), `ArcaConfigTenantPage.tsx` oculta secciones según cuál de los dos módulos tiene el tenant, y las rutas HTTP (`/api/integracion-arca/...`) no cambiaron porque son independientes del slug de acceso; ver sección propia del módulo; y, de la misma pasada, módulos `remitos`, `reportes` y `turnos` eliminados por completo — código, y en el caso de `remitos` también su modelo Prisma vía migración `20260828164256_drop_remito_module` — y sus slugs sacados de `VIALTO_MODULES`; ningún tenant real los tenía contratados y ninguno tenía frontend que los consumiera (`turnos` era un stub sin modelo ni service, para un cliente — Pereyra — que sigue "🔲 Pendiente"). Ver secciones "`remitos` — eliminado", nota de "`turnos`" arriba, y las notas de Fase 3/Fase 7/Fase 8 del roadmap; y, de la misma pasada, módulo `notificaciones` nuevo — alertas por email vía Resend, catálogo en código + config on/off por tenant calcada de `tenant-field-config`, cron diario agrupado por tipo con dedup por entidad, destinatarios = admins de Clerk del tenant, ver sección "`notificaciones` — alertas por email vía Resend"; y, de una pasada anterior, `precioTransportistaIvaIncluidoPct` pasó a ser opt-in vía `core/tenant-field-config` — `defaultVisible: false`, oculto por defecto para todo tenant; si un tenant lo deshabilita después de haberlo usado, los valores cargados NO se borran pero se ignoran en todo cálculo hasta reactivarlo, ver sección "`core/tenant-field-config` — visibilidad de campos y features opt-in por tenant"; y, de la misma pasada, `Viaje.precioTransportistaIvaIncluidoPct` — rediseño v3 "engrosar": el precio del viaje siempre fue neto/sin IVA, el % ahora se SUMA por encima al calcular cuánto se paga en efectivo (`engrosarConIva` en `viaje-ganancia-bruta.util.ts`), en vez de "netear"/descontarlo como hacía la v2 descartada; corrige un caso real de cliente (LSF) donde la ganancia bruta automática mostraba una ganancia falsa por no contemplar el IVA que se le paga al transportista; la Liquidación/CVLP vuelve a su comportamiento de siempre (sin ajuste por este %, sin exclusión ni validación de % mixto); lock angosto por `liquidacionEstado` distinto del resto de `CAMPOS_FISCALES_VIAJE`; y resumen real + badge de liquidación reusado en `ViajeEditModal.tsx` cuando el viaje tiene liquidación vigente; y, de una pasada anterior, motor de importaciones — sugerencia IA con fallback Groq, `warnIfEmpty`/CUIT-país opcional, `InsertResult` con desglose creados/actualizados, dedup de Factura por `nroFactura`, split de patente compuesta en Vehículos, diff antes/después de Viajes, endpoint `tenant-tiene-datos`; y, de una pasada anterior a esa, rediseño de estados de Viaje en 3 indicadores independientes — etapa/facturación/liquidación —, split de estado de Factura en ciclo de vida + cobrado/vencida, y `Factura.ambiente`)*
*Desarrollado por Elias N. Capasso — CapassoTech / Vialto*
