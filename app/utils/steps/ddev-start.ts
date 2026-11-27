import { defineStep } from '~/utils/steps/define'

export const ddevStartStep = defineStep({
  type: 'ddev-start',
  label: 'Boot project',
  hint: 'Starts the environment, imports the database when the project has one, runs the boot commands',
  kind: 'det',
  icon: 'i-lucide-play',
  group: 'Deterministic',
  fields: [
    { key: 'commands', label: 'Additional setup commands', input: 'code', lang: 'bash', rows: 3, vars: true, placeholder: 'Optional. One command per line:\nddev npm run build', hint: 'Runs after the project\'s boot commands. Commands every workflow needs belong in the project settings.' },
  ],
  outputs: [
    { path: 'url', hint: 'The booted environment\'s preview URL' },
  ],
  make: () => ({ type: 'ddev-start' }),
  meta: step => ({ detail: step.commands?.trim() ? `Boots the environment, then: ${step.commands.trim().split('\n').join(' · ')}` : 'Boots the environment' }),
})
