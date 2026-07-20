#!/usr/bin/env bash
# Provision a Linux host as a Knecht substrate: the production VPS and the
# local dev VM run the SAME script.
#
#   1. Docker Engine (any current version; no pin, no special runtime)
#   2. the ddev CLI, pinned (it boots the per-run envs on the host daemon)
#   3. the fixed projects dir + docker group for the invoking user
#   4. ddev global config: router + ssh-agent omitted (the preview proxy
#      targets each run's web container directly; a router would collide
#      with Caddy on :80/:443)
#   5. warm-up: a throwaway ddev project pulls the web/db images once per
#      host (all runs share them) and seeds ddev's global cache volume, so
#      parallel first starts never race on its initialization
#
# Idempotent, safe to re-run. Usage (from the repo, with sudo rights):
#   ./scripts/provision-host.sh
set -euo pipefail

DDEV_VERSION="1.25.2"
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
  # Earlier installs pinned Docker for Sysbox; the pin is obsolete now.
  sudo apt-mark unhold docker-ce docker-ce-cli >/dev/null 2>&1 || true
else
  echo "▶ Installing Docker"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# ── 2. ddev CLI, pinned ───────────────────────────────────────────────────────
# Runs are only as reproducible as this version, and the warmed image cache
# must match it. Keep DDEV_VERSION in step with the Dockerfile; bump both
# deliberately, then re-provision so the cache follows.
if ddev --version 2>/dev/null | grep -q "$DDEV_VERSION"; then
  echo "✓ ddev $DDEV_VERSION already installed"
else
  echo "▶ Installing ddev $DDEV_VERSION"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://pkg.ddev.com/apt/gpg.key | sudo gpg --dearmor --yes -o /etc/apt/keyrings/ddev.gpg
  echo "deb [signed-by=/etc/apt/keyrings/ddev.gpg] https://pkg.ddev.com/apt/ * *" \
    | sudo tee /etc/apt/sources.list.d/ddev.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq "ddev=${DDEV_VERSION}" || sudo apt-get install -y -qq --allow-downgrades "ddev=${DDEV_VERSION}"
  sudo apt-mark hold ddev
fi

# ── 3. Projects dir + docker group ────────────────────────────────────────────
sudo mkdir -p "$PROJECTS_DIR"
sudo chown "$KNECHT_UID:$KNECHT_GID" "$PROJECTS_DIR"
if ! id -nG | grep -qw docker; then
  echo "▶ Adding $(id -un) to the docker group (re-login to take effect)"
  sudo usermod -aG docker "$(id -un)"
fi

# ── 4. ddev global config + warm-up ───────────────────────────────────────────
# ddev refuses to run as root, and install.sh runs this script as root: the
# ddev steps then run as the `knecht` user (uid 1000, created by install.sh).
# On the dev VM the script runs as the invoking user directly.
if [ "$(id -u)" = 0 ]; then
  WARM_USER="knecht"
  id -u "$WARM_USER" >/dev/null 2>&1 || { echo "User knecht missing (install.sh creates it)"; exit 1; }
  usermod -aG docker "$WARM_USER"
  as_warm_user() { runuser -u "$WARM_USER" -- env HOME="$(getent passwd "$WARM_USER" | cut -d: -f6)" DDEV_NONINTERACTIVE=true "$@"; }
else
  WARM_USER="$(id -un)"
  # `sg docker` so a just-added group membership works without re-login.
  as_warm_user() { sg docker -c "DDEV_NONINTERACTIVE=true $*" 2>/dev/null || env DDEV_NONINTERACTIVE=true "$@"; }
fi
WARM_HOME="$(getent passwd "$WARM_USER" | cut -d: -f6)"

# The global config MUST omit the router before the first start: a router
# would bind host ports 80/443, which belong to Caddy. The containerized app
# writes the same config for its own user at boot (server/plugins/agent-tools.ts).
sudo -u "$WARM_USER" mkdir -p "$WARM_HOME/.ddev" 2>/dev/null || mkdir -p "$WARM_HOME/.ddev"
if ! grep -q ddev-router "$WARM_HOME/.ddev/global_config.yaml" 2>/dev/null; then
  printf 'omit_containers: [ddev-router, ddev-ssh-agent]\nperformance_mode: none\ninstrumentation_opt_in: false\n' \
    | sudo -u "$WARM_USER" tee -a "$WARM_HOME/.ddev/global_config.yaml" >/dev/null
fi

# One throwaway project start pulls the ddev web/db images (shared by every
# run on this host) and initializes the ddev-global-cache volume (mkcert CA
# etc.), whose first-time setup is NOT safe under parallel project starts.
echo "▶ Warming the ddev image cache (throwaway project)"
WARMUP="$(mktemp -d)"
mkdir -p "$WARMUP/public"
echo '<?php echo "knecht-warmup";' > "$WARMUP/public/index.php"
chown -R "$WARM_USER" "$WARMUP" 2>/dev/null || true
(
  cd "$WARMUP"
  as_warm_user ddev config --project-type=php --docroot=public --project-name=knecht-warmup
  as_warm_user ddev start -y
  as_warm_user ddev delete --omit-snapshot -y knecht-warmup
)
rm -rf "$WARMUP"

# Leftovers from pre-DooD installs (the per-run Sysbox substrate): the pinned
# registry cache is dead weight now that images live once on the host daemon.
sudo docker rm -f knecht-registry >/dev/null 2>&1 || true

echo "✓ Host provisioned. Sanity check:"
sudo docker info --format '  docker {{.ServerVersion}}'
ddev --version | sed 's/^/  /'
