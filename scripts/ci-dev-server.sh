#!/usr/bin/env bash
# Start the dev container for a CI e2e job and wait until it answers.
# Shared by the api and boot jobs in .github/workflows/e2e.yml so startup
# fixes land once.
#
# Generates the per-job secrets: the dev login gate and the session key need
# no configured values, only agreement between server and tests, so
# KNECHT_TEST_AUTH is exported to the job env for the test step.
#
# The readiness probe stays diagnosable: on failure it prints the last probe
# result and the container log. Never `curl -f >/dev/null` here; that once
# swallowed a 403 for three CI runs straight.
set -euo pipefail

KNECHT_TEST_AUTH="$(openssl rand -hex 16)"
export KNECHT_TEST_AUTH
export NUXT_SESSION_PASSWORD="$(openssl rand -hex 32)"
echo "::add-mask::$KNECHT_TEST_AUTH"
echo "KNECHT_TEST_AUTH=$KNECHT_TEST_AUTH" >> "$GITHUB_ENV"

bash scripts/dev-compose.sh up -d --build

code=""
for _ in $(seq 1 180); do
  code=$(curl -sS --resolve lvh.me:3333:127.0.0.1 -o /tmp/probe.body -w '%{http_code}' http://lvh.me:3333/api/_setup/status 2>/tmp/probe.err || true)
  [ "$code" = "200" ] && exit 0
  sleep 2
done

echo "::error::Dev server never became ready"
echo "--- last probe: HTTP=$code"
cat /tmp/probe.err 2>/dev/null || true
head -c 300 /tmp/probe.body 2>/dev/null || true
echo "--- dev log:"
bash scripts/dev-compose.sh logs --tail 100 knecht
exit 1
