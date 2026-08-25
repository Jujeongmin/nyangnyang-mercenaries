// 원화를 줄인 뒤 **좌표 데이터를 같은 비율로** 줄인다.
//
// 왜 필요한가 — assets/trim.json 과 assets/cutout/*.json 은 값이 **원화 픽셀
// 좌표**다. rig.js 가 trim.x/y/w/h 를 그대로 mesh pivot 에 넣고(발밑 기준),
// cutout.js 가 polygon/pivot 을 원본 이미지 위에 그려 팔을 도려낸다.
// 그림만 절반으로 줄이면 이 좌표들이 두 배 자리를 가리켜 발밑과 어깨가 어긋난다.
//
// 쓰는 법:
//   node tools/rescale-coords.mjs 0.5 char boss enemy
//
// 폴더 이름으로 **어느 id 를 건드릴지** 고른다 — captain 처럼 안 줄인 폴더의
// 좌표까지 같이 줄이면 그쪽이 깨진다. id 접두사로 폴더를 판별한다.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../game/public/assets');
const scale = Number(process.argv[2]);
const dirs = process.argv.slice(3);

if (!(scale > 0) || !dirs.length) {
  console.error('사용법: node tools/rescale-coords.mjs <배율> <폴더…>');
  process.exit(1);
}

/** id 가 어느 폴더 것인가. trim.json 은 폴더 없이 id 만 들고 있다 */
function dirOf(id) {
  if (/^captain/.test(id)) return 'captain';
  if (/^(B|DGB)-/.test(id)) return 'boss';
  if (/^E-/.test(id)) return 'enemy';
  return 'char';
}

/** 숫자만 배율로 줄인다. 정수 좌표라 반올림한다 */
function scaleNums(v, key) {
  if (typeof v === 'number') {
    // 면적은 배율의 **제곱**이다 — 길이와 같이 줄이면 eh 산출이 어긋난다
    if (key === 'area') return Math.round(v * scale * scale);
    return Math.round(v * scale);
  }
  if (Array.isArray(v)) return v.map(x => scaleNums(x));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = scaleNums(x, k);
    return o;
  }
  return v;
}

// ── trim.json ──────────────────────────────────────────────
const trimPath = resolve(ROOT, 'trim.json');
const trim = JSON.parse(readFileSync(trimPath, 'utf8'));
let nTrim = 0;
for (const id of Object.keys(trim)) {
  if (!dirs.includes(dirOf(id))) continue;
  trim[id] = scaleNums(trim[id]);
  nTrim++;
}
writeFileSync(trimPath, JSON.stringify(trim, null, 1) + '\n');
console.log(`trim.json: ${nTrim}개 항목 x${scale}`);

// ── cutout/*.json ──────────────────────────────────────────
const cutDir = resolve(ROOT, 'cutout');
let nCut = 0;
if (existsSync(cutDir)) {
  for (const f of readdirSync(cutDir)) {
    if (!f.endsWith('.json')) continue;
    const id = f.replace(/\.json$/, '');
    if (!dirs.includes(dirOf(id))) continue;
    const p = resolve(cutDir, f);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    // id·cat·mirror 같은 비좌표 필드는 건드리지 않는다
    const { id: _i, cat: _c, mirror: _m, ...coords } = j;
    writeFileSync(p, JSON.stringify({ ..._i !== undefined ? { id: _i } : {},
      ..._c !== undefined ? { cat: _c } : {},
      ...scaleNums(coords),
      ..._m !== undefined ? { mirror: _m } : {} }, null, 1) + '\n');
    nCut++;
  }
}
console.log(`cutout/*.json: ${nCut}개 파일 x${scale}`);
