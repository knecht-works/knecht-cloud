import { defineStep } from './define'

export const ddevStartStep = defineStep({
  type: 'ddev-start',
  label: 'Boot project',
  hint: 'Start the ddev stack + import the DB',
  kind: 'det',
  icon: 'i-lucide-play',
  group: 'Deterministic',
  fields: [],
  outputs: [
    { path: 'url', hint: 'The booted environment\'s preview URL' },
  ],
  make: () => ({ type: 'ddev-start' }),
  meta: () => ({ detail: 'DDEV starts web + database' }),
})
