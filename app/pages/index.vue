<script setup lang="ts">
interface Target { id: number, name: string, repo: string | null, url: string | null, weekly: number, has_auth: number, last_scan_id: number | null }
interface ScanRow { id: number, target: string, origin: string, status: string, created_at: string, critical: number, high: number, medium: number, low: number, total: number }

const { data: targets, refresh: refreshTargets } = await useFetch<Target[]>('/api/targets')
const { data: scans, refresh: refreshScans } = await useFetch<ScanRow[]>('/api/scans')

const form = reactive({ name: '', repo: '', url: '', authHeader: '', weekly: true })
const error = ref('')

async function addTarget() {
  error.value = ''
  try {
    await $fetch('/api/targets', {
      method: 'POST',
      body: {
        name: form.name,
        repo: form.repo || undefined,
        url: form.url || undefined,
        authHeader: form.authHeader || undefined,
        weekly: form.weekly,
      },
    })
    Object.assign(form, { name: '', repo: '', url: '', authHeader: '', weekly: true })
    await refreshTargets()
  }
  catch (err: any) {
    error.value = err?.data?.message ?? 'Erreur'
  }
}

async function scan(id: number) {
  const { scanId } = await $fetch<{ scanId: number }>(`/api/targets/${id}/scan`, { method: 'POST' })
  await navigateTo(`/scans/${scanId}`)
}

async function remove(t: Target) {
  if (!confirm(`Supprimer ${t.name} et ses scans ?`)) return
  await $fetch(`/api/targets/${t.id}`, { method: 'DELETE' })
  await Promise.all([refreshTargets(), refreshScans()])
}

// Rafraîchit tant qu'un scan tourne
const busy = computed(() => scans.value?.some(s => s.status === 'queued' || s.status === 'running'))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => busy.value && refreshScans(), 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section class="card">
    <h2>Nouvelle cible</h2>
    <form class="grid" @submit.prevent="addTarget">
      <input v-model="form.name" placeholder="Nom, ex. Aurefort" required>
      <input v-model="form.repo" placeholder="https://github.com/Keil-ENZO/aurefort">
      <input v-model="form.url" placeholder="https://aurefort.vercel.app">
      <input v-model="form.authHeader" type="password" placeholder="Identifiants, ex. Cookie: session=…" autocomplete="off">
      <label class="check"><input v-model="form.weekly" type="checkbox"> Audit du jeudi</label>
      <button type="submit">Ajouter</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
  </section>

  <section class="card">
    <h2>Cibles</h2>
    <p v-if="!targets?.length" class="muted">Aucune cible.</p>
    <table v-else>
      <tbody>
        <tr v-for="t in targets" :key="t.id">
          <td><strong>{{ t.name }}</strong></td>
          <td class="muted">{{ t.repo ?? '—' }}</td>
          <td class="muted">{{ t.url ?? '—' }}</td>
          <td>{{ t.has_auth ? '🔑' : '' }} {{ t.weekly ? 'hebdo' : '' }}</td>
          <td class="actions">
            <button @click="scan(t.id)">Scanner</button>
            <button class="ghost" @click="remove(t)">Supprimer</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="card">
    <h2>Derniers scans</h2>
    <p v-if="!scans?.length" class="muted">Aucun scan.</p>
    <table v-else>
      <tbody>
        <tr v-for="s in scans" :key="s.id">
          <td><NuxtLink :to="`/scans/${s.id}`">#{{ s.id }}</NuxtLink></td>
          <td>{{ s.target }}</td>
          <td><span :class="['status', s.status]">{{ s.status }}</span></td>
          <td>
            <span v-if="s.critical" class="sev critical">{{ s.critical }} critical</span>
            <span v-if="s.high" class="sev high">{{ s.high }} high</span>
            <span v-if="s.medium" class="sev medium">{{ s.medium }} medium</span>
            <span v-if="s.low" class="sev low">{{ s.low }} low</span>
            <span class="muted">{{ s.total }} au total</span>
          </td>
          <td class="muted">{{ s.origin }} · {{ s.created_at }} UTC</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
