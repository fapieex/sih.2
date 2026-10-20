# SIH 2026 — Demo Script & Talk Track
**Problem Statement SIH26262** — *Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System* (Theme: Smart Automation · Category: Software)

Deck: `SIH2026_Idea_Submission_AICTE_Approval_Platform.pptx` (6 slides, template graphics untouched, instructions slide removed)
Suggested timing: **12 minutes** — 4 min deck + 6 min live demo + 2 min close. Keep to the SIH rule: points, not paragraphs.

---

## Part 1 — Deck talk track (4 min)

### Slide 1 — Title (20 s)
- "We're solving SIH26262: AICTE's approval workflows — scrutiny, expert visits, committees, undertakings — are still tracked in registers, e-mails and phone calls."
- One-liner hook: **"One platform that routes the case, watches the clock, and escalates what's stuck — with a full audit trail."**
- *(Fill Team ID / Team Name on the slide before uploading.)*

### Slide 2 — Idea title (60 s)
- **Problem in one breath:** 5 Regions, hundreds of institutions, 5 possible stage routes, deadlines everywhere; officers chase files, institutions chase officers, and nobody sees pendency in real time.
- **Solution:** a web platform that (a) auto-routes every application through its APH route, (b) shows stage-wise pendency/ageing dashboards, (c) fires configurable alerts and escalates overdue cases up the chain, (d) tracks undertakings and lease-document validity with the same clock.
- **Innovation:** the escalation ladder (L1 owner → L2 Regional → L3 Bureau) is derived from days-overdue per entity; rules mirror any year's APH — configuration, not code; human oversight preserved — decisions stay with the competent authority.

### Slide 3 — Technical approach (60 s)
- Stack: React + Vite front end, Node/Express REST API with role-based access, SQLite prototype → PostgreSQL in production.
- Two loops: **workflow loop** (route → act → auto-advance → audit) and **deadline loop** (remind ≤7 d → CRITICAL overdue → escalate L2 >7 d → L3 >15 d).
- Engineering proof: deterministic seed with 46 real-looking cases, **66 automated API tests** across 5 roles, alert engine re-evaluating every 60 s.

### Slide 4 — Feasibility & viability (45 s)
- Feasible: pure software, single server for all Regions, incremental Region-by-Region rollout.
- Risks: legacy data migration · staff adoption/trust in auto-escalation · APH rule changes yearly · notification deliverability.
- Mitigations: bulk import with validation dashboards · pilot + training + transparent audit trail builds trust · rules editable by admin in minutes · multi-channel notifications with retry.

### Slide 5 — Impact & benefits (45 s)
- Institutions: single window — apply, submit clarifications, upload evidence, see alerts.
- Officers/committees: enforced timelines, workload visibility, nothing silently pending.
- Organisation: audit trail = accountability; region-wise analytics for management; fewer missed deadlines and expired documents.

### Slide 6 — Research & references (30 s)
- AICTE Approval Process Handbook (stage combinations & timelines), AICTE regulations on grant/extension/renewal, official PS on sih.gov.in, and the working prototype (this submission).

**Transition line to demo:** *"Everything on these slides is already working — let's show it."*

---

## Part 2 — Live demo runbook (6 min)

### Setup (before judges arrive)
```bash
export PATH=/c/nodejs/node-v22.14.0-win-x64:$PATH   # local Node install
npm run seed            # fresh demo data (46 cases, 39 alerts)
npm start               # http://localhost:5175  (or npm run dev → :5174)
```
Open the URL in a full-screen browser. Sign out of any previous session. Keep a second browser tab ready on the login page for role switches.

### Act 1 — The problem view as Admin (90 s)
1. Sign in as **AICTE Administrator** (one click on the login page).
2. Dashboard: point at the KPI wall — "46 live cases, 9 overdue stages, 5 undertakings overdue, 7 expired documents, 23 critical alerts — computed in real time, no one typed these numbers."
3. Point to **stage-wise pendency**, **ageing buckets** ("17 cases open 90+ days — invisible in a paper register"), **region table**, **workload bars**.
4. Scroll to **Bottlenecks** and **Latest alerts** with escalation badges.

