# Workflow Engine — Design Plan

Plan for evolving Knecht's existing linear workflow system into a robust, scalable
engine with first-class variable/data passing, a growing catalog of actions
(AI, JS, HTTP, …), and JSON/YAML import/export.

Status: **proposal** · Date: 2026-07-05

---

## 1. Where we are today

Knecht already ships a working end-to-end workflow engine — this plan *extends* it,
it does not replace it:

- **Model:** linear sequence of `Step`s (tagged union in `shared/utils/workflow.ts`),
  5 step types: `ddev-start`, `bash`, `create-branch`, `create-commit`, `create-pr`.
- **Data flow:** run-scoped `RunContext` (`server/workflows/context.ts`); steps write
  outputs to *fixed* top-level keys (`ctx.branch`, `ctx.commit`, `ctx.pr`, `ctx.preview`);
  params are `render()`ed with `{{ dotted.path }}` templating.
- **Execution:** in-process serial runner (`server/daemon/runner.ts`) with a
  `switch (step.type)`; one `runs.log` text blob appended live; no per-step state,
  no retries, no resume — a daemon restart marks running runs failed.
- **Definition formats:** normalized JSON `Step[]` in the DB / builder API;
  a YAML authoring form parsed by `parseWorkflow()` (`server/workflows/schema.ts`),
  currently used only for the bundled starter templates. No import/export UI.
- **Builder:** client-side step registry `STEP_DEFS` (`app/utils/workflow-steps.ts`)
  drives the editor: fields, defaults, validation, and per-step output variables
  with front-to-back scoping (`availableVars`).
- **Triggers:** schedule (cron) / github (HMAC webhook) / manual — already done.

### Gaps against the goals

| Goal | Gap |
| --- | --- |
| Robust & scalable execution | No per-step persistence, no retries, crash = failed run, no concurrency control |
| Variable/data passing | Fixed output keys collide (two `create-branch` steps overwrite each other); no way for a step to expose arbitrary data |
| Many actions (AI, JS, …) | Adding a step means touching a `switch`; no AI/JS/HTTP steps yet (AI is reserved: `StepKind 'ai'`, OpenRouter settings placeholder) |
| JSON/YAML import/export | Parse exists server-side only; no export serializer, no import endpoint, no UI, no format versioning |

## 2. What the proven systems do (research summary)

Systems studied: **n8n**, **Activepieces**, **Windmill**, **Trigger.dev**,
**Temporal**, **CNCF Serverless Workflow 1.0**, Node-RED, Dify/Flowise.
The patterns they converge on:

1. **JSON-native definition, YAML as a serialization skin.** The source of truth is a
   versioned, schema-validated JSON document (Activepieces `schemaVersion`, Windmill
   OpenFlow, SW-spec); YAML is just the git-friendly rendering of the same schema.
2. **Ordered step list beats free-form DAG for builder products.** Activepieces,
   Windmill and SW-spec 1.0 all deliberately use a sequential list with *structured
   control-flow steps* (branch/loop/parallel as composite steps) instead of an
   arbitrary node graph: no cycles by construction, easy to render, diff and validate.
   SW-spec 1.0 explicitly abandoned its earlier state-machine/graph form for this.
   Knecht's linear model is already the right shape.
3. **Stable step IDs + expressions over named step results.** Windmill:
   `results.<step_id>`, Activepieces: `{{ step_name.field }}`, Dify: `{{#node_id.out#}}`.
   n8n's *name*-based references (`$('Node Name')`) are the documented cautionary tale —
   renames break workflows. Use immutable IDs, map to display labels only in the UI.
4. **Per-step jobs with persisted results.** Windmill (every step is its own Postgres
   job, result persisted before the next step is scheduled) and Temporal (append-only
   event history) show the same core idea: *persist each step's outcome before
   advancing*. That single decision buys crash recovery, retry-from-step, a per-step
   log UI, and later suspend/approval steps.
5. **Action registry pattern.** An action = declarative metadata (name, typed props →
   auto-generated form) + an async execute function (n8n `INodeType`, Activepieces
   `createAction` + `Property.*`, Node-RED `registerType`). Version/pin actions so
   published workflows don't change behavior underneath users.
