#!/usr/bin/env bash
# Run Setu backend (from this folder)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export USE_SQLITE="${USE_SQLITE:-1}"
export PACK_DIR="${PACK_DIR:-$ROOT/data/packs}"
mkdir -p "$PACK_DIR"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