### Act 2 — Workflow engine (120 s)
1. **Applications** → open the overdue EVC case (APP/2026/0004).
2. Stepper: "Scrutiny done → EVC active and 7 days overdue → SAC pending; each stage has a prescribed clock."
3. Show the **audit trail** card: "creation, escalation L2 — every action stamped with officer, role, time."
4. Click **+ New application** → pick route *Scrutiny + EVC + SAC/SHC* → show the **routing preview** → create.
5. Open the new case → **Complete Scrutiny** with an observation → case auto-advances to EVC. "Stage movement is automatic and role-checked: an EVC member *cannot* complete scrutiny — we tested that."
6. **Return to institution** (reason mandatory) → switch roles for Act 4 to resume it.

### Act 3 — EVC, undertakings, documents, alerts (90 s)
1. **EVC Queue**: "20 in pipeline, 3 overdue and escalated, 5 active with no visit scheduled" → schedule a visit live (date + committee) → row updates.
2. **Undertakings**: filter OVERDUE → "5 unfulfilled beyond stipulated time, escalated to Bureau".
3. **Documents & Lease**: filter EXPIRED → expired leases with Verify/Reject actions; expiring ≤30 d with countdowns.
4. **Alerts & Escalation**: show the feed with `ESCALATED L1 → REGIONAL`, `L2 → BUREAU` badges; click one to jump to its case. "Configurable rules" → mention **Rules & Timelines** page (admin can change any window; changes are audit-logged and re-evaluated immediately).
5. **Reports** → one click **Export CSV**. "The consolidated reports evaluators asked for."

### Act 4 — Institution's view (60 s)
1. Sign out → sign in as **Nodal Officer — Sri Venkateswara** (institution).
2. Dashboard is scoped: "4 cases, own region only, own alerts — role scoping is enforced by the API, not just hidden in the UI."
3. **Undertakings** → **Submit evidence** on the overdue row → status flips to SUBMITTED, awaiting verification.
4. **Documents** → **Submit renewed document** with a new expiry → countdown shows, verification pending.
5. Open the returned application → **Submit clarification** → case resumes at the same stage. "The whole deficiency loop closed without a single phone call."

### Close (30 s)
- "What we showed: routing, dashboards, EVC scheduling, undertakings, lease validity, alerts, escalation, audit trail — end to end, tested by 66 automated checks."
- "Next: SSO integration with AICTE systems, e-mail/SMS gateways, PostgreSQL for production, and document object storage."

---

## Part 3 — Anticipated Q&A

| Question | Answer |
|---|---|
| How is this different from a ticketing tool? | Domain logic: APH route combinations, stage-authorised roles, escalation derived from prescribed timelines, and compliance records (undertakings, lease validity) linked to the same case. |
| What if rules change next year? | Rules are configuration (stage timelines, reminder/escalation windows), versioned and audit-logged — no code change. |
| Does automation replace AICTE decisions? | No. It routes, reminds and escalates; every decision remains with the competent authority and is recorded in the audit trail. |
| How do you handle security? | Token auth, server-side role scoping (region/institution), every action attributable; production plan adds SSO, hashed credentials, HTTPS. |
| Scale? | Single Node server + PostgreSQL handles all Regions; alert engine is deduped per entity per day, so notifications don't explode. |
| Integration with existing AICTE systems? | API-first design; import/export adapters and SSO are the planned integration points. |

---

## Before uploading to the SIH portal
1. Open the PPTX, fill **Team ID** and **Team Name** (slide 1 and the footers say `[Your Team ID]` / `[Your Team Name]`), and re-check **PS ID 26262 / title** against your portal listing.
2. Save As → **PDF** (the portal accepts PDF only), then upload.
3. Regenerate any time after editing `scripts/build_pptx.mjs`: `node scripts/build_pptx.mjs`.
