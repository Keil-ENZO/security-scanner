<script setup lang="ts">
const { loggedIn, clear } = useUserSession()
const { instanceName } = useRuntimeConfig().public

async function logout() {
  await $fetch('/api/logout', { method: 'POST' })
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <NuxtLink
        to="/"
        class="brand"
      >
        <span class="brand-mark">◆</span>
        <span>SECURITY<b>SCANNER</b></span>
      </NuxtLink>
      <div class="topbar-right">
        <span class="node"><i class="dot" />{{ instanceName }}</span>
        <button
          v-if="loggedIn"
          class="ghost"
          @click="logout"
        >
          Log out
        </button>
      </div>
    </header>
    <main>
      <NuxtPage />
    </main>
    <footer>Trivy · Grype · Syft · Semgrep · Nuclei · local LLM report. Only scan targets you are authorised to test.</footer>
  </div>
</template>
