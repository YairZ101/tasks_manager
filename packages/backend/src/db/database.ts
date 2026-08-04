import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';

const DATA_DIR = '.flow';
const SCHEMA_FAMILY = 'flow';
const SCHEMA_VERSION = '2';

let db: Database;

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

function hasUserTables(database: Database): boolean {
  const row = database.query<{ count: number }, []>(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  ).get();
  return (row?.count ?? 0) > 0;
}

function assertSchemaFamily(database: Database, dbPath: string): void {
  if (!hasUserTables(database)) return;
  const appMeta = database.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'"
  ).get();
  if (!appMeta) {
    throw new Error(`Legacy Flow database detected at ${dbPath}. Move or delete it to initialize the Flow schema.`);
  }
  const family = database.query<{ value: string }, [string]>('SELECT value FROM app_meta WHERE key = ?').get('schema_family');
  if (family?.value !== SCHEMA_FAMILY) {
    throw new Error(`Unsupported database schema family at ${dbPath}. Expected "${SCHEMA_FAMILY}".`);
  }
}

export function initDb(repoRoot: string): Database {
  const dataDir = path.join(repoRoot, DATA_DIR);
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'tasks.db');
  db = new Database(dbPath, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');

  try {
    assertSchemaFamily(db, dbPath);
    createSchema(db);
  } catch (error) {
    db.close();
    db = undefined!;
    throw error;
  }
  return db;
}

export function closeDb(): void {
  if (!db) return;
  db.close();
  db = undefined!;
}

function createSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT INTO app_meta (key, value) VALUES ('schema_family', '${SCHEMA_FAMILY}')
      ON CONFLICT(key) DO NOTHING;
    INSERT INTO app_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
      ON CONFLICT(key) DO NOTHING;

    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_key    TEXT UNIQUE NOT NULL,
      title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 50000),
      acceptance  TEXT NOT NULL DEFAULT '' CHECK (length(acceptance) <= 50000),
      preferred_flow_id INTEGER DEFAULT NULL REFERENCES flows(id) ON DELETE SET NULL,
      resolution  TEXT NOT NULL DEFAULT 'open' CHECK (resolution IN ('open', 'completed', 'cancelled')),
      sort_order  REAL NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_links (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      source_task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      link_type          TEXT NOT NULL CHECK (link_type IN ('blocks', 'relates_to')),
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (source_task_id != target_task_id),
      UNIQUE(source_task_id, target_task_id, link_type)
    );

    CREATE INDEX IF NOT EXISTS idx_task_links_source ON task_links(source_task_id);
    CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_task_id);

    CREATE TABLE IF NOT EXISTS agent_config (
      id                        INTEGER PRIMARY KEY CHECK (id = 1),
      cli_cmd                   TEXT DEFAULT NULL,
      cli_prompt_mode           TEXT NOT NULL DEFAULT 'stdin' CHECK (cli_prompt_mode IN ('stdin', 'argument', 'flag')),
      cli_prompt_flag           TEXT DEFAULT NULL,
      timeout_ms                INTEGER NOT NULL DEFAULT 1800000,
      max_concurrent_executions INTEGER NOT NULL DEFAULT 3 CHECK (max_concurrent_executions BETWEEN 1 AND 10),
      updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_config (
      id               INTEGER PRIMARY KEY CHECK (id = 1),
      task_prefix      TEXT NOT NULL CHECK (length(task_prefix) BETWEEN 1 AND 5 AND task_prefix GLOB '[A-Z0-9]*'),
      next_task_number INTEGER NOT NULL DEFAULT 1,
      repo_name        TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS flows (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
      is_default        INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      active_version_id INTEGER DEFAULT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_flows_one_default ON flows(is_default) WHERE is_default = 1;

    CREATE TABLE IF NOT EXISTS flow_versions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      flow_id         INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
      version         INTEGER NOT NULL,
      state           TEXT NOT NULL CHECK (state IN ('draft', 'published', 'archived')),
      draft_revision  INTEGER NOT NULL DEFAULT 1,
      definition_json TEXT NOT NULL,
      compiled_json   TEXT DEFAULT NULL,
      action_history_json TEXT NOT NULL DEFAULT '[]',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      published_at    TEXT DEFAULT NULL,
      UNIQUE(flow_id, version, state)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_versions_draft ON flow_versions(flow_id) WHERE state = 'draft';

    CREATE TABLE IF NOT EXISTS workspaces (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      repo_root     TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch        TEXT DEFAULT NULL,
      state         TEXT NOT NULL CHECK (state IN ('active', 'retained', 'cleanup_required', 'removed', 'orphaned')),
      is_dirty      INTEGER DEFAULT NULL CHECK (is_dirty IS NULL OR is_dirty IN (0, 1)),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_live_task ON workspaces(task_id)
      WHERE state IN ('active', 'retained', 'cleanup_required');

    CREATE TABLE IF NOT EXISTS runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      flow_version_id INTEGER NOT NULL REFERENCES flow_versions(id),
      workspace_id    INTEGER DEFAULT NULL REFERENCES workspaces(id),
      status          TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'attention', 'finished', 'stopped')),
      result_category TEXT DEFAULT NULL CHECK (result_category IS NULL OR result_category IN ('completed', 'paused', 'cancelled')),
      reason          TEXT DEFAULT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      started_at      TEXT DEFAULT NULL,
      finished_at     TEXT DEFAULT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_active_task ON runs(task_id)
      WHERE status IN ('queued', 'running', 'waiting', 'attention');
    CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, id DESC);

    CREATE TABLE IF NOT EXISTS attempts (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id                 INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      block_id               TEXT NOT NULL,
      parent_attempt_id      INTEGER DEFAULT NULL REFERENCES attempts(id),
      incoming_connection_id TEXT DEFAULT NULL,
      sequence               INTEGER NOT NULL,
      block_attempt          INTEGER NOT NULL,
      status                 TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'timed_out', 'interrupted', 'cancelled')),
      outcome_id             TEXT DEFAULT NULL,
      result_json            TEXT DEFAULT NULL,
      decision_comment       TEXT DEFAULT NULL,
      pid                    INTEGER DEFAULT NULL,
      process_started_at     TEXT DEFAULT NULL,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      started_at             TEXT DEFAULT NULL,
      finished_at            TEXT DEFAULT NULL,
      UNIQUE(run_id, sequence)
    );

    CREATE INDEX IF NOT EXISTS idx_attempts_queue ON attempts(status, id);
    CREATE INDEX IF NOT EXISTS idx_attempts_run ON attempts(run_id, sequence);

    CREATE TABLE IF NOT EXISTS logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id     INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
      level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error', 'agent')),
      message    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_logs_attempt ON logs(attempt_id, id);

    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      topic       TEXT NOT NULL,
      entity_type TEXT DEFAULT NULL,
      entity_id   TEXT DEFAULT NULL,
      payload     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_created ON events(id);

    CREATE TRIGGER IF NOT EXISTS tasks_updated_at AFTER UPDATE ON tasks
    BEGIN
      UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS flows_updated_at AFTER UPDATE ON flows
    BEGIN
      UPDATE flows SET updated_at = datetime('now') WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS workspaces_updated_at AFTER UPDATE ON workspaces
    BEGIN
      UPDATE workspaces SET updated_at = datetime('now') WHERE id = NEW.id;
    END;

    INSERT INTO agent_config (id) VALUES (1) ON CONFLICT DO NOTHING;
    PRAGMA user_version = 1;
  `);
  ensureTaskFlowPreference(database);
  migrateTaskDependencies(database);
}

function ensureTaskFlowPreference(database: Database): void {
  const columns = database.query<{ name: string }, []>('PRAGMA table_info(tasks)').all();
  if (columns.some((column) => column.name === 'preferred_flow_id')) return;
  database.exec('ALTER TABLE tasks ADD COLUMN preferred_flow_id INTEGER DEFAULT NULL REFERENCES flows(id) ON DELETE SET NULL');
}

function migrateTaskDependencies(database: Database): void {
  const legacy = database.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_dependencies'").get();
  if (!legacy) return;
  database.exec(`
    INSERT OR IGNORE INTO task_links (source_task_id, target_task_id, link_type)
    SELECT depends_on_task_id, task_id, 'blocks' FROM task_dependencies;
  `);
}
