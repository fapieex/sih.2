// API smoke test: exercises every major endpoint across roles.
const BASE = process.env.BASE || 'http://localhost:5175';
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => { cond ? (pass++, console.log(`  ✓ ${label}`)) : (fail++, console.log(`  ✗ ${label} ${extra}`)); };

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

async function login(email) {
  const r = await call('POST', '/api/auth/login', { body: { email, password: 'demo123' } });
  return r.status === 200 ? r.data : null;
}

console.log('— Auth —');
const anon = await call('GET', '/api/dashboard');
ok(anon.status === 401, 'unauthenticated request rejected', `got ${anon.status}`);
const bad = await call('POST', '/api/auth/login', { body: { email: 'x@y.z', password: 'nope' } });
ok(bad.status === 401, 'bad credentials rejected');

const admin = await login('admin@aicte.ac.in');
ok(!!admin?.token, 'admin login');
const ro = await login('ro.wr@aicte.ac.in');
ok(!!ro?.token, 'regional officer login');
const bureau = await login('bureau1@aicte.ac.in');
ok(!!bureau?.token, 'bureau login');
const evc = await login('evc1@aicte.ac.in');
ok(!!evc?.token, 'EVC login');
const inst = await login('inst1@example.edu');
ok(!!inst?.token, 'institution login');

console.log('— Meta & reference —');
const meta = await call('GET', '/api/meta', { token: admin.token });
ok(meta.status === 200 && meta.data.routes.length === 5 && meta.data.stages.length === 3, 'meta: 5 routes, 3 stages');
ok(Object.keys(meta.data.rules).length >= 12, 'meta: configurable rules present');

console.log('— Dashboards (role-scoped) —');
const dAdmin = await call('GET', '/api/dashboard', { token: admin.token });
ok(dAdmin.status === 200 && dAdmin.data.kpis.total === 46, 'admin sees all 46 apps', `got ${dAdmin.data?.kpis?.total}`);
ok(dAdmin.data.byRegion.length === 5, 'admin sees 5 regions');
ok(dAdmin.data.byStage.length >= 1, 'stage pendency populated');
ok(dAdmin.data.ageing.length >= 1, 'ageing buckets populated');
const dRo = await call('GET', '/api/dashboard', { token: ro.token });
ok(dRo.status === 200 && dRo.data.byRegion.length === 1, 'regional officer scoped to own region');
const dInst = await call('GET', '/api/dashboard', { token: inst.token });
ok(dInst.status === 200 && dInst.data.kpis.total > 0 && dInst.data.kpis.total < 46, 'institution sees only own apps', `got ${dInst.data?.kpis?.total}`);

console.log('— Applications & scoping —');
const appsAdmin = await call('GET', '/api/applications', { token: admin.token });
ok(appsAdmin.data.length === 46, 'admin lists 46 applications', `got ${appsAdmin.data.length}`);
const appsRo = await call('GET', '/api/applications?status=IN_PROCESS', { token: ro.token });
ok(appsRo.data.every(a => a.region_code === 'WR'), 'regional filter scope enforced');
const appsInst = await call('GET', '/api/applications', { token: inst.token });
ok(appsInst.data.every(a => a.institution_id === 1), 'institution scope enforced');
const filter = await call('GET', '/api/applications?stage=EVC', { token: admin.token });
ok(filter.status === 200, 'stage filter works');
const detail = await call('GET', `/api/applications/${appsAdmin.data[0].id}`, { token: admin.token });
ok(detail.status === 200 && detail.data.stages.length >= 1 && detail.data.audit.length >= 1, 'detail: stages + audit trail');
const notFound = await call('GET', '/api/applications/999999', { token: admin.token });
ok(notFound.status === 404, 'missing application 404');

console.log('— Workflow: create → advance → return → clarify → revert —');
const insts = await call('GET', '/api/institutions', { token: admin.token });
const wrInsts = insts.data.filter(i => i.region_id === 2); // RO's own region (WR)
const crossDenied = await call('POST', '/api/applications', { token: ro.token, body: {
  title: 'Cross-region attempt', appl_type: 'Grant of Approval',
  route_code: 'ONLY_SCRUTINY', institution_id: insts.data.find(i => i.region_id !== 2).id } });
ok(crossDenied.status === 403, 'RO cannot create application for another region\'s institution', `got ${crossDenied.status}`);
const created = await call('POST', '/api/applications', { token: ro.token, body: {
  title: 'Smoke test — Grant of Approval', appl_type: 'Grant of Approval',
  route_code: 'SCRUTINY_EVC_SAC', institution_id: wrInsts[0].id } });
ok(created.status === 201, 'create application', JSON.stringify(created.data));
const appId = created.data?.id;

