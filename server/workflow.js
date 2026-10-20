import { db, nowIso, addDays, numRule, logAudit } from './db.js';

// APH-prescribed route combinations
export const ROUTES = {
  ONLY_SCRUTINY: {
    name: 'Only Scrutiny',
    stages: ['SCRUTINY'],
    description: 'Applications processed through scrutiny only, as prescribed under the APH.',
  },
  SCRUTINY_EVC: {
    name: 'Scrutiny + EVC',
    stages: ['SCRUTINY', 'EVC'],
    description: 'Scrutiny followed by Expert Visit Committee inspection.',
  },
  SCRUTINY_EVC_SAC: {
    name: 'Scrutiny + EVC + SAC/SHC',
    stages: ['SCRUTINY', 'EVC', 'SAC'],
    description: 'Scrutiny, EVC inspection and SAC/SHC consideration.',
  },
  EVC_SAC: {
    name: 'EVC + SAC/SHC',
    stages: ['EVC', 'SAC'],
    description: 'Expert Visit Committee inspection followed by SAC/SHC consideration.',
  },
  ONLY_EVC: {
    name: 'Only EVC',
    stages: ['EVC'],
    description: 'Applications requiring only Expert Visit Committee processing.',
  },
};

export const STAGE_META = {
  SCRUTINY: {
    name: 'Scrutiny / Re-scrutiny',
    timeline_days: 15,
    owner_role: 'REGIONAL',
    description: 'Scrutiny of application particulars and documents; re-scrutiny where deficiencies are observed.',
  },
  EVC: {
    name: 'Expert Visit Committee (EVC)',
    timeline_days: 30,
    owner_role: 'EVC',
    description: 'Scheduling and conduct of Expert Visit Committee inspection of the institution.',
  },
  SAC: {
    name: 'SAC / SHC Consideration',
    timeline_days: 21,
    owner_role: 'BUREAU',
    description: 'Consideration of the case before the Standing Advisory Committee / Standing Honorary Committee.',
  },
};

const STAGE_ROLE_RANK = {
  ADMIN: ['SCRUTINY', 'EVC', 'SAC'],
  REGIONAL: ['SCRUTINY'],
  BUREAU: ['SCRUTINY', 'SAC'],
  EVC: ['EVC'],
  INSTITUTION: [],
};

export function canActOnStage(role, stageCode) {
  return (STAGE_ROLE_RANK[role] || []).includes(stageCode);
}

function stageDue(startedAt, stageCode) {
  const days = numRule(`timeline_${stageCode.toLowerCase()}`, STAGE_META[stageCode].timeline_days);
  return addDays(startedAt, days);
}

export function createApplication({ title, appl_type, route_code, institution_id, actor, submitted_at = nowIso() }) {
  const route = ROUTES[route_code];
  if (!route) throw badRequest(`Unknown route: ${route_code}`);
  const inst = db.prepare('SELECT * FROM institutions WHERE id = ?').get(institution_id);
  if (!inst) throw badRequest('Unknown institution');

  const seqCount = db.prepare('SELECT COUNT(*) c FROM applications').get().c;
  const application_no = `APP/${new Date(submitted_at).getFullYear()}/${String(seqCount + 1).padStart(4, '0')}`;
  const firstStage = route.stages[0];

  const info = db.prepare(`INSERT INTO applications
      (application_no, title, appl_type, route_code, institution_id, region_id, status, current_seq, current_stage, submitted_at, created_at)
      VALUES (?,?,?,?,?,?, 'IN_PROCESS', 1, ?, ?, ?)`)
    .run(application_no, title, appl_type, route_code, institution_id, inst.region_id, firstStage, submitted_at, nowIso());
  const appId = info.lastInsertRowid;

  const insStage = db.prepare(`INSERT INTO application_stages (app_id, seq, stage_code, status, started_at, due_at)
                               VALUES (?,?,?,?,?,?)`);
  route.stages.forEach((code, i) => {
    if (i === 0) {
      insStage.run(appId, 1, code, 'ACTIVE', submitted_at, stageDue(submitted_at, code));
    } else {
      insStage.run(appId, i + 1, code, 'PENDING', null, null);
    }
  });

  logAudit({
    app_id: appId, entity_type: 'APPLICATION', entity_id: appId, actor,
    action: 'APPLICATION_CREATED',
    detail: `Routed via "${route.name}" (${route_code}) to ${STAGE_META[firstStage].name}`,
  });
  return appId;
}

