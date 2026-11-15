<script setup lang="ts">
interface Counts { critical: number | null, high: number | null, medium: number | null, low: number | null, total: number }
// done_*: latest finished scan of the default branch, the counts are its counts
interface Target extends Counts { id: number, name: string, repo: string | null, url: string | null, scheduled: number, provider: string, has_auth: number, last_scan_id: number | null, done_scan_id: number | null, done_at: string | null }
interface ScanRow extends Counts { id: number, target: string, ref: string | null, origin: string, status: string, created_at: string }
// A scheduled batch, or a single scan
interface Entry extends Counts { key: string, origin: string, batch: string | null, status: string, created_at: string, finished: number, failed: number, scans: ScanRow[] }
interface History { entries: Entry[], more: boolean, active: number, last_scheduled: string | null }

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
const blank = () => ({ name: '', repo: '', url: '', authHeader: '', scheduled: true, provider: 'vercel' })
const form = reactive(blank())
const showForm = ref(false)
const nameInput = ref<HTMLInputElement>()
const formToggle = ref<HTMLButtonElement>()

const { busy, error, run } = useAction()
// Name of the last action started: its error shows next to its button, not at the top of the page
const last = ref('')
function act<T>(name: string, fn: () => Promise<T>) {
  if (!busy.value) last.value = name
  return run(name, fn)
}
const failed = (...names: string[]) => names.includes(last.value) ? error.value : ''

// The cursor goes to the first field, also when the form opens from the empty state
async function toggleForm() {
  showForm.value = !showForm.value
  if (!showForm.value) return
  // A form opened again starts without the error of the last attempt
  if (last.value === 'add') error.value = ''
  await nextTick()
  nameInput.value?.focus()
}

async function addTarget() {
  await act('add', async () => {
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
    Object.assign(form, blank())
    showForm.value = false
    await refreshTargets()
    // The submit button is gone with the form
    formToggle.value?.focus()
  })
}

async function scan(t: Target) {
  await act(`scan-${t.id}`, async () => {
    const { scanId } = await $fetch<{ scanId: number }>(`/api/targets/${t.id}/scan`, { method: 'POST' })
    await navigateTo(`/scans/${scanId}`)
  })
}

const confirmDelete = ref<{ ask: () => Promise<boolean> }>()
// The target named in the dialog
const deleting = ref<Target>()
async function remove(t: Target) {
  deleting.value = t
  if (!await confirmDelete.value?.ask()) return
  await act(`delete-${t.id}`, async () => {
    await $fetch(`/api/targets/${t.id}`, { method: 'DELETE' })
    await Promise.all([refreshTargets(), refreshScans()])
    // Its row is gone, and the focus with it
    formToggle.value?.focus()
  })
}

