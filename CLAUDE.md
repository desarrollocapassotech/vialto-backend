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
5. **El core no depende de módulos** — los módulos pueden depender del core pero no entre sí.
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
    liquidaciones-arca/     ← ✅ implementado — OJO: el slug de módulo real (`RequireModule`, `Tenant.modules`) es `integracion-arca`, no `liquidaciones-arca` — ver nota de VIALTO_MODULES arriba
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
- **`facturacionEstado`**: `sin_facturar | esperando_afip | facturado | cobrado | error_afip | anulado`.
- **`liquidacionEstado`**: `null` (no aplica: sin transportista externo o tenant sin `integracion-arca`) | `sin_liquidar | esperando_afip | liquidado | error_afip | anulado`.

**Sync**: `modules/viajes/viaje-estado-financiero.ts` expone las funciones puras `mapFacturacionEstado`/`mapLiquidacionEstado` (calculan el indicador a partir de `Factura.arcaEstado` / `Liquidacion.estado` + si el tenant tiene ARCA) y las funciones que tocan DB `syncFacturacionEstadoViaje(s)`/`syncLiquidacionEstadoViaje(s)`. **Toda** operación que crea, vincula, desvincula, emite, anula o elimina una Factura o Liquidación debe llamar al sync correspondiente para los viajes afectados — ya está wired en `facturacion.service.ts` (create/update/removeFactura/pagos/marcarComoCobrada) y `liquidaciones.service.ts` (create/emitir/anular/deleteLiquidacion, emitir/anularFacturaArca). Un bug histórico real (re-facturar tras anular quedaba bloqueado) fue justamente un `anularFacturaArca` que no llamaba al sync — si se agrega un nuevo punto de mutación de Factura/Liquidación, hay que sumar la llamada ahí también.

**También hay que llamar `syncLiquidacionEstadoViaje` al CREAR un viaje** (`viajes.service.ts#create` y `importaciones/processors/viajes.processor.ts#insert`), aunque todavía no tenga ninguna Liquidación — `liquidacionEstado` no tiene `@default` en el schema (a propósito, porque su valor correcto depende de si aplica o no), así que sin esa llamada un viaje con transportista externo en un tenant con ARCA queda en `null` en vez de `sin_liquidar` hasta el primer evento de liquidación. Bug real encontrado y corregido en ago 2026 (afectaba viajes recién creados de NyM, bloqueando el flujo de liquidación).

**Tenant sin `integracion-arca`**: `liquidacionEstado` es `null` únicamente si el viaje no tiene transportista externo — **no** por falta de ARCA. `CrearLiquidacionManualModal` con `hasArca=false` sigue creando una `Liquidacion` real (registro manual, queda en `estado: 'borrador'` para siempre porque no hay paso de "emitir" sin ARCA), así que estos tenants sí tienen liquidaciones genuinas que hay que reflejar. `mapLiquidacionEstado(estado, tieneArca)` maneja esto: con `tieneArca=false`, cualquier registro no-anulado (`borrador`, y por herencia `pendiente_cae`/`autorizado`/`error` si quedaron de datos viejos) mapea directo a `liquidado` — nunca a vocabulario de AFIP (`esperando_afip`/`error_afip`). Bug real encontrado y corregido en ago 2026: la versión anterior forzaba `liquidacionEstado = null` para todo tenant sin ARCA (confundiendo "no aplica AFIP" con "no aplica liquidación"), lo que hacía que `FacturarSelectorModal` mostrara "Liquidación a transportista" como **siempre completada** ("Ya registrado") incluso en viajes sin ninguna liquidación real — bloqueando de hecho la creación de liquidaciones manuales nuevas. `facturacionEstado` sigue el mismo criterio y no tiene este problema porque nunca dependió de si existía o no un registro: nunca expone valores AFIP (`esperando_afip`/`error_afip`) para tenants sin ARCA — cae directo a `facturado`/`cobrado`/`anulado`.

**Edit-lock por campo, no todo-o-nada**: `viajes.service.ts` define `CAMPOS_FISCALES_VIAJE` (cliente, transportista, montos, gastos, pagos a transportista) — bloqueados con `ConflictException` mientras `facturacionEstado ∉ {sin_facturar, anulado}` o `liquidacionEstado ∉ {null, sin_liquidar, anulado}`. Los campos operativos (fechas, km, litros, chofer, vehículos, observaciones, **incluida `etapa`**) siempre son editables, esté o no facturado/liquidado.

