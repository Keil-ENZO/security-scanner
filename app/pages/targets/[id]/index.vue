<script setup lang="ts">
interface Target { id: number, name: string, repo: string | null, url: string | null }
interface LastScan { id: number, status: string, sha: string | null, created_at: string, critical: number, high: number, medium: number, low: number }
interface Branch { name: string, sha: string, isDefault: boolean, protected: boolean, scanner: boolean, pr: { number: number, url: string } | null, lastScan: LastScan | null }

const route = useRoute()
const id = route.params.id as string
const { data: target } = await useFetch<Target>(`/api/targets/${id}`)
interface Deploy { base: string, sha: string, message: string, date: string, state: string, url: string | null, description: string | null, logs: string | null }
const { data: deploy, refresh: refreshDeploy } = await useFetch<Deploy>(`/api/targets/${id}/deploy`, { lazy: true })
const deployLabel: Record<string, string> = { success: 'Live', failure: 'Failed', pending: 'Pending', none: 'No deployment', unavailable: 'Unreadable' }
const { data, error, refresh, status } = await useFetch<{ base: string, branches: Branch[] }>(`/api/targets/${id}/branches`, { lazy: true })

const errorMessage = computed(() => (error.value?.data as { message?: string } | undefined)?.message ?? 'GitHub error')
const busy = computed(() => data.value?.branches.some(b => b.lastScan && ['queued', 'running'].includes(b.lastScan.status)))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (busy.value) refresh()
    if (deploy.value?.state === 'pending') refreshDeploy()
  }, 5000)
})
onUnmounted(() => clearInterval(timer))

async function scan(b: Branch) {
  await $fetch(`/api/targets/${id}/scan`, { method: 'POST', body: b.isDefault ? {} : { ref: b.name } })
  await refresh()
}

// Has the latest commit of the branch been scanned?
const fresh = (b: Branch) => !!b.lastScan && (b.lastScan.sha === b.sha || b.lastScan.sha === null)
</script>

<template>
  <NuxtLink
    to="/"
    class="back"
  >← Back</NuxtLink>
  <section
    v-if="target"
    class="scan-head"
  >
    <div>
      <p class="label">
        // Target
      </p>
      <h1>{{ target.name }}</h1>
      <div class="meta mono">
        <span v-if="target.repo">⎇ {{ target.repo }}</span>
        <span v-if="target.url">⌁ {{ target.url }}</span>
      </div>
    </div>
  </section>

  <section
    v-if="deploy && target?.repo"
    :class="['panel', 'deploy', deploy.state]"
  >
    <div class="panel-head">
      <p class="label">
        // Production · {{ deploy.base }}
      </p>
      <button
        class="ghost"
        @click="refreshDeploy()"
      >
        ↻
      </button>
    </div>
    <div class="deploy-line mono">
      <span :class="['status', deploy.state === 'success' ? 'done' : deploy.state === 'failure' ? 'failed' : 'running']"><i />{{ deployLabel[deploy.state] ?? deploy.state }}</span>
      <span class="muted">{{ deploy.sha.slice(0, 7) }}</span>
      <span>{{ deploy.message }}</span>
      <a
        v-if="deploy.url"
        :href="deploy.url"
        target="_blank"
        rel="noopener noreferrer"
      >↗ Vercel</a>
    </div>
    <template v-if="deploy.state === 'failure'">
      <p class="muted">
        Production stays on the last successful deployment. {{ deploy.description }}
      </p>
      <pre
        v-if="deploy.logs"
        class="patch build-log"
      >{{ deploy.logs }}</pre>
      <p
        v-else
        class="muted mono"
      >
        Set NUXT_VERCEL_TOKEN to see the build log here.
      </p>
    </template>
  </section>

  <section class="panel">
    <div class="panel-head">
      <p class="label">
        // GitHub branches
      </p>
      <button
        class="ghost"
        @click="refresh()"
      >
        ↻ Refresh
      </button>
    </div>
    <p
      v-if="status === 'pending' && !data"
      class="empty"
    >
      Reading branches from GitHub…
    </p>
    <p
      v-else-if="error"
      class="error"
    >
      ✕ {{ errorMessage }}
    </p>
    <div
      v-else-if="data"
      class="rows"
    >
      <div
        v-for="b in data.branches"
        :key="b.name"
        class="row branch-row"
      >
        <div>
          <code class="mono branch-name">{{ b.name }}</code>
          <div class="tags">
            <span
              v-if="b.isDefault"
              class="tag accent"
            >default</span>
            <span
              v-if="b.scanner"
              class="tag"
            >fix</span>
            <span
              v-if="b.protected"
              class="tag"
            >protected</span>
            <a
              v-if="b.pr"
              :href="b.pr.url"
              target="_blank"
              rel="noopener noreferrer"
              class="tag accent"
            >PR #{{ b.pr.number }}</a>
          </div>
        </div>
        <code class="mono muted">{{ b.sha.slice(0, 7) }}</code>
        <div>
          <template v-if="b.lastScan">
            <NuxtLink
              :to="`/scans/${b.lastScan.id}`"
              class="counts"
            >
              <StatusPill :status="b.lastScan.status" />
              <span
                v-if="b.lastScan.critical"
                class="count critical"
              >{{ b.lastScan.critical }} C</span>
              <span
                v-if="b.lastScan.high"
                class="count high"
              >{{ b.lastScan.high }} H</span>
              <span
                v-if="b.lastScan.medium"
                class="count medium"
              >{{ b.lastScan.medium }} M</span>
              <span
                v-if="b.lastScan.low"
                class="count low"
              >{{ b.lastScan.low }} L</span>
            </NuxtLink>
            <span
              v-if="!fresh(b)"
              class="muted mono stale"
            >new commits since the scan</span>
          </template>
          <span
            v-else
            class="muted mono"
          >never scanned</span>
        </div>
        <div class="actions">
          <button
            class="ghost"
            @click="scan(b)"
          >
            ▶ Scan
          </button>
          <NuxtLink
            v-if="!b.isDefault"
            :to="`/targets/${id}/review?ref=${encodeURIComponent(b.name)}`"
            class="btn"
          >Review →</NuxtLink>
        </div>
      </div>
    </div>
  </section>
</template>
