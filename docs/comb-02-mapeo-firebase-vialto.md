# COMB-02-T1 — Mapeo Firebase → Vialto (combustible)

Fuente de verdad para la migración de cargas de combustible desde Firestore (Bressan legacy) hacia PostgreSQL de Vialto.

Implementación de referencia: `scripts/migrate-bressan-cargas.ts`

---

## Campos directos

| Firebase (`cargas`) | Vialto (`cargas_combustible`) | Transformación |
|---|---|---|
| `empresaId` | `tenantId` | Lookup por `clerkOrgId` o por nombre del tenant |
| `serviceStation` | `estacion` | Directo; vacío → `"OTRA"` |
| `totalAmount` | `importe` | `Number(value) \|\| 0` |
| `liters` | `litros` | `Number(value) \|\| 0` |
| `kilometers` | `km` | `Math.round(Number(value))`. Valores > 2.147.483.647 (INT4 max) → `0` con warning (datos corruptos) |
| `date` | `fecha` | Firestore `Timestamp.toDate()`, `Date`, o `new Date(string)` |
| `paymentMethod` | `formaPago` | Directo; ausente → `null` |

---

## Campos con resolución indirecta

| Firebase | Vialto | Regla |
|---|---|---|
| `licensePlate` | `vehiculoId` | Buscar vehículo por patente (case-insensitive, sin espacios). **Si no existe → crear** con `tipo='otro'`, `marca/modelo/anio/transportistaId = null`, `kmActual = 0` |
| `driverDni` | `choferId` | Buscar chofer por DNI dentro del tenant. **Si no existe → crear** con `nombre = driverName`, `dni = driverDni`, PIN desde `usuarios.pass` (hasheado con `hashPin()`) si existe, resto `null`. Si `driverDni` está vacío → `choferId = null` |
| `driverName` | *(sin campo)* | Solo se usa para poblar `nombre` al crear un chofer nuevo. No se persiste en `CargaCombustible` |

---

## Campo `createdBy`

```
createdBy = choferId ?? "migration-bressan"
```

Si la carga tiene chofer resuelto → usa su ID. Si no → string literal que identifica el proceso de migración.

---

## Deduplicación

Antes de insertar se verifica la combinación: `tenantId + vehiculoId + litros + km + fecha (mismo día UTC)`.
Si ya existe un registro con esa combinación → saltar sin error (idempotente).

---

## Casos edge

| Caso | Decisión |
|---|---|
| `liters = 0` o `totalAmount = 0` | Se migra igual (puede ser registro incompleto; se preserva) |
| `empresaId` no mapea a ningún tenant | Error fatal — detener la migración |
| `date` inválida o nula | Usar fecha de migración (`new Date()`) con warning en log |
| `km` > 2.147.483.647 | Guardar `0` con warning (valor fuera de rango INT4, dato corrupto) |
| Chofer sin DNI | `choferId = null`, la carga se migra sin chofer asociado |

---

## PINs de choferes

Durante la migración se leen los PINs desde la colección `usuarios` de Firestore (campo `pass`):

- Chofer **nuevo** sin pass en Firestore → se crea sin PIN (`pin = null`)
- Chofer **nuevo** con pass en Firestore → se crea con `pin = hashPin(pass)`
- Chofer **existente** sin PIN en Vialto + pass en Firestore → se actualiza con `hashPin(pass)`
- Chofer **existente** ya con PIN → no se toca

Los PINs se hashean con `scryptSync` (ver `src/shared/util/pin-hash.ts`). El valor original de 4 dígitos nunca se almacena.