6. **Retry/error policy as first-class constructs.** Per-step retry (attempts +
   backoff), per-step continue-on-error, flow-level error handler (Windmill
   `failure_module`, n8n Error Workflow, SW-spec `try/catch` with named retry policies).
7. **Runs pin their definition.** Activepieces DRAFT→LOCKED versions, Trigger.dev
   immutable deploys, Temporal version pinning: an in-flight run keeps executing the
   definition it started with.

Documented pitfalls to design around:

- **Large payloads between steps** — n8n's #1 scaling complaint; Windmill steers big
  results to object-storage references. Cap step-output size; pass references.
- **Sandboxing user JS** — n8n's vm2 CVEs forced out-of-process task runners;
  Node-RED's `vm` is "not a security boundary". Never run user code in the control
  plane process. (Knecht already has the perfect answer: the per-run Sysbox sandbox.)
- **Renames breaking references** — solved by stable IDs (above).
- **In-flight version drift** — solved by pinning (above); painful to retrofit.

## 3. Design decisions

### D1 — Keep the linear list; control flow as composite steps

No DAG/canvas. Branching and looping are *composite* step types that embed their
own sub-step lists (`if` with then/else, `loop` over items) — the way Activepieces
routers, Windmill `branchone`/`forloopflow` and SW-spec `switch`/`for` work.
No cycles are possible by construction and the builder stays a nested list.
The concrete design is D8.

### D2 — Stable step IDs and a `steps.<id>.<output>` namespace

Every step gets an immutable `id` (short, unique within the workflow, generated by
the builder, e.g. `s1`, `s2`, … or a nanoid). Step outputs move from fixed context
keys to a per-step namespace:

```
{{ steps.s3.branch }}     ← output `branch` of the step with id s3
{{ inputs.email }}        ← run inputs (trigger payload)
{{ project.name }}        {{ run.id }}        ← seeded context (unchanged)
```

- Solves output collisions (two `create-branch` steps no longer overwrite each other).
- The builder keeps showing friendly labels ("3 · Create branch") and inserts the
  id-based path — exactly the n8n-rename problem avoided the Windmill way.
- **Back-compat:** the runner *additionally* writes the legacy top-level keys
  (`ctx.branch`, `ctx.pr`, `ctx.preview`, `ctx.commit`) for one release so existing
  workflows keep rendering; the builder migrates templates on next save.

`render()` grows one capability: when a template is *exactly one* reference
(`{{ steps.s2.json }}`) it resolves to the raw value (object/array), not a string —
needed so JS/AI/HTTP steps can pass structured data, while string interpolation
keeps working everywhere else. (Windmill `input_transforms` / SW-spec `input.from`
make the same distinction.)

### D3 — Server-side action registry replaces the runner `switch`

One module per action under `server/workflows/actions/`, implementing a small
interface; a registry maps `type → action`. The `switch` in `runner.ts` becomes a
lookup + generic invoke:

```ts
// server/workflows/actions/types.ts
export interface ActionRuntime {
  runId: number
  project: Project
  checkoutDir: string
  ctx: RunContext                       // read-only for actions
  log: (text: string) => void
  sandbox: {                            // the existing daemon helpers, injected
    exec: (cmd: string[]) => Promise<number>
    ensureUp: () => Promise<void>
    copyIn: (host: string, inSandbox: string) => Promise<void>
  }
}

export interface ActionDef<P extends Step = Step> {
  type: P['type']
  /** Zod schema for the step's params (drives API validation + import). */
  params: z.ZodType<P>
  /** Execute with already-rendered params; return the step's outputs. */
  run: (step: P, rt: ActionRuntime) => Promise<Record<string, unknown>>
}
```

- The five existing cases move 1:1 into action modules (pure refactor, no behavior
  change). `normalizedStepSchema` and the YAML `stepSchema` are assembled from the
  registered actions' `params` schemas instead of being hand-maintained unions.
