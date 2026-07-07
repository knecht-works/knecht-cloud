#!/usr/bin/env bash
# Provision a Linux host as a Knecht substrate: the production VPS and the
# local dev VM run the SAME script (run-isolation.md §9: one substrate).
#
#   1. Docker Engine, pinned (Docker 29 breaks under sysbox-runc, §11)
#   2. Sysbox CE (the per-run sandbox runtime, §7)
#   3. daemon.json: register sysbox-runc + widen the network pool (each run's
#      sandbox takes a bridge network on the host side)
#   4. the fixed projects dir + docker group for the invoking user
#   5. the knecht-sandbox image (sandbox/Dockerfile)
#
# Idempotent, safe to re-run. Usage (from the repo, with sudo rights):
#   ./scripts/provision-host.sh
set -euo pipefail

DOCKER_VERSION="27.5.1"
SYSBOX_VERSION="0.7.0"
PROJECTS_DIR="${KNECHT_PROJECTS:-/data/knecht/projects}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="$(dpkg --print-architecture)"
# Owner of the projects dir and uid/gid baked into the sandbox image. Defaults
# to the invoking user (the dev VM case). install.sh runs as root and passes
# 1000/1000 explicitly: the control-plane container's `node` user is uid 1000,
# and both sides must agree on the worktrees they share.
KNECHT_UID="${KNECHT_UID:-$(id -u)}"
KNECHT_GID="${KNECHT_GID:-$(id -g)}"

[ "$(uname -s)" = "Linux" ] || { echo "This provisions a LINUX host (on macOS: run it inside the VM)"; exit 1; }

# ── 1. Docker, pinned ─────────────────────────────────────────────────────────
if docker --version 2>/dev/null | grep -q "$DOCKER_VERSION"; then
  echo "✓ Docker $DOCKER_VERSION already installed"
else
  echo "▶ Installing Docker $DOCKER_VERSION"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
  echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  PIN="$(apt-cache madison docker-ce | awk -v v="$DOCKER_VERSION" '$3 ~ v {print $3; exit}')"
  [ -n "$PIN" ] || { echo "Docker $DOCKER_VERSION not in the apt repo for this distro"; exit 1; }
  sudo apt-get install -y -qq "docker-ce=$PIN" "docker-ce-cli=$PIN" containerd.io
  sudo apt-mark hold docker-ce docker-ce-cli
fi

# ── 2. Sysbox ─────────────────────────────────────────────────────────────────
if command -v sysbox-runc >/dev/null; then
  echo "✓ Sysbox already installed ($(sysbox-runc --version | head -1))"
else
  echo "▶ Installing Sysbox CE $SYSBOX_VERSION"
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/sysbox.deb" \
    "https://downloads.nestybox.com/sysbox/releases/v${SYSBOX_VERSION}/sysbox-ce_${SYSBOX_VERSION}-0.linux_${ARCH}.deb"
  sudo apt-get install -y -qq "$TMP/sysbox.deb"
  rm -rf "$TMP"
fi

# ── 3. Register the runtime + network pool ────────────────────────────────────
# bip/pools: the INNER dockerd (in every sandbox) uses Docker's stock 172.17/16
# defaults. Keep the HOST's bridges out of that range so routing inside the
# sandboxes never collides with the host side.
if [ -f /etc/docker/daemon.json ] && grep -q sysbox-runc /etc/docker/daemon.json; then
  echo "✓ sysbox-runc already registered with Docker"
else
  echo "▶ Writing /etc/docker/daemon.json + restarting Docker"
  sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
    "runtimes": {
        "sysbox-runc": {
            "path": "/usr/bin/sysbox-runc"
        }
    },
    "bip": "172.20.0.1/16",
    "default-address-pools": [
        {
            "base": "172.25.0.0/16",
            "size": 24
        }
    ]
}
EOF
  sudo systemctl restart docker
fi

# ── 4. Projects dir + docker group ────────────────────────────────────────────
sudo mkdir -p "$PROJECTS_DIR"
sudo chown "$KNECHT_UID:$KNECHT_GID" "$PROJECTS_DIR"
if ! id -nG | grep -qw docker; then
  echo "▶ Adding $(id -un) to the docker group (re-login to take effect)"
  sudo usermod -aG docker "$(id -un)"
fi

# ── 5. The sandbox image ──────────────────────────────────────────────────────
# Built with the invoking user's uid/gid: the sandbox's `ddev` user must own
# the bind-mounted worktrees the Knecht process creates (see sandbox/Dockerfile).
echo "▶ Building knecht-sandbox (sandbox/Dockerfile, uid $KNECHT_UID:$KNECHT_GID)"
sudo docker build -t knecht-sandbox \
  --build-arg "KNECHT_UID=$KNECHT_UID" --build-arg "KNECHT_GID=$KNECHT_GID" \
  "$REPO_DIR/sandbox"

# ── 6. Local registry cache + warm-up ─────────────────────────────────────────
# A fresh sandbox pulls ~1GB of ddev images on its first `ddev start`, minutes
# per run from the internet. A pull-through cache on the host's bridge IP (the
# `bip` pinned in step 3) serves them LAN-local instead; every sandbox's inner
# daemon is configured to use it (sandbox/Dockerfile). The warm-up seed fills
# the cache for the ddev version pinned into the image, once per provisioning.
# (Baking the images INTO the sandbox image via docker commit corrupts inner
# layer ownership without shiftfs, and kernels ≥6.8 don't ship it. Don't retry.)
if ! sudo docker ps --format '{{.Names}}' | grep -qx knecht-registry; then
  echo "▶ Starting the local registry cache"
  sudo docker rm -f knecht-registry >/dev/null 2>&1 || true
  sudo docker run -d --name knecht-registry --restart unless-stopped \
    -e REGISTRY_PROXY_REMOTEURL=https://registry-1.docker.io \
    -v knecht-registry:/var/lib/registry \
    -p 172.20.0.1:5000:5000 registry:3 >/dev/null
fi

echo "▶ Warming the image cache (seed sandbox pulls ddev's images once)"
sudo docker rm -f knecht-sandbox-seed >/dev/null 2>&1 || true
sudo docker run -d --name knecht-sandbox-seed --runtime=sysbox-runc knecht-sandbox >/dev/null
for i in $(seq 1 60); do
  sudo docker exec knecht-sandbox-seed docker info >/dev/null 2>&1 && break
  sleep 1
done
sudo docker exec -u ddev -e HOME=/home/ddev -e USER=ddev knecht-sandbox-seed \
  ddev utility download-images
sudo docker rm -f knecht-sandbox-seed >/dev/null

echo "✓ Host provisioned. Sanity check:"
sudo docker info --format '  docker {{.ServerVersion}} · runtimes: {{range $k, $v := .Runtimes}}{{$k}} {{end}}'
