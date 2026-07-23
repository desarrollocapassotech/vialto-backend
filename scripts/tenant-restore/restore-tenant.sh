#!/usr/bin/env bash
# Restaura los datos de UN tenant desde una DB origen (scratch con backup) hacia un destino
# (production u otra rama Neon), sin tocar otros tenants.
#
# Requisitos: psql (PostgreSQL client 17+), bash. No usa pg_dump --where (roto en Git Bash/Windows).
#
# Variables obligatorias:
#   SOURCE_DATABASE_URL   — rama scratch donde ya corriste pg_restore del dump
#   TARGET_DATABASE_URL   — DB destino (production u otra rama de prueba)
#   TENANT_CLERK_ORG_ID   — clerkOrgId del tenant (ej. org_xxx)
#
# Modos:
#   DRY_RUN=1             — solo muestra conteos y tablas; no escribe en TARGET
#   CONFIRM_APPLY=YES     — obligatorio para escribir en TARGET (junto con DRY_RUN≠1)
#
# Ejemplo (prueba en rama scratch → otra scratch):
#   export SOURCE_DATABASE_URL='postgresql://...scratch-a...'
#   export TARGET_DATABASE_URL='postgresql://...scratch-b...'
#   export TENANT_CLERK_ORG_ID='org_3C8Ta9DA8tyhEAurhIM54KHWwSk'
#   DRY_RUN=1 ./restore-tenant.sh
#   CONFIRM_APPLY=YES ./restore-tenant.sh
#
# Ver BACKUPS.md §2 para el procedimiento completo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TABLES_CONF="${SCRIPT_DIR}/tables.conf"

SOURCE="${SOURCE_DATABASE_URL:-}"
TARGET="${TARGET_DATABASE_URL:-}"
TENANT="${TENANT_CLERK_ORG_ID:-}"
DRY_RUN="${DRY_RUN:-0}"
CONFIRM="${CONFIRM_APPLY:-}"

PSQL="${PSQL:-psql}"

to_psql_path() {
  local p="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$p"
  else
    echo "$p"
  fi
}

dump_table_to_csv() {
  local table="$1"
  local column="$2"
  local csv="$3"
  local count csv_path
  count=$("$PSQL" "$SOURCE" -tA -v ON_ERROR_STOP=1 -c \
    "SELECT COUNT(*) FROM public.\"${table}\" WHERE \"${column}\" = '${TENANT}';")
  if [[ "$count" == "0" ]]; then
    : > "$csv"
    return 0
  fi
  csv_path=$(to_psql_path "$csv")
  "$PSQL" "$SOURCE" -v ON_ERROR_STOP=1 -c \
    "\\copy (SELECT * FROM public.\"${table}\" WHERE \"${column}\" = '${TENANT}') TO '${csv_path}' WITH (FORMAT csv, HEADER true)"
}
die() { echo "[tenant-restore] ERROR: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "no se encontró '$1' en PATH"
}

validate_env() {
  [[ -n "$SOURCE" ]] || die "definí SOURCE_DATABASE_URL"
  [[ -n "$TARGET" ]] || die "definí TARGET_DATABASE_URL"
  [[ -n "$TENANT" ]] || die "definí TENANT_CLERK_ORG_ID"
  [[ "$TENANT" =~ ^org_ ]] || die "TENANT_CLERK_ORG_ID debe empezar con org_"
  [[ "$SOURCE" != "$TARGET" ]] || die "SOURCE y TARGET no pueden ser la misma URL"
}

tenant_name_on() {
  local url="$1"
  "$PSQL" "$url" -tA -v ON_ERROR_STOP=1 -c \
    "SELECT name FROM public.tenants WHERE \"clerkOrgId\" = '${TENANT}';"
}

count_other_tenants() {
  local url="$1"
  "$PSQL" "$url" -tA -v ON_ERROR_STOP=1 -c "
    SELECT COALESCE(SUM(c), 0) FROM (
      SELECT COUNT(*) AS c FROM public.facturas WHERE \"tenantId\" <> '${TENANT}'
      UNION ALL SELECT COUNT(*) FROM public.viajes WHERE \"tenantId\" <> '${TENANT}'
      UNION ALL SELECT COUNT(*) FROM public.clientes WHERE \"tenantId\" <> '${TENANT}'
    ) s;
  "
}

dump_table_data() {
  die "interno: usar dump_table_to_csv"
}


log() { echo "[tenant-restore] $*"; }

