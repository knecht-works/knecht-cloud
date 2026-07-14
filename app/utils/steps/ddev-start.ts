import { defineStep } from './define'

export const ddevStartStep = defineStep({
  type: 'ddev-start',
  label: 'Boot project',
  hint: 'Start the ddev stack + import the DB',
  kind: 'det',
  icon: 'i-lucide-play',
  group: 'Deterministic',
  fields: [
    { key: 'commands', label: 'Setup commands', input: 'textarea', rows: 3, vars: true, placeholder: 'Optional. One command per line, run after the boot:\nddev composer install\nddev npm install && ddev npm run build' },
  ],
  outputs: [
    { path: 'url', hint: 'The booted environment\'s preview URL' },
  ],
  make: () => ({ type: 'ddev-start' }),
  meta: step => ({ detail: step.commands?.trim() ? `DDEV starts web + database, then: ${step.commands.trim().split('\n').join(' · ')}` : 'DDEV starts web + database' }),
})
