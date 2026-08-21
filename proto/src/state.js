// 게임 상태 + 규칙. data/*.json 을 단일 소스로 읽는다.

export const D = {};   // 로드된 데이터

const J = async (n) => (await fetch(`../data/${n}.json`)).json();

export async function loadData() {
  const names = ['characters', 'skills', 'gacha', 'equipment', 'stages', 'economy', 'codex'];
  const arr = await Promise.all(names.map(J));
  names.forEach((n, i) => D[n] = arr[i]);
}

// ---------- 수치 규칙 ----------
export const cpAt = (coef, lv) => coef * (1 + lv * 0.06);

export function requiredCp(n) {
  const cur = D.stages.curve;
  let cp = cur.baseCp;
  for (let i = 2; i <= n; i++) {
    const seg = cur.segments.find(s => i >= s.from && i <= s.to);
    cp *= (1 + seg.growthPerStage);
    const w = cur.walls[i];
    if (w) cp *= w.multiplier;
  }
  return cp;
}

export function stageGold(n) {
  const g = D.stages.rewards.repeatClear.gold;
  return Math.floor(Math.pow(requiredCp(n), g.exponent) * g.coefficient);
}

function band(lv, bands) {
  return bands.find(b => lv >= b.minLevel && lv <= b.maxLevel) || bands[bands.length - 1];
}

function rollFrom(rates, rng) {
  const e = Object.entries(rates).filter(([, v]) => v > 0);
  const tot = e.reduce((s, [, v]) => s + v, 0);
  let r = rng() * tot;
  for (const [k, v] of e) { r -= v; if (r <= 0) return k; }
  return e[e.length - 1][0];
}

// ---------- 상태 ----------
export const S = {
  gold: 0, diamond: 0, key: 0, ore: 0,
  mercSoul: 0, skillSoul: 0,
  mercs: {},        // id -> level
  skills: {},       // id -> {grade, level}
  pendMerc: {},     // id -> count (자동강화 대기)
  pendSkill: {},    // id -> [grade,...]
  equipped: { mercenary: [], skillActive: [], skillPassive: [] },
  gear: {},         // slotId -> {tier, enhance}
  gearInv: [],      // [{slot,tier,enhance}]
  lv: { merc: 1, skill: 1, equip: 1 },
  exp: { merc: 0, skill: 0 },
  forgeStart: 0, forgeMs: 0,
  stage: 1, maxStage: 1,
  autoSummon: false,
  speed: 1,
};

let seed = 20240819;
export const rng = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};

export function initNew() {
  S.gold = 50000; S.diamond = 3000; S.key = 60; S.ore = 5000;
  // 시작 용병 5종 — 직군을 섞어 단장 변신·대형을 바로 확인할 수 있게
  const start = ['N-03', 'N-04', 'R-02', 'R-03', 'R-06'];   // 전사3 / 궁수1 / 마법사1
  start.forEach(id => S.mercs[id] = 0);
  S.equipped.mercenary = start.slice();
  startForge();
}

// ---------- CP ----------
export function mercCp(id, lv) {
  return cpAt(D.characters.gradeCoef[gradeOf(id)], lv);
}
export const gradeOf = (id) => D.characters.characters.find(c => c.id === id).grade;
export const mercOf = (id) => D.characters.characters.find(c => c.id === id);
export const skillOf = (id) => D.skills.skills.find(s => s.id === id);

export function skillCp(grade, lv) {
  return cpAt(D.skills.gradeCoef[grade], lv);
}

export function gearBonus() {
  const G = D.equipment.grades, enh = D.equipment.enhancement;
  let b = 0;
  for (const s of D.equipment.slots) {
    const g = S.gear[s.id];
    if (!g) continue;
    const base = G.find(x => x.tier === g.tier).slotBonus;
    b += base * (1 + g.enhance * enh.bonusPerLevel);
  }
  return b;
}

export function gearCp(item) {          // 부위 1개의 CP 기여 근사
  const base = D.equipment.grades.find(x => x.tier === item.tier).slotBonus;
  return base * (1 + item.enhance * D.equipment.enhancement.bonusPerLevel);
}

export function totalCp() {
  let base = 0;
  for (const id of S.equipped.mercenary) base += mercCp(id, S.mercs[id] ?? 0);
  for (const id of [...S.equipped.skillActive, ...S.equipped.skillPassive]) {
    const s = S.skills[id]; if (s) base += skillCp(s.grade, s.level);
  }
  const m = (1 + gearBonus())
    * (1 + S.lv.merc * 0.005)
    * (1 + S.lv.skill * 0.005)
    * (1 + S.lv.equip * 0.008);
  return Math.floor(base * m);
}

