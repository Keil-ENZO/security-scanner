import { randomUUID } from 'node:crypto'

// Appelé par le cron Hermes du jeudi. Renvoie l'identifiant du lot, en texte brut.
// Si un lot tourne déjà, on le renvoie au lieu d'en lancer un second
export default defineEventHandler((event) => {
  const db = useDb()
  const running = db.prepare(`
    SELECT batch FROM scans WHERE batch IS NOT NULL AND status IN ('queued', 'running') LIMIT 1
  `).get() as { batch: string } | undefined
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  if (running) return running.batch

  const targets = db.prepare('SELECT id FROM targets WHERE weekly = 1').all() as { id: number }[]
  const batch = randomUUID()
  for (const t of targets) enqueueScan(t.id, 'hebdo', batch)
  return batch
})
