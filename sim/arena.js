'use strict';
// 아레나 5v5 단판 시뮬 — 직군 밸런스가 스테이지와 다른지 확인

const E = require('./engine');
const { CHARS, SKILLS, COMBAT, makeRng, cpAtLevel } = E;

const W = COMBAT.cpWeights;
const K = COMBAT.damage.mitigationConstant;
const MAX_TICKS = COMBAT.tick.maxTicks;

function makeUnit(side, classId, grade, level, mult) {
  const cls = CHARS.classes[classId];
  const cp = cpAtLevel(CHARS.gradeCoef[grade], level);
  const t = cp / cls.cpDivisor, r = cls.statRatio, p = cls.passive;
  return {
    side, cp,
    atk: t * r.atk / 100 * mult, def: t * r.def / 100 * mult,
    hp: t * r.hp / 100 * mult, maxHp: t * r.hp / 100 * mult,
    critChance: p.critChanceAdd || 0, critMult: p.critDamageMult || 2,
    evadeChance: p.evadeChanceAdd || 0, counterRatio: p.counterAtkRatio || 0,
    procChance: p.procChance || 0, procRatio: p.procAtkRatio || 0,
    nextAttack: 0, alive: true,
  };
}

const partyCp = (p) => p.reduce((s, u) => s + u.cp, 0);
const firstAlive = (l) => l.find(u => u.alive) || null;

// 아레나 감산 기준: 양측 파티 CP 평균의 4%
let REF_COEF = 0.04;
function arenaRefAtk(a, b, multA, multB) {
  return (partyCp(a) * multA + partyCp(b) * multB) / 2 * REF_COEF;
}
function setRefCoef(c){ REF_COEF = c; }

function battle(A, B, seed, refAtk) {
  const rng = makeRng(seed);
  const mit = (d) => d.def / (d.def + K * refAtk);
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    const order=[...A,...B];
    for(let i=order.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    for (const at of order) {
      if (!at.alive || tick < at.nextAttack) continue;
      const foes = at.side === 'A' ? B : A;
      const t = firstAlive(foes);
      if (!t) break;
      if (t.evadeChance > 0 && rng() < t.evadeChance) {
        if (t.counterRatio > 0) {
          const d = Math.max(1, t.atk * t.counterRatio * (1 - mit(at)));
          at.hp -= d; if (at.hp <= 0) { at.hp = 0; at.alive = false; }
        }
        at.nextAttack = tick + 10; continue;
      }
      let raw = at.atk;
      if (at.critChance > 0 && rng() < at.critChance) raw *= at.critMult;
      if (at.procChance > 0 && rng() < at.procChance) raw += at.atk * at.procRatio;
      const d = Math.max(1, raw * (1 - mit(t)));
      t.hp -= d; if (t.hp <= 0) { t.hp = 0; t.alive = false; }
      at.nextAttack = tick + 10;
    }
    if (!B.some(u => u.alive)) return 'A';
    if (!A.some(u => u.alive)) return 'B';
  }
  // 타임아웃: 남은 HP 비율이 높은 쪽 승
  const hpr = (p) => p.reduce((s, u) => s + u.hp, 0) / p.reduce((s, u) => s + u.maxHp, 0);
  return hpr(A) >= hpr(B) ? 'A' : 'B';
}

const mk = (side, cls, mult) => Array.from({ length: 5 },
  () => makeUnit(side, cls, 'SSR', 10, mult));

// 동일 CP 맞대결 승률
console.log('=== 아레나 5v5 단판 · 동일 CP 맞대결 승률 (각 400판) ===');
const CLS = ['warrior', 'archer', 'mage'];
const nm = c => CHARS.classes[c].nameKo;
const win = {};
for (const a of CLS) for (const b of CLS) {
  if (a === b) continue;
  let w = 0;
  for (let s = 0; s < 400; s++) {
    const A = mk('A', a, 1), B = mk('B', b, 1);
    if (battle(A, B, 7000 + s * 31, arenaRefAtk(A, B, 1, 1)) === 'A') w++;
  }
  win[a + '>' + b] = w / 400;
}
console.log('           vs 전사   vs 궁수   vs 마법사');
for (const a of CLS) {
  let row = nm(a).padEnd(8);
  for (const b of CLS) row += (a === b ? '   -   ' : (win[a + '>' + b] * 100).toFixed(1) + '%').padStart(10);
  console.log(row);
}
const overall = {};
for (const a of CLS) {
  const rs = CLS.filter(b => b !== a).map(b => win[a + '>' + b]);
  overall[a] = rs.reduce((s, v) => s + v, 0) / rs.length;
}
console.log('');
for (const a of CLS) console.log('  ' + nm(a).padEnd(5) + ' 평균 승률 ' + (overall[a] * 100).toFixed(1) + '%');
const vs = Object.values(overall);
console.log('  => 편차 ' + ((Math.max(...vs) - Math.min(...vs)) * 100).toFixed(1) + '%p  (목표 5%p 이내)');

// CP 우위가 승리로 이어지는지
console.log('\n=== CP 우위 -> 승률 (혼합 파티, 각 300판) ===');
const rng = makeRng(3);
for (const adv of [1.0, 1.05, 1.1, 1.2, 1.5, 2.0]) {
  let w = 0;
  for (let s = 0; s < 300; s++) {
    const ca = CLS[Math.floor(rng() * 3)], cb = CLS[Math.floor(rng() * 3)];
    const A = mk('A', ca, adv), B = mk('B', cb, 1);
    if (battle(A, B, 900 + s * 17, arenaRefAtk(A, B, adv, 1)) === 'A') w++;
  }
  console.log('  CP x' + adv.toFixed(2).padStart(4) + '  승률 ' + (w / 300 * 100).toFixed(1) + '%');
}
