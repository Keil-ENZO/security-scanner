<script setup lang="ts">
interface Finding { id: number, tool: string, severity: string, title: string, rule_id: string | null, cve: string | null, cwe: string | null, cvss: number | null, location: string | null, description: string | null, remediation: string | null }
interface Scan { id: number, target: string, repo: string | null, url: string | null, status: string, origin: string, error: string | null, summary: string | null, created_at: string, finished_at: string | null }

const route = useRoute()
const { data, refresh } = await useFetch<{ scan: Scan, findings: Finding[] }>(`/api/scans/${route.params.id}`)

const tool = ref('')
const severity = ref('')
const filtered = computed(() => (data.value?.findings ?? []).filter(f =>
  (!tool.value || f.tool === tool.value) && (!severity.value || f.severity === severity.value),
))

const running = computed(() => ['queued', 'running'].includes(data.value?.scan.status ?? ''))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => running.value && refresh(), 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<!-- Garde-fou 4 : tout est rendu en texte, jamais de v-html. Les findings viennent de sources externes -->
<template>
  <template v-if="data">
    <section class="card">
      <h1>{{ data.scan.target }} <span :class="['status', data.scan.status]">{{ data.scan.status }}</span></h1>
      <p class="muted">
        Scan #{{ data.scan.id }} · {{ data.scan.origin }} · {{ data.scan.created_at }} UTC
        <template v-if="data.scan.repo"> · {{ data.scan.repo }}</template>
        <template v-if="data.scan.url"> · {{ data.scan.url }}</template>
      </p>
      <p v-if="running" class="muted">Scan en cours. La page se met à jour seule. Comptez quelques minutes, jusqu'à une demi-heure pour un site.</p>
      <pre v-if="data.scan.error" class="error">{{ data.scan.error }}</pre>
    </section>

    <section v-if="data.scan.summary" class="card">
      <h2>Rapport</h2>
      <p class="summary">{{ data.scan.summary }}</p>
    </section>

    <section v-if="data.findings.length" class="card">
      <h2>Findings ({{ filtered.length }} / {{ data.findings.length }})</h2>
      <div class="filters">
        <select v-model="tool">
          <option value="">Tous les outils</option>
          <option>trivy</option><option>semgrep</option><option>nuclei</option>
        </select>
        <select v-model="severity">
          <option value="">Toutes les sévérités</option>
          <option>critical</option><option>high</option><option>medium</option><option>low</option><option>info</option>
        </select>
      </div>
      <details v-for="f in filtered" :key="f.id" class="finding">
        <summary>
          <span :class="['sev', f.severity]">{{ f.severity }}</span>
          <span class="tool">{{ f.tool }}</span>
          {{ f.title }}
          <span class="muted">{{ f.location }}</span>
        </summary>
        <dl>
          <template v-if="f.rule_id"><dt>Règle</dt><dd>{{ f.rule_id }}</dd></template>
          <template v-if="f.cve"><dt>CVE</dt><dd>{{ f.cve }}</dd></template>
          <template v-if="f.cwe"><dt>CWE</dt><dd>{{ f.cwe }}</dd></template>
          <template v-if="f.cvss"><dt>CVSS</dt><dd>{{ f.cvss }}</dd></template>
          <template v-if="f.description"><dt>Détail</dt><dd>{{ f.description }}</dd></template>
          <template v-if="f.remediation"><dt>Correction</dt><dd>{{ f.remediation }}</dd></template>
        </dl>
      </details>
    </section>
  </template>
</template>
