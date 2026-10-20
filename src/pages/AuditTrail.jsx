import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDateTime, csvDownload } from '../api.js';
import { Card, Spinner, Empty, Toast } from '../components.jsx';

export default function AuditTrail() {
  const [rows, setRows] = useState(null);
  const [action, setAction] = useState('');
  const [toast, setToast] = useState({ msg: '' });

  const load = async (f = action) => {
    try { setRows(await api(`/api/audit${f ? `?action=${encodeURIComponent(f)}` : ''}`)); }
    catch (e) { setToast({ msg: e.message, isError: true }); }
  };
  useEffect(() => { load(''); }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Digital Audit Trail</h1>
          <p className="ph-sub">Complete record of application movement, observations, actions, decisions, compliance submissions, verifications, alerts and escalations.</p>
        </div>
        <button className="btn" onClick={() => csvDownload('aicte_audit_trail.csv', (rows || []).map(r => ({
          time: r.created_at, application: r.application_no || '', entity: r.entity_type, entity_id: r.entity_id ?? '',
          actor: r.actor_name, role: r.actor_role, action: r.action, detail: r.detail || '',
        })))}>⤓ Export CSV</button>
      </div>

      <Card>
        <div className="filters">
          <div className="fitem" style={{ minWidth: 260 }}>
            <label className="fld">Filter by action</label>
            <input placeholder="e.g. STAGE_COMPLETED, ESCALATED, VERIFIED…" value={action}
              onChange={e => setAction(e.target.value)} onBlur={() => load(action)} />
          </div>
          <span className="small muted">{rows ? `${rows.length} entries` : 'loading…'}</span>
        </div>

        {!rows ? <Spinner /> : rows.length === 0 ? <Empty>No audit entries match</Empty> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</td>
                    <td className="small"><span className="strong">{r.actor_name}</span><br /><span className="muted">{r.actor_role}</span></td>
                    <td><span className="badge b-blue">{r.action.replaceAll('_', ' ')}</span></td>
                    <td className="small">
                      {r.application_no ? <Link to={`/applications/${r.app_id}`}>{r.application_no}</Link> : <span className="muted">{r.entity_type}</span>}
                      {r.entity_id != null && <><br /><span className="muted">{r.entity_type} #{r.entity_id}</span></>}
                    </td>
                    <td className="small">{r.detail || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Toast msg={toast.msg} isError={toast.isError} onDone={() => setToast({})} />
    </>
  );
}
