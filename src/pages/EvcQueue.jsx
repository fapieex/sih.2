import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { Card, Spinner, Empty, Badge, Countdown, Toast, Modal } from '../components.jsx';

export default function EvcQueue({ user }) {
  const [rows, setRows] = useState(null);
  const [toast, setToast] = useState({ msg: '' });
  const [schedFor, setSchedFor] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(() => { api('/api/evc/queue').then(setRows).catch(e => setToast({ msg: e.message, isError: true })); }, []);
  useEffect(load, [load]);
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  if (!rows) return <Spinner />;

  const canSchedule = ['ADMIN', 'EVC', 'REGIONAL', 'BUREAU'].includes(user.role);
  const needsEvc = rows.filter(r => ['PENDING', 'ACTIVE', 'RETURNED'].includes(r.evc_status));
  const done = rows.filter(r => r.evc_status === 'DONE');
  const overdue = needsEvc.filter(r => r.days_overdue > 0);
  const unscheduledActive = needsEvc.filter(r => r.evc_status === 'ACTIVE' && !r.visit_date);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>EVC Queue &amp; Scheduling</h1>
          <p className="ph-sub">Applications requiring an Expert Visit Committee — placed in queue after preliminary processing; reminders and escalation for delayed visits.</p>
        </div>
        <span className="role-chip">{user.role}</span>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="k-value">{needsEvc.length}</div><div className="k-label">In EVC pipeline</div></div>
        <div className={`kpi ${overdue.length ? 'k-red' : ''}`}><div className="k-value">{overdue.length}</div><div className="k-label">EVC overdue (escalated)</div></div>
        <div className={`kpi ${unscheduledActive.length ? 'k-amber' : ''}`}><div className="k-value">{unscheduledActive.length}</div><div className="k-label">Active, no visit scheduled</div></div>
        <div className="kpi k-green"><div className="k-value">{done.length}</div><div className="k-label">EVC completed</div></div>
      </div>

      <Card title="Active EVC pipeline">
        {needsEvc.length === 0 ? <Empty>🎉 No applications awaiting EVC</Empty> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Application</th><th>Institution</th><th>Region</th><th>EVC stage status</th><th>Visit scheduled</th><th>Timeline</th><th>Action</th></tr>
              </thead>
              <tbody>
                {needsEvc.map(r => (
                  <tr key={r.id} className="rowlink" onClick={() => navigate(`/applications/${r.id}`)}>
                    <td><span className="strong">{r.application_no}</span><br /><span className="small muted">{r.title}</span></td>
                    <td>{r.inst_name}<br /><span className="small muted">{r.inst_type} · {r.city}</span></td>
                    <td>{r.region_code}</td>
                    <td><Badge value={r.evc_status} /><br /><span className="small muted">{r.evc_status === 'PENDING' ? 'waiting for scrutiny to complete' : 'EVC in progress'}</span></td>
                    <td>{r.visit_date ? <><span className="strong">{fmtDate(r.visit_date)}</span><br /><span className="small muted">{r.committee}</span></> : <span className="badge b-amber">Not scheduled</span>}</td>
                    <td>
                      {r.evc_due_at ? (
                        <>
                          <Countdown days={-r.days_overdue} suffix="left" /><br />
                          <span className="small muted">due {fmtDate(r.evc_due_at)}</span>
                        </>
                      ) : <span className="muted">starts after scrutiny</span>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      {canSchedule && r.evc_status === 'ACTIVE' && (
                        <button className="btn sm" onClick={() => setSchedFor(r)}>{r.visit_date ? 'Reschedule' : 'Schedule visit'}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="EVC completed">
        {done.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Application</th><th>Institution</th><th>Region</th><th>Visit date</th><th>Committee</th></tr></thead>
              <tbody>
                {done.map(r => (
                  <tr key={r.id} className="rowlink" onClick={() => navigate(`/applications/${r.id}`)}>
                    <td className="strong">{r.application_no}</td>
                    <td>{r.inst_name}</td>
                    <td>{r.region_code}</td>
                    <td>{r.visit_date ? fmtDate(r.visit_date) : <span className="muted">—</span>}</td>
                    <td className="small">{r.committee || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {schedFor && <SchedModal row={schedFor} onClose={() => setSchedFor(null)} onDone={(m) => { setSchedFor(null); setToast({ msg: m }); load(); }} />}
      <Toast msg={toast.msg} isError={toast.isError} onDone={() => setToast({})} />
    </>
  );
}

function SchedModal({ row, onClose, onDone }) {
  const [f, setF] = useState({ visit_date: '', committee: row.committee || '', notes: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      if (!f.visit_date || !f.committee) throw new Error('Visit date and committee are required');
      const r = await api(`/api/applications/${row.id}/evc-schedule`, { method: 'POST', body: f });
      onDone(r.detail);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Schedule EVC — ${row.application_no}`} onClose={onClose}>
      <p className="small muted">{row.inst_name} ({row.city}, {row.region_name})</p>
      <div className="form-grid">
        <div>
          <label className="fld">Visit date</label>
          <input type="date" value={f.visit_date} onChange={e => setF({ ...f, visit_date: e.target.value })} />
        </div>
        <div>
          <label className="fld">Committee</label>
          <input value={f.committee} onChange={e => setF({ ...f, committee: e.target.value })} placeholder="EVC Team — members" />
        </div>
        <div className="full">
          <label className="fld">Notes</label>
          <textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />
        </div>
      </div>
      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Schedule visit'}</button>
      </div>
    </Modal>
  );
}
