import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { defineAction, ActionError } from './types'

// User JavaScript runs in the run's web container, never in the control-plane process.
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
      const inSandbox = `/tmp/knecht-js-${rt.sessionId}.mjs`
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
