#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root/scripts/e2e-react.sh"

if bash -n "$script"; then
  echo "ok - scripts/e2e-react.sh is syntactically valid bash"
else
  echo "not ok - scripts/e2e-react.sh has a syntax error"
  exit 1
fi

if [ -x "$script" ]; then
  echo "ok - scripts/e2e-react.sh is executable"
else
  echo "not ok - scripts/e2e-react.sh is not executable"
  exit 1
fi

if grep -q 'pick-element-react.e2e.mjs' "$script"; then
  echo "ok - scripts/e2e-react.sh delegates to tests/e2e/pick-element-react.e2e.mjs"
else
  echo "not ok - scripts/e2e-react.sh does not delegate to the react e2e test"
  exit 1
fi
