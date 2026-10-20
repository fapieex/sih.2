import React, { useEffect } from 'react';
import { fmtDate } from './api.js';

export const STATUS_COLORS = {
  IN_PROCESS: 'b-blue', RETURNED: 'b-amber', COMPLETED: 'b-green', REJECTED: 'b-red',
  ACTIVE: 'b-blue', DONE: 'b-green', PENDING: 'b-grey', RETURNED_STAGE: 'b-red',
  VALID: 'b-green', SUBMITTED: 'b-blue', VERIFIED: 'b-green', EXPIRED: 'b-red', REJECTED_DOC: 'b-red',
  SCHEDULED: 'b-blue', COMPLETED_EVC: 'b-green',
};

export function Badge({ value, children }) {
  const cls = STATUS_COLORS[value] || 'b-grey';
  return <span className={`badge ${cls}`}>{children || String(value || '—').replaceAll('_', ' ')}</span>;
}

export function Kpi({ value, label, tone }) {
  return (
    <div className={`kpi ${tone ? `k-${tone}` : ''}`}>
      <div className="k-value">{value}</div>
      <div className="k-label">{label}</div>
    </div>
  );
}

export function Card({ title, action, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Spinner() { return <div className="spinner" />; }

export function Empty({ children = 'No records found' }) { return <div className="empty">{children}</div>; }

export function Countdown({ days, suffix = 'left' }) {
  if (days === null || days === undefined || Number.isNaN(days)) return <span className="muted">—</span>;
  const cls = days < 0 ? 'over' : days <= 10 ? 'soon' : 'ok';
  const txt = days < 0 ? `${Math.abs(days)}d overdue` : `${days}d ${suffix}`;
  return <span className={`countdown ${cls}`}>{txt}</span>;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="xbtn" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ msg, isError, onDone }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 3800);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  if (!msg) return null;
  return <div className={`toast ${isError ? 'error' : ''}`}>{msg}</div>;
}

export function BarRow({ label, value, over, max, width }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className={`bar-fill ${over ? 'over' : ''}`} style={{ width: width ?? `${pct}%` }} />
      </span>
      <span className="bar-val">{value}</span>
    </div>
  );
}

export const stageBadge = (stage) => {
  const map = { SCRUTINY: 'Scrutiny', EVC: 'EVC', SAC: 'SAC/SHC' };
  return map[stage] || stage;
};

export { fmtDate };
