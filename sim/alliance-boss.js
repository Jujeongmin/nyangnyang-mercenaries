'use strict';
// 연합 보스 HP 계수 검증 — alliance.json > boss.hp.formula (sum(memberCp) * 0.55 * tier)
//
// 목표 체감(alliance.json 설계 의도): 주 3회 시도로 **상위 연합이 5일차쯤 1단계를 잡는다.**
// 더 빠르면 벽이 없고, 주를 넘기면 잡는 맛이 없다.
//
// 모델:
//  · 개인 시도 = 60초(600틱) 틱 시뮬. 회복 없음 (boss.damageFormula)
//  · 보스는 죽지 않는 샌드백으로 두고 60초 총딜만 잰다 — HP 는 연합 단위라
//    개인 전투에서는 남은 HP 만 깎인다
//  · 감산은 아레나와 같은 상대 기준(mit = def/(def+K·refAtk)). 보스전 refAtk 는
//    공격측 파티 CP 의 4% (arena.js REF_COEF 와 동일 계수)
//  · 연합원 CP 는 로그정규 분포 — 상위 연합도 전원이 고래는 아니다
//
//   node sim/alliance-boss.js

const E = require('./engine');
const { CHARS, SKILLS, COMBAT, makeRng, cpAtLevel } = E;

const K = COMBAT.damage.mitigationConstant;
const TICKS = COMBAT.tick.maxTicks;          // 600 = 60초
const A = require('fs').existsSync(__dirname + '/../game/public/data/alliance.json')
  ? JSON.parse(require('fs').readFileSync(__dirname + '/../game/public/data/alliance.json', 'utf8'))
  : null;
const HP_COEF = A.boss.hp.formula.match(/([\d.]+)/) ? parseFloat(A.boss.hp.formula.match(/\* ([\d.]+) \*/)[1]) : 0.55;
const TIERS = A.boss.hp.tierMultiplier;      // [1, 1.35, 1.8, 2.4, 3.2]
const ATTEMPTS_PER_WEEK = A.boss.attemptsPerWeek;   // 3

// ── 개인 60초 총딜 측정 ────────────────────────────────────
function makeAttacker(classId, grade, level) {
  const cls = CHARS.classes[classId];
  const cp = cpAtLevel(CHARS.gradeCoef[grade], level);
  const t = cp / cls.cpDivisor, r = cls.statRatio, p = cls.passive;
  return {
    cp,
    atk: t * r.atk / 100,
    critChance: p.critChanceAdd || 0, critMult: p.critDamageMult || 2,
    procChance: p.procChance || 0, procRatio: p.procAtkRatio || 0,
    interval: 10,                    // 기본 공속 1회/초 (combat.json 표준)
    nextAttack: 0,
  };
}

/** 파티가 60초 동안 보스에게 넣는 총딜. 보스 def 는 보스 CP 에서 파생 */
function attemptDamage(party, bossDef, refAtk, seed) {
  const rng = makeRng(seed);
  const mit = bossDef / (bossDef + K * refAtk);
  let dmg = 0;
  for (let tick = 0; tick < TICKS; tick++) {
    for (const u of party) {
      if (tick < u.nextAttack) continue;
      let d = u.atk * (1 - mit);
      if (rng() < u.critChance) d *= u.critMult;
      if (u.procChance && rng() < u.procChance) d += u.atk * u.procRatio * (1 - mit);
      dmg += Math.max(1, d);
      u.nextAttack = tick + u.interval;
    }
  }
  return dmg;
}

/**
 * 멤버 CP → 60초 시도당 데미지.
 *
 * 틱 시뮬 실측으로 **CP 선형**이 확인됐다 (Lv5/15/30 전부 파티CP x 1.723,
 * 감산은 상대 기준이라 규모에서 소거된다). 그래서 대표 파티를 다시 세우지 않고
 * 계수를 직접 곱한다 — CP 를 레벨로 역산하면 저CP 구간에서 Lv0 바닥에 걸려
 * 소규모 연합의 딜이 2.5배 과대해지는 버그가 있었다.
 */
const DMG_PER_CP = 1.723;
const dmgOfMember = (cp) => cp * DMG_PER_CP;

