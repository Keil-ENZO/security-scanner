<script setup lang="ts">
interface Target { id: number, name: string, repo: string | null, url: string | null, scheduled: number, has_auth: number, last_scan_id: number | null }
interface ScanRow { id: number, target: string, ref: string | null, origin: string, status: string, created_at: string, critical: number, high: number, medium: number, low: number, total: number }

const { data: targets, refresh: refreshTargets } = await useFetch<Target[]>('/api/targets')
const { data: scans, refresh: refreshScans } = await useFetch<ScanRow[]>('/api/scans')

const form = reactive({ name: '', repo: '', url: '', authHeader: '', scheduled: true })
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
        scheduled: form.scheduled,
      },
    })
    Object.assign(form, { name: '', repo: '', url: '', authHeader: '', scheduled: true })
    showForm.value = false
    await refreshTargets()
  }
  catch (err: any) {
    error.value = err?.data?.message ?? 'Error'
  }
}

async function scan(id: number) {
  const { scanId } = await $fetch<{ scanId: number }>(`/api/targets/${id}/scan`, { method: 'POST' })
  await navigateTo(`/scans/${scanId}`)
}

async function remove(t: Target) {
  if (!confirm(`Delete ${t.name} and its scans?`)) return
  await $fetch(`/api/targets/${t.id}`, { method: 'DELETE' })
  await Promise.all([refreshTargets(), refreshScans()])
}

const active = computed(() => scans.value?.filter(s => s.status === 'queued' || s.status === 'running').length ?? 0)
const lastDone = computed(() => scans.value?.find(s => s.status === 'done'))
const lastScheduled = computed(() => scans.value?.find(s => s.origin === 'scheduled'))

// Refresh while a scan is running
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => active.value && refreshScans(), 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section class="kpis">
    <div class="kpi">
      <span class="label">Targets</span>
      <strong>{{ targets?.length ?? 0 }}</strong>
    </div>
    <div class="kpi">
      <span class="label">Active scans</span>
      <strong :class="{ live: active }">{{ active }}</strong>
    </div>
    <div class="kpi">
      <span class="label">Last audit</span>
      <strong class="small">{{ lastDone ? formatDate(lastDone.created_at) : '—' }}</strong>
    </div>
    <div class="kpi">
      <span class="label">Last scheduled audit</span>
      <strong class="small">{{ lastScheduled ? formatDate(lastScheduled.created_at) : '—' }}</strong>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <p class="label">
        // Targets
      </p>
      <button
        class="ghost"
        @click="showForm = !showForm"
      >
        {{ showForm ? 'Cancel' : '+ New target' }}
      </button>
    </div>

    <form
      v-if="showForm"
      class="target-form"
      @submit.prevent="addTarget"
    >
      <label>Name<input
        v-model="form.name"
        placeholder="My app"
        required
      ></label>
      <label>GitHub repository<input
        v-model="form.repo"
        placeholder="https://github.com/your-user/my-app"
      ></label>
      <label>URL<input
        v-model="form.url"
        placeholder="https://my-app.example.com"
      ></label>
      <label>Test credentials<input
        v-model="form.authHeader"
        type="password"
        placeholder="Cookie: session=…"
        autocomplete="off"
      ></label>
      <label class="check"><input
        v-model="form.scheduled"
        type="checkbox"
      > Include in the scheduled audit</label>
      <button type="submit">
        Add target
      </button>
      <p
        v-if="error"
        class="error"
      >
        ✕ {{ error }}
      </p>
    </form>

    <p
      v-if="!targets?.length"
      class="empty"
    >
      No targets.
    </p>
    <div
      v-else
      class="rows"
    >
      <div
        v-for="t in targets"
        :key="t.id"
        class="row target-row"
      >
        <div>
          <NuxtLink
            :to="`/targets/${t.id}`"
            class="target-link"
          ><strong>{{ t.name }}</strong></NuxtLink>
          <div class="tags">
            <span
              v-if="t.scheduled"
              class="tag"
            >scheduled</span>
            <span
              v-if="t.has_auth"
              class="tag"
            >authenticated</span>
          </div>
        </div>
        <code class="mono muted">{{ t.repo ?? '—' }}</code>
        <code class="mono muted">{{ t.url ?? '—' }}</code>
        <div class="actions">
          <NuxtLink
            v-if="t.repo"
            :to="`/targets/${t.id}`"
            class="btn ghost-btn"
          >⎇ Branches</NuxtLink>
          <button @click="scan(t.id)">
            ▶ Scan
          </button>
          <button
            class="ghost danger"
            title="Delete"
            @click="remove(t)"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  </section>

  <section class="panel">
    <p class="label">
      // History
    </p>
    <p
      v-if="!scans?.length"
      class="empty"
    >
      No scans.
    </p>
    <div
      v-else
      class="rows"
    >
      <NuxtLink
        v-for="s in scans"
        :key="s.id"
        :to="`/scans/${s.id}`"
        class="row scan-row"
      >
        <code class="mono muted">#{{ String(s.id).padStart(4, '0') }}</code>
        <span><strong>{{ s.target }}</strong> <code
          v-if="s.ref"
          class="mono muted"
        >⎇ {{ s.ref }}</code></span>
        <StatusPill :status="s.status" />
        <div class="counts">
          <span
            v-if="s.critical"
            class="count critical"
          >{{ s.critical }} C</span>
          <span
            v-if="s.high"
            class="count high"
          >{{ s.high }} H</span>
          <span
            v-if="s.medium"
            class="count medium"
          >{{ s.medium }} M</span>
          <span
            v-if="s.low"
            class="count low"
          >{{ s.low }} L</span>
          <span class="muted mono">{{ s.total }} total</span>
        </div>
        <span class="muted mono right">{{ s.origin }} · {{ formatDate(s.created_at) }}</span>
      </NuxtLink>
    </div>
  </section>
</template>
