#!/usr/bin/env bash
# Start the Nuxt dev server for a CI e2e job and wait until it answers.
# Shared by the api and boot jobs in .github/workflows/e2e.yml so startup
# fixes land once (this block has needed several: IPv4 bind, lvh.me
# resolution, allowedHosts).
#
# Generates the per-job secrets: the dev login gate and the session key need
# no configured values, only agreement between server and tests, so
# KNECHT_TEST_AUTH is exported to the job env for the test step.
#
# The readiness probe stays diagnosable: on failure it prints the last probe
# result, resolution/listeners and the dev log. Never `curl -f >/dev/null`
# here; that once swallowed a 403 for three CI runs straight.
set -euo pipefail

KNECHT_TEST_AUTH="$(openssl rand -hex 16)"
export KNECHT_TEST_AUTH
export NUXT_SESSION_PASSWORD="$(openssl rand -hex 32)"
echo "::add-mask::$KNECHT_TEST_AUTH"
echo "KNECHT_TEST_AUTH=$KNECHT_TEST_AUTH" >> "$GITHUB_ENV"

# Explicit IPv4 bind: the default localhost bind can land on ::1 only, while
# lvh.me is pinned to 127.0.0.1 in /etc/hosts.
npx nuxt dev --host 127.0.0.1 --port 3333 > /tmp/knecht-dev.log 2>&1 &

code=""
for _ in $(seq 1 90); do
  code=$(curl -sS -o /tmp/probe.body -w '%{http_code}' http://lvh.me:3333/api/_setup/status 2>/tmp/probe.err || true)
  [ "$code" = "200" ] && exit 0
  sleep 2
done

echo "::error::Dev server never became ready"
echo "--- last probe: HTTP=$code"
cat /tmp/probe.err 2>/dev/null || true
head -c 300 /tmp/probe.body 2>/dev/null || true
echo "--- resolution/listeners:"
getent hosts lvh.me || echo "lvh.me does not resolve"
ss -tlnp 2>/dev/null | grep 3333 || echo "nothing listening on 3333"
echo "--- dev log:"
tail -50 /tmp/knecht-dev.log
exit 1
