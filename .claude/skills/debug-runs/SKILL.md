---
name: debug-runs
description: Inspect what actually happened during a Knecht run or follow-up in dev. Use whenever a run/step/follow-up behaved unexpectedly (wrong result, "success" but nothing happened, SQLITE_ERROR, agent did nothing) and you need to read the live dev DB, step logs, sandbox containers, or the opencode session inside a sandbox.
---

# Debug a Knecht run (dev)

Dev runs inside the Lima VM `knecht-dev`. Everything below is one layer deeper
than the repo, so go straight to the right layer instead of rediscovering it.

## Layer 1: the live dev database (NOT the repo's .data/)

The repo's `.data/knecht.db` on the Mac is stale. The live dev DB is VM-local:
`~/.knecht-dev/.data/knecht.db` (bind-mounted over the checkout by
`scripts/vm-dev.sh`).

```bash
limactl shell knecht-dev -- bash -c 'sqlite3 "$HOME/.knecht-dev/.data/knecht.db" "<SQL>"'
```

Gotcha: quote the path via `$HOME` inside `bash -c`. A literal `~/...` after
`limactl shell --` gets expanded by the LOCAL zsh to `/Users/...` and fails.

Useful queries:
- Run overview: `SELECT id, status, branch, env_state FROM runs WHERE id=<id>;`
- Steps + logs: `SELECT id, step_id, type, origin, status, error FROM run_steps WHERE run_id=<id> ORDER BY id;`
  then `SELECT log FROM run_steps WHERE id=<stepId>;` (per-step log, capped 256K).
  `origin` is `workflow` or `followup`.
- Follow-ups: `SELECT * FROM followups WHERE run_id=<id>;`
- Applied migrations: `SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 3;`
  Compare against `when` in `server/db/migrations/meta/_journal.json`. Drizzle
  only applies entries with `when` GREATER than the last applied `created_at`,
  so a renumbered/rebased migration with an old timestamp is SILENTLY SKIPPED
  (symptom: runtime SQLITE_ERROR "no such table/column"). Fix: bump its `when`.

Timestamps are unix seconds: `datetime(started_at, 'unixepoch')`.

## Layer 2: the run's sandbox container

One container per run, named `knecht-run-<runId>`, running under sysbox:

```bash
limactl shell knecht-dev -- docker ps
limactl shell knecht-dev -- docker exec -u ddev knecht-run-<id> bash -c '<cmd>'
```

The checkout is `/project`. The ai step's prompt files are
`/tmp/knecht-ai-<runId>-<timestamp>.txt` (one per invocation, BECAUSE of the
`docker cp` gotcha below), structured output goes to
`/tmp/knecht-ai-out-<runId>.json`.

Gotcha (sysbox): `docker cp` INTO the container reports exit 0 but does NOT
overwrite an existing file, and cannot read files a process wrote into the
container. Verify writes with `docker exec cat`, and prefer exec for both
directions.

## Layer 3: what the agent (opencode) actually did

opencode state lives in the sandbox at `/home/ddev/.local/share/opencode/`:
- `log/opencode.log`: one line per lifecycle event. "created id=ses_..." means
  a NEW session (so `--continue` had nothing to continue). A `stream ...` line
  with nothing after it means the LLM turn ended without activity.
- `opencode.db` (sqlite): the conversation. No sqlite3 in the sandbox, so
  export it first:

```bash
limactl shell knecht-dev -- bash -c 'docker exec knecht-run-<id> cat /home/ddev/.local/share/opencode/opencode.db > /tmp/oc.db'
limactl shell knecht-dev -- sqlite3 -json /tmp/oc.db 'SELECT id, data FROM message ORDER BY id;'
```

`message.data` (JSON) has `role`, `tokens`, `finish`; `part.data` has the
actual text/tool calls per message. Diagnostic patterns:
- Assistant message with `tokens all 0` and `finish: "unknown"` plus a lone
  empty `step-finish` part: the provider returned an EMPTY stream. opencode
  still exits 0 and prints only its `> build · <model>` banner, so Knecht marks
  the step success. Check the provider (credits, model availability) first.
- User message text repeating an OLDER prompt: the prompt file was not
  overwritten (the sysbox `docker cp` gotcha above).

## Reading step logs

A step whose log is only the banner (`> build · claude-opus-4-8`) with no
response text did nothing, whatever its status says. Compare with a known-good
ai step log, which continues with the agent's prose.
