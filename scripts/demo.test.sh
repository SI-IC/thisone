#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root/scripts/demo.sh"

if bash -n "$script"; then
  echo "ok - scripts/demo.sh is syntactically valid bash"
else
  echo "not ok - scripts/demo.sh has a syntax error"
  exit 1
fi

if [ -x "$script" ]; then
  echo "ok - scripts/demo.sh is executable"
else
  echo "not ok - scripts/demo.sh is not executable"
  exit 1
fi

if grep -q 'node scripts/record-demo.mjs' "$script"; then
  echo "ok - scripts/demo.sh delegates to scripts/record-demo.mjs"
else
  echo "not ok - scripts/demo.sh does not delegate to the recorder"
  exit 1
fi

if grep -q 'trap cleanup EXIT' "$script"; then
  echo "ok - external-failure: scripts/demo.sh kills the dev server via an EXIT trap"
else
  echo "not ok - scripts/demo.sh leaks the dev server when the recorder fails"
  exit 1
fi
