import { randomUUID } from 'node:crypto'

// Called by a scheduler: cron, systemd timer, CI job, agent. Returns the batch id as plain text.
// If a batch is already running, returns it instead of starting a second one
export default defineEventHandler((event) => {
  const db = useDb()
  const running = db.prepare(`
    SELECT batch FROM scans WHERE batch IS NOT NULL AND status IN ('queued', 'running') LIMIT 1
  `).get() as { batch: string } | undefined
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  if (running) return running.batch

  const targets = db.prepare('SELECT id FROM targets WHERE scheduled = 1').all() as { id: number }[]
  const batch = randomUUID()
  for (const t of targets) enqueueScan(t.id, 'scheduled', batch)
  return batch
})
