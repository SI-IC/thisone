#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
demo="$root/examples/demo-app"
port="${THISONE_DEMO_PORT:-5187}"

cd "$root"
pnpm build

cd "$demo"
node_modules/.bin/vite --port "$port" --strictPort >/tmp/thisone-demo-dev.log 2>&1 &
dev_pid=$!

cleanup() {
  kill "$dev_pid" 2>/dev/null || true
  wait "$dev_pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 50); do
  if curl -sf "http://localhost:$port/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "demo dev server did not become ready on port $port" >&2
  cat /tmp/thisone-demo-dev.log >&2
  exit 1
fi

cd "$root"
node scripts/record-demo.mjs "$port"
