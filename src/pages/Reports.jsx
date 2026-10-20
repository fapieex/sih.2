import React, { useEffect, useState } from 'react';
import { api, fmtDate, csvDownload } from '../api.js';
import { Card, Spinner, Empty, Badge, Countdown } from '../components.jsx';

const TABS = [
  { id: 'pendency', label: 'Application pendency' },
  { id: 'evc', label: 'EVC status' },
  { id: 'undertakings', label: 'Undertaking compliance' },
  { id: 'documents', label: 'Document validity' },
  { id: 'overdue', label: 'Overdue cases' },
];

export default function Reports() {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('pendency');
  const [err, setErr] = useState('');

  useEffect(() => { api('/api/reports').then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <div className="card">{err}</div>;
  if (!d) return <Spinner />;

  const exp = () => csvDownload(`aicte_report_${tab}.csv`, d[tab] || []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Consolidated Reports</h1>
          <p className="ph-sub">Application pendency, EVC status, undertaking compliance, document validity, overdue cases and Region-wise processing performance.</p>
        </div>
        <button className="btn" onClick={exp}>⤓ Export CSV</button>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <Card title={TABS.find(t => t.id === tab).label}>
        {(d[tab] || []).length === 0 ? <Empty /> : (
          <div className="table-wrap">
            {tab === 'pendency' && (
              <table className="tbl">
                <thead><tr><th>Region</th><th>Stage</th><th>Status</th><th className="num">Count</th><th className="num">Avg age (days)</th></tr></thead>
                <tbody>
                  {d.pendency.map((r, i) => (
                    <tr key={i}><td>{r.region_code} — {r.region}</td><td>{r.stage}</td><td><Badge value={r.status} /></td><td className="num">{r.count}</td><td className="num">{r.avg_age_days}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'evc' && (
              <table className="tbl">
                <thead><tr><th>Region</th><th>Institution</th><th>Application</th><th>EVC stage</th><th>Visit scheduled</th><th>Timeline</th></tr></thead>
                <tbody>
                  {d.evc.map((r, i) => (
                    <tr key={i}>
                      <td>{r.region_code}</td><td>{r.inst_name}</td><td className="strong">{r.application_no}</td>
                      <td><Badge value={r.evc_stage_status || 'PENDING'} /></td>
                      <td>{r.visit_date ? fmtDate(r.visit_date) : <span className="muted">not scheduled</span>}</td>
                      <td>{r.due_at && <><Countdown days={-r.days_overdue} /> <span className="small muted">due {fmtDate(r.due_at)}</span></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'undertakings' && (
              <table className="tbl">
                <thead><tr><th>Region</th><th>Institution</th><th>Undertaking</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {d.undertakings.map((r, i) => (
                    <tr key={i}>
                      <td>{r.region_code}</td><td>{r.inst_name}</td><td>{r.title}</td>
                      <td><Countdown days={r.days_left} /><br /><span className="small muted">{r.due_date}</span></td>
                      <td><Badge value={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'documents' && (
              <table className="tbl">
                <thead><tr><th>Region</th><th>Institution</th><th>Document</th><th>Valid until</th><th>Status</th></tr></thead>
                <tbody>
                  {d.documents.map((r, i) => (
                    <tr key={i}>
                      <td>{r.region_code}</td><td>{r.inst_name}</td><td>{r.title}</td>
                      <td>{fmtDate(r.expiry_date)} {r.days_to_expiry !== null && <Countdown days={r.days_to_expiry} />}</td>
                      <td><Badge value={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'overdue' && (
              <table className="tbl">
                <thead><tr><th>Application</th><th>Institution</th><th>Region</th><th>Stage</th><th>Officer</th><th className="num">Days overdue</th></tr></thead>
                <tbody>
                  {d.overdue.map((r, i) => (
                    <tr key={i}>
                      <td className="strong">{r.application_no}</td><td>{r.inst_name}</td><td>{r.region_code}</td>
                      <td>{r.stage_name} <span className="small muted">due {fmtDate(r.due_at)}</span></td>
                      <td className="small">{r.officer || <span className="muted">unassigned</span>}</td>
                      <td className="num"><span className="badge b-red">{r.days_overdue}d</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
