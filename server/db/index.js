// Схема и подключение к SQLite. Node 22+ даёт встроенный node:sqlite — без внешних зависимостей.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';

let db;

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        consent_status TEXT NOT NULL DEFAULT 'none',
        consent_at TEXT,
        consent_policy_version TEXT,
        consent_ip TEXT,
        retention_days INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS consents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        at TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_consents_user ON consents(user_id);

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        title TEXT,
        source_meta TEXT,
        original_text TEXT NOT NULL,
        ast_json TEXT,
        char_count INTEGER NOT NULL DEFAULT 0,
        page_count INTEGER,
        lang TEXT,
        from_ocr INTEGER NOT NULL DEFAULT 0,
        ocr_confidence REAL,
        deleted_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        options_json TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'sync',
        status TEXT NOT NULL,
        stage TEXT,
        progress INTEGER NOT NULL DEFAULT 0,
        result_text TEXT,
        result_ast_json TEXT,
        error_code TEXT,
        error_message TEXT,
        integrity_json TEXT,
        llm_provider TEXT,
        llm_model TEXT,
        prompt_version TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        queued_at TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

      CREATE TABLE IF NOT EXISTS edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        text TEXT NOT NULL,
        ast_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (job_id, revision)
      );
      CREATE INDEX IF NOT EXISTS idx_edits_job ON edits(job_id, revision DESC);

      CREATE TABLE IF NOT EXISTS exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        format TEXT NOT NULL,
        bytes INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_exports_user ON exports(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS precheck_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reason_code TEXT NOT NULL,
        excerpt TEXT,
        char_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_precheck_created ON precheck_log(created_at DESC);
    `,
  },
  {
    version: 2,
    name: 'llm_usage',
    sql: `
      CREATE TABLE IF NOT EXISTS llm_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        provider TEXT,
        model TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        calls INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_user ON llm_usage(user_id, created_at DESC);
    `,
  },
];

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  db = new DatabaseSync(config.dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL);`);
  const applied = new Set(database.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    database.exec('BEGIN');
    try {
      database.exec(migration.sql);
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?,?,?)')
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// Обёртки, чтобы код был коротким и предсказуемым.
export const q = {
  all(sql, ...params) {
    return getDb().prepare(sql).all(...params);
  },
  get(sql, ...params) {
    return getDb().prepare(sql).get(...params);
  },
  run(sql, ...params) {
    return getDb().prepare(sql).run(...params);
  },
  exec(sql) {
    return getDb().exec(sql);
  },
  tx(fn) {
    const database = getDb();
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(database);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },
};

export const now = () => new Date().toISOString();
