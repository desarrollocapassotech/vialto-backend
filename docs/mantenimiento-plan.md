# Módulo Mantenimiento de Flota — MVP

> **Fuente de verdad del módulo `mantenimiento`.** Al cerrar cada ticket se marca como hecho
> en la sección "Estado de los tickets". Las decisiones de la sección 1 no se rediscuten.
>
> Creado: 2026-10-05.

## Estado de los tickets

| Ticket | Tarea | Estado | Rama / PR | Notas |
|---|---|---|---|---|
| MANT-01 | T1 — Reemplazar `Intervencion` por los modelos nuevos | ✅ Hecho (2026-10-05) | `develop` | Migración `20261005130000_mantenimiento_ordenes_trabajo` aplicada en QA (count previo en QA: 1 fila de prueba de LSF). Incluye `OrdenTrabajoSecuencia` y triggers de defensa multi-tenant. Módulo sin endpoints hasta MANT-02; front de Mantenimiento roto solo en QA hasta MANT-04 → no mergear a `main` antes. |
| MANT-01 | T2 — Edición de km a `core/vehiculos` | ✅ Hecho (2026-10-05) | `develop` | `VehiculosService.editarKm`/`getHistorialKm` + `POST vehiculos/:id/km` y `GET vehiculos/:id/km-historial` en core (`?tenantId=` solo superadmin). Combustible delega sin cambiar contrato. `update` del CRUD/import/platform registra `VehiculoKmEdicion` solo si el km cambia. Test: `npm run test:vehiculos-km`. Antes de T2 se cerró un agujero cross-tenant en `/platform` (`PlatformTenantAccessGuard`). |
| MANT-01 | T3 — `core/odometro` | ✅ Hecho (2026-10-05) | `develop` | `OdometroService` (+ versiones por lote `getUltimasLecturas`/`getKmPorDiaMuchos` para MANT-02-T5) y funciones puras en `odometro.util.ts`. Empate del mismo día: carga vs carga por hora real; fuentes distintas por `createdAt` (ediciones y OT van a las 00:00 UTC). Fallback `'vehiculo'` usa `Vehiculo.createdAt` como fecha. Test: `npm run test:odometro`. Verificado contra QA (Bressan, 18 vehículos en 7 queries). |
| MANT-01 | T4 — `vencimiento.util.ts` | ✅ Hecho (2026-10-05) | `develop` | `calcularVencimiento` + `elegirReferencia` (puras). Test: `npm run test:vencimiento` (27 casos). **MANT-01 cerrado.** |
| MANT-02 | T1 — Planes + plantillas | ✅ Hecho (2026-10-05) | `develop` | `PlanesService` + rutas `mantenimiento/planes` (CRUD) y `planes/plantillas`. Plantillas **sin tipo de vehículo** y **sin aviso por defecto** donde la spec no lo trae (decisiones de Elias). Reglas: ≥1 intervalo, aviso < intervalo y con su intervalo, mecánico ≥1 tarea; nombre único por tenant sin distinguir mayúsculas; DELETE solo sin asignaciones (si no, desactivar). Test: `npm run test:mant-planes`. |
| MANT-02 | T2 — Asignación plan ↔ vehículo | ✅ Hecho (2026-10-05) | `develop` | `AsignacionesService`. `POST planes/:id/vehiculos` acepta **base común** (`vehiculoIds`+`baseKm`/`baseFecha`) **o base por unidad** (`vehiculos: [...]`); las asignaciones desactivadas se **reactivan** (decisiones de Elias). Agregados: `GET planes/:id/vehiculos` y `GET vehiculos/:id/planes` (los necesita MANT-04). `baseFecha` a 00:00 UTC y no futura. DELETE solo si ninguna OT la cumplió. Test: `npm run test:mant-asignaciones`. |
| MANT-02 | T3 — Talleres | ✅ Hecho (2026-10-05) | `develop` | `TalleresService` + CRUD `mantenimiento/talleres`. Nombre único por tenant sin distinguir mayúsculas; CUIT opcional, guardado solo con dígitos y con dígito verificador válido (sin consultar ARCA); `interno` no se expone. DELETE solo sin OT (si no, desactivar). Test: `npm run test:mant-talleres`. |
| MANT-02 | T4 — Órdenes de trabajo | ✅ Hecho (2026-10-05) | `develop` | `OrdenesService` + `ordenes.util.ts`. Rutas `mantenimiento/ordenes` (paginado, CRUD, `:id/anular`, `adjuntos`). Número por secuencia; total = Σ ítems calculado en el backend; planes solo de la misma unidad (`origen = plan`). Anulada: no se edita y sale del odómetro y de los vencimientos; DELETE solo sin planes. Adjuntos solo de `vialto/mantenimiento/{tenantId}` en nuestro Cloudinary. `warning` de km: retroceso vs lecturas vecinas **y** salto > 5.000 km desde la anterior; **fecha futura permitida** (decisiones de Elias). Test: `npm run test:mant-ordenes`. |
| MANT-02 | T5 — Vencimientos | ✅ Hecho (2026-10-05) | `develop` | `VencimientosService.calcular` (reemplaza al `MantenimientoService` vacío) + `vencimientos.util.ts`. `GET vencimientos` y `GET vencimientos/resumen`. Solo asignaciones, planes y unidades activas. Cantidad fija de queries (8 en QA con Bressan). `referencia.id` (id de OT o `base`) queda listo para el entidadId de MANT-03. Test: `npm run test:mant-vencimientos`. |
| MANT-02 | T6 — Historial por vehículo | ✅ Hecho (2026-10-05) | `develop` | `HistorialService` + `historial.util.ts`. `GET vehiculos/:id/historial?desde&hasta`: OT (incluidas anuladas) + lecturas (sin duplicar las de OT), más reciente primero; trae también el odómetro actual. Test: `npm run test:mant-historial`. **MANT-02 cerrado (26 rutas).** |
| MANT-03 | T1 — Tipos en el catálogo de notificaciones | ✅ Hecho (2026-10-05) | `develop` | `mantenimiento.vencimientoProximo` y `mantenimiento.vencido` (diarios, requiereModulo mantenimiento, activos por defecto, botón a `/mantenimiento`). |
| MANT-03 | T2 — Evaluators | ✅ Hecho (2026-10-05) | `develop` | **Opción C (decisión de Elias):** `NotificacionesCronService.registrarEvaluator` + evaluators en `modules/mantenimiento/notificaciones/` que reusan `VencimientosService.calcular`. `entidadId = vehiculoPlanId:idReferencia`. Excepción a la regla 5 documentada en CLAUDE.md. Probado en QA: 3 avisos, dedup en la 2ª corrida, sin repetir tras OT/anulación. Test: `npm run test:mant-avisos`. |
| MANT-03 | T3 — Bloque en "Resumen de alertas" | 🔲 Pendiente | | |
| MANT-04 | T1 — Pestaña Vencimientos | 🔲 Pendiente | | |
| MANT-04 | T2 — Pestaña Órdenes de trabajo | 🔲 Pendiente | | |
| MANT-04 | T3 — Pestaña Planes + asignación | 🔲 Pendiente | | |
| MANT-04 | T4 — Historial del vehículo + "Actualizar km" | 🔲 Pendiente | | |
| MANT-04 | T5 — Upsell Combustible | 🔲 Pendiente | | |
| MANT-04 | T6 — Dashboard | 🔲 Pendiente | | |
| MANT-05 | T1 — Documentación | 🔲 Pendiente | | |
| MANT-05 | T2 — Recorrido end-to-end en QA | 🔲 Pendiente | | |

