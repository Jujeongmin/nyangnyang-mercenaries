// 원화 해상도 축소의 **받는 쪽**. webp-sink.mjs 와 같은 구조다 (인코더는 브라우저).
//
// 왜 축소인가 — 측정 결과(2026-08-25):
//   같은 크기로 webp 재인코딩:  363KB -> 349KB   (0~5%, 때로는 더 커진다)
//   50% 로 줄이고 webp:         363KB -> 122KB   (약 65% 절감)
// 원화가 전부 1024~1536px 인데 화면에서는 100~200px 로 그려진다. 남는 해상도는
// 배포 용량으로만 나간다.
//
// **좌표가 걸린 폴더는 여기서 안 다룬다.** char/boss/enemy/captain 은
// assets/trim.json 과 cutout/*.json 이 원화 픽셀 좌표를 들고 있어서, 그림만
// 줄이면 발밑·어깨 기준점이 어긋난다. 그 폴더는 좌표까지 같이 줄이는 별도 작업이다.
//
// 쓰는 법:
//   node tools/shrink-sink.mjs            # 5198 포트에서 대기
//   브라우저(개발 서버로 연 게임 페이지) 콘솔에서:
//
//   const list = await (await fetch('http://127.0.0.1:5198/list')).json();
//   for (const it of list) {
//     const bmp = await createImageBitmap(await (await fetch('/assets/' + it.path)).blob());
//     const c = new OffscreenCanvas(Math.round(bmp.width * it.scale), Math.round(bmp.height * it.scale));
//     const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
//     g.drawImage(bmp, 0, 0, c.width, c.height);
//     const b = await c.convertToBlob({ type: 'image/webp', quality: 0.88 });
//     await fetch('http://127.0.0.1:5198/save?path=' + encodeURIComponent(it.path), { method: 'POST', body: b });
//   }
//
// **개발 전용이다.** 경로는 화이트리스트 폴더 + 파일명만 받는다.

import { createServer } from 'node:http';
import { writeFile, unlink } from 'node:fs/promises';
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../game/public/assets');
// 기본값은 **좌표가 안 걸린 폴더**다. char/boss/enemy 처럼 trim.json·cutout 이
// 원화 픽셀 좌표를 들고 있는 폴더는 인자로 명시해서 돌리고, 끝나면 반드시
// `node tools/rescale-coords.mjs 0.5 <폴더…>` 로 좌표도 같은 비율로 줄인다.
//   예) node tools/shrink-sink.mjs char boss enemy
const SAFE_DIRS = ['fx', 'ui', 'bg', 'art', 'dungeon', 'alliance'];
const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : SAFE_DIRS;
// 이 픽셀 이상만 줄인다. 아이콘(64~256)은 이미 표시 크기에 가깝다
const MIN_SIDE = 900;
// 스프라이트 **시트**는 뺀다 — CSS steps() 애니메이션이 프레임 좌표에 걸려 있고,
// 코드가 `FO-0${n}-STRIP.png` 처럼 확장자를 박아 부른다
const SKIP = /^FO-/i;
const SCALE = 0.5;
const PORT = 5198;

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();

  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/list') {
    const out = [];
    for (const d of DIRS) {
      const full = resolve(ROOT, d);
      if (!existsSync(full)) continue;
      for (const f of readdirSync(full)) {
        if (!/\.(png|webp)$/i.test(f) || SKIP.test(f)) continue;
        const p = resolve(full, f);
        const dim = dimensions(p);
        if (!dim || Math.max(dim.w, dim.h) < MIN_SIDE) continue;
        out.push({ path: `${d}/${f}`, w: dim.w, h: dim.h,
          kb: Math.round(statSync(p).size / 1024), scale: SCALE });
      }
    }
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(out));
  }

  if (req.method !== 'POST' || url.pathname !== '/save') {
    res.writeHead(404); return res.end('POST /save?path=<폴더/파일명>');
  }

  const rel = url.searchParams.get('path') || '';
  const dir = dirname(rel);
  const name = basename(rel);
  if (!DIRS.includes(dir)) { res.writeHead(400); return res.end('알 수 없는 폴더'); }
  if (!/^[\w.-]+\.(png|webp)$/i.test(name)) { res.writeHead(400); return res.end('파일명 형식'); }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);

  const src = resolve(ROOT, dir, name);
  const before = existsSync(src) ? statSync(src).size : 0;
  // 결과는 **항상 .webp** 다. 원본이 png 면 png 를 지우고 webp 를 남긴다 —
  // loadSprite 와 CSS 참조가 webp 를 먼저 찾으므로 코드 수정이 필요 없다…
  // 단, CSS/HTML 이 .png 를 직접 박아 둔 곳은 별도로 고쳐야 해서 응답에 알린다
  const outName = name.replace(/\.(png|webp)$/i, '.webp');
  await writeFile(resolve(ROOT, dir, outName), buf);
  if (outName !== name) await unlink(src).catch(() => {});

  console.log(`${dir}/${outName}  ${(before / 1024).toFixed(0)} -> ${(buf.length / 1024).toFixed(0)}KB`
    + (outName !== name ? '  (png 삭제)' : ''));
  res.end(JSON.stringify({ before, after: buf.length, renamed: outName !== name ? outName : null }));
}).listen(PORT, '127.0.0.1', () => console.log(`shrink-sink :${PORT} → ${ROOT}`));

/** PNG/WebP 헤더에서 크기만 읽는다 (디코더 없이) */
function dimensions(p) {
  const b = readFileSync(p);
  if (b.toString('ascii', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString('ascii', 0, 4) === 'RIFF') {
    const t = b.toString('ascii', 12, 16);
    if (t === 'VP8X') return { w: (b.readUIntLE(24, 3) & 0xffffff) + 1, h: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
    if (t === 'VP8L') { const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }; }
    if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}
