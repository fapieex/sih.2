// Builds the SIH 2026 idea-submission PPTX from the official template.
// - Fills every slide using the template's own paragraph formatting (graphics untouched)
// - Keeps the template's "idea details pointers" as-is and adds our points beneath them
// - Deletes the final "IMPORTANT INSTRUCTIONS" slide (slide 7), as its own note permits
//
// Usage:  node scripts/build_pptx.mjs
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const TEMPLATE = 'C:/Users/epicd/Downloads/SIH2026-IDEA-Presentation-Format.pptx';
const OUTPUT = process.env.OUTPUT || 'SIH2026_Idea_Submission_AICTE_Approval_Platform.pptx';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- content --
const PS = {
  id: 'SIH26262',
  title: 'Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System',
  theme: 'Smart Automation',
  category: 'Software',
  teamId: '[Your Team ID]',
  teamName: '[Your Team Name]',
};

const CONTENT = {
  1: {
    // slide 1: fill the field lines (keep label formatting, append values)
    fillSize: 1700,
    box9: { y: 1600000, cy: 4703019 },
    fills: {
      1: `Problem Statement ID – ${PS.id}`,
      2: `Problem Statement Title- ${PS.title}`,
      3: `Theme- ${PS.theme}`,
      4: `PS Category- ${PS.category}`,
      5: `Team ID- ${PS.teamId}`,
      6: `Team Name (Registered on portal): ${PS.teamName}`,
    },
  },
  2: {
    title: 'AICTE APPROVAL & COMPLIANCE PLATFORM',
    titleSize: 2800,
    titleAlign: 'ctr',
    pointerSize: 2200,
    subSize: 1300,
    box: { y: 1250000, cy: 5000000 },
    subs: {
      0: [
        'Unified platform auto-routes applications through APH stages (Scrutiny, EVC, SAC/SHC) in any prescribed combination',
        'Real-time dashboards: stage-wise pendency, ageing and bottlenecks across Regions, officers and committees',
        'Configurable alert & escalation engine: reminders → Regional Officer → Bureau for anything overdue',
        'Compliance built in: undertakings and lease / document validity tracked with the case',
      ],
      3: [
        'Workflow engine auto-moves each case to the next stage with role-based authorisation',
        'Return / revert / clarification cycles with mandatory recorded reasons; officer assignment',
        'EVC queue with visit scheduling, due-date reminders and auto-escalation of delayed visits',
        'Admin-configurable rules — timelines, reminders, escalation triggers — audit-logged',
      ],
      4: [
        'Automated alerts & escalation replace manual registers, phone calls and follow-up e-mails',
        'Single source of truth with human oversight — decisions stay with the competent authority',
      ],
      5: [
        'Escalation ladder derived from days-overdue (L1 stage owner → L2 Regional → L3 Bureau), per entity',
        'One screen unites three domains: approval cases + undertakings + document validity',
        'API-first design plugs over existing AICTE systems (SSO, data import) where feasible',
      ],
    },
  },
  3: {
    pointerSize: 2200,
    subSize: 1300,
    box: { y: 1250000, cy: 3200000 },
    subs: {
      0: [
        'Frontend: React 18 + Vite — role-based dashboards, charts, responsive UI',
        'Backend: Node.js + Express REST API with token auth and server-side role scoping',
        'Database: SQLite for the portable prototype → PostgreSQL for production',
        'Notifications: scheduler (60 s cycle) with dedupe keys; e-mail / SMS gateways via adapters',
      ],
      1: [
        'Flow: Application → route engine (Only Scrutiny | Scrutiny+EVC | EVC+SAC/SHC | Only EVC) → auto-advance',
        'Every stage action (complete / return / revert / assign) is role-authorised and audit-logged',
        'Deadline loop: reminder ≤ 7 d before due → CRITICAL overdue → escalate L2 after 7 d → L3 after 15 d',
        'Compliance loop: due date → notify institution → submit evidence online → officer verify → closure logged',
        'Working prototype: 46 seeded cases, 5 roles, 66 automated API tests — every module live in the browser',
      ],
    },
  },
  4: {
    pointerSize: 2200,
    subSize: 1400,
    box: { y: 1250000, cy: 2900000 },
    subs: {
      0: [
        'Pure software on modest hardware; one server can serve all five Regions',
        'Incremental rollout: pilot one Region, then scale — no parallel systems needed',
        'Integrates with existing AICTE systems via APIs wherever feasible',
      ],
      1: [
        'Legacy data migration and record quality',
        'Adoption by offices; trust in automated escalation',
        'APH rule changes each year; notification deliverability',
      ],
      2: [
        'Bulk import with validation dashboards; read-only legacy phase first',
        'Role-based training, pilot Region and a transparent audit trail build trust',
        'Rules are configuration, not code — updated in minutes; multi-channel notifications with retry',
      ],
    },
  },
  5: {
    pointerSize: 2200,
    subSize: 1500,
    box: { y: 1250000, cy: 4600000 },
    subs: {
      0: [
        'Institutions: single window for applications, submissions, alerts and compliance status',
        'AICTE officers & committees: enforced stage timelines, workload visibility, no missed deadlines',
        'Citizens & regulators: faster, transparent and accountable approval processing',
      ],
      1: [
        'Eliminates repetitive manual work and follow-up — saves officer hours every week',
        'Accountability: complete digital audit trail of movement, decisions and escalations',
        'Data-driven governance: region-wise pendency and bottleneck analytics for management review',
        'Fewer missed deadlines and expired documents — stronger approval compliance',
      ],
    },
  },
  6: {
    pointerSize: 2200,
    subSize: 1500,
    box: { y: 1350000, cy: 4600000 },
    subs: {
      0: [
        'AICTE Approval Process Handbook (APH) — stages, route combinations and prescribed timelines',
        'AICTE regulations on grant / extension / renewal of approval of technical institutions',
        `SIH 2026 problem statement ${PS.id} — official portal: sih.gov.in/sih2026PS`,
        'Working prototype (this submission): Express + React + SQLite — alert engine, dashboards, audit trail',
      ],
    },
  },
};

