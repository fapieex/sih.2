import React, { useState } from 'react';
import { api } from '../api.js';

const DEMO = [
  { email: 'admin@aicte.ac.in', name: 'AICTE Administrator', role: 'ADMIN', desc: 'Full access — all regions, rules, escalations' },
  { email: 'ro.wr@aicte.ac.in', name: 'Regional Officer (WR)', role: 'REGIONAL', desc: 'Western Region — scrutiny, pendency, documents' },
  { email: 'ro.nr@aicte.ac.in', name: 'Regional Officer (NR)', role: 'REGIONAL', desc: 'Northern Region scope' },
  { email: 'bureau1@aicte.ac.in', name: 'Dr. Anil Sharma', role: 'BUREAU', desc: 'Bureau — SAC/SHC, reverts, reports' },
  { email: 'evc1@aicte.ac.in', name: 'Prof. R. Krishnan', role: 'EVC', desc: 'EVC member — visit queue & schedules' },
  { email: 'inst1@example.edu', name: 'Nodal Officer — Sri Venkateswara', role: 'INSTITUTION', desc: 'Institution — submissions & compliance' },
];

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const doLogin = async (e, creds) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try {
      const cred = creds || { email, password };
      const r = await api('/api/auth/login', { method: 'POST', body: cred });
      onLogin(r.token, r.user);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <div className="emblem">AI</div>
          <div>
            <h1 style={{ marginBottom: 2 }}>AICTE Approval &amp; Compliance Monitoring Platform</h1>
            <div className="login-sub">
              End-to-end approval workflow automation — scrutiny, EVC scheduling, SAC/SHC, undertakings,
              lease &amp; document validity, alerts and escalation as per the Approval Process Handbook.
            </div>
          </div>
        </div>

        <h2>Sign in</h2>
        <form className="login-form" onSubmit={doLogin}>
          <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
          <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
          <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        {err && <p style={{ color: 'var(--red)', marginTop: 8 }}>{err}</p>}
        <p className="small muted" style={{ marginTop: 6 }}>Demo password for all accounts: <strong>demo123</strong></p>

        <div className="section-title">Quick demo access — pick a role</div>
        <div className="demo-grid">
          {DEMO.map(u => (
            <button key={u.email} className="demo-user" onClick={(e) => doLogin(e, { email: u.email, password: 'demo123' })} disabled={busy}>
              <div className="du-name">{u.name}</div>
              <div className="du-meta">{u.role} — {u.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
