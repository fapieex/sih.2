import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtDateTime } from '../api.js';
import { Card, Spinner, Empty, Toast } from '../components.jsx';

const TYPE_LABEL = {
  PENDENCY: 'Pendency / timeline', EVC_DUE: 'EVC scheduling', UNDERTAKING: 'Undertaking', DOC_EXPIRY: 'Document validity',
};

export default function Alerts({ user, onRead }) {
  const [data, setData] = useState(null);
  const [sev, setSev] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [toast, setToast] = useState({ msg: '' });
  const navigate = useNavigate();

  const load = useCallback(() => { api('/api/alerts').then(setData).catch(e => setToast({ msg: e.message, isError: true })); }, []);
  useEffect(load, [load]);
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (!data) return <Spinner />;

  const markRead = async (id) => {
    await api(`/api/alerts/${id}/read`, { method: 'POST' }).catch(() => {});
    load(); onRead?.();
  };
  const markAll = async () => {
    await api('/api/alerts/read-all', { method: 'POST' }).catch(() => {});
    load(); onRead?.();
  };
  const runNow = async () => {
    try { const r = await api('/api/alerts/run', { method: 'POST' }); setToast({ msg: `Alert engine run: ${r.pendency} pendency, ${r.evc} EVC, ${r.undertaking} undertaking, ${r.doc} document alerts` }); load(); }
    catch (e) { setToast({ msg: e.message, isError: true }); }
  };

  const alerts = data.alerts
    .filter(a => sev === 'ALL' || a.severity === sev)
    .filter(a => type === 'ALL' || a.type === type)
    .filter(a => !onlyUnread || !a.read_at);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alerts &amp; Escalation Centre</h1>
          <p className="ph-sub">Automated notifications for pending applications, upcoming deadlines, EVC scheduling, compliance submissions and document expiry — with escalation to designated officials as per configured rules.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {user.role === 'ADMIN' && <button className="btn secondary" onClick={runNow}>Run alert engine now</button>}
          <button className="btn" onClick={markAll}>Mark all read</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className={`kpi ${data.unread ? '' : 'k-green'}`}><div className="k-value">{data.unread}</div><div className="k-label">Unread</div></div>
        <div className="kpi k-red"><div className="k-value">{data.alerts.filter(a => a.severity === 'CRITICAL').length}</div><div className="k-label">Critical (visible)</div></div>
        <div className="kpi k-amber"><div className="k-value">{data.alerts.filter(a => a.level >= 2).length}</div><div className="k-label">Escalated L2+</div></div>
        <div className="kpi"><div className="k-value">{data.alerts.filter(a => a.level === 3).length}</div><div className="k-label">Escalated to Bureau</div></div>
      </div>

      <Card
        title="Notification feed"
        action={
          <div className="pill-row" style={{ marginBottom: 0 }}>
            {['ALL', 'CRITICAL', 'WARNING', 'INFO'].map(s => (
              <button key={s} className={`btn sm ${sev === s ? '' : 'secondary'}`} onClick={() => setSev(s)}>{s}</button>
            ))}
            <select style={{ width: 'auto', padding: '5px 8px' }} value={type} onChange={e => setType(e.target.value)}>
              <option value="ALL">All types</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className={`btn sm ${onlyUnread ? '' : 'secondary'}`} onClick={() => setOnlyUnread(!onlyUnread)}>Unread only</button>
          </div>
        }
      >
        {alerts.length === 0 ? <Empty>No alerts in this view</Empty> : alerts.map(a => (
          <div key={a.id} className={`alert-item ${a.severity.toLowerCase()} ${a.read_at ? '' : 'unread'}`}
               style={{ cursor: a.entity_type === 'APPLICATION' ? 'pointer' : 'default' }}
               onClick={() => { if (a.entity_type === 'APPLICATION' && a.entity_id) navigate(`/applications/${a.entity_id}`); markRead(a.id); }}>
            <div>
              <div className="a-title">
                <span className="badge b-grey" style={{ marginRight: 6 }}>{TYPE_LABEL[a.type] || a.type}</span>
                {a.title}
                {a.level > 0 && <span className="esc-badge">ESCALATED L{a.level} → {a.audience_role}</span>}
              </div>
              <div className="a-body">{a.body}</div>
              <div className="small muted" style={{ marginTop: 3 }}>Audience: {a.audience_role}{a.read_at ? ' · read' : ' · unread'}</div>
            </div>
            <span className="a-time">{fmtDateTime(a.created_at)}</span>
          </div>
        ))}
      </Card>

      <Card title="How escalation works">
        <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          <li><strong>Reminder</strong> — configured days before a stage/undertaking/document deadline, the responsible role is alerted.</li>
          <li><strong>Level 1</strong> — on crossing the deadline, a CRITICAL alert goes to the stage owner / Regional officer.</li>
          <li><strong>Level 2</strong> — after N days overdue (configurable), the matter is escalated to the Regional officer / Bureau.</li>
          <li><strong>Level 3</strong> — after N further days, escalation to Bureau for disposal.</li>
          <li>Every alert, escalation and closure is recorded in the <strong>audit trail</strong>.</li>
        </ol>
      </Card>

      <Toast msg={toast.msg} isError={toast.isError} onDone={() => setToast({})} />
    </>
  );
}
