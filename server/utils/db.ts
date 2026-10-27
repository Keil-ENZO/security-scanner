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
      scheduled INTEGER NOT NULL DEFAULT 1,
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

    -- One SBOM per scan of a repository, produced by Syft
    CREATE TABLE IF NOT EXISTS sboms (
      scan_id INTEGER PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
      format TEXT NOT NULL,
      components INTEGER NOT NULL,
      content TEXT NOT NULL
    );

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
  // Migrations: one column added per version
  const addColumn = (table: string, column: string, type: string) => {
    const columns = db!.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!columns.some(c => c.name === column)) db!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
  addColumn('scans', 'batch', 'TEXT')
  // ref: scanned branch, NULL for the default branch. sha: the commit actually analysed
  addColumn('scans', 'ref', 'TEXT')
  addColumn('scans', 'sha', 'TEXT')
  addColumn('fixes', 'branch', 'TEXT')
  addColumn('fixes', 'pr_body', 'TEXT')
  // 0.5: English values and a scheduler-agnostic name
  const targetColumns = db.prepare('PRAGMA table_info(targets)').all() as { name: string }[]
  if (targetColumns.some(c => c.name === 'weekly')) db.exec('ALTER TABLE targets RENAME COLUMN weekly TO scheduled')
  db.exec(`
    UPDATE scans SET origin = 'manual' WHERE origin = 'manuel';
    UPDATE scans SET origin = 'scheduled' WHERE origin = 'hebdo';
    UPDATE scans SET origin = 'fix' WHERE origin = 'correction';
  `)
  // A restart kills running jobs: the queue lives in memory
  db.prepare(`
    UPDATE scans SET status = 'failed', error = 'Interrupted by a restart', finished_at = datetime('now')
    WHERE status IN ('queued', 'running')
  `).run()
  db.prepare(`
    UPDATE fixes SET status = 'failed', error = 'Interrupted by a restart', finished_at = datetime('now')
    WHERE status IN ('queued', 'running')
  `).run()
  return db
}
