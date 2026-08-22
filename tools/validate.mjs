// data/*.json 불변식 검증. 밸런스 수치를 건드렸으면 이걸 먼저 돌려라.
//   node tools/validate.mjs
// 검증 규칙 본체는 app/src/core/data.js > validate() 다 — 게임과 같은 코드를 쓴다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validate } from '../game/src/core/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'characters', 'skills', 'gacha', 'equipment', 'combat', 'stages', 'dungeons',
  'quests', 'economy', 'goldsinks', 'arena', 'alliance', 'ranking', 'codex', 'dailies',
  'free1000', 'ui', 'shop', 'pass', 'profile', 'tutorial', 'sound', 'save-schema',
];

const D = {};
for (const n of FILES) {
  const p = path.join(ROOT, 'game/public/data', n + '.json');
  if (!fs.existsSync(p)) { console.error(`없음: data/${n}.json`); process.exit(1); }
  D[n.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = JSON.parse(fs.readFileSync(p, 'utf8'));
}

const errs = validate(D);

// ── 퀘스트 사슬 — 목표 재화를 이전 보상으로 채울 수 있나 ──────────
// 못 채우면 무과금이 그 퀘스트에서 영구히 멈춘다 (quests.json > chainInvariant).
// 실제로 Q9(스킬 소환 24회)가 누적 23장으로 1장 모자라 막혀 있었다.
{
  const qs = D.quests.explicitQuests || [];
  const NEED = { mercenary_summon: 'merc_ticket', skill_summon: 'skill_ticket' };
  qs.forEach((q, i) => {
    const need = NEED[q.type];
    if (!need) return;
    const cum = qs.slice(0, i).reduce((a, x) => a + ((x.rewards || {})[need] || 0), 0);
    if (cum < q.target) {
      errs.push(`quests Q${q.q} ${q.type}: ${need} 누적 ${cum} < 목표 ${q.target} — 사슬이 끊긴다`);
    }
  });
}
if (errs.length) {
  console.error(`불변식 ${errs.length}건 위반:`);
  for (const e of errs) console.error('  · ' + e);
  process.exit(1);
}
console.log(`불변식 전부 통과 (${FILES.length}개 파일)`);
