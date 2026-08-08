#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root/scripts/dev-demo.sh"

if bash -n "$script"; then
  echo "ok - scripts/dev-demo.sh is syntactically valid bash"
else
  echo "not ok - scripts/dev-demo.sh has a syntax error"
  exit 1
fi

if [ -x "$script" ]; then
  echo "ok - scripts/dev-demo.sh is executable"
else
  echo "not ok - scripts/dev-demo.sh is not executable"
  exit 1
fi

if grep -q 'fuser -k' "$script"; then
  echo "ok - concurrency: scripts/dev-demo.sh kills stale listeners on both ports before starting"
else
  echo "not ok - scripts/dev-demo.sh does not clear stale ports before a rerun"
  exit 1
fi

if grep -q 'kill "\$react_pid"' "$script" && grep -q 'kill "\$vue_pid"' "$script"; then
  echo "ok - external-failure: scripts/dev-demo.sh cleanup kills both the react and vue dev servers"
else
  echo "not ok - scripts/dev-demo.sh cleanup leaks one of the two dev servers"
  exit 1
fi

if grep -q 'trap cleanup EXIT' "$script"; then
  echo "ok - scripts/dev-demo.sh registers cleanup on EXIT, not just normal completion"
else
  echo "not ok - scripts/dev-demo.sh does not trap EXIT"
  exit 1
fi

if grep -q 'node scripts/build-watch.mjs' "$script" && ! grep -q 'pnpm build:watch' "$script"; then
  echo "ok - scripts/dev-demo.sh launches build-watch directly, not through a pnpm wrapper (so SIGTERM reaches it)"
else
  echo "not ok - scripts/dev-demo.sh does not launch build-watch.mjs directly"
  exit 1
fi

if grep -q 'kill "\$build_pid"' "$script" && grep -q 'wait "\$build_pid"' "$script"; then
  echo "ok - external-failure: scripts/dev-demo.sh cleanup also kills and waits on the build-watch process"
else
  echo "not ok - scripts/dev-demo.sh cleanup leaks the build-watch process"
  exit 1
fi

if grep -q 'kill -0 "\$build_pid"' "$script"; then
  echo "ok - malformed/hostile input: scripts/dev-demo.sh checks build-watch survived startup instead of trusting a crashed background job"
else
  echo "not ok - scripts/dev-demo.sh does not verify build-watch is still alive after launch"
  exit 1
fi
