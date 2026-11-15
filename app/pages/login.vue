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
  catch (err) {
    // "Wrong password" from the server, or that the server could not be reached
    error.value = errorMessage(err)
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
    <label for="password">Password</label>
    <input
      id="password"
      v-model="password"
      type="password"
      autocomplete="current-password"
      maxlength="256"
      required
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
      role="alert"
    >
      <span aria-hidden="true">✕ </span>{{ error }}
    </p>
  </form>
</template>

<style scoped>
/* The mark takes over the top spacing of the form, so both stay centred as one block */
.login-mark { margin: 12vh auto 0; }
.login { margin-top: 24px; }
/* Sits on its input: takes back half of the gap of the form */
.login label { margin-bottom: -6px; font-size: 12px; color: var(--muted); }
</style>