// ── 연합 주간 시뮬 ────────────────────────────────────────
// 단계는 연쇄다 (tierNote: 잡을 때마다 다음이 열린다). 그래서 "며칠에 1단계"가
// 아니라 **주간 시도 예산이 단계 사다리 어디까지 올라가나**를 본다.
function simWeek(nMembers, avgCp, spreadSigma, seed) {
  const rng = makeRng(seed);
  const members = Array.from({ length: nMembers }, () => {
    const g = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    return avgCp * Math.exp(spreadSigma * g - spreadSigma * spreadSigma / 2);
  });
  const totalCp = members.reduce((a, b) => a + b, 0);
  const hpOf = t => totalCp * HP_COEF * TIERS[t];

  let tier = 0, hp = hpOf(0);
  const perDmg = members.map(c => dmgOfMember(c));
  const log = [];
  // 참여 모델: 1~3일차에 하루 1회씩 80% 참여, 4~5일차에 지각분 35%/일 (반딜)
  for (let day = 1; day <= 7; day++) {
    for (let i = 0; i < nMembers; i++) {
      let d = 0;
      if (day <= 3 && rng() < 0.8) d = perDmg[i];
      else if (day >= 4 && day <= 5 && rng() < 0.35) d = perDmg[i] * 0.5;
      if (!d) continue;
      hp -= d;
      while (hp <= 0 && tier < TIERS.length - 1) {
        log.push({ tier: tier + 1, day });
        tier++; hp += hpOf(tier);
      }
      if (hp <= 0) { log.push({ tier: tier + 1, day }); return { log, done: true }; }
    }
  }
  return { log, done: false, leftPct: hp / hpOf(tier) };
}

// ── 계수 스윕 — coef 후보 x 참여율(성실한 연합 0.9 / 보통 0.65) ──
if (process.argv[2] === 'sweep') {
  const orig = simWeek;
  for (const coef of [0.45, 0.48, 0.52, 0.55, 0.6]) {
    for (const part of [0.9, 0.65]) {
      let t5 = 0, t4 = 0;
      for (let s = 1; s <= 60; s++) {
        const rng = makeRng(s * 101);
        const members = Array.from({ length: 25 }, () => {
          const g = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
          return 10e6 * Math.exp(0.55 * g - 0.55 * 0.55 / 2);
        });
        const totalCp = members.reduce((a, b) => a + b, 0);
        const hpOf = t => totalCp * coef * TIERS[t];
        let tier = 0, hp = hpOf(0), reached = 0;
        for (let day = 1; day <= 7 && reached < 5; day++) {
          for (const c of members) {
            let d = 0;
            if (day <= 3 && rng() < part) d = c * DMG_PER_CP;
            else if (day >= 4 && day <= 5 && rng() < part * 0.4) d = c * DMG_PER_CP * 0.5;
            if (!d) continue;
            hp -= d;
            while (hp <= 0 && tier < 4) { tier++; hp += hpOf(tier); }
            if (hp <= 0 && tier === 4) { reached = 5; break; }
          }
          if (reached < 5) {}
        }
        if (reached === 5 || (tier === 4 && hp <= 0)) t5++;
        else if (tier >= 3) t4++;
      }
      console.log(`coef ${coef} 참여 ${part}: t5 클리어 ${t5}/60 · t4 도달 ${t4 + t5}/60`);
    }
  }
  process.exit(0);
}

// ── 실행 ──────────────────────────────────────────────────
console.log(`HP 계수 ${HP_COEF} · 주 ${ATTEMPTS_PER_WEEK}회 · 60초 시도 · 시도딜 = 파티CP x 1.72
`);
const CASES = [
  ['상위 (30명 · 평균 40M · 참여 좋음)', 30, 40e6, 0.5],
  ['중위 (20명 · 평균 8M)', 20, 8e6, 0.6],
  ['소규모 (8명 · 평균 3M)', 8, 3e6, 0.7],
];
for (const [label, n, cp, sig] of CASES) {
  const reach = [];        // 시즌 최종 도달 단계
  const dayOf = {};        // 단계별 클리어 일자 모음
  for (let s = 1; s <= 60; s++) {
    const r = simWeek(n, cp, sig, s * 101);
    reach.push(r.log.length ? r.log[r.log.length - 1].tier : 0);
    for (const e of r.log) (dayOf[e.tier] ||= []).push(e.day);
  }
  const med = a => a.sort((x, y) => x - y)[a.length >> 1];
  const parts = [];
  for (let t = 1; t <= 5; t++) {
    const arr = dayOf[t] || [];
    parts.push(arr.length ? `t${t}:${med(arr)}일(${arr.length}/60)` : `t${t}:-`);
  }
  console.log(`${label}
  최종 도달 중앙값 tier${med(reach)} · ${parts.join(' ')}
`);
}
