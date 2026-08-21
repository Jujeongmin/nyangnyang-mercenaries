'use strict';
// 스킬 24종의 실전 가치를 측정해 CP 계수를 역산한다.
// 방법: 스킬 없는 기준 파티 vs 해당 스킬 1개만 장착한 파티의 '필요 배율' 차이.

const E = require('./engine');
const { runStage, requiredCp, SKILLS, NON_COMBAT, SKILL_BY_ID } = E;

const SEEDS = [1000, 8919, 20771, 33331, 41113];
const beats = (b, st) => SEEDS.filter(s => runStage(b, requiredCp(st), s).win).length >= 3;

function multNeeded(build, stage, lo = 0.02, hi = 200) {
  if (!beats({ ...build, mult: hi }, stage)) return Infinity;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (beats({ ...build, mult: m }, stage)) hi = m; else lo = m;
  }
  return hi;
}

const mercs = () => Array.from({ length: 5 }, () => ({ classId: 'warrior', grade: 'SSR', level: 10 }));
const STAGES_T = [60, 120];
const GRADE = 'SSR', LEVEL = 5;

function measure(skillId) {
  const sk = SKILL_BY_ID[skillId];
  const slot = sk.type === 'active' ? 'actives' : 'passives';
  let gains = [];
  for (const st of STAGES_T) {
    const base = { mercs: mercs(), actives: [], passives: [], mult: 1 };
    const withSkill = { mercs: mercs(), actives: [], passives: [], mult: 1 };
    withSkill[slot] = [{ id: skillId, grade: GRADE, level: LEVEL }];
    const m0 = multNeeded(base, st);
    const m1 = multNeeded(withSkill, st);
    if (!isFinite(m0) || !isFinite(m1)) continue;
    gains.push(m0 / m1 - 1);      // 배율을 얼마나 아꼈나 = 전투 가치
  }
  return gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
}

console.log('스킬 24종 실전 가치 측정 (SSR Lv5, St60/120 평균)\n');
const rows = [];
for (const sk of SKILLS.skills) {
  if (NON_COMBAT.has(sk.effect.kind)) {
    rows.push({ id: sk.id, name: sk.nameKo, type: sk.type, gain: 0, nonCombat: true });
    continue;
  }
  rows.push({ id: sk.id, name: sk.nameKo, type: sk.type, gain: measure(sk.id) });
}

// 전투 스킬만으로 평균을 내고, 그 평균을 1.0으로 정규화
const combat = rows.filter(r => !r.nonCombat && r.gain > 0);
const avg = combat.reduce((s, r) => s + r.gain, 0) / combat.length;
for (const r of rows) r.coef = r.nonCombat ? 0 : Math.max(0.15, Math.round(r.gain / avg * 100) / 100);

rows.sort((a, b) => b.coef - a.coef);
console.log('ID        이름              구분      가치     CP계수');
for (const r of rows) {
  console.log(
    r.id.padEnd(9) + r.name.padEnd(15) +
    (r.type === 'active' ? '액티브' : '패시브').padEnd(8) +
    (r.nonCombat ? '  (전투무관)' : r.gain.toFixed(4).padStart(8)) +
    String(r.coef.toFixed(2)).padStart(9)
  );
}

const out = {};
for (const r of rows) out[r.id] = r.coef;
require('fs').writeFileSync(require('path').join(__dirname, 'skill-coef.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('\n=> sim/skill-coef.json 저장');
console.log('계수 범위 ' + Math.min(...rows.filter(r => r.coef > 0).map(r => r.coef)).toFixed(2) +
            ' ~ ' + Math.max(...rows.map(r => r.coef)).toFixed(2));
