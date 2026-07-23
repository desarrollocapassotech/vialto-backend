# Reglas de consultas seguras (multi-tenant)

> **Este es el ÚNICO archivo fuente de estas reglas.**
> `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/multitenant.mdc` y `.github/copilot-instructions.md`
> apuntan acá. Si hay que cambiar algo, se cambia SOLO en este archivo.
>
> Estado: **borrador inicial** — creado en el Ticket 1 del epic de aislamiento multi-tenant.
> Cada ticket de módulo completa su sección de "Trampas por módulo" al final.

---

## Por qué existe esto

Vialto usa una sola base de datos para todas las empresas cliente. Cada empresa se
identifica con un `tenantId`. La regla que sostiene todo el sistema es simple:

> **Ninguna empresa puede ver, modificar ni borrar datos de otra.**

Para que eso se cumpla, **toda** consulta a la base tiene que filtrar por `tenantId`.
Si una sola consulta se olvida el filtro, se abre una fuga de datos entre empresas —el
peor bug posible del producto—. Este archivo define cómo se escribe una consulta segura,
para que cualquier programador (o IA) que toque el código lo haga bien sin tener que
adivinar.

---

## Las 6 reglas absolutas

1. **Toda consulta lleva `where: { tenantId }`.** Listados, búsquedas, updates, deletes,
   conteos y agregaciones. Sin excepción.
2. **El `tenantId` sale siempre del token de sesión, nunca del request.** Se toma de
   `req.auth` / `@CurrentTenant()`. Nunca de un campo del body, de un query param ni de
   nada que mande el cliente.
3. **Buscar por ID no alcanza: hay que validar pertenencia.** Un `id` es único global; no
   garantiza que el registro sea de la empresa logueada. Siempre se combina `id` + `tenantId`.
4. **Modificar y borrar por ID también filtra por `tenantId`.** Un update/delete que solo
   matchea por `id` puede pisar datos de otra empresa.
5. **Las tablas hijas también filtran.** Al leer o modificar registros relacionados
   (renglones, detalles, movimientos), cada uno lleva su propio filtro por empresa.
6. **En agregaciones cross-tabla, filtran TODAS las tablas.** Basta que una sola sume sin
   filtrar para contaminar el resultado.

---

## Los moldes correctos (copiar de acá)

Ejemplos con Prisma + NestJS, como se usa en este backend.

### Listar / buscar varios
```ts
// BIEN
this.prisma.viaje.findMany({ where: { tenantId, estado: 'en_curso' } });

// MAL — trae datos de todas las empresas
this.prisma.viaje.findMany({ where: { estado: 'en_curso' } });
```

### Buscar por ID (validando pertenencia)
`findUnique` por `id` NO admite `tenantId` en el where si `id` es la única clave única,
así que se usa `findFirst` con ambos:
```ts
// BIEN
const viaje = await this.prisma.viaje.findFirst({ where: { id, tenantId } });
if (!viaje) throw new NotFoundException();

// MAL — devuelve el registro sea de la empresa que sea
const viaje = await this.prisma.viaje.findUnique({ where: { id } });
```

### Modificar por ID
```ts
// BIEN — updateMany permite filtrar por tenantId; si count === 0, no era de la empresa
const { count } = await this.prisma.viaje.updateMany({
  where: { id, tenantId },
  data: { estado: 'finalizado' },
});
if (count === 0) throw new NotFoundException();

// MAL — puede modificar un viaje de otra empresa
await this.prisma.viaje.update({ where: { id }, data: { estado: 'finalizado' } });
```

### Borrar por ID
```ts
// BIEN
const { count } = await this.prisma.viaje.deleteMany({ where: { id, tenantId } });
if (count === 0) throw new NotFoundException();

// MAL
await this.prisma.viaje.delete({ where: { id } });
```

### Crear con registros hijos
```ts
// BIEN — el tenantId se propaga a cada hijo
await this.prisma.viaje.create({
  data: {
    tenantId,
    numero,
    vehiculosViaje: { create: vehiculos.map((v) => ({ tenantId, vehiculoId: v.id })) },
  },
});
```

