// 장착 패시브 → 전투 수치 한 덩어리.
//
// 예전에는 패시브가 **CP 에만** 더해졌다. 툴팁은 "치명타 확률 +9%" 라고 적어 놓고
// 전투에서는 치명타율이 0.15 고정이었다 — 적힌 것과 일어나는 것이 달랐다.
// 이제 16종 전부 실제 판정을 갖는다. 여기서 한 번 재고, 전투(view/battle/scene.js)와
// 파티 DPS(main.js) 가 같은 값을 읽는다. 두 곳이 각자 재면 반드시 어긋난다.
//
// **배율 규칙은 skillDesc(main.js) 와 글자 그대로 같아야 한다.** 툴팁이 곧 계약이다.
//   scaled : 등급·레벨에 비례 — pct / add / atkPct / atkRatio / maxHpRatioPerSec
//   raw    : 데이터 값 그대로 — chance / hpThreshold / pctPerStack / maxStacks
//            / mult / sec / pctPerSec / maxPct
// raw 쪽은 레벨을 올려도 안 커진다. 발동 확률이 레벨로 자라면 상한 100% 가
// 금방 닿아 스킬이 "항상 터지는 것" 이 되고, 그 순간 등급 사다리가 무의미해진다.

/** 패시브 합산 결과의 빈 값. 편성이 비어도 전투 코드가 같은 모양을 읽는다. */
export const EMPTY_PASSIVES = Object.freeze({
  atkPct: 0, defPct: 0, hpPct: 0, spdPct: 0,
  critAdd: 0, critDmgAdd: 0,
  openPct: 0, openSec: 0,
  thorns: 0,
  ragePS: 0, rageMax: 0,
  vigorAtk: 0, regenPS: 0,
  lifePct: 0, lifeAtk: 0,
  pierce: 0,
  dblChance: 0, dblRatio: 0,
  execChance: 0, execHp: 0,
  killAtk: 0, killMax: 0,
  ampChance: 0, ampMult: 1,
});

/**
 * @param {Array<{id,grade,level}|null>} list  장착 패시브 (빈 칸은 null 이어도 된다)
 * @param {object} skills                      D.skills (skills.json)
 */
export function passiveAgg(list, skills) {
  const P = { ...EMPTY_PASSIVES };
  if (!list || !skills) return P;
  const gc = skills.gradeCoef || {};
  const base = gc[skills.effectScaling?.baselineGrade] || 1500;
  const byId = new Map((skills.skills || []).map(s => [s.id, s]));

  for (const sk of list) {
    if (!sk) continue;
    const e = byId.get(sk.id)?.effect;
    if (!e) continue;
    // skillDesc 의 mult 와 같은 식. 레벨은 1부터 세므로 성장항은 (level - 1) 이다
    const m = (gc[sk.grade] || base) / base * (1 + ((sk.level || 1) - 1) * 0.06);

    switch (e.kind) {
      case 'stat_pct': {
        const v = (e.pct || 0) * m;
        if (e.stat === 'atk') P.atkPct += v;
        else if (e.stat === 'def') P.defPct += v;
        else if (e.stat === 'hp') P.hpPct += v;
        else if (e.stat === 'atkSpeed') P.spdPct += v;
        break;
      }
      case 'crit_chance':   P.critAdd    += (e.add || 0) * m; break;
      case 'crit_damage':   P.critDmgAdd += (e.add || 0) * m; break;
      case 'def_pierce':    P.pierce     += (e.pct || 0) * m; break;
      case 'thorns_aura':   P.thorns     += (e.atkPct || 0) * m; break;
      case 'opening_burst':
        P.openPct += (e.pct || 0) * m;
        P.openSec = Math.max(P.openSec, e.sec || 0);
        break;
      case 'vigor':
        P.vigorAtk += (e.fullHpAtkPct || 0) * m;
        P.regenPS  += (e.maxHpRatioPerSec || 0) * m;
        break;
      case 'lifesteal':
        P.lifePct += (e.pct || 0) * m;
        P.lifeAtk += (e.atkPct || 0) * m;
        break;
      case 'rage_ramp':
        // pctPerSec / maxPct 는 raw 다 (툴팁도 rawPct 로 적는다)
        P.ragePS  += e.pctPerSec || 0;
        P.rageMax += e.maxPct || 0;
        break;
      case 'double_hit':
        // 확률은 raw, 추가 타격 배율만 등급·레벨로 자란다
        P.dblRatio = mixRatio(P.dblChance, P.dblRatio, e.chance || 0, (e.atkRatio || 0) * m);
        P.dblChance += e.chance || 0;
        break;
      case 'execute':
        P.execChance += e.chance || 0;
        P.execHp = Math.max(P.execHp, e.hpThreshold || 0);
        break;
      case 'kill_stack_atk':
        P.killAtk += e.pctPerStack || 0;
        P.killMax = Math.max(P.killMax, e.maxStacks || 0);
        break;
      case 'damage_amplify':
        P.ampChance += e.chance || 0;
        P.ampMult = Math.max(P.ampMult, e.mult || 1);
        break;
      default: break;   // 액티브 전용 kind 는 여기 오지 않는다
    }
  }

  // 확률은 1 을 못 넘는다. 넘기면 "항상 발동" 이라 판정이 사라진다
  P.critAdd = Math.min(P.critAdd, 0.8);
  P.dblChance = Math.min(P.dblChance, 0.9);
  P.execChance = Math.min(P.execChance, 0.6);
  P.ampChance = Math.min(P.ampChance, 0.8);
  return P;
}

/** 같은 종류가 여러 개 붙을 때 추가 타격 배율의 확률 가중 평균 */
function mixRatio(c0, r0, c1, r1) {
  const c = c0 + c1;
  return c > 0 ? (c0 * r0 + c1 * r1) / c : 0;
}

/** 공격 쪽 상시 배수 — 파티 DPS 에 곱한다 (전투 중 변하는 항은 뺀다) */
export const passiveAtkMult = P => (1 + (P.atkPct || 0)) * (1 + (P.spdPct || 0));

/** 받는 피해 배수. 방어력·체력 강화가 여기로 온다 —
 *  전투 모델에 DEF 스탯이 없어서(스테이지는 DPS 체크다) 감산으로 환산한다 */
export const passiveTakenMult = P => 1 / (1 + (P.defPct || 0) + (P.hpPct || 0));
