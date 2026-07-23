#!/usr/bin/env bash
# Carga .test-env.local y corre restore-tenant.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.test-env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Falta $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
exec "${SCRIPT_DIR}/restore-tenant.sh" "$@"
