<script setup lang="ts">
interface Finding { id: number, tool: string, severity: string, title: string, rule_id: string | null, cve: string | null, cwe: string | null, cvss: number | null, location: string | null, description: string | null, remediation: string | null }
interface Fix { id: number, status: string, branch: string | null, pr_url: string | null, summary: string | null, error: string | null, created_at: string }
interface Scan { id: number, target_id: number, ref: string | null, target: string, repo: string | null, url: string | null, status: string, origin: string, error: string | null, summary: string | null, created_at: string, finished_at: string | null, sbom_components: number | null }

const route = useRoute()
const { data, error: loadError, refresh } = await useFetch<{ scan: Scan, findings: Finding[], fixes: Fix[] }>(`/api/scans/${route.params.id}`)

// The target page lists branches: it only exists for a target with a repository
const crumbs = computed(() => {
  const s = data.value?.scan
  if (!s) return [{ label: 'Targets', to: '/' }, { label: `Scan #${route.params.id}` }]
  return [
    { label: 'Targets', to: '/' },
    s.repo ? { label: s.target, to: `/targets/${s.target_id}` } : { label: s.target },
    { label: `Scan #${s.id}` },
  ]
})

const tool = ref('')
const severity = ref('')
const query = ref('')
const findings = computed(() => data.value?.findings ?? [])
const filtered = computed(() => findings.value.filter(f => matchFinding(f, { tool: tool.value, severity: severity.value, query: query.value })))
const filtering = computed(() => !!(tool.value || severity.value || query.value.trim()))
const tools = computed(() => toolCounts(findings.value))

function clearFilters() {
  tool.value = ''
  severity.value = ''
  query.value = ''
}

const counts = computed(() => {
  const c: Record<string, number> = Object.fromEntries(SEVERITY_ORDER.map(s => [s, 0]))
  for (const f of findings.value) c[f.severity] = (c[f.severity] ?? 0) + 1
  return c
})
const worst = computed(() => SEVERITY_ORDER.find(s => counts.value[s] && s !== 'info') ?? 'ok')

