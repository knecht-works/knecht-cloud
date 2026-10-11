import withNuxt from './.nuxt/eslint.config.mjs'

// Every query on a table goes through its store, so live updates cannot be skipped.
const TABLE_STORES = {
  agentItems: 'server/stores/agent-items.ts',
  followups: 'server/stores/followups.ts',
  projects: 'server/stores/projects.ts',
  projectLinks: 'server/stores/project-links.ts',
  runs: 'server/stores/runs.ts',
  runSteps: 'server/stores/run-steps.ts',
  sessions: 'server/stores/sessions.ts',
  triggers: 'server/stores/triggers.ts',
  workflows: 'server/stores/workflows.ts',
}

const storeQueries = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const file = context.filename.replaceAll('\\', '/')
    return {
      'CallExpression[callee.property.name=/^(insert|update|delete|from)$/]:not([callee.object.name="Array"])'(call) {
        const arg = call.arguments[0]
        const table = arg?.type === 'MemberExpression' && arg.object.name === 'schema' ? arg.property.name : arg?.type === 'Identifier' ? arg.name : null
        const store = TABLE_STORES[table]
        if (store && !file.endsWith(store)) {
          context.report({ node: arg, message: `Query ${table} through ${store}.` })
        }
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
    files: ['server/**/*.ts'],
    ignores: ['server/db/data-migrations.ts'],
    plugins: { knecht: { rules: { 'store-queries': storeQueries } } },
    rules: { 'knecht/store-queries': 'error' },
  },
)
