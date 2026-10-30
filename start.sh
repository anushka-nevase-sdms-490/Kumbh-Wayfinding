#!/usr/bin/env bash
# =============================================================================
# Routefinding — install deps and run backend + frontend (+ trusted phone tunnel)
#
#   ./start.sh
#
# Phone GPS needs a real HTTPS padlock → ngrok tunnel by default.
# Servers keep running until you press Ctrl+C.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Ports: BACKEND_PORT / FRONTEND_PORT if set, else 8000 / 5173. A port held by
# another program is never stopped: the backend moves to the next free port,
# and the frontend asks you to choose one (see choose_ports below).
BACKEND_PORT_SET="${BACKEND_PORT:-}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOG_DIR="$ROOT/.run-logs"
CERT_DIR="$ROOT/frontend/.certs"
KEY_FILE="$CERT_DIR/dev-key.pem"
CRT_FILE="$CERT_DIR/dev-cert.pem"
LOCK_FILE="$LOG_DIR/start.lock"
PUBLIC_URL_FILE="$LOG_DIR/public-url.txt"
mkdir -p "$LOG_DIR" "$ROOT/backend/data/packs" "$CERT_DIR"

# LAN address of the interface that reaches the internet (skips docker bridges).
LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[\d.]+' | head -1 || true)"
[[ -n "${LAN_IP:-}" ]] || LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "${LAN_IP:-}" ]] || LAN_IP="127.0.0.1"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
NC=$'\033[0m'

info()  { echo "${CYAN}->${NC} $*"; }
ok()    { echo "${GREEN}OK${NC} $*"; }
fail()  { echo "${RED}ERROR${NC} $*"; exit 1; }

# True if anything listens on the port (any user — even ones we cannot stop).
port_in_use() {
  ss -tln 2>/dev/null | grep -qE "[:.]${1}[[:space:]]"
}

# True if our Setu backend answers on the port.
is_setu_backend() {
  local port="$1" body
  body="$(curl -sk --connect-timeout 2 "https://127.0.0.1:${port}/health" 2>/dev/null || true)"
  [[ "$body" == *'"service":"setu"'* ]] && return 0
  body="$(curl -s --connect-timeout 2 "http://127.0.0.1:${port}/health" 2>/dev/null || true)"
  [[ "$body" == *'"service":"setu"'* ]]
}

# True if our frontend (Vite dev server of this app) answers on the port.
is_setu_frontend() {
  local port="$1" body
  body="$(curl -sk --connect-timeout 2 "https://127.0.0.1:${port}/" 2>/dev/null || true)"
  [[ "$body" == *"<title>Kumbh Wayfinding</title>"* ]] && return 0
  body="$(curl -s --connect-timeout 2 "http://127.0.0.1:${port}/" 2>/dev/null || true)"
  [[ "$body" == *"<title>Kumbh Wayfinding</title>"* ]]
}

# Stop a server this script started (pid file), if that process is still ours —
# also when it hangs and no longer answers on its port.
stop_pidfile() {
  local file="$1" pattern="$2" pid
  [[ -f "$file" ]] || return 0
  pid="$(cat "$file" 2>/dev/null || true)"
  rm -f "$file"
  [[ -n "$pid" ]] || return 0
  if ps -p "$pid" -o args= 2>/dev/null | grep -qE "$pattern"; then
    pkill -TERM -P "$pid" 2>/dev/null || true  # npm's child (vite)
    kill "$pid" 2>/dev/null || true
  fi
}

# Stop what listens on the port — only when it is ours (an old run of this app).
stop_if_ours() {
  local port="$1" kind="$2"
  port_in_use "$port" || return 0
  if [[ "$kind" == "backend" ]] && ! is_setu_backend "$port"; then return 0; fi
  if [[ "$kind" == "frontend" ]] && ! is_setu_frontend "$port"; then return 0; fi
  kill_port "$port"
}

