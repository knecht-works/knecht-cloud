import { defineStep } from './define'

export const ddevStartStep = defineStep({
  type: 'ddev-start',
  label: 'Boot project',
  hint: 'Start the ddev stack + import the DB',
  kind: 'det',
  icon: 'i-lucide-play',
  group: 'Deterministic',
  fields: [
    { key: 'commands', label: 'Additional setup commands', input: 'code', lang: 'bash', rows: 3, vars: true, placeholder: 'Optional. One command per line:\nddev npm run build', hint: 'The project\'s own boot commands (project settings) run first; add here only what THIS workflow additionally needs. A session boots once: later runs in it skip both.' },
  ],
  outputs: [
    { path: 'url', hint: 'The booted environment\'s preview URL' },
  ],
  make: () => ({ type: 'ddev-start' }),
  meta: step => ({ detail: step.commands?.trim() ? `DDEV starts web + database, then: ${step.commands.trim().split('\n').join(' · ')}` : 'DDEV starts web + database' }),
})
