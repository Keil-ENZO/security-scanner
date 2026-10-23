<script setup lang="ts">
interface CodeFinding { tool: string, severity: string, title: string, rule_id: string | null, location: string | null }
interface Review {
  target: { id: number, name: string, repo: string }
  base: string
  ref: string
  headSha: string | null
  aheadBy: number
  behindBy: number
  commits: { sha: string, message: string, author: string, date: string }[]
  files: { filename: string, status: string, additions: number, deletions: number, patch: string | null }[]
  checks: { state: string, preview: string | null, warning: string | null, items: { name: string, state: string, url: string | null, description: string | null }[] }
  previewLogs: string | null
  conflicts: boolean
  pr: { number: number, url: string, draft: boolean } | null
  scans: { base: { id: number } | null, branch: { id: number, sha: string | null } | null, runningId: number | null, upToDate: boolean }
  diff: { resolved: CodeFinding[], introduced: CodeFinding[], remaining: number } | null
  fix: { id: number, summary: string | null } | null
  canMerge: boolean
}

const route = useRoute()
const id = route.params.id as string
const branch = computed(() => String(route.query.ref ?? ''))
const { data, error, refresh } = await useFetch<Review>(`/api/targets/${id}/review`, { query: { ref: branch } })

const errorMessage = computed(() => (error.value?.data as { message?: string } | undefined)?.message ?? 'Erreur')
const actionError = ref('')
const acting = ref('')

async function act(name: string, fn: () => Promise<unknown>) {
  actionError.value = ''
  acting.value = name
  try {
    await fn()
  }
  catch (err: any) {
    actionError.value = err?.data?.message ?? 'Erreur'
  }
  finally {
    acting.value = ''
  }
}

const scanBranch = () => act('scan', async () => {
  await $fetch(`/api/targets/${id}/scan`, { method: 'POST', body: { ref: branch.value } })
  await refresh()
})
const openPr = () => act('pr', async () => {
  await $fetch(`/api/targets/${id}/pr`, { method: 'POST', body: { ref: branch.value } })
  await refresh()
})
const merge = () => act('merge', async () => {
  if (!confirm(`Merger ${branch.value} dans ${data.value?.base} en squash ?`)) return
  const { scanId } = await $fetch<{ scanId: number }>(`/api/targets/${id}/merge`, { method: 'POST', body: { ref: branch.value } })
  await navigateTo(`/scans/${scanId}`)
})
// Retard sur la base : merge de la base dans la branche. En conflit, une branche du scanner est recréée
const update = () => act('update', async () => {
  const res = await $fetch<{ updated?: boolean, recreated?: boolean, baseScanId?: number }>(`/api/targets/${id}/update`, { method: 'POST', body: { ref: branch.value } })
  if (res.recreated) return navigateTo(`/scans/${res.baseScanId}`)
  await refresh()
})
const recreate = computed(() => !!data.value?.conflicts && branch.value.startsWith('security/'))
const drop = () => act('drop', async () => {
  if (!confirm(`Supprimer la branche ${branch.value} ?`)) return
  await $fetch(`/api/targets/${id}/branch`, { method: 'DELETE', query: { ref: branch.value } })
  await navigateTo(`/targets/${id}`)
})

// Pourquoi le merge est bloqué, en clair
const blockers = computed(() => {
  const d = data.value
  if (!d) return []
  const out: string[] = []
  if (!d.aheadBy) out.push(`Aucun commit d’avance sur ${d.base}`)
  if (d.conflicts) out.push(`Conflits avec ${d.base}`)
  else if (d.behindBy) out.push(`En retard sur ${d.base} : la preview ne teste pas ce qui partira en prod`)
  if (!d.pr) out.push('Pas encore de pull request : valider d’abord')
  if (d.pr?.draft) out.push('Pull request en brouillon')
  if (!d.scans.upToDate) out.push('Le dernier commit de la branche n’a pas été scanné')
  if (d.checks.state === 'pending') out.push('Preview et checks en cours')
  if (d.checks.state === 'failure') out.push('Preview ou checks en échec')
  if (d.checks.state === 'unavailable') out.push('Statut de la preview illisible : voir la permission du jeton')
  if (d.diff?.introduced.length) out.push('La branche introduit de nouveaux findings')
  return out
})

