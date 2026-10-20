import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, fmtDate, fmtDateTime } from '../api.js';
import { Card, Spinner, Badge, Modal, Toast, Countdown, Empty } from '../components.jsx';

export default function ApplicationDetail({ user, meta }) {
  const { id } = useParams();
  const [a, setA] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState({ msg: '' });
  const [modal, setModal] = useState(null); // 'return' | 'revert' | 'clarify' | 'assign' | 'evc'
  const navigate = useNavigate();

  const load = useCallback(() => {
    api(`/api/applications/${id}`).then(setA).catch(e => setErr(e.message));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => { if (toast.msg) { const t = setTimeout(() => setToast({}), 100); return () => clearTimeout(t); } }, [toast]);

  if (err) return <div className="card">{err} — <Link to="/applications">back to list</Link></div>;
  if (!a) return <Spinner />;

  const act = async (path, body, okMsg) => {
    try {
      const r = await api(`/api/applications/${id}${path}`, { method: 'POST', body });
      setModal(null);
      load();
      setToast({ msg: r.detail || okMsg || 'Done' });
    } catch (e) { setToast({ msg: e.message, isError: true }); }
  };

  const isStageOwner = a.can_act;
  const canRevert = ['ADMIN', 'BUREAU'].includes(user.role);
  const canReturn = ['ADMIN', 'REGIONAL', 'BUREAU', 'EVC'].includes(user.role);
  const isOwnInst = user.role === 'INSTITUTION' && user.institution_id === a.institution_id;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="ph-sub" style={{ marginBottom: 4 }}><Link to="/applications">← Applications</Link></p>
          <h1>{a.application_no} <Badge value={a.status} /></h1>
          <p className="ph-sub">{a.title} · {a.inst_name} ({a.city}, {a.region_name}) · route <strong>{a.route?.name}</strong></p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="role-chip">{user.role}</span>
          <div className="small muted" style={{ marginTop: 6 }}>Submitted {fmtDate(a.submitted_at)}</div>
        </div>
      </div>

      {/* ---- Stage timeline ---- */}
      <Card title="Stage-wise progress (APH route)">
        <div className="stepper">
          {a.stages.map(s => {
            const cls = s.status === 'DONE' ? 'done' : s.status === 'ACTIVE' ? 'active' : s.status === 'RETURNED' ? 'returned' : '';
            const days = s.started_at && !s.completed_at && s.due_at
              ? Math.ceil((new Date(s.due_at) - new Date()) / 86400000) : null;
            return (
              <div key={s.id} className={`step ${cls}`}>
                <span className="s-dot" />
                <div className="s-name">{s.seq}. {s.stage_name}</div>
                <div className="s-meta">
                  <Badge value={s.status} /> {s.status === 'PENDING' ? `(${s.timeline_days}d prescribed)` : ''}
                  {s.officer_name && <><br />{s.officer_name} <span className="muted">({s.officer_role})</span></>}
                  {s.started_at && <><br />started {fmtDate(s.started_at)}</>}
                  {s.due_at && s.status !== 'DONE' && s.status !== 'PENDING' && <><br />due {fmtDate(s.due_at)} {days !== null && days <= 7 && <Countdown days={days} />}</>}
                  {s.completed_at && <><br />completed {fmtDate(s.completed_at)}</>}
                  {s.status === 'RETURNED' && s.return_reason && <><br /><span style={{ color: 'var(--red)' }}>Reason: {s.return_reason}</span></>}
                </div>
              </div>
            );
          })}
        </div>

        {/* ---- Authorised actions ---- */}
        <div className="section-title">Authorised actions {a.status !== 'IN_PROCESS' && a.status !== 'RETURNED' ? '— case closed' : ''}</div>
        <div className="pill-row">
          {a.status === 'IN_PROCESS' && isStageOwner && (
            <button className="btn success" onClick={() => act('/advance', { observations: document.getElementById('obs')?.value || null }, 'Stage completed — moved to next stage.')}>
              ✓ Complete {a.stages.find(s => s.seq === a.current_seq)?.stage_name}
            </button>
          )}
          {a.status === 'IN_PROCESS' && isStageOwner && canReturn && (
            <button className="btn warning" onClick={() => setModal('return')}>↩ Return to institution</button>
          )}
          {a.status === 'RETURNED' && (isOwnInst || user.role === 'ADMIN') && (
            <button className="btn" onClick={() => setModal('clarify')}>Submit clarification</button>
          )}
          {a.status === 'IN_PROCESS' && canRevert && a.current_seq > 1 && (
            <button className="btn danger" onClick={() => setModal('revert')}>⤺ Revert to previous stage</button>
          )}
          {['ADMIN', 'REGIONAL', 'BUREAU'].includes(user.role) && (
            <button className="btn secondary" onClick={() => setModal('assign')}>Assign officer</button>
          )}
          {a.current_stage === 'EVC' && ['ADMIN', 'EVC', 'REGIONAL', 'BUREAU'].includes(user.role) && (
            <button className="btn ghost" onClick={() => setModal('evc')}>⚑ Schedule EVC visit</button>
          )}
          {a.status === 'IN_PROCESS' && !isStageOwner && user.role !== 'INSTITUTION' && (
            <span className="small muted">Your role ({user.role}) can view but act only at {a.stages.filter(s => ['DONE', 'ACTIVE', 'RETURNED'].includes(s.status)).map(s => s.stage_name).join(', ') || 'authorised'} stages.</span>
          )}
          {user.role === 'INSTITUTION' && a.status === 'IN_PROCESS' && (
            <span className="small muted">Awaiting AICTE action at {a.stages.find(s => s.seq === a.current_seq)?.stage_name}.</span>
          )}
        </div>
        {a.status === 'IN_PROCESS' && isStageOwner && (
          <>
            <label className="fld" htmlFor="obs" style={{ marginTop: 8 }}>Observations (recorded in audit trail)</label>
            <textarea id="obs" placeholder="Observations / decision notes for this stage…" />
          </>
        )}
        {a.status === 'COMPLETED' && (
          <div className="card" style={{ background: 'var(--green-soft)', marginTop: 12, boxShadow: 'none' }}>
            ✅ All prescribed stages completed on {fmtDate(a.completed_at)}. Case processed subject to conditions, where applicable.
          </div>
        )}
      </Card>

      <div className="grid-2">
        <Card title="Digital audit trail (movement, observations, decisions)">
          {a.audit.length === 0 ? <Empty /> : (
            <div className="timeline">
              {a.audit.map(ev => (
                <div key={ev.id} className="tl-item">
                  <div className="tl-time">{fmtDateTime(ev.created_at)} — {ev.actor_name} <span className="muted">({ev.actor_role})</span></div>
                  <div className="tl-action">{ev.action.replaceAll('_', ' ')}</div>
                  {ev.detail && <div className="tl-detail">{ev.detail}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div>
          <Card title="Linked undertakings & compliance">
            {a.undertakings.length === 0 ? <Empty>No undertakings linked</Empty> : (
              <table className="tbl">
                <thead><tr><th>Undertaking</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {a.undertakings.map(u => (
                    <tr key={u.id}>
                      <td>{u.title}</td>
                      <td><Countdown days={u.due_date ? Math.ceil((new Date(u.due_date) - new Date()) / 86400000) : null} /> <span className="small muted">{u.due_date}</span></td>
                      <td><Badge value={u.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small" style={{ marginTop: 8 }}><Link to="/undertakings">Manage undertakings →</Link></p>
          </Card>

          <Card title="Documents & lease validity">
            {a.documents.length === 0 ? <Empty>No documents on record</Empty> : (
              <table className="tbl">
                <thead><tr><th>Document</th><th>Valid until</th><th>Status</th></tr></thead>
                <tbody>
                  {a.documents.slice(0, 8).map(doc => (
                    <tr key={doc.id}>
                      <td>{doc.title}</td>
                      <td>{fmtDate(doc.expiry_date)} {doc.expiry_date && <Countdown days={Math.ceil((new Date(doc.expiry_date) - new Date()) / 86400000)} />}</td>
                      <td><Badge value={doc.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small" style={{ marginTop: 8 }}><Link to="/documents">Manage documents →</Link></p>
          </Card>

          {a.evc_schedules.length > 0 && (
            <Card title="EVC schedule">
              <table className="tbl">
                <thead><tr><th>Visit date</th><th>Committee</th><th>Status</th></tr></thead>
                <tbody>
                  {a.evc_schedules.map(s => (
                    <tr key={s.id}><td>{fmtDate(s.visit_date)}</td><td className="small">{s.committee}</td><td><Badge value={s.status} /></td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>

      {modal === 'return' && (
        <ReasonModal title="Return to institution — record reason" label="Reason for return (deficiency / clarification required)"
          onClose={() => setModal(null)} onSubmit={(reason) => act('/return', { reason }, 'Returned to institution.')} />
      )}
      {modal === 'revert' && (
        <ReasonModal title="Revert to previous stage — record reason" label="Reason for reverting"
          onClose={() => setModal(null)} onSubmit={(reason) => act('/revert', { reason }, 'Reverted to previous stage.')} />
      )}
      {modal === 'clarify' && (
        <ReasonModal title="Submit clarification / deficiency removal" label="Clarification note & supporting evidence reference"
          onClose={() => setModal(null)} onSubmit={(note) => act('/clarify', { note }, 'Clarification submitted; case resumed.')} />
      )}
      {modal === 'assign' && <AssignModal onClose={() => setModal(null)} current={a.assigned_to}
        onSubmit={(officer_id) => act('/assign', { officer_id }, 'Officer assigned.')} />}
      {modal === 'evc' && <EvcModal onClose={() => setModal(null)}
        onSubmit={(body) => act('/evc-schedule', body, 'EVC visit scheduled.')} />}

      <Toast msg={toast.msg} isError={toast.isError} onDone={() => setToast({})} />
    </>
  );
}

function ReasonModal({ title, label, onClose, onSubmit }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <label className="fld">{label} <span style={{ color: 'var(--red)' }}>*</span></label>
      <textarea value={v} onChange={e => setV(e.target.value)} autoFocus />
      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
      <p className="small muted">This entry is permanently recorded in the audit trail with your name, role and timestamp.</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => { if (!v.trim()) return setErr('Reason is mandatory'); onSubmit(v.trim()); }}>Confirm</button>
      </div>
    </Modal>
  );
}

function AssignModal({ onClose, onSubmit, current }) {
  const [users, setUsers] = useState([]);
  const [id, setId] = useState(current || '');
  useEffect(() => { api('/api/users').then(setUsers).catch(() => {}); }, []);
  return (
    <Modal title="Assign responsible officer" onClose={onClose}>
      <label className="fld">Officer</label>
      <select value={id} onChange={e => setId(e.target.value)}>
        <option value="">Select…</option>
        {users.map(u => <option key={u.id} value={u.id}>{u.name} — {u.role} {u.designation ? `(${u.designation})` : ''}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!id} onClick={() => onSubmit(id)}>Assign</button>
      </div>
    </Modal>
  );
}

function EvcModal({ onClose, onSubmit }) {
  const [f, setF] = useState({ visit_date: '', committee: '', notes: '' });
  const [err, setErr] = useState('');
  return (
    <Modal title="Schedule Expert Visit Committee visit" onClose={onClose}>
      <div className="form-grid">
        <div>
          <label className="fld">Visit date</label>
          <input type="date" value={f.visit_date} onChange={e => setF({ ...f, visit_date: e.target.value })} />
        </div>
        <div>
          <label className="fld">Committee</label>
          <input value={f.committee} onChange={e => setF({ ...f, committee: e.target.value })} placeholder="e.g. EVC Team — West (Prof. …)" />
        </div>
        <div className="full">
          <label className="fld">Notes</label>
          <textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="Purpose, focus areas, new-institution visit note…" />
        </div>
      </div>
      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => { if (!f.visit_date || !f.committee) return setErr('Visit date and committee are required'); onSubmit(f); }}>Schedule</button>
      </div>
    </Modal>
  );
}