export function advanceStage(appId, actor, observations = null) {
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
  if (!app) throw badRequest('Application not found');
  if (app.status !== 'IN_PROCESS') throw badRequest(`Application is ${app.status}; cannot advance.`);
  const stage = db.prepare(`SELECT * FROM application_stages WHERE app_id = ? AND seq = ?
                            ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'RETURNED' THEN 1 ELSE 2 END, id DESC
                            LIMIT 1`).get(appId, app.current_seq);
  if (!stage || stage.status !== 'ACTIVE') throw badRequest('No active stage to complete');
  if (!canActOnStage(actor.role, stage.stage_code)) {
    throw forbidden(`Role ${actor.role} is not authorised to complete ${STAGE_META[stage.stage_code].name}`);
  }

  const completedAt = nowIso();
  db.prepare(`UPDATE application_stages SET status='DONE', completed_at=?, observations=? WHERE id=?`)
    .run(completedAt, observations, stage.id);

  const route = ROUTES[app.route_code];
  const nextSeq = app.current_seq + 1;
  let detail;
  if (nextSeq <= route.stages.length) {
    const nextCode = route.stages[nextSeq - 1];
    const existing = db.prepare('SELECT id FROM application_stages WHERE app_id = ? AND seq = ?').get(appId, nextSeq);
    if (existing) {
      db.prepare(`UPDATE application_stages SET status='ACTIVE', started_at=?, due_at=?, completed_at=NULL WHERE id=?`)
        .run(completedAt, stageDue(completedAt, nextCode), existing.id);
    } else {
      db.prepare(`INSERT INTO application_stages (app_id, seq, stage_code, status, started_at, due_at)
                  VALUES (?,?,?,?,?,?)`)
        .run(appId, nextSeq, nextCode, 'ACTIVE', completedAt, stageDue(completedAt, nextCode));
    }
    db.prepare(`UPDATE applications SET current_seq=?, current_stage=?, updated_at=? WHERE id=?`)
      .run(nextSeq, nextCode, completedAt, appId);
    detail = `${STAGE_META[stage.stage_code].name} completed → moved to ${STAGE_META[nextCode].name}`;
  } else {
    db.prepare(`UPDATE applications SET status='COMPLETED', completed_at=?, updated_at=? WHERE id=?`)
      .run(completedAt, completedAt, appId);
    detail = `${STAGE_META[stage.stage_code].name} completed → all prescribed stages done, case processed`;
  }

  logAudit({ app_id: appId, entity_type: 'APPLICATION', entity_id: appId, actor,
    action: 'STAGE_COMPLETED', detail });
  return { detail };
}

export function returnToInstitution(appId, actor, reason) {
  if (!reason?.trim()) throw badRequest('Reason is mandatory for return/revert');
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
  if (!app) throw badRequest('Application not found');
  if (app.status !== 'IN_PROCESS') throw badRequest(`Application is ${app.status}; cannot return.`);
  const stage = db.prepare(`SELECT * FROM application_stages WHERE app_id = ? AND seq = ?
                            ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'RETURNED' THEN 1 ELSE 2 END, id DESC
                            LIMIT 1`).get(appId, app.current_seq);
  if (!canActOnStage(actor.role, stage.stage_code)) {
    throw forbidden(`Role ${actor.role} is not authorised at ${STAGE_META[stage.stage_code].name}`);
  }
  const ts = nowIso();
  db.prepare(`UPDATE application_stages SET status='RETURNED', return_reason=? WHERE id=?`).run(reason, stage.id);
  db.prepare(`UPDATE applications SET status='RETURNED', updated_at=? WHERE id=?`).run(ts, appId);
  logAudit({ app_id: appId, entity_type: 'APPLICATION', entity_id: appId, actor,
    action: 'RETURNED_TO_INSTITUTION', detail: reason });
  return { detail: 'Returned to institution for clarification/deficiency removal' };
}

