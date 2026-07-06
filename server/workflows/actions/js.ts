import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { defineAction, ActionError } from './types'

// User JavaScript: NEVER in the control-plane process (workflow-engine-plan.md
// D7): the script runs inside the run's Sysbox sandbox, the same kernel-level
// trust boundary as the bash step. Contract: the code defines `main(input)`
// (sync or async) and returns a JSON-serializable value, exposed to later steps
// as steps.<id>.result. `input` comes from the templated param: a single
// {{ ref }} passes the referenced value raw (rawParams).
const RESULT_MARKER = '__KNECHT_JS_RESULT__'

export const jsAction = defineAction({
  type: 'js',
  params: {
    code: z.string().min(1),
    input: z.string().optional(),
  },
  rawParams: ['input'],
  async run(step, rt) {
    rt.log(`\n▶ js\n`)
    await rt.sandbox.ensureUp()

    // `input` was raw-resolved: any JSON value, embedded into the script as a
    // literal so nothing needs quoting through the shell.
    const input = (step as { input?: unknown }).input
    const script = [
      step.code,
      '',
      `const __input = ${JSON.stringify(input ?? null)}`,
      `Promise.resolve(main(__input)).then((r) => {`,
      `  console.log(${JSON.stringify(RESULT_MARKER)} + JSON.stringify(r === undefined ? null : r))`,
      `}).catch((e) => { console.error(e && e.stack ? e.stack : String(e)); process.exit(1) })`,
    ].join('\n')

    const dir = await mkdtemp(join(tmpdir(), 'knecht-js-'))
    try {
      const hostFile = join(dir, 'step.mjs')
      await writeFile(hostFile, script)
      const inSandbox = `/tmp/knecht-js-${rt.runId}.mjs`
      await rt.sandbox.copyIn(hostFile, inSandbox)
      const { code, tail } = await rt.sandbox.stream(['bash', '-lc', `node ${inSandbox}`])
      if (code !== 0) throw new ActionError(`js step exited with code ${code}`, { exitCode: code })
      const line = tail.split('\n').reverse().find(l => l.startsWith(RESULT_MARKER))
      if (!line) throw new Error('js step produced no result: main(input) must return a JSON-serializable value')
      return { result: JSON.parse(line.slice(RESULT_MARKER.length)) as unknown }
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
})
