#!/usr/bin/env bash
# docker compose for the dev container (docker-compose.dev.yml), on a Linux
# host with Docker: the dev VM and the e2e CI runners. Prepares the state dirs
# and passes the arguments on, e.g. `scripts/dev-compose.sh up --build`.
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(uname -s)" = "Linux" ] || { echo "Run inside the VM:  npm run dev:vm"; exit 1; }

export KNECHT_DATA_DIR="${KNECHT_DATA_DIR:-$HOME/.knecht-dev/.data}"
export KNECHT_DB_PATH="${KNECHT_DB_PATH:-$KNECHT_DATA_DIR/knecht.db}"
export KNECHT_PROJECTS="${KNECHT_PROJECTS:-/data/knecht/projects}"
export DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"

# The container runs as uid 1000 (as in production); the host user keeps
# access for sqlite3, scripts/reset-data.sh and debugging.
if [ ! -f "$KNECHT_DATA_DIR/.dev-acl" ]; then
  command -v setfacl >/dev/null || sudo apt-get install -y -qq acl
  sudo mkdir -p "$KNECHT_DATA_DIR/.ddev" "$KNECHT_PROJECTS"
  for dir in "$KNECHT_DATA_DIR" "$KNECHT_PROJECTS"; do
    sudo setfacl -R -m "u:1000:rwX,u:$(id -u):rwX" "$dir"
    sudo setfacl -R -d -m "u:1000:rwX,u:$(id -u):rwX" "$dir"
  done
  touch "$KNECHT_DATA_DIR/.dev-acl"
fi

[ -f .env ] || touch .env

exec docker compose -f docker-compose.yml -f docker-compose.dev.yml "$@"
