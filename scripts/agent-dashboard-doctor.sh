#!/usr/bin/env bash
# Read-only health checks for agent activity detection.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DASHBOARD_URL="${DASHBOARD_URL:-http://127.0.0.1:5173}"

exec node --import tsx "$PROJECT_ROOT/scripts/run-doctor.mts" "$PROJECT_ROOT" "$DASHBOARD_URL"
