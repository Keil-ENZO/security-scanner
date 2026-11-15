export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  nothing: 'Nothing to do',
}

export const ORIGIN_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  manual: 'Manual',
  fix: 'Fix',
}

// SQLite returns UTC without a zone. Time zone and locale come from the config
export function formatDate(value: string | null) {
  if (!value) return '—'
  const { timeZone, locale } = useRuntimeConfig().public
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString(locale, {
    timeZone, dateStyle: 'short', timeStyle: 'short',
  })
}