// ------------------------------------------------------------ xml helpers --
function shapeTxBody(xml, shapeName) {
  const pos = xml.indexOf(`name="${shapeName}"`);
  if (pos < 0) throw new Error(`shape ${shapeName} not found`);
  const start = xml.lastIndexOf('<p:sp>', pos);
  const end = xml.indexOf('</p:sp>', pos);
  const shape = xml.slice(start, end + 7);
  const TAG = '<p:txBody>';
  const CLOSE = '</p:txBody>';
  const tbStart = shape.indexOf(TAG);
  const tbEnd = shape.indexOf(CLOSE);
  if (tbStart < 0 || tbEnd < 0) throw new Error(`no txBody in ${shapeName}`);
  return { shapeStart: start, shapeEnd: end + 7, tbStart, tbEnd: tbEnd + CLOSE.length, txBody: shape.slice(tbStart, tbEnd + CLOSE.length) };
}

function splitTxBody(tb) {
  const firstP = tb.indexOf('<a:p>');
  const lastP = tb.lastIndexOf('</a:p>');
  if (firstP < 0) throw new Error('no paragraphs');
  const header = tb.slice(0, firstP);
  const body = tb.slice(firstP, lastP + '</a:p>'.length);
  const footer = tb.slice(lastP + '</a:p>'.length);
  const paras = [...body.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map(m => m[0]);
  return { header, footer, paras };
}

// rewrite paragraph text into the first run, keeping its formatting; blank other runs
function setParaText(p, text) {
  let seen = false;
  return p.replace(/<a:t>[\s\S]*?<\/a:t>/g, (m) => {
    if (!seen) { seen = true; return `<a:t>${esc(text)}</a:t>`; }
    return '<a:t></a:t>';
  });
}

// Build a clean sub-bullet paragraph: smaller size than the pointer line, a
// hanging indent so wrapped lines align under the text (not the bullet), and
// left-alignment (justified 28pt pointers looked ragged with long sub-points).
function subParagraph(text, { size = 1500, before = 200 } = {}) {
  const marL = 685800;   // 0.75in bullet stop
  const indent = -342900; // hang back to bullet
  return '<a:p>' +
    `<a:pPr marL="${marL}" marR="0" lvl="1" indent="${indent}" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" fontAlgn="base" latinLnBrk="0" hangingPunct="1">` +
    `<a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="${before}"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft>` +
    `<a:buClrTx/><a:buSzPct val="90000"/><a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="▸"/>` +
    `<a:tabLst/><a:defRPr/></a:pPr>` +
    `<a:r><a:rPr lang="en-US" sz="${size}" dirty="0"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:latin typeface="Arial" pitchFamily="34" charset="0"/><a:cs typeface="Arial" pitchFamily="34" charset="0"/></a:rPr>` +
    `<a:t>${esc(text)}</a:t></a:r>` +
    '<a:endParaRPr lang="en-US" sz="' + size + '" dirty="0"/></a:p>';
}

// keep the pointer paragraph but de-justify it, set an explicit size and give
// it a touch of space after, so pointer + sub-bullets read as a clean block
function tidyPointer(p, size = 2200) {
  let out = p.replace(/algn="just"/, 'algn="l"')
          .replace(/<a:spcAft><a:spcPts val="0"\/><\/a:spcAft>/, '<a:spcAft><a:spcPts val="400"/></a:spcAft>');
  out = out.replace(/sz="\d+"/g, `sz="${size}"`);
  return out;
}

// de-justify a field line and set its size (slide 1 title-page fields)
function deJustify(p, size) {
  let out = p.replace(/algn="just"/, 'algn="l"');
  if (!/algn="/.test(out)) {
    if (/<a:pPr\b/.test(out)) out = out.replace(/<a:pPr\b/, '<a:pPr algn="l"');
    else out = out.replace(/<a:p>/, '<a:p><a:pPr algn="l"/>');
  }
  if (size) out = out.replace(/sz="\d+"/g, `sz="${size}"`);
  return out;
}

// reposition a shape's frame (used to lift TextBox 8 above the footer band)
function setBoxFrame(shapeXml, y, cy) {
  return shapeXml
    .replace(/<a:off x="-?\d+" y="-?\d+"\/>/, `<a:off x="609600" y="${y}"/>`)
    .replace(/<a:ext cx="\d+" cy="\d+"\/>/, `<a:ext cx="10972800" cy="${cy}"/>`);
}

function applySlide(xml, cfg) {
  const txNames = [];
  if (cfg.fills) txNames.push('TextBox 9');
  if (cfg.title) txNames.push('Title 1');
  if (cfg.subs) txNames.push('TextBox 8');
  for (const name of new Set(txNames)) {
    const { shapeStart, shapeEnd, txBody } = shapeTxBody(xml, name);
    const { header, footer, paras } = splitTxBody(txBody);
    let list = [...paras];

    if (name === 'TextBox 9' && cfg.fills) {
      for (const [idx, text] of Object.entries(cfg.fills)) list[Number(idx)] = deJustify(setParaText(list[Number(idx)], text), cfg.fillSize);
    }
    if (name === 'Title 1' && cfg.title) {
      let t = setParaText(list[0], cfg.title);
      if (cfg.titleSize) t = t.replace(/sz="\d+"/g, `sz="${cfg.titleSize}"`);
      if (cfg.titleAlign) t = t.replace(/algn="\w+"/, `algn="${cfg.titleAlign}"`).replace(/(?!<a:pPr[^>]*algn)<a:pPr\b(?!\s[^>]*algn)/, `<a:pPr algn="${cfg.titleAlign}"`);
      list[0] = t;
    }
    if (name === 'TextBox 8' && cfg.subs) {
      // insert from bottom up so indices stay valid
      const anchors = Object.keys(cfg.subs).map(Number).sort((a, b) => b - a);
      for (const anchor of anchors) {
        list[anchor] = tidyPointer(list[anchor], cfg.pointerSize || 2200);
        const sz = cfg.subSize || 1500;
        const subs = cfg.subs[anchor].map((t, i) => subParagraph(t, { size: sz, before: i === 0 ? 200 : 60 })).filter(Boolean);
        list = [...list.slice(0, anchor + 1), ...subs, ...list.slice(anchor + 1)];
      }
    }
    let shape = xml.slice(shapeStart, shapeEnd).replace(txBody, header + list.join('') + footer);
    if (name === 'TextBox 8' && cfg.box) shape = setBoxFrame(shape, cfg.box.y, cfg.box.cy);
    if (name === 'TextBox 9' && cfg.box9) {
      shape = shape
        .replace(/<a:off x="-?\d+" y="-?\d+"\/>/, `<a:off x="331286" y="${cfg.box9.y}"/>`)
        .replace(/<a:ext cx="\d+" cy="\d+"\/>/, `<a:ext cx="5924550" cy="${cfg.box9.cy}"/>`);
    }
    xml = xml.slice(0, shapeStart) + shape + xml.slice(shapeEnd);
  }
  return xml;
}

// ------------------------------------------------------- flowchart shapes --
// Native editable PowerPoint shapes (roundRect nodes + arrow connectors) drawn
// into the free band below each slide's text box. Colours follow the template
// accent (0070C0). Coordinates are EMU; slide is 12192000 x 6858000.
let shapeId = 9000; // keep clear of template shape ids
const nid = () => ++shapeId;

function box(id, x, y, w, h, text, { fill = '0070C0', line = '005A9E', font = 'FFFFFF', bold = true, size = 1100, name = 'FC node' } = {}) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name} ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>` +
    `<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` +
    `<a:ln w="12700"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>` +
    `<a:r><a:rPr lang="en-US" sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${font}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${esc(text)}</a:t></a:r>` +
    `</a:p></p:txBody></p:sp>`;
}

function arrow(id, x, y, w, h, { dir = 'right', color = '0070C0' } = {}) {
  const prst = dir === 'right' ? 'rightArrow' : 'downArrow';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="FC arrow ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>` +
    `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
}

// small caption label above a flowchart
function label(id, x, y, w, text) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="FC label ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="320000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l"/>` +
    `<a:r><a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${esc(text)}</a:t></a:r>` +
    `</a:p></p:txBody></p:sp>`;
}

