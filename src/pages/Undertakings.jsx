import React, { useEffect, useState, useCallback } from 'react';
import { api, fmtDate } from '../api.js';
import { Card, Spinner, Empty, Badge, Countdown, Toast } from '../components.jsx';

export default function Undertakings({ user }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [toast, setToast] = useState({ msg: '' });

  const load = useCallback(() => { api('/api/undertakings').then(setRows).catch(e => setToast({ msg: e.message, isError: true })); }, []);
  useEffect(load, [load]);

  const act = async (path, body, ok) => {
    try { const r = await api(path, { method: 'POST', body }); setToast({ msg: r.detail || ok }); load(); }
    catch (e) { setToast({ msg: e.message, isError: true }); }
  };

  if (!rows) return <Spinner />;

  const isInst = user.role === 'INSTITUTION';
  const canVerify = ['ADMIN', 'REGIONAL', 'BUREAU'].includes(user.role);
  const groups = {
    OVERDUE: rows.filter(u => ['PENDING', 'SUBMITTED'].includes(u.status) && u.days_left < 0),
    DUE_30: rows.filter(u => ['PENDING', 'SUBMITTED'].includes(u.status) && u.days_left >= 0 && u.days_left <= 30),
    OTHER: rows.filter(u => !['PENDING', 'SUBMITTED'].includes(u.status) || (u.days_left > 30)),
  };
  const shown = filter === 'ALL' ? rows
    : filter === 'OVERDUE' ? groups.OVERDUE
    : filter === 'DUE_30' ? groups.DUE_30
    : rows.filter(u => u.status === filter);
  const sorted = [...shown].sort((a, b) => a.days_left - b.days_left);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Time-bound Undertakings &amp; Compliance</h1>
          <p className="ph-sub">Approvals granted subject to undertakings — prescribed conditions, due dates, online evidence submission, verification and escalation of unfulfilled conditions.</p>
        </div>
        <span className="role-chip">{user.role}</span>
      </div>

      <div className="kpi-grid">
        <div className={`kpi ${groups.OVERDUE.length ? 'k-red' : ''}`}><div className="k-value">{groups.OVERDUE.length}</div><div className="k-label">Overdue (escalated)</div></div>
        <div className="kpi k-amber"><div className="k-value">{groups.DUE_30.length}</div><div className="k-label">Due in 30 days</div></div>
        <div className="kpi"><div className="k-value">{rows.filter(u => u.status === 'SUBMITTED').length}</div><div className="k-label">Awaiting verification</div></div>
        <div className="kpi k-green"><div className="k-value">{rows.filter(u => u.status === 'VERIFIED').length}</div><div className="k-label">Verified</div></div>
      </div>

      <Card
        title="Undertaking register"
        action={
          <div className="pill-row" style={{ marginBottom: 0 }}>
            {['ALL', 'OVERDUE', 'DUE_30', 'PENDING', 'SUBMITTED', 'VERIFIED'].map(f => (
              <button key={f} className={`btn sm ${filter === f ? '' : 'secondary'}`} onClick={() => setFilter(f)}>{f.replaceAll('_', ' ')}</button>
            ))}
          </div>
        }
      >
        {sorted.length === 0 ? <Empty>Nothing in this view</Empty> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Undertaking / condition</th><th>Institution</th><th>Region</th><th>Due date</th><th>Evidence</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {sorted.map(u => (
                  <tr key={u.id}>
                    <td><span className="strong">{u.title}</span><br /><span className="small muted">{u.condition_text}</span></td>
                    <td>{u.inst_name}{u.application_no && <><br /><span className="small muted">{u.application_no}</span></>}</td>
                    <td>{u.region_code}</td>
                    <td><Countdown days={u.days_left} /><br /><span className="small muted">{u.due_date}</span></td>
                    <td className="small">
                      {u.file_name ? <>{u.file_name}<br /><span className="muted">submitted {fmtDate(u.submitted_at)}</span></> : <span className="muted">none</span>}
                      {u.verified_at && <><br /><span className="muted">✓ {u.verifier_name} on {fmtDate(u.verified_at)}</span></>}
                    </td>
                    <td><Badge value={u.status} />{u.remarks && <><br /><span className="small muted">{u.remarks}</span></>}</td>
                    <td>
                      {isInst && ['PENDING', 'REJECTED'].includes(u.status) && (
                        <button className="btn sm" onClick={() => act(`/api/undertakings/${u.id}/submit`, { file_name: `evidence_${u.id}_${Date.now()}.pdf` }, 'Evidence submitted for verification.')}>Submit evidence</button>
                      )}
                      {canVerify && u.status === 'SUBMITTED' && (
                        <span style={{ display: 'flex', gap: 4 }}>
                          <button className="btn sm success" onClick={() => act(`/api/undertakings/${u.id}/verify`, { accept: true, remarks: 'Verified — accepted.' }, 'Verified.')}>Verify</button>
                          <button className="btn sm danger" onClick={() => act(`/api/undertakings/${u.id}/verify`, { accept: false, remarks: 'Re-submission sought.' }, 'Rejected — institution notified.')}>Reject</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>
          Reminder window and escalation trigger are configurable in <strong>Rules &amp; Timelines</strong>. Overdue undertakings are auto-escalated to Bureau level.
        </p>
      </Card>

      <Toast msg={toast.msg} isError={toast.isError} onDone={() => setToast({})} />
    </>
  );
}
