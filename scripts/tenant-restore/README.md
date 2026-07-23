# Restore por tenant — inicio rápido

Guía completa (Windows, troubleshooting, prueba con 2 ramas): [`../../BACKUPS.md`](../../BACKUPS.md) §2.

## Resumen

1. Dump R2 → `pg_restore` en rama Neon **SOURCE**
2. Otra rama Neon **TARGET** (prueba; no production la primera vez)
3. Config → dry-run → apply

## Setup (Git Bash)

```bash
cd vialto-backend/scripts/tenant-restore
cp test-env.example .test-env.local
# Editar .test-env.local:
#   - URLs Direct de Neon (sin -pooler), ENTRE COMILLAS
#   - TENANT_CLERK_ORG_ID copiado del SELECT en SOURCE
chmod +x *.sh
```

## Comandos

```bash
DRY_RUN=1 bash run-test.sh
CONFIRM_APPLY=YES bash run-test.sh
```

## Errores frecuentes

| Problema | Fix |
|---|---|
| `definí SOURCE_DATABASE_URL` | URLs entre `"..."` en `.test-env.local` |
| `tenant no encontrado en SOURCE` | Copiar `clerkOrgId` del SQL; debe existir en el dump |
| FK al borrar vehiculos | Actualizar `restore-tenant.sh` (purge en orden inverso) |
| `pg_dump --where` illegal | Script usa psql+CSV; no hace falta pg_dump |

Ver tabla completa en `BACKUPS.md` §2.3.