// Slide 3 — approval pipeline (horizontal, left band is illustration; use lower band full-width)
function pipelineFlowchart() {
  const y = 4680000, h = 620000, w = 1500000, gap = 395000;
  const x0 = 609600;
  const steps = [
    ['Application\nreceived', '0070C0'],
    ['Route engine\n(APH combo)', '0070C0'],
    ['Scrutiny', '2E75B6'],
    ['EVC visit', '2E75B6'],
    ['SAC / SHC', '2E75B6'],
    ['Approval +\ncompliance', '1E8E4E'],
  ];
  let xml = label(nid(), x0, y - 380000, 6000000, 'Approval pipeline — automatic routing & stage auto-advance');
  let cx = x0;
  steps.forEach(([t, c], i) => {
    xml += box(nid(), cx, y, w, h, t, { fill: c, line: c });
    if (i < steps.length - 1) xml += arrow(nid(), cx + w + 90000, y + h / 2 - 150000, gap - 180000, 300000, { dir: 'right' });
    cx += w + gap;
  });
  return xml;
}

// Slide 4 — escalation loop (two rows) to explain how deadlines/alerts work
function escalationFlowchart() {
  const w = 2050000, h = 600000, gap = 520000, x0 = 609600;
  const y1 = 4750000, y2 = 5630000;
  const row1 = [
    ['Timeline\nrunning', '0070C0'],
    ['Reminder\n(≤7 d left)', 'E07B00'],
    ['Overdue →\nCRITICAL', 'C62828'],
    ['Alert + audit\nentry', '64748B'],
  ];
  const row2 = [
    ['L1 · Stage owner', '2E75B6'],
    ['L2 · Regional (>7 d)', 'E07B00'],
    ['L3 · Bureau (>15 d)', 'C62828'],
    ['Case disposed', '1E8E4E'],
  ];
  let xml = label(nid(), x0, y1 - 380000, 7000000, 'Deadline → alert → escalation ladder (auto, configurable)');
  let cx = x0;
  row1.forEach(([t, c], i) => {
    xml += box(nid(), cx, y1, w, h, t, { fill: c, line: c, size: 1000 });
    if (i < row1.length - 1) xml += arrow(nid(), cx + w + 80000, y1 + h / 2 - 140000, gap - 160000, 280000, { dir: 'right' });
    cx += w + gap;
  });
  xml += arrow(nid(), x0 + 3 * (w + gap) + w / 2 - 140000, y1 + h + 60000, 280000, y2 - y1 - h - 100000, { dir: 'down' });
  cx = x0;
  row2.forEach(([t, c], i) => {
    xml += box(nid(), cx, y2, w, h, t, { fill: c, line: c, size: 1000 });
    if (i < row2.length - 1) xml += arrow(nid(), cx + w + 80000, y2 + h / 2 - 140000, gap - 160000, 280000, { dir: 'right' });
    cx += w + gap;
  });
  return xml;
}

