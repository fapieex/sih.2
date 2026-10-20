import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { Card, Spinner, Empty, Badge, Modal, Toast, Countdown } from '../components.jsx';

export default function Applications({ user, meta }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState({ q: '', region: '', status: '', stage: '', route: '' });
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState({ msg: '' });
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const load = async (query = q) => {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v != null));
    setRows(await api(`/api/applications?${qs}`));
  };

  useEffect(() => {
    const initial = { q: '', region: '', status: params.get('status') || '', stage: '', route: '' };
    setQ(initial);
    load(initial).catch(e => setToast({ msg: e.message, isError: true }));
  }, [params]);

  const set = (k) => (e) => {
    const nq = { ...q, [k]: e.target.value };
    setQ(nq);
    load(nq).catch(ex => setToast({ msg: ex.message, isError: true }));
  };

  const counts = useMemo(() => {
    if (!rows) return {};
    return rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  }, [rows]);

  const canCreate = ['ADMIN', 'REGIONAL', 'BUREAU'].includes(user.role);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Applications</h1>
          <p className="ph-sub">APH-routed applications across scrutiny, EVC and SAC/SHC stages. Click a row for stage timeline, actions and audit trail.</p>
        </div>
        {canCreate && <button className="btn" onClick={() => setShowNew(true)}>+ New application</button>}
      </div>

      <Card>
        <div className="filters">
          <div className="fitem" style={{ minWidth: 220 }}>
            <label className="fld">Search</label>
            <input placeholder="Application no / institution…" value={q.q} onChange={set('q')} />
          </div>
          {meta && user.role === 'ADMIN' && (
            <div className="fitem">
              <label className="fld">Region</label>
              <select value={q.region} onChange={set('region')}>
                <option value="">All regions</option>
                {meta.regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
          <div className="fitem">
            <label className="fld">Status</label>
            <select value={q.status} onChange={set('status')}>
              <option value="">All</option>
              <option value="IN_PROCESS">In process</option>
              <option value="RETURNED">Returned</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
          <div className="fitem">
            <label className="fld">Current stage</label>
            <select value={q.stage} onChange={set('stage')}>
              <option value="">All</option>
              {meta?.stages.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </div>
          <div className="fitem">
            <label className="fld">Route</label>
            <select value={q.route} onChange={set('route')}>
              <option value="">All routes</option>
              {meta?.routes.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
          </div>
          <button className="btn secondary" onClick={() => { const n = { q: '', region: '', status: '', stage: '', route: '' }; setQ(n); load(n); }}>Reset</button>
        </div>

        {!rows ? <Spinner /> : rows.length === 0 ? <Empty>No applications match these filters</Empty> : (
          <>
            <div className="pill-row">
              <span className="badge b-blue">{rows.length} shown</span>
              {Object.entries(counts).map(([s, c]) => <span key={s} className="badge b-grey">{s.replaceAll('_', ' ')}: {c}</span>)}
            </div>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Application</th><th>Institution</th><th>Region</th><th>Route</th><th>Current stage</th>
                    <th>Stage ageing / due</th><th>Responsible</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="rowlink" onClick={() => navigate(`/applications/${r.id}`)}>
                      <td><span className="strong">{r.application_no}</span><br /><span className="small muted">{r.title}</span></td>
                      <td>{r.inst_name}<br /><span className="small muted">{r.inst_type} · {r.city || r.inst_city}</span></td>
                      <td>{r.region_code}</td>
                      <td className="small">{meta?.routes.find(x => x.code === r.route_code)?.name || r.route_code}</td>
                      <td><Badge>{r.stage_name || r.current_stage}</Badge></td>
                      <td>
                        {r.status === 'IN_PROCESS' && r.due_at ? (
                          <>
                            <Countdown days={-r.days_overdue} suffix="left" /><br />
                            <span className="small muted">due {fmtDate(r.due_at)}</span>
                          </>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td className="small">{r.officer_name || <span className="muted">unassigned</span>}<br /><span className="muted">{r.officer_role || ''}</span></td>
                      <td><Badge value={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {showNew && <NewApplicationModal user={user} meta={meta} onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); setToast({ msg: 'Application created and routed.' }); navigate(`/applications/${id}`); }} />}
      <Toast msg={toast.msg} isError={toast.isError} onDone={() => setToast({})} />
    </>
  );
}

function NewApplicationModal({ user, meta, onClose, onCreated }) {
  const [institutions, setInstitutions] = useState([]);
  const [f, setF] = useState({
    title: '', appl_type: 'Grant of Approval', route_code: 'SCRUTINY_EVC',
    institution_id: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/api/institutions').then(setInstitutions).catch(e => setErr(e.message)); }, []);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      if (!f.title.trim() || !f.institution_id) throw new Error('Title and institution are required');
      const r = await api('/api/applications', { method: 'POST', body: f });
      onCreated(r.id);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const route = meta?.routes.find(r => r.code === f.route_code);

  return (
    <Modal title="New application — automatic APH routing" onClose={onClose}>
      <div className="form-grid">
        <div className="full">
          <label className="fld">Application title</label>
          <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Grant of Approval — new engineering college" />
        </div>
        <div>
          <label className="fld">Approval type</label>
          <select value={f.appl_type} onChange={e => setF({ ...f, appl_type: e.target.value })}>
            {['Grant of Approval', 'Extension of Approval', 'Renewal of Approval', 'Variation in Intake'].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="fld">Processing route (as per APH)</label>
          <select value={f.route_code} onChange={e => setF({ ...f, route_code: e.target.value })}>
            {meta?.routes.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
        </div>
        <div className="full">
          <label className="fld">Institution</label>
          <select value={f.institution_id} onChange={e => setF({ ...f, institution_id: e.target.value })}>
            <option value="">Select institution…</option>
            {institutions.map(i => <option key={i.id} value={i.id}>{i.name} — {i.region_name} ({i.city})</option>)}
          </select>
        </div>
      </div>
      {route && (
        <div className="card" style={{ background: 'var(--primary-soft)', margin: '12px 0', boxShadow: 'none' }}>
          <strong className="small">Routing preview: </strong>
          <span className="small">{route.stages.map((s, i) => (
            <span key={s}>{i > 0 ? ' → ' : ''}{meta?.stages.find(x => x.code === s)?.name} ({meta?.stages.find(x => x.code === s)?.timeline_days}d)</span>
          ))}</span>
          <div className="small muted" style={{ marginTop: 4 }}>{route.description}</div>
        </div>
      )}
      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create & route'}</button>
      </div>
    </Modal>
  );
}
