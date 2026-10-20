import React, { useEffect, useState, useCallback } from 'react';
import { api, fmtDate } from '../api.js';
import { Card, Spinner, Empty, Badge, Countdown, Toast, Modal } from '../components.jsx';

export default function Documents({ user }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState({ msg: '' });

  const load = useCallback(() => { api('/api/documents').then(setRows).catch(e => setToast({ msg: e.message, isError: true })); }, []);
  useEffect(load, [load]);

  const act = async (path, body, ok) => {
    try { const r = await api(path, { method: 'POST', body }); setToast({ msg: r.detail || ok }); load(); }
    catch (e) { setToast({ msg: e.message, isError: true }); }
  };

  if (!rows) return <Spinner />;

  const isInst = user.role === 'INSTITUTION';
  const canVerify = ['ADMIN', 'REGIONAL', 'BUREAU'].includes(user.role);
  const expired = rows.filter(d => d.status === 'EXPIRED');
  const soon = rows.filter(d => d.expiry_date && d.status === 'VALID' && d.days_to_expiry >= 0 && d.days_to_expiry <= 30);
  const expiringSoonIds = new Set(soon.map(d => d.id));
  const expiredIds = new Set(expired.map(d => d.id));

  const shown = filter === 'ALL' ? rows
    : filter === 'EXPIRED' ? expired
    : filter === 'EXPIRING' ? soon
    : rows.filter(d => d.status === filter);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lease &amp; Document Validity Monitoring</h1>
          <p className="ph-sub">Validity tracking of lease deeds and other prescribed documents — advance expiry alerts, renewed submission, verification and overdue escalation.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isInst && <button className="btn" onClick={() => setShowNew(true)}>+ Submit renewed document</button>}
          <span className="role-chip">{user.role}</span>
        </div>
      </div>

      <div className="kpi-grid">
        <div className={`kpi ${expired.length ? 'k-red' : ''}`}><div className="k-value">{expired.length}</div><div className="k-label">Expired (escalated)</div></div>
        <div className="kpi k-amber"><div className="k-value">{soon.length}</div><div className="k-label">Expiring ≤ 30 days</div></div>
        <div className="kpi"><div className="k-value">{rows.filter(d => d.status === 'SUBMITTED').length}</div><div className="k-label">Renewals awaiting verification</div></div>
        <div className="kpi k-green"><div className="k-value">{rows.filter(d => ['VALID', 'VERIFIED'].includes(d.status)).length}</div><div className="k-label">Valid / verified</div></div>
      </div>

      <Card
        title="Document register"
        action={
          <div className="pill-row" style={{ marginBottom: 0 }}>
            {['ALL', 'EXPIRING', 'EXPIRED', 'SUBMITTED', 'VALID', 'VERIFIED'].map(f => (
              <button key={f} className={`btn sm ${filter === f ? '' : 'secondary'}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
        }
      >
        {shown.length === 0 ? <Empty>Nothing in this view</Empty> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Institution</th><th>Document</th><th>Issued</th><th>Valid until</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {[...shown].sort((a, b) => (a.expiry_date || '9999') < (b.expiry_date || '9999') ? -1 : 1).map(d => (
                  <tr key={d.id}>
                    <td>{d.inst_name}<br /><span className="small muted">{d.region_code}</span></td>
                    <td><span className="strong">{d.title}</span><br /><span className="small muted">{d.doc_type} · {d.file_name || 'no file'}</span>{d.remarks && <><br /><span className="small muted">{d.remarks}</span></>}</td>
                    <td className="small">{fmtDate(d.issued_on)}</td>
                    <td>
                      {fmtDate(d.expiry_date)}
                      {d.expiry_date && <><br /><Countdown days={d.days_to_expiry} suffix="valid" /></>}
                    </td>
                    <td><Badge value={d.status} />{d.verified_at && <><br /><span className="small muted">✓ {fmtDate(d.verified_at)}</span></>}</td>
                    <td>
                      {canVerify && ['SUBMITTED', 'EXPIRED'].includes(d.status) && (
                        <span style={{ display: 'flex', gap: 4 }}>
                          <button className="btn sm success" onClick={() => act(`/api/documents/${d.id}/verify`, { accept: true, remarks: 'Renewal verified.' }, 'Document verified.')}>Verify</button>
                          <button className="btn sm danger" onClick={() => act(`/api/documents/${d.id}/verify`, { accept: false, remarks: 'Not acceptable — re-submission sought.' }, 'Rejected.')}>Reject</button>
                        </span>
                      )}
                      {isInst && (expiredIds.has(d.id) || expiringSoonIds.has(d.id)) && d.status !== 'SUBMITTED' && (
                        <button className="btn sm warning" onClick={() => setShowNew(true)}>Upload renewal</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showNew && <NewDocModal onClose={() => setShowNew(false)} onDone={(m) => { setShowNew(false); setToast({ msg: m }); load(); }} />}
      <Toast msg={toast.msg} isError={toast.isError} onDone={() => setToast({})} />
    </>
  );
}

function NewDocModal({ onClose, onDone }) {
  const [docs, setDocs] = useState([]);
  const [f, setF] = useState({ doc_type: 'LEASE', title: 'Lease Deed / Rent Agreement (renewed)', file_name: '', issued_on: '', expiry_date: '', replaces_id: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/api/documents').then(setDocs).catch(() => {}); }, []);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      if (!f.title.trim() || !f.expiry_date) throw new Error('Title and expiry date are required');
      const body = { ...f, file_name: f.file_name || `renewal_${Date.now()}.pdf`, replaces_id: f.replaces_id || undefined };
      const r = await api('/api/documents', { method: 'POST', body });
      onDone(`Renewed document submitted (record #${r.id}) — pending verification.`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Submit renewed / additional document" onClose={onClose}>
      <div className="form-grid">
        <div>
          <label className="fld">Document type</label>
          <select value={f.doc_type} onChange={e => setF({ ...f, doc_type: e.target.value })}>
            {['LEASE', 'AFFIDAVIT', 'UNDERTAKING_DOC', 'OTHER'].map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="fld">Title</label>
          <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        </div>
        <div>
          <label className="fld">Issued on</label>
          <input type="date" value={f.issued_on} onChange={e => setF({ ...f, issued_on: e.target.value })} />
        </div>
        <div>
          <label className="fld">Valid until (expiry) *</label>
          <input type="date" value={f.expiry_date} onChange={e => setF({ ...f, expiry_date: e.target.value })} />
        </div>
        <div className="full">
          <label className="fld">Supersedes record (optional)</label>
          <select value={f.replaces_id} onChange={e => setF({ ...f, replaces_id: e.target.value })}>
            <option value="">— none —</option>
            {docs.map(d => <option key={d.id} value={d.id}>{d.title} — {d.inst_name} (valid to {fmtDate(d.expiry_date)})</option>)}
          </select>
        </div>
      </div>
      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
      <p className="small muted">The uploaded file reference is stored with your institution record; verification is performed by the authorised Regional/Bureau officer.</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit document'}</button>
      </div>
    </Modal>
  );
}
