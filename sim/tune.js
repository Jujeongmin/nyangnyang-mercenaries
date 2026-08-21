'use strict';
// cpWeights 튜너 — 시뮬레이터로 직군 편차를 최소화하는 가중치 탐색

const E = require('./engine');
const { runStage, requiredCp, setWeights, SKILLS, CHARS } = E;

const ACTIVE_IDS  = SKILLS.skills.filter(s => s.type === 'active').map(s => s.id);
const PASSIVE_IDS = SKILLS.skills.filter(s => s.type === 'passive').map(s => s.id);
const SEEDS = [1000, 8919, 20771];

function beats(build, stage) {
  let w = 0;
  for (const s of SEEDS) if (runStage(build, requiredCp(stage), s).win) w++;
  return w >= 2;
}
function multNeeded(build, stage, lo = 0.02, hi = 80) {
  if (!beats({ ...build, mult: hi }, stage)) return Infinity;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (beats({ ...build, mult: mid }, stage)) hi = mid; else lo = mid;
  }
  return hi;
}

const KIT_A = ACTIVE_IDS.slice(0, 4).map(id => ({ id, grade: 'SSR', level: 5 }));
const KIT_P = PASSIVE_IDS.slice(0, 4).map(id => ({ id, grade: 'SSR', level: 5 }));

function spreadFor(weights, stages = [60, 120]) {
  setWeights(weights);
  let worst = 0;
  for (const st of stages) {
    const ms = ['warrior', 'archer', 'mage'].map(c => multNeeded({
      mercs: Array.from({ length: 5 }, () => ({ classId: c, grade: 'SSR', level: 10 })),
      actives: KIT_A, passives: KIT_P, mult: 1,
    }, st));
    if (ms.some(m => !isFinite(m))) return { spread: 9, ms };
    worst = Math.max(worst, Math.max(...ms) / Math.min(...ms) - 1);
  }
  return { spread: worst };
}

console.log('cpWeights 탐색 (ATK 고정 2.0, DEF/HP 변화)');
console.log('DEF    HP     편차');
let best = null;
for (let wd = 0.2; wd <= 2.61; wd += 0.2) {
  for (let wh = 0.4; wh <= 4.01; wh += 0.4) {
    const w = { atk: 2.0, def: wd, hp: wh };
    const r = spreadFor(w);
    if (r.spread < 9) console.log(`${wd.toFixed(1).padStart(4)}  ${wh.toFixed(1).padStart(4)}   ${(r.spread * 100).toFixed(1)}%`);
    if (!best || r.spread < best.spread) best = { ...r, w };
  }
}
console.log('\n최적: ATK 2.0 / DEF ' + best.w.def.toFixed(2) + ' / HP ' + best.w.hp.toFixed(2) + '   편차 ' + (best.spread * 100).toFixed(2) + '%');

// 미세 조정
let fine = best;
for (let wd = Math.max(0.05, best.w.def - 0.2); wd <= best.w.def + 0.2; wd += 0.05) {
  for (let wh = Math.max(0.1, best.w.hp - 0.4); wh <= best.w.hp + 0.4; wh += 0.1) {
    const w = { atk: 2.0, def: wd, hp: wh };
    const r = spreadFor(w, [60, 120, 170]);
    if (r.spread < fine.spread) fine = { ...r, w };
  }
}
console.log('미세조정: ATK 2.0 / DEF ' + fine.w.def.toFixed(2) + ' / HP ' + fine.w.hp.toFixed(2) + '   편차 ' + (fine.spread * 100).toFixed(2) + '%');
setWeights(fine.w);
for (const st of [60, 120, 170]) {
  const ms = ['warrior', 'archer', 'mage'].map(c => multNeeded({
    mercs: Array.from({ length: 5 }, () => ({ classId: c, grade: 'SSR', level: 10 })),
    actives: KIT_A, passives: KIT_P, mult: 1,
  }, st));
  console.log(`  St${st}  전사 ${ms[0].toFixed(3)}  궁수 ${ms[1].toFixed(3)}  마법사 ${ms[2].toFixed(3)}   편차 ${((Math.max(...ms)/Math.min(...ms)-1)*100).toFixed(1)}%`);
}
console.log('\ncpDivisor:', Object.fromEntries(Object.entries(CHARS.classes).map(([k, v]) => [v.nameKo, v.cpDivisor.toFixed(4)])));
