# Instrucciones para GitHub Copilot — Vialto backend

## Aislamiento multi-tenant (obligatorio)

Este proyecto usa una sola base de datos compartida entre muchas empresas. **Toda consulta
a la base DEBE filtrar por `tenantId`**; una empresa nunca puede ver, modificar ni borrar
datos de otra.

Las reglas completas, los moldes de consulta segura y las trampas por módulo están en un
**único archivo fuente**:

**`docs/reglas-multitenant.md`** — leelo y seguilo antes de escribir cualquier consulta.

> Nota: Copilot no importa archivos automáticamente. Este archivo apunta al fuente a
> propósito para no duplicar contenido. Si necesitás el detalle, abrí
> `docs/reglas-multitenant.md`. No copies las reglas acá: se mantienen en un solo lugar.

Resumen mínimo (el detalle está en el fuente):
- Toda consulta lleva `where: { tenantId }`.
- El `tenantId` sale del token de sesión, nunca del request.
- Buscar/modificar/borrar por `id` combina siempre `id` + `tenantId`.
- Las tablas hijas y las agregaciones cross-tabla también filtran por empresa.
