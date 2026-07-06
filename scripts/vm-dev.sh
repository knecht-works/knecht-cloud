#!/usr/bin/env bash
# Run the Knecht dev server INSIDE the Linux dev VM, the only place it can
# run, since the per-run sandboxes need Sysbox (run-isolation.md §9). From the
# Mac, `npm run dev:vm` shells in here via Lima; edit on the Mac as usual, the
# repo is shared into the VM at the identical path.
#
# The repo dir is shared macOS↔VM, so platform-specific artifacts must not be:
# VM-local dirs are bind-mounted over node_modules/.nuxt/.data, keeping the
# Linux build (native modules, Vite cache, SQLite) apart from the Mac's.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$HOME/.knecht-dev"

[ "$(uname -s)" = "Linux" ] || { echo "Run inside the VM:  npm run dev:vm"; exit 1; }

# Node 22 (dev-only dependency of the VM; prod hosts run Knecht as a container).
if ! command -v node >/dev/null; then
  echo "▶ Installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs
fi
# npm 11: the lockfile's generator; npm 10 resolves it differently (same pin
# as NPM_VERSION in the Dockerfile).
case "$(npm --version)" in 11.*) ;; *) sudo npm i -g npm@11 >/dev/null ;; esac

for d in node_modules .nuxt .data; do
  mkdir -p "$STATE/$d" "$REPO/$d"
  mountpoint -q "$REPO/$d" || sudo mount --bind "$STATE/$d" "$REPO/$d"
done

cd "$REPO"
[ -f node_modules/.package-lock.json ] || npm ci

# VM-correct values take precedence over whatever the shared .env carries
# (dotenv never overrides an existing process env var).
export KNECHT_PROJECTS="${KNECHT_PROJECTS:-/data/knecht/projects}"

# The virtiofs share's inotify forwarding drops events, so poll instead, or the
# dev server silently keeps running stale code (see nuxt.config.ts watchers).
export KNECHT_DEV_POLLING=1

# Off the common 3000 so Knecht dev never blocks other projects on the Mac
# (Lima forwards it as-is: UI http://localhost:3333, previews
# http://<runId>.preview.lvh.me:3333). Override with KNECHT_DEV_PORT.
exec npm run dev -- --port "${KNECHT_DEV_PORT:-3333}"