# Pick the ports. Another program on 8000 (e.g. a Docker container) used to
# make every /api call reach that program → 404 → no routes (see
# docs/MISSING_ROUTE_ROOT_CAUSE.md).
choose_ports() {
  if port_in_use "$BACKEND_PORT" && ! is_setu_backend "$BACKEND_PORT"; then
    if [[ -n "$BACKEND_PORT_SET" ]]; then
      fail "Port ${BACKEND_PORT} is used by another program. Choose another: BACKEND_PORT=8010 ./start.sh"
    fi
    local p
    for p in 8010 8011 8012 8013 8014 8015 8016 8017 8018 8019 8020; do
      if ! port_in_use "$p" || is_setu_backend "$p"; then
        info "Port ${BACKEND_PORT} is used by another program — backend will use ${p}"
        BACKEND_PORT="$p"
        break
      fi
    done
    port_in_use "$BACKEND_PORT" && ! is_setu_backend "$BACKEND_PORT" \
      && fail "No free port for the backend (tried 8000, 8010–8020). Set BACKEND_PORT=…"
  fi
  if port_in_use "$FRONTEND_PORT" && ! is_setu_frontend "$FRONTEND_PORT"; then
    fail "Port ${FRONTEND_PORT} is used by another program. Choose another: FRONTEND_PORT=5180 ./start.sh"
  fi
  # vite.config.ts proxies /api to this port.
  export SETU_BACKEND_PORT="${BACKEND_PORT}"
}

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

stop_ngrok() {
  if [[ -f "${LOG_DIR}/ngrok.pid" ]]; then
    kill "$(cat "${LOG_DIR}/ngrok.pid")" 2>/dev/null || true
    rm -f "${LOG_DIR}/ngrok.pid"
  fi
  # Only kill ngrok processes bound to our log / local API — avoid broad pkill.
  if command -v ss >/dev/null 2>&1; then
    local npids
    npids="$(ss -tlnp 2>/dev/null | grep ':4040 ' | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
    if [[ -n "${npids:-}" ]]; then
      # shellcheck disable=SC2086
      kill $npids 2>/dev/null || true
    fi
  fi
}

# True if something answers on the port (http or https).
port_alive() {
  local port="$1"
  curl -skf --connect-timeout 2 "https://127.0.0.1:${port}" >/dev/null 2>&1 \
    || curl -skf --connect-timeout 2 "https://127.0.0.1:${port}/health" >/dev/null 2>&1 \
    || curl -sf --connect-timeout 2 "http://127.0.0.1:${port}" >/dev/null 2>&1 \
    || curl -sf --connect-timeout 2 "http://127.0.0.1:${port}/health" >/dev/null 2>&1
}

cleanup() {
  echo
  info "Stopping Routefinding..."
  stop_ngrok
  stop_pidfile "${LOG_DIR}/backend.pid" "uvicorn"
  stop_pidfile "${LOG_DIR}/frontend.pid" "npm|vite|node"
  stop_if_ours "${BACKEND_PORT}" backend
  stop_if_ours "${FRONTEND_PORT}" frontend
  rm -f "$LOCK_FILE" "$PUBLIC_URL_FILE"
  ok "Stopped."
  exit 0
}

trap cleanup INT TERM

# Single instance — stops the spam from two competing start.sh loops.
if [[ -f "$LOCK_FILE" ]]; then
  old_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid}" ]] && kill -0 "${old_pid}" 2>/dev/null; then
    fail "Already running (pid ${old_pid}). In that terminal press Ctrl+C, then run ./start.sh again."
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ >"$LOCK_FILE"

echo
echo "${BOLD}========================================${NC}"
echo "${BOLD}   Routefinding - start all             ${NC}"
echo "${BOLD}========================================${NC}"
echo

info "Checking system requirements..."
for cmd in python3 npm node curl openssl; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing $cmd. See REQUIREMENTS.md"
done
ok "Python $(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
ok "Node $(node -v) / npm $(npm -v)"

if ! python3 -c "import venv" 2>/dev/null; then
  fail "Python venv missing. Run: sudo apt install python3-venv python3-pip"
fi

