#!/usr/bin/env bash
# Provision a Linux host as a Knecht substrate: the production VPS and the
# local dev VM run the SAME script.
#
#   1. Docker Engine (any current version; no pin, no special runtime)
#   2. the fixed projects dir + docker group for the invoking user
#
# Nothing else lives on the host: the ddev CLI, its global config and the
# image warm-up come with the Knecht image (server/plugins/agent-tools.ts).
#
# Idempotent, safe to re-run. Usage (from the repo, with sudo rights):
#   ./scripts/provision-host.sh
set -euo pipefail

PROJECTS_DIR="${KNECHT_PROJECTS:-/data/knecht/projects}"
# Owner of the projects dir. Defaults to the invoking user (the dev VM case).
# install.sh runs as root and passes 1000/1000 explicitly: the control-plane
# container's `node` user is uid 1000, and both sides must agree on the
# worktrees they share (ddev bakes the same uid into each project's web image).
KNECHT_UID="${KNECHT_UID:-$(id -u)}"
KNECHT_GID="${KNECHT_GID:-$(id -g)}"

[ "$(uname -s)" = "Linux" ] || { echo "This provisions a LINUX host (on macOS: run it inside the VM)"; exit 1; }

# ── 1. Docker ─────────────────────────────────────────────────────────────────
if command -v docker >/dev/null; then
  echo "✓ Docker already installed ($(docker --version))"
else
  echo "▶ Installing Docker"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# ── 2. Projects dir + docker group ────────────────────────────────────────────
sudo mkdir -p "$PROJECTS_DIR"
sudo chown "$KNECHT_UID:$KNECHT_GID" "$PROJECTS_DIR"
if ! id -nG | grep -qw docker; then
  echo "▶ Adding $(id -un) to the docker group (re-login to take effect)"
  sudo usermod -aG docker "$(id -un)"
fi

echo "✓ Host provisioned:"
sudo docker info --format '  docker {{.ServerVersion}}'
