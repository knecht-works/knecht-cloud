#!/usr/bin/env bash
# Run the Knecht dev server inside the Linux dev VM, in the dev container
# (docker-compose.dev.yml), so it drives ddev exactly like production. From
# the Mac, `npm run dev:vm` shells in here via Lima; edit on the Mac as usual,
# the repo is shared into the VM at the identical path.
set -euo pipefail

# The virtiofs share's inotify forwarding drops events, so poll instead, or the
# dev server silently keeps running stale code (see nuxt.config.ts watchers).
export KNECHT_DEV_POLLING=1

# Off the common 3000 so Knecht dev never blocks other projects on the Mac
# (Lima forwards it as-is: UI http://localhost:3333, previews
# http://<runId>.preview.lvh.me:3333). Override with KNECHT_DEV_PORT.
exec bash "$(dirname "$0")/dev-compose.sh" up --build
