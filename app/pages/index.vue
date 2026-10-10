<script setup lang="ts">
interface Target { id: number, name: string, repo: string | null, url: string | null, weekly: number, has_auth: number, last_scan_id: number | null }
interface ScanRow { id: number, target: string, origin: string, status: string, created_at: string, critical: number, high: number, medium: number, low: number, total: number }

const { data: targets, refresh: refreshTargets } = await useFetch<Target[]>('/api/targets')
const { data: scans, refresh: refreshScans } = await useFetch<ScanRow[]>('/api/scans')

const form = reactive({ name: '', repo: '', url: '', authHeader: '', weekly: true })
const error = ref('')
const showForm = ref(false)

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
    showForm.value = false
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

const active = computed(() => scans.value?.filter(s => s.status === 'queued' || s.status === 'running').length ?? 0)
const lastDone = computed(() => scans.value?.find(s => s.status === 'done'))

// Rafraîchit tant qu'un scan tourne
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => active.value && refreshScans(), 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section class="kpis">
    <div class="kpi">
      <span class="label">Cibles</span>
      <strong>{{ targets?.length ?? 0 }}</strong>
    </div>
    <div class="kpi">
      <span class="label">Scans actifs</span>
      <strong :class="{ live: active }">{{ active }}</strong>
    </div>
    <div class="kpi">
      <span class="label">Dernier audit</span>
      <strong class="small">{{ lastDone ? formatDate(lastDone.created_at) : '—' }}</strong>
    </div>
    <div class="kpi">
      <span class="label">Audit planifié</span>
      <strong class="small">Jeudi 20:00</strong>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <p class="label">// Cibles</p>
      <button class="ghost" @click="showForm = !showForm">{{ showForm ? 'Annuler' : '+ Nouvelle cible' }}</button>
    </div>

    <form v-if="showForm" class="target-form" @submit.prevent="addTarget">
      <label>Nom<input v-model="form.name" placeholder="Aurefort" required></label>
      <label>Dépôt GitHub<input v-model="form.repo" placeholder="https://github.com/Keil-ENZO/aurefort"></label>
      <label>URL<input v-model="form.url" placeholder="https://aurefort.vercel.app"></label>
      <label>Identifiants de test<input v-model="form.authHeader" type="password" placeholder="Cookie: session=…" autocomplete="off"></label>
      <label class="check"><input v-model="form.weekly" type="checkbox"> Inclure dans l'audit du jeudi</label>
      <button type="submit">Ajouter la cible</button>
      <p v-if="error" class="error">✕ {{ error }}</p>
    </form>

    <p v-if="!targets?.length" class="empty">Aucune cible.</p>
    <div v-else class="rows">
      <div v-for="t in targets" :key="t.id" class="row target-row">
        <div>
          <strong>{{ t.name }}</strong>
          <div class="tags">
            <span v-if="t.weekly" class="tag">hebdo</span>
            <span v-if="t.has_auth" class="tag">authentifié</span>
          </div>
        </div>
        <code class="mono muted">{{ t.repo ?? '—' }}</code>
        <code class="mono muted">{{ t.url ?? '—' }}</code>
        <div class="actions">
          <button @click="scan(t.id)">▶ Scanner</button>
          <button class="ghost danger" title="Supprimer" @click="remove(t)">✕</button>
        </div>
      </div>
    </div>
  </section>

  <section class="panel">
    <p class="label">// Historique</p>
    <p v-if="!scans?.length" class="empty">Aucun scan.</p>
    <div v-else class="rows">
      <NuxtLink v-for="s in scans" :key="s.id" :to="`/scans/${s.id}`" class="row scan-row">
        <code class="mono muted">#{{ String(s.id).padStart(4, '0') }}</code>
        <strong>{{ s.target }}</strong>
        <StatusPill :status="s.status" />
        <div class="counts">
          <span v-if="s.critical" class="count critical">{{ s.critical }} C</span>
          <span v-if="s.high" class="count high">{{ s.high }} H</span>
          <span v-if="s.medium" class="count medium">{{ s.medium }} M</span>
          <span v-if="s.low" class="count low">{{ s.low }} L</span>
          <span class="muted mono">{{ s.total }} au total</span>
        </div>
        <span class="muted mono right">{{ s.origin }} · {{ formatDate(s.created_at) }}</span>
      </NuxtLink>
    </div>
  </section>
</template>