// ---------- 소환 ----------
export function summonMerc(n = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = band(S.lv.merc, D.gacha.rateBands);
    const g = rollFrom(b.rates, rng);
    const pool = D.characters.characters.filter(c => c.grade === g);
    const c = pool[Math.floor(rng() * pool.length)];
    if (!c) continue;
    if (S.mercs[c.id] === undefined) S.mercs[c.id] = 0;
    else S.pendMerc[c.id] = (S.pendMerc[c.id] || 0) + 1;
    out.push(c);
    S.exp.merc++;
  }
  bumpLevel('merc');
  return out;
}

export function summonSkill(n = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = band(S.lv.skill, D.gacha.rateBands);
    const g = rollFrom(b.rates, rng);
    const pool = D.skills.skills;
    const s = pool[Math.floor(rng() * pool.length)];
    if (!S.skills[s.id]) S.skills[s.id] = { grade: g, level: 0 };
    else (S.pendSkill[s.id] = S.pendSkill[s.id] || []).push(g);
    out.push({ ...s, grade: g });
    S.exp.skill++;
  }
  bumpLevel('skill');
  return out;
}

export function summonGear(n = 1) {
  const eb = D.gacha.equipmentRateBands;
  const b = band(S.lv.equip, eb.bands);
  const slots = D.equipment.slots;
  const got = [];
  for (let i = 0; i < n; i++) {
    const tier = Number(rollFrom(b.rates, rng));
    const slot = slots[Math.floor(rng() * slots.length)].id;
    got.push({ slot, tier, enhance: 0 });
  }
  // 필터: 장착품보다 CP 기여가 높은 것만 보관, 나머지 분해
  let kept = 0, gold = 0;
  for (const it of got) {
    const cur = S.gear[it.slot];
    const better = !cur || gearCp(it) > gearCp(cur);
    const dupInv = S.gearInv.find(x => x.slot === it.slot);
    if (better && (!dupInv || gearCp(it) > gearCp(dupInv))) {
      if (dupInv) {
        gold += D.equipment.duplicateHandling.goldByTier[dupInv.tier] || 0;
        S.gearInv.splice(S.gearInv.indexOf(dupInv), 1);
      }
      S.gearInv.push(it); kept++;
    } else {
      gold += D.equipment.duplicateHandling.goldByTier[it.tier] || 0;
    }
  }
  if (S.gearInv.length > 12) {
    S.gearInv.sort((a, b2) => gearCp(b2) - gearCp(a));
    S.gearInv.splice(12).forEach(x => gold += D.equipment.duplicateHandling.goldByTier[x.tier] || 0);
  }
  S.gold += gold;
  return { total: n, kept, dismantled: n - kept, gold };
}

function bumpLevel(track) {
  const t = D.gacha.tracks[track === 'merc' ? 'mercenary' : 'skill'];
  const need = t.levelRequirement;
  let lv = 1, acc = 0;
  for (const r of need) {
    for (let l = r.fromLevel; l < r.toLevel; l++) {
      acc += r.pullsPerLevel;
      if (S.exp[track] >= acc) lv = l + 1;
    }
  }
  S.lv[track === 'merc' ? 'merc' : 'skill'] = Math.min(lv, t.maxLevel);
}

// ---------- 자동강화 (캐스케이드 포함) ----------
export function autoEnhance() {
  const capM = D.characters.levelCap, sv = D.characters.soulValue;
  let lvUps = 0, souls = 0, casc = [];

  for (const [id, cnt] of Object.entries(S.pendMerc)) {
    let n = cnt;
    while (n > 0) {
      const g = gradeOf(id);
      if ((S.mercs[id] ?? 0) < capM[g]) { S.mercs[id]++; lvUps++; n--; continue; }
      // 캐스케이드: CP 내림차순 중 캡 미달 대상
      const tgt = Object.keys(S.mercs)
        .filter(x => (S.mercs[x] ?? 0) < capM[gradeOf(x)])
        .sort((a, b) => mercCp(b, S.mercs[b]) - mercCp(a, S.mercs[a]))[0];
      if (!tgt) { souls += sv[g] * n; n = 0; break; }
      const give = Math.floor(sv[g] / sv[gradeOf(tgt)]);
      if (give < 1) { souls += sv[g]; n--; continue; }
      const room = capM[gradeOf(tgt)] - S.mercs[tgt];
      const use = Math.min(give, room);
      S.mercs[tgt] += use; lvUps += use;
      souls += (give - use) * sv[gradeOf(tgt)] + (sv[g] % sv[gradeOf(tgt)]);
      casc.push(`${mercOf(id).nameKo} MAX → ${mercOf(tgt).nameKo} +${use}`);
      n--;
    }
    delete S.pendMerc[id];
  }
  S.mercSoul += souls;

  let sUps = 0, sSouls = 0;
  const capS = D.skills.levelCap, ssv = D.skills.soulValue;
  for (const [id, list] of Object.entries(S.pendSkill)) {
    for (const g of list) {
      const cur = S.skills[id];
      if (!cur) { S.skills[id] = { grade: g, level: 0 }; continue; }
      if (D.skills.gradeCoef[g] > D.skills.gradeCoef[cur.grade]) cur.grade = g;  // 등급 갱신
      if (cur.level < capS[cur.grade]) { cur.level++; sUps++; }
      else sSouls += ssv[g];
    }
    delete S.pendSkill[id];
  }
  S.skillSoul += sSouls;
  return { lvUps: lvUps + sUps, souls: souls + sSouls, casc };
}

