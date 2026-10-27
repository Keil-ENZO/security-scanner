// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['nuxt-auth-utils', '@nuxt/eslint'],
  devtools: { enabled: false },
  app: {
    head: { title: 'Security Scanner', htmlAttrs: { lang: 'en' } },
  },
  css: ['~/assets/main.css'],
  runtimeConfig: {
    // Every key can be overridden by NUXT_<KEY_IN_SNAKE_CASE>, see .env.example
    passwordHash: '',
    secretKey: '',
    dataDir: './.data',
    allowedOwners: '',
    allowedHosts: '',
    githubToken: '',
    // Author of the fix commits
    gitAuthorName: 'Security Scanner',
    gitAuthorEmail: 'security-scanner@users.noreply.github.com',
    // Optional: Vercel build log when a deployment fails. Read only
    vercelToken: '',
    // Optional: report written by a local LLM. Empty: plain text report
    ollamaUrl: '',
    ollamaModel: 'qwen3:8b',
    // Optional notification channels, all of them are used when set
    telegramBotToken: '',
    telegramChatId: '',
    slackWebhookUrl: '',
    discordWebhookUrl: '',
    webhookUrl: '',
    // Bearer token for /api/automation/*, used by the scheduler
    automationToken: '',
    // Interface address, for links in notifications
    publicUrl: 'http://127.0.0.1:3003',
    // Over plain HTTP, on a private network or a tailnet, NUXT_SESSION_COOKIE_SECURE=false:
    // otherwise the browser drops the cookie and the login does not stick
    session: { cookie: { secure: true } },
    public: {
      // Shown in the top bar, to tell instances apart
      instanceName: 'security-scanner',
      // Date display. Same value on server and client, so hydration matches
      timeZone: 'UTC',
      locale: 'en-GB',
    },
  },
  compatibilityDate: '2025-07-15',
  eslint: { config: { stylistic: true } },
})