**Frontend** (`vialto-frontend/src/lib/viajesIndicadores.ts`): centraliza labels/clases/tooltips de los 3 indicadores y `facturacionPermiteVincular`/`liquidacionPermiteVincular` (`sin_facturar`/`anulado` cuentan como "disponible para vincular una factura/liquidación nueva"). Los badges de la grilla de Viajes (`ViajeFacturacionIndicador`/`ViajeLiquidacionIndicador`) son clickeables: si el viaje ya tiene factura/liquidación vinculada, el click trae el registro completo (fetch on click) y abre directo `FacturaViewModal`/`LiquidacionViewModal` — sin modal intermedio; si todavía no hay nada vinculado, muestra un modal de detalle liviano (`ViajeFacturacionDetalleModal`/`ViajeLiquidacionDetalleModal`) que solo informa el estado. **Estos badges nunca agregan acciones de mutación** (ej. "marcar como cobrada", emitir, anular) — eso vive únicamente en las pantallas de Facturas/Liquidaciones; desde Viajes es solo lectura/navegación.

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

**Lock angosto, distinto al resto de `CAMPOS_FISCALES_VIAJE`**: `precioTransportistaIvaIncluidoPct` **NO** está en `CAMPOS_FISCALES_VIAJE` — tiene su propio guard en `update()`, bloqueado **solo** por `liquidacionEstado` (no por `facturacionEstado`). Es intencional: facturación al cliente y liquidación al transportista son ejes independientes, y bloquear este campo por una factura al cliente (sin relación con el transportista) dejaría el campo atascado para siempre en viajes viejos de un tenant que recién adopta `integracion-arca`. Una vez que el viaje tiene liquidación vigente, el % queda fijo porque el "pago en efectivo" ya se le comunicó al transportista con ese valor — cambiarlo después desincronizaría el acordado ya conocido (aunque, como se explica arriba, la Liquidación en sí nunca leyó este %). Si se agrega un campo nuevo relacionado solo al transportista (no al cliente), evaluar si también necesita este lock angosto en vez de sumarlo sin más a `CAMPOS_FISCALES_VIAJE`.

**Frontend**: input numérico "% de IVA ya incluido en el precio" (`ViajeCreatePage.tsx`, `ViajeEditModal.tsx`; `0` o vacío = no suma IVA), bloqueado solo cuando `liquidacionVigente` (mismo criterio de arriba). El trío "Pago bruto / Pago neto / Monto IVA" del modo desglose (`ViajeEditModal.tsx`, `ViajeCreatePage.tsx`) muestra: bruto = `engrosarConIva(neto, pct)` (lo que se paga en efectivo, mayor), neto = cantidad × precio unitario tal cual se tipeó (el valor guardado), IVA = bruto − neto. `CrearLiquidacionManualModal.tsx` ya no ajusta su resumen por este %, porque la Liquidación tampoco lo hace — el bruto ahí es la suma simple de `precioTransportistaExterno` de los viajes seleccionados. Ningún patrón de advertencia por módulo ARCA aplica a este campo (no tiene incompatibilidad con `integracion-arca`).

**Migraciones**: `20260818120000_viaje_precio_transportista_incluye_iva` (v1, boolean, descartada) seguida de `20260819120000_viaje_precio_transportista_iva_incluido_pct` (dropea el boolean, agrega el float que sigue vigente) — sin dato de producción en juego, la v1 nunca llegó a producción. La v2→v3 (neteo→engrosar) fue puramente un cambio de interpretación en código, sin tocar el schema ni requerir migración nueva.