# Local TLS for Vite/uvicorn. A local CA is installed into Chrome so
# https://localhost does not show "Your connection is not private" every run.
# Phone GPS still needs the ngrok URL (a public padlock).
SCHEME="https"
USE_HTTPS="${USE_HTTPS:-1}"
USE_TUNNEL="${USE_TUNNEL:-1}"
CA_KEY="$CERT_DIR/local-ca-key.pem"
CA_CRT="$CERT_DIR/local-ca.pem"
CA_NAME="Routefinding Local CA"

local_certutil() {
  if command -v certutil >/dev/null 2>&1; then
    command -v certutil
    return 0
  fi
  local bundled="$ROOT/.tools/certutil"
  if [[ -x "$bundled" ]]; then
    echo "$bundled"
    return 0
  fi
  info "Fetching certificate tools so Chrome can trust localhost..." >&2
  mkdir -p "$ROOT/.tools/nss"
  if (cd "$ROOT/.tools/nss" && apt-get download libnss3-tools >/dev/null 2>&1); then
    local deb
    deb="$(ls -1 "$ROOT/.tools/nss"/libnss3-tools_*.deb 2>/dev/null | head -1)"
    if [[ -n "$deb" ]]; then
      dpkg -x "$deb" "$ROOT/.tools/nss" >/dev/null 2>&1 || true
      if [[ -x "$ROOT/.tools/nss/usr/bin/certutil" ]]; then
        cp "$ROOT/.tools/nss/usr/bin/certutil" "$bundled"
        chmod +x "$bundled"
        echo "$bundled"
        return 0
      fi
    fi
  fi
  return 1
}

trust_local_ca() {
  local certutil_bin=""
  certutil_bin="$(local_certutil)" || true
  if [[ -n "$certutil_bin" ]]; then
    mkdir -p "${HOME}/.pki/nssdb"
    if [[ ! -f "${HOME}/.pki/nssdb/cert9.db" ]]; then
      "$certutil_bin" -d "sql:${HOME}/.pki/nssdb" -N --empty-password >/dev/null 2>&1 || true
    fi
    "$certutil_bin" -d "sql:${HOME}/.pki/nssdb" -D -n "${CA_NAME}" >/dev/null 2>&1 || true
    if "$certutil_bin" -d "sql:${HOME}/.pki/nssdb" -A -t "C,," -n "${CA_NAME}" -i "${CA_CRT}"; then
      ok "Chrome trusts ${CA_NAME}. Fully quit Chrome, then open https://localhost:${FRONTEND_PORT}"
    fi
  else
    info "Could not install Chrome trust automatically. Open https://localhost once and choose Proceed."
  fi
  local sys_cert="/usr/local/share/ca-certificates/routefinding-local-ca.crt"
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1 && [[ -d /usr/local/share/ca-certificates ]]; then
    sudo cp "${CA_CRT}" "${sys_cert}" && sudo update-ca-certificates >/dev/null 2>&1 \
      && ok "System trust store updated" || true
  fi
}

if [[ "$USE_HTTPS" != "1" ]]; then
  SCHEME="http"
  echo "${RED}Note:${NC} USE_HTTPS=0 — phone GPS autofill will not work."
