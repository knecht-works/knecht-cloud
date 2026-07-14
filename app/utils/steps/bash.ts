import { defineStep } from './define'

export const bashStep = defineStep({
  type: 'bash',
  label: 'Shell command',
  hint: 'Run a command inside the sandbox',
  kind: 'det',
  icon: 'i-lucide-terminal',
  group: 'Deterministic',
  fields: [
    { key: 'command', label: 'Command', input: 'textarea', rows: 2, required: true, vars: true, placeholder: 'ddev composer install' },
  ],
  outputs: [
    { path: 'stdout', hint: 'The command\'s output (tail)' },
    { path: 'exitCode', hint: 'The exit code (0 on success)' },
  ],
  make: () => ({ type: 'bash', command: '' }),
  // Well-known commands get a friendlier icon + label in lists.
  meta: (step) => {
    const cmd = step.command
    const c = cmd.toLowerCase()
    if (c.includes('composer')) return { icon: 'i-lucide-package', label: 'Composer', detail: cmd }
    if (/\b(npm|pnpm|yarn)\b|build/.test(c)) return { icon: 'i-lucide-hammer', label: 'Build assets', detail: cmd }
    if (/test|phpunit|playwright|pest/.test(c)) return { icon: 'i-lucide-flask-conical', label: 'Run tests', detail: cmd }
    if (/\bgit\b|gh pr|pull request/.test(c)) return { icon: 'i-lucide-git-pull-request', kind: 'out', label: 'Pull request', detail: cmd }
    return { icon: 'i-lucide-terminal', label: 'Shell', detail: cmd }
  },
})
