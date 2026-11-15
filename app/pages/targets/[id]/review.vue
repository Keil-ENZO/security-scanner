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
  checks: { state: string, warning: string | null, items: { name: string, state: string, url: string | null, description: string | null }[] }
  preview: string | null
  previewLogs: string | null
  previewLogsHint: string | null
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

const loadError = computed(() => errorMessage(error.value))

const { busy: acting, error: actionError, run: act } = useAction()
// Each of them names the branch and says what the action does before it runs
const mergeDialog = ref<{ ask: () => Promise<boolean> }>()
const dropDialog = ref<{ ask: () => Promise<boolean> }>()
const recreateDialog = ref<{ ask: () => Promise<boolean> }>()
const scanBranch = () => act('scan', async () => {
  await $fetch(`/api/targets/${id}/scan`, { method: 'POST', body: { ref: branch.value } })
  await refresh()
})
const openPr = () => act('pr', async () => {
  await $fetch(`/api/targets/${id}/pr`, { method: 'POST', body: { ref: branch.value } })
  await refresh()
})
// The question comes first: nothing shows as running while the dialog is open
const merge = async () => await mergeDialog.value?.ask() && act('merge', async () => {
  const { scanId } = await $fetch<{ scanId: number }>(`/api/targets/${id}/merge`, { method: 'POST', body: { ref: branch.value } })
  await navigateTo(`/scans/${scanId}`)
})
// Behind the base: merge the base into the branch. On conflict, a scanner branch is recreated
const update = async () => (!recreate.value || await recreateDialog.value?.ask()) && act('update', async () => {
  const res = await $fetch<{ updated?: boolean, recreated?: boolean, baseScanId?: number }>(`/api/targets/${id}/update`, { method: 'POST', body: { ref: branch.value } })
  if (res.recreated) return navigateTo(`/scans/${res.baseScanId}`)
  await refresh()
})
const recreate = computed(() => !!data.value?.conflicts && branch.value.startsWith('security/'))
const drop = async () => await dropDialog.value?.ask() && act('drop', async () => {
  await $fetch(`/api/targets/${id}/branch`, { method: 'DELETE', query: { ref: branch.value } })
  await navigateTo(`/targets/${id}`)
})

// Why the merge is blocked, in plain words
const blockers = computed(() => {
  const d = data.value
  if (!d) return []
  const out: string[] = []
  if (!d.aheadBy) out.push(`No commit ahead of ${d.base}`)
  if (d.conflicts) out.push(`Conflicts with ${d.base}`)
  else if (d.behindBy) out.push(`Behind ${d.base}: the preview does not test what will ship`)
  if (!d.pr) out.push('No pull request yet: approve first')
  if (d.pr?.draft) out.push('Pull request is a draft')
  if (!d.scans.upToDate) out.push('The latest commit of the branch has not been scanned')
  if (d.checks.state === 'pending') out.push('Preview and checks pending')
  if (d.checks.state === 'failure') out.push('Preview or checks failing')
  if (d.checks.state === 'unavailable') out.push('Preview status unreadable: check the GitHub token permissions')
  if (d.diff?.introduced.length) out.push('The branch introduces new findings')
  return out
})

// What each step is waiting for, in one sentence
const hints = computed(() => {
  const d = data.value
  if (!d) return { scan: '', preview: '', approval: '', merge: '' }
  return {
    scan: d.scans.runningId
      ? 'The branch is being scanned. This page refreshes on its own.'
      : d.scans.upToDate ? 'The latest commit of the branch is scanned.' : 'Scan the latest commit of the branch.',
    preview: ({
      success: 'Every check of the latest commit is green.',
      failure: 'A check or the preview failed. See the checks below.',
      pending: 'Checks are running. This page refreshes on its own.',
      none: 'No check ran on this commit. Nothing blocks here.',
      unavailable: 'GitHub did not return the checks of this commit.',
    } as Record<string, string>)[d.checks.state] ?? '',
    approval: d.pr
      ? (d.pr.draft ? 'The pull request is a draft. Mark it ready on GitHub.' : 'The pull request is open.')
      : !d.aheadBy
          ? `Nothing to approve: no commit ahead of ${d.base}.`
          : d.scans.upToDate ? 'Approving opens the pull request on GitHub.' : 'Scan the branch first.',
    merge: d.canMerge ? `Squash merge into ${d.base}. Production is then scanned again.` : '',
  }
})