**Pagos al transportista con liquidación vigente — resumen real en vez de fieldset editable** (`ViajeEditModal.tsx`, ago 2026, sin cambios por el rediseño de arriba — sigue vigente tal cual): el "Acordado/Pagado/Saldo" en vivo de `PagosTransportistaFieldset` (`calcularSaldoTransportistaDesdeDraft`) siempre calculó sobre el precio plano del draft, sin mirar `liquidacionesViaje` — y `pagosTransportista` está en `CAMPOS_FISCALES_VIAJE`, así que editar filas ahí ya fallaba igual al guardar una vez que el viaje tiene liquidación vigente. La sección "Pagos al transportista" de `ViajeEditModal.tsx` bifurca por `liquidacionVigente`: si hay liquidación vigente, en vez del fieldset editable muestra `PagosTransportistaSummary` (solo lectura, `calcularSaldoTransportista` con la Liquidación real) + el badge `ViajeLiquidacionIndicador` reusado tal cual de la grilla de Viajes (fetch-on-click, abre `LiquidacionViewModal` completo — comisión, IVA, conceptos, líquido, CAE). Sin liquidación vigente, sigue el fieldset editable de siempre — ahí el draft y el real coinciden, no hace falta el resumen.
  - `PagosTransportistaSummary.onRegistrarPago` es opcional: si el host no lo pasa, el botón "+ Registrar pago" no se muestra. `ViajeEditModal` recibe `onRegistrarPago?: () => void` por prop, wireado en `ViajesTenantPage.tsx` (que ya tenía `RegistrarPagoTransportistaModal` montado a nivel página) contra `viajeEditor.viajeSnapshot`; `TenantHomePage.tsx` no lo pasa (no tiene ese modal montado) — ahí el resumen queda de solo lectura sin el botón, no se agregó el modal completo solo para esto.
  - `useViajeEditor.ts` expone `patchViajeSnapshot(updated: Viaje)` — sin esto, registrar un pago mientras el editor sigue abierto para el mismo viaje dejaba `viajeSnapshot` desactualizado. Se llama junto a `setDraft(...)` en el `onSuccess` de `RegistrarPagoTransportistaModal`.

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

### `remitos` — eliminado (ago 2026)

Existió un módulo standalone `remitos` (modelo `Remito` con `firmaUrl` para firma digital del cliente, CRUD completo en el backend). Se borró por completo — módulo, controller/service/DTOs, modelo Prisma y las columnas `remitoId` (FK opcional, `onDelete: SetNull`) que `MovimientoStock`/`StockOperacion` tenían hacia él — porque, pese a estar terminado del lado backend, **nunca tuvo ninguna pantalla de frontend** (cero rutas, cero componentes) y ningún tenant real lo tuvo contratado en producción (solo el tenant interno de testing `CapassoTech`). Migración: `20260828164256_drop_remito_module`, aplicada en la rama `develop` de Neon.

**No confundir con el "remito interno" de Stock**, que sigue intacto y es una feature completamente distinta: `StockOperacion.remitoUrl`/`numeroRemito`/`numeroRemitoProveedor` + `StockEgresoRemitoConfig` + `StockRemitoSecuencia` — el PDF que se genera automáticamente al hacer un egreso de stock. Ese no se tocó.

Si en el futuro Melisa (Desagotes, ver "Clientes actuales y estado" más abajo) confirma como cliente y necesita remitos con firma digital del chofer/cliente vía PWA, hay que reconstruir el módulo desde cero (no queda nada reusable salvo este historial).

---

### `integracion-arca` — Liquidaciones CVLP + Facturas A/B vía AFIP SDK (carpeta `liquidaciones-arca/`)
Implementado, no planeado. **El slug de gating real es `integracion-arca`** (ver nota sobre `VIALTO_MODULES` más arriba) aunque la carpeta del módulo, los nombres de archivo y varios comentarios del schema sigan diciendo `liquidaciones-arca` — inconsistencia de nombres conocida, no corregida a propósito por decisión del equipo (jul 2026). Para cualquier `Tenant.modules` o `@RequireModule(...)` nuevo, usar siempre `integracion-arca`.

Motor: `liquidaciones.service.ts` (liquidación CVLP tipo 60 a transportistas) + `arca-client.service.ts` (integración AFIP SDK, CAE) + `arca-config.service.ts` + `liquidacion-pdf.service.ts`, con auditoría completa de cada request/response a AFIP en `ArcaLog`.

**Anulación de un CVLP (importante — no obvio):** AFIP **no** permite anular un CVLP (tipo 60) por web service con el código 065 (no existe en wsfev1 → error `11001`) ni con importes en negativo (error `10065`). Se anula emitiendo un comprobante **estándar asociado** (`CbtesAsoc`) al 060/061 original: Nota de Crédito (tipo **3** clase A / **8** clase B) o Nota de Débito (tipo **2** clase A / **7** clase B). La clase A/B sale de la condición IVA del transportista. El usuario elige NC o ND en el **modal de anulación** (no es config global); el backend lo recibe en el body (`AnularLiquidacionDto.tipoAnulacion`) y `getCbteTipoAnulacionCvlp(condicionIva, tipo)` mapea al código. Que NC vs ND sea lo fiscalmente correcto es decisión del contador del cliente (AFIP acepta ambos) — por eso es elegible por operación.

