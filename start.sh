#!/usr/bin/env bash
# =============================================================================
# Routefinding — install deps and run backend + frontend
#
#   ./start.sh
#
# Servers keep running until you press Ctrl+C.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOG_DIR="$ROOT/.run-logs"
mkdir -p "$LOG_DIR" "$ROOT/backend/data/packs"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
NC=$'\033[0m'

info()  { echo "${CYAN}->${NC} $*"; }
ok()    { echo "${GREEN}OK${NC} $*"; }
fail()  { echo "${RED}ERROR${NC} $*"; exit 1; }

kill_port() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    local pids
    pids="$(ss -tlnp 2>/dev/null | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
    if [[ -n "${pids:-}" ]]; then
      info "Stopping old process on port ${port}: ${pids}"
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
      sleep 1
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

cleanup() {
  echo
  info "Stopping Routefinding..."
  kill_port "${BACKEND_PORT}"
  kill_port "${FRONTEND_PORT}"
  ok "Stopped."
  exit 0
}

trap cleanup INT TERM

echo
echo "${BOLD}========================================${NC}"
echo "${BOLD}   Routefinding - start all             ${NC}"
echo "${BOLD}========================================${NC}"
echo

info "Checking system requirements..."
for cmd in python3 npm node curl; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing $cmd. See REQUIREMENTS.md"
done
ok "Python $(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
ok "Node $(node -v) / npm $(npm -v)"

if ! python3 -c "import venv" 2>/dev/null; then
  fail "Python venv missing. Run: sudo apt install python3-venv python3-pip"
fi

info "Setting up backend..."
cd "$ROOT/backend"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  ok "Created backend/.venv"
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt >/dev/null
ok "Backend packages installed"
deactivate

info "Setting up frontend..."
cd "$ROOT/frontend"
npm install >/dev/null
ok "Frontend packages installed"

kill_port "${BACKEND_PORT}"
kill_port "${FRONTEND_PORT}"

info "Starting backend on :${BACKEND_PORT} ..."
cd "$ROOT/backend"
export USE_SQLITE=1
export PACK_DIR="$ROOT/backend/data/packs"
nohup "$ROOT/backend/.venv/bin/uvicorn" app.main:app \
  --host 0.0.0.0 --port "${BACKEND_PORT}" \
  >"${LOG_DIR}/backend.log" 2>&1 &

info "Starting frontend on :${FRONTEND_PORT} ..."
cd "$ROOT/frontend"
nohup npm run dev -- --host 0.0.0.0 --port "${FRONTEND_PORT}" \
  >"${LOG_DIR}/frontend.log" 2>&1 &

info "Waiting for backend..."
backend_ok=0
for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    ok "Backend ready"
    backend_ok=1
    break
  fi
  sleep 0.5
done
[[ "${backend_ok}" -eq 1 ]] || fail "Backend did not start. See ${LOG_DIR}/backend.log"

info "Waiting for frontend..."
frontend_ok=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1; then
    ok "Frontend ready"
    frontend_ok=1
    break
  fi
  sleep 0.5
done
[[ "${frontend_ok}" -eq 1 ]] || fail "Frontend did not start. See ${LOG_DIR}/frontend.log"

echo
echo "${BOLD}${GREEN}Routefinding is running${NC}"
echo
echo "  ${BOLD}Open this:${NC}   http://localhost:${FRONTEND_PORT}"
echo "  ${BOLD}Backend:${NC}     http://localhost:${BACKEND_PORT}"
echo "  ${BOLD}API docs:${NC}    http://localhost:${BACKEND_PORT}/docs"
echo
echo "  Logs: ${LOG_DIR}/backend.log"
echo "        ${LOG_DIR}/frontend.log"
echo
echo "  Keep this terminal open."
echo "  Press ${BOLD}Ctrl+C${NC} only when you want to stop."
echo

# Stay alive. Warn on outages, but do NOT auto-kill the other server.
while true; do
  sleep 8
  if ! curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    echo "${RED}Warning:${NC} backend not responding (see ${LOG_DIR}/backend.log)"
  fi
  if ! curl -sf "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1; then
    echo "${RED}Warning:${NC} frontend not responding (see ${LOG_DIR}/frontend.log)"
  fi
done