---

## Para retomar (pausa del 2026-10-05)

**Dónde quedó:** backend completo hasta MANT-03-T2, todo en `develop` (último commit del módulo: `588fd91`). En QA no hay datos de prueba de mantenimiento (se limpió todo). Hay 16 scripts `test:*` en verde y `npm run build` también.

**Lo que existe hoy (backend):**
- `core/odometro` (lectura de km unificada) y `core/vehiculos` (`POST vehiculos/:id/km`, `GET vehiculos/:id/km-historial`).
- `modules/mantenimiento`: 26 rutas bajo `/api/mantenimiento` (planes + plantillas, asignaciones, talleres, órdenes de trabajo + adjuntos, vencimientos + resumen, historial por unidad) y los avisos diarios `mantenimiento.vencimientoProximo` / `mantenimiento.vencido`.

**Próximo paso: MANT-03-T3** (bloque de mantenimiento en el "Resumen de alertas" del dashboard). Criterio acordado con Elias, el mismo de la opción C: Mantenimiento le *entrega* su bloque al dashboard (registro desde `onModuleInit`, como `registrarEvaluator`), en vez de que `dashboard` importe Mantenimiento. Mirar `DashboardService` → `alertas` y el helper `sumarBloqueAlerta`.

**Después:** MANT-04 (frontend, reemplaza `MantenimientoTenantPage.tsx`, `IntervencionModal.tsx`, `MantenimientoAlertasSection.tsx`, `lib/mantenimientoAlertas.ts` y la métrica "Intervenciones (mes)" de `useTenantDashboardMetrics.ts`, que hoy pega a `/api/mantenimiento/intervenciones` y da 404 en QA) y MANT-05 (documentación + recorrido end-to-end).

