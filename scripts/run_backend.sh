#!/usr/bin/env bash
# Compatibility wrapper — prefer: cd backend && ./run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/backend/run.sh"
