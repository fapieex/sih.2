import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { db, nowIso, addDays, getRules, logAudit, numRule, ROOT } from './db.js';
import {
  ROUTES, STAGE_META, createApplication, advanceStage, returnToInstitution,
  submitClarification, revertToPrevious, assignStage, scheduleEVC, canActOnStage,
} from './workflow.js';
import { runAlertEngine, startAlertScheduler } from './alerts.js';

const app = express();
app.use(cors());
app.use(express.json());

const sessions = new Map(); // token -> user

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, designation: u.designation, region_id: u.region_id, institution_id: u.institution_id };
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = sessions.get(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  req.token = token;
  next();
}
const allow = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
  next();
};
const wrap = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

// scope: which applications a role may see (set per-request)
let _req = null;
function scopeWhere(alias = 'a') {
  const u = _req.user;
  if (u.role === 'INSTITUTION') return { sql: `${alias}.institution_id = ?`, params: [u.institution_id] };
  if (u.role === 'REGIONAL') return { sql: `${alias}.region_id = ?`, params: [u.region_id] };
  return { sql: '1=1', params: [] };
}

// ---------------- Auth ----------------
app.post('/api/auth/login', wrap((req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND password = ?').get(email || '', password || '');
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user);
  res.json({ token, user: publicUser(user) });
}));