else
  need_cert=0
  if [[ ! -f "$CA_CRT" || ! -f "$CA_KEY" ]]; then
    need_cert=1
  fi
  if [[ ! -f "$CRT_FILE" || ! -f "$KEY_FILE" ]]; then
    need_cert=1
  elif ! openssl x509 -in "$CRT_FILE" -noout -text 2>/dev/null | grep -q "IP Address:${LAN_IP}"; then
    need_cert=1
  elif ! openssl verify -CAfile "$CA_CRT" "$CRT_FILE" >/dev/null 2>&1; then
    need_cert=1
  fi
  if [[ "$need_cert" == "1" ]]; then
    info "Creating a local certificate Chrome can trust..."
    if [[ ! -f "$CA_CRT" || ! -f "$CA_KEY" ]]; then
      openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
        -keyout "$CA_KEY" -out "$CA_CRT" \
        -subj "/CN=${CA_NAME}" \
        -addext "basicConstraints=critical,CA:TRUE" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" \
        >/dev/null 2>&1 || fail "Could not create local certificate authority"
      chmod 600 "$CA_KEY"
    fi
    tmp_ext="$(mktemp)"
    cat >"$tmp_ext" <<EOF
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,DNS:localhost.localdomain,IP:127.0.0.1,IP:${LAN_IP}
EOF
    openssl req -new -newkey rsa:2048 -nodes \
      -keyout "$KEY_FILE" -out "$CERT_DIR/dev.csr" \
      -subj "/CN=localhost" >/dev/null 2>&1 || fail "Could not create certificate request"
    chmod 600 "$KEY_FILE"
    openssl x509 -req -in "$CERT_DIR/dev.csr" \
      -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial \
      -out "$CRT_FILE" -days 825 -sha256 \
      -extfile "$tmp_ext" >/dev/null 2>&1 || fail "Could not sign localhost certificate"
    rm -f "$tmp_ext" "$CERT_DIR/dev.csr"
  fi
  [[ -f "$KEY_FILE" && -f "$CRT_FILE" && -f "$CA_CRT" ]] || fail "TLS cert files missing"
  trust_local_ca
  ok "TLS enabled (local https://localhost:${FRONTEND_PORT})"
fi

info "Setting up backend..."
cd "$ROOT/backend"
# Recreate the venv if it is missing or broken (e.g. the project folder moved).
if ! .venv/bin/python -c "import sys" >/dev/null 2>&1; then
  rm -rf .venv
  python3 -m venv .venv
  ok "Created backend/.venv"
fi
.venv/bin/python -m pip install --upgrade pip >/dev/null
.venv/bin/python -m pip install -r requirements.txt >/dev/null
ok "Backend packages installed"

info "Setting up frontend..."
cd "$ROOT/frontend"
npm install >/dev/null
ok "Frontend packages installed"

stop_ngrok
# A previous run that was not stopped cleanly (hung server still on the port).
stop_pidfile "${LOG_DIR}/backend.pid" "uvicorn"
stop_pidfile "${LOG_DIR}/frontend.pid" "npm|vite|node"
choose_ports
stop_if_ours "${BACKEND_PORT}" backend
stop_if_ours "${FRONTEND_PORT}" frontend

cd "$ROOT/backend"
export USE_SQLITE=1
export PACK_DIR="$ROOT/backend/data/packs"

# Without places and lanes the app can only show "No walked lane yet". On the
# first run build the Nashik pilot dataset from OpenStreetMap (saved copies in
# backend/data/osm/ are used when present, or when Overpass is unreachable).
if [[ "${SETU_SKIP_DATASET:-0}" != "1" ]]; then
  counts="$(.venv/bin/python -c 'from app.db import init_db, SessionLocal, QrNode, Edge; init_db(); db = SessionLocal(); osm = db.query(Edge).filter(Edge.source == "osm"); print(db.query(QrNode).count(), db.query(Edge).count(), osm.count(), osm.filter(Edge.passage_kind == "bridge").count())' 2>/dev/null || echo "? ? ? ?")"
  read -r place_count lane_count osm_lanes osm_bridges <<<"$counts"
  dataset_kind=""
  if [[ "$place_count" == "0" ]]; then
    dataset_kind="all"      # nothing yet: places, water, then streets
  elif [[ "$lane_count" == "0" ]]; then
    dataset_kind="network"  # places but no lanes (e.g. an earlier street import failed)
  elif [[ "$osm_lanes" != "0" && "$osm_bridges" == "0" ]]; then
    # Streets imported before the river safety checks: re-import them so
    # bridges are marked and unbridged river crossings are left out.
    dataset_kind="network"
  fi
  if [[ -n "$dataset_kind" ]]; then
    info "Building the Nashik pilot dataset (${dataset_kind}, OpenStreetMap, with river safety checks)..."
    saved_flag=""
    if ls data/osm/places-*.json >/dev/null 2>&1 && ls data/osm/network-*.json >/dev/null 2>&1 \
      && ls data/osm/water-*.json >/dev/null 2>&1; then
      saved_flag="--saved"
    else
      info "Downloading from OpenStreetMap (Overpass) — this can take a few minutes when it is busy."
    fi
    if .venv/bin/python scripts/import_osm.py "${dataset_kind}" ${saved_flag} >"${LOG_DIR}/dataset.log" 2>&1; then
      ok "Nashik dataset ready ($(grep -E '^Pack ' "${LOG_DIR}/dataset.log" | tail -1))"
    else
      echo "${RED}Warning:${NC} dataset build failed — see ${LOG_DIR}/dataset.log (routes will be missing)"
    fi
  else
    ok "Nashik data ready (${lane_count} lanes in the database)"
  fi
