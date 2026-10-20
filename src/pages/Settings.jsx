import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Spinner, Toast } from '../components.jsx';

export default function Settings() {
  const [rules, setRules] = useState(null); // [{key,label,grp,value}]
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState({ msg: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/meta').then(m => { setMeta(m); setRules(m.rules); }).catch(e => setErr(e.message));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(rules.map(r => [r.key, r.value]));
      const r = await api('/api/rules', { method: 'PUT', body });
      setToast({ msg: 'Rules updated — alert engine re-evaluated with new timelines.' });
      const m = await api('/api/meta');
      setMeta(m); setRules(m.rules);
    } catch (e) { setToast({ msg: e.message, isError: true }); } finally { setBusy(false); }
  };

  if (err) return <div className="card">{err}</div>;
  if (!rules || !meta) return <Spinner />;

  const groups = rules.reduce((acc, r) => { (acc[r.grp] = acc[r.grp] || []).push(r); return acc; }, {});
  const setValue = (key, value) => setRules(rules.map(r => r.key === key ? { ...r, value } : r));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Rules &amp; Timelines (configurable APH settings)</h1>
          <p className="ph-sub">Processing timelines per stage, reminder windows and escalation triggers. Changes are audit-logged and immediately re-evaluated by the alert engine.</p>
        </div>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>

      {Object.entries(groups).map(([grp, items]) => (
        <Card key={grp} title={grp}>
          <div className="form-grid">
            {items.map(r => (
              <div key={r.key}>
                <label className="fld">{r.label}</label>
                <input type="number" value={r.value} onChange={e => setValue(r.key, e.target.value)} />
                <div className="small muted" style={{ marginTop: 2 }}>{r.key}</div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Card title="Stage catalogue &amp; authorised roles">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Stage</th><th>Current timeline</th><th>Authorised role</th><th>Description</th></tr></thead>
            <tbody>
              {meta.stages.map(s => (
                <tr key={s.code}>
                  <td className="strong">{s.name}</td>
                  <td>{s.timeline_days} days</td>
                  <td><span className="badge b-blue">{s.owner_role}</span></td>
                  <td className="small">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="APH routes (automatic routing combinations)">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Route</th><th>Stage sequence</th><th>Description</th></tr></thead>
            <tbody>
              {meta.routes.map(r => (
                <tr key={r.code}>
                  <td className="strong">{r.name}</td>
                  <td>{r.stages.map(s => meta.stages.find(x => x.code === s)?.name || s).join(' → ')}</td>
                  <td className="small">{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Toast msg={toast.msg} isError={toast.isError} onDone={() => setToast({})} />
    </>
  );
}
