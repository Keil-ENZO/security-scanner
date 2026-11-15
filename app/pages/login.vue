<script setup lang="ts">
const password = ref('')
const error = ref('')
const pending = ref(false)
const { fetch: refreshSession } = useUserSession()
const { instanceName } = useRuntimeConfig().public

async function submit() {
  error.value = ''
  pending.value = true
  try {
    await $fetch('/api/login', { method: 'POST', body: { password: password.value } })
    await refreshSession()
    await navigateTo('/')
  }
  catch {
    error.value = 'Access denied'
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <BrandMark
    class="login-mark"
    :size="64"
  />
  <form
    class="panel login"
    @submit.prevent="submit"
  >
    <p class="label">
      Authentication
    </p>
    <h1>Restricted access</h1>
    <p class="muted">
      Audit console of {{ instanceName }}.
    </p>
    <input
      v-model="password"
      type="password"
      placeholder="Password"
      autocomplete="current-password"
      autofocus
    >
    <button
      type="submit"
      :disabled="pending"
    >
      {{ pending ? 'Checking…' : 'Enter' }}
    </button>
    <p
      v-if="error"
      class="error"
    >
      ✕ {{ error }}
    </p>
  </form>
</template>

<style scoped>
/* The mark takes over the top spacing of the form, so both stay centred as one block */
.login-mark { margin: 12vh auto 0; }
.login { margin-top: 24px; }
</style>
