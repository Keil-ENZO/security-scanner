// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    // Scanner and GitHub payloads are external JSON, parsed defensively field by field
    '@typescript-eslint/no-explicit-any': 'off',
    // Vue 3 pages may render fragments
    'vue/no-multiple-template-root': 'off',
  },
})
