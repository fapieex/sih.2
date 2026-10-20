import { db, nowIso, addDays, logAudit } from './db.js';
import { ROUTES, STAGE_META } from './workflow.js';
import { runAlertEngine } from './alerts.js';

// deterministic PRNG for reproducible seed data
let _s = 20261019;
function rnd() { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const daysAgo = (n) => addDays(nowIso(), -n);
const daysAhead = (n) => addDays(nowIso(), n);
const d = (iso) => iso.slice(0, 10);

export function seed() {
  const wipe = process.argv.includes('--fresh') || !process.argv.includes('--append');
  if (wipe) {
    for (const t of ['notifications', 'evc_schedules', 'audit_log', 'application_stages',
      'undertakings', 'documents', 'applications', 'users', 'institutions', 'routes', 'stages', 'rules', 'regions']) {
      db.exec(`DELETE FROM ${t}`);
    }
    const seq = db.prepare(`SELECT name FROM sqlite_master WHERE name='sqlite_sequence'`).get();
    if (seq) db.exec(`DELETE FROM sqlite_sequence`);
  }

  // ---- Regions ----
  const regions = [
    ['NR', 'Northern Region'], ['WR', 'Western Region'], ['SR', 'Southern Region'],
    ['ER', 'Eastern Region'], ['CR', 'Central Region'],
  ].map(([code, name], i) => { db.prepare('INSERT INTO regions (id, code, name) VALUES (?,?,?)').run(i + 1, code, name); return { id: i + 1, code, name }; });

  // ---- Stages & routes ----
  const insStage = db.prepare('INSERT INTO stages (code, name, timeline_days, owner_role, description) VALUES (?,?,?,?,?)');
  for (const [code, m] of Object.entries(STAGE_META)) insStage.run(code, m.name, m.timeline_days, m.owner_role, m.description);
  const insRoute = db.prepare('INSERT INTO routes (code, name, stage_seq, description) VALUES (?,?,?,?)');
  for (const [code, r] of Object.entries(ROUTES)) insRoute.run(code, r.name, JSON.stringify(r.stages), r.description);

  // ---- Configurable APH rules ----
  const rules = [
    ['remind_before_days', 'Alert before stage timeline (days)', 'Pendency', '7'],
    ['escalation_level2_days', 'Escalate to Regional officer after (days overdue)', 'Escalation', '7'],
    ['escalation_level3_days', 'Escalate to Bureau after (days overdue)', 'Escalation', '15'],
    ['evc_reminder_days', 'EVC reminder window (days before due)', 'EVC', '10'],
    ['undertaking_reminder_days', 'Undertaking reminder window (days before due)', 'Undertakings', '10'],
    ['undertaking_escalation_days', 'Escalate unfulfilled undertaking after (days overdue)', 'Undertakings', '7'],
    ['doc_expiry_reminder_days', 'Document expiry reminder window (days)', 'Documents', '30'],
    ['doc_expiry_critical_days', 'Document expiry critical window (days)', 'Documents', '7'],
    ['timeline_scrutiny', 'Scrutiny / Re-scrutiny timeline (days)', 'Stage timelines', '15'],
    ['timeline_evc', 'EVC stage timeline (days)', 'Stage timelines', '30'],
    ['timeline_sac', 'SAC / SHC stage timeline (days)', 'Stage timelines', '21'],
    ['alert_refresh_seconds', 'Alert engine refresh (seconds)', 'System', '60'],
  ];
  const insRule = db.prepare('INSERT INTO rules (key, label, grp, value) VALUES (?,?,?,?)');
  rules.forEach(([k, l, g, v]) => insRule.run(k, l, g, v));

  // ---- Institutions ----
  const instNames = [
    ['Sri Venkateswara Institute of Technology', 'Engineering', 'NR'],
    ['Bharati Vidya Polytechnic', 'Polytechnic', 'NR'],
    ['North Indian School of Management', 'Management', 'NR'],
    ['Rajiv Gandhi College of Pharmacy', 'Pharmacy', 'NR'],
    ['Kaveri Institute of Engineering & Technology', 'Engineering', 'SR'],
    ['Chaitanya College of Management Studies', 'Management', 'SR'],
    ['Southern Polytechnic College', 'Polytechnic', 'SR'],
    ['Amrita College of Pharmacy', 'Pharmacy', 'SR'],
    ['Konkan Institute of Technology', 'Engineering', 'WR'],
    ['Maharashtra School of Business', 'Management', 'WR'],
    ['Sahyadri Polytechnic', 'Polytechnic', 'WR'],
    ['Gujarat College of Pharmaceutical Education', 'Pharmacy', 'WR'],
    ['Ganga Institute of Engineering', 'Engineering', 'ER'],
    ['Sundarban College of Management', 'Management', 'ER'],
    ['Bengal Polytechnic Institute', 'Polytechnic', 'ER'],
    ['Bihar College of Pharmacy', 'Pharmacy', 'ER'],
    ['Narmada Institute of Technology', 'Engineering', 'CR'],
    ['Kanpur Polytechnic & Vocational College', 'Polytechnic', 'CR'],
  ];
  const insInst = db.prepare('INSERT INTO institutions (id, name, region_id, city, inst_type) VALUES (?,?,?,?,?)');
  const cities = { NR: ['New Delhi', 'Jaipur', 'Lucknow', 'Chandigarh'], WR: ['Mumbai', 'Pune', 'Ahmedabad', 'Nagpur'], SR: ['Chennai', 'Bengaluru', 'Hyderabad', 'Coimbatore'], ER: ['Kolkata', 'Patna', 'Bhubaneswar', 'Guwahati'], CR: ['Bhopal', 'Indore', 'Kanpur', 'Raipur'] };
  const institutions = instNames.map(([name, type, rcode], i) => {
    const region = regions.find(r => r.code === rcode);
    const city = pick(cities[rcode]);
    const id = i + 1;
    insInst.run(id, name, region.id, city, type);
    return { id, name, region_id: region.id, region_code: rcode, city, type };
  });

  // ---- Users ----
  const PW = 'demo123';
  const insUser = db.prepare('INSERT INTO users (id, name, email, password, role, designation, region_id, institution_id) VALUES (?,?,?,?,?,?,?,?)');
  const users = [];
  let uid = 0;
  const mk = (name, email, role, designation, region_id = null, institution_id = null) => {
    uid += 1; insUser.run(uid, name, email, PW, role, designation, region_id, institution_id);
    const u = { id: uid, name, email, role, designation, region_id, institution_id, password: PW };
    users.push(u); return u;
  };
  mk('AICTE Administrator', 'admin@aicte.ac.in', 'ADMIN', 'System Administrator');
  regions.forEach((r, i) => mk(`Regional Officer ${r.code}`, `ro.${r.code.toLowerCase()}@aicte.ac.in`, 'REGIONAL', 'Regional Officer', r.id));
  mk('Dr. Anil Sharma', 'bureau1@aicte.ac.in', 'BUREAU', 'Deputy Director (Bureau)');
  mk('Dr. Meera Iyer', 'bureau2@aicte.ac.in', 'BUREAU', 'Joint Director (Bureau)');
  mk('Prof. R. Krishnan', 'evc1@aicte.ac.in', 'EVC', 'EVC Committee Member');
  mk('Prof. Sunita Rao', 'evc2@aicte.ac.in', 'EVC', 'EVC Committee Member');
  mk('Prof. D. Kulkarni', 'evc3@aicte.ac.in', 'EVC', 'EVC Committee Chairperson');
  institutions.forEach((inst, i) =>
    mk(`Nodal Officer — ${inst.name.split(' ').slice(0, 2).join(' ')}`, `inst${inst.id}@example.edu`, 'INSTITUTION', 'Nodal Officer', inst.region_id, inst.id));

  const usersBy = (role, regionId = null) => users.filter(u => u.role === role && (regionId == null || u.region_id === regionId));
  const bureau = usersBy('BUREAU');
  const evcs = usersBy('EVC');

  // ---- Applications ----
  const insApp = db.prepare(`INSERT INTO applications
    (application_no, title, appl_type, route_code, institution_id, region_id, status, current_seq, current_stage, assigned_to, submitted_at, completed_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insAppStage = db.prepare(`INSERT INTO application_stages
    (app_id, seq, stage_code, status, officer_id, started_at, due_at, completed_at, observations, return_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  const applTypes = ['Grant of Approval', 'Extension of Approval', 'Renewal of Approval', 'Variation in Intake'];
  const routeBag = ['ONLY_SCRUTINY', 'ONLY_SCRUTINY', 'ONLY_SCRUTINY', 'ONLY_SCRUTINY', 'SCRUTINY_EVC', 'SCRUTINY_EVC', 'SCRUTINY_EVC', 'SCRUTINY_EVC_SAC', 'SCRUTINY_EVC_SAC', 'EVC_SAC', 'ONLY_EVC', 'ONLY_EVC'];
  const apps = [];
  let appNo = 0;
  const T = { SCRUTINY: 15, EVC: 30, SAC: 21 };

  for (let n = 0; n < 46; n++) {
    const inst = pick(institutions);
    const route = pick(routeBag);
    const stages = ROUTES[route].stages;
    appNo += 1;
    const submittedDaysAgo = ri(4, 140);
    const submitted = daysAgo(submittedDaysAgo);
    const appl_type = pick(applTypes);
    const statusRoll = rnd();
    let status = 'IN_PROCESS';
    if (statusRoll > 0.80) status = 'COMPLETED';
    else if (statusRoll > 0.74) status = 'RETURNED';

    let currentSeq = 1;
    if (status === 'COMPLETED') currentSeq = stages.length;
    else if (status === 'RETURNED') currentSeq = ri(1, stages.length);
    else currentSeq = ri(1, stages.length); // in-process somewhere along the route

    // For in-process, ensure there is enough elapsed time for prior stages
    const appId = apps.length ? apps[apps.length - 1].id + 1000 : 0; // placeholder, replaced below
    const application_no = `APP/${new Date(submitted).getFullYear()}/${String(appNo).padStart(4, '0')}`;
    const title = `${appl_type} — ${inst.name}`;
    const info = insApp.run(application_no, title, appl_type, route, inst.id, inst.region_id, status,
      currentSeq, stages[currentSeq - 1], null, submitted, status === 'COMPLETED' ? daysAgo(ri(1, 30)) : null, submitted);
    const id = Number(info.lastInsertRowid);

    // build stage rows
    let cursor = new Date(submitted);
    const officerFor = (code) => code === 'EVC' ? pick(evcs) : code === 'SAC' ? pick(bureau) : (usersBy('REGIONAL', inst.region_id)[0] || usersBy('REGIONAL')[0]);
    const built = [];
    stages.forEach((code, idx) => {
      const seq = idx + 1;
      const dur = ri(2, T[code]);
      const started = new Date(cursor);
      if (seq < currentSeq || (status === 'COMPLETED')) {
        const done = new Date(started.getTime() + dur * 86400000);
        const off = officerFor(code);
        insAppStage.run(id, seq, code, 'DONE', off.id, started.toISOString(), addDays(started.toISOString(), T[code]), done.toISOString(),
          `Observations recorded at ${STAGE_META[code].name}. Documents verified as per APH checklist.`, null);
        built.push({ seq, code, status: 'DONE' });
        cursor = done;
      } else if (seq === currentSeq) {
        const off = officerFor(code);
        if (status === 'RETURNED') {
          insAppStage.run(id, seq, code, 'RETURNED', off.id, started.toISOString(), addDays(started.toISOString(), T[code]), null, null,
            pick(['AICTE form deficiencies noted — approved land records not attached.',
                  'Faculty constitutions incomplete; clarification sought under APH.',
                  'Undertaking towards closure of deficiency not furnished.']));
          built.push({ seq, code, status: 'RETURNED' });
        } else if (status === 'COMPLETED') {
          const done = new Date(started.getTime() + dur * 86400000);
          insAppStage.run(id, seq, code, 'DONE', off.id, started.toISOString(), addDays(started.toISOString(), T[code]), done.toISOString(), 'Approved with conditions.', null);
          built.push({ seq, code, status: 'DONE' });
          cursor = done;
        } else {
          // ACTIVE: sometimes started well before today to produce pendency / overdue,
          // but never before the preceding stage completed
          const startedDaysAgo = ri(0, T[code] + 12);
          const candidate = new Date(daysAgo(startedDaysAgo));
          const st = (candidate > cursor ? candidate : cursor).toISOString();
          insAppStage.run(id, seq, code, 'ACTIVE', off.id, st, addDays(st, T[code]), null, null, null);
          built.push({ seq, code, status: 'ACTIVE' });
          cursor = new Date(st);
        }
      } else {
        insAppStage.run(id, seq, code, 'PENDING', null, null, null, null, null, null);
        built.push({ seq, code, status: 'PENDING' });
      }
    });

    db.prepare('UPDATE applications SET assigned_to=? WHERE id=?').run(
      built.find(b => b.status === 'ACTIVE' || b.status === 'RETURNED') ? officerFor(built.find(b => b.status === 'ACTIVE' || b.status === 'RETURNED').code).id : null, id);

    // EVC schedule for some EVC-touching apps
    if (stages.includes('EVC')) {
      const evcSeq = stages.indexOf('EVC') + 1;
      const evcRow = built.find(b => b.seq === evcSeq);
      if (evcRow && evcRow.status !== 'PENDING' && rnd() > 0.35) {
        db.prepare(`INSERT INTO evc_schedules (app_id, stage_id, visit_date, committee, status, created_at)
                    SELECT ?, id, ?, ?, ?, ? FROM application_stages WHERE app_id=? AND seq=?`)
          .run(id, daysAhead(ri(-12, 18)), `EVC — ${pick(['North', 'South', 'East', 'West', 'Central'])} Team (${pick(evcs).name})`,
            evcRow.status === 'ACTIVE' ? 'SCHEDULED' : 'COMPLETED', nowIso(), id, evcSeq);
      }
    }

    apps.push({ id, application_no, inst, route, status, currentSeq, submitted });
    logAudit({ app_id: id, entity_type: 'APPLICATION', entity_id: id, actor: usersBy('REGIONAL', inst.region_id)[0],
      action: 'APPLICATION_CREATED', detail: `Routed via ${ROUTES[route].name}`, created_at_override: submitted });
  }

  // ---- Undertakings ----
  const insUnd = db.prepare(`INSERT INTO undertakings
    (app_id, institution_id, title, condition_text, due_date, status, submitted_at, file_name, verified_by, verified_at, remarks)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const undSpecs = [
    ['Time-bound closure of deficiency — land/ building', 'Institution undertakes to furnish complete land records within the stipulated period.'],
    ['Extension of Approval undertaking — fee & compliance', 'Undertaking to pay prescribed fees and comply with inspection observations within the given timeline.'],
    ['Fire & safety NOC compliance undertaking', 'Undertaking to obtain Fire & Safety NOC and upload evidence before the next academic session.'],
    ['Faculty retention undertaking', 'Undertaking to maintain prescribed faculty strength and upload AICTE-formatted faculty details.'],
    ['Anti-ragging & internal committee undertaking', 'Undertaking to constitute anti-ragging and internal complaint committees and notify AICTE.'],
    ['Pay-disbursement undertaking (staff dues)', 'Undertaking to clear all statutory dues and submit proof to the Regional Office.'],
  ];
  const engagedApps = apps.filter(a => a.status !== 'COMPLETED');
  let undId = 0;
  for (const a of engagedApps) {
    if (rnd() > 0.55) continue;
    const [title, cond] = pick(undSpecs);
    undId += 1;
    const roll = rnd();
    let status = 'PENDING', submitted_at = null, file = null, verified_by = null, verified_at = null, remarks = null;
    const offset = ri(-18, 55); // negative = overdue
    if (roll > 0.78) {
      status = 'VERIFIED'; submitted_at = daysAgo(Math.max(1, -offset + 3)); file = `undertaking_${undId}.pdf`;
      verified_by = pick(usersBy('REGIONAL', a.inst.region_id)).id; verified_at = daysAgo(Math.max(0, -offset)); remarks = 'Verified — accepted.';
    } else if (roll > 0.62) {
      status = 'SUBMITTED'; submitted_at = daysAgo(ri(1, 12)); file = `undertaking_${undId}.pdf`;
    }
    insUnd.run(a.id, a.inst.id, title, cond, d(daysAhead(offset)), status, submitted_at, file, verified_by, verified_at, remarks);
  }

  // ---- Documents (lease + others) ----
  const insDoc = db.prepare(`INSERT INTO documents
    (institution_id, app_id, doc_type, title, file_name, issued_on, expiry_date, status, submitted_at, verified_by, verified_at, remarks)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const inst of institutions) {
    // Lease deed — spread expiries: expired, imminent, and healthy
    const roll = rnd();
    let expOffset;
    if (roll > 0.78) expOffset = ri(-45, -1);         // already expired
    else if (roll > 0.55) expOffset = ri(1, 30);      // expiring within reminder window
    else expOffset = ri(60, 900);                     // healthy
    const issued = daysAgo(ri(300, 1500));
    const expired = expOffset < 0;
    insDoc.run(inst.id, null, 'LEASE', 'Lease Deed / Rent Agreement', `lease_${inst.id}.pdf`,
      d(issued), d(daysAhead(expOffset)), expired ? 'EXPIRED' : 'VALID', null, null, null,
      expired ? 'Renewal not received.' : null);

    // Affidavit / other document with validity
    if (rnd() > 0.35) {
      const off2 = rnd() > 0.7 ? ri(-20, 25) : ri(120, 700);
      insDoc.run(inst.id, null, 'AFFIDAVIT', 'Affidavit of Undertaking (non-encumbrance)', `affidavit_${inst.id}.pdf`,
        d(daysAgo(ri(200, 900))), d(daysAhead(off2)), off2 < 0 ? 'EXPIRED' : 'VALID', null, null, null, null);
    }
    // Submitted renewal awaiting verification for a couple of expired leases
    if (expired && rnd() > 0.6) {
      insDoc.run(inst.id, null, 'LEASE', 'Renewed Lease Deed (submitted)', `lease_renewal_${inst.id}.pdf`,
        d(daysAgo(ri(1, 10))), d(daysAhead(ri(300, 1000))), 'SUBMITTED', daysAgo(ri(1, 8)), null, null, null);
    }
  }

  // ---- Initial audit entries for compliance records ----
  for (const u of db.prepare('SELECT u.*, i.name n FROM undertakings u JOIN institutions i ON i.id=u.institution_id').all()) {
    logAudit({ app_id: u.app_id, entity_type: 'UNDERTAKING', entity_id: u.id, actor: usersBy('BUREAU')[0],
      action: 'UNDERTAKING_PRESCRIBED', detail: `${u.title} (due ${u.due_date})` });
  }
  for (const doc of db.prepare('SELECT * FROM documents').all()) {
    logAudit({ entity_type: 'DOCUMENT', entity_id: doc.id, actor: usersBy('REGIONAL')[0],
      action: 'DOCUMENT_RECORDED', detail: `${doc.title} valid to ${doc.expiry_date ?? 'n/a'}` });
  }

  // ---- Fire the alert engine to populate notifications ----
  const alerts = runAlertEngine();

  const counts = {};
  for (const t of ['regions', 'institutions', 'users', 'applications', 'application_stages', 'undertakings', 'documents', 'evc_schedules', 'notifications', 'audit_log'])
    counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

  console.log('Seed complete:', counts, 'alerts generated:', alerts);
  return counts;
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) seed();
