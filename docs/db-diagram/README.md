# Diagrama de base de datos — Vialto

Esquema PostgreSQL (Neon) + módulos del roadmap. **Sin cuenta, sin tarjeta, sin dbdiagram Pro.**

## Uso rápido

1. **Ver el diagrama:** abrí [`index.html`](./index.html) en Chrome/Edge/Firefox (doble clic o arrastrar al navegador).
2. **Editar el esquema:** modificá [`vialto.dbml`](./vialto.dbml) (fuente de verdad).
3. **Exportar PDF:** en el navegador, `Ctrl+P` → Guardar como PDF.

## Qué incluye `index.html`

| Característica | Detalle |
|---|---|
| Flechas FK | Diagramas Mermaid por módulo con relaciones |
| Colores | Un color por módulo (sidebar + encabezados) |
| Planificado | Sección **PLANIFICADO** con borde punteado y badge |
| Leyenda | Prefijos `[IMP-*]` / `[PLAN-*]`, 3 capas, Firestore, Cloudinary, Clerk |
| Conexión | Solo CDN Mermaid (internet la primera vez) |

## Convención de prefijos

| Prefijo | Significado |
|---|---|
| `[IMP-CORE]` | Core implementado |
| `[IMP-VIAJES]` … `[IMP-ARCA]` | Módulos implementados |
| `[PLAN-C2]` | TenantConfig.flags (Capa 2) |
| `[PLAN-F7]` | Turnos |
| `[PLAN-F8]` | Reportes |
| `[PLAN-AFIP]` | AFIP/ARCA general |
| `[PLAN-C3]` | Metadata unificada viajes (conceptual) |

`tenantId` en tablas hijas = `tenants.clerkOrgId` (organización Clerk).

## Mantener actualizado

Tras cambios en `prisma/schema.prisma`:

1. Actualizá tablas, campos, FK e índices en `vialto.dbml`.
2. Regenerá `index.html` automáticamente desde `vialto.dbml` (no editarlo a mano):

   ```bash
   npx --package=@dbml/core -- node docs/db-diagram/generate-html.js
   ```

   El script (`generate-html.js`) parsea `vialto.dbml` y reescribe el array `MODULES` de `index.html`, así los dos archivos nunca quedan desincronizados. Si agregás una tabla nueva, sumala también al `MODULE_DEFS` del script (qué módulo/sección le corresponde) — si te olvidás, el script avisa por consola qué tabla quedó sin asignar.
   `@dbml/core` no es una dependencia del proyecto (es solo para este script de docs) — por eso se resuelve con `npx --package=...` en vez de tenerlo instalado.

## Referencias

- `prisma/schema.prisma`
- `CLAUDE.md`
- `src/shared/types/modules.ts`
