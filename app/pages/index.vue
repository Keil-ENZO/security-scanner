<script setup lang="ts">
interface Counts { critical: number | null, high: number | null, medium: number | null, low: number | null, total: number }
// done_*: latest finished scan of the default branch, the counts are its counts
interface Target extends Counts { id: number, name: string, repo: string | null, url: string | null, scheduled: number, provider: string, has_auth: number, last_scan_id: number | null, done_scan_id: number | null, done_at: string | null }
interface ScanRow extends Counts { id: number, target: string, ref: string | null, origin: string, status: string, created_at: string }
// A scheduled batch, or a single scan
interface Entry extends Counts { key: string, origin: string, batch: string | null, status: string, created_at: string, finished: number, failed: number, scans: ScanRow[] }
interface History { entries: Entry[], more: boolean, active: number, last_done: string | null, last_scheduled: string | null }

const PAGE = 10
// Grows with "Load older". A refresh asks again for everything shown: nothing loaded is dropped
const limit = ref(PAGE)
const { data: targets, refresh: refreshTargets } = await useFetch<Target[]>('/api/targets')
const { data: history, refresh: refreshScans } = await useFetch<History>('/api/scans', { key: 'history', query: { limit }, watch: false })
const entries = computed(() => history.value?.entries ?? [])

const loadingMore = ref(false)
async function loadMore() {
  loadingMore.value = true
  limit.value += PAGE
  try {
    await refreshScans()
  }
  finally {
    loadingMore.value = false
  }
}

// Kept apart from the fetched data: a refresh does not collapse an expanded batch
const expanded = ref(new Set<string>())
function toggle(key: string) {
  if (!expanded.value.delete(key)) expanded.value.add(key)
}

// Same ids as the server providers
const providers = [
  { id: 'vercel', label: 'Vercel' },
  { id: 'netlify', label: 'Netlify' },
  { id: 'cloudflare', label: 'Cloudflare Pages' },
  { id: 'generic', label: 'GitHub Deployments' },
]
const form = reactive({ name: '', repo: '', url: '', authHeader: '', scheduled: true, provider: 'vercel' })
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
        provider: form.provider,
      },
    })
    Object.assign(form, { name: '', repo: '', url: '', authHeader: '', scheduled: true, provider: 'vercel' })
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

const active = computed(() => history.value?.active ?? 0)

// Refresh while a scan is running
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(async () => {
    if (!active.value) return
    await refreshScans()
    // After the history: a scan it shows as done is then in the target status
    await refreshTargets()
  }, 5000)
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
      <strong class="small">{{ formatDate(history?.last_done ?? null) }}</strong>
    </div>
    <div class="kpi">
      <span class="label">Last scheduled audit</span>
      <strong class="small">{{ formatDate(history?.last_scheduled ?? null) }}</strong>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <p class="label">
        Targets
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
      <label>Deployment<select v-model="form.provider">
        <option
          v-for="p in providers"
          :key="p.id"
          :value="p.id"
        >
          {{ p.label }}
        </option>
      </select></label>
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
        class="row target-row status-row"
      >
        <div>
          <NuxtLink
            :to="`/targets/${t.id}`"
            class="target-link"
          ><strong>{{ t.name }}</strong></NuxtLink>
          <div class="tags">
            <span
              v-if="t.repo"
              class="tag"
            >{{ providers.find(p => p.id === t.provider)?.label ?? t.provider }}</span>
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
        <div class="target-source">
          <code class="mono muted">{{ t.repo ?? '—' }}</code>
          <code class="mono muted">{{ t.url ?? '—' }}</code>
        </div>
        <NuxtLink
          v-if="t.done_scan_id"
          :to="`/scans/${t.done_scan_id}`"
          class="target-status"
        >
          <SevCounts :counts="t" />
          <span class="when mono muted">Last scan {{ formatDate(t.done_at) }} →</span>
        </NuxtLink>
        <span
          v-else
          class="mono muted"
        >{{ t.last_scan_id ? 'No finished scan' : 'Never scanned' }}</span>
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
      History
    </p>
    <p
      v-if="!entries.length"
      class="empty"
    >
      No scans.
    </p>
    <template v-else>
      <div class="rows">
        <template
          v-for="e in entries"
          :key="e.key"
        >
          <template v-if="e.batch">
            <button
              type="button"
              class="row scan-row history-row history-toggle"
              :aria-expanded="expanded.has(e.key)"
              :aria-controls="`history-${e.key}`"
              @click="toggle(e.key)"
            >
              <span :class="['tag', 'origin', e.origin]">{{ ORIGIN_LABEL[e.origin] ?? e.origin }}</span>
              <span>
                <span
                  class="chevron"
                  aria-hidden="true"
                >{{ expanded.has(e.key) ? '▾' : '▸' }}</span>
                <strong>{{ e.scans.length }} {{ e.scans.length === 1 ? 'target' : 'targets' }}</strong>
                <span
                  v-if="e.finished < e.scans.length"
                  class="mono muted"
                > · {{ e.finished }}/{{ e.scans.length }} finished</span>
                <span
                  v-if="e.failed"
                  class="mono muted"
                > · {{ e.failed }} failed</span>
              </span>
              <StatusPill :status="e.status" />
              <SevCounts :counts="e" />
              <span class="muted mono right">{{ formatDate(e.created_at) }}</span>
            </button>
            <div
              v-show="expanded.has(e.key)"
              :id="`history-${e.key}`"
              class="rows history-scans"
            >
              <NuxtLink
                v-for="s in e.scans"
                :key="s.id"
                :to="`/scans/${s.id}`"
                class="row scan-row history-row"
              >
                <code class="mono muted">#{{ String(s.id).padStart(4, '0') }}</code>
                <span><strong>{{ s.target }}</strong> <code
                  v-if="s.ref"
                  class="mono muted"
                >⎇ {{ s.ref }}</code></span>
                <StatusPill :status="s.status" />
                <SevCounts :counts="s" />
                <span class="muted mono right">{{ formatDate(s.created_at) }}</span>
              </NuxtLink>
            </div>
          </template>
          <template v-else>
            <NuxtLink
              v-for="s in e.scans"
              :key="s.id"
              :to="`/scans/${s.id}`"
              class="row scan-row history-row"
            >
              <span :class="['tag', 'origin', s.origin]">{{ ORIGIN_LABEL[s.origin] ?? s.origin }}</span>
              <span><strong>{{ s.target }}</strong> <code class="mono muted">#{{ String(s.id).padStart(4, '0') }}</code> <code
                v-if="s.ref"
                class="mono muted"
              >⎇ {{ s.ref }}</code></span>
              <StatusPill :status="s.status" />
              <SevCounts :counts="s" />
              <span class="muted mono right">{{ formatDate(s.created_at) }}</span>
            </NuxtLink>
          </template>
        </template>
      </div>
      <button
        v-if="history?.more"
        type="button"
        class="ghost load-more"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? 'Loading…' : 'Load older' }}
      </button>
    </template>
  </section>
</template>