export const pendCount = () =>
  Object.values(S.pendMerc).reduce((a, b) => a + b, 0) +
  Object.values(S.pendSkill).reduce((a, b) => a + b.length, 0);

// ---------- 자동장착 ----------
export function bestParty() {
  const slots = 5;
  return Object.keys(S.mercs)
    .sort((a, b) => mercCp(b, S.mercs[b]) - mercCp(a, S.mercs[a]))
    .slice(0, slots);
}
export function bestSkills() {
  const pick = (type, n) => Object.entries(S.skills)
    .filter(([id]) => skillOf(id).type === type)
    .sort((a, b) => skillCp(b[1].grade, b[1].level) - skillCp(a[1].grade, a[1].level))
    .slice(0, n).map(([id]) => id);
  return { active: pick('active', 4), passive: pick('passive', 4) };
}
export function equipUpgradeAvailable() {
  const p = bestParty(), s = bestSkills();
  const diff = (a, b) => a.length !== b.length || a.some((x, i) => x !== b[i]);
  return diff(p, S.equipped.mercenary) || diff(s.active, S.equipped.skillActive) || diff(s.passive, S.equipped.skillPassive);
}
export function applyAutoEquip() {
  S.equipped.mercenary = bestParty();
  const s = bestSkills();
  S.equipped.skillActive = s.active;
  S.equipped.skillPassive = s.passive;
}

// ---------- 장비 교체 ----------
export function gearUpgrades() {
  const out = [];
  for (const s of D.equipment.slots) {
    const cand = S.gearInv.filter(x => x.slot === s.id)
      .sort((a, b) => gearCp(b) - gearCp(a))[0];
    if (!cand) continue;
    const cur = S.gear[s.id];
    if (!cur || gearCp(cand) > gearCp(cur)) out.push({ slot: s.id, item: cand, cur });
  }
  return out;
}
export function applyGear(list) {
  let gold = 0;
  for (const u of list) {
    if (u.cur) gold += D.equipment.duplicateHandling.goldByTier[u.cur.tier] || 0;
    S.gear[u.slot] = u.item;
    S.gearInv.splice(S.gearInv.indexOf(u.item), 1);
  }
  S.gold += gold;
  return gold;
}

// ---------- 대장간 ----------
export function forgeCost() {
  const e = D.economy.equipmentSummonLevel;
  return { ms: (e.timeMinutes[S.lv.equip - 1] ?? 60) * 60000, ore: e.oreCost[S.lv.equip - 1] ?? 999999 };
}
export function startForge() {
  const c = forgeCost();
  S.forgeStart = Date.now(); S.forgeMs = c.ms;
}
export function forgeProgress() {
  if (!S.forgeMs) return 1;
  return Math.min(1, (Date.now() - S.forgeStart) / S.forgeMs);
}
export function tickForge() {
  if (S.lv.equip >= 60) return false;
  if (forgeProgress() < 1) return false;
  const c = forgeCost();
  if (S.ore < c.ore) return false;
  S.ore -= c.ore; S.lv.equip++;
  startForge();
  return true;
}
export function speedupCost() {
  const left = Math.max(0, S.forgeMs - (Date.now() - S.forgeStart));
  return Math.max(5, Math.ceil(left / 60000 / 6));
}
export function gearTierUnlockHint() {
  const eb = D.gacha.equipmentRateBands;
  const fa = eb.firstAppearance;
  for (const [tier, lv] of Object.entries(fa)) {
    if (lv > S.lv.equip) {
      const g = D.equipment.grades.find(x => x.tier === Number(tier));
      return `다음 해금: ${g.nameKo} (Lv${lv})`;
    }
  }
  return '모든 등급 해금 완료';
}

export const fmt = (n) => {
  n = Math.floor(n);
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
};