**Contratos de la API que el front va a necesitar** (ya implementados, ver Swagger en `/docs`):
- Alta/edición de OT devuelve `{ ...orden, warning: string | null }`.
- Adjuntos: primero `POST mantenimiento/ordenes/adjuntos` (multipart `file`) → `{ url }`, después la URL va en `adjuntos`.
- Asignación masiva: `vehiculos: [{ vehiculoId, baseKm, baseFecha }]` para la tabla del onboarding.
- `GET vehiculos/:id/planes` alimenta los checkboxes de "planes que cumple" del modal de OT.
- Todas las rutas aceptan `?tenantId=` solo para superadmin (vista embebida).

**Pendientes antes de llevar a `main` / producción:**
1. **Nada de MANT-0x se mergea a `main` hasta cerrar MANT-04** (el front viejo de Mantenimiento queda roto sin la API vieja).
2. Contar las filas de `intervenciones` en producción antes del merge: la migración `20261005130000_mantenimiento_ordenes_trabajo` borra la tabla sin conservar los datos.
3. `develop` también lleva `20261005120000_combustible_error_log_origen` (no es de Mantenimiento) → se aplica en el mismo deploy.
4. Decidir si el arreglo de seguridad de `/api/platform` (commit `9d93071`, `PlatformTenantAccessGuard`) se lleva a `main` antes, por cherry-pick (no arrastra migraciones). Antes, una pasada por el front de QA en las pantallas de empresa que usan `/api/platform` (Viajes, Stock, Facturación, Liquidaciones, Combustible) y en Usuarios de superadmin.
5. A observar en QA: el aviso de km de las OT por "salto > 5.000 km" puede aparecer seguido en tenants sin Combustible (lecturas espaciadas). Si molesta, ajustarlo.
6. Ver un mail real de mantenimiento: `POST /notificaciones/ejecutar?tenantId=` desde Swagger con superadmin (parte de MANT-05-T2).

### Notas de implementación
- **Tests:** el backend no usa Jest; los `*.spec.ts` son scripts `ts-node` + `node:assert` con un `test:x` en `package.json` (ej. `test:padron`). Los tests de T3/T4 siguen ese patrón. No hay script `lint`: "lint en verde" = `npm run build`.
- **`prisma migrate dev` en QA volvió a funcionar (2026-10-05):** pedía reset por una fila vieja de `_prisma_migrations` (intento fallido y ya revertido de `20260831120000_intervencion_tipos_array`, otro checksum). Se borró esa fila con OK de Elias. Si vuelve a pasar algo parecido: **nunca resetear**; buscar filas con `finished_at IS NULL` y checksum distinto.

