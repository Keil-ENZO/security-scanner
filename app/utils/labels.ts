export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const

export const STATUS_LABEL: Record<string, string> = {
  queued: 'En file',
  running: 'En cours',
  done: 'Terminé',
  failed: 'Échec',
}

// SQLite renvoie de l'UTC sans fuseau : affichage à l'heure de Paris
export function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short',
  })
}