- The `Step` union in `shared/utils/workflow.ts` stays the shared type-safety anchor;
  per-action **output metadata** (name + hint, today duplicated in `STEP_DEFS.outputs`)
  moves into `shared/` so builder autocomplete and engine agree by construction.
- Client `STEP_DEFS` remains the UI-only registry (icons, fields, defaults) — it
  already works well; only `outputs` moves to shared.
- Adding an action then means: one server action module + one `STEP_DEFS` entry
  (+ the union member). Down from "grep three files and a switch".

### D4 — Per-step execution records (`run_steps` table)

The core robustness upgrade, following Windmill/Temporal: persist each step's
outcome *before* advancing.

```
run_steps
  id            PK
  runId         FK → runs (cascade)
  stepIndex     int          -- position at execution time
  stepId        text         -- the step's stable id
  type          text
  status        queued | running | success | failed | skipped
  params        JSON         -- rendered params snapshot (secrets redacted)
  outputs       JSON         -- what the action returned (size-capped)
  log           text         -- this step's slice of the log
  attempt       int          -- 1..n (retries)
  parentStepId  text | null  -- enclosing composite step (if/loop), null at top level
  iteration     int | null   -- loop iteration index this row belongs to
  startedAt / finishedAt / createdAt
```

`parentStepId`/`iteration` exist from day one so the step timeline can render
composite steps (D8) as a tree without a later migration.

- `runs.log` stays as the live aggregate stream the UI already polls; per-step rows
  power a step-timeline UI and post-mortems.
- **Output size cap** (e.g. 64 KB JSON per step): oversized outputs fail the step with
  a clear error telling the author to keep large data in the sandbox filesystem and
  pass paths/references — the n8n/Windmill lesson applied from day one.
- **Definition pinning:** `runs` gets a `steps JSON` snapshot column filled at start;
  the runner executes the snapshot, never the live workflow row. Editing a workflow
  mid-run can no longer affect the run, and run history shows what actually executed.

### D5 — Retry & error policy per step

Generalize `bash`'s `continueOnError` into `StepMeta` for all steps, plus optional
retry (SW-spec-style, kept minimal):

```ts
export interface StepMeta {
  id: string
  label?: string
  description?: string
  continueOnError?: boolean
  retry?: { attempts: number, backoffSeconds: number }   // exponential: b, 2b, 4b…
}
```

The generic runner implements both once — actions stay policy-free. A flow-level
`onError` handler (Windmill `failure_module`) is deferred; the triggers system can
provide failure notifications later without engine changes.

### D6 — Queue: DB-backed dispatcher, no Redis

Knecht is a single-instance control plane on SQLite; runs are heavyweight (each
boots a Docker sandbox), so throughput is bounded by the host, not the queue.
Redis/BullMQ (n8n/Activepieces queue mode) would add an infrastructure dependency
for no gain. Instead, follow Windmill's "DB *is* the queue" shape at mini scale:

- `startRun` only inserts the run as `queued` (it already exists in that state).
- A dispatcher (new Nitro plugin, same pattern as `scheduler.ts`) claims queued runs
  and executes them with a configurable **global concurrency limit** (settings row,
  default e.g. 2) — today every trigger firing starts a sandbox immediately.
- Recovery (`runs-recover.ts`) keeps marking `running` as failed on boot, but
  `queued` runs now simply *stay queued* and start when the dispatcher comes up —
  crash-safe queuing for free. (True mid-run resume stays out of scope; per-step
  records make a later "retry from failed step" feature straightforward.)

### D7 — New actions

Initial catalog additions, in order:

1. **`ai`** (kind `'ai'`, the reserved "knecht block"): an LLM call via **OpenRouter**
   (key + default model in the `settings` row, as already annotated in
   `schema.ts`). Params: `prompt` (templated, textarea), optional `model`,
   optional `system`. Outputs: `text` (and `json` when the response parses as JSON).
   Runs host-side (a plain HTTPS call). This unlocks e.g.
   *bash (collect diff/logs) → ai (summarize) → create-pr (body: `{{ steps.ai1.text }}`)*.