**Anulación con código 60 negativo — descartada por WS (probado exhaustivamente, ago 2026):** ARCA respondió por escrito a NyM (consulta N° 6637235) que el código 60 se anula "con el mismo comprobante pero con los importes con signo negativo". PERO eso no tiene canal técnico: (a) por web service, WSFEv1 rechaza cualquier total negativo con `10065` ("ImpTotal no puede ser menor a cero") y cualquier base de IVA ≤ 0 con `10020` ("BaseImp debe ser mayor a 0") — probado con tipos 60/63/64, Concepto 1 y 2, con y sin `CbtesAsoc`, y con total 0; son validaciones de campo, transversales y iguales en homologación y producción (no probar en producción: no cambia y gasta un comprobante real); (b) en "Comprobantes en Línea" el código 60 ni siquiera se puede emitir. Por eso NyM necesita el sistema, y por eso la NC/ND asociada es la única vía por WS. Follow-up técnico enviado a sri@arca.gob.ar (soporte de negocio de web services) pendiente de respuesta para confirmar si hay un método de WS que no conocemos o si la NC/ND es la vía aceptada. **Respaldo técnico (no definitivo):** el manual oficial de WSFEv1 (COMPG) confirma que todos los campos de importe deben ser ≥ 0 (no hay negativos) y que la anulación/ajuste de un comprobante clase A se hace "mediante una Nota de Crédito" asociada, con importes positivos (validaciones 10234 y 10237) — o sea, respalda la vía NC/ND que implementamos. **Jerarquía a tener en cuenta:** por sobre el manual general pesa la **respuesta oficial escrita de ARCA al CUIT de NyM** (consulta 6637235), que indica código 60 negativo; ante una eventual inspección vale lo respondido al contribuyente. Por eso, hasta que sri@arca.gob.ar aclare el "cómo técnico", la NC/ND se trata como **provisoria** y la decisión final la valida el contador de NyM.

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

  Los 5 processors (`clientes`, `transportistas`, `choferes`, `vehiculos`, `viajes`) implementan ambos métodos — si se agrega un módulo nuevo, replicar el patrón (`insert()` nunca devuelve solo un `string`, siempre `InsertResult`, para que el resumen final tenga el desglose exacto de creados/actualizados).
- **Flujo de dos fases**: `POST /importaciones/preview` (sube el Excel, valida, arma `PreviewResult`, no escribe nada de negocio — solo la `ImportSession` de staging) → `POST /importaciones/confirm` (recibe `sessionId` + confirmaciones pendientes, corre `processor.insert()` fila por fila, arma `ImportLog`). El frontend llama a estos dos endpoints **una vez por módulo**, en orden de dependencia (`clientes → transportistas → choferes → vehiculos → viajes`) — no hay una sesión "encadenada" en el backend, cada módulo es una `ImportSession` independiente.

#### `warnIfEmpty` — campos recomendados pero no bloqueantes

`ColumnConfig.warnIfEmpty` (hoy: `idFiscal`/`pais` en `clientes` y `transportistas`, ver `template-catalogo.ts`) marca un campo como "recomendado, no obligatorio": si la celda viene vacía, la fila se importa igual, pero se junta en `PreviewResult.advertenciasCamposFaltantes` y `confirm()` la rechaza salvo que el usuario confirme explícitamente (`ConfirmImportDto.confirmarCamposFaltantes`) — el frontend re-valida esto también server-side, no confía solo en el checkbox de UI. **El mismo criterio de "CUIT/país opcional con confirmación" aplica a la carga manual** (no solo import): `CreateClienteDto`/`UpdateClienteDto` y sus equivalentes de Transportista tienen `idFiscal`/`pais` como `@IsOptional()` + un flag `confirmarSinDatosFiscales?: boolean` que `ClientesService`/`TransportistasService` exigen en `assertXRequiredFields` cuando falta el dato fiscal — mismo patrón de "advertencia + checkbox de confirmación" en ambos lugares, no lo dupliques con una regla nueva si se agrega otro campo opcional-mostrado-como-advertencia.

#### Sugerencia de template con IA — dos proveedores (`ia-template-suggestion.service.ts`)

