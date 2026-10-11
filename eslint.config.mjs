import withNuxt from './.nuxt/eslint.config.mjs'

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
    files: ['server/**/*.ts'],
    ignores: ['server/stores/**', 'server/db/**'],
    plugins: { knecht: { rules: { 'store-queries': storeQueries } } },
    rules: { 'knecht/store-queries': 'error' },
  },
)
