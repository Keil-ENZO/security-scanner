<script setup lang="ts">
const password = ref('')
const error = ref('')
const pending = ref(false)
const { fetch: refreshSession } = useUserSession()

async function submit() {
  error.value = ''
  pending.value = true
  try {
    await $fetch('/api/login', { method: 'POST', body: { password: password.value } })
    await refreshSession()
    await navigateTo('/')
  }
  catch {
    error.value = 'Accès refusé'
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <form class="panel login" @submit.prevent="submit">
    <p class="label">// Authentification</p>
    <h1>Accès restreint</h1>
    <p class="muted">Console d'audit de homelab-01.</p>
    <input v-model="password" type="password" placeholder="Mot de passe" autocomplete="current-password" autofocus>
    <button type="submit" :disabled="pending">{{ pending ? 'Vérification…' : 'Entrer' }}</button>
    <p v-if="error" class="error">✕ {{ error }}</p>
  </form>
</template>