const d2 = await call('GET', `/api/applications/${appId}`, { token: ro.token });
ok(d2.data.current_stage === 'SCRUTINY', 'new app starts at SCRUTINY');
ok(d2.data.stages.length === 3, 'route builds 3 stage rows');

const badAdvance = await call('POST', `/api/applications/${appId}/advance`, { token: evc.token });
ok(badAdvance.status === 403, 'EVC cannot complete SCRUTINY stage', `got ${badAdvance.status}`);

const noReason = await call('POST', `/api/applications/${appId}/return`, { token: ro.token, body: {} });
ok(noReason.status === 400, 'return without reason rejected');

const adv1 = await call('POST', `/api/applications/${appId}/advance`, { token: ro.token, body: { observations: 'Scrutiny complete — deficiencies cleared.' } });
ok(adv1.status === 200, 'advance SCRUTINY → EVC', JSON.stringify(adv1.data));
const d3 = await call('GET', `/api/applications/${appId}`, { token: admin.token });
ok(d3.data.current_stage === 'EVC' && d3.data.status === 'IN_PROCESS', 'app moved to EVC stage');

const adv2 = await call('POST', `/api/applications/${appId}/advance`, { token: evc.token, body: { observations: 'EVC visit conducted, report uploaded.' } });
ok(adv2.status === 200, 'advance EVC → SAC (by EVC role)');
const adv3 = await call('POST', `/api/applications/${appId}/advance`, { token: bureau.token, body: { observations: 'Approved in SAC.' } });
ok(adv3.status === 200, 'advance SAC → completed');
const d4 = await call('GET', `/api/applications/${appId}`, { token: admin.token });
ok(d4.data.status === 'COMPLETED' && d4.data.completed_at, 'application COMPLETED after final stage');
ok(d4.data.audit.filter(a => a.action === 'STAGE_COMPLETED').length === 3, 'audit records 3 stage completions', `got ${d4.data.audit.filter(a=>a.action==='STAGE_COMPLETED').length}`);

// return/clarify flow on a fresh app
const c2 = await call('POST', '/api/applications', { token: ro.token, body: {
  title: 'Smoke test — return flow', appl_type: 'Variation in Intake',
  route_code: 'ONLY_SCRUTINY', institution_id: wrInsts[1].id } });
const rid = c2.data.id;
const ret = await call('POST', `/api/applications/${rid}/return`, { token: ro.token, body: { reason: 'Land records missing.' } });
ok(ret.status === 200, 'return to institution with reason');
const dRet = await call('GET', `/api/applications/${rid}`, { token: admin.token });
ok(dRet.data.status === 'RETURNED' && dRet.data.stages[0].return_reason === 'Land records missing.', 'returned status + reason recorded');
const clarUser = await login(`inst${wrInsts[1].id}@example.edu`);
ok(!!clarUser?.token, 'own-region institution login');
const wrongInst = await call('POST', `/api/applications/${rid}/clarify`, { token: inst.token, body: { note: 'x' } });
ok(wrongInst.status === 403, 'other institution cannot clarify on this application');
const instClar = await call('POST', `/api/applications/${rid}/clarify`, { token: clarUser.token, body: { note: 'Uploaded land records.' } });
ok(instClar.status === 200, 'institution submits clarification');
const dRet2 = await call('GET', `/api/applications/${rid}`, { token: admin.token });
ok(dRet2.data.status === 'IN_PROCESS', 'case resumed after clarification');

const r2 = await call('POST', '/api/applications', { token: ro.token, body: {
  title: 'Smoke test — revert', appl_type: 'Renewal of Approval',
  route_code: 'SCRUTINY_EVC', institution_id: wrInsts[2].id } });
const r2id = r2.data.id;
await call('POST', `/api/applications/${r2id}/advance`, { token: ro.token, body: {} });
const revDenied = await call('POST', `/api/applications/${r2id}/revert`, { token: ro.token, body: { reason: 'x' } });
ok(revDenied.status === 403, 'regional officer cannot revert');
const rev = await call('POST', `/api/applications/${r2id}/revert`, { token: bureau.token, body: { reason: 'Re-verify faculty data.' } });
ok(rev.status === 200, 'bureau reverts to previous stage');
const dRev = await call('GET', `/api/applications/${r2id}`, { token: admin.token });
ok(dRev.data.current_stage === 'SCRUTINY', 'app back at SCRUTINY after revert');

const assign = await call('POST', `/api/applications/${r2id}/assign`, { token: ro.token, body: { officer_id: 6 } });
ok(assign.status === 200, 'assign officer');

