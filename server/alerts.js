import { db, nowIso, numRule, getRules, logAudit, daysBetween, addDays } from './db.js';

const dayStamp = (iso) => iso.slice(0, 10).replace(/-/g, '');

function notify(row) {
  // dedupe_key includes level so each escalation step fires once per entity per day
  db.prepare(`INSERT OR IGNORE INTO notifications
      (type, severity, level, audience_role, audience_region_id, title, body, entity_type, entity_id, dedupe_key, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.type, row.severity, row.level ?? 0, row.audience_role, row.audience_region_id ?? null,
      row.title, row.body, row.entity_type ?? null, row.entity_id ?? null, row.dedupe_key, nowIso());
}

/**
 * Configurable alert & escalation engine.
 * Evaluates stage pendency, EVC queue, undertakings and document validity,
 * raises notifications and escalates overdue matters up the designated chain.
 */
export function runAlertEngine({ actor = null } = {}) {
  const r = getRules();
  const remindBefore = Number(r.remind_before_days ?? 7);
  const esc2After = Number(r.escalation_level2_days ?? 7);
  const esc3After = Number(r.escalation_level3_days ?? 15);
  const evcRemind = Number(r.evc_reminder_days ?? 10);
  const undertRemind = Number(r.undertaking_reminder_days ?? 10);
  const undertEsc = Number(r.undertaking_escalation_days ?? 7);
  const docRemind = Number(r.doc_expiry_reminder_days ?? 30);
  const docCritical = Number(r.doc_expiry_critical_days ?? 7);

  const created = { pendency: 0, evc: 0, undertaking: 0, doc: 0, escalated: 0 };
  const today = nowIso();

  // ---------- A. Stage pendency / ageing ----------
  const activeStages = db.prepare(`
    SELECT s.*, a.application_no, a.title, a.region_id, a.current_seq,
           i.name AS inst_name, u.name AS officer_name, u.role AS officer_role
      FROM application_stages s
      JOIN applications a ON a.id = s.app_id
      JOIN institutions i ON i.id = a.institution_id
      LEFT JOIN users u ON u.id = s.officer_id
     WHERE s.status = 'ACTIVE' AND a.status = 'IN_PROCESS'`).all();

  for (const s of activeStages) {
    const due = new Date(s.due_at);
    const overdueDays = Math.floor((new Date(today) - due) / 86400000);
    const daysLeft = -overdueDays;
    const baseRole = s.officer_role || (s.stage_code === 'SCRUTINY' ? 'REGIONAL' : s.stage_code === 'EVC' ? 'EVC' : 'BUREAU');
    const where = `${s.application_no} · ${s.inst_name} · ${s.stage_name ?? stageName(s.stage_code)}`;

    if (overdueDays > 0) {
      let level = 1, audience = baseRole, sev = 'CRITICAL';
      if (overdueDays > esc3After) { level = 3; audience = 'BUREAU'; }
      else if (overdueDays > esc2After) { level = 2; audience = 'REGIONAL'; }
      const before = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE dedupe_key LIKE ? AND level >= ?`)
        .get(`PEND:${s.app_id}:${s.stage_code}:%`, level).c;
      notify({
        type: 'PENDENCY', severity: sev, level, audience_role: audience, audience_region_id: s.region_id,
        title: `Overdue by ${overdueDays} day(s): ${stageName(s.stage_code)}`,
        body: `${where} — prescribed timeline exceeded${level > 1 ? `; escalated to ${audience}` : ''}. Due ${s.due_at.slice(0, 10)}.`,
        entity_type: 'APPLICATION', entity_id: s.app_id,
        dedupe_key: `PEND:${s.app_id}:${s.stage_code}:${level}:${dayStamp(today)}`,
      });
      created.pendency++;
      if (!before && level > 1) {
        created.escalated++;
        logAudit({ app_id: s.app_id, entity_type: 'ALERT', entity_id: s.app_id, actor,
          action: `ESCALATED_L${level}`, detail: `${stageName(s.stage_code)} overdue ${overdueDays}d → ${audience}` });
      }
    } else if (daysLeft <= remindBefore) {
      notify({
        type: 'PENDENCY', severity: 'WARNING', level: 0, audience_role: baseRole, audience_region_id: s.region_id,
        title: `Timeline approaching: ${stageName(s.stage_code)} (${daysLeft} day(s) left)`,
        body: `${where} — due ${s.due_at.slice(0, 10)}.`,
        entity_type: 'APPLICATION', entity_id: s.app_id,
        dedupe_key: `PEND:${s.app_id}:${s.stage_code}:0:${dayStamp(today)}`,
      });
      created.pendency++;
    }

    // ---------- C. EVC-specific reminders & escalation ----------
    if (s.stage_code === 'EVC') {
      const scheduled = db.prepare(`SELECT * FROM evc_schedules WHERE app_id=? AND status='SCHEDULED' ORDER BY visit_date DESC LIMIT 1`).get(s.app_id);
      if (overdueDays > 0) {
        notify({
          type: 'EVC_DUE', severity: 'CRITICAL', level: overdueDays > esc2After ? 2 : 1,
          audience_role: overdueDays > esc2After ? 'BUREAU' : 'REGIONAL', audience_region_id: s.region_id,
          title: `EVC delayed for ${s.application_no}`,
          body: `${s.inst_name} — EVC ${scheduled ? `scheduled for ${scheduled.visit_date.slice(0, 10)} not conducted/completed` : 'not yet scheduled'}; overdue by ${overdueDays} day(s). New institutions must be visited within prescribed timelines.`,
          entity_type: 'APPLICATION', entity_id: s.app_id,
          dedupe_key: `EVC:${s.app_id}:${overdueDays > esc2After ? 2 : 1}:${dayStamp(today)}`,
        });
        created.evc++;
      } else if (daysLeft <= evcRemind && (!scheduled || new Date(scheduled.visit_date) > due)) {
        notify({
          type: 'EVC_DUE', severity: 'WARNING', level: 0, audience_role: 'EVC', audience_region_id: s.region_id,
          title: `EVC due in ${daysLeft} day(s): ${s.application_no}`,
          body: `${s.inst_name} — ${scheduled ? `scheduled visit ${scheduled.visit_date.slice(0, 10)}` : 'no visit scheduled yet'}; due ${s.due_at.slice(0, 10)}.`,
          entity_type: 'APPLICATION', entity_id: s.app_id,
          dedupe_key: `EVC:${s.app_id}:0:${dayStamp(today)}`,
        });
        created.evc++;
      }
    }
  }

  // ---------- D. Time-bound undertakings ----------
  const undertakings = db.prepare(`
    SELECT u.*, i.name AS inst_name, i.region_id, a.application_no
      FROM undertakings u
      JOIN institutions i ON i.id = u.institution_id
      LEFT JOIN applications a ON a.id = u.app_id
     WHERE u.status IN ('PENDING','SUBMITTED')`).all();

  for (const u of undertakings) {
    const due = new Date(u.due_date);
    const overdueDays = Math.floor((new Date(today) - due) / 86400000);
    const daysLeft = -overdueDays;
    const where = `${u.title} — ${u.inst_name}${u.application_no ? ` (${u.application_no})` : ''}`;

    if (overdueDays > 0) {
      const level = overdueDays > undertEsc ? 2 : 1;
      const audience = level === 2 ? 'BUREAU' : 'REGIONAL';
      notify({
        type: 'UNDERTAKING', severity: 'CRITICAL', level, audience_role: audience, audience_region_id: u.region_id,
        title: `Undertaking overdue: ${u.title}`,
        body: `${where} — not fulfilled ${overdueDays} day(s) beyond stipulated timeline (due ${u.due_date}). Escalated to ${audience}.`,
        entity_type: 'UNDERTAKING', entity_id: u.id,
        dedupe_key: `UND:${u.id}:${level}:${dayStamp(today)}`,
      });
      created.undertaking++;
      if (level === 2 && u.status === 'PENDING') created.escalated++;
    } else if (daysLeft <= undertRemind) {
      notify({
        type: 'UNDERTAKING', severity: 'WARNING', level: 0, audience_role: 'INSTITUTION', audience_region_id: u.region_id,
        title: `Undertaking due in ${daysLeft} day(s): ${u.title}`,
        body: `${where} — submit supporting evidence online before ${u.due_date}.`,
        entity_type: 'UNDERTAKING', entity_id: u.id,
        dedupe_key: `UND:${u.id}:0:${dayStamp(today)}`,
      });
      created.undertaking++;
    }
  }

  // ---------- E. Lease / document validity ----------
  const docs = db.prepare(`
    SELECT d.*, i.name AS inst_name, i.region_id
      FROM documents d JOIN institutions i ON i.id = d.institution_id
     WHERE d.expiry_date IS NOT NULL AND d.status IN ('VALID','SUBMITTED','EXPIRED')`).all();

  for (const d of docs) {
    const exp = new Date(d.expiry_date);
    const daysToExpiry = Math.floor((exp - new Date(today)) / 86400000);
    const where = `${d.title} — ${d.inst_name} (valid to ${d.expiry_date})`;

    if (daysToExpiry < 0) {
      const over = Math.abs(daysToExpiry);
      const level = over > docCritical ? 2 : 1;
      const audience = level === 2 ? 'BUREAU' : 'REGIONAL';
      if (d.status !== 'EXPIRED') db.prepare(`UPDATE documents SET status='EXPIRED' WHERE id=?`).run(d.id);
      notify({
        type: 'DOC_EXPIRY', severity: 'CRITICAL', level, audience_role: audience, audience_region_id: d.region_id,
        title: `Document expired: ${d.title}`,
        body: `${where} — expired ${over} day(s) ago; renewed document not submitted. Escalated to ${audience}.`,
        entity_type: 'DOCUMENT', entity_id: d.id,
        dedupe_key: `DOC:${d.id}:${level}:${dayStamp(today)}`,
      });
      created.doc++;
    } else if (daysToExpiry <= docRemind && d.status !== 'SUBMITTED') {
      notify({
        type: 'DOC_EXPIRY', severity: daysToExpiry <= docCritical ? 'CRITICAL' : 'WARNING', level: 0,
        audience_role: 'INSTITUTION', audience_region_id: d.region_id,
        title: `${d.title} expires in ${daysToExpiry} day(s)`,
        body: `${where} — submit renewed document before expiry to avoid escalation.`,
        entity_type: 'DOCUMENT', entity_id: d.id,
        dedupe_key: `DOC:${d.id}:0:${dayStamp(today)}`,
      });
      created.doc++;
    }
  }

  return created;
}

function stageName(code) {
  return { SCRUTINY: 'Scrutiny / Re-scrutiny', EVC: 'Expert Visit Committee (EVC)', SAC: 'SAC / SHC Consideration' }[code] || code;
}

export function startAlertScheduler(intervalSeconds = 60) {
  runAlertEngine();
  const t = setInterval(() => {
    try { runAlertEngine(); } catch (e) { console.error('[alerts] engine error:', e.message); }
  }, intervalSeconds * 1000);
  t.unref?.();
  return t;
}