const lineClass = (line: string) =>
  line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (data.value?.scans.runningId || data.value?.checks.state === 'pending') && refresh(), 6000)
})
onUnmounted(() => clearInterval(timer))
</script>

<!-- Le diff vient du dépôt : rendu en texte, ligne par ligne, jamais de v-html -->
<template>
  <NuxtLink :to="`/targets/${id}`" class="back">← Branches</NuxtLink>
  <p v-if="error" class="error">✕ {{ errorMessage }}</p>

  <template v-if="data">
    <section class="scan-head">
      <div>
        <p class="label">// Review · {{ data.target.name }}</p>
        <h1><code class="mono">{{ data.ref }}</code> <span class="muted arrow">→</span> <code class="mono">{{ data.base }}</code></h1>
        <div class="meta mono">
          <span>{{ data.aheadBy }} commit{{ data.aheadBy > 1 ? 's' : '' }} d'avance</span>
          <span v-if="data.behindBy">⚠ {{ data.behindBy }} de retard sur {{ data.base }}</span>
          <span v-if="data.headSha">◉ {{ data.headSha.slice(0, 7) }}</span>
        </div>
      </div>
    </section>

    <!-- Les quatre étapes -->
    <section class="steps">
      <div :class="['step', data.scans.upToDate ? 'ok' : data.scans.runningId ? 'wait' : 'todo']">
        <span class="label">01 · Scan de la branche</span>
        <strong v-if="data.scans.runningId">En cours</strong>
        <strong v-else-if="data.scans.upToDate">À jour</strong>
        <strong v-else>À lancer</strong>
        <NuxtLink v-if="data.scans.branch" :to="`/scans/${data.scans.branch.id}`" class="mono small-link">scan #{{ data.scans.branch.id }}</NuxtLink>
        <button v-if="!data.scans.runningId && !data.scans.upToDate" class="ghost" :disabled="!!acting" @click="scanBranch">▶ Scanner</button>
      </div>
      <div :class="['step', data.checks.state === 'success' ? 'ok' : ['failure', 'unavailable'].includes(data.checks.state) ? 'ko' : data.checks.state === 'pending' ? 'wait' : 'todo']">
        <span class="label">02 · Preview</span>
        <strong>{{ ({ success: 'Verte', failure: 'En échec', pending: 'En cours', none: 'Aucun check', unavailable: 'Illisible' } as Record<string, string>)[data.checks.state] }}</strong>
        <a v-if="data.checks.preview" :href="data.checks.preview" target="_blank" rel="noopener noreferrer" class="mono small-link">↗ ouvrir la preview</a>
      </div>
      <div :class="['step', data.pr ? 'ok' : 'todo']">
        <span class="label">03 · Validation</span>
        <strong>{{ data.pr ? `PR #${data.pr.number}` : 'À valider' }}</strong>
        <a v-if="data.pr" :href="data.pr.url" target="_blank" rel="noopener noreferrer" class="mono small-link">↗ GitHub</a>
        <button v-else :disabled="!!acting || !data.scans.upToDate || !data.aheadBy" @click="openPr">✓ Valider, ouvrir la PR</button>
      </div>
      <div :class="['step', data.canMerge ? 'ready' : 'todo']">
        <span class="label">04 · Merge</span>
        <strong>{{ data.canMerge ? 'Prêt' : 'Bloqué' }}</strong>
        <button :disabled="!data.canMerge || !!acting" @click="merge">⇢ Merger en squash</button>
      </div>
    </section>
    <section v-if="data.behindBy || data.conflicts" class="panel sync">
      <div>
        <p class="label">// {{ data.conflicts ? 'Conflits' : 'Retard' }} sur {{ data.base }}</p>
        <p v-if="recreate" class="muted">{{ data.base }} a bougé sur les mêmes fichiers. La correction est refaite depuis {{ data.base }} actuelle, cette branche et sa PR sont fermées.</p>
        <p v-else-if="data.conflicts" class="muted">À résoudre dans le dépôt, puis rescanner la branche.</p>
        <p v-else class="muted">{{ data.behindBy }} commit{{ data.behindBy > 1 ? 's' : '' }} de {{ data.base }} manquent. La mise à jour merge {{ data.base }} dans la branche, relance la preview et le scan.</p>
      </div>
      <button v-if="recreate || !data.conflicts" :disabled="!!acting" @click="update">
        {{ recreate ? '⟳ Recréer la correction' : `⟳ Mettre à jour depuis ${data.base}` }}
      </button>
    </section>
    <p v-if="actionError" class="error">✕ {{ actionError }}</p>
    <p v-if="data.checks.warning" class="error">✕ {{ data.checks.warning }}</p>
    <ul v-if="blockers.length" class="blockers mono">
      <li v-for="b in blockers" :key="b">✕ {{ b }}</li>
    </ul>

    <!-- Avant / après -->
    <section v-if="data.diff" class="panel">
      <p class="label">// Scan de la branche comparé à {{ data.base }}</p>
      <div class="kpis compare">
        <div class="kpi"><span class="label">Corrigés</span><strong class="ok">{{ data.diff.resolved.length }}</strong></div>
        <div class="kpi"><span class="label">Nouveaux</span><strong :class="data.diff.introduced.length ? 'ko' : ''">{{ data.diff.introduced.length }}</strong></div>
        <div class="kpi"><span class="label">Inchangés</span><strong>{{ data.diff.remaining }}</strong></div>
      </div>
      <div v-for="f in data.diff.introduced" :key="`n-${f.tool}-${f.title}`" class="finding-line">
        <span class="mono ko">+ nouveau</span><SevBadge :severity="f.severity" /><span>{{ f.title }}</span>
      </div>
      <div v-for="f in data.diff.resolved" :key="`r-${f.tool}-${f.title}`" class="finding-line">
        <span class="mono ok">− corrigé</span><SevBadge :severity="f.severity" /><span class="muted">{{ f.title }}</span>
      </div>
    </section>
    <section v-else class="panel">
      <p class="label">// Comparaison</p>
      <p class="empty">Il faut un scan de {{ data.base }} et un scan de la branche pour comparer.</p>
    </section>

    <section v-if="data.previewLogs" class="panel">
      <p class="label">// Log de build de la preview</p>
      <pre class="patch build-log">{{ data.previewLogs }}</pre>
    </section>

    <section v-if="data.checks.items.length" class="panel">
      <p class="label">// Checks</p>
      <div v-for="c in data.checks.items" :key="c.name" class="check-line mono">
        <span :class="['status', c.state === 'success' ? 'done' : c.state === 'failure' ? 'failed' : 'running']"><i />{{ c.state }}</span>
        <a v-if="c.url" :href="c.url" target="_blank" rel="noopener noreferrer">{{ c.name }} ↗</a>
        <span v-else>{{ c.name }}</span>
        <span class="muted">{{ c.description }}</span>
      </div>
    </section>

    <section class="panel">
      <p class="label">// Commits · {{ data.commits.length }}</p>
      <div v-for="c in data.commits" :key="c.sha" class="commit mono">
        <span class="muted">{{ c.sha.slice(0, 7) }}</span>
        <span>{{ c.message.split('\n')[0] }}</span>
        <span class="muted">{{ c.author }}</span>
      </div>
    </section>

    <section class="panel">
      <p class="label">// Fichiers · {{ data.files.length }}</p>
      <details v-for="f in data.files" :key="f.filename" class="file" :open="data.files.length <= 3">
        <summary class="mono">
          <span class="file-name">{{ f.filename }}</span>
          <span class="ok">+{{ f.additions }}</span>
          <span class="ko">−{{ f.deletions }}</span>
        </summary>
        <pre v-if="f.patch" class="patch"><span v-for="(line, i) in f.patch.split('\n')" :key="i" :class="['line', lineClass(line)]">{{ line }}
</span></pre>
        <p v-else class="empty">Diff trop gros pour l'API GitHub, voir la PR.</p>
      </details>
    </section>

    <section class="panel danger-zone">
      <p class="label">// Abandon</p>
      <button class="ghost danger" :disabled="!data.ref.startsWith('security/') || !!acting" @click="drop">✕ Supprimer la branche</button>
      <span class="muted mono">Seules les branches security/* se suppriment d'ici. La PR éventuelle est fermée.</span>
    </section>
  </template>
</template>
