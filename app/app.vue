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
    <header class="topbar">
      <NuxtLink to="/" class="brand">
        <span class="brand-mark">◆</span>
        <span>SECURITY<b>SCANNER</b></span>
      </NuxtLink>
      <div class="topbar-right">
        <span class="node"><i class="dot" />homelab-01</span>
        <button v-if="loggedIn" class="ghost" @click="logout">Déconnexion</button>
      </div>
    </header>
    <main>
      <NuxtPage />
    </main>
    <footer>Trivy · Semgrep · Nuclei · rapport par LLM local. Usage limité aux cibles autorisées.</footer>
  </div>
</template>