const checkLabel: Record<string, string> = { success: 'Passed', failure: 'Failed', pending: 'Running' }

const lineClass = (line: string) =>
  line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (data.value?.scans.runningId || data.value?.checks.state === 'pending') && refresh(), 6000)
})
onUnmounted(() => clearInterval(timer))
</script>

<!-- The diff comes from the repository: rendered as text, line by line, never v-html -->
<template>
  <BreadcrumbTrail :items="[{ label: 'Targets', to: '/' }, { label: data?.target.name ?? 'Target', to: `/targets/${id}` }, { label: branch }]" />
  <p
    v-if="error"
    class="error"
    role="alert"
  >
    ✕ {{ loadError }}
  </p>

  <template v-if="data">
    <section class="scan-head">
      <div>
        <p class="label">
          Review · {{ data.target.name }}
        </p>
        <h1><code class="mono">{{ data.ref }}</code> <span class="muted arrow">→</span> <code class="mono">{{ data.base }}</code></h1>
        <div class="meta">
          <span>{{ data.aheadBy }} commit{{ data.aheadBy === 1 ? '' : 's' }} ahead of {{ data.base }}</span>
          <span
            v-if="data.behindBy"
            class="stale-inline"
          >{{ data.behindBy }} behind</span>
          <span v-if="data.headSha">Latest commit <code class="mono">{{ data.headSha.slice(0, 7) }}</code></span>
        </div>
      </div>
    </section>

    <!-- The four steps -->
    <ol
      class="steps"
      aria-label="Steps to merge this branch"
    >
      <li :class="['step', data.scans.upToDate ? 'ok' : data.scans.runningId ? 'wait' : 'todo']">
        <span class="label">1 · Branch scan</span>
        <strong v-if="data.scans.runningId">Running</strong>
        <strong v-else-if="data.scans.upToDate">Up to date</strong>
        <strong v-else>To run</strong>
        <span class="step-hint">{{ hints.scan }}</span>
        <NuxtLink
          v-if="data.scans.branch"
          :to="`/scans/${data.scans.branch.id}`"
          class="small-link"
        >Open scan #{{ data.scans.branch.id }}</NuxtLink>
        <button
          v-if="!data.scans.runningId && !data.scans.upToDate"
          class="ghost"
          :disabled="!!acting"
          @click="scanBranch"
        >
          {{ acting === 'scan' ? 'Starting…' : '▶ Scan the branch' }}
        </button>
      </li>
      <li :class="['step', data.checks.state === 'success' ? 'ok' : ['failure', 'unavailable'].includes(data.checks.state) ? 'ko' : data.checks.state === 'pending' ? 'wait' : 'todo']">
        <span class="label">2 · Preview and checks</span>
        <strong>{{ ({ success: 'Green', failure: 'Failing', pending: 'Pending', none: 'No checks', unavailable: 'Unreadable' } as Record<string, string>)[data.checks.state] }}</strong>
        <span class="step-hint">{{ hints.preview }}</span>
        <a
          v-if="data.preview"
          :href="data.preview"
          target="_blank"
          rel="noopener noreferrer"
          class="small-link"
        >Open the preview ↗</a>
      </li>
      <li :class="['step', data.pr ? 'ok' : 'todo']">
        <span class="label">3 · Approval</span>
        <strong>{{ data.pr ? `PR #${data.pr.number}` : 'To approve' }}</strong>
        <span class="step-hint">{{ hints.approval }}</span>
        <a
          v-if="data.pr"
          :href="data.pr.url"
          target="_blank"
          rel="noopener noreferrer"
          class="small-link"
        >Open on GitHub ↗</a>
        <button
          v-else
          :disabled="!!acting || !data.scans.upToDate || !data.aheadBy"
          @click="openPr"
        >
          {{ acting === 'pr' ? 'Opening…' : '✓ Approve, open the PR' }}
        </button>
      </li>
      <li :class="['step', data.canMerge ? 'ready' : 'todo']">
        <span class="label">4 · Merge</span>
        <strong>{{ data.canMerge ? 'Ready' : 'Blocked' }}</strong>
        <span
          v-if="hints.merge"
          class="step-hint"
        >{{ hints.merge }}</span>
        <!-- Why the merge is blocked, where the button is -->
        <ul
          v-else
          class="step-blockers"
        >
          <li
            v-for="b in blockers"
            :key="b"
          >
            {{ b }}
          </li>
        </ul>
        <button
          :disabled="!data.canMerge || !!acting"
          @click="merge"
        >
          {{ acting === 'merge' ? 'Merging…' : '⇢ Squash merge' }}
        </button>
      </li>
    </ol>
    <section
      v-if="data.behindBy || data.conflicts"
      class="panel sync"
    >
      <div>
        <p class="label">
          {{ data.conflicts ? 'Conflicts with' : 'Behind' }} {{ data.base }}
        </p>
        <p
          v-if="recreate"
          class="muted"
        >
          {{ data.base }} changed the same files. The fix is redone from the current {{ data.base }}, this branch and its PR are closed.
        </p>
        <p
          v-else-if="data.conflicts"
          class="muted"
        >
          Resolve them in the repository, then scan the branch again.
        </p>
        <p
          v-else
          class="muted"
        >
          {{ data.behindBy }} commit{{ data.behindBy === 1 ? '' : 's' }} from {{ data.base }} missing. Updating merges {{ data.base }} into the branch, then reruns the preview and the scan.
        </p>
      </div>
      <button
        v-if="recreate || !data.conflicts"
        :disabled="!!acting"
        @click="update"
      >
        {{ acting === 'update' ? 'Working…' : recreate ? '⟳ Recreate the fix' : `⟳ Update from ${data.base}` }}
      </button>
    </section>
    <p
      v-if="actionError"
      class="error"
      role="alert"
    >
      ✕ {{ actionError }}
    </p>
    <p
      v-if="data.checks.warning"
      class="error"
    >
      ✕ {{ data.checks.warning }}
    </p>

    <!-- Before / after -->
    <section
      v-if="data.diff"
      class="panel"
    >
      <p class="label">
        Branch scan compared with {{ data.base }}
      </p>
      <div class="kpis compare">
        <div class="kpi">
          <span class="label">Fixed</span><strong class="ok">{{ data.diff.resolved.length }}</strong>
        </div>
        <div class="kpi">
          <span class="label">New</span><strong :class="data.diff.introduced.length ? 'ko' : ''">{{ data.diff.introduced.length }}</strong>
        </div>
        <div class="kpi">
          <span class="label">Unchanged</span><strong>{{ data.diff.remaining }}</strong>
        </div>
      </div>
      <p
        v-if="!data.diff.introduced.length && !data.diff.resolved.length"
        class="help"
      >
        Same findings on both sides.
      </p>
      <!-- Index keys: the same rule can now show once per file -->
      <div
        v-for="(f, i) in data.diff.introduced"
        :key="`n-${i}`"
        class="finding-line"
      >
        <span class="ko">New</span><SevBadge :severity="f.severity" /><span>{{ f.title }}</span><code class="mono muted">{{ f.location }}</code>
      </div>
      <div
        v-for="(f, i) in data.diff.resolved"
        :key="`r-${i}`"
        class="finding-line"
      >
        <span class="ok">Fixed</span><SevBadge :severity="f.severity" /><span class="muted">{{ f.title }}</span><code class="mono muted">{{ f.location }}</code>
      </div>
    </section>
    <section
      v-else
      class="panel"
    >
      <p class="label">
        Comparison
      </p>
      <p class="empty">
        Comparing needs a scan of {{ data.base }} and a scan of the branch.
      </p>
    </section>

    <section
      v-if="data.previewLogs || data.previewLogsHint"
      class="panel"
    >
      <p class="label">
        Preview failure
      </p>
      <pre
        v-if="data.previewLogs"
        class="patch build-log"
      >{{ data.previewLogs }}</pre>
      <p
        v-else
        class="muted mono"
      >
        {{ data.previewLogsHint }}
      </p>
    </section>

    <section
      v-if="data.checks.items.length"
      class="panel"
    >
      <p class="label">
        Checks
      </p>
      <div
        v-for="c in data.checks.items"
        :key="c.name"
        class="check-line mono"
      >
        <span :class="['status', c.state === 'success' ? 'done' : c.state === 'failure' ? 'failed' : 'running']"><i />{{ checkLabel[c.state] ?? c.state }}</span>
        <a
          v-if="c.url"
          :href="c.url"
          target="_blank"
          rel="noopener noreferrer"
        >{{ c.name }} ↗</a>
        <span v-else>{{ c.name }}</span>
        <span class="muted">{{ c.description }}</span>
      </div>
    </section>

    <details class="panel fold">
      <summary>Commits · {{ data.commits.length }}</summary>
      <div
        v-for="c in data.commits"
        :key="c.sha"
        class="commit mono"
      >
        <span class="muted">{{ c.sha.slice(0, 7) }}</span>
        <span>{{ c.message.split('\n')[0] }}</span>
        <span class="muted">{{ c.author }}</span>
      </div>
    </details>
    <details class="panel fold">
      <summary>Files changed · {{ data.files.length }}</summary>
      <details
        v-for="f in data.files"
        :key="f.filename"
        class="file"
        :open="data.files.length <= 3"
      >
        <summary class="mono">
          <span class="file-name">{{ f.filename }}</span>
          <span class="ok">+{{ f.additions }}</span>
          <span class="ko">−{{ f.deletions }}</span>
        </summary>
        <pre
          v-if="f.patch"
          class="patch"
        ><span
