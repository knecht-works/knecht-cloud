import withNuxt from './.nuxt/eslint.config.mjs'

// Every query on a table goes through its store, so live updates cannot be skipped.
const TABLE_STORES = {
  projects: 'server/stores/projects.ts',
  projectLinks: 'server/stores/project-links.ts',
  sessions: 'server/stores/sessions.ts',
  triggers: 'server/stores/triggers.ts',
  workflows: 'server/stores/workflows.ts',
}

const storeQueries = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const file = context.filename.replaceAll('\\', '/')
    return {
      'CallExpression[callee.property.name=/^(insert|update|delete|from)$/] > MemberExpression.arguments[object.name="schema"]'(node) {
        const store = TABLE_STORES[node.property.name]
        if (store && !file.endsWith(store)) {
          context.report({ node, message: `Query ${node.property.name} through ${store}.` })
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
