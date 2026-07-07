#!/usr/bin/env bash
# Install Knecht on a fresh Ubuntu 24.04 server (amd64). Idempotent: re-run it
# to repair or resume a broken install. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/knecht-works/knecht-cloud/main/scripts/install.sh | bash
#
# Non-interactive: KNECHT_DOMAIN=knecht.example.com bash install.sh
# Testing only: KNECHT_REF=<branch/tag> checks out that ref instead of the
# latest release (the pinned image tag then stays `latest`).
#
# What it does:
#   1. Reserves uid 1000 (the `knecht` user): the control-plane container runs
#      as uid 1000, the sandbox's inner user is baked to match, and both own
#      the shared state dirs.
#   2. Clones the repo to /opt/knecht at the newest release tag (compose file,
#      Caddyfile, scripts live there; the app itself runs from the GHCR image).
#   3. Provisions the host: pinned Docker, Sysbox, the knecht-sandbox image,
#      the registry cache (scripts/provision-host.sh).
#   4. Writes /opt/knecht/.env (asks one question: your domain).
#   5. Pulls and starts the app + the caddy TLS entry point.
set -euo pipefail

INSTALL_DIR="/opt/knecht"
DATA_DIR="/data/knecht/data"
PROJECTS_DIR="/data/knecht/projects"
REPO_URL="https://github.com/knecht-works/knecht-cloud"

say() { echo "▶ $*"; }
ok()  { echo "✓ $*"; }
die() { echo "✗ $*" >&2; exit 1; }

# ── 0. Guards ─────────────────────────────────────────────────────────────────
[ "$(id -u)" = 0 ] || die "Run as root (the script provisions Docker and system users)"
[ "$(uname -s)" = "Linux" ] || die "Knecht runs on Linux servers only"
if [ -r /etc/os-release ]; then
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || die "This installer targets Ubuntu (found: ${ID:-unknown})"
  [ "${VERSION_ID:-}" = "24.04" ] || echo "⚠ Tested on Ubuntu 24.04, found $VERSION_ID. Continuing anyway."
fi
case "$(dpkg --print-architecture)" in
  amd64) ;;
  *) die "Release images are built for amd64 only (found: $(dpkg --print-architecture))" ;;
esac

say "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl >/dev/null

# ── 1. uid 1000 ───────────────────────────────────────────────────────────────
# The control-plane container's `node` user is uid 1000 and the sandbox image
# is built to match (provision step below). The host-side `knecht` user exists
# so uid 1000 is reserved and `ls -l` on the state dirs reads sensibly.
if id -u knecht >/dev/null 2>&1; then
  [ "$(id -u knecht)" = 1000 ] || die "User 'knecht' exists but is not uid 1000"
  ok "User knecht (uid 1000) exists"
elif getent passwd 1000 >/dev/null; then
  die "uid 1000 is taken by '$(getent passwd 1000 | cut -d: -f1)'. Knecht needs uid 1000 (fresh servers have it free); use a clean host or free the uid."
else
  say "Creating user knecht (uid 1000)"
  useradd --uid 1000 --create-home --shell /usr/sbin/nologin knecht
fi

# ── 2. The repo checkout ──────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating existing checkout in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --tags origin
else
  say "Cloning $REPO_URL to $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

if [ -n "${KNECHT_REF:-}" ]; then
  TAG="$KNECHT_REF"
  IMAGE_TAG="latest"
  echo "⚠ KNECHT_REF=$KNECHT_REF (testing mode, image tag: latest)"
else
  TAG="$(git -C "$INSTALL_DIR" describe --tags "$(git -C "$INSTALL_DIR" rev-list --tags --max-count=1 2>/dev/null)" 2>/dev/null || true)"
  [ -n "$TAG" ] || die "No release tag found. There is no published Knecht release yet."
  IMAGE_TAG="$TAG"
fi
say "Checking out $TAG"
git -C "$INSTALL_DIR" checkout -qf "$TAG"

# ── 3. Provision the host ─────────────────────────────────────────────────────
# Docker (pinned), Sysbox, daemon.json, the sandbox image (built for uid 1000),
# the registry cache + warm-up. Idempotent; by far the longest step.
KNECHT_UID=1000 KNECHT_GID=1000 KNECHT_PROJECTS="$PROJECTS_DIR" \
  bash "$INSTALL_DIR/scripts/provision-host.sh"

say "Creating $DATA_DIR"
mkdir -p "$DATA_DIR"
chown -R 1000:1000 "$DATA_DIR"

# ── 4. .env ───────────────────────────────────────────────────────────────────
if [ -f "$INSTALL_DIR/.env" ]; then
  ok ".env exists, keeping it"
else
  DOMAIN="${KNECHT_DOMAIN:-}"
  if [ -z "$DOMAIN" ]; then
    printf "Domain for this instance (e.g. knecht.example.com): "
    read -r DOMAIN < /dev/tty
  fi
  [ -n "$DOMAIN" ] || die "A domain is required (GitHub login and previews depend on it)"

  say "Writing $INSTALL_DIR/.env"
  cat > "$INSTALL_DIR/.env" <<EOF
# Written by scripts/install.sh. Keys are documented in .env.example.
KNECHT_BASE_DOMAIN=$DOMAIN
NUXT_SESSION_PASSWORD=$(openssl rand -base64 32)
DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
KNECHT_PROJECTS=$PROJECTS_DIR
KNECHT_DATA_DIR=$DATA_DIR
KNECHT_DB_PATH=$DATA_DIR/knecht.db
KNECHT_INSTALL_DIR=$INSTALL_DIR
KNECHT_VERSION=$IMAGE_TAG
COMPOSE_PROFILES=prod
EOF
  chmod 600 "$INSTALL_DIR/.env"
fi

# ── 5. Pull + start ───────────────────────────────────────────────────────────
say "Starting Knecht"
cd "$INSTALL_DIR"   # project name `knecht` derives from this dir; the updater relies on it
docker compose pull -q
docker compose up -d

DOMAIN="$(grep '^KNECHT_BASE_DOMAIN=' "$INSTALL_DIR/.env" | cut -d= -f2)"
IP="$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || echo '<server-ip>')"
echo
ok "Knecht is running."
echo
echo "Next steps:"
echo "  1. DNS records (both pointing at this server):"
echo "       A  $DOMAIN            -> $IP"
echo "       A  *.preview.$DOMAIN  -> $IP"
echo "  2. Ports 80 and 443 must be reachable (check your cloud firewall)."
echo "  3. Open https://$DOMAIN and complete the GitHub App setup."
echo
echo "Useful: docker compose -f $INSTALL_DIR/docker-compose.yml logs -f knecht"