- **Reglas de vencimiento definidas al implementar T4 (2026-10-05, decididas con Elias):**
  - OT que cumple un plan pero no tiene km → el km de referencia es la última lectura del odómetro hasta la fecha de la OT (lo resuelve el service en MANT-02-T5 con `OdometroService.getLecturas(..., { hasta })`); sin lecturas, la parte por km queda sin datos.
  - Si km y fecha dan el mismo estado, el motivo es el que ocurre primero; sin proyección por km (sin km/día) gana `'km'`.
  - Sin `avisoKm`/`avisoDias` no hay estado "próximo" por esa dimensión. Proyección por km: `hoy + floor(kmRestantes / kmPorDia)` días.

## 0. Antes de empezar (obligatorio)
1. Leer `vialto-backend/CLAUDE.md`, `vialto-frontend/CLAUDE.md`, `vialto-backend/docs/reglas-multitenant.md` y `vialto-backend/MIGRATIONS.md`.
2. Este archivo es la fuente de verdad del módulo; al cerrar cada ticket se marca como hecho acá.
3. Las migraciones se crean y prueban SOLO en QA (`vialto-desarrollo`). Nunca tocar producción.
4. Toda query lleva `tenantId` según `reglas-multitenant.md`. Sin excepciones.

## 1. Decisiones tomadas (no se rediscuten)
- **Objetivo del MVP:** registrar lo que pasó (órdenes de trabajo) y avisar lo que viene (vencimientos por km y/o fecha). No gestiona el proceso del taller.
- **Funciona sin el módulo Combustible.** Si el tenant tiene Combustible, el km se actualiza solo con las cargas. Si no, con ediciones manuales de km y con el km de las OT. El módulo NO depende de `combustible` en el código.
- **`Intervencion` se elimina.** Nadie la usa en producción, así que no hay migración de datos. Antes del drop, verificar con `SELECT count(*) FROM intervenciones` en QA y avisar el resultado; producción la chequea Elias.
- **El catálogo de tareas** se mantiene como constante duplicada en front y back (mismo criterio que hoy). Renombrar `tipos-intervencion.const.ts` → `tareas-mantenimiento.const.ts` y su par en el frontend (`mantenimientoLabels.ts`).
- **Importes en `Float`**, igual que el resto del schema.
- **El odómetro NO es una tabla nueva:** es un servicio de lectura que une las fuentes existentes (sección 3).
- **El estado del semáforo se calcula al leer**, con una función pura. No se persiste. El cron solo manda mails.
- **Alertas:** sistema `notificaciones` existente (evaluators + Resend + campana). Nada de WhatsApp.
- **Previsto en el modelo pero SIN UI en el MVP:** horas de motor, estados intermedios de la OT, `productoId` (Stock), taller interno/externo.
- **Fuera del MVP:** inventario, neumáticos, flujo correctivo con reporte del chofer, checklist, telemetría, importación desde Excel.

## 2. Modelo de datos (Prisma)