Gemini como proveedor primario, **Groq como fallback automático** si Gemini falla (ambos con retry+backoff, `fetchConReintentos`). Devuelve `{proveedor, modelo, sheet, headerRow, columnas, headersNoUsados}` — además del mapeo de columnas, detecta la hoja y la fila de encabezados a partir de `ParserService.sampleWorkbook()`. Requiere `GROQ_API_KEY` en `.env` (agregar a la lista de variables de entorno del proyecto si se documenta ahí formalmente). **Modelo Groq**: `openai/gpt-oss-120b` — `llama-3.3-70b-versatile` quedó deprecado por Groq el 16/08/26; si Groq vuelve a devolver 404 en el futuro, es señal de otro modelo deprecado, no un bug del código (verificar contra la doc de deprecaciones de Groq antes de tocar el service).

#### Viajes — lo más particular del motor

- **Matching de fila existente** (`ViajesProcessor.resolverFilasExistentes`, devuelve `Map<fila, viajeId>`): primero por `numeroIdentificacionPersonalizado` (único por tenant a nivel DB, `@@unique([tenantId, numeroIdentificacionPersonalizado])`); si no hay match, fallback a clave compuesta `(clienteId, transportistaId, origen, destino, fechaCarga, fechaDescarga)` (origen/destino comparados case-insensitive). **No hay constraint de DB que garantice unicidad de esta clave compuesta** — es solo el criterio que usa el import para decidir alta vs. actualización; si dos filas de Excel distintas coinciden en los 6 campos, la segunda actualiza a la primera en vez de crear un viaje nuevo (comportamiento esperado, no un bug).
- **Normalización de ciudades**: el motor NO valida `origen`/`destino` contra un catálogo en el backend — la resolución de ciudad ambigua ocurre 100% en el frontend (`vialto-frontend/src/lib/importacionViajesCiudades.ts`) contra un catálogo externo, antes de llamar a `confirm()`. El backend solo recibe `ConfirmImportDto.ciudadesNormalizadas` (overrides de texto por fila) y `filasExcluidas` (filas que el usuario decidió no importar, ej. destino multidestino tipo "PARANA+RAFAELA+CORDOBA" que nunca va a resolver a una sola ciudad).
- **Reutilización de Factura en vez de duplicarla** (`ViajesProcessor.create()`): si varias filas nuevas del mismo import comparten `nroFactura` para el mismo cliente, o si ya existe una `Factura` con ese `(tenantId, tipo:'cliente', numero, clienteId)`, el import **no crea una Factura nueva por cada viaje** — reutiliza la existente y suma el `importe`. Esto solo corre si el usuario confirmó explícitamente (`detectarFacturasDuplicadas()` + `ConfirmImportDto.confirmarFacturasDuplicadas`) — sin confirmación, `confirm()` rechaza con `BadRequestException`. Bug real corregido ago 2026: antes se creaba una `Factura` nueva por cada fila con `nroFactura`, aunque varias compartieran número.
- **Guard de protección fiscal** (`ViajesProcessor.update()`, preexistente, **no es un bug**): si el viaje ya tiene `facturacionEstado`/`liquidacionEstado` que indica que ya fue facturado/liquidado, `update()` tira error en vez de pisar los datos en un reimport — protege comprobantes fiscales ya emitidos de sobrescritura silenciosa. Si un reimport masivo reporta "N con error" contra viajes de test previos, verificar primero `SELECT "facturacionEstado", count(*) FROM viajes WHERE "tenantId" = '...' GROUP BY 1` antes de asumir una regresión.
- **Patente compuesta en Vehículos** (`VehiculosProcessor`): una celda tipo `"AC359ES/LHT523"` (tractor + semirremolque) se separa por `/` y crea/actualiza **dos** `Vehiculo` distintos (posición 0 = tractor, posición 1 = semirremolque) — antes se guardaba como un único vehículo inválido con la patente compuesta literal. Mismo criterio de split que ya usa el lookup `vehiculoId` de Viajes (`multiple: true, separador: "/"`).
- **Diff "antes/después" para el preview** (`ViajesProcessor.obtenerEstadoActual()` + `ImportacionesService.compararCamposViaje()`): para cada fila que va a actualizar un viaje existente, el preview trae el estado actual de BD (con nombres de cliente/transportista/chofer/patente ya resueltos) y arma `PreviewViaje.cambios: PreviewCambioCampo[]` (`{campo, antes, despues}`), solo con los campos que realmente cambian. `PreviewViaje.nuevo` distingue alta vs. actualización. El frontend lo consume en el modal "Ver cambios" — ver `vialto-frontend/CLAUDE.md`.
- **Desglose nuevas vs. actualizadas** (`PreviewResult.entidadesNuevas`/`entidadesActualizadas`, vía `IImportProcessor.contarExistentes()`): antes el preview siempre decía "N a crear" aunque la mayoría de las filas fueran a actualizar un registro ya existente (el processor hace upsert por nombre/patente/clave compuesta) — ahora se distingue.

