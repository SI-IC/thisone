#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
react_port="${THISONE_DEMO_REACT_PORT:-5185}"
preact_port="${THISONE_DEMO_PREACT_PORT:-5186}"
vue_port="${THISONE_DEMO_PORT:-3000}"

fuser -k -TERM "${react_port}/tcp" "${preact_port}/tcp" "${vue_port}/tcp" 2>/dev/null || true
sleep 1
fuser -k -KILL "${react_port}/tcp" "${preact_port}/tcp" "${vue_port}/tcp" 2>/dev/null || true

react_pid=""
preact_pid=""
vue_pid=""
cleanup() {
  [ -n "$react_pid" ] && kill "$react_pid" 2>/dev/null || true
  [ -n "$preact_pid" ] && kill "$preact_pid" 2>/dev/null || true
  [ -n "$vue_pid" ] && kill "$vue_pid" 2>/dev/null || true
  [ -n "$react_pid" ] && wait "$react_pid" 2>/dev/null || true
  [ -n "$preact_pid" ] && wait "$preact_pid" 2>/dev/null || true
  [ -n "$vue_pid" ] && wait "$vue_pid" 2>/dev/null || true
}
trap cleanup EXIT

cd "$root"
pnpm build

cd "$root/examples/demo-app-react"
THISONE_DEMO_REACT_PORT="$react_port" THISONE_DEMO_PORT="$vue_port" \
  node_modules/.bin/vite --port "$react_port" --strictPort --host 127.0.0.1 \
  >/tmp/thisone-demo-react-dev.log 2>&1 &
react_pid=$!

ready=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:$react_port/react-demo/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "react demo dev server did not become ready on port $react_port" >&2
  cat /tmp/thisone-demo-react-dev.log >&2
  exit 1
fi

cd "$root/examples/demo-app-preact"
THISONE_DEMO_PREACT_PORT="$preact_port" THISONE_DEMO_PORT="$vue_port" \
  node_modules/.bin/vite --port "$preact_port" --strictPort --host 127.0.0.1 \
  >/tmp/thisone-demo-preact-dev.log 2>&1 &
preact_pid=$!

ready=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:$preact_port/preact-demo/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "preact demo dev server did not become ready on port $preact_port" >&2
  cat /tmp/thisone-demo-preact-dev.log >&2
  exit 1
fi

cd "$root/examples/demo-app"
THISONE_DEMO_REACT_PORT="$react_port" THISONE_DEMO_PREACT_PORT="$preact_port" THISONE_DEMO_PORT="$vue_port" \
  node_modules/.bin/vite --port "$vue_port" --strictPort --host 0.0.0.0 \
  >/tmp/thisone-demo-vue-dev.log 2>&1 &
vue_pid=$!

wait "$vue_pid"
