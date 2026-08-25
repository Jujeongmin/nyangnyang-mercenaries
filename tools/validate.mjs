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
  'free1000', 'events', 'ui', 'shop', 'pass', 'profile', 'tutorial', 'sound', 'save-schema',
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
// ── 던전 해금 ↔ 사이클 정합 ──────────────────────────────────
// 해금 퀘스트가 던전 칸 **이후**면 잠긴 던전을 깨라는 퀘스트가 걸린다 — Q5 황금
// 광산에서 실제로 났던 사고다. 표가 바뀔 때마다 손으로 다시 세지 않도록 여기서 잰다.
//
// 던전 칸의 위치는 **박아 두지 않는다.** 사이클 길이가 7 → 9 로 바뀌었을 때
// `N ≡ 5 (mod 7)` 이 그대로 남아 있으면, 검사기가 있지도 않은 칸을 재면서
// 통과를 뱉는다. 슬롯 표에서 dungeon_floor 가 몇 번째인지 직접 찾는다.
{
  const BY_CYCLE = ['gold_mine', 'gold_mine', 'treasure_vault', 'gold_mine', 'tower',
    'furnace', 'tower', 'crystal_cave', 'tower', 'trial_tower'];   // quest.js 와 같아야 한다
  const len = D.quests.cycle.length;
  const dgSlot = D.quests.cycle.slots.findIndex(s => s.type === 'dungeon_floor') + 1;
  if (!dgSlot) errs.push('quests cycle.slots 에 dungeon_floor 칸이 없다');
  for (let k = 1; dgSlot && k <= BY_CYCLE.length; k++) {
    const id = BY_CYCLE[k - 1];
    if (id === 'tower') continue;                                   // 탑은 해금 퀘스트가 없다
    const questN = (k - 1) * len + dgSlot;                          // 그 사이클의 던전 칸
    const dg = D.dungeons.dungeons.find(x => x.id === id);
    if (!dg) { errs.push(`quests 사이클 k${k}: 없는 던전 ${id}`); continue; }
    // explicit 구간(Q1~24)은 명시 퀘스트가 담당한다 — 자동 칸 번호로 재지 않는다
    const auto = questN > (D.quests.explicitQuests?.length || 0);
    if (auto && dg.unlockQuest >= questN) {
      errs.push(`dungeons ${id}: 해금 Q${dg.unlockQuest} 가 사이클 던전 칸 Q${questN} (k${k}) 보다 늦다`);
    }
  }
  // explicit 던전 퀘스트도 해금보다 뒤여야 한다
  for (const q of D.quests.explicitQuests || []) {
    if (q.type !== 'dungeon_floor' || !q.dungeon) continue;
    const dg = D.dungeons.dungeons.find(x => x.id === q.dungeon);
    if (dg && dg.unlockQuest >= q.q) {
      errs.push(`dungeons ${q.dungeon}: 해금 Q${dg.unlockQuest} 가 명시 퀘스트 Q${q.q} 보다 늦다`);
    }
  }
}
if (errs.length) {
  console.error(`불변식 ${errs.length}건 위반:`);
  for (const e of errs) console.error('  · ' + e);
  process.exit(1);
}
console.log(`불변식 전부 통과 (${FILES.length}개 파일)`);
