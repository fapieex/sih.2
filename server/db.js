import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'aicte.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS institutions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  city TEXT NOT NULL,
  inst_type TEXT NOT NULL,        -- Engineering | Management | Pharmacy | Polytechnic
  status TEXT NOT NULL DEFAULT 'APPROVED'
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','REGIONAL','BUREAU','EVC','INSTITUTION')),
  designation TEXT,
  region_id INTEGER REFERENCES regions(id),
  institution_id INTEGER REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS routes (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stage_seq TEXT NOT NULL,        -- JSON array of stage codes in order
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timeline_days INTEGER NOT NULL, -- prescribed processing timeline (APH configurable)
  owner_role TEXT NOT NULL,       -- role authorised to act on this stage
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY,
  application_no TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  appl_type TEXT NOT NULL,        -- New | Extension | Renewal | Variation
  route_code TEXT NOT NULL REFERENCES routes(code),
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  region_id INTEGER NOT NULL REFERENCES regions(id),
  status TEXT NOT NULL DEFAULT 'IN_PROCESS', -- IN_PROCESS | RETURNED | COMPLETED | REJECTED
  current_seq INTEGER NOT NULL DEFAULT 1,
  current_stage TEXT NOT NULL,
  assigned_to INTEGER REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS application_stages (
  id INTEGER PRIMARY KEY,
  app_id INTEGER NOT NULL REFERENCES applications(id),
  seq INTEGER NOT NULL,
  stage_code TEXT NOT NULL REFERENCES stages(code),
  status TEXT NOT NULL,           -- PENDING | ACTIVE | DONE | RETURNED
  officer_id INTEGER REFERENCES users(id),
  started_at TEXT,
  due_at TEXT,
  completed_at TEXT,
  observations TEXT,
  return_reason TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  app_id INTEGER REFERENCES applications(id),
  entity_type TEXT NOT NULL,      -- APPLICATION | UNDERTAKING | DOCUMENT | RULE | ALERT
  entity_id INTEGER,
  actor_id INTEGER,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS undertakings (
  id INTEGER PRIMARY KEY,
  app_id INTEGER REFERENCES applications(id),
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  title TEXT NOT NULL,
  condition_text TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SUBMITTED | VERIFIED | REJECTED
  submitted_at TEXT,
  file_name TEXT,
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  app_id INTEGER REFERENCES applications(id),
  doc_type TEXT NOT NULL,         -- LEASE | AFFIDAVIT | UNDERTAKING_DOC | OTHER
  title TEXT NOT NULL,
  file_name TEXT,
  issued_on TEXT,
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'VALID', -- VALID | SUBMITTED | VERIFIED | EXPIRED | REJECTED
  submitted_at TEXT,
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS evc_schedules (
  id INTEGER PRIMARY KEY,
  app_id INTEGER NOT NULL REFERENCES applications(id),
  stage_id INTEGER NOT NULL REFERENCES application_stages(id),
  visit_date TEXT NOT NULL,
  committee TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED | COMPLETED | CANCELLED
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,             -- PENDENCY | EVC_DUE | UNDERTAKING | DOC_EXPIRY | ESCALATION
  severity TEXT NOT NULL,         -- INFO | WARNING | CRITICAL
  level INTEGER NOT NULL DEFAULT 0, -- 0 normal, 1 first escalation, 2 second escalation
  audience_role TEXT NOT NULL,    -- role that should see it (plus ADMIN always)
  audience_region_id INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  dedupe_key TEXT UNIQUE,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  grp TEXT NOT NULL,
  value TEXT NOT NULL
);
`);

// lightweight migration for databases created before updated_at existed
const cols = db.prepare(`PRAGMA table_info(applications)`).all().map(c => c.name);
if (!cols.includes('updated_at')) db.exec(`ALTER TABLE applications ADD COLUMN updated_at TEXT`);

export const nowIso = () => new Date().toISOString();
export const dayMs = 24 * 60 * 60 * 1000;

export function addDays(date, days) {
  const d = typeof date === 'string' ? new Date(date) : new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function daysBetween(fromIso, toIso = nowIso()) {
  return Math.floor((new Date(toIso) - new Date(fromIso)) / dayMs);
}

export function getRules() {
  const rows = db.prepare('SELECT * FROM rules').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function getRule(key, fallback) {
  const row = db.prepare('SELECT value FROM rules WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function numRule(key, fallback) {
  const v = getRule(key, null);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function logAudit({ app_id = null, entity_type, entity_id = null, actor, action, detail = null }) {
  db.prepare(`INSERT INTO audit_log (app_id, entity_type, entity_id, actor_id, actor_name, actor_role, action, detail, created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(app_id, entity_type, entity_id, actor?.id ?? null, actor?.name ?? 'System', actor?.role ?? 'SYSTEM', action, detail, nowIso());
}
