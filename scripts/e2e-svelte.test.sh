#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root/scripts/e2e-svelte.sh"

if bash -n "$script"; then
  echo "ok - scripts/e2e-svelte.sh is syntactically valid bash"
else
  echo "not ok - scripts/e2e-svelte.sh has a syntax error"
  exit 1
fi

if [ -x "$script" ]; then
  echo "ok - scripts/e2e-svelte.sh is executable"
else
  echo "not ok - scripts/e2e-svelte.sh is not executable"
  exit 1
fi

if grep -q 'thisone-svelte.e2e.mjs' "$script"; then
  echo "ok - scripts/e2e-svelte.sh delegates to tests/e2e/thisone-svelte.e2e.mjs"
else
  echo "not ok - scripts/e2e-svelte.sh does not delegate to the svelte e2e test"
  exit 1
fi
