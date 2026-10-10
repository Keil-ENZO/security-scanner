// Jeudi 20 h : toutes les cibles cochées « hebdo », l'une après l'autre
export default defineTask({
  meta: { name: 'scan:weekly', description: 'Audit hebdomadaire de toutes les cibles' },
  async run() {
    const targets = useDb().prepare('SELECT id FROM targets WHERE weekly = 1').all() as { id: number }[]
    const jobs = targets.map(t => enqueueScan(t.id, 'hebdo'))
    await Promise.allSettled(jobs.map(j => j.done))
    return { result: `${jobs.length} scans` }
  },
})