fi

info "Starting backend on :${BACKEND_PORT} ..."
export PUBLIC_URL_FILE
SSL_ARGS=()
if [[ "$SCHEME" == "https" ]]; then
  SSL_ARGS=(--ssl-keyfile "$KEY_FILE" --ssl-certfile "$CRT_FILE")
fi
# The Vite proxy (IPv6, so ::ffff:127.0.0.1) passes the phone's IP on: trust it.
nohup "$ROOT/backend/.venv/bin/uvicorn" app.main:app \
  --host 0.0.0.0 --port "${BACKEND_PORT}" "${SSL_ARGS[@]}" \
  --forwarded-allow-ips "127.0.0.1,::1,::ffff:127.0.0.1" \
  >"${LOG_DIR}/backend.log" 2>&1 &
echo $! >"${LOG_DIR}/backend.pid"

# Phones (local network or the ngrok tunnel) get a production build served by
# `vite preview`, which serves only the built files. The Vite *dev* server has
# known advisories (a path traversal could read files on this computer, such
# as backend/.env or the database), so it runs only with FRONTEND_MODE=dev,
# bound to this computer, and is never tunnelled.
FRONTEND_MODE="${FRONTEND_MODE:-preview}"
if [[ "$FRONTEND_MODE" == "dev" && "$USE_TUNNEL" == "1" ]]; then
  echo "${RED}Note:${NC} FRONTEND_MODE=dev serves this computer only — no tunnel, no phones."
  USE_TUNNEL=0
fi
if [[ "$SCHEME" == "https" ]]; then
  export SETU_HTTP=0
else
  export SETU_HTTP=1
fi

info "Waiting for backend..."
backend_ok=0
for _ in $(seq 1 40); do
  # Our backend, not merely something on the port.
  if is_setu_backend "${BACKEND_PORT}"; then
    ok "Backend ready"
    backend_ok=1
    break
  fi
  sleep 0.5
done
[[ "${backend_ok}" -eq 1 ]] || fail "Backend did not start. See ${LOG_DIR}/backend.log"

PHONE_URL="${SCHEME}://${LAN_IP}:${FRONTEND_PORT}"
rm -f "$PUBLIC_URL_FILE"

# Trusted HTTPS for phones (GPS needs a real padlock). The tunnel starts first
# so the build below knows its public link.
if command -v ngrok >/dev/null 2>&1 && [[ "$USE_TUNNEL" == "1" ]]; then
  info "Starting trusted HTTPS tunnel (ngrok) for phone GPS..."
  stop_ngrok
  sleep 0.3
  nohup ngrok http "${SCHEME}://127.0.0.1:${FRONTEND_PORT}" \
    --log=stdout >"${LOG_DIR}/ngrok.log" 2>&1 &
  echo $! >"${LOG_DIR}/ngrok.pid"
  TUNNEL_URL=""
  for _ in $(seq 1 40); do
    TUNNEL_URL="$(curl -sf http://127.0.0.1:4040/api/tunnels 2>/dev/null | python3 -c '
import sys, json
try:
  d = json.load(sys.stdin)
except Exception:
  raise SystemExit(0)
for t in d.get("tunnels") or []:
  u = t.get("public_url") or ""
  if u.startswith("https://"):
    print(u)
    break