const FLOWCHARTS = { 3: pipelineFlowchart, 4: escalationFlowchart };

// inject flowchart shapes before the slide's closing </p:spTree>
function addShapes(xml, fragment) {
  const marker = '</p:spTree>';
  const at = xml.indexOf(marker);
  if (at < 0) throw new Error('no spTree');
  return xml.slice(0, at) + fragment + xml.slice(at);
}

// rewrite sub-bullets with clean hanging indent + explicit bullet so they align
// consistently under their pointer, at a slightly smaller size for density
function alignSubs(xml) {
  return xml.replace(/<a:p>(?=<a:pPr[^>]*lvl="1"[\s\S]*?<a:r>)/g, '<a:p>');
}

// ------------------------------------------------------------------- build --
const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));

for (const [n, cfg] of Object.entries(CONTENT)) {
  const key = `ppt/slides/slide${n}.xml`;
  let xml = await zip.file(key).async('string');
  xml = applySlide(xml, cfg);
  if (FLOWCHARTS[n]) xml = addShapes(xml, FLOWCHARTS[n]());
  zip.file(key, xml);
}

// footer team-name placeholder on content slides
for (let n = 2; n <= 6; n++) {
  const key = `ppt/slides/slide${n}.xml`;
  const xml = await zip.file(key).async('string');
  zip.file(key, xml.replace(/<a:t>Your Team Name<\/a:t>/g, `<a:t>${esc(PS.teamName)}</a:t>`));
}

// ---- delete slide 7 (IMPORTANT INSTRUCTIONS — its own note allows removal) --
zip.remove('ppt/slides/slide7.xml');
zip.remove('ppt/slides/_rels/slide7.xml.rels');
zip.remove('ppt/notesSlides/notesSlide6.xml');
zip.remove('ppt/notesSlides/_rels/notesSlide6.xml.rels');

const pres = await zip.file('ppt/presentation.xml').async('string');
zip.file('ppt/presentation.xml', pres.replace('<p:sldId id="297" r:id="rId8"/>', ''));

const presRels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
zip.file('ppt/_rels/presentation.xml.rels',
  presRels.replace(/<Relationship Id="rId8"[^>]*slides\/slide7\.xml"\/>/, ''));

const ct = await zip.file('[Content_Types].xml').async('string');
zip.file('[Content_Types].xml', ct
  .replace(/<Override PartName="\/ppt\/slides\/slide7\.xml"[^>]*\/>/, '')
  .replace(/<Override PartName="\/ppt\/notesSlides\/notesSlide6\.xml"[^>]*\/>/, ''));

const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(OUTPUT, out);
console.log(`Wrote ${path.resolve(OUTPUT)} (${(out.length / 1024).toFixed(0)} KB)`);
