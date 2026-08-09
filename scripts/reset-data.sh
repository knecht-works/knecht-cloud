#!/usr/bin/env bash
# Reset all user data back to a fresh state: deletes every project, workflow,
# run and trigger, including their on-disk traces (run environments, checkouts,
# archives, dumps, shared folders). Instance setup is KEPT: the GitHub App,
# members, Jira connection, settings and AI key survive, so the instance does
# not fall back into the first-run setup flow. Starter workflows are re-seeded
# on the next boot.
#
# Honors the same env vars as the app (KNECHT_DB_PATH, KNECHT_DATA_DIR,
# KNECHT_PROJECTS). Needs sqlite3; run it where the app runs (dev VM or prod
# host), ideally with the app stopped, then restart the app.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_PATH="${KNECHT_DB_PATH:-.data/knecht.db}"
DATA_DIR="${KNECHT_DATA_DIR:-.data}"
PROJECTS_DIR="${KNECHT_PROJECTS:-/data/knecht/projects}"

if [[ "${1:-}" != "-y" ]]; then
  echo "This deletes ALL projects, workflows, runs and triggers:"
  echo "  - DB rows in $DB_PATH"
  echo "  - run environments (ddev stacks knecht-run-*)"
  echo "  - run checkouts under $PROJECTS_DIR"
  echo "  - $DATA_DIR/{archives,dumps,shared}"
  echo "Setup (GitHub App, members, settings, AI key) is kept."
  read -r -p "Continue? [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Aborted."; exit 1; }
fi

# Collect run ids from every place a run leaves traces (DB rows, checkout dirs,
# docker labels, including the legacy Sysbox label), mirroring the sweep in
# server/daemon/gc.ts, then tear down each environment by name the same way
# removeEnvStack (server/daemon/sandbox.ts) does.
run_ids=$(
  {
    if [[ -f "$DB_PATH" ]]; then sqlite3 "$DB_PATH" 'SELECT id FROM runs' 2>/dev/null || true; fi
    ls "$PROJECTS_DIR" 2>/dev/null | sed -n 's/^run-\([0-9]\{1,\}\)$/\1/p'
    docker ps -a --filter label=com.ddev.site-name --format '{{.Label "com.ddev.site-name"}}' 2>/dev/null | sed -n 's/^knecht-run-\([0-9]\{1,\}\)$/\1/p'
    docker ps -a --filter label=knecht.run --format '{{.Names}}' 2>/dev/null | sed -n 's/^knecht-run-\([0-9]\{1,\}\)$/\1/p'
  } | sort -un
)

for id in $run_ids; do
  name="knecht-run-$id"
  echo "Removing environment $name"
  DDEV_NONINTERACTIVE=true ddev delete --omit-snapshot -y "$name" >/dev/null 2>&1 || true
  containers=$(docker ps -aq --filter "label=com.ddev.site-name=$name" 2>/dev/null || true)
  if [[ -n "$containers" ]]; then docker rm -f $containers >/dev/null; fi
  volumes=$(docker volume ls -q --filter "label=com.ddev.site-name=$name" 2>/dev/null || true)
  if [[ -n "$volumes" ]]; then docker volume rm -f $volumes >/dev/null; fi
  docker rm -f "$name" >/dev/null 2>&1 || true
done

if [[ -f "$DB_PATH" ]]; then
  echo "Clearing DB rows in $DB_PATH"
  sqlite3 "$DB_PATH" >/dev/null <<'SQL'
PRAGMA busy_timeout = 5000;
DELETE FROM followups;
DELETE FROM run_steps;
DELETE FROM runs;
DELETE FROM triggers;
DELETE FROM workflows;
DELETE FROM projects;
UPDATE settings SET workflows_seeded = 0;
SQL
fi

echo "Removing run checkouts and per-project data dirs"
find "$PROJECTS_DIR" -maxdepth 1 -type d -name 'run-*' -exec rm -rf {} + 2>/dev/null || true
rm -rf "$DATA_DIR/archives" "$DATA_DIR/dumps" "$DATA_DIR/shared"

echo "Done. Restart the app to re-seed the starter workflows."
