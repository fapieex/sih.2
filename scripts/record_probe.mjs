import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const REC = 'C:/Users/epicd/AppData/Roaming/Freebuff/browser-recordings';
const FILE = '1792428326809-34b16ca9-9556-4141-80c4-d011c3ccea5d.webm';
const PORT = 5201;

const HTML = `<!doctype html><html><body style="margin:0;background:#111">
<video id="v" width="1280" height="720" controls src="/video.webm"></video>
<script>
window.seek = async (t) => {
  const v = document.getElementById('v');
  v.currentTime = t;
  await new Promise(r => { v.onseeked = r; setTimeout(r, 3000); });
  return v.currentTime;
};
</script></body></html>`;

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/probe') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HTML); return; }
  if (url === '/video.webm') {
    const stat = fs.statSync(path.join(REC, FILE));
    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d+)-(\d*)/);
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : stat.size - 1;
      res.writeHead(206, {
        'Content-Type': 'video/webm',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(path.join(REC, FILE), { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(path.join(REC, FILE)).pipe(res);
    }
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log('probe at http://localhost:' + PORT));
