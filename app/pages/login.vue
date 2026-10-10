<script setup lang="ts">
const password = ref('')
const error = ref('')
const { fetch: refreshSession } = useUserSession()

async function submit() {
  error.value = ''
  try {
    await $fetch('/api/login', { method: 'POST', body: { password: password.value } })
    await refreshSession()
    await navigateTo('/')
  }
  catch {
    error.value = 'Mot de passe incorrect'
  }
}
</script>

<template>
  <form class="card narrow" @submit.prevent="submit">
    <h1>Connexion</h1>
    <input v-model="password" type="password" placeholder="Mot de passe" autocomplete="current-password" autofocus>
    <button type="submit">Entrer</button>
    <p v-if="error" class="error">{{ error }}</p>
  </form>
</template>