### Agregaciones / reportes cross-tabla
```ts
// BIEN — cada consulta del reporte filtra por empresa
const [viajes, facturas] = await Promise.all([
  this.prisma.viaje.aggregate({ where: { tenantId }, _sum: { monto: true } }),
  this.prisma.factura.aggregate({ where: { tenantId }, _sum: { importe: true } }),
]);
```

### De dónde sale el tenantId
```ts
// BIEN — del token
async listar(@CurrentTenant() tenantId: string) { ... }

// MAL — del cliente
async listar(@Body('tenantId') tenantId: string) { ... }  // NUNCA
```

### Único caso donde el tenantId viene del request: override de superadmin
Un superadmin puede operar "sobre" un tenant elegido, y ahí el `tenantId` sí llega por
query/body. Es la **única** excepción, y solo es válida si el endpoint está protegido por
rol superadmin. El molde correcto:
```ts
// BIEN — el override solo se honra si el que llama es superadmin; si no, usa el token
private resolveTenantId(auth: AuthPayload, override?: string): string {
  const tenantId = auth.role === 'superadmin' && override ? override : auth.tenantId;
  assertTenantId(tenantId);
  return tenantId;
}

// BIEN — controlador solo-superadmin: el tenantId de la query es esperado y seguro
@Controller('platform/combustible')
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles('superadmin')
export class ... { getAll(@Query('tenantId') tenantId: string) { ... } }

// MAL — endpoint de usuario normal que confía en el tenantId del cliente
@Controller('combustible')  // sin @Roles('superadmin')
export class ... { getAll(@Query('tenantId') tenantId: string) { ... } }  // AGUJERO
```
Regla: si un endpoint lee `tenantId` de query/body, **tiene que** estar gateado por
`@Roles('superadmin')` o usar `resolveTenantId`. Ningún endpoint de usuario normal lo hace.
Y en el frontend: nunca mandes `tenantId` desde el cliente salvo en las pantallas de
superadmin; en rutas normales el backend lo ignora y solo confunde.

---

## Antes de dar por buena una consulta, chequear:

- [ ] ¿Tiene `where: { tenantId }`?
- [ ] Si busca por `id`, ¿combina `id` + `tenantId` (o valida pertenencia después)?
- [ ] Si modifica o borra, ¿usa `updateMany`/`deleteMany` con `tenantId` (o valida antes)?
- [ ] Si toca tablas hijas, ¿cada una filtra por empresa?
- [ ] Si agrega/suma de varias tablas, ¿filtran todas?
- [ ] ¿El `tenantId` viene del token y no del request?

---

## Excepción única: superadmin (platform)

El acceso de superadmin (`core/platform/`) SÍ ve datos de varias empresas, a propósito,
para soporte y administración. Es el **único** lugar donde no se filtra por un solo
`tenantId`, y está protegido por rol de superadmin. **No replicar este patrón en ningún
módulo común.** Si estás en un módulo de negocio y sentís que necesitás ver varias
empresas a la vez, está mal.

---

## Trampas por módulo

> Cada ticket del epic completa la sección de su módulo con lo que no es obvio.
> Dejar acá reglas accionables (qué hacer / qué no), no resúmenes de lo que se hizo.

### Viajes
_(Ticket 2 — pendiente de completar)_

### Facturación
_(Ticket 3 — pendiente de completar)_

### Cuenta corriente
_(Ticket 4 — pendiente de completar)_

### Stock
_(Ticket 5 — pendiente de completar)_

### Combustible
_(Ticket 6 — pendiente de completar. Incluir cómo se resuelve y se exige el tenantId en la vía de choferes con login DNI + PIN, distinta al login normal.)_

### Mantenimiento
_(Ticket 7 — pendiente de completar)_

### Remitos
_(Ticket 8 — pendiente de completar)_

### Liquidaciones / integración ARCA
_(Ticket 9 — pendiente de completar. Módulo de mayor riesgo: configuración fiscal y credenciales nunca cross-empresa.)_

### Reportes
_(Ticket 10 — pendiente de completar)_

### Dashboard
_(Ticket 11 — pendiente de completar)_

### Importaciones
_(Ticket 12 — pendiente de completar)_

### Entidades compartidas (clientes, transportistas, choferes, vehículos, destinatarios, direcciones)
_(Ticket 13 — pendiente de completar. Son el ejemplo de referencia del CRUD seguro.)_
