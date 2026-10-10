import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

let db: DatabaseSync | undefined

export function useDb() {
  if (db) return db
  const { dataDir } = useRuntimeConfig()
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  db = new DatabaseSync(join(dataDir, 'scanner.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS targets (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      repo TEXT,
      url TEXT,
      auth_header TEXT,
      weekly INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY,
      target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      origin TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY,
      scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      tool TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      rule_id TEXT,
      cve TEXT,
      cwe TEXT,
      cvss REAL,
      location TEXT,
      description TEXT,
      remediation TEXT
    );
    CREATE INDEX IF NOT EXISTS findings_scan ON findings(scan_id);

    CREATE TABLE IF NOT EXISTS fixes (
      id INTEGER PRIMARY KEY,
      scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      pr_url TEXT,
      summary TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
  `)
  const columns = db.prepare('PRAGMA table_info(scans)').all() as { name: string }[]
  if (!columns.some(c => c.name === 'batch')) db.exec('ALTER TABLE scans ADD COLUMN batch TEXT')
  // Un redémarrage coupe les scans en cours : la file vit en mémoire
  db.prepare(`
    UPDATE scans SET status = 'failed', error = 'Interrompu par un redémarrage', finished_at = datetime('now')
    WHERE status IN ('queued', 'running')
  `).run()
  db.prepare(`
    UPDATE fixes SET status = 'failed', error = 'Interrompu par un redémarrage', finished_at = datetime('now')
    WHERE status IN ('queued', 'running')
  `).run()
  return db
}