```prisma
model PlanMantenimiento {
  id             String   @id @default(cuid())
  tenantId       String
  tenant         Tenant   @relation(fields: [tenantId], references: [clerkOrgId], onDelete: Cascade)
  nombre         String   // "Service 20.000 km", "VTV", "Póliza"
  categoria      String   // mecanico | documental
  tipoVehiculo   String?  // tractor | semirremolque | camion | utilitario | otro | null = cualquiera
  intervaloKm    Int?
  intervaloDias  Int?
  intervaloHoras Int?     // previsto, sin UI
  avisoKm        Int?     // anticipación del aviso
  avisoDias      Int?
  tareas         String[] // del catálogo; vacío permitido en documentales
  activo         Boolean  @default(true)
  createdAt      DateTime @default(now())
  createdBy      String
  vehiculos      VehiculoPlan[]
  @@index([tenantId])
  @@map("planes_mantenimiento")
}
// Regla: al menos uno de intervaloKm / intervaloDias.

model VehiculoPlan {          // asignación de un plan a una unidad + punto de partida
  id         String   @id @default(cuid())
  tenantId   String
  tenant     Tenant   @relation(fields: [tenantId], references: [clerkOrgId], onDelete: Cascade)
  vehiculoId String
  vehiculo   Vehiculo @relation(fields: [vehiculoId], references: [id], onDelete: Cascade)
  planId     String
  plan       PlanMantenimiento @relation(fields: [planId], references: [id], onDelete: Cascade)
  baseKm     Int?      // último service conocido al dar de alta (antes de usar Vialto)
  baseFecha  DateTime?
  activo     Boolean  @default(true)
  createdAt  DateTime @default(now())
  ordenes    OrdenTrabajoPlan[]
  @@unique([tenantId, vehiculoId, planId])
  @@index([tenantId, vehiculoId])
  @@map("vehiculos_planes")
}

model Taller {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [clerkOrgId], onDelete: Cascade)
  nombre    String
  cuit      String?
  telefono  String?
  interno   Boolean  @default(false) // previsto, sin UI
  activo    Boolean  @default(true)
  ordenes   OrdenTrabajo[]
  @@unique([tenantId, nombre])
  @@map("talleres")
}

model OrdenTrabajo {
  id            String    @id @default(cuid())
  tenantId      String
  tenant        Tenant    @relation(fields: [tenantId], references: [clerkOrgId], onDelete: Cascade)
  numero        Int       // secuencia por tenant
  vehiculoId    String
  vehiculo      Vehiculo  @relation(fields: [vehiculoId], references: [id], onDelete: Restrict)
  tipo          String    // preventivo | correctivo
  origen        String    @default("manual") // manual | plan | reporte_chofer (futuro)
  estado        String    @default("cerrada") // abierta | en_curso | cerrada | anulada — MVP solo cerrada/anulada
  tallerId      String?
  taller        Taller?   @relation(fields: [tallerId], references: [id], onDelete: SetNull)
  fecha         DateTime  // fecha del trabajo (sin hora, UTC)
  km            Int?
  horas         Float?    // previsto, sin UI
  tareas        String[]
  descripcion   String?
  costoTotal    Float     @default(0) // = suma de items, se recalcula en el service
  adjuntos      String[]  // URLs Cloudinary (factura, fotos)
  createdAt     DateTime  @default(now())
  createdBy     String
  items         OrdenTrabajoItem[]
  planes        OrdenTrabajoPlan[]
  @@unique([tenantId, numero])
  @@index([tenantId, vehiculoId, fecha])
  @@index([tenantId, estado])
  @@map("ordenes_trabajo")
}

model OrdenTrabajoItem {
  id            String       @id @default(cuid())
  tenantId      String
  ordenId       String
  orden         OrdenTrabajo @relation(fields: [ordenId], references: [id], onDelete: Cascade)
  tipo          String       @default("general") // general | mano_obra | repuesto | servicio_externo
  descripcion   String
  cantidad      Float        @default(1)
  costoUnitario Float
  subtotal      Float
  productoId    String?      // previsto (Stock, Fase 2), sin UI
  @@index([tenantId, ordenId])
  @@map("ordenes_trabajo_items")
}

model OrdenTrabajoPlan {      // qué planes "cumple" una OT (una OT puede cumplir varios)
  ordenId        String
  orden          OrdenTrabajo @relation(fields: [ordenId], references: [id], onDelete: Cascade)
  vehiculoPlanId String
  vehiculoPlan   VehiculoPlan @relation(fields: [vehiculoPlanId], references: [id], onDelete: Cascade)
  tenantId       String
  @@id([ordenId, vehiculoPlanId])
  @@index([tenantId, vehiculoPlanId])
  @@map("ordenes_trabajo_planes")
}
```

Para la secuencia de `numero`, copiar el patrón que ya existe (`ProductoSecuencia` / `StockRemitoSecuencia`).