#### `GET /importaciones/tenant-tiene-datos` — para el selector de módulos del wizard

`ImportacionesService.tenantTieneDatos(tenantId)` cuenta (`count()`, no trae filas) si el tenant ya tiene algún `Cliente`/`Transportista`/`Chofer`/`Vehiculo` cargado. El wizard del frontend lo usa para decidir si arranca directo con la secuencia completa (tenant nuevo, sin nada cargado) o si primero deja elegir qué módulos importar (tenant con datos existentes, para no forzar un recorrido completo). Endpoint liviano, sin relación con `preview`/`confirm`.

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
- **Un evaluator por tipo** (`evaluators/`, interfaz `NotificacionEvaluator.evaluar(tenantId): Promise<NotificacionItem[]>`) — solo lee, nunca escribe ni decide envío/dedup; eso lo hace `NotificacionesCronService`. Para sumar un tipo nuevo: agregar la entrada al catálogo + un evaluator que implemente la interfaz + registrarlo en el array `evaluators` del constructor de `NotificacionesCronService`.
- **Dedup por entidad, no por corrida**: antes de enviar, el cron filtra los candidatos de `evaluar()` contra `NotificacionEnvio` (`tenantId + tipo + entidadId`) — una factura que sigue "por vencer" tres corridas seguidas del cron solo genera un email la primera vez. El email agrupa todos los ítems nuevos de un mismo tipo en un solo mensaje (no uno por entidad).
- **Destinatarios = admins de Clerk, no una lista propia**: `resolverDestinatarios()` llama `UsersService.listByTenant(tenantId)` (por eso `UsersModule` ahora exporta `UsersService` — antes solo lo usaba su propio controller) y filtra por `role === 'org:admin'` con email. Sin admins con email, el tipo se skipea con un log — no hay tabla de destinatarios propia del módulo.
- **`ResendEmailService`** (`shared/email/`) nunca rompe el flujo que lo llama: sin `RESEND_API_KEY` configurada, loguea y no envía (útil en dev/homologación sin cuenta de Resend armada) — ver variables de entorno más abajo.
- **Config por tenant** (`NotificacionesConfigService`, patrón calcado de `tenant-field-config`: catálogo en código + tabla de overrides, `overrides[tipo]?.activo ?? item.defaultActivo`): `GET /notificaciones/config` (catálogo efectivo filtrado por módulos del tenant) y `POST /notificaciones/config/toggle` — ambos `@Roles('admin', ...)`, sin `tenantId` en el request (viene del token, regla de siempre). `POST /notificaciones/ejecutar?tenantId=...` es `@Roles('superadmin')` — corre la evaluación de un tenant puntual fuera del horario del cron, para operar/testear sin esperar al día siguiente (único endpoint del módulo que lee `tenantId` de la query, y solo porque está gateado a superadmin).
- **Frontend**: `pages/ConfiguracionNotificacionesTenantPage.tsx` (`/configuracion/notificaciones`, tenant-admin) — lista el catálogo agrupado por módulo con un toggle on/off por tipo, guardado inmediato al tocar el switch (mismo patrón que `CamposEmpresaPage.tsx`, sin botón "Guardar" aparte). Acepta `tenantId?`/`embeddedInSuperadmin?` como prop (mismo componente reusado, no duplicado — patrón Facturación/Viajes) y arma sus 4 URLs (`config`, `config/toggle`, `config/destinatarios`, `/api/users`→`/api/platform/users`) con `?tenantId=` cuando viene seteado. **Pantalla superadmin (ago 2026)**: `pages/SuperadminNotificacionesPage.tsx` (`/superadmin/notificaciones`) — selector de tenant (`EmpresaFilterBar` + `useTenantsList`/`useTenantFiltroUrl`, mismo patrón que `campos-empresa`) que monta `ConfiguracionNotificacionesTenantPage` con el tenant elegido. El controller (`getConfig`/`toggle`/`setDestinatarios`) resuelve el tenant efectivo con `resolveTenantId(auth, tenantId)` (override solo si `auth.role === 'superadmin'`, mismo helper que `importaciones.controller.ts`) — no se creó un controller `/platform/notificaciones` nuevo, se extendió el mismo endpoint de siempre.

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

