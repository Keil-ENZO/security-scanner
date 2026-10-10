<script setup lang="ts">
const { loggedIn, clear } = useUserSession()

async function logout() {
  await $fetch('/api/logout', { method: 'POST' })
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="shell">
    <header>
      <NuxtLink to="/" class="brand">🛡️ Security Scanner</NuxtLink>
      <button v-if="loggedIn" class="ghost" @click="logout">Déconnexion</button>
    </header>
    <main>
      <NuxtPage />
    </main>
  </div>
</template>
