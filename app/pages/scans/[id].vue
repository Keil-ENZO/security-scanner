<script setup lang="ts">
interface Finding { id: number, tool: string, severity: string, title: string, rule_id: string | null, cve: string | null, cwe: string | null, cvss: number | null, location: string | null, description: string | null, remediation: string | null }
interface Fix { id: number, status: string, branch: string | null, pr_url: string | null, summary: string | null, error: string | null, created_at: string }
interface Scan { id: number, target_id: number, ref: string | null, target: string, repo: string | null, url: string | null, status: string, origin: string, error: string | null, summary: string | null, created_at: string, finished_at: string | null, sbom_components: number | null }

const route = useRoute()
const { data, refresh } = await useFetch<{ scan: Scan, findings: Finding[], fixes: Fix[] }>(`/api/scans/${route.params.id}`)

const tool = ref('')
const severity = ref('')
const filtered = computed(() => (data.value?.findings ?? []).filter(f =>
  (!tool.value || f.tool === tool.value) && (!severity.value || f.severity === severity.value),
))

const counts = computed(() => {
  const c: Record<string, number> = Object.fromEntries(SEVERITY_ORDER.map(s => [s, 0]))
  for (const f of data.value?.findings ?? []) c[f.severity] = (c[f.severity] ?? 0) + 1
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

const fixing = computed(() => data.value?.fixes.some(f => f.status === 'queued' || f.status === 'running') ?? false)
const running = computed(() => ['queued', 'running'].includes(data.value?.scan.status ?? '') || fixing.value)
const canFix = computed(() => data.value?.scan.status === 'done' && !!data.value.scan.repo && !data.value.scan.ref && !fixing.value)
const fixError = ref('')

async function fix() {
  fixError.value = ''
  try {
    await $fetch(`/api/scans/${route.params.id}/fix`, { method: 'POST' })
    await refresh()
  }
  catch (err: any) {
    fixError.value = err?.data?.message ?? 'Error'
  }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => running.value && refresh(), 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<!-- Guardrail: everything renders as text, never v-html. Findings come from external sources -->
<template>
  <template v-if="data">
    <NuxtLink
      to="/"
      class="back"
    >← Back</NuxtLink>

    <section class="scan-head">
      <div>
        <p class="label">
          // Scan #{{ String(data.scan.id).padStart(4, '0') }} · {{ data.scan.origin }}
        </p>
        <NuxtLink
          v-if="data.scan.repo"
          :to="`/targets/${data.scan.target_id}`"
          class="back inline"
        >⎇ Branches of {{ data.scan.target }}</NuxtLink>
        <h1>{{ data.scan.target }} <StatusPill :status="data.scan.status" /></h1>
        <div class="meta mono">
          <span v-if="data.scan.repo">⎇ {{ data.scan.repo }}<template v-if="data.scan.ref"> @ {{ data.scan.ref }}</template></span>
          <span v-if="data.scan.url">⌁ {{ data.scan.url }}</span>
          <span>◷ {{ formatDate(data.scan.created_at) }}</span>
          <a
            v-if="data.scan.sbom_components !== null"
            :href="`/api/scans/${data.scan.id}/sbom`"
            download
          >⤓ SBOM · {{ data.scan.sbom_components }} components</a>
        </div>
      </div>
      <button
        v-if="canFix"
        class="fix-btn"
        @click="fix"
      >
        ⚒ Fix
      </button>
    </section>
    <p
      v-if="fixError"
      class="error"
    >
      ✕ {{ fixError }}
    </p>

    <section class="kpis sev-kpis">
      <button
        v-for="s in SEVERITY_ORDER"
        :key="s"
        :class="['kpi', 'sev-kpi', s, { off: !counts[s], selected: severity === s }]"
        @click="severity = severity === s ? '' : s"
      >
        <span class="label">{{ s }}</span>
        <strong>{{ counts[s] }}</strong>
      </button>
    </section>

    <section
      v-if="running"
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
          // Fix #{{ f.id }} · {{ formatDate(f.created_at) }}
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
      v-if="data.scan.error"
      class="panel alert"
    >
      <p class="label">
        // Errors
      </p>
      <pre>{{ data.scan.error }}</pre>
    </section>

    <section
      v-if="data.scan.summary"
      :class="['panel', 'report', worst]"
    >
      <p class="label">
        // Report
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
      v-if="data.findings.length"
      class="panel"
    >
      <div class="panel-head">
        <p class="label">
          // Findings · {{ filtered.length }} / {{ data.findings.length }}
        </p>
        <div class="filters">
          <select v-model="tool">
            <option value="">
              All tools
            </option>
            <option>trivy</option><option>grype</option><option>semgrep</option><option>nuclei</option>
          </select>
          <select v-model="severity">
            <option value="">
              All severities
            </option>
            <option
              v-for="s in SEVERITY_ORDER"
              :key="s"
            >
              {{ s }}
            </option>
          </select>
        </div>
      </div>
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
  </template>
</template>