' 2>/dev/null || true)"
    [[ -n "${TUNNEL_URL}" ]] && break
    sleep 0.5
  done
  if [[ -n "${TUNNEL_URL}" ]]; then
    PHONE_URL="${TUNNEL_URL}"
    printf '%s\n' "${TUNNEL_URL}" >"$PUBLIC_URL_FILE"
    ok "Trusted phone URL: ${TUNNEL_URL}"
  else
    echo "${RED}Warning:${NC} ngrok started but no public URL — see ${LOG_DIR}/ngrok.log"
    echo "  Phone GPS will not autofill on LAN self-signed HTTPS."
  fi
elif [[ "$USE_TUNNEL" == "1" ]]; then
  echo "${RED}Warning:${NC} ngrok not installed — phone GPS needs a trusted HTTPS URL."
  echo "  Install: https://ngrok.com/download"
fi
# Older runs wrote the phone link here; the app no longer reads it.
rm -f "$ROOT/frontend/.env.local"

cd "$ROOT/frontend"
if [[ "$FRONTEND_MODE" == "dev" ]]; then
  info "Starting the Vite dev server on this computer only (:${FRONTEND_PORT}) ..."
  PHONE_URL="(none — FRONTEND_MODE=dev serves this computer only)"
  nohup npm run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort \
    >"${LOG_DIR}/frontend.log" 2>&1 &
else
  # A test build: ?sim=1 (Nashik simulation) stays available for testing
  # from outside Nashik. Never use such a build for the public site.
  info "Building the app (about 10 s) ..."
  VITE_ENABLE_SIMULATION=1 npm run build >"${LOG_DIR}/frontend-build.log" 2>&1 \
    || fail "Build failed. See ${LOG_DIR}/frontend-build.log"
  info "Serving the build on :${FRONTEND_PORT} ..."
  nohup npx vite preview --host 0.0.0.0 --port "${FRONTEND_PORT}" --strictPort \
    >"${LOG_DIR}/frontend.log" 2>&1 &
fi
echo $! >"${LOG_DIR}/frontend.pid"

info "Waiting for frontend..."
frontend_ok=0
for _ in $(seq 1 50); do
  if port_alive "${FRONTEND_PORT}"; then
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
echo "  ${BOLD}On this PC:${NC}     ${SCHEME}://localhost:${FRONTEND_PORT}"
echo "  ${BOLD}On your phone:${NC}  ${GREEN}${PHONE_URL}${NC}"
echo "  ${BOLD}Backend:${NC}        ${SCHEME}://localhost:${BACKEND_PORT}"
echo
echo "  ${BOLD}Volunteer link:${NC} ${GREEN}${PHONE_URL}/?mode=volunteer&register=1${NC}"
echo
if [[ "${PHONE_URL}" == *ngrok* ]]; then
  echo "  This has a ${BOLD}real HTTPS padlock${NC} — allow Location and GPS autofills."
  echo "  Open the link on the phone (allow Location)."
  echo "  If ngrok shows a splash page, tap ${BOLD}Visit Site${NC}."
  echo
else
  echo "  ${RED}No trusted tunnel${NC} — browser will show Not secure and block GPS."
  echo
fi
echo "  Logs: ${LOG_DIR}/backend.log"
echo "        ${LOG_DIR}/frontend.log"
echo "        ${LOG_DIR}/ngrok.log"
echo
echo "  Keep this terminal open. Press ${BOLD}Ctrl+C${NC} to stop."
echo

backend_was_up=1
frontend_was_up=1
while true; do
  sleep 10
  if is_setu_backend "${BACKEND_PORT}"; then
    if [[ "${backend_was_up}" -eq 0 ]]; then
      ok "Backend is responding again"
      backend_was_up=1
    fi
  else
    if [[ "${backend_was_up}" -eq 1 ]]; then
      echo "${RED}Warning:${NC} backend not responding (see ${LOG_DIR}/backend.log)"
      backend_was_up=0
    fi
  fi
  if port_alive "${FRONTEND_PORT}"; then
    if [[ "${frontend_was_up}" -eq 0 ]]; then
      ok "Frontend is responding again"
      frontend_was_up=1
    fi
  else
    if [[ "${frontend_was_up}" -eq 1 ]]; then
      echo "${RED}Warning:${NC} frontend not responding (see ${LOG_DIR}/frontend.log)"
      frontend_was_up=0
    fi
  fi
done