// The report: "Verdict: …" then dashes
const report = computed(() => {
  const lines = (data.value?.scan.summary ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  const verdict = lines[0]?.replace(/^Verdict\s*:\s*/i, '') ?? ''
  const items = lines.slice(1).map(l => l.replace(/^[-•]\s*/, ''))
  return { verdict, items }
})

const scanning = computed(() => ['queued', 'running'].includes(data.value?.scan.status ?? ''))
const fixing = computed(() => data.value?.fixes.some(f => f.status === 'queued' || f.status === 'running') ?? false)
// Fixes start from a finished scan of the default branch of a repository
const fixable = computed(() => data.value?.scan.status === 'done' && !!data.value.scan.repo && !data.value.scan.ref)

const fixDialog = ref<{ ask: () => Promise<boolean> }>()
const { busy, error: fixError, run } = useAction()

async function fix() {
  if (!await fixDialog.value?.ask()) return
  await run('fix', async () => {
    await $fetch(`/api/scans/${route.params.id}/fix`, { method: 'POST' })
    await refresh()
  })
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (scanning.value || fixing.value) && refresh(), 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<!-- Guardrail: everything renders as text, never v-html. Findings come from external sources -->
<template>
  <div class="scan-page">
    <BreadcrumbTrail :items="crumbs" />

    <template v-if="data">
      <section class="scan-head">
        <div class="scan-title">
          <p class="label">
            Scan #{{ data.scan.id }}
            <span :class="['tag', 'origin', data.scan.origin]">{{ ORIGIN_LABEL[data.scan.origin] ?? data.scan.origin }}</span>
          </p>
          <h1>{{ data.scan.target }} <StatusPill :status="data.scan.status" /></h1>
          <dl class="scan-facts">
            <div v-if="data.scan.repo">
              <dt>Repository</dt>
              <dd class="mono">
                {{ data.scan.repo }}
              </dd>
            </div>
            <div v-if="data.scan.ref">
              <dt>Branch</dt>
              <dd class="mono">
                {{ data.scan.ref }}
              </dd>
            </div>
            <!-- A branch is only tested through its code: its scan never reaches the site -->
            <div v-if="data.scan.url && !data.scan.ref">
              <dt>Site</dt>
              <dd class="mono">
                {{ data.scan.url }}
              </dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd class="mono">
                {{ formatDate(data.scan.created_at) }}
              </dd>
            </div>
            <div v-if="data.scan.sbom_components !== null">
              <dt>SBOM</dt>
              <dd>
                <a
                  :href="`/api/scans/${data.scan.id}/sbom`"
                  download
                  class="sbom-link"
                >Download, {{ data.scan.sbom_components }} {{ data.scan.sbom_components === 1 ? 'component' : 'components' }}</a>
              </dd>
            </div>
          </dl>
        </div>
        <div
          v-if="fixable"
          class="fix-action"
        >
          <button
            class="fix-btn"
            :disabled="!!busy || fixing"
            @click="fix"
          >
            {{ busy === 'fix' ? 'Starting the fix…' : fixing ? 'Fix running…' : 'Fix' }}
          </button>
          <p
            v-if="fixError"
            class="error"
            role="alert"
          >
            {{ fixError }}
          </p>
          <p
            v-else-if="!fixing"
            class="help"
          >
            Prepares a branch with the fixes. Asks before it starts.
          </p>
        </div>
      </section>

      <ConfirmDialog
        ref="fixDialog"
        title="Start an automatic fix?"
        confirm-label="Start the fix"
      >
        <p>
          The fix works on a fresh clone of <code>{{ data.scan.repo }}</code>, on a new branch named
          <code>security/scan-{{ data.scan.id }}-fix-N</code>. The default branch is not changed, and no code from the repository is run.
        </p>
        <ul class="fix-steps">
          <li>Vulnerable dependencies that have a fixed version are upgraded in <code>package.json</code> and in the root lockfile. A transitive dependency never gets a major version.</li>
          <li>Security headers that this scan found missing, and that cannot break the app, are added to the config file of the deployment provider, when it has one.</li>
          <li>The branch is pushed to GitHub, then scanned.</li>
        </ul>
        <p>No pull request is opened: you review the branch first. If nothing can be fixed automatically, nothing is pushed.</p>
      </ConfirmDialog>

      <!-- A finished scan keeps the errors of the tools that failed -->
      <section
        v-if="data.scan.error"
        class="panel alert"
      >
        <p class="label">
          {{ data.scan.status === 'failed' ? 'The scan failed' : 'Some steps failed' }}
        </p>
        <pre>{{ data.scan.error }}</pre>
      </section>

      <section class="sev-filter">
        <div
          class="kpis sev-kpis"
          role="group"
          aria-labelledby="sev-filter-help"
        >
          <button
            v-for="s in SEVERITY_ORDER"
            :key="s"
            :class="['kpi', 'sev-kpi', s, { off: !counts[s] }]"
            :aria-pressed="severity === s"
            :disabled="!counts[s] && severity !== s"
            @click="severity = severity === s ? '' : s"
          >
            <span class="label">{{ s }}</span>
            <strong>{{ counts[s] }}</strong>
          </button>
        </div>
        <p
          id="sev-filter-help"
          :class="['help', { 'sr-only': !findings.length }]"
        >
          Select a severity to filter the findings.
        </p>
      </section>

      <section
        v-if="scanning"
        class="panel scanning"
      >
        <span class="spinner" /> Scan running. A few minutes, up to half an hour for a site.
      </section>

      <section
        v-for="f in data.fixes"
        :key="f.id"
        :class="['panel', 'fix-panel', f.status]"
      >
        <div class="panel-head">
          <p class="label">
            Fix #{{ f.id }} · {{ formatDate(f.created_at) }}
          </p>
          <StatusPill :status="f.status" />
        </div>
        <p
          v-if="f.status === 'queued' || f.status === 'running'"
          class="scanning"
        >
          <span class="spinner" /> Branch, upgrades, another Grype pass, then a scan of the branch.
        </p>
        <ul
          v-if="f.summary"
          class="fix-list"
        >
          <li
            v-for="(line, i) in f.summary.split('\n')"
            :key="i"
            :class="{ ok: line.startsWith('✓'), ko: line.startsWith('✕') }"
          >
            {{ line }}
          </li>
        </ul>
        <pre
          v-if="f.error"
          class="error"
        >{{ f.error }}</pre>
        <NuxtLink
          v-if="f.branch"
          :to="`/targets/${data.scan.target_id}/review?ref=${encodeURIComponent(f.branch)}`"
          class="pr-link"
        >→ Review {{ f.branch }}</NuxtLink>
        <a
          v-else-if="f.pr_url"
          :href="f.pr_url"
          target="_blank"
          rel="noopener noreferrer"
          class="pr-link"
        >↗ View the pull request</a>
      </section>

      <section
        v-if="data.scan.summary"
        :class="['panel', 'report', worst]"
      >
        <p class="label">
          Report
        </p>
        <p class="verdict">
          {{ report.verdict }}
        </p>
        <ol v-if="report.items.length">
          <li
            v-for="(item, i) in report.items"
            :key="i"
          >
            {{ item }}
          </li>
        </ol>
      </section>

      <section
        v-if="findings.length"
        class="panel"
      >
        <div class="panel-head findings-head">
          <p
            class="label"
            aria-live="polite"
          >
            Findings · {{ filtered.length }} / {{ findings.length }}
          </p>
          <button
            v-if="filtering"
            class="ghost clear-filters"
            @click="clearFilters"
          >
            Clear filters
          </button>
        </div>
        <div class="filters">
          <label class="filter-search">
            Search
            <input
              v-model="query"
              type="search"
              placeholder="Title, location or rule id"
            >
          </label>
          <label>
            Tool
            <select v-model="tool">
              <option value="">
                All tools
              </option>
              <option
                v-for="t in tools"
                :key="t.tool"
                :value="t.tool"
              >
                {{ t.tool }} ({{ t.count }})
              </option>
            </select>
          </label>
          <label>
            Severity
            <select v-model="severity">
              <option value="">
                All severities
              </option>
              <option
                v-for="s in SEVERITY_ORDER.filter(s => counts[s])"
                :key="s"
                :value="s"
              >
                {{ s.charAt(0).toUpperCase() + s.slice(1) }} ({{ counts[s] }})
              </option>
            </select>
          </label>
        </div>
        <EmptyState
          v-if="!filtered.length"
          title="No finding matches these filters"
        >
          Change the search, the tool or the severity, or clear the filters to see all {{ findings.length }} findings.
          <template #action>
            <button
              class="ghost"
              @click="clearFilters"
            >
              Clear filters
            </button>
          </template>
        </EmptyState>
        <details
          v-for="f in filtered"
          :key="f.id"
          :class="['finding', f.severity]"
        >
          <summary>
            <SevBadge :severity="f.severity" />
            <span class="tool mono">{{ f.tool }}</span>
            <span class="title">{{ f.title }}</span>
            <code class="loc mono">{{ f.location }}</code>
          </summary>
          <dl>
            <template v-if="f.location">
              <dt>Location</dt><dd class="mono">
                {{ f.location }}
              </dd>
            </template>
            <template v-if="f.rule_id">
              <dt>Rule</dt><dd class="mono">
                {{ f.rule_id }}
              </dd>
            </template>
            <template v-if="f.cve">
              <dt>CVE</dt><dd class="mono">
                {{ f.cve }}
              </dd>
            </template>
            <template v-if="f.cwe">
              <dt>CWE</dt><dd class="mono">
                {{ f.cwe }}
              </dd>
            </template>
            <template v-if="f.cvss">
              <dt>CVSS</dt><dd class="mono">
                {{ f.cvss }}
              </dd>
            </template>
            <template v-if="f.description">
              <dt>Details</dt><dd>{{ f.description }}</dd>
            </template>
            <template v-if="f.remediation">
              <dt>Fix</dt><dd class="fix">
                {{ f.remediation }}
              </dd>
            </template>
          </dl>
        </details>
      </section>
      <section
        v-else-if="data.scan.status === 'done'"
        class="panel"
      >
        <EmptyState title="No findings">
          {{ data.scan.error
            ? 'The tools that ran reported nothing, but some steps failed: read the errors above before trusting this result.'
            : 'This scan finished and no tool reported anything.' }}
        </EmptyState>
      </section>
    </template>

    <section
      v-else
      class="panel"
    >
      <EmptyState title="This scan cannot be shown">
        {{ errorMessage(loadError) }}
        <template #action>
          <NuxtLink
            to="/"
            class="btn ghost-btn"
          >
            Back to targets
          </NuxtLink>
        </template>
      </EmptyState>
    </section>
  </div>
</template>