main() {
  require_cmd "$PSQL"
  validate_env

  log "psql: $("$PSQL" --version | head -n1)"
  log "tenant:  ${TENANT}"

  local src_name tgt_name
  src_name=$(tenant_name_on "$SOURCE") || die "tenant no encontrado en SOURCE"
  log "SOURCE:  ${src_name} ($(echo "$SOURCE" | sed -E 's/:[^:@]+@/:***@/'))"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "DRY_RUN=1 — no se escribe en TARGET"
    SOURCE_DATABASE_URL="$SOURCE" TENANT_CLERK_ORG_ID="$TENANT" \
      "${SCRIPT_DIR}/count-tenant-rows.sh"
    if "$PSQL" "$TARGET" -tA -c "SELECT 1 FROM public.tenants WHERE \"clerkOrgId\"='${TENANT}';" 2>/dev/null | grep -q 1; then
      TARGET_DATABASE_URL="$TARGET" TENANT_CLERK_ORG_ID="$TENANT" \
        "${SCRIPT_DIR}/count-tenant-rows.sh" || true
    else
      log "TARGET: tenant aún no existe (normal si es rama vacía de prueba)"
    fi
    log "Dry-run OK. Para aplicar: CONFIRM_APPLY=YES DRY_RUN=0 ./restore-tenant.sh"
    exit 0
  fi

  [[ "$CONFIRM" == "YES" ]] || die "para escribir en TARGET exportá CONFIRM_APPLY=YES"

  tgt_name=$(tenant_name_on "$TARGET" 2>/dev/null || true)
  if [[ -n "$tgt_name" ]]; then
    log "TARGET:  ${tgt_name} (se reemplazarán sus datos por los del backup)"
  else
    log "TARGET:  tenant no presente — se insertará desde cero"
  fi

  local before_others after_others
  before_others=$(count_other_tenants "$TARGET")
  log "Filas de otros tenants en TARGET (control): ${before_others}"

  RESTORE_TMPDIR=$(mktemp -d 2>/dev/null || mktemp -d -t tenantrestore)
  trap '[[ -n "${RESTORE_TMPDIR:-}" ]] && rm -rf "$RESTORE_TMPDIR"' EXIT

  log "Exportando datos del tenant desde SOURCE (CSV)..."
  local table column idx=0
  while IFS='|' read -r table column || [[ -n "${table:-}" ]]; do
    table="${table//$'\r'/}"
    column="${column//$'\r'/}"
    [[ -z "$table" || "$table" =~ ^# ]] && continue
    [[ -z "$column" ]] && continue
    idx=$((idx + 1))
    dump_table_to_csv "$table" "$column" "${RESTORE_TMPDIR}/$(printf '%02d' "$idx")_${table}.csv"
  done < "$TABLES_CONF"

  local apply_sql="${RESTORE_TMPDIR}/apply.sql"
  {
    echo "-- tenant-restore $(date -u +%Y-%m-%dT%H:%M:%SZ) tenant=${TENANT}"
    echo "BEGIN;"
    # Purge en orden inverso al insert (hijos antes que padres).
    # No usar solo DELETE FROM tenants CASCADE: FK Restrict en viajes_vehiculos.vehiculoId.
    while IFS='|' read -r table column || [[ -n "${table:-}" ]]; do
      table="${table//$'\r'/}"
      column="${column//$'\r'/}"
      [[ -z "$table" || "$table" =~ ^# ]] && continue
      [[ -z "$column" ]] && continue
      echo "DELETE FROM public.\"${table}\" WHERE \"${column}\" = '${TENANT}';"
    done < <(tac "$TABLES_CONF")
    local csv f lines tname
    for csv in "${RESTORE_TMPDIR}"/[0-9][0-9]_*.csv; do
      [[ -f "$csv" ]] || continue
      lines=$(wc -l < "$csv" | tr -d ' ')
      [[ "$lines" -le 1 ]] && continue
      f=$(basename "$csv")
      tname="${f#*_}"
      tname="${tname%.csv}"
      echo "COPY public.\"${tname}\" FROM STDIN WITH (FORMAT csv, HEADER true);"
      cat "$csv"
      echo "\\."
    done
    echo "COMMIT;"
  } > "$apply_sql"

  log "Aplicando en TARGET (transacción única)..."
  "$PSQL" "$TARGET" -v ON_ERROR_STOP=1 -f "$apply_sql"

  after_others=$(count_other_tenants "$TARGET")
  if [[ "$before_others" != "$after_others" ]]; then
    die "ALERTA: cambió el conteo de filas de otros tenants (${before_others} → ${after_others}). Revisar TARGET."
  fi
  log "Control OK: otros tenants sin cambios (${after_others} filas en tablas clave)"

  log "Verificando conteos SOURCE vs TARGET..."
  SOURCE_DATABASE_URL="$SOURCE" TARGET_DATABASE_URL="$TARGET" \
    TENANT_CLERK_ORG_ID="$TENANT" "${SCRIPT_DIR}/count-tenant-rows.sh" --compare

  log "Restore por tenant completado."
}

main "$@"
