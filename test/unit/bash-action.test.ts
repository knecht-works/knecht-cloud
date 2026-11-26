import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { bashAction } from '#server/workflows/actions/bash'
import { renderShell } from '#server/workflows/shell-template'
import type { ActionRuntime } from '#server/workflows/actions'
import type { RunContext } from '#server/workflows/context'
import type { Step } from '#shared/utils/workflow'

const TITLE = `'; $(echo INJECTED) "`

function ctx(inputs: Record<string, string> = { title: TITLE }): RunContext {
  return {
    run: { id: 7, url: 'http://knecht.test/runs/7' },
    project: { name: 'demo', owner: 'acme', fullName: 'acme/demo', defaultBranch: 'main' },
    inputs,
    steps: { probe: { json: { score: 3 } } },
  }
}

function localRuntime(context: RunContext): ActionRuntime {
  const stream = async (command: string[], opts?: { env?: Record<string, string> }) => {
    const res = await execa(command[0]!, ['-c', command[2]!], { env: opts?.env, reject: false, all: true })
    return { code: res.exitCode ?? 1, tail: res.all }
  }
  return {
    ctx: context,
    log: () => {},
    signal: new AbortController().signal,
    sandbox: {
      ensureUp: async () => {},
      stream,
      withoutPreview: async () => ({ stream, release: async () => {} }),
    },
  } as unknown as ActionRuntime
}

const bash = (command: string): Extract<Step, { type: 'bash' }> => ({ type: 'bash', id: 'sh', command })

async function stdout(command: string, context = ctx()): Promise<string> {
  const outputs = await bashAction.run(bash(command), localRuntime(context))
  return outputs!.stdout as string
}

describe('bash action with template values', () => {
  it.each([
    ['bare', 'echo {{ inputs.title }}'],
    ['double quoted', 'printf "%s" "{{ inputs.title }}"'],
    ['single quoted', 'printf "%s" \'{{ inputs.title }}\''],
    ['inside a $\'...\' string', 'printf "%s" $\'{{ inputs.title }}\''],
  ])('passes a ticket title through literally when %s', async (_name, command) => {
    expect(await stdout(command)).toBe(TITLE)
  })

  it('splits a bare value into words like a variable, without running it', async () => {
    expect(await stdout('printf "[%s]" {{ inputs.list }}', ctx({ list: 'a/b $(echo c)' }))).toBe('[a/b][$(echo][c)]')
  })

  it('writes a value into a quoted heredoc as text', async () => {
    expect(await stdout('cat <<\'EOF\'\n{{ inputs.title }} costs $5\nEOF')).toBe(`${TITLE} costs $5`)
  })

  it('keeps surrounding text in the same word', async () => {
    expect(await stdout('echo "title={{ inputs.title }}!"')).toBe(`title=${TITLE}!`)
    expect(await stdout('echo \'title={{ inputs.title }}!\'')).toBe(`title=${TITLE}!`)
  })

  it('never executes a command substitution in a value', async () => {
    const out = await stdout('echo "{{ inputs.title }}"', ctx({ title: '$(echo INJECTED-$((6*7)))' }))
    expect(out).toBe('$(echo INJECTED-$((6*7)))')
  })

  it('tracks quotes in comments, command substitutions and heredocs', async () => {
    const script = [
      '# don\'t trip over this apostrophe',
      'echo "$(printf "%s" \'{{ inputs.title }}\')"',
      'cat <<EOF',
      'It\'s {{ inputs.title }}',
      'EOF',
    ].join('\n')
    expect(await stdout(script)).toBe(`${TITLE}\nIt's ${TITLE}`)
  })

  it('reads a shift in an arithmetic command as a shift, not as a heredoc', async () => {
    const script = [
      '(( n = 1 << 2 ))',
      'if ((n == 4)); then printf "%s" \'{{ inputs.title }}\'; fi',
      'echo $(( (n) << 1 )) "{{ inputs.title }}"',
    ].join('\n')
    expect(await stdout(script)).toBe(`${TITLE}8 ${TITLE}`)
  })

  it('renders objects as JSON', async () => {
    expect(await stdout('echo {{ steps.probe.json }}')).toBe('{"score":3}')
  })
})

describe('renderShell', () => {
  it('replaces each value with an environment variable reference', () => {
    expect(renderShell('echo {{ inputs.title }} "{{ run.id }}" \'{{ inputs.title }}\'', ctx())).toEqual({
      command: 'echo ${KNECHT_VAR_INPUTS_TITLE} "${KNECHT_VAR_RUN_ID}" \'\'"${KNECHT_VAR_INPUTS_TITLE}"\'\'',
      env: { KNECHT_VAR_INPUTS_TITLE: TITLE, KNECHT_VAR_RUN_ID: '7' },
    })
  })

  it('gives paths that map to the same name distinct variables', () => {
    const { env } = renderShell('{{ inputs.a_b }} {{ inputs.a.b }}', ctx({ a_b: 'x' }))
    expect(Object.keys(env)).toEqual(['KNECHT_VAR_INPUTS_A_B', 'KNECHT_VAR_INPUTS_A_B_2'])
  })

  it('rejects a value that would end a quoted heredoc early', () => {
    expect(() => renderShell('cat <<\'EOF\'\n{{ inputs.title }}\nEOF', ctx({ title: 'x\nEOF\necho INJECTED' }))).toThrow(/would end the heredoc/)
  })
})
