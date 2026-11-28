#!/usr/bin/env bash
# Run Travel OS so Expo Go can open it from anywhere (any Wi-Fi, mobile data).
#
#   API    -> 127.0.0.1:8002, published through a Cloudflare quick tunnel (https)
#   Metro  -> Expo tunnel (ngrok), so Expo Go can load the app
#   The app is started with EXPO_PUBLIC_API_URL = the Cloudflare URL.
#
# The Mac must stay on and online; the script keeps it awake while running.
# The public API URL changes every time this script starts (the API itself reloads code
# changes without a restart). Gmail sign-in needs that URL registered with Google; the
# script prints it. Ctrl-C stops everything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/apps/api"
APP_DIR="$ROOT/apps/mobile"
LOG_DIR="$API_DIR/var/logs"
mkdir -p "$LOG_DIR"

env_value() { grep -E "^$1=" "$API_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

# The API becomes reachable from the internet, so refuse to start with the default token key.
# NOTE: sign-in is email-only for now (no password). Anyone with the tunnel URL can sign in.
jwt="$(env_value JWT_SECRET)"
if [[ -z "$jwt" || "$jwt" == "dev-only-change-me" || ${#jwt} -lt 32 ]]; then
  echo "Set a long random JWT_SECRET in apps/api/.env first." >&2
  exit 1
fi

for port in 8002 8081; do
  if lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the other server first." >&2
    exit 1
  fi
done

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

# Keep the Mac from idle-sleeping while this runs.
caffeinate -ims -w $$ &
pids+=($!)

# Open the tunnel first: Gmail sign-in must return to this run's public address.
echo "Opening public tunnel for the API..."
: >"$LOG_DIR/cloudflared.log"
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8002 >"$LOG_DIR/cloudflared.log" 2>&1 &
pids+=($!)
API_URL=""
for _ in $(seq 1 45); do
  API_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cloudflared.log" | head -1 || true)"
  [[ -n "$API_URL" ]] && break
  sleep 1
done
[[ -n "$API_URL" ]] || { echo "No tunnel URL; see $LOG_DIR/cloudflared.log" >&2; exit 1; }
GMAIL_CALLBACK="$API_URL/api/v1/integrations/gmail/callback"

# --reload restarts the API when its code changes, so the tunnel address (and the
# Gmail return address registered with Google) survives code edits.
echo "Starting API..."
(cd "$API_DIR" && GOOGLE_REDIRECT_URI="$GMAIL_CALLBACK" exec uv run uvicorn app.main:app \
  --host 127.0.0.1 --port 8002 --reload --reload-dir app) >"$LOG_DIR/api.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do
  curl -fs http://127.0.0.1:8002/api/v1/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fs http://127.0.0.1:8002/api/v1/health >/dev/null || { echo "API did not start; see $LOG_DIR/api.log" >&2; exit 1; }
for _ in $(seq 1 30); do
  curl -fs "$API_URL/api/v1/health" >/dev/null 2>&1 && break
  sleep 2
done
echo "API is public at $API_URL"
echo "$API_URL" >"$LOG_DIR/public-api-url.txt"
echo "$GMAIL_CALLBACK" >"$LOG_DIR/gmail-redirect-uri.txt"
echo
echo "Gmail sign-in returns to:"
echo "  $GMAIL_CALLBACK"
echo "Add it once in Google Cloud Console > Google Auth Platform > Clients > (web client)"
echo "> Authorized redirect URIs, then Save. It changes only when this script restarts."
echo

echo "Starting Expo with a tunnel (scan the QR code with the iPhone camera)..."
cd "$APP_DIR"
EXPO_PUBLIC_API_URL="$API_URL" npx expo start --tunnel --go --clear
