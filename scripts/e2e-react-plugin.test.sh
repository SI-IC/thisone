#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root/scripts/e2e-react-plugin.sh"

if bash -n "$script"; then
  echo "ok - scripts/e2e-react-plugin.sh is syntactically valid bash"
else
  echo "not ok - scripts/e2e-react-plugin.sh has a syntax error"
  exit 1
fi

if [ -x "$script" ]; then
  echo "ok - scripts/e2e-react-plugin.sh is executable"
else
  echo "not ok - scripts/e2e-react-plugin.sh is not executable"
  exit 1
fi

if grep -q 'thisone-react-plugin.e2e.mjs' "$script"; then
  echo "ok - scripts/e2e-react-plugin.sh delegates to tests/e2e/thisone-react-plugin.e2e.mjs"
else
  echo "not ok - scripts/e2e-react-plugin.sh does not delegate to the react-plugin e2e test"
  exit 1
fi

if grep -q 'demo-app-react-plugin' "$script"; then
  echo "ok - scripts/e2e-react-plugin.sh targets examples/demo-app-react-plugin"
else
  echo "not ok - scripts/e2e-react-plugin.sh does not target examples/demo-app-react-plugin"
  exit 1
fi
