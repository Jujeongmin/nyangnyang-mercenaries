'use strict';
// 냥냥 용병단 — 자동전투 시뮬레이터
// data/combat.json 규칙 구현. 헤드리스, UI 없음.

const fs = require('fs');
const path = require('path');
const D = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'game/public/data', f), 'utf8'));

const CHARS  = D('characters.json');
const SKILLS = D('skills.json');
const COMBAT = D('combat.json');
const STAGES = D('stages.json');

let W = { ...COMBAT.cpWeights };
let MITIGATION_MODE = 'stage';
function setMitigationMode(m){ MITIGATION_MODE = m; }
function setWeights(w){ W = { ...w }; for (const k of Object.keys(CHARS.classes)){ const r=CHARS.classes[k].statRatio; CHARS.classes[k].cpDivisor=(W.atk*r.atk+W.def*r.def+W.hp*r.hp)/100; } }              // { atk:2.0, def:0.6, hp:3.0 }
const K  = COMBAT.damage.mitigationConstant;   // 2.65
const MAX_TICKS = COMBAT.tick.maxTicks;        // 600
const SKILL_DELAY = COMBAT.skills.initialDelayTicks;   // 10
const SKILL_CAP = COMBAT.skills.simultaneousCap;       // 2

// ---------- 결정론적 RNG (시드 고정) ----------
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

// ---------- 스탯 파생 ----------
function cpAtLevel(gradeCoef, level) {
  return gradeCoef * (1 + level * CHARS.levelGrowthPerLevel);
}

function statsFromCp(cp, ratio, cpDivisor) {
  const total = cp / cpDivisor;
  return {
    atk: total * ratio.atk / 100,
    def: total * ratio.def / 100,
    hp:  total * ratio.hp  / 100,
  };
}

function cpOf(st) { return st.atk * W.atk + st.def * W.def + st.hp * W.hp; }

// ---------- 유닛 생성 ----------
function makeMerc(classId, grade, level, globalMult) {
  const cls = CHARS.classes[classId];
  const cp = cpAtLevel(CHARS.gradeCoef[grade], level);
  const s = statsFromCp(cp, cls.statRatio, cls.cpDivisor);
  const p = cls.passive;
  return {
    side: 'ally', classId, grade, level,
    baseCp: cp,
    atk: s.atk * globalMult, def: s.def * globalMult,
    hp: s.hp * globalMult, maxHp: s.hp * globalMult,
    atkSpeedMult: 1.0 + (p.atkSpeedAdd || 0),   // 궁수 속사
    atkFromDef:  p.atkFromDef || 0,            // 전사 수호의 힘
    atkFromHp:   p.atkFromHp  || 0,            // 마법사 마력 전환
    critChance:  p.critChanceAdd  || 0,
    critMult:    p.critDamageMult || 2.0,
    evadeChance: p.evadeChanceAdd || 0,
    counterRatio: p.counterAtkRatio || 0,
    procChance:  p.procChance  || 0,
    procRatio:   p.procAtkRatio || 0,
    lifesteal: 0, reflect: 0, executeChance: 0, doubleHitChance: 0,
    nextAttack: 0, shield: 0, alive: true,
  };
}

function makeEnemy(cp, ratio) {
  ratio = ratio || { atk: 40, def: 30, hp: 30 };
  const div = (W.atk * ratio.atk + W.def * ratio.def + W.hp * ratio.hp) / 100;
  const s = statsFromCp(cp, ratio, div);
  return {
    side: 'enemy', baseCp: cp,
    dmgScale: 1,                                // 잡몹/보스 피해 배율 (stageRules)
    atk: s.atk, def: s.def, hp: s.hp, maxHp: s.hp,
    atkSpeedMult: 1.0,
    atkFromDef: 0, atkFromHp: 0,
    critChance: 0, critMult: 2.0, evadeChance: 0, counterRatio: 0,
    procChance: 0, procRatio: 0,
    lifesteal: 0, reflect: 0, executeChance: 0, doubleHitChance: 0,
    nextAttack: 0, shield: 0, alive: true,
  };
}

// ---------- 스킬 ----------
const NON_COMBAT = new Set(["resource_gain","idle_gain"]);
let SKILL_CP_COEF = {};
try { SKILL_CP_COEF = require('./skill-coef.json'); } catch(e) {}
function setSkillCoef(c){ SKILL_CP_COEF = c || {}; }
const SKILL_BY_ID = {};
for (const s of SKILLS.skills) SKILL_BY_ID[s.id] = s;

