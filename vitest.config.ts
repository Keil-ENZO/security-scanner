import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests of the server utils, without booting Nuxt.
// '#imports' points to a stub with a mutable runtime config
export default defineConfig({
  resolve: {
    alias: { '#imports': fileURLToPath(new URL('./test/stubs/imports.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
