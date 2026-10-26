#!/usr/bin/env bash
# CMD of the Dockerfile's dev target: install when the lockfile changed, then
# run the Nuxt dev server.
set -euo pipefail

lock="$(sha1sum package-lock.json | cut -d' ' -f1)"
if [ "$(cat node_modules/.lock-sha 2>/dev/null)" != "$lock" ]; then
  npm ci
  echo "$lock" > node_modules/.lock-sha
fi

exec npx nuxt dev --host 0.0.0.0 --port "${PORT:-3333}"