## Clientes actuales y estado

| Cliente | Estado | Módulos contratados | Prioridad |
|---|---|---|---|
| Bressan | ✅ Activo (stack viejo) | combustible | Migrar a Vialto en el futuro |
| Sebastián Fernández | ✅ Cerrado | viajes | 1 — construir ya |
| Matías Riedel | ✅ Activo | stock, cuenta-corriente | 2 |
| Melisa (Desagotes) | ⏳ Muy probable | remitos (⚠️ a reconstruir, ver sección "`remitos` — eliminado"), cuenta-corriente | 3 |
| Marcos Venturini (NyM Logística) | ⏳ Presupuesto enviado | integracion-arca, viajes | 4 |
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
  → módulo: integracion-arca (carpeta src/modules/liquidaciones-arca/) — ✅ implementado
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

# Módulo notificaciones (alertas por email vía Resend) — sin RESEND_API_KEY el cron
# sigue corriendo pero solo loguea, no envía nada (ver ResendEmailService)
RESEND_API_KEY=                   # API key de Resend (resend.com)
RESEND_FROM_EMAIL=                # remitente, ej. "Vialto <notificaciones@vialto.app>" — default hardcodeado si se omite

# Futuro — Stripe para billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

---

*Última actualización: agosto 2026 (módulos `remitos`, `reportes` y `turnos` eliminados por completo — código, y en el caso de `remitos` también su modelo Prisma vía migración `20260828164256_drop_remito_module` — y sus slugs sacados de `VIALTO_MODULES`; ningún tenant real los tenía contratados y ninguno tenía frontend que los consumiera (`turnos` era un stub sin modelo ni service, para un cliente — Pereyra — que sigue "🔲 Pendiente"). Ver secciones "`remitos` — eliminado", nota de "`turnos`" arriba, y las notas de Fase 3/Fase 7/Fase 8 del roadmap; y, de la misma pasada, módulo `notificaciones` nuevo — alertas por email vía Resend, catálogo en código + config on/off por tenant calcada de `tenant-field-config`, cron diario agrupado por tipo con dedup por entidad, destinatarios = admins de Clerk del tenant, ver sección "`notificaciones` — alertas por email vía Resend"; y, de una pasada anterior, `precioTransportistaIvaIncluidoPct` pasó a ser opt-in vía `core/tenant-field-config` — `defaultVisible: false`, oculto por defecto para todo tenant; si un tenant lo deshabilita después de haberlo usado, los valores cargados NO se borran pero se ignoran en todo cálculo hasta reactivarlo, ver sección "`core/tenant-field-config` — visibilidad de campos y features opt-in por tenant"; y, de la misma pasada, `Viaje.precioTransportistaIvaIncluidoPct` — rediseño v3 "engrosar": el precio del viaje siempre fue neto/sin IVA, el % ahora se SUMA por encima al calcular cuánto se paga en efectivo (`engrosarConIva` en `viaje-ganancia-bruta.util.ts`), en vez de "netear"/descontarlo como hacía la v2 descartada; corrige un caso real de cliente (LSF) donde la ganancia bruta automática mostraba una ganancia falsa por no contemplar el IVA que se le paga al transportista; la Liquidación/CVLP vuelve a su comportamiento de siempre (sin ajuste por este %, sin exclusión ni validación de % mixto); lock angosto por `liquidacionEstado` distinto del resto de `CAMPOS_FISCALES_VIAJE`; y resumen real + badge de liquidación reusado en `ViajeEditModal.tsx` cuando el viaje tiene liquidación vigente; y, de una pasada anterior, motor de importaciones — sugerencia IA con fallback Groq, `warnIfEmpty`/CUIT-país opcional, `InsertResult` con desglose creados/actualizados, dedup de Factura por `nroFactura`, split de patente compuesta en Vehículos, diff antes/después de Viajes, endpoint `tenant-tiene-datos`; y, de una pasada anterior a esa, rediseño de estados de Viaje en 3 indicadores independientes — etapa/facturación/liquidación —, split de estado de Factura en ciclo de vida + cobrado/vencida, y `Factura.ambiente`)*
*Desarrollado por Elias N. Capasso — CapassoTech / Vialto*
