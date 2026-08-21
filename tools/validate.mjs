// data/*.json 불변식 검증. 밸런스 수치를 건드렸으면 이걸 먼저 돌려라.
//   node tools/validate.mjs
// 검증 규칙 본체는 app/src/core/data.js > validate() 다 — 게임과 같은 코드를 쓴다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validate } from '../app/src/core/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'characters', 'skills', 'gacha', 'equipment', 'combat', 'stages', 'dungeons',
  'quests', 'economy', 'goldsinks', 'arena', 'alliance', 'ranking', 'codex', 'dailies',
  'free1000', 'ui', 'shop', 'pass', 'profile', 'tutorial', 'sound', 'save-schema',
];

const D = {};
for (const n of FILES) {
  const p = path.join(ROOT, 'data', n + '.json');
  if (!fs.existsSync(p)) { console.error(`없음: data/${n}.json`); process.exit(1); }
  D[n.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = JSON.parse(fs.readFileSync(p, 'utf8'));
}

const errs = validate(D);
if (errs.length) {
  console.error(`불변식 ${errs.length}건 위반:`);
  for (const e of errs) console.error('  · ' + e);
  process.exit(1);
}
console.log(`불변식 전부 통과 (${FILES.length}개 파일)`);