## 3. Odómetro: `src/core/odometro/odometro.service.ts`
Servicio de solo lectura, sin tabla propia. Es el único lugar donde Mantenimiento (y en el futuro el CPK) lee km.
- `getLecturas(tenantId, vehiculoId, { desde?, hasta? })` → `{ km, fecha, fuente, fuenteId }[]` ordenadas por fecha (y por `createdAt` si empatan). Fuentes:
  - `CargaCombustible` con `sospechoso = false` → `fuente: 'carga'`
  - `VehiculoKmEdicion` → `'edicion'` (usa `kmNuevo`)
  - `OrdenTrabajo` con `estado = 'cerrada'` y `km` no nulo → `'orden_trabajo'`
- `getUltimaLectura(tenantId, vehiculoId)` → la más reciente por fecha. Si no hay ninguna, usa `Vehiculo.kmActual` con `fuente: 'vehiculo'`.
- `getKmPorDia(tenantId, vehiculoId)` → con las lecturas de los últimos 60 días: `(kmMax − kmMin) / días entre ellas`. Devuelve `null` si hay menos de 3 lecturas, si el rango es menor a 14 días o si el resultado es ≤ 0.
- Diseño: el campo `fuente` es abierto (`'telemetria'` en el futuro). Ningún consumidor tiene que saber de dónde viene el km.
- **No modificar** la validación de km de Combustible (`getLimitesCronologicos` / `assertKmNoRetroceso`). El km de una OT NO participa de esa validación.

## 4. Cálculo de vencimiento: función pura
Archivo: `src/modules/mantenimiento/vencimiento.util.ts`, con su `vencimiento.util.spec.ts` (Jest, como los `*.spec.ts` que ya existen).

```ts
calcularVencimiento({
  plan: { intervaloKm, intervaloDias, avisoKm, avisoDias },
  referencia: { km: number|null, fecha: Date|null } | null, // última OT cerrada que cumple el plan; si no hay, baseKm/baseFecha
  odometro: { km: number, fecha: Date } | null,
  kmPorDia: number | null,
  hoy: Date,
}) => {
  estado: 'ok' | 'proximo' | 'vencido' | 'sin_datos',
  proximoKm: number|null, kmRestantes: number|null,
  proximaFecha: Date|null, diasRestantes: number|null,
  fechaEstimada: Date|null,   // la más temprana entre proximaFecha y la proyección por km
  motivo: 'km' | 'fecha' | null, // qué disparó el estado
}
```

Reglas:
- `sin_datos`: no hay referencia, o el plan es por km y no hay km de referencia ni odómetro. Si el plan también tiene días y hay fecha de referencia, se evalúa por fecha.
- `proximoKm = ref.km + intervaloKm`; `kmRestantes = proximoKm − odometro.km`.
- `proximaFecha = ref.fecha + intervaloDias`.
- Proyección: si `kmPorDia` existe, `hoy + kmRestantes / kmPorDia`.
- `vencido` si `kmRestantes ≤ 0` o `hoy ≥ proximaFecha`.
- `proximo` si `kmRestantes ≤ avisoKm` o `diasRestantes ≤ avisoDias`.
- Si no, `ok`.
- Gana lo que ocurra primero.
- Fechas sin hora y en UTC, igual que el resto del sistema.

Tests mínimos: solo km, solo días, km y días (gana el primero), sin referencia, con base y sin OT, OT más nueva que la base, proyección sin `kmPorDia`, y odómetro menor que la referencia (km restantes mayor al intervalo: estado `ok`, sin explotar).

## 5. Tickets (en este orden)

