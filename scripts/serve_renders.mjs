// Tiny static server to view rendered slide PNGs in the browser panel.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'screenshots', 'render');
const PORT = Number(process.argv[2] || 5199);

const TYPES = { '.png': 'image/png', '.html': 'text/html', '.jpg': 'image/jpeg' };

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '/index.html') {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
    const links = files.map(f => `<a href="/${f}"><img src="/${f}" style="width:480px;margin:8px;border:1px solid #333"></a>`).join('<br>');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<body style="background:#222;margin:0"><h3 style="color:#fff">Rendered slides</h3>${links}</body>`);
    return;
  }
  const file = path.join(DIR, path.basename(urlPath));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => console.log(`renders at http://localhost:${PORT}`));
