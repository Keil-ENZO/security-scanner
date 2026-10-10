// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  modules: ['nuxt-auth-utils'],
  css: ['~/assets/main.css'],
  app: {
    head: { title: 'Security Scanner', htmlAttrs: { lang: 'fr' } },
  },
  runtimeConfig: {
    // Chaque clé se surcharge par NUXT_<CLE_EN_SNAKE_CASE>, voir .env.example
    passwordHash: '',
    secretKey: '',
    dataDir: './.data',
    allowedOwners: '',
    allowedHosts: '',
    githubToken: '',
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3.8:27b',
    // Jeton du cron Hermes, qui déclenche l'audit du jeudi
    hermesToken: '',
    // Adresse de l'interface, pour les liens du rapport
    publicUrl: 'http://127.0.0.1:3003',
  },
})
