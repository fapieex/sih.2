import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import fs from 'node:fs';

const buf = fs.readFileSync('SIH2026_Idea_Submission_AICTE_Approval_Platform.pptx');
const zip = await JSZip.loadAsync(buf);

// collect all xml parts that must be well-formed
const parts = [];
for (const name of Object.keys(zip.files)) {
  if (name.endsWith('.xml') || name.endsWith('.rels')) parts.push(name);
}

let bad = 0;
const required = [
  'ppt/presentation.xml',
  '[Content_Types].xml',
  'ppt/_rels/presentation.xml.rels',
  ...[1, 2, 3, 4, 5, 6].map(n => `ppt/slides/slide${n}.xml`),
  ...[1, 2, 3, 4, 5, 6].map(n => `ppt/slides/_rels/slide${n}.xml.rels`),
];

for (const p of required) {
  if (!zip.file(p)) { console.log(`MISSING required part: ${p}`); bad++; }
}

for (const name of parts) {
  const xml = await zip.file(name).async('string');
  const res = XMLValidator.validate(xml);
  if (res !== true) { console.log(`INVALID XML ${name}:`, JSON.stringify(res.err || res)); bad++; }
}

// structural assertions
const pres = await zip.file('ppt/presentation.xml').async('string');
const rels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
const ct = await zip.file('[Content_Types].xml').async('string');

const checks = [
  ['slide count in sldIdLst is 6', (pres.match(/<p:sldId /g) || []).length === 6],
  ['slide7 rel removed', !rels.includes('slide7.xml')],
  ['rId8 (slide7) removed from presentation rels', !/Id="rId8"/.test(rels)],
  ['slide7 content-type override removed', !ct.includes('/ppt/slides/slide7.xml')],
  ['no dangling rId8 in sldIdLst', !pres.includes('rId8')],
  ['slide7 part absent', !zip.file('ppt/slides/slide7.xml')],
  ['notesSlide6 part absent', !zip.file('ppt/notesSlides/notesSlide6.xml')],
];

for (const [label, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}`); if (!ok) bad++; }

// every rId referenced in presentation.xml sldIdLst must exist in rels
const used = [...pres.matchAll(/r:id="(rId\d+)"/g)].map(m => m[1]);
const defined = new Set([...rels.matchAll(/Id="(rId\d+)"/g)].map(m => m[1]));
const dangling = used.filter(r => !defined.has(r));
console.log(dangling.length === 0 ? 'PASS — all sldIdLst rIds are defined' : `FAIL — dangling: ${dangling}`);
if (dangling.length) bad++;

console.log(bad === 0 ? `\nALL CHECKS PASS — ${parts.length} XML parts well-formed` : `\n${bad} PROBLEM(S)`);
process.exit(bad ? 1 : 0);
