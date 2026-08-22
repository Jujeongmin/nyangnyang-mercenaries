// 배경 지우개 저장 API — Vite dev 서버에만 붙는 미들웨어.
//
// `game/bgedit.html` 이 캔버스에서 알파를 지우고 **완성된 PNG 바이트**를 보낸다.
// 서버는 픽셀을 만지지 않는다 — 이미지 라이브러리 의존을 안 만들려는 것이다
// (tools/cutbg.js 의 pngjs 는 tools/node_modules 에 있어 루트에서 못 쓴다).
//
// 덮어쓰기 전에 원본을 `.bgedit-backup/<cat>/<id>.<timestamp>.png` 로 남긴다.
// git 이 있어도 **미커밋 상태의 파일**은 git 으로 못 되돌리기 때문이다.
//
// 빌드에는 안 들어간다. `apply: 'serve'` 로 dev 에서만 산다.

import fs from 'node:fs';
import path from 'node:path';

const CATS = ['char', 'enemy', 'boss', 'captain', 'equip', 'skill', 'ui', 'art'];
const ID_RE = /^[A-Za-z0-9_-]+$/;          // 경로 탈출 차단
const MAX_BYTES = 24 * 1024 * 1024;

export function bgeditPlugin(root = process.cwd()) {
  const assetsDir = path.join(root, 'game', 'public', 'assets');
  const backupDir = path.join(root, '.bgedit-backup');

  /** cat/id 를 실제 경로로. 화이트리스트 밖이면 null */
  const resolve = (cat, id) => {
    if (!CATS.includes(cat) || !ID_RE.test(id)) return null;
    const p = path.join(assetsDir, cat, id + '.png');
    // path.join 뒤에도 한 번 더 본다 — 화이트리스트가 뚫려도 여기서 막힌다
    if (!p.startsWith(assetsDir)) return null;
    return p;
  };

  const json = (res, code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  };

  return {
    name: 'bgedit-api',
    apply: 'serve',
    configureServer(server) {
      // 목록 — 편집 대상 후보
      server.middlewares.use('/__bgedit/list', (req, res) => {
        const out = [];
        for (const cat of CATS) {
          const d = path.join(assetsDir, cat);
          if (!fs.existsSync(d)) continue;
          for (const f of fs.readdirSync(d)) {
            if (!f.toLowerCase().endsWith('.png')) continue;
            const id = f.slice(0, -4);
            if (!ID_RE.test(id)) continue;
            out.push({ cat, id, size: fs.statSync(path.join(d, f)).size });
          }
        }
        json(res, 200, { cats: CATS, files: out });
      });

      // 저장 — 본문은 PNG 바이트 그대로
      server.middlewares.use('/__bgedit/save', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        const u = new URL(req.url, 'http://x');
        const cat = u.searchParams.get('cat');
        const id = u.searchParams.get('id');
        const dest = resolve(cat, id);
        if (!dest) return json(res, 400, { error: `허용되지 않는 대상: ${cat}/${id}` });
        if (!fs.existsSync(dest)) return json(res, 404, { error: '파일 없음' });

        const chunks = [];
        let n = 0;
        req.on('data', c => {
          n += c.length;
          if (n > MAX_BYTES) { req.destroy(); return; }
          chunks.push(c);
        });
        req.on('end', () => {
          const buf = Buffer.concat(chunks);
          // PNG 시그니처 확인. 빈 본문이나 잘린 업로드로 에셋을 날리지 않는다
          const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
          if (buf.length < 1000 || !buf.subarray(0, 8).equals(sig)) {
            return json(res, 400, { error: 'PNG 가 아니거나 너무 작다' });
          }
          const bdir = path.join(backupDir, cat);
          fs.mkdirSync(bdir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const bak = path.join(bdir, `${id}.${stamp}.png`);
          fs.copyFileSync(dest, bak);
          fs.writeFileSync(dest, buf);
          console.log(`[bgedit] 저장 ${cat}/${id}.png  (백업 ${path.relative(root, bak)})`);
          json(res, 200, { ok: true, backup: path.relative(root, bak).replace(/\\/g, '/') });
        });
      });

      // 되돌리기 — 가장 최근 백업으로
      server.middlewares.use('/__bgedit/revert', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        const u = new URL(req.url, 'http://x');
        const cat = u.searchParams.get('cat');
        const id = u.searchParams.get('id');
        const dest = resolve(cat, id);
        if (!dest) return json(res, 400, { error: '허용되지 않는 대상' });
        const bdir = path.join(backupDir, cat);
        if (!fs.existsSync(bdir)) return json(res, 404, { error: '백업 없음' });
        const baks = fs.readdirSync(bdir)
          .filter(f => f.startsWith(id + '.') && f.endsWith('.png'))
          .sort();
        if (!baks.length) return json(res, 404, { error: '백업 없음' });
        const last = baks[baks.length - 1];
        fs.copyFileSync(path.join(bdir, last), dest);
        console.log(`[bgedit] 되돌림 ${cat}/${id}.png ← ${last}`);
        json(res, 200, { ok: true, from: last });
      });
    },
  };
}