function skillCp(grade, level, id) {
  const coef = (id && SKILL_CP_COEF[id] != null) ? SKILL_CP_COEF[id] : 1;
  return cpAtLevel(SKILLS.gradeCoef[grade], level) * coef;
}
// 스킬 효과 배율: SR Lv0(600)을 기준 1.0으로, 스킬 CP에 비례해 스케일.
// 레벨만 반영하면 UR 스킬이 N의 40배 CP를 먹으면서 효과는 같아져 CP-실전 상관이 깨진다.
const SKILL_BASELINE_CP = SKILLS.gradeCoef.SR;
function skillPower(grade, level) {
  return skillCp(grade, level) / SKILL_BASELINE_CP;
}

// 패시브를 파티에 적용
function applyPassives(party, passives) {
  for (const ps of passives) {
    const sk = SKILL_BY_ID[ps.id], e = sk.effect;
    const scale = skillPower(ps.grade, ps.level);
    for (const u of party) {
      switch (e.kind) {
        case 'stat_pct': {
          const v = e.pct * scale;
          if (e.stat === 'atk') u.atk *= (1 + v);
          else if (e.stat === 'def') u.def *= (1 + v);
          else if (e.stat === 'hp') { u.hp *= (1 + v); u.maxHp *= (1 + v); }
          else if (e.stat === 'atkSpeed') u.atkSpeedMult *= (1 + v);
          break;
        }
        case 'crit_chance':   u.critChance  += e.add * scale; break;
        case 'evade_chance':  u.evadeChance += e.add * scale; break;
        case 'lifesteal':     u.lifesteal   += e.pct * scale; break;
        case 'reflect':       u.reflect     += e.pct * scale; break;
        case 'execute':       u.executeChance  += e.chance * scale; break;
        case 'double_hit':    u.doubleHitChance += e.chance * scale; break;
        default: break; // resource_gain / idle_gain 은 전투 무관
      }
    }
  }
}

// ---------- 전투 ----------
// 실수 간격을 쓴다. 반올림하면 궁수 속사 +15% 가 round(10/1.15)=9틱 → +11.1% 로 깎인다.
function attackInterval(u) {
  return Math.max(COMBAT.attack.minIntervalTicks,
                  COMBAT.attack.baseIntervalTicks / u.atkSpeedMult);
}

let STAGE_REF_ATK = null;   // null 이면 기존(공격자 기준) 방식
function setStageRef(v){ STAGE_REF_ATK = v; }
// 스테이지는 순수 DPS 체크다 — DEF 감산을 적용하지 않는다.
// 켜두면 DEF 가 스테이지 성능에 기여해 "DEF 는 아레나 전용" 정의가 깨진다.
const STAGE_MITIGATION = COMBAT.stageRules ? COMBAT.stageRules.mitigationApplies !== false : true;
let ARENA_MODE = false;
function setArenaMode(v) { ARENA_MODE = !!v; }

// 방어 스탯을 ATK 로 환산한다. **반드시 applyPassives 뒤에** 불러야 한다 —
// 먼저 환산하면 방어력 강화·체력 강화 스킬이 딜로 안 바뀐다.
function convertStats(party) {
  for (const u of party) {
    if (!u.atkFromDef && !u.atkFromHp) continue;
    u.atk += u.def * u.atkFromDef + u.hp * u.atkFromHp;
  }
}

function mitigate(defender, attackerAtk) {
  if (!ARENA_MODE && !STAGE_MITIGATION) return 0;
  const base = STAGE_REF_ATK != null ? STAGE_REF_ATK : attackerAtk;
  return defender.def / (defender.def + K * base);
}

// 스테이지는 DPS 체크다 — 잡몹은 때리는 연출만 하고 아군을 죽이지 못한다.
// 이걸 빼면 감산만 꺼진 채 아군이 풀 피해를 맞아 예전보다 더 빨리 죽는다.
const ALLY_INVULN = COMBAT.stageRules ? COMBAT.stageRules.allyInvulnerable === true : false;

function dealDamage(target, amount) {
  if (ALLY_INVULN && !ARENA_MODE && target.side === 'ally') return 0;
  let dmg = Math.max(COMBAT.damage.minDamage, amount);
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed; dmg -= absorbed;
  }
  target.hp -= dmg;
  if (target.hp <= 0) { target.hp = 0; target.alive = false; }
  return dmg;
}

