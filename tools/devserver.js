// 개발 서버. 정적 파일 + 컷아웃 저장 엔드포인트.
//
//   node tools/devserver.js [포트]
//
// http-server 로는 컷아웃 편집기가 결과를 저장할 수 없다(업로드 미지원).
// 그래서 POST /api/cutout/<ID> 하나만 더 받는다.

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.argv[2] || 5180);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.md': 'text/markdown; charset=utf-8',
};

function listDir(dir, urlPath, res) {
  const items = fs.readdirSync(dir).sort();
  const rows = items.map(n => {
    const isDir = fs.statSync(path.join(dir, n)).isDirectory();
    return `<li><a href="${encodeURIComponent(n)}${isDir ? '/' : ''}">${n}${isDir ? '/' : ''}</a></li>`;
  }).join('');
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  res.end(`<meta charset="utf-8"><h3>${urlPath}</h3><ul>${rows}</ul>`);
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  // --- 컷아웃 저장 ---
  if (req.method === 'POST' && url.startsWith('/api/cutout/')) {
    const id = url.slice('/api/cutout/'.length).replace(/[^\w.-]/g, '');
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        const json = JSON.parse(body);
        const dir = path.join(ROOT, 'assets', 'cutout');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(json, null, 2));
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: true, saved: `assets/cutout/${id}.json` }));
        console.log(`저장 assets/cutout/${id}.json  (점 ${json.polygon?.length ?? 0}개)`);
      } catch (e) {
        res.writeHead(400); res.end(String(e.message));
      }
    });
    return;
  }

  // --- 정적 ---
  const p = path.join(ROOT, url);
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('404 ' + url); }
  if (fs.statSync(p).isDirectory()) {
    const idx = path.join(p, 'index.html');
    if (fs.existsSync(idx)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      return fs.createReadStream(idx).pipe(res);
    }
    return listDir(p, url, res);
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(p)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`http://localhost:${PORT}/app/         게임`);
  console.log(`http://localhost:${PORT}/app/cutout.html   컷아웃 편집기`);
});
