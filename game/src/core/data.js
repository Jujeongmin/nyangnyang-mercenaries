// data/*.json 로드 + 불변식 검증.
// 게임 규칙은 전부 여기서 나온다. 하드코딩된 수치를 코드에 심지 마라.
//
// 검증은 data/README.md 「절대 깨면 안 되는 불변식」 을 그대로 옮긴 것이다.
// 밸런스를 건드리면 여기서 먼저 터진다. 그게 목적이다.

const FILES = [
  'characters', 'skills', 'gacha', 'equipment', 'combat', 'stages', 'tower', 'dungeons',
  'quests', 'economy', 'goldsinks', 'arena', 'alliance', 'ranking', 'codex', 'dailies',
  'free1000', 'ui', 'shop', 'pass', 'profile', 'tutorial', 'sound', 'save-schema',
];

export const D = Object.create(null);

let loaded = false;

export async function loadData(base = '/data') {
  if (loaded) return D;
  const got = await Promise.all(
    FILES.map(async n => {
      const res = await fetch(`${base}/${n}.json`);
      if (!res.ok) throw new Error(`data/${n}.json 로드 실패 (${res.status})`);
      return [n, await res.json()];
    })
  );
  for (const [n, j] of got) D[n.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = j;
  const errs = validate(D);
  if (errs.length) {
    console.error('데이터 불변식 위반:\n' + errs.map(e => '  · ' + e).join('\n'));
    throw new Error(`데이터 불변식 ${errs.length}건 위반 — 콘솔 참조`);
  }
  loaded = true;
  return D;
}

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

export function validate(d) {
  const e = [];
  const push = (ok, msg) => { if (!ok) e.push(msg); };

  const ch = d.characters;
  const GRADES = ['N', 'R', 'SR', 'SSR', 'UR', 'LR'];

  // 불변식 1 — 등급 서열. 만렙 하위등급 CP < Lv0 상위등급 CP
  for (let i = 0; i < GRADES.length - 1; i++) {
    const lo = GRADES[i], hi = GRADES[i + 1];
    const loMax = ch.gradeCoef[lo] * (1 + ch.levelCap[lo] * ch.levelGrowthPerLevel);
    push(loMax < ch.gradeCoef[hi],
      `등급 서열 붕괴: ${lo} 만렙 ${Math.round(loMax)} >= ${hi} Lv0 ${ch.gradeCoef[hi]}`);
  }
  // LR 은 UR 만렙에 역전당하면 안 된다. 절대값을 박으면 전투력 자릿수를 못 바꾸므로
  // **UR 대비 배수**로 본다. 14000/4000 = 3.5 배가 기준이다.
  push(Math.abs(ch.gradeCoef.LR / ch.gradeCoef.UR - 3.5) < 0.01,
    `LR/UR 계수비가 ${(ch.gradeCoef.LR / ch.gradeCoef.UR).toFixed(2)}. 3.5 여야 UR 만렙에 안 밀린다`);

  // cpWeights 검산 — atk×2.0 + def×1.8 + hp×0.1 === gradeCoef
  const w = ch.cpWeights;
  for (const [cid, cls] of Object.entries(ch.classes)) {
    for (const g of GRADES) {
      const total = ch.gradeCoef[g] / cls.cpDivisor;
      const cp = total * cls.statRatio.atk / 100 * w.atk
               + total * cls.statRatio.def / 100 * w.def
               + total * cls.statRatio.hp / 100 * w.hp;
      push(Math.abs(cp - ch.gradeCoef[g]) / ch.gradeCoef[g] < 0.005,
        `CP 검산 실패: ${cid}/${g} → ${cp.toFixed(1)} ≠ ${ch.gradeCoef[g]}`);
    }
  }

  // 불변식 3 — 시너지 없음. 있으면 자동장착 그리디가 최적해가 아니게 된다
  push(ch.synergy === null, '시너지가 부활했다. 자동장착 그리디 정렬이 깨진다');

  // 로스터 수
  push(ch.characters.length === ch.meta.totalCharacters,
    `용병 수 불일치: 배열 ${ch.characters.length} vs meta ${ch.meta.totalCharacters}`);
  const dist = Object.values(ch.classDistribution).reduce((a, b) => a + b, 0);
  push(dist === ch.characters.length,
    `직군 배분 합 ${dist} ≠ 용병 수 ${ch.characters.length}`);
  const ids = new Set();
  for (const c of ch.characters) {
    push(!ids.has(c.id), `용병 ID 중복: ${c.id}`);
    ids.add(c.id);
    push(!!ch.gradeCoef[c.grade], `${c.id} 등급 ${c.grade} 미정의`);
    push(!!ch.classes[c.class], `${c.id} 직군 ${c.class} 미정의`);
    push(!!ch.elements[c.element], `${c.id} 속성 ${c.element} 미정의`);
  }
  // 단장은 로스터에 없어야 한다 (구 R-01 은 단장으로 승격됐다)
  push(!ids.has('R-01'), 'R-01 이 로스터에 남아 있다. 단장으로 승격된 항목이다');

  // 불변식 4 — 확률 공시. 각 밴드 합 100%
  for (const b of d.gacha.rateBands) {
    const sum = Object.values(b.rates).reduce((a, x) => a + x, 0);
    push(near(sum, 100, 0.01),
      `가챠 확률 합 ${sum} ≠ 100 (Lv${b.minLevel}-${b.maxLevel})`);
    for (const g of Object.keys(b.rates)) {
      push(GRADES.includes(g), `가챠 밴드에 미정의 등급 ${g}`);
    }
  }

  // 불변식 4-b — 계단. v3 에서 밴드가 레벨당 1행이 되면서, 표와 gradeUnlock /
  // gradeRemoval 이 어긋나면 "Lv5 에 SR 해금"이라는 공지가 거짓말이 된다.
  // 숫자만 만지다 계단이 깨지는 것을 여기서 잡는다.
  {
    const gk = d.gacha, bands = gk.rateBands;
    const maxLv = Math.max(...(gk.rateBandsAppliesTo || [])
      .map(id => gk.tracks[id]?.maxLevel || 0));
    // 레벨 1..maxLv 를 빠짐없이 한 번씩 덮는다
    for (let lv = 1; lv <= maxLv; lv++) {
      const hit = bands.filter(b => lv >= b.minLevel && lv <= b.maxLevel);
      push(hit.length === 1, `가챠 Lv${lv} 를 덮는 밴드가 ${hit.length}개 (1개여야 한다)`);
    }
    // 표에서 읽은 활성 구간이 gradeUnlock / gradeRemoval 과 같은가
    for (const g of GRADES) {
      const on = bands.filter(b => (b.rates[g] || 0) > 0).map(b => b.minLevel);
      if (!on.length) continue;
      const a = Math.min(...on), z = Math.max(...on);
      push(z - a + 1 === on.length, `가챠 ${g} 확률 구간이 끊겨 있다 (Lv${a}~${z})`);
      if (gk.gradeUnlock) {
        push(gk.gradeUnlock[g] === a,
          `가챠 gradeUnlock.${g}=${gk.gradeUnlock[g]} 인데 표에서는 Lv${a} 부터다`);
      }
      if (gk.gradeRemoval && gk.gradeRemoval[g] != null) {
        push(gk.gradeRemoval[g] === z + 1,
          `가챠 gradeRemoval.${g}=${gk.gradeRemoval[g]} 인데 표에서는 Lv${z} 까지다`);
      }
    }
    // 해금 순서는 등급 서열을 따라야 한다 — 상위가 먼저 열리면 계단이 아니다
    if (gk.gradeUnlock) {
      for (let i = 1; i < GRADES.length; i++) {
        const lo = gk.gradeUnlock[GRADES[i - 1]], hi = gk.gradeUnlock[GRADES[i]];
        push(lo != null && hi != null && lo <= hi,
          `가챠 해금 순서 역전: ${GRADES[i - 1]} Lv${lo} > ${GRADES[i]} Lv${hi}`);
      }
    }
  }

  // 불변식 6 — 등급 체계 두 벌. 장비는 10등급
  const eq = d.equipment;
  push(eq.grades.length === 10, `장비 등급 ${eq.grades.length}개. 10 이어야 한다`);
  const t10 = eq.grades[eq.grades.length - 1];
  push(near(t10.slotBonus, 0.1848, 1e-9),
    `장비 T10 slotBonus ${t10.slotBonus} ≠ 0.1848. CP 천장이 바뀐다`);
  push(eq.slots.length === 6, `장비 부위 ${eq.slots.length}개. 6 이어야 한다`);
  push(eq.setsRemoved !== false, '장비 세트가 부활했다. 부위별 그리디 자동장착이 깨진다');

  // 불변식 10 — 도감 예산 32% 고정
  const cx = d.characters.codex;
  push(near(cx.maxBonus, 0.32, 1e-9), `도감 maxBonus ${cx.maxBonus} ≠ 0.32`);
  push(near(cx.bonusPerRegistered * ch.characters.length, cx.maxBonus, 1e-9),
    `도감 예산 불일치: ${cx.bonusPerRegistered} × ${ch.characters.length} ≠ ${cx.maxBonus}`);

  // 스테이지
  push(d.stages != null, 'stages.json 없음');

  return e;
}

// data/*.json 조회 헬퍼 — 뷰가 JSON 구조를 직접 뒤지지 않게 한다
export const gradeCoef = g => D.characters.gradeCoef[g];
export const levelCap = g => D.characters.levelCap[g];
export const mercDef = id => D.characters.characters.find(c => c.id === id);
export const classDef = id => D.characters.classes[id];
export const skillDef = id => (D.skills.skills || D.skills.list || []).find(s => s.id === id);
export const equipSlots = () => D.equipment.slots;
export const equipGrade = tier => D.equipment.grades[tier - 1];

export function rateBand(track, level) {
  const bands = track === 'equipment' ? null : D.gacha.rateBands;
  if (!bands) return null;
  return bands.find(b => level >= b.minLevel && level <= b.maxLevel)
    || bands[bands.length - 1];
}
