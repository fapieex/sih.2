import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom';
import { api, getUser, getToken, setSession, clearSession } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Applications from './pages/Applications.jsx';
import ApplicationDetail from './pages/ApplicationDetail.jsx';
import EvcQueue from './pages/EvcQueue.jsx';
import Undertakings from './pages/Undertakings.jsx';
import Documents from './pages/Documents.jsx';
import Alerts from './pages/Alerts.jsx';
import Reports from './pages/Reports.jsx';
import AuditTrail from './pages/AuditTrail.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▦' },
  { to: '/applications', label: 'Applications', icon: '▤' },
  { to: '/evc', label: 'EVC Queue', icon: '⚑' },
  { to: '/undertakings', label: 'Undertakings', icon: '✎' },
  { to: '/documents', label: 'Documents & Lease', icon: '▧' },
  { to: '/alerts', label: 'Alerts & Escalation', icon: '⚠', badge: 'alerts' },
  { to: '/reports', label: 'Reports', icon: '◫', roles: ['ADMIN', 'BUREAU', 'REGIONAL'] },
  { to: '/audit', label: 'Audit Trail', icon: '≡' },
  { to: '/settings', label: 'Rules & Timelines', icon: '⚙', roles: ['ADMIN'] },
];

export default function App() {
  const [user, setUser] = useState(getUser());
  const [unread, setUnread] = useState(0);
  const [meta, setMeta] = useState(null);
  const navigate = useNavigate();

  const refreshAlertCount = useCallback(async () => {
    if (!getToken()) return;
    try { const d = await api('/api/alerts'); setUnread(d.unread); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!getToken()) { setUser(null); return; }
    (async () => {
      try {
        const { user: me } = await api('/api/me');
        setUser(me);
        setMeta(await api('/api/meta'));
        refreshAlertCount();
      } catch { /* redirected by api() */ }
    })();
    const t = setInterval(refreshAlertCount, 45000);
    return () => clearInterval(t);
  }, [refreshAlertCount]);

  const onLogin = async (token, u) => {
    setSession(token, u);
    setUser(u);
    setMeta(await api('/api/meta'));
    refreshAlertCount();
    navigate('/');
  };

  const logout = () => { clearSession(); setUser(null); navigate('/login'); };

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={onLogin} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const navItems = NAV.filter(n => !n.roles || n.roles.includes(user.role));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sb-title">AICTE Approval &amp;<br />Compliance Platform</div>
          <div className="sb-sub">Approval Process Handbook workflow automation</div>
        </div>
        <nav className="nav">
          {navItems.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              <span>{n.icon}</span> {n.label}
              {n.badge === 'alerts' && unread > 0 && <span className="nav-badge">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="su-name">{user.name}</div>
          <div className="su-role">{user.role}{user.designation ? ` · ${user.designation}` : ''}</div>
          <button className="btn secondary sm" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard user={user} meta={meta} />} />
          <Route path="/applications" element={<Applications user={user} meta={meta} />} />
          <Route path="/applications/:id" element={<ApplicationDetail user={user} meta={meta} />} />
          <Route path="/evc" element={<EvcQueue user={user} meta={meta} />} />
          <Route path="/undertakings" element={<Undertakings user={user} meta={meta} />} />
          <Route path="/documents" element={<Documents user={user} meta={meta} />} />
          <Route path="/alerts" element={<Alerts user={user} meta={meta} onRead={refreshAlertCount} />} />
          <Route path="/reports" element={<Reports user={user} meta={meta} />} />
          <Route path="/audit" element={<AuditTrail user={user} meta={meta} />} />
          <Route path="/settings" element={<Settings user={user} meta={meta} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
