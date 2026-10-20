// Assembles the platform demo video from the browser recordings.
// For each source it runs ffmpeg freezedetect, keeps only the "active" windows
// (complement of freezes >= FREEZE_MIN), re-encodes each window to a uniform
// H.264 profile, and concatenates everything into one MP4.
//
// Usage:  node scripts/assemble_demo.mjs [--dry]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FF = 'tools/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe';
const RB = 'C:/Users/epicd/AppData/Roaming/Freebuff/browser-recordings/';
const OUT_DIR = 'demo-video';
const WORK = path.join(OUT_DIR, 'clips');
const FINAL = path.join(OUT_DIR, 'AICTE_Platform_Demo.mp4');

const FREEZE_MIN = 8;     // freeze length worth cutting (seconds) — short pauses stay for continuity
const KEEP_FREEZE = 1.0;  // breathing room kept at each freeze edge (seconds)
const MIN_CLIP = 1.2;     // drop keep-windows shorter than this

// Segment order forms the demo narrative. Each entry: source file + label.
const SOURCES = [
  // minStart clamps window starts; maxFirstEnd caps window 0 — S1's login page idles
  // from t≈20, the sign-in click is in the next window (t≈81), so drop the dead tail
  ['1792433497165-c48f10a7-b7bd-4dd3-8dae-9cd8c258488b.webm', 'S1_login_dashboard', { minStart: 12, maxFirstEnd: 20 }],
  ['1792434395471-2b602c3b-97e6-4af9-8b73-326f6debca7d.webm', 'S2_workflow_case'],
  ['1792434665794-b79ff0ba-0f15-41ac-8039-1dfb687049cd.webm', 'S3_evc_scrutiny'],
  // minStart drops windows that end before it — S4 opens on 76s of dashboard already shown in S1
  ['1792477776237-ae1ec222-fe34-4699-9a4a-0ece110d1947.webm', 'S4_compliance', { minStart: 70 }],
];

const dry = process.argv.includes('--dry');
const run = (args, opts = {}) => execFileSync(FF, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const runSh = (cmd) => execFileSync('bash', ['-lc', cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function ffprobeDuration(file) {
  const out = runSh(`"${FF}" -i "${file}" -f null - 2>&1 | grep -oP "time=\\K[0-9:.]+" | tail -1`);
  const [h, m, s] = out.trim().split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function freezeIntervals(file) {
  const out = runSh(`"${FF}" -i "${file}" -vf "freezedetect=n=-60dB:d=${FREEZE_MIN}" -f null - 2>&1 | grep -E "freeze_(start|duration)" | sed 's/.*] //'`);
  const lines = out.trim().split('\n').filter(Boolean);
  const intervals = [];
  let start = null;
  for (const line of lines) {
    if (line.startsWith('lavfi.freezedetect.freeze_start')) start = parseFloat(line.split(':')[1]);
    else if (line.startsWith('lavfi.freezedetect.freeze_duration') && start !== null) {
      intervals.push([start, start + parseFloat(line.split(':')[1])]);
      start = null;
    }
  }
  if (start !== null) intervals.push([start, Infinity]); // freeze runs to EOF
  return intervals;
}

function activeWindows(file) {
  const dur = ffprobeDuration(file);
  const raw = freezeIntervals(file);
  const freezes = [];
  for (const iv of raw) { // merge overlapping/adjacent
    const last = freezes[freezes.length - 1];
    if (last && iv[0] <= last[1] + 0.01) last[1] = Math.max(last[1], iv[1]);
    else freezes.push([...iv]);
  }
  const windows = [];
  let cursor = 0;
  for (const [s, e] of freezes) {
    if (s - cursor >= MIN_CLIP) windows.push([cursor, Math.min(s + KEEP_FREEZE, dur)]);
    cursor = Math.max(cursor, e - KEEP_FREEZE);
  }
  if (dur - cursor >= MIN_CLIP) windows.push([cursor, dur]);
  return { dur, freezes, windows };
}

fs.mkdirSync(WORK, { recursive: true });
const concatList = [];
let idx = 0;

for (const [name, label, opts = {}] of SOURCES) {
  const src = path.join(RB, name);
  const { dur, freezes, windows: rawWindows } = activeWindows(src);
  const windows = rawWindows
    .map(([a, b], i) => [Math.max(a, opts.minStart ?? 0), opts.maxFirstEnd && i === 0 ? Math.min(b, opts.maxFirstEnd) : b])
    .filter(([a, b]) => b > a);
  const frozen = freezes.reduce((a, [s, e]) => a + (Math.min(e, dur) - s), 0);
  console.log(`\n${label}: ${dur.toFixed(1)}s total, ~${frozen.toFixed(1)}s frozen -> ${windows.length} active windows`);
  for (const [a, b] of windows) console.log(`  keep ${a.toFixed(1)}-${b.toFixed(1)} (${(b - a).toFixed(1)}s)`);
  if (dry) continue;

  let k = 0;
  for (const [a, b] of windows) {
    const clip = path.join(WORK, `${String(idx).padStart(3, '0')}_${label}_${k++}.mp4`);
    run(['-y', '-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', src,
      '-vf', 'scale=1280:798,fps=30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-an', '-movflags', '+faststart', clip]);
    concatList.push(`file '${path.resolve(clip).replace(/\\/g, '/')}'`);
    process.stdout.write('.');
  }
  idx++;
}

if (!dry && concatList.length) {
  const listFile = path.join(WORK, 'concat.txt');
  fs.writeFileSync(listFile, concatList.join('\n'));
  run(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', FINAL]);
  const size = fs.statSync(FINAL).size;
  console.log(`\nWrote ${FINAL} (${(size / 1024 / 1024).toFixed(1)} MB, ${concatList.length} clips)`);
}