function firstAlive(list) { for (const u of list) if (u.alive) return u; return null; }

// 한 번의 조우(웨이브) 전투. 승리 시 true.
function runEncounter(party, enemies, actives, rng, state) {
  for (const u of party) { u.nextAttack = 0; u.shield = 0; }
  for (const e of enemies) e.nextAttack = 0;

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    state.ticks++;

    // --- 액티브 스킬 ---
    let fired = 0;
    for (const a of actives) {
      if (fired >= SKILL_CAP) break;
      if (tick < SKILL_DELAY) continue;
      if (tick < a.readyAt) continue;
      const sk = SKILL_BY_ID[a.id], e = sk.effect;
      const scale = skillPower(a.grade, a.level);
      const alive = party.filter(u => u.alive);
      if (!alive.length) break;
      const avgAtk = alive.reduce((s, u) => s + u.atk, 0) / alive.length;
      const targets = enemies.filter(u => u.alive);

      switch (e.kind) {
        case 'single_damage':
        case 'aoe_damage':
        case 'pierce_damage': {
          const n = Math.min(e.targets || 1, targets.length);
          for (let i = 0; i < n; i++) {
            const t = targets[i];
            const raw = avgAtk * e.atkRatio * scale;
            dealDamage(t, raw * (1 - mitigate(t, avgAtk)));
          }
          break;
        }
        case 'party_buff': {
          const v = e.pct * scale;
          for (const u of alive) {
            if (e.stat === 'atk') u.atk *= (1 + v);
            else if (e.stat === 'atkSpeed') u.atkSpeedMult *= (1 + v);
          }
          a.expireAt = tick + Math.round(e.durationSec * 10);
          a.revert = { stat: e.stat, v };
          break;
        }
        case 'cooldown_reduce':
          for (const b of actives) if (b !== a) b.readyAt -= Math.round(e.pct * 10 * 5);
          break;
        case 'party_heal':
          for (const u of alive) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * e.maxHpRatio * scale);
          break;
        case 'party_shield':
          for (const u of alive) u.shield += u.maxHp * e.maxHpRatio * scale;
          break;
        case 'summon': {
          // 소환수를 지속시간 동안의 총 딜로 근사
          const hits = Math.round(e.durationSec);
          const t = firstAlive(enemies);
          if (t) {
            const raw = avgAtk * e.atkRatio * scale * e.count * hits;
            dealDamage(t, raw * (1 - mitigate(t, avgAtk)));
          }
          break;
        }
      }
      a.readyAt = tick + Math.round(e.cooldownSec * 10);
      fired++;
    }
    // 버프 만료 되돌리기
    for (const a of actives) {
      if (a.revert && a.expireAt === tick) {
        for (const u of party) {
          if (a.revert.stat === 'atk') u.atk /= (1 + a.revert.v);
          else if (a.revert.stat === 'atkSpeed') u.atkSpeedMult /= (1 + a.revert.v);
        }
        a.revert = null;
      }
    }

    // --- 일반 공격 ---
    for (const attacker of [...party, ...enemies]) {
      if (!attacker.alive) continue;
      if (tick < attacker.nextAttack) continue;
      const foes = attacker.side === 'ally' ? enemies : party;
      const target = firstAlive(foes);
      if (!target) break;

      // 회피
      if (target.evadeChance > 0 && rng() < target.evadeChance) {
        if (target.counterRatio > 0) {
          const raw = target.atk * target.counterRatio;
          dealDamage(attacker, raw * (1 - mitigate(attacker, target.atk)));
        }
        attacker.nextAttack = tick + attackInterval(attacker);
        continue;
      }

      let raw = attacker.atk;
      if (attacker.critChance > 0 && rng() < attacker.critChance) raw *= attacker.critMult;
      if (attacker.procChance > 0 && rng() < attacker.procChance) raw += attacker.atk * attacker.procRatio;
      if (attacker.doubleHitChance > 0 && rng() < attacker.doubleHitChance) raw += attacker.atk * 0.5;

      // 잡몹은 때리되 거의 깎지 못한다 (stageRules.mobDamageScale). 보스만 실제로 문다.
      const scale = (!ARENA_MODE && attacker.side === 'enemy') ? (attacker.dmgScale || 1) : 1;
      const dmg = dealDamage(target, raw * (1 - mitigate(target, attacker.atk)) * scale);

      if (attacker.lifesteal > 0)
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + dmg * attacker.lifesteal);
      if (target.alive && target.reflect > 0)
        dealDamage(attacker, dmg * target.reflect);
      if (target.alive && attacker.executeChance > 0 &&
          target.hp / target.maxHp < 0.15 && rng() < attacker.executeChance) {
        target.hp = 0; target.alive = false;
      }

      attacker.nextAttack = tick + attackInterval(attacker);
    }

    if (!enemies.some(e => e.alive)) return true;
    if (!party.some(u => u.alive)) return false;
  }
  state.timeouts++;
  return false;   // 60초 초과 = 패배
}