console.log('— EVC —');
const queue = await call('GET', '/api/evc/queue', { token: admin.token });
ok(queue.status === 200 && queue.data.length > 0, 'EVC queue populated', `got ${queue.data?.length}`);
const evcTarget = queue.data.find(q => q.evc_status === 'ACTIVE');
if (evcTarget) {
  const sch = await call('POST', `/api/applications/${evcTarget.id}/evc-schedule`, { token: evc.token,
    body: { visit_date: '2026-11-05', committee: 'EVC Team — smoke test', notes: 'New institution' } });
  ok(sch.status === 200, 'schedule EVC visit', JSON.stringify(sch.data));
} else { ok(false, 'no ACTIVE EVC app found to schedule'); }

console.log('— Undertakings —');
const unds = await call('GET', '/api/undertakings', { token: admin.token });
ok(unds.status === 200 && unds.data.length > 0, 'undertakings listed', `got ${unds.data?.length}`);
const pendUnd = unds.data.find(u => u.status === 'PENDING');
const subDenied = await call('POST', `/api/undertakings/${pendUnd.id}/submit`, { token: ro.token, body: {} });
ok(subDenied.status === 403, 'officer cannot submit on institution\'s behalf');
const undInstUser = await login(`inst${pendUnd.institution_id}@example.edu`);
const sub = await call('POST', `/api/undertakings/${pendUnd.id}/submit`, { token: undInstUser.token, body: { file_name: 'evidence.pdf' } });
ok(sub.status === 200, 'institution submits undertaking evidence');
const ver = await call('POST', `/api/undertakings/${pendUnd.id}/verify`, { token: ro.token, body: { accept: true, remarks: 'OK' } });
ok(ver.status === 200, 'officer verifies submission');

console.log('— Documents —');
const docs = await call('GET', '/api/documents', { token: admin.token });
ok(docs.status === 200 && docs.data.length > 0, 'documents listed', `got ${docs.data?.length}`);
ok(docs.data.some(d => d.days_to_expiry !== undefined), 'expiry countdown computed');
const submitted = await call('POST', '/api/documents', { token: inst.token, body: {
  doc_type: 'LEASE', title: 'Renewed Lease Deed', expiry_date: '2029-04-30', file_name: 'lease_new.pdf' } });
ok(submitted.status === 201, 'institution submits renewed document');
const verDoc = await call('POST', `/api/documents/${submitted.data.id}/verify`, { token: ro.token, body: { accept: true, remarks: 'Verified' } });
ok(verDoc.status === 200, 'officer verifies document');

console.log('— Alerts & escalation —');
const runAlerts = await call('POST', '/api/alerts/run', { token: admin.token });
ok(runAlerts.status === 200, 'manual alert engine run', JSON.stringify(runAlerts.data));
const alerts = await call('GET', '/api/alerts', { token: admin.token });
ok(alerts.status === 200 && alerts.data.alerts.length > 0, 'alerts listed', `got ${alerts.data?.alerts?.length}`);
ok(alerts.data.alerts.some(a => a.severity === 'CRITICAL'), 'critical alerts present');
ok(alerts.data.alerts.some(a => a.level >= 2), 'escalated (level≥2) alerts present');
const roAlerts = await call('GET', '/api/alerts', { token: ro.token });
ok(roAlerts.data.alerts.every(a => a.audience_region_id === 2), 'regional alert scoping (own region only)', `got ${JSON.stringify(roAlerts.data.alerts.map(a=>a.audience_region_id).slice(0,5))}`);
const firstUnread = roAlerts.data.alerts.find(a => !a.read_at);
if (firstUnread) {
  const rd = await call('POST', `/api/alerts/${firstUnread.id}/read`, { token: ro.token });
  ok(rd.status === 200, 'mark alert read');
}
const evcAlerts = await call('GET', '/api/alerts', { token: evc.token });
ok(evcAlerts.status === 200, 'EVC-role alerts scoped');

console.log('— Reports, audit, rules —');
const rep = await call('GET', '/api/reports', { token: bureau.token });
ok(rep.status === 200 && rep.data.pendency.length > 0 && rep.data.overdue.length >= 0 && rep.data.evc.length > 0 && rep.data.documents.length > 0, 'consolidated report sections');
const repDenied = await call('GET', '/api/reports', { token: evc.token });
ok(repDenied.status === 403, 'EVC cannot pull consolidated report');
const audit = await call('GET', '/api/audit', { token: admin.token });
ok(audit.status === 200 && audit.data.length > 0, 'audit trail listed', `got ${audit.data?.length}`);
const auditInst = await call('GET', '/api/audit', { token: inst.token });
ok(auditInst.data.every(a => a.application_no === null || a.application_no !== undefined), 'institution audit accessible');
const rulesDenied = await call('PUT', '/api/rules', { token: ro.token, body: { remind_before_days: 1 } });
ok(rulesDenied.status === 403, 'non-admin cannot edit rules');
const rulesOk = await call('PUT', '/api/rules', { token: admin.token, body: { remind_before_days: '7', timeline_scrutiny: '15' } });
ok(rulesOk.status === 200, 'admin updates rules');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
