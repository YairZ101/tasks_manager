import { Database } from 'bun:sqlite';
import path from 'path';

const DATA_DIR = '.tasks_manager';

let db: Database;

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(repoRoot: string): Database {
  const dbPath = path.join(repoRoot, DATA_DIR, 'tasks.db');
  db = new Database(dbPath, { create: true });

  // Required pragmas
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');

  runMigrations(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}

function runMigrations(db: Database): void {
  const versionRow = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
  const version = versionRow?.user_version ?? 0;

  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        task_key      TEXT UNIQUE NOT NULL,
        title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
        description   TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 50000),
        acceptance    TEXT NOT NULL DEFAULT '' CHECK (length(acceptance) <= 50000),
        status        TEXT NOT NULL DEFAULT 'backlog'
                      CHECK (status IN ('backlog', 'todo', 'in-progress', 'done')),
        agent_status  TEXT DEFAULT NULL
                      CHECK (agent_status IS NULL OR agent_status IN ('running', 'completed', 'failed')),
        agent_pid     INTEGER DEFAULT NULL,
        agent_started_at TEXT DEFAULT NULL,
        sort_order    REAL NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS task_logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        run_number INTEGER NOT NULL DEFAULT 1,
        timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
        level      TEXT NOT NULL DEFAULT 'info',
        message    TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id, run_number, id);

      CREATE TABLE IF NOT EXISTS agent_config (
        id                 INTEGER PRIMARY KEY CHECK (id = 1),
        type               TEXT NOT NULL DEFAULT 'cli',
        cli_cmd            TEXT DEFAULT NULL,
        cli_prompt_mode    TEXT NOT NULL DEFAULT 'stdin'
                           CHECK (cli_prompt_mode IN ('stdin', 'argument', 'flag')),
        cli_prompt_flag    TEXT DEFAULT NULL,
        api_url            TEXT DEFAULT NULL,
        api_headers        TEXT DEFAULT NULL,
        api_model          TEXT DEFAULT NULL,
        api_request_format TEXT NOT NULL DEFAULT 'openai'
                           CHECK (api_request_format IN ('openai', 'ollama')),
        api_stream_format  TEXT NOT NULL DEFAULT 'sse'
                           CHECK (api_stream_format IN ('sse', 'ndjson', 'none')),
        timeout_ms         INTEGER NOT NULL DEFAULT 1800000,
        updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS project_config (
        id                INTEGER PRIMARY KEY CHECK (id = 1),
        task_prefix       TEXT NOT NULL
                          CHECK (length(task_prefix) BETWEEN 1 AND 5 AND task_prefix GLOB '[A-Z0-9]*'),
        next_task_number  INTEGER NOT NULL DEFAULT 1,
        repo_name         TEXT NOT NULL,
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TRIGGER IF NOT EXISTS tasks_updated_at AFTER UPDATE ON tasks
      BEGIN
        UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id;
      END;

      INSERT INTO agent_config (id) VALUES (1) ON CONFLICT DO NOTHING;

      PRAGMA user_version = 1;
    `);
  }
}
