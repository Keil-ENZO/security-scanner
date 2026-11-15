<script setup lang="ts">
interface Target { id: number, name: string, repo: string | null, url: string | null }
interface LastScan { id: number, status: string, sha: string | null, created_at: string, critical: number, high: number, medium: number, low: number }
interface Branch { name: string, sha: string, isDefault: boolean, protected: boolean, scanner: boolean, pr: { number: number, url: string } | null, lastScan: LastScan | null }

const route = useRoute()
const id = route.params.id as string
const { data: target } = await useFetch<Target>(`/api/targets/${id}`)
interface Deploy { provider: string, base: string, sha: string, message: string, date: string, state: string, url: string | null, description: string | null, logs: string | null, logsHint: string | null }
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

const { busy: acting, error: actionError, run } = useAction()
const scan = (b: Branch) => run(`scan:${b.name}`, async () => {
  await $fetch(`/api/targets/${id}/scan`, { method: 'POST', body: b.isDefault ? {} : { ref: b.name } })
  await refresh()
})

// Has the latest commit of the branch been scanned?
const fresh = (b: Branch) => !!b.lastScan && (b.lastScan.sha === b.sha || b.lastScan.sha === null)
</script>

<template>
  <BreadcrumbTrail :items="[{ label: 'Targets', to: '/' }, { label: target?.name ?? 'Target' }]" />
  <section
    v-if="target"
    class="scan-head"
  >
    <div>
      <h1>{{ target.name }}</h1>
      <dl class="facts">
        <div v-if="target.repo">
          <dt>Repository</dt><dd class="mono">
            {{ target.repo }}
          </dd>
        </div>
        <div v-if="target.url">
          <dt>Site</dt><dd class="mono">
            {{ target.url }}
          </dd>
        </div>
      </dl>
    </div>
  </section>
  <section
    v-if="target && !target.repo"
    class="panel"
  >
    <EmptyState title="No repository on this target">
      Only the site is scanned. Branches, fixes and reviews need a GitHub repository. Scans of the site start from the home page.
    </EmptyState>
  </section>

  <section
    v-if="deploy && target?.repo"
    :class="['panel', 'deploy', deploy.state]"
  >
    <div class="panel-head">
      <p class="label">
        Production · {{ deploy.base }}
      </p>
      <button
        class="ghost"
        @click="refreshDeploy()"
      >
        ↻ Refresh
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
        class="small-link"
      >Open on {{ deploy.provider }} ↗</a>
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
        v-else-if="deploy.logsHint"
        class="muted mono"
      >
        {{ deploy.logsHint }}
      </p>
    </template>
  </section>

  <section
    v-if="target?.repo"
    class="panel"
  >
    <div class="panel-head">
      <p class="label">
        Branches
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
    <p
      v-if="actionError"
      class="error"
      role="alert"
    >
      ✕ {{ actionError }}
    </p>
    <p
      v-if="data && !error"
      class="help"
    >
      Scan a branch, then review it to compare it with {{ data.base }} and merge it.
    </p>
    <div
      v-if="data && !error"
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
              class="stale"
            >New commits since this scan</span>
          </template>
          <span
            v-else
            class="muted"
          >Never scanned</span>
        </div>
        <div class="actions">
          <button
            class="ghost"
            :disabled="!!acting"
            @click="scan(b)"
          >
            {{ acting === `scan:${b.name}` ? 'Starting…' : '▶ Scan' }}<span class="sr-only"> {{ b.name }}</span>
          </button>
          <NuxtLink
            v-if="!b.isDefault"
            :to="`/targets/${id}/review?ref=${encodeURIComponent(b.name)}`"
            class="btn"
          >Review<span class="sr-only"> {{ b.name }}</span> →</NuxtLink>
        </div>
      </div>
    </div>
  </section>
</template>
