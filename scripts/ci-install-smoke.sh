#!/usr/bin/env bash
# The install smoke (.github/workflows/install.yml), run as root on a fresh
# host: install exactly the way a new user does (curl | bash, no checkout),
# update to an image built from <ref> the way the in-app updater does, then
# assert: a host with nothing but Docker, the app answering unconfigured and
# warming up its ddev, and a routerless ddev project booted by the app's ddev
# with its web container reachable by IP (what every run and preview depends on).
#
#   scripts/ci-install-smoke.sh <owner/repo> <ref> [<ref to install first>]
set -euo pipefail

REPO="$1"
REF="$2"
FROM_REF="${3:-$REF}"

logs() { docker compose --project-directory /opt/knecht logs --tail 100 knecht || true; }

if [ -n "${SMOKE_TAKEN_UID:-}" ]; then
  echo "▶ Handing uid $SMOKE_TAKEN_UID to another user first"
  useradd --uid "$SMOKE_TAKEN_UID" --no-create-home provisioned
fi

echo "▶ Installing $FROM_REF"
curl -fsSL "https://raw.githubusercontent.com/$REPO/$FROM_REF/scripts/install.sh" \
  | KNECHT_DOMAIN=knecht.invalid KNECHT_REF="$FROM_REF" bash

KNECHT_UID=$(sed -n 's/^KNECHT_UID=//p' /opt/knecht/.env)
KNECHT_UID=${KNECHT_UID:-1000}
echo "Knecht runs as uid $KNECHT_UID"
if [ -n "${SMOKE_TAKEN_UID:-}" ] && [ "$KNECHT_UID" = "$SMOKE_TAKEN_UID" ]; then
  echo "::error::The installer picked the taken uid $SMOKE_TAKEN_UID"; exit 1
fi

if [ "$FROM_REF" = "$REF" ]; then
  docker --version
  if command -v ddev; then echo "::error::ddev is installed on the host"; exit 1; fi
fi

# What the updater does (server/daemon/update.ts), with a locally built image
# in place of the release pull.
echo "▶ Updating to an image built from $REF"
cd /opt/knecht
git fetch -q origin "$REF"
git checkout -qf FETCH_HEAD
apt-get install -y -qq docker-buildx-plugin >/dev/null
docker build -q -t ghcr.io/knecht-works/knecht-cloud:ci .
sed -i 's/^KNECHT_VERSION=.*/KNECHT_VERSION=ci/' .env
docker compose up -d

echo "▶ Waiting for the app"
code=""
for i in $(seq 1 60); do
  code=$(curl -s -o /tmp/status.json -w '%{http_code}' http://127.0.0.1:3000/api/_setup/status 2>/dev/null || true)
  [ "$code" = "200" ] && break
  sleep 2
done
if [ "$code" != "200" ]; then
  echo "::error::App never answered (last probe: HTTP=$code)"
  logs
  exit 1
fi
grep -q '"configured": *false' /tmp/status.json
echo "app ok:" && head -c 200 /tmp/status.json && echo

echo "▶ Waiting for the ddev warm-up"
for i in $(seq 1 300); do
  [ -f /data/knecht/data/ddev-warmed ] && break
  sleep 2
done
if [ ! -f /data/knecht/data/ddev-warmed ]; then
  echo "::error::No ddev warm-up"
  logs
  exit 1
fi
want=$(sed -n 's/^ARG DDEV_VERSION=//p' /opt/knecht/Dockerfile)
grep -F "v$want" /data/knecht/data/ddev-warmed

echo "▶ Booting a routerless ddev project"
mkdir -p /data/knecht/projects/spike/public
echo '<?php echo "spike-ok";' > /data/knecht/projects/spike/public/index.php
chown -R "$KNECHT_UID:$KNECHT_UID" /data/knecht/projects/spike
ddev() { docker compose --project-directory /opt/knecht exec -T -e DDEV_NONINTERACTIVE=true -w /data/knecht/projects/spike knecht ddev "$@"; }
ddev config --project-type=php --docroot=public --project-name=spike --nodejs-version=22
ddev start -y
IP=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{if $v.IPAddress}}{{$v.IPAddress}} {{end}}{{end}}' ddev-spike-web | awk '{print $1}')
curl -fsS -m 10 -H 'Host: whatever.example.com' "http://$IP/" | grep -F spike-ok
echo "web container ok at $IP"
ddev delete --omit-snapshot -y spike