app.post('/api/auth/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---------------- Reference data ----------------
app.get('/api/meta', auth, wrap((req, res) => {
  _req = req;
  res.json({
    regions: db.prepare('SELECT * FROM regions ORDER BY id').all(),
    routes: Object.entries(ROUTES).map(([code, r]) => ({ code, name: r.name, description: r.description, stages: r.stages })),
    stages: Object.entries(STAGE_META).map(([code, m]) => ({ code, name: m.name, timeline_days: numRule(`timeline_${code.toLowerCase()}`, m.timeline_days), owner_role: m.owner_role, description: m.description })),
    roles: ['ADMIN', 'REGIONAL', 'BUREAU', 'EVC', 'INSTITUTION'],
    rules: db.prepare('SELECT * FROM rules ORDER BY grp, key').all(),
  });
}));

app.get('/api/institutions', auth, wrap((req, res) => {
  _req = req;
  const sc = scopeWhere('i');
  res.json(db.prepare(`SELECT i.*, r.name region_name FROM institutions i JOIN regions r ON r.id=i.region_id WHERE ${sc.sql} ORDER BY i.name`).all(...sc.params));
}));

app.get('/api/users', auth, wrap((req, res) => {
  res.json(db.prepare(`SELECT id, name, email, role, designation, region_id, institution_id FROM users WHERE role != 'INSTITUTION' ORDER BY role, name`).all());
}));

// ---------------- Applications ----------------
app.get('/api/applications', auth, wrap((req, res) => {
  _req = req;
  const sc = scopeWhere('a');
  const filters = [];
  const params = [...sc.params];
  if (req.query.region) { filters.push('a.region_id = ?'); params.push(Number(req.query.region)); }
  if (req.query.status) { filters.push('a.status = ?'); params.push(req.query.status); }
  if (req.query.route) { filters.push('a.route_code = ?'); params.push(req.query.route); }
  if (req.query.stage) { filters.push('a.current_stage = ?'); params.push(req.query.stage); }
  if (req.query.q) { filters.push('(a.application_no LIKE ? OR a.title LIKE ? OR i.name LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  const where = [sc.sql, ...filters].join(' AND ');
  const rows = db.prepare(`
    SELECT a.*, i.name inst_name, i.inst_type, i.city inst_city, r.name region_name, r.code region_code,
           st.name stage_name, s.due_at, s.started_at, s.status stage_status,
           u.name officer_name, u.role officer_role,
           CAST(julianday('now') - julianday(s.started_at) AS INTEGER) stage_age_days,
           CAST(julianday('now') - julianday(s.due_at) AS INTEGER) days_overdue,
           CAST(julianday('now') - julianday(a.submitted_at) AS INTEGER) age_days
      FROM applications a
      JOIN institutions i ON i.id = a.institution_id
      JOIN regions r ON r.id = a.region_id
      LEFT JOIN stages st ON st.code = a.current_stage
      LEFT JOIN application_stages s ON s.app_id = a.id AND s.seq = a.current_seq
      LEFT JOIN users u ON u.id = COALESCE(s.officer_id, a.assigned_to)
     WHERE ${where}
     ORDER BY CASE a.status WHEN 'IN_PROCESS' THEN 0 WHEN 'RETURNED' THEN 1 ELSE 2 END,
              s.due_at ASC`).all(...params);
  res.json(rows);
}));

app.get('/api/applications/:id', auth, wrap((req, res) => {
  _req = req;
  const sc = scopeWhere('a');
  const a = db.prepare(`
    SELECT a.*, i.name inst_name, i.city, i.inst_type, r.name region_name, r.code region_code, ro.name region_officer
      FROM applications a
      JOIN institutions i ON i.id = a.institution_id
      JOIN regions r ON r.id = a.region_id
      LEFT JOIN users ro ON ro.role='REGIONAL' AND ro.region_id = a.region_id
     WHERE a.id = ? AND ${sc.sql}`).get(Number(req.params.id), ...sc.params);
  if (!a) return res.status(404).json({ error: 'Application not found' });
  const stages = db.prepare(`
    SELECT s.*, st.name stage_name, st.timeline_days, u.name officer_name, u.role officer_role
      FROM application_stages s
      JOIN stages st ON st.code = s.stage_code
      LEFT JOIN users u ON u.id = s.officer_id
     WHERE s.app_id = ? ORDER BY s.seq`).all(a.id);
  const audit = db.prepare('SELECT * FROM audit_log WHERE app_id = ? ORDER BY id DESC LIMIT 100').all(a.id);
  const undertakings = db.prepare('SELECT * FROM undertakings WHERE app_id = ? OR institution_id = ? ORDER BY due_date').all(a.id, a.institution_id);
  const documents = db.prepare('SELECT * FROM documents WHERE app_id = ? OR institution_id = ? ORDER BY expiry_date').all(a.id, a.institution_id);
  const evc = db.prepare('SELECT * FROM evc_schedules WHERE app_id = ? ORDER BY visit_date DESC').all(a.id);
  res.json({ ...a, stages, audit, undertakings, documents, evc_schedules: evc, route: ROUTES[a.route_code], can_act: canActOnStage(req.user.role, a.current_stage) });
}));

app.post('/api/applications', auth, allow('ADMIN', 'REGIONAL', 'BUREAU'), wrap((req, res) => {
  _req = req;
  const { title, appl_type, route_code, institution_id } = req.body || {};
  const inst = db.prepare('SELECT * FROM institutions WHERE id = ?').get(Number(institution_id));
  if (!inst) return res.status(400).json({ error: 'Unknown institution' });
  if (req.user.role === 'REGIONAL' && inst.region_id !== req.user.region_id) {
    return res.status(403).json({ error: 'Institution belongs to another region' });
  }
  const id = createApplication({ title, appl_type: appl_type || 'Grant of Approval', route_code, institution_id: Number(institution_id), actor: req.user });
  res.status(201).json({ id });
}));

app.post('/api/applications/:id/advance', auth, wrap((req, res) => {
  _req = req;
  const r = advanceStage(Number(req.params.id), req.user, req.body?.observations || null);
  res.json(r);
}));

app.post('/api/applications/:id/return', auth, allow('ADMIN', 'REGIONAL', 'BUREAU', 'EVC'), wrap((req, res) => {
  _req = req;
  res.json(returnToInstitution(Number(req.params.id), req.user, req.body?.reason));
}));

app.post('/api/applications/:id/revert', auth, allow('ADMIN', 'BUREAU'), wrap((req, res) => {
  _req = req;
  res.json(revertToPrevious(Number(req.params.id), req.user, req.body?.reason));
}));

app.post('/api/applications/:id/clarify', auth, wrap((req, res) => {
  _req = req;
  res.json(submitClarification(Number(req.params.id), req.user, req.body?.note));
}));

app.post('/api/applications/:id/assign', auth, allow('ADMIN', 'REGIONAL', 'BUREAU'), wrap((req, res) => {
  _req = req;
  res.json(assignStage(Number(req.params.id), Number(req.body?.officer_id), req.user));
}));

// ---------------- EVC ----------------
app.get('/api/evc/queue', auth, wrap((req, res) => {
  _req = req;
  const sc = scopeWhere('a');
  const rows = db.prepare(`
    SELECT a.id, a.application_no, a.title, a.status, a.route_code, a.submitted_at,
           i.name inst_name, i.city, i.inst_type, r.name region_name, r.code region_code,
           s.status evc_status, s.started_at, s.due_at, s.officer_id,
           CAST(julianday('now') - julianday(s.due_at) AS INTEGER) days_overdue,
           sch.visit_date, sch.committee, sch.status schedule_status,
           (SELECT MIN(s2.due_at) FROM application_stages s2 WHERE s2.app_id = a.id AND s2.stage_code = 'EVC') evc_due_at
      FROM applications a
      JOIN institutions i ON i.id = a.institution_id
      JOIN regions r ON r.id = a.region_id
      LEFT JOIN application_stages s ON s.app_id = a.id AND s.stage_code = 'EVC'
      LEFT JOIN evc_schedules sch ON sch.app_id = a.id AND sch.status = 'SCHEDULED'
     WHERE a.route_code IN ('SCRUTINY_EVC','SCRUTINY_EVC_SAC','EVC_SAC','ONLY_EVC') AND ${sc.sql}
     ORDER BY CASE s.status WHEN 'ACTIVE' THEN 0 WHEN 'RETURNED' THEN 1 WHEN 'PENDING' THEN 2 ELSE 3 END,
              s.due_at ASC`).all(...sc.params);
  res.json(rows);
}));

app.post('/api/applications/:id/evc-schedule', auth, allow('ADMIN', 'EVC', 'REGIONAL', 'BUREAU'), wrap((req, res) => {
  _req = req;
  res.json(scheduleEVC(Number(req.params.id), req.body || {}, req.user));
}));

// ---------------- Undertakings ----------------
function undScope(alias = 'u') {
  const u = _req.user;
  if (u.role === 'INSTITUTION') return { sql: `${alias}.institution_id = ?`, params: [u.institution_id] };
  if (u.role === 'REGIONAL') return { sql: 'i.region_id = ?', params: [u.region_id] };
  return { sql: '1=1', params: [] };
}

app.get('/api/undertakings', auth, wrap((req, res) => {
  _req = req;
  const sc = undScope();
  const rows = db.prepare(`
    SELECT u.*, i.name inst_name, i.region_id, r.name region_name, r.code region_code,
           a.application_no, v.name verifier_name,
           CAST(julianday(u.due_date) - julianday('now') AS INTEGER) days_left
      FROM undertakings u
      JOIN institutions i ON i.id = u.institution_id
      JOIN regions r ON r.id = i.region_id
      LEFT JOIN applications a ON a.id = u.app_id
      LEFT JOIN users v ON v.id = u.verified_by
     WHERE ${sc.sql}
     ORDER BY days_left ASC`).all(...sc.params);
  res.json(rows);
}));

app.post('/api/undertakings/:id/submit', auth, allow('INSTITUTION', 'ADMIN'), wrap((req, res) => {
  _req = req;
  const u = db.prepare('SELECT * FROM undertakings WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'INSTITUTION' && u.institution_id !== req.user.institution_id) return res.status(403).json({ error: 'Not your institution' });
  if (!['PENDING', 'REJECTED'].includes(u.status)) return res.status(400).json({ error: `Cannot submit in status ${u.status}` });
  const fileName = req.body?.file_name || `evidence_${u.id}.pdf`;
  db.prepare(`UPDATE undertakings SET status='SUBMITTED', submitted_at=?, file_name=? WHERE id=?`).run(nowIso(), fileName, u.id);
  logAudit({ app_id: u.app_id, entity_type: 'UNDERTAKING', entity_id: u.id, actor: req.user,
    action: 'UNDERTAKING_SUBMITTED', detail: fileName });
  res.json({ ok: true });
}));

app.post('/api/undertakings/:id/verify', auth, allow('ADMIN', 'REGIONAL', 'BUREAU'), wrap((req, res) => {
  _req = req;
  const u = db.prepare('SELECT * FROM undertakings WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.status !== 'SUBMITTED') return res.status(400).json({ error: 'Nothing submitted to verify' });
  const accept = req.body?.accept !== false;
  db.prepare(`UPDATE undertakings SET status=?, verified_by=?, verified_at=?, remarks=? WHERE id=?`)
    .run(accept ? 'VERIFIED' : 'REJECTED', req.user.id, nowIso(), req.body?.remarks || (accept ? 'Verified — accepted.' : 'Re-submission sought.'), u.id);
  logAudit({ app_id: u.app_id, entity_type: 'UNDERTAKING', entity_id: u.id, actor: req.user,
    action: accept ? 'UNDERTAKING_VERIFIED' : 'UNDERTAKING_REJECTED', detail: req.body?.remarks || null });
  res.json({ ok: true });
}));

// ---------------- Documents ----------------
function docScope(alias = 'd') {
  const u = _req.user;
  if (u.role === 'INSTITUTION') return { sql: `${alias}.institution_id = ?`, params: [u.institution_id] };
  if (u.role === 'REGIONAL') return { sql: 'i.region_id = ?', params: [u.region_id] };
  return { sql: '1=1', params: [] };
}

app.get('/api/documents', auth, wrap((req, res) => {
  _req = req;
  const sc = docScope();
  const rows = db.prepare(`
    SELECT d.*, i.name inst_name, i.region_id, r.name region_name, r.code region_code, v.name verifier_name,
           CAST(julianday(d.expiry_date) - julianday('now') AS INTEGER) days_to_expiry
      FROM documents d
      JOIN institutions i ON i.id = d.institution_id
      JOIN regions r ON r.id = i.region_id
      LEFT JOIN users v ON v.id = d.verified_by
     WHERE ${sc.sql}
     ORDER BY d.expiry_date ASC`).all(...sc.params);
  res.json(rows);
}));

app.post('/api/documents', auth, allow('INSTITUTION', 'ADMIN'), wrap((req, res) => {
  _req = req;
  const { doc_type = 'LEASE', title, file_name, issued_on, expiry_date, replaces_id } = req.body || {};
  if (!title || !expiry_date) return res.status(400).json({ error: 'title and expiry_date required' });
  const instId = req.user.role === 'INSTITUTION' ? req.user.institution_id : Number(req.body?.institution_id);
  const info = db.prepare(`INSERT INTO documents (institution_id, doc_type, title, file_name, issued_on, expiry_date, status, submitted_at)
                           VALUES (?,?,?,?,?,?, 'SUBMITTED', ?)`)
    .run(instId, doc_type, title, file_name || `doc_${Date.now()}.pdf`, issued_on || null, expiry_date, nowIso());
  if (replaces_id) {
    db.prepare(`UPDATE documents SET remarks = COALESCE(remarks,'') || ? WHERE id=?`)
      .run(` [superseded by doc #${info.lastInsertRowid}]`, Number(replaces_id));
  }
  logAudit({ entity_type: 'DOCUMENT', entity_id: Number(info.lastInsertRowid), actor: req.user,
    action: 'DOCUMENT_SUBMITTED', detail: `${title} (valid to ${expiry_date})` });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

app.post('/api/documents/:id/verify', auth, allow('ADMIN', 'REGIONAL', 'BUREAU'), wrap((req, res) => {
  _req = req;
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (!['SUBMITTED', 'EXPIRED'].includes(doc.status)) return res.status(400).json({ error: `Cannot verify in status ${doc.status}` });
  const accept = req.body?.accept !== false;
  db.prepare(`UPDATE documents SET status=?, verified_by=?, verified_at=?, remarks=? WHERE id=?`)
    .run(accept ? 'VERIFIED' : 'REJECTED', req.user.id, nowIso(), req.body?.remarks || null, doc.id);
  logAudit({ entity_type: 'DOCUMENT', entity_id: doc.id, actor: req.user,
    action: accept ? 'DOCUMENT_VERIFIED' : 'DOCUMENT_REJECTED', detail: `${doc.title}: ${req.body?.remarks || ''}` });
  res.json({ ok: true });
}));

// ---------------- Alerts ----------------
function alertScope() {
  const u = _req.user;
  if (u.role === 'INSTITUTION') return { sql: "audience_role = 'INSTITUTION' AND audience_region_id = ?", params: [u.region_id] };
  if (u.role === 'REGIONAL') return { sql: "(audience_role IN ('REGIONAL','EVC','INSTITUTION') AND audience_region_id = ?)", params: [u.region_id] };
  if (u.role === 'EVC') return { sql: "(audience_role = 'EVC' OR ? = 'ADMIN')", params: [u.role] };
  return { sql: '1=1', params: [] }; // BUREAU / ADMIN see all
}

app.get('/api/alerts', auth, wrap((req, res) => {
  _req = req;
  const sc = alertScope();
  const rows = db.prepare(`
    SELECT * FROM notifications
     WHERE ${sc.sql}
     ORDER BY id DESC LIMIT 200`).all(...sc.params);
  const unread = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE ${sc.sql} AND read_at IS NULL`).get(...sc.params).c;
  res.json({ unread, alerts: rows });
}));

app.post('/api/alerts/:id/read', auth, wrap((req, res) => {
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(nowIso(), Number(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/alerts/read-all', auth, wrap((req, res) => {
  _req = req;
  const sc = alertScope();
  db.prepare(`UPDATE notifications SET read_at = ? WHERE ${sc.sql} AND read_at IS NULL`).run(nowIso(), ...sc.params);
  res.json({ ok: true });
}));

app.post('/api/alerts/run', auth, allow('ADMIN'), wrap((req, res) => {
  res.json(runAlertEngine({ actor: req.user }));
}));

// ---------------- Dashboard ----------------
app.get('/api/dashboard', auth, wrap((req, res) => {
  _req = req;
  const sc = scopeWhere('a');
  const P = sc.params;
  const q = (sql, ...p) => db.prepare(sql).get(...p);
  const qa = (sql, ...p) => db.prepare(sql).all(...p);

  const base = `FROM applications a JOIN institutions i ON i.id = a.institution_id
      LEFT JOIN application_stages s ON s.app_id = a.id AND s.seq = a.current_seq
     WHERE ${sc.sql}`;

  const total = q(`SELECT COUNT(*) c ${base}`, ...P).c;
  const inProcess = q(`SELECT COUNT(*) c ${base} AND a.status='IN_PROCESS'`, ...P).c;
  const returned = q(`SELECT COUNT(*) c ${base} AND a.status='RETURNED'`, ...P).c;
  const completed = q(`SELECT COUNT(*) c ${base} AND a.status='COMPLETED'`, ...P).c;
  const overdue = q(`SELECT COUNT(*) c ${base} AND a.status='IN_PROCESS' AND s.due_at < datetime('now')`, ...P).c;
  const evcPending = q(`SELECT COUNT(*) c ${base} AND a.current_stage='EVC' AND a.status='IN_PROCESS'`, ...P).c;

  const alertScopeSql = alertScope();
  const crit = q(`SELECT COUNT(*) c FROM notifications WHERE ${alertScopeSql.sql} AND severity='CRITICAL' AND read_at IS NULL`, ...alertScopeSql.params).c;
  const warn = q(`SELECT COUNT(*) c FROM notifications WHERE ${alertScopeSql.sql} AND severity='WARNING' AND read_at IS NULL`, ...alertScopeSql.params).c;

  const undScopeSql = undScope();
  const undDue30 = q(`SELECT COUNT(*) c FROM undertakings u JOIN institutions i ON i.id=u.institution_id
      WHERE ${undScopeSql.sql} AND u.status IN ('PENDING','SUBMITTED') AND julianday(u.due_date) - julianday('now') BETWEEN 0 AND 30`, ...undScopeSql.params).c;
  const undOverdue = q(`SELECT COUNT(*) c FROM undertakings u JOIN institutions i ON i.id=u.institution_id
      WHERE ${undScopeSql.sql} AND u.status IN ('PENDING','SUBMITTED') AND u.due_date < date('now')`, ...undScopeSql.params).c;

  const docScopeSql = docScope();
  const docsExpiring = q(`SELECT COUNT(*) c FROM documents d JOIN institutions i ON i.id=d.institution_id
      WHERE ${docScopeSql.sql} AND d.expiry_date IS NOT NULL AND d.status IN ('VALID','SUBMITTED') AND julianday(d.expiry_date) - julianday('now') BETWEEN 0 AND 30`, ...docScopeSql.params).c;
  const docsExpired = q(`SELECT COUNT(*) c FROM documents d JOIN institutions i ON i.id=d.institution_id
      WHERE ${docScopeSql.sql} AND d.status = 'EXPIRED'`, ...docScopeSql.params).c;

  const byStage = qa(`
    SELECT st.name stage, s.stage_code,
           COUNT(*) pending,
           SUM(CASE WHEN a.status='IN_PROCESS' AND s.due_at < datetime('now') THEN 1 ELSE 0 END) overdue,
           CAST(AVG(julianday('now') - julianday(s.started_at)) AS INTEGER) avg_age
      FROM application_stages s
      JOIN applications a ON a.id = s.app_id
      JOIN stages st ON st.code = s.stage_code
      JOIN institutions i ON i.id = a.institution_id
     WHERE s.status IN ('ACTIVE','RETURNED') AND ${sc.sql}
     GROUP BY s.stage_code ORDER BY pending DESC`, ...P);

  const byRegion = qa(`
    SELECT r.name region, r.code,
           COUNT(*) total,
           SUM(CASE WHEN a.status='IN_PROCESS' THEN 1 ELSE 0 END) pending,
           SUM(CASE WHEN a.status='IN_PROCESS' AND s.due_at < datetime('now') THEN 1 ELSE 0 END) overdue,
           SUM(CASE WHEN a.status='COMPLETED' THEN 1 ELSE 0 END) completed
      FROM applications a
      JOIN regions r ON r.id = a.region_id
      JOIN institutions i ON i.id = a.institution_id
      LEFT JOIN application_stages s ON s.app_id = a.id AND s.seq = a.current_seq
     WHERE ${sc.sql}
     GROUP BY r.id ORDER BY r.id`, ...P);

  const ageing = qa(`
    SELECT CASE
             WHEN age < 15 THEN '0-14 d'
             WHEN age < 30 THEN '15-29 d'
             WHEN age < 60 THEN '30-59 d'
             WHEN age < 90 THEN '60-89 d'
             ELSE '90+ d' END bucket,
           COUNT(*) count
      FROM (SELECT CAST(julianday('now') - julianday(a.submitted_at) AS INTEGER) age
              FROM applications a JOIN institutions i ON i.id = a.institution_id
             WHERE a.status IN ('IN_PROCESS','RETURNED') AND ${sc.sql})
     GROUP BY bucket ORDER BY MIN(age)`, ...P);

  const workload = qa(`
    SELECT u.name officer, u.role, COUNT(*) pending
      FROM applications a
      JOIN institutions i ON i.id = a.institution_id
      JOIN application_stages s ON s.app_id = a.id AND s.seq = a.current_seq
      JOIN users u ON u.id = COALESCE(s.officer_id, a.assigned_to)
     WHERE a.status IN ('IN_PROCESS','RETURNED') AND ${sc.sql}
     GROUP BY u.id ORDER BY pending DESC LIMIT 8`, ...P);

  const bottlenecks = qa(`
    SELECT a.id, a.application_no, a.title, i.name inst_name, r.code region_code,
           st.name stage_name, s.due_at,
           CAST(julianday('now') - julianday(s.due_at) AS INTEGER) days_overdue
      FROM applications a
      JOIN institutions i ON i.id = a.institution_id
      JOIN regions r ON r.id = a.region_id
      JOIN application_stages s ON s.app_id = a.id AND s.seq = a.current_seq
      JOIN stages st ON st.code = s.stage_code
     WHERE a.status='IN_PROCESS' AND s.due_at < datetime('now') AND ${sc.sql}
     ORDER BY s.due_at ASC LIMIT 8`, ...P);

  const recentAlerts = qa(`SELECT * FROM notifications WHERE ${alertScopeSql.sql} ORDER BY id DESC LIMIT 8`, ...alertScopeSql.params);

  res.json({
    kpis: { total, inProcess, returned, completed, overdue, evcPending, crit, warn, undDue30, undOverdue, docsExpiring, docsExpired },
    byStage, byRegion, ageing, workload, bottlenecks, recentAlerts,
  });
}));

// ---------------- Audit & reports ----------------
app.get('/api/audit', auth, wrap((req, res) => {
  _req = req;
  const sc = scopeWhere('a');
  const params = [...sc.params];
  let extra = '';
  if (req.query.action) { extra += ' AND al.action LIKE ?'; params.push(`%${req.query.action}%`); }
  if (req.query.app_id) { extra += ' AND al.app_id = ?'; params.push(Number(req.query.app_id)); }
  const rows = db.prepare(`
    SELECT al.*, a.application_no
      FROM audit_log al
      LEFT JOIN applications a ON a.id = al.app_id
     WHERE (${sc.sql} OR al.app_id IS NULL) ${extra}
     ORDER BY al.id DESC LIMIT 300`).all(...params);
  res.json(rows);
}));

app.get('/api/reports', auth, allow('ADMIN', 'BUREAU', 'REGIONAL'), wrap((req, res) => {
  _req = req;
  const sc = scopeWhere('a');
  const P = sc.params;
  const qa = (sql, ...p) => db.prepare(sql).all(...p);

  const pendency = qa(`
    SELECT r.code region_code, r.name region, st.name stage, a.status,
           COUNT(*) count,
           CAST(AVG(julianday('now') - julianday(a.submitted_at)) AS INTEGER) avg_age_days
      FROM applications a
      JOIN regions r ON r.id = a.region_id
      JOIN institutions i ON i.id = a.institution_id
      JOIN stages st ON st.code = a.current_stage
     WHERE ${sc.sql} GROUP BY r.id, a.current_stage, a.status ORDER BY r.id, st.name`, ...P);

  const evc = qa(`
    SELECT r.code region_code, i.name inst_name, a.application_no,
           s.status evc_stage_status, s.due_at, sch.visit_date, sch.status schedule_status,
           CAST(julianday('now') - julianday(s.due_at) AS INTEGER) days_overdue
      FROM applications a
      JOIN institutions i ON i.id = a.institution_id
      JOIN regions r ON r.id = a.region_id
      LEFT JOIN application_stages s ON s.app_id = a.id AND s.stage_code = 'EVC'
      LEFT JOIN evc_schedules sch ON sch.app_id = a.id AND sch.status = 'SCHEDULED'
     WHERE a.route_code IN ('SCRUTINY_EVC','SCRUTINY_EVC_SAC','EVC_SAC','ONLY_EVC') AND ${sc.sql}
     ORDER BY s.due_at ASC`, ...P);

  const undertakings = qa(`
    SELECT r.code region_code, i.name inst_name, u.title, u.due_date, u.status,
           CAST(julianday(u.due_date) - julianday('now') AS INTEGER) days_left
      FROM undertakings u JOIN institutions i ON i.id = u.institution_id
      JOIN regions r ON r.id = i.region_id
     WHERE ${sc.sql} ORDER BY u.due_date ASC`, ...P);

  const documents = qa(`
    SELECT r.code region_code, i.name inst_name, d.doc_type, d.title, d.expiry_date, d.status,
           CAST(julianday(d.expiry_date) - julianday('now') AS INTEGER) days_to_expiry
      FROM documents d JOIN institutions i ON i.id = d.institution_id
      JOIN regions r ON r.id = i.region_id
     WHERE ${sc.sql} ORDER BY d.expiry_date ASC`, ...P);

  const overdue = qa(`
    SELECT a.application_no, i.name inst_name, r.code region_code, st.name stage_name,
           s.due_at, CAST(julianday('now') - julianday(s.due_at) AS INTEGER) days_overdue, u.name officer
      FROM application_stages s
      JOIN applications a ON a.id = s.app_id
      JOIN institutions i ON i.id = a.institution_id
      JOIN regions r ON r.id = a.region_id
      JOIN stages st ON st.code = s.stage_code
      LEFT JOIN users u ON u.id = s.officer_id
     WHERE s.status='ACTIVE' AND s.due_at < datetime('now') AND ${sc.sql}
     ORDER BY s.due_at ASC`, ...P);

  res.json({ pendency, evc, undertakings, documents, overdue });
}));

// ---------------- Rules (configurable APH timelines) ----------------
app.put('/api/rules', auth, allow('ADMIN'), wrap((req, res) => {
  const updates = req.body || {};
  const allowed = new Set(db.prepare('SELECT key FROM rules').all().map(r => r.key));
  const upd = db.prepare('UPDATE rules SET value = ? WHERE key = ?');
  const changed = [];
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.has(k) && String(v).trim() !== '') { upd.run(String(v), k); changed.push(`${k}=${v}`); }
  }
  if (changed.length) logAudit({ entity_type: 'RULE', actor: req.user, action: 'RULES_UPDATED', detail: changed.join(', ') });
  runAlertEngine({ actor: req.user });
  res.json({ ok: true, rules: getRules() });
}));

// ---------------- Static client (production build) ----------------
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 5175;
app.listen(PORT, () => {
  console.log(`AICTE Approval Platform API listening on http://localhost:${PORT}`);
  startAlertScheduler(numRule('alert_refresh_seconds', 60));
});
