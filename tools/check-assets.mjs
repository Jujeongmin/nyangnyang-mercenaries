// 코드가 부르는 그림 경로가 **실제로 있는지** 검사한다.
//
// 해상도 축소로 png 를 webp 로 갈면서 참조를 여러 번 놓쳤다 (제작대 배너,
// 던전 배너, 소환진, 전투 이펙트, 상점 소환 그림…). 전부 `${}` 로 조립하는
// 경로라 눈으로는 안 걸린다. 조립 부분을 * 로 두고 폴더에서 후보를 찾는다.
//
//   node tools/check-assets.mjs
// 나가는 값: 없는 참조가 있으면 1

import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const ROOT = 'game/public';
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

const srcFiles = [...walk('game/src'), 'game/index.html']
  .filter(f => /\.(js|html)$/.test(f) && existsSync(f));

// /assets/... 로 시작하는 문자열을 뽑는다. ${...} 는 * 로 접는다
const RE = /\/assets\/[A-Za-z0-9_./${}()|?:'"` -]*?\.(png|webp|jpg)/g;
const missing = [];
const checked = new Set();

for (const f of srcFiles) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.match(RE) || []) {
    const path = m.replace(/\$\{[^}]*\}/g, '*');
    if (checked.has(path)) continue;
    checked.add(path);
    if (path.includes('*')) {
      // 조립 경로 — 폴더에 그 확장자 파일이 하나라도 있으면 통과로 본다
      const dir = join(ROOT, path.slice(0, path.lastIndexOf('/')));
      const ext = path.slice(path.lastIndexOf('.'));
      if (!existsSync(dir)) { missing.push(`${path}  (폴더 없음)  ← ${f}`); continue; }
      const any = readdirSync(dir).some(x => x.endsWith(ext));
      if (!any) missing.push(`${path}  (${dir} 에 ${ext} 가 하나도 없다)  ← ${f}`);
    } else {
      const full = join(ROOT, path);
      if (!existsSync(full)) missing.push(`${path}  ← ${f}`);
    }
  }
}

console.log(`참조 ${checked.size}종 검사`);
if (missing.length) {
  console.log(`\n없는 참조 ${missing.length}건:`);
  for (const m of missing) console.log('  ' + m.split(sep).join('/'));
  process.exit(1);
}
console.log('전부 존재한다.');