2. **`js`**: user JavaScript. **Never in the control-plane process** — it executes
   inside the run's existing Sysbox sandbox (Node in the sandbox image), the same
   trust boundary as `bash`. Contract: the code exports/defines
   `main(input)`; the step has a templated `input` param; the runner ships the file
   in via `copyIntoSandbox`, runs `node`, captures stdout-JSON as outputs
   (`steps.<id>.result`). This sidesteps the vm2/isolated-vm sandboxing trap entirely
   because kernel-level isolation already exists per run.
3. **`http`**: generic request from the host. Params: `method`, `url`, `headers`,
   `body` (all templated). Outputs: `status`, `body` (parsed JSON when possible),
   `headers`. Enables notifying external systems (Slack webhooks etc.) without
   dedicated integrations.

Each lands as: `Step` union member + action module + `STEP_DEFS` entry + shared
outputs metadata. Alongside, the existing `bash` step gains real outputs —
`exitCode` and a tail-capped `stdout` — so its result is referenceable
(`{{ steps.<id>.stdout }}`) instead of log-only. (`ddev-start`'s implicit DB
import and the git steps stay as-is.)

### D8 — Control-flow steps: `if` and `loop`

Two composite step types whose params include *nested step lists*:

```ts
| { type: 'if',
    // Outer array = OR groups, inner array = AND conditions (the proven
    // Activepieces shape; the builder starts with a single AND group).
    conditions: Condition[][],
    then: Step[],
    else: Step[] }                        // may be empty
| { type: 'loop',
    items: string,                        // template → array (raw-value rule) or a number (repeat N times)
    steps: Step[] }

interface Condition {
  left: string                            // templated
  op: 'eq' | 'neq' | 'contains' | 'not-contains' | 'empty' | 'not-empty'
    | 'gt' | 'lt' | 'regex'
  right?: string                          // templated; unused for empty/not-empty
}
```

**No expression language for conditions.** Conditions are structured
left/operator/right rows, rendered with the existing templating — deliberately
*not* evaluated JS (that would put user code back in the control-plane process,
see D7/`js`). `gt`/`lt` coerce both sides to numbers; everything else compares
rendered strings. This is the Activepieces `BranchCondition` model; SW-spec-style
jq expressions are the rejected alternative (more power, new dependency, worse
builder UX).

**Loop semantics** (serial — parallel iterations stay a non-goal):

- Inside the loop body, `{{ loop.item }}` and `{{ loop.index }}` are available
  (nested loops: the innermost wins, like Activepieces).
- Sub-step outputs (`steps.<subId>.…`) refer to the *current iteration* while
  inside the body. After the loop, the builder only offers the loop's own outputs:
  `steps.<loopId>.results` (array — per iteration, the outputs of its sub-steps,
  subject to the D4 size cap) and `steps.<loopId>.count`.
- A failing sub-step fails the iteration and the loop; per-sub-step
  `continueOnError` applies as everywhere. A Windmill-style `skipFailures` flag
  (drop failed iterations, keep going) can be added later without format changes.

**`if` semantics:** first matching OR group wins; `then` or `else` runs inline in
the same context (sub-steps write `steps.<id>` normally — the builder's
`availableVars` marks outputs from a non-taken branch as possibly absent, and
`render()` already treats unknown paths as empty).

**Engine/builder impact:** the runner's step walk becomes recursive; `run_steps`
rows carry `parentStepId` + `iteration` (D4) so the timeline renders a tree.
Validation is recursive Zod (`z.lazy`). The builder renders nested, indented step
lists with drag-drop into/out of composites; nesting depth is capped (e.g. 3) to
keep the UI and var scoping comprehensible.

### D9 — Import/export as versioned YAML/JSON

The **normalized JSON shape is canonical**; YAML is the same document serialized.
Add a format envelope:

