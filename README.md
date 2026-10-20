# AICTE Approval & Compliance Monitoring Platform

An integrated, secure and configurable digital platform for end-to-end automation and monitoring of
AICTE approval-related workflows: application routing, scrutiny stages, EVC scheduling, pendency
monitoring, time-bound undertakings, institutional compliance and validity of prescribed documents
(lease deeds etc.), with real-time dashboards, automated alerts and escalation.

## Stack

- **Backend** — Node.js + Express + SQLite (better-sqlite3). Workflow engine, configurable alert &
  escalation engine, role-based API.
- **Frontend** — React 18 + Vite. Role-based dashboards, workflow actions, reports (CSV export).

## Quick start

```bash
npm install            # install dependencies
npm run seed           # create & seed the demo database (data/aicte.db)
npm run dev            # start API (:5175) + Vite dev server (:5174, proxies /api)
```

Open http://localhost:5174 and sign in with a demo account below.

Production-style run (API serves the built client):

```bash
npm run build          # build client into dist/
npm start              # API + client on http://localhost:5175
```

Other scripts:

```bash
node scripts/smoke.mjs # 66-check API test suite across all roles (server must be running)
npm run seed           # wipe & reseed demo data
```

## Demo accounts (password: `demo123`)

| Role | Email | Scope |
|---|---|---|
| Administrator | admin@aicte.ac.in | All regions, rules, escalations |
| Regional Officer | ro.nr@aicte.ac.in / ro.wr@aicte.ac.in / ro.sr@aicte.ac.in / ro.er@aicte.ac.in / ro.cr@aicte.ac.in | Own region — scrutiny, pendency, documents |
| Bureau Officer | bureau1@aicte.ac.in, bureau2@aicte.ac.in | SAC/SHC, reverts, consolidated reports |
| EVC member | evc1@aicte.ac.in, evc2@aicte.ac.in, evc3@aicte.ac.in | EVC queue & visit scheduling |
| Institution Nodal Officer | inst1@example.edu … inst18@example.edu | Own applications, submissions, compliance |

## What it does

### A. End-to-end approval workflow automation
- Applications are automatically routed through the applicable APH combination:
  **Only Scrutiny**, **Scrutiny + EVC**, **Scrutiny + EVC + SAC/SHC**, **EVC + SAC/SHC**, **Only EVC**.
- Completing a stage auto-moves the case to the next prescribed stage (role-authorised actions only).
- Return/revert to institution or previous stage with mandatory recorded reasons; institutions submit
  clarifications online and the case resumes at the same stage.
- Officer assignment per case.

### B. Dashboards & pendency monitoring
- Consolidated real-time dashboard: stage-wise pendency, application ageing buckets, region-wise
  processing performance, officer workload, bottlenecks.
- Role scoping: Regional Officer sees own region; Institution sees only its own cases.
- Complete digital audit trail of movement, observations, actions, decisions and escalations.

### C. EVC scheduling & alerts
- Queue of all applications requiring an EVC (placed after preliminary processing).
- Visit scheduling/rescheduling with committee details; reminders and escalation for delayed EVCs.

### D. Time-bound undertakings
- Digital register of approvals subject to undertakings with conditions and due dates.
- Online evidence submission by institutions; verification/rejection by authorised officers.
- Reminders before due dates; escalation of unfulfilled undertakings beyond the stipulated timeline.

### E. Lease & document validity
- Validity tracking of lease deeds and other prescribed documents with expiry countdowns.
- Advance expiry alerts, renewed-document submission, verification, overdue escalation.

### F. Notifications, escalation & reporting
- Alert engine (runs every 60 s + on demand) generates reminders and CRITICAL alerts.
- Configurable escalation: stage owner → Regional officer (L2, after N days overdue) → Bureau (L3).
- Consolidated reports (pendency, EVC, undertakings, documents, overdue) with CSV export.

### Configurable rules (admin: Rules & Timelines)
Stage timelines (scrutiny/EVC/SAC days), reminder windows, escalation triggers, EVC reminder window,
undertaking and document-expiry windows — all audit-logged and re-evaluated immediately on change.

## Regulatory safeguard

Automated alerts, recommendations and workflow actions support the approval process but do not
replace statutory scrutiny, verification, inspections or decisions of the competent authority; every
automated step is recorded with the responsible officer in the audit trail.

## Project layout

```
server/           Express API
  db.js           SQLite connection + schema (+ lightweight migrations)
  seed.js         Deterministic demo data (regions, institutions, users, applications, compliance)
  workflow.js     APH route definitions; create/advance/return/revert/assign/EVC scheduling
  alerts.js       Configurable alert & escalation engine
  index.js        REST API, auth, role scoping, dashboard/reports queries
src/              React client (pages: Dashboard, Applications, EVC, Undertakings, Documents,
                  Alerts, Reports, Audit, Settings)
scripts/dev.mjs   Runs API + Vite together
scripts/smoke.mjs 66-check API test suite
screenshots/      Product screenshots
data/aicte.db     SQLite database (generated by npm run seed)
```