// 스테이지 1회 = 조우 3회(적 4) + 스테이지 보스 1
function runStage(build, requiredCp, seed) {
  const rng = makeRng(seed);
  const state = { ticks: 0, timeouts: 0 };
  const party = build.mercs.map(m => makeMerc(m.classId, m.grade, m.level, build.mult));
  applyPassives(party, build.passives);
  convertStats(party);          // 방어 스탯 → ATK. 반드시 applyPassives 뒤.
  const actives = build.actives.map(a => ({ ...a, readyAt: 0, revert: null, expireAt: -1 }));

  if (MITIGATION_MODE === "stage") setStageRef(requiredCp * 0.04);
  const enc = STAGES.enemyDerivation;
  const perEnemy = requiredCp * 0.85 / enc.waveEnemyCount;
  // 아군 무적 + 감산 없음 = 순수 DPS 레이스. 적 HP 를 올려 난이도를 되맞춘다.
  const HPS = (COMBAT.stageRules && COMBAT.stageRules.enemyHpScale) || 1;
  const SR = COMBAT.stageRules || {};
  const scaleHp = (u, boss) => {
    u.hp *= HPS; u.maxHp *= HPS;
    u.dmgScale = boss ? (SR.bossDamageScale ?? 1) : (SR.mobDamageScale ?? 1);
    return u;
  };

  for (let i = 0; i < enc.encountersPerStage; i++) {
    const foes = Array.from({ length: enc.waveEnemyCount }, () => scaleHp(makeEnemy(perEnemy), false));
    if (!runEncounter(party, foes, actives, rng, state)) return { win: false, state };
    // 웨이브 클리어 회복 — 전량 회복이면 방어형 가치가 사라진다
    const HEAL = COMBAT.death.waveClearHealRatio;
    for (const u of party) if (u.alive) { u.hp = Math.min(u.maxHp, u.hp + u.maxHp * HEAL); u.shield = 0; }
  }
  const BR = STAGES.enemyDerivation.bossStatRatio;
  const boss = [scaleHp(makeEnemy(requiredCp * 2.4, BR), true)];
  const win = runEncounter(party, boss, actives, rng, state);
  return { win, state };
}

// 빌드의 총 CP (스킬 포함, 곱연산 배율 반영)
function buildCp(build) {
  let base = 0;
  for (const m of build.mercs) base += cpAtLevel(CHARS.gradeCoef[m.grade], m.level);
  for (const a of build.actives)  if(!NON_COMBAT.has(SKILL_BY_ID[a.id].effect.kind)) base += skillCp(a.grade, a.level, a.id);
  for (const p of build.passives) if(!NON_COMBAT.has(SKILL_BY_ID[p.id].effect.kind)) base += skillCp(p.grade, p.level, p.id);
  return base * build.mult;
}

// 스테이지 요구 CP 곡선
function requiredCp(n) {
  const walls = STAGES.curve.walls;
  let cp = STAGES.curve.baseCp;
  for (let i = 2; i <= n; i++) {
    const seg = STAGES.curve.segments.find(s => i >= s.from && i <= s.to);
    cp *= (1 + seg.growthPerStage);
    if (walls[i]) cp *= walls[i].multiplier;
  }
  return cp;
}

module.exports = {
  makeMerc, makeEnemy, runStage, buildCp, requiredCp,
  cpAtLevel, skillCp, skillPower, setWeights, setMitigationMode, setSkillCoef, NON_COMBAT,
  SKILL_BY_ID, CHARS, SKILLS, COMBAT, STAGES, makeRng, cpOf,
};
