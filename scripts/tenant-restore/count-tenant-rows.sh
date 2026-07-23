#!/usr/bin/env bash
# Cuenta filas por tabla para un tenant (source o target).
# Uso:
#   SOURCE_DATABASE_URL='postgresql://...' TENANT_CLERK_ORG_ID='org_xxx' \
#     ./count-tenant-rows.sh
#
# Opcional: comparar source vs target
#   SOURCE_DATABASE_URL='...' TARGET_DATABASE_URL='...' TENANT_CLERK_ORG_ID='org_xxx' \
#     ./count-tenant-rows.sh --compare

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TABLES_CONF="${SCRIPT_DIR}/tables.conf"
TENANT="${TENANT_CLERK_ORG_ID:-}"
SOURCE="${SOURCE_DATABASE_URL:-}"
TARGET="${TARGET_DATABASE_URL:-}"
COMPARE=0

if [[ "${1:-}" == "--compare" ]]; then
  COMPARE=1
fi

if [[ -z "$TENANT" ]]; then
  echo "ERROR: definí TENANT_CLERK_ORG_ID (clerkOrgId / tenantId)" >&2
  exit 1
fi

if [[ ! "$TENANT" =~ ^org_ ]]; then
  echo "ERROR: TENANT_CLERK_ORG_ID debe empezar con org_ (Clerk organizationId)" >&2
  exit 1
fi

count_on() {
  local url="$1"
  local label="$2"
  local table column where total=0

  echo "=== ${label} — tenant ${TENANT} ==="
  while IFS='|' read -r table column || [[ -n "${table:-}" ]]; do
    table="${table//$'\r'/}"
    column="${column//$'\r'/}"
    [[ -z "$table" || "$table" =~ ^# ]] && continue
    [[ -z "$column" ]] && continue
    where="\"${column}\" = '${TENANT}'"
    n=$(psql "$url" -tA -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM public.\"${table}\" WHERE ${where};")
    printf "  %-35s %s\n" "$table" "$n"
    total=$((total + n))
  done < "$TABLES_CONF"
  echo "  TOTAL filas (suma tablas): $total"
  echo
}

verify_tenant_exists() {
  local url="$1"
  local label="$2"
  local name
  name=$(psql "$url" -tA -v ON_ERROR_STOP=1 -c \
    "SELECT name FROM public.tenants WHERE \"clerkOrgId\" = '${TENANT}';" || true)
  if [[ -z "$name" ]]; then
    echo "ERROR: tenant ${TENANT} no existe en ${label}" >&2
    exit 1
  fi
  echo "Tenant en ${label}: ${name}"
}

count_other_tenants() {
  local url="$1"
  local label="$2"
  echo "=== ${label} — filas de OTROS tenants (control de seguridad) ==="
  psql "$url" -v ON_ERROR_STOP=1 -c "
    SELECT 'facturas' AS tabla, COUNT(*) AS otras
      FROM public.facturas WHERE \"tenantId\" <> '${TENANT}'
    UNION ALL
    SELECT 'viajes', COUNT(*) FROM public.viajes WHERE \"tenantId\" <> '${TENANT}'
    UNION ALL
    SELECT 'clientes', COUNT(*) FROM public.clientes WHERE \"tenantId\" <> '${TENANT}'
    UNION ALL
    SELECT 'tenants', COUNT(*) FROM public.tenants WHERE \"clerkOrgId\" <> '${TENANT}';
  "
  echo
}

if [[ -z "$SOURCE" ]]; then
  echo "ERROR: definí SOURCE_DATABASE_URL" >&2
  exit 1
fi

verify_tenant_exists "$SOURCE" "SOURCE"
count_on "$SOURCE" "SOURCE"

if [[ "$COMPARE" -eq 1 ]]; then
  if [[ -z "$TARGET" ]]; then
    echo "ERROR: --compare requiere TARGET_DATABASE_URL" >&2
    exit 1
  fi
  if [[ "$SOURCE" == "$TARGET" ]]; then
    echo "ERROR: SOURCE y TARGET son la misma URL" >&2
    exit 1
  fi
  verify_tenant_exists "$TARGET" "TARGET"
  count_on "$TARGET" "TARGET"
  count_other_tenants "$TARGET" "TARGET (antes/después del restore)"
fi