export function submitClarification(appId, actor, note) {
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
  if (!app) throw badRequest('Application not found');
  if (app.status !== 'RETURNED') throw badRequest('Application is not returned to the institution');
  if (actor.role !== 'INSTITUTION' && actor.role !== 'ADMIN') throw forbidden('Only the institution may submit clarifications');
  if (actor.role === 'INSTITUTION' && actor.institution_id !== app.institution_id) throw forbidden('Not your institution\'s application');
  if (!note?.trim()) throw badRequest('Clarification note is mandatory');

  const stage = db.prepare(`SELECT * FROM application_stages WHERE app_id = ? AND seq = ?
                            ORDER BY CASE status WHEN 'RETURNED' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END, id DESC
                            LIMIT 1`).get(appId, app.current_seq);
  if (!stage || stage.status !== 'RETURNED') throw badRequest('Current stage is not returned');
  const ts = nowIso();
  db.prepare(`UPDATE application_stages SET status='ACTIVE', started_at=?, due_at=?, return_reason=NULL WHERE id=?`)
    .run(ts, stageDue(ts, stage.stage_code), stage.id);
  db.prepare(`UPDATE applications SET status='IN_PROCESS', updated_at=? WHERE id=?`).run(ts, appId);
  logAudit({ app_id: appId, entity_type: 'APPLICATION', entity_id: appId, actor,
    action: 'CLARIFICATION_SUBMITTED', detail: note });
  return { detail: 'Clarification submitted; case resumed at the same stage' };
}

export function revertToPrevious(appId, actor, reason) {
  if (!reason?.trim()) throw badRequest('Reason is mandatory for return/revert');
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
  if (!app) throw badRequest('Application not found');
  if (app.status !== 'IN_PROCESS') throw badRequest(`Application is ${app.status}; cannot revert.`);
  if (app.current_seq <= 1) throw badRequest('No previous stage to revert to');
  if (actor.role !== 'ADMIN' && actor.role !== 'BUREAU') throw forbidden('Revert to previous stage requires Bureau/Admin authority');

  const ts = nowIso();
  const cur = db.prepare('SELECT * FROM application_stages WHERE app_id = ? AND seq = ?').get(appId, app.current_seq);
  const prev = db.prepare('SELECT * FROM application_stages WHERE app_id = ? AND seq = ?').get(appId, app.current_seq - 1);
  db.prepare(`UPDATE application_stages SET status='PENDING', started_at=NULL, due_at=NULL, completed_at=NULL, observations=NULL WHERE id=?`).run(cur.id);
  db.prepare(`UPDATE application_stages SET status='ACTIVE', started_at=?, due_at=?, completed_at=NULL WHERE id=?`)
    .run(ts, stageDue(ts, prev.stage_code), prev.id);
  db.prepare(`UPDATE applications SET current_seq=?, current_stage=?, updated_at=? WHERE id=?`)
    .run(prev.seq, prev.stage_code, ts, appId);
  logAudit({ app_id: appId, entity_type: 'APPLICATION', entity_id: appId, actor,
    action: 'REVERTED_TO_PREVIOUS', detail: `${STAGE_META[cur.stage_code].name} → ${STAGE_META[prev.stage_code].name}: ${reason}` });
  return { detail: 'Reverted to previous stage' };
}

export function assignStage(appId, officerId, actor) {
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
  if (!app) throw badRequest('Application not found');
  const officer = db.prepare('SELECT * FROM users WHERE id = ?').get(officerId);
  if (!officer) throw badRequest('Officer not found');
  if (officer.role === 'INSTITUTION') throw badRequest('Cannot assign to an institution user');
  db.prepare('UPDATE applications SET assigned_to=?, updated_at=? WHERE id=?').run(officerId, nowIso(), appId);
  db.prepare('UPDATE application_stages SET officer_id=? WHERE app_id=? AND seq=? AND status IN (\'ACTIVE\',\'RETURNED\')')
    .run(officerId, appId, app.current_seq);
  logAudit({ app_id: appId, entity_type: 'APPLICATION', entity_id: appId, actor,
    action: 'ASSIGNED', detail: `Assigned to ${officer.name} (${officer.role})` });
  return { detail: `Assigned to ${officer.name}` };
}

export function scheduleEVC(appId, { visit_date, committee, notes }, actor) {
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
  if (!app) throw badRequest('Application not found');
  if (app.current_stage !== 'EVC') throw badRequest('Application is not at the EVC stage');
  const stage = db.prepare('SELECT * FROM application_stages WHERE app_id=? AND seq=?').get(appId, app.current_seq);
  db.prepare(`INSERT INTO evc_schedules (app_id, stage_id, visit_date, committee, notes, created_at)
              VALUES (?,?,?,?,?,?)`)
    .run(appId, stage.id, visit_date, committee, notes ?? null, nowIso());
  logAudit({ app_id: appId, entity_type: 'APPLICATION', entity_id: appId, actor,
    action: 'EVC_SCHEDULED', detail: `Visit on ${visit_date} — ${committee}` });
  return { detail: 'EVC visit scheduled' };
}

function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }
function forbidden(msg) { const e = new Error(msg); e.status = 403; return e; }