// Summary: what is open on the default branches, see openFindings
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
const open = computed(() => openFindings(targets.value ?? []))
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
  <section
    v-if="targets?.length"
    class="summary"
    aria-label="Summary"
  >
    <div class="summary-item">
      <span class="label">Open findings</span>
      <template v-if="open.scanned">
        <span
          v-for="s in SEVERITIES"
          :key="s"
          :class="['count', open[s] ? s : 'zero']"
        >{{ open[s] }} {{ s }}</span>
        <span class="muted mono">{{ open.total }} total</span>
        <span
          v-if="open.scanned < targets.length"
          class="muted"
        >{{ open.scanned }} of {{ targets.length }} targets scanned</span>
      </template>
      <span
        v-else
        class="muted"
      >No finished scan yet</span>
    </div>
    <div class="summary-item">
      <span :class="['status', { running: active }]"><i />{{ active ? `${active} ${active === 1 ? 'scan' : 'scans'} running` : 'No scan running' }}</span>
    </div>
    <div class="summary-item">
      <span class="label">Last scheduled audit</span>
      <span class="mono">{{ history?.last_scheduled ? formatDate(history.last_scheduled) : 'never' }}</span>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <p class="label">
        Targets
      </p>
      <button
        ref="formToggle"
        class="ghost"
        :aria-expanded="showForm"
        aria-controls="target-form"
        @click="toggleForm"
      >
        {{ showForm ? 'Cancel' : '+ New target' }}
      </button>
    </div>

    <form
      v-if="showForm"
      id="target-form"
      class="target-form"
      @submit.prevent="addTarget"
    >
      <div class="field">
        <label for="target-name">Name</label>
        <input
          id="target-name"
          ref="nameInput"
          v-model="form.name"
          placeholder="Shop"
          maxlength="100"
          pattern=".*\S.*"
          title="At least one character that is not a space"
          required
          aria-describedby="target-name-help"
        >
        <p
          id="target-name-help"
          class="help"
        >
          A label of your choice, shown in the lists. 100 characters at most.
        </p>
      </div>
      <div class="field">
        <label for="target-repo">GitHub repository</label>
        <input
          id="target-repo"
          v-model="form.repo"
          placeholder="https://github.com/acme/shop"
          maxlength="300"
          inputmode="url"
          autocapitalize="off"
          spellcheck="false"
          aria-describedby="target-repo-help"
        >
        <p
          id="target-repo-help"
          class="help"
        >
          Optional if a URL is set. <code>https://github.com/&lt;owner&gt;/&lt;repo&gt;</code>, with an owner listed in <code>NUXT_ALLOWED_OWNERS</code>. A private repository needs <code>NUXT_GITHUB_TOKEN</code>.
        </p>
      </div>
      <div class="field">
        <label for="target-url">URL</label>
        <input
          id="target-url"
          v-model="form.url"
          placeholder="https://shop.example.com"
          maxlength="500"
          inputmode="url"
          autocapitalize="off"
          spellcheck="false"
          aria-describedby="target-url-help"
        >
        <p
          id="target-url-help"
          class="help"
        >
          Optional if a repository is set. An <code>http</code> or <code>https</code> address without credentials, on a domain listed in <code>NUXT_ALLOWED_HOSTS</code>. <code>*.example.com</code> covers subdomains.
        </p>
      </div>
      <div class="field">
        <label for="target-provider">Deployment</label>
        <select
          id="target-provider"
          v-model="form.provider"
          aria-describedby="target-provider-help"
        >
          <option
            v-for="p in providers"
            :key="p.id"
            :value="p.id"
          >
            {{ p.label }}
          </option>
        </select>
        <p
          id="target-provider-help"
          class="help"
        >
          Where the repository deploys: how the deployment of a commit is found, and which file receives the security headers of a fix.
        </p>
      </div>
      <div class="field">
        <label for="target-auth">Test credentials</label>
        <input
          id="target-auth"
          v-model="form.authHeader"
          type="password"
          placeholder="Cookie: session=…"
          maxlength="8300"
          autocomplete="off"
          aria-describedby="target-auth-help"
        >
        <p
          id="target-auth-help"
          class="help"
        >
          Optional, needs a URL. One HTTP header for the site scan, as <code>Name: value</code>. Stored encrypted with AES-256-GCM and never shown again. Nuclei reads it from a file scoped to the domain, deleted after the scan.
        </p>
      </div>
      <div class="field">
        <label class="check"><input
          v-model="form.scheduled"
          type="checkbox"
          aria-describedby="target-scheduled-help"
        > Include in the scheduled audit</label>
        <p
          id="target-scheduled-help"
          class="help"
        >
          Scanned with the other scheduled targets each time a scheduler calls the automation API.
        </p>
      </div>
      <div class="form-actions">
        <button
          type="submit"
          :disabled="!!busy"
        >
          {{ busy === 'add' ? 'Adding…' : 'Add target' }}
        </button>
        <p
          v-if="failed('add')"
          class="error"
          role="alert"
        >
          <span aria-hidden="true">✕ </span>{{ failed('add') }}
        </p>
      </div>
    </form>

    <EmptyState
      v-if="!targets?.length && !showForm"
      title="No target yet"
    >
      A target is what this instance audits: a GitHub repository, the URL of a live site, or both. Add one to run a first scan.
      <template #action>
        <button @click="toggleForm">
          Add a target
        </button>
      </template>
    </EmptyState>
    <div
      v-else-if="targets?.length"
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
          ><span aria-hidden="true">⎇ </span>Branches <span class="sr-only">of {{ t.name }}</span></NuxtLink>
          <button
            :disabled="!!busy"
            @click="scan(t)"
          >
            <span aria-hidden="true">▶ </span>{{ busy === `scan-${t.id}` ? 'Starting…' : 'Scan' }} <span class="sr-only">{{ t.name }}</span>
          </button>
          <button
            class="ghost danger"
            :disabled="!!busy"
            @click="remove(t)"
          >
            {{ busy === `delete-${t.id}` ? 'Deleting…' : 'Delete' }} <span class="sr-only">{{ t.name }}</span>
          </button>
        </div>
        <p
          v-if="failed(`scan-${t.id}`, `delete-${t.id}`)"
          class="error row-error"
          role="alert"
        >
          <span aria-hidden="true">✕ </span>{{ failed(`scan-${t.id}`, `delete-${t.id}`) }}
        </p>
      </div>
    </div>

    <!-- aria-label: the shared dialog has no accessible name of its own -->
    <ConfirmDialog
      ref="confirmDelete"
      :title="`Delete ${deleting?.name}?`"
      :aria-label="`Delete ${deleting?.name}`"
      confirm-label="Delete target"
      danger
    >
      <p>All the scans of <strong>{{ deleting?.name }}</strong> go with it: their findings, reports, SBOMs and fix records.</p>
      <p>This cannot be undone.</p>
    </ConfirmDialog>
  </section>

  <!-- Without a target there is no scan to list -->
  <section
    v-if="targets?.length || entries.length"
    class="panel"
  >
    <p class="label">
      History
    </p>
    <EmptyState
      v-if="!entries.length"
      title="No scan yet"
    >
      Press Scan on a target to audit it now. Targets included in the scheduled audit are also scanned each time a scheduler calls the automation API.
    </EmptyState>
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
