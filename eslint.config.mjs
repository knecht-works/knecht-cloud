import withNuxt from './.nuxt/eslint.config.mjs'
import { buttonClasses, controlRowSize, defaultControlSize, iconOrLabel, labeledControl, themedOnly } from './eslint/form-rules.mjs'

// Every query goes through a store, so live updates cannot be skipped.
const storeQueries = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (!/(^|\/)db(\/index)?$/.test(node.source.value)) return
        const imported = node.specifiers.find(s => s.type === 'ImportSpecifier' && s.imported.name === 'db' && s.importKind !== 'type')
        if (imported) context.report({ node: imported, message: 'Query the database through a store in server/stores.' })
      },
    }
  },
}

export default withNuxt(
  // The Claude Design handoff bundle (HTML/CSS/JS prototypes) is reference
  // material, not part of the app, so keep it out of linting.
  {
    ignores: ['knecht-dashboard/**'],
  },
  {
    files: ['app/**/*.{ts,vue}', 'server/**/*.ts'],
    // drizzle-kit loads the schema without aliases; CONTEXT.md sits outside every alias.
    ignores: ['**/*.d.ts', 'server/db/schema.ts', 'server/tools/knowledge.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { regex: '^\\.\\.?/', message: 'Import project code through ~, #server or #shared.' },
        { regex: '^(#app|#build)(/|$)', message: 'Import what Nuxt provides from #imports.' },
        { regex: '^~~/', message: 'Import shared code through #shared.' },
      ] }],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { regex: '^(\\.\\./)+(app|server|shared)/', message: 'Import project code through ~, #server or #shared.' },
      ] }],
    },
  },
  {
    files: ['server/**/*.ts'],
    ignores: ['server/stores/**', 'server/db/**'],
    plugins: { knecht: { rules: { 'store-queries': storeQueries } } },
    rules: { 'knecht/store-queries': 'error' },
  },
  {
    files: ['app/**/*.vue'],
    plugins: { 'knecht-forms': { rules: { 'button-classes': buttonClasses, 'control-row-size': controlRowSize, 'default-control-size': defaultControlSize, 'icon-or-label': iconOrLabel, 'labeled-control': labeledControl, 'themed-only': themedOnly } } },
    rules: { 'vue/no-undef-components': 'error', 'knecht-forms/button-classes': 'error', 'knecht-forms/control-row-size': 'error', 'knecht-forms/default-control-size': 'error', 'knecht-forms/icon-or-label': 'error', 'knecht-forms/labeled-control': 'error', 'knecht-forms/themed-only': 'error' },
  },
  {
    // The compact editors: trigger conditions, the workflow editor and the chat model picker.
    files: ['app/components/KTriggerForm.vue', 'app/components/workflow/**/*.vue', 'app/pages/workflows/[[]id].vue', 'app/components/chat/ModelPicker.vue'],
    rules: { 'knecht-forms/default-control-size': 'off' },
  },
  {
    // The field components define their look once and are labeled by the UFormField around them.
    files: ['app/components/{KSecretField,KCodeInput,KPasswordInput,KUnitInput}.vue', 'app/components/chat/ModelPicker.vue'],
    rules: { 'knecht-forms/labeled-control': 'off', 'knecht-forms/themed-only': 'off' },
  },
)