```yaml
# knecht workflow, format v1
version: 1
name: Demo PR
description: Boot, change, open a PR
steps:
  - id: s1
    type: ddev-start
  - id: s2
    type: bash
    command: ddev composer update
    continueOnError: false
    retry: { attempts: 2, backoffSeconds: 30 }
  - id: s3
    type: ai
    prompt: 'Summarize this change: {{ steps.s2.stdout }}'
  - id: s4
    type: if
    conditions:
      - - { left: '{{ steps.s2.exitCode }}', op: eq, right: '0' }
    then:
      - id: s5
        type: create-pr
        title: Automated update
        body: '{{ steps.s3.text }} — preview: {{ steps.s1.previewUrl }}'
    else:
      - id: s6
        type: http
        method: POST
        url: 'https://hooks.example.com/notify'
        body: 'Update failed on {{ project.fullName }}'
```

- **Export:** `GET /api/workflows/:name/export?format=yaml|json` serializes the
  stored `Step[]` plus the envelope; builder gets an Export button (download) and
  copy-to-clipboard.
- **Import:** `POST /api/workflows/import` accepts YAML or JSON, validates against
  the registry-assembled schema, and returns Zod paths/messages on failure
  (unknown step types are reported, not silently dropped). Builder gets an Import
  button (new workflow or replace-current, with confirmation).
- The existing terse authoring sugar (`- ddev-start`, `- bash: {…}`) stays accepted
  on import for hand-written files; export always writes the explicit form above.
- `version` follows the Activepieces model: an integer plus a table of written
  migrations (`migrateDefinition(v, doc)`), so future format changes never strand
  exported files. Starter templates in `server/workflows/index.ts` move to format v1.

## 4. Roadmap

Each phase is independently shippable and verified before the next.

1. **Action registry (refactor, no behavior change).** Extract the 5 runner cases
   into action modules; assemble both Zod schemas from the registry; move output
   metadata to `shared/`. → verify: existing starter workflows run identically;
   schema round-trips unchanged.
2. **Step IDs + `steps.<id>` data flow.** Add `id` to `StepMeta` (builder generates;
   API/YAML backfill on load), context gains `steps` namespace (legacy keys still
   written), `render()` single-reference raw-value rule, builder autocomplete uses
   real IDs. → verify: old workflows still render; new workflows with duplicate step
   types no longer collide.
3. **Per-step runs + retry/continue-on-error + pinning.** `run_steps` table
   (migration), generic retry loop, `runs.steps` snapshot, step timeline in the run
   view. → verify: kill the daemon mid-run → run failed with the exact failed step
   recorded; retry policy observably re-attempts with backoff.
4. **Dispatcher + concurrency limit.** Queued-run dispatcher plugin, settings knob,
   recovery keeps `queued` runs. → verify: firing 5 triggers with limit 2 runs at
   most 2 sandboxes; restart with queued runs picks them up.
5. **New actions: `ai`, then `js`, then `http`.** Settings UI for OpenRouter
   (section already stubbed in `settings.vue`); Node added to the sandbox image for
   `js`. → verify per action with a template workflow exercising its outputs.
6. **Control flow: `if` + `loop`.** Recursive runner walk, recursive schemas,
   nested builder lists, `loop.item`/`loop.index` vars, tree-rendered step
   timeline (uses the D4 nesting columns). → verify: a workflow with an `if`
   inside a `loop` over an array output takes the expected branches per
   iteration and records one `run_steps` row per sub-step per iteration.
7. **Import/export.** Envelope + endpoints + builder buttons + format migrations.
   → verify: export→delete→import round-trips byte-equivalent normalized JSON
   (including nested composite steps); invalid files produce path-precise errors.

## 5. Non-goals (explicit)

- Free-form DAG canvas, parallel branches, parallel loop iterations — `if`/`loop`
  run strictly serially; a multi-case router (beyond then/else) can follow the same
  composite pattern later.
- Redis/BullMQ or any external queue — contradicts the single-instance SQLite design.
- Mid-run resume/checkpointing (Trigger.dev CRIU, Temporal replay) — per-step records
  keep the door open for "retry from step"; full durability is not worth the
  complexity while runs are minutes-long and rerunnable.
- Multi-tenancy changes — workflows stay global to the instance.
- In-process JS sandboxing (vm2/isolated-vm) — user code runs only in the run sandbox.
