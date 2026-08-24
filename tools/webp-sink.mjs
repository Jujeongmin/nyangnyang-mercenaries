// PNG → WebP 변환의 **받는 쪽**.
//
// 이 저장소에는 WebP 인코더가 없다 — sharp·PIL·cwebp 전부 없고 tools/ 의
// 의존성(pngjs·puppeteer)도 설치돼 있지 않다. 그런데 인코더는 이미 하나 있다:
// **브라우저**. Chromium 의 canvas.convertToBlob({type:'image/webp'}) 이
// libwebp 그 자체다.
//
// 그래서 인코딩은 브라우저(개발 서버로 연 게임 페이지)가 하고, 여기는 그 바이트를
// 받아 파일로 떨어뜨리기만 한다. 새 npm 패키지가 하나도 안 붙는다.
//
// 쓰는 법:
//   node tools/webp-sink.mjs            # 5199 포트에서 대기
//   (브라우저 콘솔에서 아래를 실행 — 같은 오리진에서 png 를 읽어 webp 로 보낸다)
//
//   for (const n of ['TT-BG','TT-CLOUD']) {
//     const bmp = await createImageBitmap(await (await fetch(`/assets/ui/${n}.png`)).blob());
//     const c = new OffscreenCanvas(bmp.width, bmp.height);
//     c.getContext('2d').drawImage(bmp, 0, 0);
//     const b = await c.convertToBlob({ type: 'image/webp', quality: .85 });
//     await fetch(`http://127.0.0.1:5199/save?name=${n}.webp`, { method: 'POST', body: b });
//   }
//
// **개발 전용이다.** 임의 경로 쓰기를 막기 위해 파일명만 받고 폴더는 여기서 고정한다.

import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';

// 어느 에셋 폴더로 떨어뜨릴지는 ?dir= 로 받는다. 목록에 없는 폴더는 거부한다
const ROOT = resolve(import.meta.dirname, '../game/public/assets');
const DIRS = ['ui', 'boss', 'enemy', 'char', 'captain', 'bg', 'fx', 'skill', 'equip', 'dungeon', 'alliance', 'art'];
const PORT = 5199;

createServer(async (req, res) => {
  // 브라우저가 다른 포트(5180)에서 부르므로 CORS 를 연다. 로컬 전용 도구다
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();

  const url = new URL(req.url, 'http://x');
  if (req.method !== 'POST' || url.pathname !== '/save') {
    res.writeHead(404); return res.end('POST /save?name=<파일명>');
  }
  // basename 으로 자른다 — `../` 가 섞여 들어와도 OUT_DIR 밖으로 못 나간다
  const name = basename(url.searchParams.get('name') || '');
  const dir = url.searchParams.get('dir') || 'ui';
  if (!DIRS.includes(dir)) { res.writeHead(400); return res.end('알 수 없는 폴더'); }
  if (!/^[\w.-]+\.webp$/.test(name)) {
    res.writeHead(400); return res.end('.webp 파일명만 받는다');
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  await writeFile(resolve(ROOT, dir, name), buf);
  console.log(`${dir}/${name}  ${(buf.length / 1024).toFixed(0)}KB`);
  res.end(String(buf.length));
}).listen(PORT, '127.0.0.1', () => console.log(`webp-sink :${PORT} → ${ROOT}`));
