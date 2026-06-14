import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // The Claude Design handoff bundle (HTML/CSS/JS prototypes) is reference
  // material, not part of the app — keep it out of linting.
  {
    ignores: ['knecht-dashboard/**'],
  },
)