### MANT-01 — Fundamentos de backend
- T1: Reemplazar `Intervencion` por los modelos de la sección 2 (con el chequeo de count previo). Migración en QA. Relaciones nuevas en `Vehiculo` y `Tenant`.
- T2: Mover la edición de km a core. Hoy `editarKmVehiculo` vive en Combustible (`POST combustible/vehiculos/:id/km`) y queda gateado por ese módulo. Pasar la lógica a `core/vehiculos` (mismo comportamiento: crea un `VehiculoKmEdicion`, sin fecha anterior a hoy) y dejar los endpoints de Combustible delegando ahí, sin cambiar su contrato. Exponer `POST vehiculos/:id/km` en core. Además, `vehiculos.service.ts` hoy pisa `kmActual` sin dejar registro (update del CRUD): hacer que pase por la misma lógica de edición para que quede en la línea de tiempo.
- T3: `core/odometro` (sección 3) con tests.
- T4: `vencimiento.util.ts` (sección 4) con tests.
- Criterio de aceptación: `npm run build` y tests en verde; Combustible se comporta igual (probar alta, edición y edición de km).

### MANT-02 — API de Mantenimiento
Patrón: el de los demás módulos (`ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard` + `@RequireModule('mantenimiento')`). Roles: lectura `admin|member|superadmin`, escritura `admin|superadmin`. Mismo manejo de superadmin con `?tenantId=` que usa hoy el módulo.
- T1, **planes:** CRUD de `PlanMantenimiento`. `POST planes/plantillas` crea las plantillas sugeridas (constante `PLANTILLAS_PLAN` en código, idempotente por nombre). Plantillas iniciales, editables por el cliente:
  - Tractor/camión: "Service motor (aceite + filtros)" 20.000 km / 180 días, aviso 2.000 km / 15 días; "Engrase de chasis" 10.000 km / 30 días; "Alineación y balanceo" 40.000 km.
  - Utilitario: "Service" 10.000 km / 365 días.
  - Semirremolque: "Revisión de frenos y quinta rueda / perno rey" 90 días; "Engrase" 30 días.
  - Documentales, cualquier tipo: "VTV/RTO" 365 días, aviso 30; "Póliza de seguro" 365 días, aviso 15; "RUTA" 365 días, aviso 30.
- T2, **asignación:** `POST planes/:id/vehiculos` con `{ vehiculoIds[], baseKm?, baseFecha? }` (alta masiva, ignora duplicados); `PATCH vehiculos-planes/:id` para base y activo; `DELETE vehiculos-planes/:id`.
- T3, **talleres:** CRUD simple.
- T4, **órdenes de trabajo:** CRUD. Al crear: `estado = 'cerrada'`, `numero` por secuencia, items (al menos uno, o ninguno si el costo es 0), `costoTotal` recalculado en el service, `vehiculoPlanIds[]` opcionales (validar que sean del mismo vehículo y tenant). Anular en vez de borrar si cumple planes. Adjuntos en Cloudinary con el mismo patrón que las fotos de Combustible. Si el km de la OT es inconsistente con las lecturas cercanas (`OdometroService`), devolver un `warning` en la respuesta, sin bloquear.
- T5, **vencimientos:** `GET vencimientos?vehiculoId=&estado=&categoria=` → una fila por `VehiculoPlan` activo con vehículo, plan, referencia usada, odómetro (km, fecha y fuente) y el resultado de `calcularVencimiento`, ordenado vencido → próximo → sin datos → ok. `GET vencimientos/resumen` → conteo por estado (para el dashboard). Evitar N+1: traer las lecturas de todos los vehículos del tenant en pocas queries.
- T6, **historial por vehículo:** `GET vehiculos/:id/historial` → OT y lecturas de odómetro en una sola línea de tiempo.
- Criterio de aceptación: probado con Swagger en QA, todas las queries con `tenantId`, endpoints documentados en Swagger.

### MANT-03 — Notificaciones
- T1: Dos tipos en `notificaciones-catalog.ts`: `mantenimiento.vencimientoProximo` y `mantenimiento.vencido` (diarios, `requiereModulo: 'mantenimiento'`, `defaultActivo: true`).
- T2: Sus evaluators, reusando el cálculo de MANT-02-T5 (no duplicar lógica). `entidadId = ${vehiculoPlanId}:${idReferencia}`, donde `idReferencia` es el id de la última OT que cumple el plan, o `'base'`. Así se avisa una vez por ciclo y por estado, y cuando se registra el service siguiente se vuelve a avisar en el ciclo nuevo.
- T3: Bloque de mantenimiento en el "Resumen de alertas" del dashboard (`DashboardService` → `alertas`, helper `sumarBloqueAlerta`), como pide `CLAUDE.md`.

