#!/usr/bin/env bash
# =============================================================================
# Routefinding — install deps and run backend + frontend
#
#   ./start.sh
#
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOG_DIR="$ROOT/.run-logs"
PID_DIR="$LOG_DIR"
mkdir -p "$LOG_DIR" "$ROOT/backend/data/packs"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
NC=$'\033[0m'

info()  { echo "${CYAN}->${NC} $*"; }
ok()    { echo "${GREEN}OK${NC} $*"; }
fail()  { echo "${RED}ERROR${NC} $*"; exit 1; }

BACKEND_PID=""
FRONTEND_PID=""

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
  if [[ -n "${BACKEND_PID}" ]]; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID}" ]]; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
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

# -----------------------------------------------------------------------------
# 1) System checks
# -----------------------------------------------------------------------------
info "Checking system requirements..."

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing $1. See REQUIREMENTS.md"
  fi
}

need python3
need npm
need node
need curl

ok "Python $(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
ok "Node $(node -v) / npm $(npm -v)"

if ! python3 -c "import venv" 2>/dev/null; then
  fail "Python venv missing. Run: sudo apt install python3-venv python3-pip"
fi

# -----------------------------------------------------------------------------
# 2) Backend setup
# -----------------------------------------------------------------------------
info "Setting up backend..."
cd "$ROOT/backend"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  ok "Created backend/.venv"
fi

# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt
ok "Backend packages installed"
deactivate

# -----------------------------------------------------------------------------
# 3) Frontend setup
# -----------------------------------------------------------------------------
info "Setting up frontend..."
cd "$ROOT/frontend"
npm install
ok "Frontend packages installed"

# -----------------------------------------------------------------------------
# 4) Free ports
# -----------------------------------------------------------------------------
kill_port "${BACKEND_PORT}"
kill_port "${FRONTEND_PORT}"

# -----------------------------------------------------------------------------
# 5) Start servers
# -----------------------------------------------------------------------------
info "Starting backend on :${BACKEND_PORT} ..."
cd "$ROOT/backend"
export USE_SQLITE=1
export PACK_DIR="$ROOT/backend/data/packs"
# shellcheck disable=SC1091
source .venv/bin/activate
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT}" \
  >"${LOG_DIR}/backend.log" 2>&1 &
BACKEND_PID=$!
echo "${BACKEND_PID}" >"${PID_DIR}/backend.pid"
deactivate

info "Starting frontend on :${FRONTEND_PORT} ..."
cd "$ROOT/frontend"
npm run dev -- --host 0.0.0.0 --port "${FRONTEND_PORT}" \
  >"${LOG_DIR}/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "${FRONTEND_PID}" >"${PID_DIR}/frontend.pid"

info "Waiting for backend..."
for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    ok "Backend ready"
    break
  fi
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    fail "Backend crashed. See ${LOG_DIR}/backend.log"
  fi
  sleep 0.5
done

if ! curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
  fail "Backend did not start. See ${LOG_DIR}/backend.log"
fi

info "Waiting for frontend..."
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1; then
    ok "Frontend ready"
    break
  fi
  if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    fail "Frontend crashed. See ${LOG_DIR}/frontend.log"
  fi
  sleep 0.5
done

if ! curl -sf "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1; then
  fail "Frontend did not start. See ${LOG_DIR}/frontend.log"
fi

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
echo "  Press ${BOLD}Ctrl+C${NC} to stop everything."
echo

# Keep script alive. Do not exit on a single failed health check.
while true; do
  sleep 5
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "${RED}Backend process died. See ${LOG_DIR}/backend.log${NC}"
    cleanup
  fi
  if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    echo "${RED}Frontend process died. See ${LOG_DIR}/frontend.log${NC}"
    cleanup
  fi
done
