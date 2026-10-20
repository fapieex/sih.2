import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate, fmtDateTime } from '../api.js';
import { Kpi, Card, Spinner, Empty, Badge, BarRow } from '../components.jsx';

export default function Dashboard({ user }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api('/api/dashboard').then(setD).catch(e => setErr(e.message));
    const t = setInterval(() => api('/api/dashboard').then(setD).catch(() => {}), 60000);
    return () => clearInterval(t);
  }, []);

  if (err) return <div className="card">Failed to load dashboard: {err}</div>;
  if (!d) return <Spinner />;

  const k = d.kpis;
  const maxStage = Math.max(1, ...d.byStage.map(s => s.pending));
  const maxWork = Math.max(1, ...d.workload.map(w => w.pending));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Consolidated Dashboard{user.role !== 'ADMIN' ? ` — ${user.role} view` : ''}</h1>
          <p className="ph-sub">Real-time application movement, pendency, compliance &amp; deadline monitoring across Regions and responsible officers. Refreshes every 60s.</p>
        </div>
        <span className="role-chip">{user.role}</span>
      </div>

      <div className="kpi-grid">
        <Kpi value={k.total} label="Total applications" />
        <Kpi value={k.inProcess} label="In process" />
        <Kpi value={k.overdue} label="Overdue stages" tone={k.overdue > 0 ? 'red' : 'green'} />
        <Kpi value={k.returned} label="Returned to institute" tone="amber" />
        <Kpi value={k.evcPending} label="EVC pending" />
        <Kpi value={k.undDue30} label="Undertakings due (30d)" tone="amber" />
        <Kpi value={k.undOverdue} label="Undertakings overdue" tone="red" />
        <Kpi value={k.docsExpiring} label="Docs expiring ≤30d" tone="amber" />
        <Kpi value={k.docsExpired} label="Docs expired" tone="red" />
        <Kpi value={k.crit} label="Critical alerts (unread)" tone="red" />
        <Kpi value={k.warn} label="Warnings (unread)" tone="amber" />
        <Kpi value={k.completed} label="Cases processed" tone="green" />
      </div>

      <div className="grid-2">
        <Card title="Stage-wise pendency">
          {d.byStage.length === 0 ? <Empty /> : (
            <>
              {d.byStage.map(s => (
                <BarRow key={s.stage} label={s.stage} value={s.pending} over={s.overdue > 0} max={maxStage} />
              ))}
              <div className="legend">
                <span><span className="sw" style={{ background: 'var(--primary)' }} />Pending at stage</span>
                <span><span className="sw" style={{ background: 'var(--red)' }} />Bar in red = has overdue cases</span>
              </div>
              {d.byStage.some(s => s.avg_age) && (
                <p className="small muted" style={{ marginTop: 8 }}>
                  Avg. days at stage: {d.byStage.map(s => `${s.stage} — ${s.avg_age ?? 0}d`).join(' · ')}
                </p>
              )}
            </>
          )}
        </Card>

        <Card title="Application ageing (open cases)">
          {d.ageing.length === 0 ? <Empty /> : (
            <>
              {d.ageing.map(a => (
                <BarRow key={a.bucket} label={a.bucket} value={a.count} over={a.bucket === '90+ d' || a.bucket === '60-89 d'} max={Math.max(...d.ageing.map(x => x.count))} />
              ))}
              <p className="small muted">Age measured from date of submission.</p>
            </>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Region-wise processing performance" action={<span className="small muted">pending · overdue · processed</span>}>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Region</th><th className="num">Total</th><th className="num">Pending</th><th className="num">Overdue</th><th className="num">Processed</th></tr>
              </thead>
              <tbody>
                {d.byRegion.map(r => (
                  <tr key={r.region}>
                    <td className="strong">{r.region}</td>
                    <td className="num">{r.total}</td>
                    <td className="num">{r.pending}</td>
                    <td className="num">{r.overdue > 0 ? <span className="badge b-red">{r.overdue}</span> : <span className="muted">0</span>}</td>
                    <td className="num">{r.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Officer workload distribution">
          {d.workload.length === 0 ? <Empty /> : d.workload.map(w => (
            <BarRow key={w.officer} label={w.officer} value={w.pending} max={maxWork} />
          ))}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Bottlenecks — cases beyond prescribed timeline" action={<Link className="small" to="/applications?status=IN_PROCESS">View all →</Link>}>
          {d.bottlenecks.length === 0 ? <Empty>🎉 No overdue cases right now</Empty> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Application</th><th>Stage</th><th>Region</th><th className="num">Overdue</th></tr></thead>
                <tbody>
                  {d.bottlenecks.map(b => (
                    <tr key={b.id} className="rowlink" onClick={() => navigate(`/applications/${b.id}`)}>
                      <td><span className="strong">{b.application_no}</span><br /><span className="small muted">{b.inst_name}</span></td>
                      <td><Badge>{b.stage_name}</Badge><br /><span className="small muted">due {fmtDate(b.due_at)}</span></td>
                      <td>{b.region_code}</td>
                      <td className="num"><span className="badge b-red">{b.days_overdue}d</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Latest alerts &amp; escalations" action={<Link className="small" to="/alerts">All alerts →</Link>}>
          {d.recentAlerts.length === 0 ? <Empty /> : d.recentAlerts.map(a => (
            <div key={a.id} className={`alert-item ${a.severity.toLowerCase()}`}>
              <div>
                <div className="a-title">
                  {a.title}
                  {a.level > 0 && <span className="esc-badge">ESC L{a.level}</span>}
                </div>
                <div className="a-body">{a.body}</div>
              </div>
              <span className="a-time">{fmtDateTime(a.created_at)}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