v-for="(line, i) in f.patch.split('\n')"
                                 :key="i"
:class="['line', lineClass(line)]"
>{{ line }}
</span></pre>
        <p
          v-else
          class="empty"
        >
          Diff too large for the GitHub API, see the PR.
        </p>
      </details>
    </details>
    <section class="panel danger-zone">
      <p class="label">
        Drop this branch
      </p>
      <button
        class="ghost danger"
        :disabled="!data.ref.startsWith('security/') || !!acting"
        @click="drop"
      >
        {{ acting === 'drop' ? 'Deleting…' : '✕ Delete the branch' }}
      </button>
      <span class="help">Only security/* branches can be deleted from here. Any open pull request is closed.</span>
    </section>

    <ConfirmDialog
      ref="mergeDialog"
      :title="`Squash merge ${data.ref} into ${data.base}?`"
      confirm-label="Squash merge"
    >
      <p>The {{ data.aheadBy }} commit{{ data.aheadBy === 1 ? '' : 's' }} of the branch become one commit on {{ data.base }}.</p>
      <p>The branch is then deleted, production deploys, and {{ data.base }} is scanned again.</p>
    </ConfirmDialog>
    <ConfirmDialog
      ref="dropDialog"
      :title="`Delete ${data.ref}?`"
      confirm-label="Delete the branch"
      danger
    >
      <p>The branch is removed from GitHub{{ data.pr ? `, and pull request #${data.pr.number} is closed` : '' }}.</p>
      <p>Its commits are lost unless they exist elsewhere.</p>
    </ConfirmDialog>
    <ConfirmDialog
      ref="recreateDialog"
      title="Recreate the fix?"
      confirm-label="Recreate the fix"
      danger
    >
      <p>{{ data.ref }} conflicts with {{ data.base }}. The fix is redone from the current {{ data.base }} on a new branch.</p>
      <p>This branch is deleted{{ data.pr ? `, and pull request #${data.pr.number} is closed` : '' }}.</p>
    </ConfirmDialog>
  </template>
</template>