### MANT-04 — Frontend
Seguir `vialto-frontend/CLAUDE.md` (VER + modal read-only → EDITAR, breadcrumb, fechas UTC, errores por campo, `CrudInput`/`CrudSelect`, badges, prop `tenantId?`/`embeddedInSuperadmin?`). Reemplazar `MantenimientoTenantPage.tsx`, `IntervencionModal.tsx`, `MantenimientoAlertasSection.tsx` y `lib/mantenimientoAlertas.ts` (el cálculo pasa al backend).
- T1, **pestaña "Vencimientos"** (la default): semáforo por unidad y plan, con filtros (estado, vehículo, mecánico/documental). Cada fila muestra "faltan X km / Y días" y la fecha estimada, con el origen del km ("última carga de combustible 12/09", "edición manual", etc.). Desde la fila, un botón **"Registrar service"** abre el alta de OT precargada (vehículo, plan tildado, tareas del plan, km actual).
- T2, **pestaña "Órdenes de trabajo":** grilla con filtros (vehículo, fecha, tipo, taller); modal de alta y edición con vehículo, tipo, fecha, km, taller (con alta rápida), tareas del catálogo, planes que cumple (checkboxes de los planes del vehículo), líneas de costo libres (descripción + importe; el total se calcula), adjuntos y descripción. Mostrar el `warning` de km inconsistente si llega.
- T3, **pestaña "Planes":** CRUD, botón "Cargar plantillas sugeridas" y una pantalla de asignación: elegir el plan, ver los vehículos del tipo correspondiente preseleccionados, y una tabla editable con km y fecha del último service por vehículo (es el "alta rápida" del onboarding).
- T4, **historial del vehículo:** modal o pestaña con OT y lecturas. Botón "Actualizar km" que pega a `POST vehiculos/:id/km` de core (disponible aunque el tenant no tenga Combustible).
- T5, **upsell:** si el tenant no tiene `combustible`, un aviso fijo en Vencimientos: "Activá Control de Combustible y los km de tus unidades se actualizan solos con cada carga".
- T6, **dashboard:** pestaña de Mantenimiento en el panel del tenant (patrón "Al agregar el dashboard de un módulo nuevo") con contadores por estado y los próximos 5 vencimientos.

### MANT-05 — Cierre
- T1: Actualizar la sección `mantenimiento` de `vialto-backend/CLAUDE.md` (sacar la parte de Firestore y el checklist, documentar modelos, odómetro, cálculo y notificaciones) y la de `vialto-frontend/CLAUDE.md`. Actualizar `reglas-multitenant.md` → "Trampas por módulo / Mantenimiento".
- T2: Recorrido end-to-end en QA con dos tenants: uno con Combustible y otro sin. Checklist: crear plantillas → asignar con base → ver el semáforo → registrar una OT desde una fila → el estado vuelve a `ok` → correr `POST /notificaciones/ejecutar?tenantId=` y verificar que el mail no se duplica en una segunda corrida.

## 6. Reglas de trabajo
- **Se trabaja directo sobre `develop`** (decisión de Elias, 2026-10-05): sin ramas por ticket ni PR intermedios; commit por tarea y push a `develop`. Nada se mergea a `main` hasta cerrar MANT-04. Backend primero, frontend después.
- Ante una duda de producto, preguntar. No inventar reglas de negocio.
- No tocar Combustible salvo lo indicado en MANT-01-T2.
- Al final de cada ticket: build, tests y lint en verde, y un resumen de qué cambió y qué se probó.
- Trabajo en plan mode, de a un ticket por vez, con OK explícito antes de pasar al siguiente.
