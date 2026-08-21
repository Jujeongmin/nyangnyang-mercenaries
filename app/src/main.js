// 프로토타입 부트.
//
// 목적은 게임 완성이 아니라 **에셋 + 전투 모델 + 연출 레이어가 실제 화면에서 맞물리는지**
// 확인하는 것이다. 소환·강화는 아직 로컬 임시 로직이고, 확정 구현은 net/backend.js 를
// 거쳐야 한다 (app/ARCHITECTURE.md 이관 순서 6단계).
//
// 장비 규칙 (equipment.json):
//   · 소환 재화 = 장비 소환권. 제작대 레벨이 오르면 배치 크기·필터가 해금된다
//   · 장비 자체에는 레벨이 없다. 성장은 제작대 레벨과 등급(T1~T10) 뿐이다
//   · 자동 소환은 필터를 통과 못한 장비를 즉시 분해한다 (수동 소환은 필터 미적용)
//   · 장착은 자동 적용하지 않는다 — 계산은 시스템이, 확정은 유저가 누른다

import { loadData, D } from './core/data.js';
import { num, numExact, dur, cpNum } from './core/fmt.js';
import { BattleScene } from './view/battle/scene.js';
import { SummonReveal, tierToGrade } from './view/summon.js';
import { ShopScreen, summonProgress, levelRewardPending } from './view/shop.js';
import { CodexScreen, trainingCost, trainingBonus } from './view/codex.js';
import { RankScreen, SettingsScreen } from './view/rank.js';
import { MailScreen, ProfileScreen } from './view/profile.js';
import { questAt, questProgress, QUEST_TYPE } from './view/quest.js';
import { TowerScreen, towerCp, towerClear } from './view/tower.js';

const $ = s => document.querySelector(s);
const GC = { N: '#9aa4b5', R: '#4CAF50', SR: '#2196F3', SSR: '#9C27B0', UR: '#FF9800', LR: '#E91E63' };

const S = {
  stage: 1, maxStage: 1,
  dia: 300, gold: 1000,
  // 장비 소환 주재화(구 황금 열쇠). 제련석은 폐기됐다.
  eqTicket: 40,
  forgeLv: 1, forgeStart: null, forgeTarget: null, forgeCut: 0,
  party: [], equip: {}, inv: [],
  // 캐스케이드 이월. 레벨로 못 바꾼 중복 가치가 여기 남아 다음 중복 때 합산된다.
  // (혼을 폐기해서 적립할 재화가 없다 — economy.json > cascade.carryNote)
  carry: { mercenary: 0, skill: 0 },
  skills: { active: [], passive: [] },
  auto: true, autoSummon: false, autoAcc: 0,
  // 자동 소환 정지 기준. -1 = 지금 낀 것보다 좋으면(기본), N = 그 등급 이상.
  // 끄는 선택지는 없다 — 좋은 장비가 대기함에 묻히기 때문이다.
  autoStopTier: -1, autoBatch: 0,
  // 제작대 분할 납부. 다음 레벨에 지금까지 몇 회분을 넣었나
  forgePaid: 0,
  // 모래시계 — 제작 시간 단축 전용. 상단바에는 안 띄운다.
  hgOpen: false,                           // 단축 UI 펼침
  hgUse: 1,                                // 시간 단축에 한 번에 쓸 개수
  hourglass: 0,
  quest: 1, questProg: 0,
  // 던전 열쇠 — 던전별로 따로 센다. 매일 05:00 KST 에 3개로 채워진다.
  dgKeys: {}, dgKeyDay: 0,
  // 무한의 탑 — 입장 제한 없음, 직전에 뚫은 층 다음부터
  tower: { floor: 1, best: 0 },
  dg: {}, arenaScore: 1000, medal: 0,      // 훈장은 아레나에서만 벌고 아레나에서만 쓴다
  mercTicket: 0, skillTicket: 0,           // 소환 1회 대체. 다이아보다 먼저 쓴다
  summonExp: { mercenary: 0, skill: 0 },   // 누적 뽑기 횟수 = 소환 레벨 exp
  summonLvClaimed: { mercenary: 1, skill: 1 },  // 레벨 보상을 어디까지 받았나
  // 시즌 패스 — 티어별 수령 기록. 무료/유료를 따로 센다 (유료는 소급 지급이라)
  pass: { bought: false, free: [], paid: [] },
  skillAuto: true,                         // 끄면 준비된 스킬을 탭해서 쓴다
  capLv: 1, capXp: 0,                      // 단장(계정) 레벨. 스탯 효과 없음
  codex: { mercenary: [], skill: {} },     // 1회 획득 시 영구 등록
  trainLv: 0,                              // 훈련소
  nickname: null,                          // 첫 부팅에 자동 배정된다
  nickChanged: 0,                          // 변경 횟수. 0 이면 다음 변경이 무료
  nickChangedAt: 0,
  profile: { titleId: null, frameId: 'pf_default', featuredMercId: null, ownedTitles: [] },
  mailbox: [],
  idle: { lastClaimAt: Date.now(), freeUsed: 0, adUsed: 0, resetAt: Date.now() },
};

let scene, reveal, shop, codex, rank, settings, mail, profile, tower;

// --- CP ---
const cpOf = m => D.characters.gradeCoef[m.grade] * (1 + m.level * D.characters.levelGrowthPerLevel);
const skillCp = s => D.skills.gradeCoef[s.grade] * (1 + s.level * 0.06);

function equipBonus() {
  // equipment.json > totalBonusFormula. 장비 레벨이 없으므로 강화항은 쓰지 않는다.
  let b = 0;
  for (const s of D.equipment.slots) {
    const it = S.equip[s.id];
    if (it) b += D.equipment.grades[it.tier - 1].slotBonus;
  }
  return b;
}

/** codex.json > cpIntegration 의 곱연산 항을 그대로 따른다 */
function codexBonus() {
  const byG = D.codex.mercenary.individualByGrade;
  let b = 0;
  for (const id of S.codex.mercenary) {
    const c = D.characters.characters.find(x => x.id === id);
    if (c && byG[c.grade]) b += byG[c.grade].bonusEach;
  }
  const skG = D.codex.skill.individualByGrade;
  for (const g of Object.values(S.codex.skill)) b += skG[g] || 0;
  return Math.min(D.codex.budget.totalMaxBonus, b);
}

const trainDef = () => D.goldsinks.sinks.find(x => x.id === 'training_camp');

function totalCp() {
  let base = S.party.reduce((a, m) => a + cpOf(m), 0);
  base += [...S.skills.active, ...S.skills.passive].reduce((a, s) => a + (s ? skillCp(s) : 0), 0);
  return base
    * (1 + equipBonus())
    * (1 + codexBonus())
    * (1 + trainingBonus(trainDef(), S.trainLv))
    * (1 + S.forgeLv * 0.008);
}

/** 설정과 전투 화면 버튼이 같은 값을 보게 한다 */
function syncSpeedBtns() {
  document.querySelectorAll('#speed .sbtn').forEach(x =>
    x.classList.toggle('on', +x.dataset.sp === (S.speed || 1)));
}
// 진행은 항상 자동이다. 토글을 없앴으므로 이 값은 늘 true 로 둔다.
const AUTO_ADVANCE = true;

// ─────────────────────────────────────────────
// 단장 레벨 (계정 레벨)
//
// characters.json > captain.statEffect 가 "none" 이다.
//   "스탯을 붙이면 CP 천장과 총 뽑기 예산을 다시 계산해야 한다"
// 그래서 이 레벨은 **스탯을 주지 않는다.** 재화 보상과 표시용 진행도만 담당한다.
// 불변식 10(도감 예산 32% 고정)·불변식 5(총 뽑기 예산)를 건드리지 않기 위함이다.
// ─────────────────────────────────────────────
const capNeed = lv => 4 + lv * 2;          // 스테이지 클리어 수

function capGain(n = 1) {
  S.capXp = (S.capXp || 0) + n;
  let up = 0;
  while (S.capXp >= capNeed(S.capLv)) {
    S.capXp -= capNeed(S.capLv);
    S.capLv++;
    up++;
    // 보상은 재화만. 스탯은 주지 않는다.
    S.dia += 50;
    if (S.capLv % 5 === 0) S.eqTicket += 10;
  }
  if (up) showLevelUp();
  renderCaptain();
}

function renderCaptain() {
  $('#caplv').textContent = S.capLv;
  const un = (S.mailbox || []).filter(x => !x.claimed).length;
  const mb = document.querySelector('.side button[data-s="mail"]');
  if (mb) mb.classList.toggle('hasnew', un > 0);
  const need = capNeed(S.capLv);
  $('#xpfill').style.width = Math.min(100, (S.capXp / need) * 100) + '%';
}

function showLevelUp() {
  const el = $('#lvup');
  el.querySelector('b').textContent = `단장 Lv ${S.capLv}`;
  el.querySelector('span').textContent =
    S.capLv % 5 === 0 ? '다이아 +50 · 장비 소환권 +10' : '다이아 +50';
  el.classList.remove('show'); void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
}

// ─────────────────────────────────────────────
// 재화 획득 플로팅
// ui.json > criticalUiRules — 증가는 즉시 화면에 뜬다
// ─────────────────────────────────────────────
const CUR_EL = { dia: '#c_dia', gold: '#c_gold' };
let lastCur = null;

function floatCurrency() {
  if (!lastCur) { lastCur = { dia: S.dia, gold: S.gold }; return; }
  for (const [k, sel] of Object.entries(CUR_EL)) {
    const d = S[k] - lastCur[k];
    if (d > 0) {
      const host = $(sel).parentElement;
      const e = document.createElement('span');
      e.className = 'curup';
      e.textContent = '+' + num(d);
      host.appendChild(e);
      setTimeout(() => e.remove(), 1150);
    }
    lastCur[k] = S[k];
  }
}

/**
 * 우편 수령. save-schema.json > mailbox
 *   실제로는 서버 함수다 (net/backend.js > claimMail). 여기는 임시 구현이다.
 *   claimed 플래그를 남겨야 중복 수령을 막을 수 있다.
 */
const MAIL_CUR = {
  diamond: 'dia', gold: 'gold', equip_ticket: 'eqTicket', speedup_5m: 'hourglass',
  arena_medal: 'medal', merc_ticket: 'mercTicket', skill_ticket: 'skillTicket',
};

/**
 * 닉네임 자동 배정. profile.json > nickname.autoAssign
 * 첫 화면에서 이름부터 지으라고 하면 이탈한다. 붙여 주고 나중에 바꾸게 한다.
 */
function autoNickname() {
  const a = D.profile.nickname.autoAssign;
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const n = String(1 + ((Math.random() * 99) | 0)).padStart(2, '0');
  return `${pick(a.adjectives)}${pick(a.animals)}${n}`;
}

/** 변경 비용. 첫 변경은 무료, 이후 다이아 + 쿨타임 (changePolicy) */
function nickCost() {
  const c = D.profile.nickname.changePolicy;
  if (!S.nickChanged && c.firstSetFree) return { free: true, dia: 0, waitDays: 0 };
  const days = c.cooldownDays || 0;
  const left = Math.max(0, S.nickChangedAt + days * 86400e3 - Date.now());
  return { free: false, dia: c.changeCost.diamond, waitDays: Math.ceil(left / 86400e3) };
}

function setNickname(name) {
  const v = D.profile.nickname;
  const t = (name || '').trim();
  if (t.length < v.minLength || t.length > v.maxLength)
    return toast(`${v.minLength}~${v.maxLength}자로 입력하세요`);
  if (!/^[가-힣a-zA-Z0-9]+$/.test(t)) return toast('한글·영문·숫자만 쓸 수 있습니다');
  const c = nickCost();
  if (c.waitDays > 0) return toast(`${c.waitDays}일 뒤에 변경할 수 있습니다`);
  if (!c.free && S.dia < c.dia) return toast(`다이아 ${num(c.dia)} 필요`);
  if (!c.free) S.dia -= c.dia;
  S.nickname = t;
  S.nickChanged = (S.nickChanged || 0) + 1;
  S.nickChangedAt = Date.now();
  save(); renderTop(); profile.render();
  toast(c.free ? '닉네임을 정했습니다' : `닉네임 변경 · 다이아 -${num(c.dia)}`);
}

function claimMail(i) {
  const list = (S.mailbox || []).filter(x => !x.claimed);
  const m0 = list[i];
  if (!m0) return;
  for (const [k, v] of Object.entries(m0.grants)) {
    const bag = MAIL_CUR[k];
    if (bag) S[bag] += v;
  }
  m0.claimed = true;
  save(); mail.render(); renderTop();
  toast(`${m0.title} 수령`);
}

/** 던전 일일 수령·아레나 티어 보상이 우편으로 온다. 데모용 지급. */
function seedMail() {
  if (S.mailbox.length) return;
  const tier = D.arena.tiers[0];
  S.mailbox = [
    { id: 'm1', title: '아레나 티어 보상', from: '아레나',
      grants: { arena_medal: tier.dailyMedals, diamond: tier.dailyDiamond },
      createdAt: Date.now() - 3600e3 * 5, claimed: false },
    { id: 'm2', title: '황금 광산 일일 수령', from: '던전',
      grants: { gold: Math.round(D.dungeons.dungeons[0].baseYield) },
      createdAt: Date.now() - 3600e3 * 20, claimed: false },
    { id: 'm3', title: '출시 기념 선물', from: '운영팀',
      grants: { diamond: 1000, equip_ticket: 30 },
      createdAt: Date.now() - 3600e3 * 40, claimed: false },
  ];
}

/** 퀘스트 진행도 — 상태에서 직접 읽는다. 별도 카운터를 두면 어긋난다. */
function qProgress(def) {
  if (def.type === 'power_reach') return Math.round(totalCp());
  return questProgress(S, def);
}

const QUEST_CUR = { diamond: 'dia', gold: 'gold', equip_ticket: 'eqTicket', speedup_5m: 'hourglass' };

/** 보상 수령. 실제로는 서버 함수다 (net/backend.js > claimQuest). */
function claimQuest() {
  const def = questAt(D, S.quest);
  if (qProgress(def) < def.target) return toast('아직 조건 미달');
  for (const [k, v] of Object.entries(def.rewards)) {
    const bag = QUEST_CUR[k];
    if (bag) S[bag] += v;
  }
  S.quest++;
  save();
  renderQuest(); renderTop();

  toast(`Q${def.q} 완료 — 보상 수령`);
}


// ─────────────────────────────────────────────
// 저장
//
// 임시 구현이다. 확정 구현은 net/backend.js 를 거쳐 서버가 쓴다
// (save-schema.json > meta.authority: server_write_only).
// 특히 lastSeenAt 은 서버 시각이어야 한다 — 클라가 보내면 무한 방치 보상이 된다.
// ─────────────────────────────────────────────
const SAVE_KEY = 'nyang:proto:v1';
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, lastSeenAt: Date.now(), s: S }));
    } catch (e) { console.warn('저장 실패', e); }
  }, 400);
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (j.v !== 1) return null;
    Object.assign(S, j.s);
    return j.lastSeenAt;
  } catch { return null; }
}

function resetSave() {
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

/**
 * 스테이지 요구 CP. stages.json > curve 를 그대로 계산한다.
 *   requiredCp(n) = requiredCp(n-1) * (1 + baseGrowth(n)) * (wallMultiplier(n) or 1)
 * 근사식을 쓰면 벽 위치와 값이 어긋나 게이트 설계가 통째로 틀어진다.
 */
const _cpCache = [];
function requiredCp(n) {
  if (_cpCache[n]) return _cpCache[n];
  const c = D.stages.curve;
  let cp = c.baseCp;
  _cpCache[1] = cp;
  for (let i = 2; i <= n; i++) {
    const seg = c.segments.find(s => i >= s.from && i <= s.to);
    // walls 는 배열이 아니라 { "50": {multiplier}, ... } 객체다
    const wall = c.walls?.[i];
    cp *= (1 + (seg ? seg.growthPerStage : 0.002)) * (wall ? wall.multiplier : 1);
    _cpCache[i] = Math.round(cp);
  }
  return _cpCache[n];
}

/**
 * 챕터-스테이지 2단 표기. 버섯커의 "일반 5-6" 형식.
 * 한 챕터 10 스테이지 x 20 챕터 = 200. 지역명은 stages.json > backgrounds 에서 가져온다.
 */
const CH_SIZE = 10;
function stageLabel(n) {
  const ch = Math.floor((n - 1) / CH_SIZE) + 1;
  const sub = ((n - 1) % CH_SIZE) + 1;
  const zone = D.stages.backgrounds.find(b => n >= b.from && n <= b.to);
  return { ch, sub, zone: zone ? zone.nameKo : '', text: `일반 ${ch}-${sub}` };
}
const bgFor = n => {
  const b = D.stages.backgrounds.find(x => n >= x.from && n <= x.to)
    || D.stages.backgrounds[D.stages.backgrounds.length - 1];
  return b.asset.replace('bg_BG', 'BG-');
};

// 파티 총 DPS. 환산 패시브(DEF/HP → ATK)를 반영한다 —
// characters.json > statDerivation.conversion 과 같은 식이어야 한다.
function partyDps() {
  const cls = D.characters.classes;
  const gear = (1 + equipBonus()) * (1 + S.forgeLv * 0.008);
  const aps = D.combat.attack.baseAttacksPerSecond;
  let dps = 0;
  for (const m of S.party) {
    const c = cls[m.class], p = c.passive;
    const t = cpOf(m) / c.cpDivisor;
    const atk = t * c.statRatio.atk / 100
      + (t * c.statRatio.def / 100) * (p.atkFromDef || 0)
      + (t * c.statRatio.hp / 100) * (p.atkFromHp || 0);
    dps += atk * aps * (1 + (p.atkSpeedAdd || 0));
  }
  return dps * gear;
}

// --- 제작대(장비 소환) 레벨 ---
const forgeCurve = () => D.economy.equipmentSummonLevel;
/**
 * 다음 레벨 비용. 총액은 고정이고 installments 회로 쪼개 넣는다.
 * economy.json > equipmentSummonLevel.goldCost / installments
 */
function forgeCost(target) {
  const t = forgeCurve(), i = target - 2;
  if (i < 0 || i >= t.goldCost.length) return null;
  const parts = t.installments[i];
  return { gold: t.goldCost[i], parts, per: Math.ceil(t.goldCost[i] / parts), sec: t.timeMinutes[i] * 60 };
}
/** 남은 납부 횟수 */
function forgeLeft() {
  const c = forgeCost(S.forgeLv + 1);
  return c ? c.parts - (S.forgePaid || 0) : 0;
}

/** 남은 제작 시간(초). 모래시계로 줄어든 분은 forgeCut 에 쌓인다. */
function forgeRemain() {
  if (!S.forgeStart) return 0;
  const c = forgeCost(S.forgeTarget);
  if (!c) return 0;
  return Math.max(0, c.sec - (S.forgeCut || 0) - (Date.now() - S.forgeStart) / 1000);
}

/** 1회분 납부. 마지막 회차를 넣으면 제작 타이머가 돌기 시작한다. */
function payForge() {
  if (S.forgeStart) return toast('이미 제작 중');
  const next = S.forgeLv + 1;
  const c = forgeCost(next);
  if (!c) return toast('최대 레벨');
  if (S.gold < c.per) return toast(`골드 부족 · ${num(c.per)} 필요`);
  S.gold -= c.per;
  S.forgePaid = (S.forgePaid || 0) + 1;
  if (S.forgePaid >= c.parts) {
    S.forgePaid = 0;
    S.forgeStart = Date.now(); S.forgeTarget = next; S.forgeCut = 0;
    toast(`Lv ${next} 제작 시작 · ${dur(c.sec)}`);
  } else {
    toast(`${S.forgePaid}/${c.parts} 투입 · 골드 -${num(c.per)}`);
  }
  save(); renderTop(); renderForgeDock();
  if ($('#ov').classList.contains('show')) openForge();
}

/** 모래시계 1개 = 5분 단축. economy.json > speedup.minutesPerItem */
function useHourglass(n = 1) {
  if (!S.forgeStart) return toast('제작 중이 아닙니다');
  n = Math.min(n, S.hourglass || 0);
  if (n <= 0) return toast('모래시계 부족');
  S.hourglass -= n;
  S.forgeCut = (S.forgeCut || 0) + n * 300;
  if (forgeRemain() <= 0) finishForge();
  else { save(); openForge(); toast(`${n * 5}분 단축`); }
}

function finishForge() {
  S.forgeLv = S.forgeTarget;
  S.forgeStart = null; S.forgeTarget = null; S.forgeCut = 0;
  save(); renderTop(); renderEquip(); renderForgeDock();
  toast(`제작대 Lv ${S.forgeLv}`);
  if ($('#ov').classList.contains('show')) openForge();
}
/** 소환 레벨로 해금된 progression 항목 */
function forgeUnlocks() {
  return D.equipment.summon.progression.filter(p => p.summonLv <= S.forgeLv);
}
const batchSize = () => {
  const p = forgeUnlocks().filter(x => x.pullsPerBatch);
  return p.length ? p[p.length - 1].pullsPerBatch : 0;
};
const autoUnlocked = () => forgeUnlocks().some(p => p.unlock === 'auto_summon');
const multiUnlocked = () => forgeUnlocks().some(p => p.unlock === 'manual_multi');

// --- 렌더 ---
function renderSkills() {
  const box = $('#skills');
  box.innerHTML = '';
  const mk = (s, i, kind) => {
    const d = document.createElement('div');
    d.className = 'sk' + (s ? '' : ' lock');
    if (s) {
      d.style.borderColor = GC[s.grade];
      d.style.boxShadow = `0 0 6px ${GC[s.grade]}55`;
      d.innerHTML = `<img src="../assets/skill/${s.id}.png" alt="">`;
      d.title = `${s.nameKo} ${s.grade} Lv${s.level}`;
    } else {
      d.title = `${kind} ${i + 1}번 칸 — 비어 있음`;
    }
    return d;
  };
  S.skills.active.forEach((s, i) => {
    const d = mk(s, i, '액티브');
    // 수동 모드에서는 탭이 곧 발동이다. 준비 표시는 scene 이 ready 클래스로 준다.
    if (s) d.addEventListener('click', () => {
      if (!S.skillAuto) scene.castSkillManual?.(i);
    });
    d.dataset.si = i;
    box.appendChild(d);
  });
  const gap = document.createElement('div'); gap.className = 'skgap'; box.appendChild(gap);
  S.skills.passive.forEach((s, i) => box.appendChild(mk(s, i, '패시브')));
}

/** equipment.json 의 assetPrefix(equip_EQW) → 파일명(EQ-W) */
/**
 * 장비 아이콘. 등급대(밴드)마다 그림이 다르다 — 티어가 올라도 같은 그림이면
 * 좋은 걸 뽑은 보람이 화면에 안 남는다. equipment.json > assetNote
 *   B1 T1-3   B2 T4-6   B3 T7-8   B4 T9-10
 */
const eqBand = tier => tier <= 3 ? 1 : tier <= 6 ? 2 : tier <= 8 ? 3 : 4;
const eqIcon = (slot, tier) => slot.assetPrefix.replace('equip_EQ', 'EQ-')
  + (tier ? `${eqBand(tier)}` : '');

/** 밴드 아트가 아직 없으면 기존 1장으로 떨어진다 */
const eqImg = (slot, tier) => `<img src="../assets/equip/${eqIcon(slot, tier)}.png" alt=""`
  + ` onerror="this.onerror=null;this.src='../assets/equip/${eqIcon(slot)}.png'"`;

/** 인벤토리에서 해당 부위의 최고 등급 대기품 */
function bestPending(slotId) {
  const list = S.inv.filter(x => x.slot === slotId);
  if (!list.length) return null;
  return list.reduce((a, b) => (b.tier > a.tier ? b : a));
}

/**
 * 인벤토리 아래 제작대 도크. 참고 화면처럼 **오브젝트 자체가 버튼**이다.
 *   본체 탭 = 수동 1회 소환 / Lv 뱃지 = 레벨업 패널 / 게이지 = 골드 투입 진행도
 */
function renderForgeDock() {
  const vis = forgeStageAsset();
  const st = vis ? vis.stage : 1;
  // 전 단계가 스트립 재생이다. 단계가 바뀔 때만 배경을 갈아 끼운다.
  const anim = $('#foAnim');
  if (anim.dataset.st !== String(st)) {
    anim.dataset.st = String(st);
    anim.style.setProperty('--strip', `url(../assets/ui/FO-0${st}-STRIP.png)`);
  }
  // 제작 중이면 뱃지가 남은 시간을 띄운다. 투입 진행도는 패널에서 본다.
  const busy = !!S.forgeStart;
  $('#fgLv').classList.toggle('busy', busy);
  $('#fgLv').textContent = busy ? dur(forgeRemain()) : `Lv ${S.forgeLv}`;
  $('#fgTicketN').textContent = num(S.eqTicket);
  $('#fgObj').classList.toggle('empty', S.eqTicket < 1);

  const b = $('#b_auto');
  b.disabled = !autoUnlocked();
  // 상태는 톱니가 도는지로 말한다 — 글자를 안 쓴다
  b.title = !autoUnlocked() ? '제작대 Lv 10 에 해금' : (S.autoSummon ? '자동 소환 중' : '자동 소환 꺼짐');
  b.classList.toggle('on', !!S.autoSummon && autoUnlocked());
}

/**
 * 자동 소환 설정. 참고 화면의 AUTO 토글을 누르면 뜨는 패널이다.
 *   멈춤 등급  이 등급 이상이 나오면 자동을 멈춘다 (equipment.json > summon filter_grade, Lv20 해금)
 *   동시 개수  한 배치에 몇 개를 여는가 (progression.pullsPerBatch 가 상한)
 */
function openAutoPanel() {
  if (!autoUnlocked()) return toast(`제작대 Lv 10 부터 자동 소환이 열립니다`);
  const maxB = batchSize();
  const opts = [1, 10, 30, 50, 100, maxB].filter((v, i, a) => v <= maxB && a.indexOf(v) === i);
  const cur = S.autoBatch || maxB;

  const h = [];
  h.push(`<div class="as-row"><span>동시에 여는 개수 · 최대 ${maxB}</span>`
    + opts.map(v => `<button class="as-g ${v === cur ? 'on' : ''}" data-b="${v}">${v}</button>`).join('')
    + '</div>');

  // 정지는 항상 켜져 있다. 끄는 선택지를 두면 좋은 장비가 대기함에 묻힌다.
  h.push(`<div class="as-row"><span>이럴 때 멈춘다</span>`
    + `<button class="as-g ${S.autoStopTier === -1 ? 'on' : ''}" data-t="-1"
        style="flex:1 1 100%">지금보다 전투력이 오르면</button>`
    + D.equipment.grades.map(g =>
        `<button class="as-g ${S.autoStopTier === g.tier ? 'on' : ''}" data-t="${g.tier}"`
        + ` style="color:${g.color}">${g.nameKo}</button>`).join('')
    + '</div>');

  h.push(`<div class="frow"><span class="k">보유 장비 소환권</span>
    <span class="v">${num(S.eqTicket)}</span></div>`);
  h.push(`<button class="fgbtn" id="asGo" style="margin-top:8px">`
    + (S.autoSummon ? '자동 소환 정지' : '자동 소환 시작') + '</button>');

  $('#ovt').textContent = '자동 소환';
  $('#ovb').innerHTML = h.join('');
  $('#ovinfo').innerHTML = '';
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

  $('#ovb').querySelectorAll('[data-b]').forEach(x => x.addEventListener('click', () => {
    S.autoBatch = +x.dataset.b; save(); openAutoPanel();
  }));
  $('#ovb').querySelectorAll('[data-t]').forEach(x => x.addEventListener('click', () => {
    S.autoStopTier = +x.dataset.t; save(); openAutoPanel();
  }));
  $('#asGo').addEventListener('click', () => {
    S.autoSummon = !S.autoSummon;
    save(); renderForgeDock(); openAutoPanel();
    toast(S.autoSummon ? '자동 소환 시작' : '자동 소환 정지');
  });
}

function renderEquip() {
  // 좌측 3x2 = 장비 6부위, 우측 3x2 = 미구현 시스템 자리
  const box = $('#eqL');
  const future = $('#eqR');
  box.innerHTML = '';
  future.innerHTML = '';
  let ups = 0;
  for (const s of D.equipment.slots) {
    const it = S.equip[s.id];
    const best = bestPending(s.id);
    const up = best && (!it || best.tier > it.tier);
    if (up) ups++;
    const d = document.createElement('div');
    d.className = 'slot' + (up ? ' up' : '');
    if (it) {
      const g = D.equipment.grades[it.tier - 1];
      d.style.borderColor = g.color;
      // 등급 오라. 밴드가 같아도(T4/T5/T6) 발광 세기로 갈린다.
      d.style.setProperty('--au', g.color);
      d.style.setProperty('--aw', (it.tier / 10).toFixed(2));
      if (it.tier >= 5) d.classList.add('g-hi');
      // 액자는 3단계뿐이라 밴드 3·4 를 한 칸으로 묶는다 (FRE-03)
      d.classList.add(`fre-${Math.min(3, eqBand(it.tier))}`);
      d.innerHTML = `${eqImg(s, it && it.tier)}>
        <b style="color:${g.color}">${s.nameKo}</b>`;
    } else {
      // 미장착도 아이콘을 흐리게 — 빈 칸만 있으면 어느 부위인지 안 읽힌다
      d.innerHTML = `${eqImg(s, null)}
        style="opacity:.22;filter:grayscale(1)"><span
        style="position:absolute;bottom:2px">${s.nameKo}</span>`;
    }
    if (up) d.innerHTML += '<span class="arrow">▲</span>';
    d.title = `${s.nameKo}${it ? ` T${it.tier}` : ' 비어 있음'}`;
    // 칸을 누르면 정보를 본다. 착용은 여전히 소환 결과 화면에서만 한다.
    d.addEventListener('click', () => openEquipInfo(s.id));
    box.appendChild(d);
  }
  // 보관함을 없앴으므로 대기 장비는 제작대의 빛으로만 알린다.
  // equipment.json > equipFlow: "뱃지가 곧 복귀 동기다"
  // 우측 — 추후 시스템 자리. 잠긴 칸도 격자를 유지해야 "생길 자리"로 읽힌다.
  for (const nm of ['룬', '문장', '탈것', '정령', '날개', '펫']) {
    const d = document.createElement('div');
    d.className = 'slot future';
    d.innerHTML = `<img class="lk" src="../assets/ui/UI-LOCK.png" alt=""><span>${nm}</span>`;
    d.title = `${nm} — 업데이트 예정`;
    future.appendChild(d);
  }
  $('#eqInfo').textContent = ups ? `교체 가능 ${ups}` : '';
  $('#fgBadge').style.display = ups ? '' : 'none';
  $('#fgBadge').textContent = ups || '';
  $('#fgObj').classList.toggle('ready', ups > 0);
}


/**
 * 방치 보상. 접속 팝업이 아니라 **메인 화면 보물상자**로 노출한다.
 * dailies.json > idleReward.uiNote — 팝업은 첫 화면을 가려 이탈을 만든다.
 *
 * 두 갈래다:
 *   누적분   시간이 지나면 쌓인다. 9시간 캡 (stages.json > idle)
 *   즉시수령 2시간분을 당겨받는다. 무료 2회 + 광고 2회 = 하루 최대 8시간분
 */
const idleDef = () => D.stages.idleReward;
const instDef = () => D.dailies.idleReward.instantClaim;

/** 05:00 KST 기준 일자. 서버가 판정해야 하는 값이다. */
const dayIdx = t => Math.floor((t + 9 * 3600e3 - 5 * 3600e3) / 86400e3);

function idleResetIfNeeded() {
  if (dayIdx(S.idle.resetAt) < dayIdx(Date.now())) {
    S.idle.freeUsed = 0; S.idle.adUsed = 0; S.idle.resetAt = Date.now();
  }
}

function idleHours() {
  const h = (Date.now() - S.idle.lastClaimAt) / 3600e3;
  return Math.min(h, idleDef().maxAccumulationHours);
}

/** 시간당 골드 = stageGold(최고돌파) x 156.5 x 0.35 */
function idleGold(hours) {
  const r = idleDef();
  const stageGold = Math.pow(requiredCp(S.maxStage), 1.35) * D.stages.rewards.repeatClear.gold.coefficient;
  return Math.round(stageGold * r.stagesPerHour * r.offlineEfficiency * hours);
}

/**
 * 방치 보상 상자. 누적 비율에 따라 상자 그림이 3단계로 찬다 (CH-01~03).
 * 숫자를 읽어야 얼마나 찼는지 아는 구조면 복귀 동기가 안 생긴다.
 */
function renderChest() {
  idleResetIfNeeded();
  const h = idleHours();
  const cap = idleDef().maxAccumulationHours;
  const r = cap ? h / cap : 0;
  $('#chestT').textContent = h < 1 ? `${Math.floor(h * 60)}분` : `${h.toFixed(1)}시간`;
  const step = r >= 0.7 ? 3 : r >= 0.3 ? 2 : 1;
  const src = `../assets/ui/CH-0${step}.png`;
  const img = $('#chestImg');
  if (img && !img.src.endsWith(`CH-0${step}.png`)) img.src = src;
  $('#chest').classList.toggle('full', r >= 0.5);
}

function openIdle() {
  idleResetIfNeeded();
  const h = idleHours();
  const inst = instDef();
  const freeLeft = inst.freeDaily - S.idle.freeUsed;
  const adLeft = inst.adDaily - S.idle.adUsed;

  $('#idTime').textContent =
    `${Math.floor(h)}시간 ${Math.round((h % 1) * 60)}분 누적 (최대 ${idleDef().maxAccumulationHours}시간)`;
  $('#idGold').textContent = num(idleGold(h));
  $('#idOk').disabled = h < 0.02;
  $('#idAd').disabled = h < 0.02;

  $('#idFreeN').textContent = ` 무료 ${freeLeft}/${inst.freeDaily} 남음`;
  $('#idFree').disabled = freeLeft <= 0;
  // 광고는 무료를 다 쓴 뒤에만 열린다
  $('#idAdN').textContent = freeLeft > 0
    ? ` 무료 소진 후 열림`
    : ` 광고 ${adLeft}/${inst.adDaily} 남음`;
  $('#idAdInstant').disabled = freeLeft > 0 || adLeft <= 0;

  $('#idle').classList.add('show');
}

function claimIdle(mult) {
  const h = idleHours();
  if (h < 0.02) return;
  const g = idleGold(h) * mult;
  S.gold += g;
  S.idle.lastClaimAt = Date.now();
  $('#idle').classList.remove('show');
  save(); renderTop(); renderChest();
  toast(`골드 +${num(g)}`);
}

/** 2시간분을 즉시 지급. 누적 타이머는 건드리지 않는다. */
function claimInstant(useAd) {
  idleResetIfNeeded();
  const inst = instDef();
  if (useAd) {
    if (S.idle.freeUsed < inst.freeDaily) return toast('무료 수령을 먼저 사용하세요');
    if (S.idle.adUsed >= inst.adDaily) return toast('오늘 광고 수령을 모두 사용했습니다');
    S.idle.adUsed++;
  } else {
    if (S.idle.freeUsed >= inst.freeDaily) return toast('오늘 무료 수령을 모두 사용했습니다');
    S.idle.freeUsed++;
  }
  const g = idleGold(inst.hoursPerClaim);
  S.gold += g;
  save(); renderTop(); openIdle();
  toast(`${inst.hoursPerClaim}시간 보상 — 골드 +${num(g)}`);
}


/**
 * 소환 레벨 보상 수령. gacha.json > tracks[].levelReward
 * 자동 지급이 아니다 — 받는 행위가 곧 "레벨이 올랐다"는 인지다.
 */
function claimSummonLevel(id) {
  const tr = D.gacha.tracks[id];
  const lv = summonProgress(tr, S.summonExp?.[id] ?? 0).level;
  const n = levelRewardPending(tr, lv, S.summonLvClaimed?.[id]);
  if (!n) return;
  const bag = id === 'skill' ? 'skillTicket' : 'mercTicket';
  S[bag] = (S[bag] || 0) + n;
  S.summonLvClaimed = S.summonLvClaimed || { mercenary: 1, skill: 1 };
  S.summonLvClaimed[id] = lv;
  save(); renderTop();
  toast(`${tr.nameKo} 레벨 보상 · 소환권 +${n}`);
}

/** 소환 탭에 받을 게 있나. 하단 네비 상점 아이콘의 빨간 점에 쓴다. */
function summonRewardWaiting() {
  return ['mercenary', 'skill'].some(id => {
    const tr = D.gacha.tracks[id];
    const lv = summonProgress(tr, S.summonExp?.[id] ?? 0).level;
    return levelRewardPending(tr, lv, S.summonLvClaimed?.[id]) > 0;
  });
}

/** 소환 실행. gacha.json > rateBands 가 확률 단일 소스다. */
function pull(trackId, n) {
  const tr = D.gacha.tracks[trackId];
  if (!tr) return;
  // 소환권이 있으면 그만큼 먼저 쓴다. economy.json > currencies.*_ticket 의 '소환 1회 대체'.
  const bag = trackId === 'skill' ? 'skillTicket' : 'mercTicket';
  const byTicket = Math.min(S[bag], n);
  const rest = n - byTicket;
  const full = n >= 10 ? tr.costs.diamondPer10Pull : tr.costs.diamondPerPull * n;
  // 10연 할인은 10장을 실제로 다이아로 낼 때만 적용된다
  const cost = rest === n ? full : tr.costs.diamondPerPull * rest;
  if (S.dia < cost) return toast(`다이아 ${num(cost - S.dia)} 부족`);
  S[bag] -= byTicket;
  S.dia -= cost;
  S.summonExp[trackId] = (S.summonExp[trackId] || 0) + n;   // 소환 레벨 exp

  const lv = 1;
  const band = D.gacha.rateBands.find(b => lv >= b.minLevel && lv <= b.maxLevel)
    || D.gacha.rateBands[0];
  const roll = () => {
    let r = Math.random() * 100;
    for (const [g, v] of Object.entries(band.rates)) { r -= v; if (r <= 0) return g; }
    return 'N';
  };

  const out = Array.from({ length: n }, () => {
    const g = roll();
    if (trackId === 'skill') {
      const pool = D.skills.skills;
      const sk = pool[(Math.random() * pool.length) | 0];
      return { grade: g, name: sk.nameKo, img: `../assets/skill/${sk.id}.png`,
               id: sk.id, kind: 'skill' };
    }
    const pool = D.characters.characters.filter(c => c.grade === g);
    const c = pool[(Math.random() * pool.length) | 0];
    return { grade: g, name: c.nameKo, img: `../assets/char/${c.id}.png`,
             id: c.id, cls: c.class, kind: 'merc' };
  });

  // 상점을 닫지 않는다. #reveal(z 80) 이 #shop(z 70) 을 이미 덮는데,
  // 닫으면 연출이 페이드되는 동안 뒤에 메인 화면이 비친다.
  reveal.play(trackId, out, () => { applyPulls(out); shop.render(); });
  renderTop();
}

// ─────────────────────────────────────────────
// 캐스케이드 — economy.json > cascade
//
// 캡을 찍었거나 편성에 못 든 중복은 **가치로 환산**해 편성된 대상의 레벨로 넘긴다.
// 등급별 가치는 dupeValue (N 1 / R 3 / SR 10 / SSR 30 / UR 100 / LR 300),
// 레벨 1당 비용은 **대상 등급의** 가치다. 그래서 N 100장으로 UR 을 1레벨 올린다.
//
// 나머지를 버리면 N 중복이 영원히 무가치해진다. 혼을 폐기했으므로 적립할 재화도
// 없다 — 트랙별 이월 카운터에 남겨 다음 중복 때 합산한다.
// ─────────────────────────────────────────────

/** 편성된 용병/스킬을 CP 내림차순으로. 캡 미달인 것만. */
function cascadeTargets(track) {
  const cap = track === 'skill' ? D.skills.levelCap : D.characters.levelCap;
  const list = track === 'skill'
    ? [...S.skills.active, ...S.skills.passive].filter(Boolean)
    : S.party.filter(Boolean);
  return list
    .filter(x => (x.level || 0) < (cap?.[x.grade] ?? 0))
    .sort((a, b) => (track === 'skill' ? skillCp(b) - skillCp(a) : cpOf(b) - cpOf(a)));
}

/**
 * 중복 하나를 이월 카운터에 넣고, 쌓인 값으로 올릴 수 있는 만큼 레벨을 올린다.
 *
 * level 을 같이 넘기면 그동안 부어 넣은 레벨까지 돌려준다. 레벨 1당 비용이
 * 그 대상 등급의 가치였으므로 Lv L 짜리는 dupeValue * (1 + L) 이다. 안 돌려주면
 * 편성이 바뀔 때마다 투자분이 증발해서 "강화했더니 손해"가 된다.
 * @returns 이관 로그 [{name, from, to}] — UI 에 반드시 보여야 한다
 *          (economy.json > cascade.uiRequirement: 'UR 중복 어디 갔냐' 문의가 터진다)
 */
function cascade(track, grade, level = 0) {
  const val = track === 'skill' ? D.skills.dupeValue : D.characters.dupeValue;
  const cap = track === 'skill' ? D.skills.levelCap : D.characters.levelCap;
  S.carry = S.carry || { mercenary: 0, skill: 0 };
  S.carry[track] = (S.carry[track] || 0) + (val[grade] || 0) * (1 + (level || 0));

  const log = [];
  // 한 번 올리면 CP 순서가 바뀔 수 있어 매번 다시 고른다.
  for (let guard = 0; guard < 200; guard++) {
    // CP 내림차순으로 훑되 **살 수 있는 첫 대상**을 고른다.
    // 맨 앞만 보고 못 사면 멈추면, SSR(30) 때문에 SR(10) 을 올릴 수 있는데도
    // 이월만 쌓인다 — 실제로 그랬다.
    const t = cascadeTargets(track).find(x => S.carry[track] >= (val[x.grade] || 1));
    if (!t) break;                                   // 전부 캡이거나 이월이 모자라다
    const cost = val[t.grade] || 1;
    const room = (cap[t.grade] ?? 0) - (t.level || 0);
    const up = Math.min(room, Math.floor(S.carry[track] / cost));
    if (up < 1) break;
    S.carry[track] -= up * cost;
    const from = t.level || 0;
    t.level = from + up;
    log.push({ name: t.nameKo, from, to: t.level });
  }
  return log;
}

/** 소환 결과 반영 — 임시. 확정은 서버가 한다 (net/backend.js). */
function applyPulls(out) {
  const logs = [];
  const order = ['N', 'R', 'SR', 'SSR', 'UR', 'LR'];
  const rank = x => order.indexOf(x.grade);
  // 도감 등록 — 1회 획득이면 영구. 스킬은 최고 등급을 갱신한다.
  for (const g of out) {
    if (g.kind === 'skill') {
      const cur = S.codex.skill[g.id];
      if (!cur || order.indexOf(g.grade) > order.indexOf(cur)) S.codex.skill[g.id] = g.grade;
    } else if (!S.codex.mercenary.includes(g.id)) {
      S.codex.mercenary.push(g.id);
    }
  }
  for (const g of out) {
    if (g.kind === 'skill') {
      // 빈 칸부터 채우고, 없으면 최약체와 비교
      const arr = g.id.startsWith('SK-A') ? S.skills.active : S.skills.passive;
      const empty = arr.indexOf(null);
      const item = { id: g.id, nameKo: g.name, grade: g.grade, level: 0 };
      if (empty >= 0) arr[empty] = item;
      else {
        let w = 0;
        arr.forEach((s, i) => { if (rank(s) < rank(arr[w])) w = i; });
        if (rank(g) > rank(arr[w])) {
          // 밀려난 쪽이 중복이 된다 — 버리지 않고 가치로 넘긴다
          logs.push(...cascade('skill', arr[w].grade, arr[w].level));
          arr[w] = item;
        } else logs.push(...cascade('skill', g.grade));
      }
    } else {
      S.party.sort((a, b) => rank(a) - rank(b));
      if (rank(g) > rank(S.party[0])) {
        logs.push(...cascade('mercenary', S.party[0].grade, S.party[0].level));
        S.party[0] = { id: g.id, nameKo: g.name, grade: g.grade, class: g.cls, level: 0 };
      } else logs.push(...cascade('mercenary', g.grade));
    }
  }
  // 이관 로그. 안 보이면 "중복 어디 갔냐" 문의가 터진다 (cascade.uiRequirement)
  if (logs.length) {
    const head = logs.slice(0, 2)
      .map(x => `${x.name} Lv${x.from}→${x.to}`).join(" · ");
    toast(`강화 ${head}${logs.length > 2 ? ` 외 ${logs.length - 2}` : ""}`);
  }
  save();
  renderSkills();
  scene.activeSkills = S.skills.active.filter(Boolean);
  scene.setParty(S.party);
  scene.partyDps = partyDps();
  scene.skillAuto = S.skillAuto !== false;
  renderTop();
}

/**
 * 시즌 패스. pass.json 이 단일 소스다.
 *
 * 스테이지 진행도가 곧 패스 진행도다 (5스테이지 = 1티어). 월정액 구독이 아니라
 * 2트랙 배틀패스인 이유 — 구독은 받을 게 자동으로 들어와서 결제한 뒤 잊힌다.
 * 여기서는 무료 칸에 보상이 쌓이는 걸 보면서 옆의 유료 칸이 계속 눈에 들어온다.
 *
 * 유료 칸은 미구매 상태에서도 **그대로 보여 준다.** 가리면 뭘 사는지 모른다.
 */
function passTier() {
  const p = D.pass.progress;
  return Math.min(p.maxTier, Math.floor((S.maxStage || 1) / p.tierEvery));
}

/** 그 티어의 보상. pass.json > rewards.bands 구간을 찾아 돌려준다. */
function passReward(tier, track) {
  const r = D.pass.rewards;
  if (tier === r.milestone.tier) {
    const band = r.bands.find(b => tier >= b.fromTier && tier <= b.toTier);
    return { ...(band ? band[track] : {}), ...r.milestone[track] };
  }
  const band = r.bands.find(b => tier >= b.fromTier && tier <= b.toTier);
  return band ? band[track] : {};
}

/** 지급. 재화가 아닌 것(프레임·칭호)은 아직 붙일 데가 없어 토스트만 띄운다. */
function passGrant(g) {
  const bag = { diamond: 'dia', gold: 'gold', equip_ticket: 'eqTicket',
    speedup_5m: 'hourglass', merc_ticket: 'mercTicket', skill_ticket: 'skillTicket' };
  const got = [];
  for (const [k, v] of Object.entries(g)) {
    if (bag[k] && typeof v === "number") { S[bag[k]] = (S[bag[k]] || 0) + v; got.push(`${CUR_KO[k] || k} +${num(v)}`); }
  }
  return got;
}

function passClaim(tier, track) {
  S.pass = S.pass || { bought: false, free: [], paid: [] };
  if (track === 'paid' && !S.pass.bought) return toast('프리미엄을 구매하면 열립니다');
  if (tier > passTier()) return toast(`스테이지 ${tier * D.pass.progress.tierEvery} 도달 필요`);
  if (S.pass[track].includes(tier)) return;
  const got = passGrant(passReward(tier, track));
  S.pass[track].push(tier);
  save(); renderTop(); openPass();
  toast(got.join(' · ') || `${tier}티어 수령`);
}

function passClaimAll() {
  S.pass = S.pass || { bought: false, free: [], paid: [] };
  const max = passTier();
  const got = [];
  for (const track of ['free', 'paid']) {
    if (track === 'paid' && !S.pass.bought) continue;
    for (let t = 1; t <= max; t++) {
      if (S.pass[track].includes(t)) continue;
      got.push(...passGrant(passReward(t, track)));
      S.pass[track].push(t);
    }
  }
  if (!got.length) return toast('받을 것이 없습니다');
  save(); renderTop(); openPass();
  toast(`${got.length}건 수령`);
}

/** 받을 게 남았나. 사이드 패스 아이콘의 빨간 점에 쓴다. */
function passWaiting() {
  const st = S.pass || { bought: false, free: [], paid: [] };
  const max = passTier();
  for (let t = 1; t <= max; t++) {
    if (!st.free.includes(t)) return true;
    if (st.bought && !st.paid.includes(t)) return true;
  }
  return false;
}

function openPass() {
  const P = D.pass;
  S.pass = S.pass || { bought: false, free: [], paid: [] };
  const cur = passTier(), per = P.progress.tierEvery;
  const nextAt = Math.min(P.progress.maxTier, cur + 1) * per;

  const chip = g => Object.entries(g).map(([k, v]) =>
    typeof v === 'number'
      ? `<span class="ps-c"><img src="../assets/ui/${CUR_ICON2[k] || 'CU-01'}.png" alt="">${num(v)}</span>`
      : `<span class="ps-c ps-deco">${CUR_KO[k] || k}</span>`).join('');

  const row = t => {
    const open = t <= cur;
    const f = S.pass.free.includes(t), p2 = S.pass.paid.includes(t);
    const cell = (track, done) => {
      const locked = track === 'paid' && !S.pass.bought;
      const cls = done ? ' done' : (!open || locked) ? ' off' : '';
      return `<button class="ps-cell${cls}" data-t="${t}" data-tr="${track}">
        ${chip(passReward(t, track))}
        ${done ? '<i class="ps-mark">받음</i>'
          : locked ? '<i class="ps-mark">🔒</i>'
          : !open ? '' : '<i class="ps-mark ps-go">받기</i>'}</button>`;
    };
    return `<div class="ps-row${t === cur ? ' now' : ''}" data-tier="${t}">
      <span class="ps-tier"><b>${t}</b><span>St${t * per}</span></span>
      ${cell('free', f)}${cell('paid', p2)}</div>`;
  };

  $('#ovt').textContent = `시즌 패스 · ${P.season.nameKo}`;
  $('#ovb').innerHTML =
    `<div class="ps-top">
      <div class="ps-tinfo"><b>${cur}</b><span>/ ${P.progress.maxTier} 티어</span></div>
      <div class="ps-tnext">${cur >= P.progress.maxTier
        ? '최고 티어' : `다음 티어까지 스테이지 ${Math.max(0, nextAt - (S.maxStage || 1))}`}</div>
    </div>`
    + `<div class="ps-buy">${S.pass.bought
      ? '<span class="ps-own">프리미엄 보유 중</span>'
      : `<button class="fgbtn" id="psBuy">프리미엄 ${numExact(P.tracks.paid.price.krw)}원</button>`}
      <button class="mdBuy" id="psAll">전부 받기</button></div>`
    + `<div class="ps-head"><span></span><span>무료</span><span>프리미엄</span></div>`
    + Array.from({ length: P.progress.maxTier }, (_, i) => row(i + 1)).join('');

  $('#ovinfo').innerHTML = '<div class="lbl" style="margin-bottom:6px">규칙</div>'
    + `<div class="sub" style="line-height:1.6">
        ${P.progress.metricNote}<br><br>
        ${P.tracks.paid.retroactiveNote}<br><br>
        <b>시즌 ${P.season.durationDays}일.</b> ${P.season.resetPolicy}</div>`;

  $('#psBuy')?.addEventListener('click', () => {
    toast('결제 연동 전 — VXShop 등록 후 붙는다');
  });
  $('#psAll')?.addEventListener('click', passClaimAll);
  $('#ovb').querySelectorAll('.ps-cell').forEach(x => x.addEventListener('click',
    () => passClaim(+x.dataset.t, x.dataset.tr)));
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
  // 현재 티어를 가운데로
  const now = $('#ovb').querySelector('.ps-row.now');
  if (now) now.scrollIntoView({ block: 'center' });
}

/** 보상 칩 아이콘. 재화 id → 에셋 번호 */
const CUR_ICON2 = {
  diamond: 'CU-01', gold: 'CU-04', merc_ticket: 'CU-05', skill_ticket: 'CU-06',
  equip_ticket: 'CU-07', speedup_5m: 'CU-10', arena_medal: 'CU-11',
};

/**
 * 훈련소 — goldsinks.json > sinks[training_camp]
 *   골드로 전 용병 기본 스탯을 영구 강화. 파티 편성·등급과 무관.
 *   Lv200 상한 + 최대 +40%. 무한 레벨이면 CP 천장이 사라져 곡선 기준이 무너진다.
 */
function openTraining() {
  const def = trainDef();
  const lv = S.trainLv;
  const cost = trainingCost(def, lv);
  const bonus = trainingBonus(def, lv);
  const next = trainingBonus(def, lv + 1);
  const maxed = lv >= def.maxLevel;

  $('#ovt').textContent = '용병단 훈련소';
  $('#ovb').innerHTML = `
    <div class="tc-hero">
      <div class="tc-lv">Lv ${lv}<span class="tc-max"> / ${def.maxLevel}</span></div>
      <div class="tc-bonus">전 용병 스탯 +${(bonus * 100).toFixed(1)}%</div>
      <div class="tc-bar"><i style="width:${lv / def.maxLevel * 100}%"></i></div>
      <div class="sub" style="font-size:10px">최대 +${(def.maxBonus * 100).toFixed(0)}%</div>
    </div>
    <div class="frow"><span class="k">다음 레벨</span>
      <span class="v">+${(next * 100).toFixed(1)}%
        <span style="color:var(--up);font-size:11px">(+${(def.bonusPerLevel * 100).toFixed(1)}%p)</span></span></div>
    <div class="frow"><span class="k">비용</span>
      <span class="v" style="color:${S.gold >= cost ? 'var(--txt)' : 'var(--warn)'}">
        <img src="../assets/ui/CU-04.png" alt="">${num(cost)}</span></div>
    <button class="fgbtn" id="tcUp" ${maxed || S.gold < cost ? 'disabled' : ''}>
      ${maxed ? '최대 레벨' : '강화'}</button>
    <button class="fgbtn" id="tcUp10" style="margin-top:7px" ${maxed ? 'disabled' : ''}>
      가능한 만큼 강화</button>`;
  $('#ovinfo').innerHTML = '<div class="lbl" style="margin-bottom:6px">설계 메모</div>'
    + `<div class="frow" style="padding:7px 10px"><span class="k">비용 공식</span>
        <span class="v" style="font-size:11px">${def.costFormula}</span></div>`
    + `<div class="frow" style="padding:7px 10px"><span class="k">누적 비용</span>
        <span class="v" style="font-size:11px">${num(def.cumulativeCost)}</span></div>`
    + `<div class="sub" style="line-height:1.55;margin-top:6px">${def.designNote}</div>`
    + `<div class="sub" style="line-height:1.55;margin-top:6px">
        ${def.description} 골드의 무한 배출을 흡수하는 주 소모처 중 하나다.</div>`;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

  const buy = many => {
    let n = 0, before = totalCp();
    do {
      const c = trainingCost(def, S.trainLv);
      if (S.gold < c || S.trainLv >= def.maxLevel) break;
      S.gold -= c; S.trainLv++; n++;
    } while (many);
    if (!n) return toast('골드 부족');
    save(); openTraining(); renderTop();
    scene.partyDps = partyDps();
    toast(`훈련소 Lv${S.trainLv} · 전투력 +${cpNum(totalCp() - before)}`);
  };
  $('#tcUp').onclick = () => buy(false);
  $('#tcUp10').onclick = () => buy(true);
}

/** 던전 6종 — 네비 탭에서 카드로 연다. dungeons.json > formulas 로 계산. */
/** 던전 열쇠 일일 리필. 누적이 아니라 3개로 채운다 (dungeons.json > entry.grantMode) */
function dgKeyRefill() {
  const day = dayIdx(Date.now());
  if (S.dgKeyDay === day) return;
  S.dgKeyDay = day;
  const n = D.dungeons.entry.dailyKeyGrant;
  for (const dg of D.dungeons.dungeons) S.dgKeys[dg.id] = n;
}
const dgKeysOf = id => (S.dgKeys[id] ?? 0);

function openDungeons() {
  const list = D.dungeons.dungeons;
  dgKeyRefill();
  const entries = D.dungeons.entry.dailyKeyGrant;
  const cp = totalCp();
  const html = list.map(dg => {
    const st = S.dg[dg.id] || (S.dg[dg.id] = { floor: 1 });
    const unlocked = cp >= dg.unlockCp;
    const need = dg.unlockCp * Math.pow(1.18, st.floor - 1);
    const yieldNow = dg.baseYield * Math.pow(1.15, st.floor - 1);
    return `<div class="dg${unlocked ? '' : ' lock'}" data-id="${dg.id}">
      <img src="../assets/ui/${dg.keyId}.png" alt="" onerror="this.src='../assets/ui/${DG_ICON[dg.reward] || 'CU-04'}.png'">
      <b>${dg.nameKo}</b>
      <span class="ent">${unlocked ? `${st.floor}층 · 열쇠 ${dgKeysOf(dg.id)}/${entries}` : `<img class="lockIc" src="../assets/ui/UI-LOCK.png" alt="잠김"> CP ${num(dg.unlockCp)}`}</span>
      <span class="why">${unlocked ? `요구 ${num(need)} · 수령 ${num(yieldNow)}` : dg.purpose}</span>
    </div>`;
  }).join('');

  $('#ovt').textContent = '던전';
  // 탑을 목록 맨 위에 둔다. 던전은 일일 배출, 탑은 상한 없는 도전 —
  // 나란히 놓아야 둘의 역할 차이가 보인다.
  const T = S.tower || (S.tower = { floor: 1, best: 0 });
  $('#ovb').innerHTML = `<div id="twCard">
      <span class="tw-ico"><img src="../assets/ui/IC-TOWER.png" alt=""
        onerror="this.replaceWith(document.createTextNode('🗼'))"></span>
      <span><b>무한의 탑</b><span>최고 ${T.best}층 · 입장 제한 없음</span></span>
      <i>${T.floor}층 도전 ›</i>
    </div>` + `<div id="dungeons">${html}</div>`;
  $('#ovinfo').innerHTML = '<div class="lbl" style="margin-bottom:6px">규칙</div>'
    + `<div class="frow" style="padding:7px 10px"><span class="k">일일 지급</span>
        <span class="v" style="font-size:12px">열쇠 ${entries}개 (광고 +${D.dungeons.entry.adBonus.entries})</span></div>`
    + `<div class="frow" style="padding:7px 10px"><span class="k">수령</span>
        <span class="v" style="font-size:12px">${D.dungeons.formulas.dailyYield}</span></div>`
    + `<div class="frow" style="padding:7px 10px"><span class="k">요구 CP</span>
        <span class="v" style="font-size:12px">${D.dungeons.formulas.requiredCp}</span></div>`
    + `<div class="sub" style="line-height:1.5;margin-top:6px">${D.dungeons.formulas.balanceNote}</div>`
    + `<div class="sub" style="line-height:1.5;margin-top:6px">${D.dungeons.entry.failureCost}</div>`;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

  $('#twCard').addEventListener('click', () => {
    $('#ov').classList.remove('show');
    tower.open();
  });
  $('#ovb').querySelectorAll('.dg:not(.lock)').forEach(el =>
    el.addEventListener('click', () => runDungeon(list.find(d => d.id === el.dataset.id))));
}

/**
 * 용병 / 스킬 편성 화면.
 *
 * 캐스케이드로 레벨이 오르는데 보이는 데가 없어서 만들었다. 여기서 세 가지를 본다.
 *   · 지금 누가 편성돼 있고 몇 레벨인가
 *   · 이월이 얼마나 쌓였고 다음 레벨까지 얼마 남았나
 *   · 각자 전투력에 얼마나 기여하나
 * 편성 변경은 여기서 안 한다 — 자동 편성이 원칙이다 (characters.json > autoEquip).
 */
function openRoster(track = 'mercenary') {
  const isSkill = track === 'skill';
  const val = isSkill ? D.skills.dupeValue : D.characters.dupeValue;
  const cap = isSkill ? D.skills.levelCap : D.characters.levelCap;
  const list = isSkill
    ? [...S.skills.active, ...S.skills.passive].filter(Boolean)
    : S.party.filter(Boolean);
  const cpFn = isSkill ? skillCp : cpOf;
  const total = list.reduce((a, x) => a + cpFn(x), 0) || 1;
  const carry = (S.carry && S.carry[track]) || 0;

  // 다음 한 레벨을 어디에 쓸지 = 캐스케이드가 고를 대상
  const next = list
    .filter(x => (x.level || 0) < (cap[x.grade] ?? 0))
    .sort((a, b) => cpFn(b) - cpFn(a))
    .find(x => true);
  const need = next ? (val[next.grade] || 1) : 0;

  $('#ovt').textContent = isSkill ? '스킬' : '용병';
  $('#ovb').innerHTML =
    `<div class="frow"><span class="k">이월</span>
      <span class="v">${num(carry)}${need
        ? ` <span class="k">/ ${num(need)} → ${next.nameKo} Lv${(next.level || 0) + 1}</span>`
        : ' <span class="k">전부 최대 레벨</span>'}</span></div>`
    + (need ? `<div class="rs-bar"><i style="width:${
        Math.min(100, carry / need * 100).toFixed(1)}%"></i></div>` : '')
    + '<div class="lbl" style="margin:12px 0 6px">편성</div>'
    + list.map(x => {
      const lv = x.level || 0, mx = cap[x.grade] ?? 0;
      const img = isSkill ? `../assets/skill/${x.id}.png` : `../assets/char/${x.id}.png`;
      return `<div class="rs-row g-${x.grade}">
        <span class="rs-ico"><img src="${img}" alt=""></span>
        <span class="rs-mid">
          <b>${x.nameKo}</b>
          <span class="k">${x.grade} · Lv ${lv}<i>/${mx}</i>${
            lv >= mx ? ' <em>MAX</em>' : ''}</span>
        </span>
        <span class="rs-cp">${(cpFn(x) / total * 100).toFixed(0)}%</span>
      </div>`; }).join('')
    || '<div class="sh-note">아직 편성된 것이 없습니다.</div>';

  $('#ovinfo').innerHTML = '<div class="lbl" style="margin-bottom:6px">이월이 뭔가</div>'
    + `<div class="sub" style="line-height:1.6">
       같은 걸 또 뽑거나 편성에서 밀려나면 <b>가치</b>로 바뀌어 여기 쌓인다.
       등급별 가치는 ${Object.entries(val).map(([g, v]) => `${g} ${v}`).join(" · ")} 이고,
       레벨 1을 올리는 값은 <b>올릴 대상의 등급 가치</b>다 — N 을 ${val.UR}장 모으면
       UR 이 1레벨 오른다.<br><br>
       캐스케이드는 전투력이 가장 높은 대상부터 올린다. 편성에서 빠질 때는
       부어 넣은 레벨까지 그대로 돌려받으므로 <b>강화가 손해가 되지 않는다.</b></div>`;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
}

const tierOf = score => {
  const t = [...D.arena.tiers].reverse().find(x => score >= x.minScore);
  return t ? t.nameKo : D.arena.tiers[0].nameKo;
};

/** 아레나. arena.json > battle.winProbability 로 예상 승률을 보여준다. */
function openArena(view) {
  if (view === 'shop') return openMedalShop();

  const a = D.arena;
  const my = totalCp();
  const exp = a.battle.winProbability.exponent;
  // 상대는 내 CP 근처로 매칭된다 (실제 매칭은 globalCollection 스냅샷)
  const foes = [0.72, 0.88, 1.0, 1.14, 1.35].map((k, i) => ({
    name: `단장 ${1000 + i * 137}`, cp: Math.round(my * k),
  }));
  const winP = cp => 1 / (1 + Math.pow(cp / my, exp));

  const rows = foes.map(f => {
    const p = winP(f.cp);
    const col = p > 0.6 ? 'var(--up)' : p > 0.35 ? 'var(--gold)' : 'var(--warn)';
    return `<div class="frow" style="padding:9px 11px">
      <span><b style="font-size:12px">${f.name}</b>
        <span class="k" style="display:block">CP ${num(f.cp)}</span></span>
      <span class="v" style="color:${col}">${(p * 100).toFixed(0)}%</span></div>`;
  }).join('');

  $('#ovt').textContent = '아레나';
  $('#ovb').innerHTML =
    `<div class="frow"><span class="k">내 전투력</span><span class="v">${cpNum(my)}</span></div>`
    + `<div class="frow"><span class="k">점수 · 티어</span>
        <span class="v" style="font-size:12px">${S.arenaScore} · ${tierOf(S.arenaScore)}</span></div>`
    + `<div class="frow"><span class="k">투기장 훈장</span>
        <span class="v">${num(S.medal)}
          <button id="aShop" title="훈장 상점">
            <img src="../assets/ui/IC-SHOP.png" alt="" onerror="this.replaceWith(document.createTextNode('\uD83D\uDED2'))"></button>
        </span></div>`
    + `<div class="frow"><span class="k">오늘 입장</span>
        <span class="v" style="font-size:12px">${a.entries.baseDaily}회 (광고 +${a.entries.adBonus.entries})</span></div>`
    + '<div class="lbl" style="margin:12px 0 6px">상대 5명</div>' + rows;
  $('#ovinfo').innerHTML = '<div class="lbl" style="margin-bottom:6px">판정 규칙</div>'
    + `<div class="frow" style="padding:7px 10px"><span class="k">승률</span>
        <span class="v" style="font-size:11px">${a.battle.winProbability.formula}</span></div>`
    + `<div class="frow" style="padding:7px 10px"><span class="k">형식</span>
        <span class="v" style="font-size:11px">${a.battle.format} · ${a.battle.type}</span></div>`
    + `<div class="sub" style="line-height:1.5;margin-top:6px">${a.battle.defenseBonusNote}</div>`
    + `<div class="sub" style="line-height:1.5;margin-top:6px">
        스탯 통일로 직군 비대칭이 사라져, 이제 CP 확률 판정 대신 실제 틱 시뮬로 전환할 수 있다
        (combat.json > arenaRules). 그때부터 DEF/HP 가 실제로 물린다.</div>`;
  $('#aShop').addEventListener('click', () => openArena('shop'));
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
}

/**
 * 훈장 상점. arena.json > medalShop 이 단일 소스다.
 * 상점 탭이 아니라 아레나 화면 안에 둔다 — 훈장은 아레나에서만 벌고
 * 아레나에서만 쓰는 닫힌 재화라, 버는 곳과 쓰는 곳이 붙어 있어야 한다.
 */
function openMedalShop() {
  const sh = D.arena.medalShop;
  $('#ovt').textContent = '훈장 상점';
  $('#ovb').innerHTML =
    `<div class="frow"><span class="k">보유 훈장</span>
      <span class="v">${num(S.medal)}</span></div>`
    + '<div class="lbl" style="margin:12px 0 6px">교환</div>'
    + sh.items.map(x => {
      const lim = x.seasonLimit ? `시즌 ${x.seasonLimit}회` : `일일 ${x.dailyLimit}회`;
      const can = S.medal >= x.cost;
      return `<div class="frow" style="padding:9px 11px">
        <span><b style="font-size:12px">${x.nameKo}</b>
          <span class="k" style="display:block">${lim}</span></span>
        <button class="mdBuy${can ? '' : ' off'}" data-m="${x.id}">${num(x.cost)}</button>
      </div>`; }).join('')
    + '<button id="mdBack" class="mdBack">‹ 아레나로</button>';
  $('#ovinfo').innerHTML = '<div class="lbl" style="margin-bottom:6px">훈장 수급</div>'
    + `<div class="frow" style="padding:7px 10px"><span class="k">일일 티어 보상</span>
        <span class="v" style="font-size:11px">${D.arena.tiers.map(t =>
          `${t.nameKo} ${t.dailyMedals}`).join(' · ')}</span></div>`
    + `<div class="sub" style="line-height:1.5;margin-top:6px">${sh.itemsNote}</div>`;
  $('#mdBack').addEventListener('click', () => openArena());
  $('#ovb').querySelectorAll('.mdBuy').forEach(btn => btn.addEventListener('click', () => {
    const x = sh.items.find(i => i.id === btn.dataset.m);
    if (S.medal < x.cost) return toast(`훈장 ${num(x.cost - S.medal)} 부족`);
    if (!grantMedalItem(x.id)) return;
    S.medal -= x.cost;
    save(); renderTop(); openMedalShop(); toast(`${x.nameKo} 교환`);
  }));
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
}

/** 훈장 교환 지급. 지급한 경우에만 true — 트랙 미연동 품목은 훈장을 깎지 않는다. */
function grantMedalItem(id) {
  const bag = { merc_ticket_10: ['mercTicket', 10], skill_ticket_10: ['skillTicket', 10],
    equip_ticket_20: ['eqTicket', 20], hourglass_5: ['hourglass', 5] }[id];
  if (bag) { S[bag[0]] += bag[1]; return true; }
  toast('LR 선택권은 시즌 보상 연동 후에 열린다'); return false;
}

/**
 * 연합. alliance.json 이 단일 소스다.
 *
 * 설계 원칙 하나만 기억하면 된다 — **연합은 재화를 만드는 곳이 아니라 쓰는 곳이다.**
 * 다이아·용병/스킬 소환권을 일절 배출하지 않는다. 하나라도 넣으면 총 뽑기 예산
 * (README 불변식 5, 무과금 D180 약 4,050뽑)을 다시 계산해야 하고, 그러면 연합이
 * "가입 안 하면 손해"가 되어 사실상 강제가 된다.
 *
 * 실제 가입·보스 딜 집계는 서버가 한다 (alliance.json > verse8). 지금은 설계 노출까지.
 */
function openAlliance(tab = 'home') {
  const A = D.alliance;
  const coin = `<img src="../assets/ui/CU-12.png" alt="" onerror="this.replaceWith(document.createTextNode('\u25C6'))">`;

  const tabs = [['home', '연합'], ['boss', '보스'], ['shop', '상점'], ['member', '단원']];
  const head = `<div class="al-tabs">${tabs.map(([k, n]) =>
    `<button class="al-t${k === tab ? ' on' : ''}" data-al="${k}">${n}</button>`).join('')}</div>`;

  const home = () => {
    const d = A.contribution.donate;
    return '<div class="lbl" style="margin:2px 0 6px">기부</div>'
      + `<div class="frow"><span class="k">골드 ${num(d.gold.unit)}</span>
          <span class="v">${coin}${d.gold.coin} <span class="k">일일 ${d.gold.dailyLimit}회</span></span></div>`
      + `<div class="frow"><span class="k">장비 소환권 ${d.equip_ticket.unit}</span>
          <span class="v">${coin}${d.equip_ticket.coin} <span class="k">일일 ${d.equip_ticket.dailyLimit}회</span></span></div>`
      + `<div class="sh-note">${A.contribution.donateNote}</div>`
      + '<div class="lbl" style="margin:12px 0 6px">가입 조건</div>'
      + `<div class="frow"><span class="k">최소 스테이지</span>
          <span class="v">${A.membership.joinRequirement.minStage}</span></div>`
      + `<div class="frow"><span class="k">정원</span>
          <span class="v">${A.membership.maxMembers}명</span></div>`
      + `<div class="frow"><span class="k">창설 비용</span>
          <span class="v">${num(A.membership.createCost.gold)} 골드</span></div>`
      + `<div class="sh-note">${A.meta.roleSeparation}</div>`;
  };

  const boss = () => {
    const B = A.boss;
    return `<div class="frow"><span class="k">주기</span>
        <span class="v">주 ${B.attemptsPerWeek}회 · ${B.resetAt} 초기화</span></div>`
      + `<div class="frow"><span class="k">체력</span>
          <span class="v" style="font-size:11px">연합 CP 합 × 0.55 × 단계</span></div>`
      + `<div class="frow"><span class="k">단계 배수</span>
          <span class="v" style="font-size:11px">${B.hp.tierMultiplier.join(' → ')}</span></div>`
      + '<div class="lbl" style="margin:12px 0 6px">보상</div>'
      + `<div class="frow"><span class="k">참가</span>
          <span class="v">${coin}${B.rewards.participation.alliance_coin}
            · ${num(B.rewards.participation.gold)} 골드</span></div>`
      + `<div class="frow"><span class="k">처치 (연합 전체)</span>
          <span class="v">${coin}${B.rewards.clearBonus.alliance_coin}
            · ${num(B.rewards.clearBonus.gold)} 골드</span></div>`
      + B.rewards.rankBonus.map(r => `<div class="frow"><span class="k">딜 ${r.top}위 이내</span>
          <span class="v">${coin}${r.alliance_coin}</span></div>`).join('')
      + `<div class="sh-note">${B.rewards.participationNote}</div>`;
  };

  const shop = () => {
    const S2 = A.shop;
    return S2.items.map(x => {
      const g = Object.entries(x.grant)
        .map(([k, v]) => `${CUR_KO[k] || k} ${typeof v === 'number' ? num(v) : ''}`).join(' · ');
      const lim = x.weeklyLimit ? `주 ${x.weeklyLimit}회` : `시즌 ${x.seasonLimit}회`;
      return `<div class="frow" style="padding:9px 11px">
        <span><b style="font-size:12px">${x.nameKo}</b>
          <span class="k" style="display:block">${g} · ${lim}</span></span>
        <span class="v">${coin}${x.cost}</span></div>`;
    }).join('')
      + `<div class="sh-note">${S2.excludedReason}</div>`;
  };

  const member = () =>
    `<div class="frow" style="padding:12px"><span class="k" style="line-height:1.6">
      단원 목록은 <b>서버에 연결된 뒤</b>에 뜬다.<br>
      연합 상태는 개인 세이브가 아니라 컬렉션이라 클라가 흉내 낼 수 없다.</span></div>`
    + `<div class="sh-note">${A.ui.showContribution}</div>`
    + `<div class="sh-note">${A.verse8.concurrency}</div>`;

  $('#ovt').textContent = '연합';
  $('#ovb').innerHTML = head + ({ home, boss, shop, member }[tab] || home)();
  $('#ovinfo').innerHTML = '<div class="lbl" style="margin-bottom:6px">왜 이렇게 짰나</div>'
    + `<div class="sub" style="line-height:1.6">${A.meta.designNote}</div>`
    + `<div class="sub" style="line-height:1.6;margin-top:8px">
        골드 순유입 ${A.budgetImpact.goldFlow.net}</div>`;
  $('#ovb').querySelectorAll('[data-al]').forEach(x =>
    x.addEventListener('click', () => openAlliance(x.dataset.al)));
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
}

/** 보상 표시용 재화 이름. 데이터의 id 를 그대로 띄우면 유저가 못 읽는다. */
const CUR_KO = {
  gold: '골드', diamond: '다이아', equip_ticket: '장비 소환권',
  merc_ticket: '용병 소환권', skill_ticket: '스킬 소환권',
  speedup_5m: '모래시계', alliance_coin: '연합 코인', arena_medal: '훈장',
  profile_frame: '프로필 프레임',
};

// 던전 보상 → 재화 아이콘
const DG_ICON = {
  gold: 'CU-04', equip_ticket: 'CU-07', speedup_5m: 'CU-10',
  diamond: 'CU-01', ticket_mixed: 'CU-05', merc_ticket: 'CU-05', skill_ticket: 'CU-06',
  equip_ticket: 'CU-07', speedup_5m: 'CU-10',
};

function runDungeon(dg) {
  const st = S.dg[dg.id];
  const entries = D.dungeons.entry.dailyKeyGrant;
  if (dgKeysOf(dg.id) < 1) return toast(`${dg.nameKo} 열쇠 부족 · 매일 ${entries}개 지급`);
  S.dgKeys[dg.id]--;
  const need = dg.unlockCp * Math.pow(1.18, st.floor - 1);
  const gain = dg.baseYield * Math.pow(1.15, st.floor - 1);
  if (totalCp() < need) {
    // 실패해도 횟수는 소모된다 (dungeons.json > entry.failureCost)
    openDungeons();
    return toast(`${dg.nameKo} ${st.floor}층 실패 — CP ${num(need)} 필요`);
  }
  st.floor++;
  const bag = { gold: 'gold', equip_ticket: 'eqTicket', diamond: 'dia', speedup_5m: 'hourglass' }[dg.reward];
  if (bag) S[bag] += Math.round(gain);
  openDungeons(); renderTop();
  toast(`${dg.nameKo} ${st.floor - 1}층 돌파 — ${num(Math.round(gain))}`);
}

/**
 * 메인 화면 퀘스트 바. 상시 노출되고 누르면 이동하거나 수령한다.
 * quests.json > ui.showNextRewardNote — 다음 보상이 보이면 뭘 할지 자동으로 안다.
 */
function renderQuest() {
  const def = questAt(D, S.quest);
  const cur = qProgress(def);
  const done = cur >= def.target;
  const t = QUEST_TYPE[def.type];
  $('#qname').textContent = `Q${def.q} ${t.label}`;
  $('#qprog').textContent = done ? '수령' : `${num(cur)}/${num(def.target)}`;
  $('#qfill').style.width = Math.min(100, cur / def.target * 100) + '%';
  $('#quest').classList.toggle('done', done);
}

let lastCp = 0;
function renderTop() {
  const cp = totalCp();
  // 전투력이 오르면 즉시 띄운다 — ui.json > criticalUiRules[0]
  if (lastCp && cp > lastCp + 0.5) {
    const d = document.createElement('span');
    d.className = 'cpup';
    d.textContent = '+' + num(cp - lastCp) + ' \u25B2';
    $('#cpwrap').appendChild(d);
    setTimeout(() => d.remove(), 1300);
    $('#cp').classList.remove('bump'); void $('#cp').offsetWidth;
    $('#cp').classList.add('bump');
  }
  lastCp = cp;
  $('#cp').textContent = cpNum(cp);
  $('#c_dia').textContent = num(S.dia);
  $('#c_gold').textContent = num(S.gold);
  $('#topNick').textContent = S.nickname || '단장';
  // 소환 레벨 보상이 밀려 있으면 하단 네비 상점에 빨간 점
  $('.nv[data-tab="shop"]')?.classList.toggle('hasnew', summonRewardWaiting());
  $('.side [data-s="pass"]')?.classList.toggle('hasnew', passWaiting());
  $('#dpsInfo').textContent = `초당 피해 ${num(partyDps())}`;
  floatCurrency();
  renderForgeDock();
  const cap = D.stages.enemyDerivation.encountersPerStage;
  if ($('#enc').children.length !== cap + 1) {
    $('#enc').innerHTML = Array.from({ length: cap + 1 },
      (_, i) => `<i class="dotw ${i === cap ? 'boss' : ''}"></i>`).join('');
  }
}

const markEncounter = i =>
  document.querySelectorAll('#enc .dotw').forEach((e, k) => e.classList.toggle('on', k <= i));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 1400);
}

function showResult(text, color) {
  const r = $('#result');
  r.textContent = text; r.style.color = color;
  r.classList.add('show');
  setTimeout(() => r.classList.remove('show'), 1500);
}

// --- 제작대 패널 ---
function forgeStageAsset() {
  // economy.json > equipmentSummonLevel.forgeVisualStages
  const st = forgeCurve().forgeVisualStages || [];
  for (const v of st) {
    const [lo, hi] = v.levelRange.split('-').map(Number);
    if (S.forgeLv >= lo && S.forgeLv <= hi) return v;
  }
  return st[0];
}

function openForge() {
  const next = S.forgeLv + 1;
  const c = forgeCost(next);
  const running = !!S.forgeStart;
  const vis = forgeStageAsset();
  const stageNo = vis ? vis.stage : 1;
  const pct = running ? (1 - forgeRemain() / forgeCost(S.forgeTarget).sec) * 100
    : (S.forgePaid || 0) / (c ? c.parts : 1) * 100;

  const cur = n => `<img src="../assets/ui/${n}.png" alt="">`;
  const h = [];

  // 제작대 이미지를 누르면 장비를 소환한다
  h.push(`<div id="fgHero">
      <img src="../assets/ui/FG-0${stageNo}.png" alt="" id="fgSummon" title="탭하여 장비 소환">
      <div id="fgLvBadge">Lv ${S.forgeLv}</div>
      <span id="fgHeroSpark"></span>
      <div id="fgStage">${stageNo}단계 대장간 · ${vis ? vis.levelRange : ''} 구간</div>
    </div>`);


  if (running) {
    h.push(`<div id="fgProg"><div id="fgProgFill" style="width:${pct}%"></div></div>`);
    const can = Math.min(S.hourglass || 0, Math.ceil(forgeRemain() / 300));
    const use = Math.max(1, Math.min(S.hgUse || 1, can));
    // 남은 시간 옆에서 바로 단축을 연다. 항상 펼쳐 두면 대기 중에도 자리를 먹는다.
    h.push(`<div class="frow"><span class="k">Lv ${S.forgeTarget} 제작 중</span>
      <span class="v" id="fgLeft">${dur(forgeRemain())}</span>
      <button class="hg-open ${S.hgOpen ? 'on' : ''}" id="fgHgOpen"
        ${can < 1 ? 'disabled' : ''}>${cur('CU-10')} 사용</button></div>`);

    if (S.hgOpen && can >= 1) {
      // 프리셋 버튼은 칸을 많이 먹고 원하는 수를 못 고른다. 스테퍼가 낫다.
      h.push(`<div class="hg-row">
        <button class="hg-step" data-hgd="-10">‹‹</button>
        <button class="hg-step" data-hgd="-1">‹</button>
        <span class="hg-val">${use}<i>/ ${can}</i></span>
        <button class="hg-step" data-hgd="1">›</button>
        <button class="hg-step" data-hgd="10">››</button>
        <button class="hg-max ${use === can ? 'on' : ''}" data-hgm="1">MAX</button>
      </div>`);
      h.push(`<button class="fgbtn" id="fgHgUse">
        ${cur('CU-10')} ${use}개 · ${dur(use * 300)} 단축</button>`);
    }
    if (can < 1) h.push(`<div class="sh-note" style="margin-top:6px">
      모래시계가 없습니다. 상점에서 다이아로 구매할 수 있습니다.</div>`);
  } else if (c) {
    const paid = S.forgePaid || 0;
    // 몇 번 중 몇 번인지는 숫자보다 칸이 빨리 읽힌다
    const cells = Array.from({ length: c.parts },
      (_, i) => `<i class="${i < paid ? 'on' : ''}"></i>`).join('');
    h.push(`<div class="frow"><span class="k">Lv ${next} 제작</span>
      <span class="v"><span class="fg-cells">${cells}</span>
      <b style="margin-left:7px">${paid}/${c.parts}</b></span></div>`);
    h.push(`<div class="frow"><span class="k">제작 시간</span>
      <span class="v">${dur(c.sec)} <span style="color:var(--dim)">(마지막 투입 후)</span></span></div>`);
    h.push(`<button class="fgbtn" id="fgPayBtn" ${S.gold < c.per ? 'disabled' : ''}>
      ${cur('CU-04')} ${num(c.per)}</button>`);
  } else {
    h.push(`<div class="frow"><span class="k">최대 레벨 도달</span><span class="v">Lv ${S.forgeLv}</span></div>`);
  }

  // 다음 해금 한 줄만 본문에. 전체 목록은 ⓘ 버튼으로 연다 —
  // 카드가 화면을 다 덮지 않아야 해서 목록을 본문에 두면 안 된다.
  const nextUnlock = D.equipment.summon.progression.find(p => p.summonLv > S.forgeLv);
  if (nextUnlock) {
    h.push(`<div class="frow" style="padding:7px 12px">
      <span class="k">다음 해금 Lv ${nextUnlock.summonLv}</span>
      <span class="v" style="font-size:12px">${nextUnlock.nameKo || nextUnlock.unlock}</span></div>`);
  }

  const reopen = () => { const y = $('#ovb').scrollTop; openForge(); $('#ovb').scrollTop = y; };

  $('#ovt').textContent = '제작대';
  // 모래시계는 이 화면에서만 쓰는 재화다. 헤더에 두면 본문이 안 밀린다.
  $('#ovh').classList.add('has-cur');
  $('#ovcur').innerHTML = `${cur('CU-10')}<b>${num(S.hourglass || 0)}</b>`;
  $('#ovb').innerHTML = h.join('');
  $('#ovinfo').innerHTML = '<div class="lbl" style="margin-bottom:6px">해금 현황</div>'
    + D.equipment.summon.progression.map(p => {
      const on = p.summonLv <= S.forgeLv;
      return `<div class="frow" style="opacity:${on ? 1 : .42};padding:6px 10px;margin-bottom:5px">
        <span class="k">Lv ${p.summonLv}</span>
        <span class="v" style="font-size:11px">${p.nameKo || p.unlock}${p.pullsPerBatch ? ` · 배치 ${p.pullsPerBatch}` : ''}</span>
        <span>${on ? '✅' : `<img class="lockIc" src="../assets/ui/UI-LOCK.png" alt="잠김">`}</span></div>`;
    }).join('');
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

  $('#fgSummon')?.addEventListener('click', () => pullOne('#fgHero'));
  $('#fgPayBtn')?.addEventListener('click', payForge);
  $('#fgHgOpen')?.addEventListener('click', () => { S.hgOpen = !S.hgOpen; openForge(); });
  // 스테퍼 — 남은 시간과 보유량 안에서만 움직인다
  const hgCan = () => Math.min(S.hourglass || 0, Math.ceil(forgeRemain() / 300));
  $('#ovb').querySelectorAll('[data-hgd]').forEach(x => x.addEventListener('click', () => {
    const can = hgCan();
    S.hgUse = Math.max(1, Math.min(can, (S.hgUse || 1) + (+x.dataset.hgd)));
    openForge();
  }));
  $('#ovb').querySelector('[data-hgm]')?.addEventListener('click', () => {
    S.hgUse = hgCan(); openForge();
  });
  $('#fgHgUse')?.addEventListener('click', () => {
    const can = Math.min(S.hourglass || 0, Math.ceil(forgeRemain() / 300));
    useHourglass(Math.max(1, Math.min(S.hgUse || 1, can)));
  });
}

// --- 장비 소환 ---
function equipRoll() {
  // 소환 레벨이 오를수록 상위 등급이 해금되는 슬라이딩 윈도우 (gacha.json > equipmentRateBands)
  const maxTier = Math.min(10, 3 + Math.floor(S.forgeLv / 4));
  const minTier = Math.max(1, maxTier - 4);
  const slots = D.equipment.slots;
  const w = [];
  for (let t = minTier; t <= maxTier; t++) w.push([t, Math.pow(0.45, t - minTier)]);
  const sum = w.reduce((a, x) => a + x[1], 0);
  let r = Math.random() * sum;
  let tier = minTier;
  for (const [t, v] of w) { r -= v; if (r <= 0) { tier = t; break; } }
  return { slot: slots[(Math.random() * slots.length) | 0].id, tier };
}

/** 장비 한 장의 전투력 기여율. equipment.json > grades[].slotBonus */
function eqBonusOf(it) {
  return it ? D.equipment.grades[it.tier - 1].slotBonus : 0;
}

/** 그 장비를 끼웠을 때의 총 전투력 — 비교는 % 가 아니라 실제 CP 로 보여야 읽힌다 */
function cpWith(slotId, it) {
  const keep = S.equip[slotId];
  S.equip[slotId] = it;
  const v = totalCp();
  if (keep) S.equip[slotId] = keep; else delete S.equip[slotId];
  return v;
}

/**
 * 장비 카드. 비교의 핵심은 등급이 아니라 **전투력이 오르냐 내리냐** 다.
 * 그래서 착용 중 대비 증감을 초록/빨강으로 못박아 보여준다.
 */
function eqCard(it, isNew, base) {
  const sl = D.equipment.slots.find(x => x.id === it.slot);
  const g = D.equipment.grades[it.tier - 1];
  const cp = Math.round(cpWith(it.slot, it));
  const d = base == null ? null : cp - base;
  const col = d == null ? '' : d > 0 ? 'var(--up)' : d < 0 ? 'var(--warn)' : 'var(--dim)';
  // 변화가 없으면 뱃지를 안 띄운다 — '= 0' 은 읽을 값이 아니다
  const tag = !d ? ''
    : `<div class="er-d" style="color:${col}">${d > 0 ? '▲ +' : '▼ '}${cpNum(Math.abs(d))}</div>`;
  return `<div class="er-card${isNew ? ' new' : ''}${d > 0 ? ' up' : d < 0 ? ' down' : ''}" data-pick="${isNew ? 'new' : 'cur'}" style="--au:${g.color}">
    <i>${isNew ? '새로 나옴' : '착용 중'}</i>
    ${eqImg(sl, it.tier)}>
    <b style="color:${g.color}">${g.nameKo} T${it.tier}</b>
    <div class="er-cp">${sl.nameKo} · 전투력 <em>${cpNum(cp)}</em></div>
    ${tag}
  </div>`;
}

const cur = n => `<img src="../assets/ui/${n}.png" alt="" class="cui">`;

/** 수동 1회 소환. 결과를 바로 보여주고 유저가 착용/분해를 고른다. */
/**
 * 수동 1회 소환. 망치질이 끝난 뒤 결과를 띄운다.
 * 즉발이면 "뽑았다"는 감각이 없다 — 0.42초 타격 하나로 충분하다.
 */
function pullOne(sel = '#fgObj') {
  if (S.eqTicket < 1) return toast('장비 소환권 부족');
  const obj = $(sel);
  if (!obj || obj.classList.contains('hit')) return;   // 연타로 겹치지 않게
  obj.classList.add('hit');
  S.eqTicket--;
  const it = equipRoll();
  save(); renderTop(); renderForgeDock();
  setTimeout(() => {
    obj.classList.remove('hit');
    openEquipResult(it);
  }, 600);   // fgHam 0.58s 와 맞춘다 — 연출이 끝나기 전에 결과창이 덮으면 안 보인 거나 같다
}

/**
 * 장비 정보. 이 칸에 뭐가 끼워져 있고 얼마나 기여하는지 본다.
 * 착용·교체는 여기서 안 한다 — 경로가 둘이면 뭐가 바뀌었는지 못 따라간다.
 */
function openEquipInfo(slotId) {
  const sl = D.equipment.slots.find(x => x.id === slotId);
  const it = S.equip[slotId];
  $('#ovt').textContent = sl.nameKo;
  $('#ovh').classList.remove('has-cur');
  $('#ovinfo').innerHTML = '';

  if (!it) {
    $('#ovb').innerHTML = `<div class="ei-empty">
      ${sl.nameKo} 부위가 비어 있습니다.<br>
      제작대에서 장비를 소환하면 착용할 수 있습니다.</div>`;
    $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
    return;
  }

  const g = D.equipment.grades[it.tier - 1];
  const cpNow = Math.round(totalCp());
  const cpOff = Math.round(cpWith(slotId, null));
  // 이 장비가 전투력을 얼마나 올려주는지 하나만 본다.
  // 등급·부위는 위 카드에 이미 있고, 기여율(%)은 숫자 감이 안 온다.
  const gain = Math.round(totalCp() - cpWith(slotId, null));
  $('#ovb').innerHTML = `<div class="ei-top" style="--au:${g.color}">
      <span class="ei-ic" style="border-color:${g.color}">${eqImg(sl, it.tier)}></span>
      <span class="ei-name"><b style="color:${g.color}">${g.nameKo} T${it.tier}</b></span>
    </div>`
    + `<div class="frow"><span class="k">전투력 상승량</span>
      <span class="v" style="color:var(--up);font-size:15px">+${cpNum(gain)}</span></div>`
    + `<div class="sh-note">착용·교체는 제작대에서 소환한 뒤 결과 화면에서 고릅니다.</div>`;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
}

/** 0.0444 -> '4.44%' */
const pctStr = v => (v * 100).toFixed(2).replace(/\.?0+$/, '') + '%';

function openEquipResult(it) {
  const sl = D.equipment.slots.find(x => x.id === it.slot);
  const now = S.equip[it.slot];
  const h = [];

  if (!now) {
    h.push(`<div class="er-wrap">${eqCard(it, true, Math.round(totalCp()))}</div>`);
    h.push(`<button class="er-pick" id="erWear">착용하기</button>`);
    h.push(`<button class="er-pick scrap" id="erScrap">분해</button>`);
    h.push(`<div class="er-note">${sl.nameKo} 부위가 비어 있습니다.</div>`);
  } else {
    // 기준은 "지금 낀 것" 의 전투력. 양쪽 카드가 같은 잣대를 쓴다.
    const base = Math.round(cpWith(it.slot, now));
    h.push(`<div class="er-wrap">${eqCard(now, false, base)}
      <span class="er-vs">VS</span>${eqCard(it, true, base)}</div>`);
    const dCp = Math.round(cpWith(it.slot, it) - cpWith(it.slot, now));
    h.push(`<div class="er-note">고른 쪽을 착용하고 <b>나머지는 분해</b>됩니다.<br>
      새 장비로 바꾸면 전투력 <b style="color:${dCp >= 0 ? 'var(--up)' : 'var(--warn)'}">
      ${dCp >= 0 ? '+' : ''}${cpNum(dCp)}</b></div>`);
  }

  $('#ovt').textContent = '장비 소환';
  $('#ovb').innerHTML = h.join('');
  $('#ovinfo').innerHTML = '';
  $('#ov').classList.add('show', 'forced');   // 닫기 없음 — 반드시 고른다

  const finish = (wear) => {
    const before = totalCp();
    const drop = wear ? S.equip[it.slot] : it;
    if (wear) S.equip[it.slot] = it;
    if (drop) S.gold += scrapGold(drop.tier);
    $('#ov').classList.remove('show', 'forced');
    save(); renderEquip(); renderTop(); renderForgeDock();
    scene.partyDps = partyDps();
    const d = Math.round(totalCp() - before);
    toast(wear ? `착용 · 전투력 ${d >= 0 ? '+' : ''}${cpNum(d)}`
               : `분해 · 골드 +${num(scrapGold(it.tier))}`);
  };
  $('#erWear')?.addEventListener('click', () => finish(true));
  $('#erScrap')?.addEventListener('click', () => finish(false));
  $('#ovb').querySelectorAll('[data-pick]').forEach(el =>
    el.addEventListener('click', () => finish(el.dataset.pick === 'new')));
}

function summonEquip(n, isAuto) {
  if (S.eqTicket < n) return toast('장비 소환권 부족');
  S.eqTicket -= n;
  const cap = D.equipment.filter?.inventoryCap || 12;
  const minTier = isAuto ? (S.filterMinTier || 1) : 1;
  let stopHit = null;                    // 멈춤 등급에 걸린 첫 장비
  let scrapped = 0, kept = 0;
  const got = [];              // 연출용 - 보관된 것만

  for (let i = 0; i < n; i++) {
    const it = equipRoll();
    // 자동 소환만 필터를 적용한다. 수동 결과를 게임이 임의로 버리면 신뢰를 잃는다.
    if (isAuto && it.tier < minTier) { S.gold += scrapGold(it.tier); scrapped++; continue; }
    const cur = S.equip[it.slot];
    const best = bestPending(it.slot);
    // 장착품·대기품보다 못하면 즉시 분해 (duplicateHandling)
    if ((cur && it.tier <= cur.tier) || (best && it.tier <= best.tier) || S.inv.length >= cap) {
      S.gold += scrapGold(it.tier); scrapped++; continue;
    }
    if (best) { S.inv.splice(S.inv.indexOf(best), 1); S.gold += scrapGold(best.tier); }
    // 정지 판정. 대기함에 쌓아두면 낄 방법이 없으므로 그 자리에서 유저에게 넘긴다.
    //   -1 지금 낀 것보다 좋으면 (기본)   N 그 등급 이상
    // 정지는 끌 수 없다. 옛 저장에 0 이 남아 있으면 기본값으로 되돌린다.
    if (isAuto && !S.autoStopTier) S.autoStopTier = -1;
    // 전투력이 오르는지로 본다. 등급 비교와 결과는 같지만 기준이 화면 문구와 일치한다 —
    // 나중에 강화·세트 보너스가 붙어도 이 식이 그대로 맞다.
    const stopNow = isAuto && (S.autoStopTier === -1
      ? eqBonusOf(it) > eqBonusOf(cur)
      : (S.autoStopTier > 0 && it.tier >= S.autoStopTier));
    if (stopNow) {
      S.inv.splice(S.inv.indexOf(it), 1);
      kept--; got.pop();
      stopHit = it;
      break;                       // 남은 횟수는 소모하지 않는다
    }
  }
  if (stopHit) {
    S.autoSummon = false;
    const g = D.equipment.grades[stopHit.tier - 1];
    // 멈춘 시점 이후로 안 돌린 만큼은 소환권을 돌려준다
    const used = kept + scrapped + 1;
    if (used < n) S.eqTicket += n - used;
    save(); renderEquip(); renderTop(); renderForgeDock();
    toast(`${g.nameKo} 등장 · 자동 소환 정지`);
    openEquipResult(stopHit);      // 착용/분해를 고를 때까지 안 닫힌다
    return;
  }
  save();
  renderEquip(); renderTop();
  // 자동 소환은 연출하지 않는다 - 배치가 700개까지 가므로 띄우면 게임이 멈춘다
  if (!isAuto) {
    if (got.length) {
      reveal.play('equipment', got.map(it => {
        const sl = D.equipment.slots.find(x => x.id === it.slot);
        return { grade: tierToGrade(it.tier), name: `${sl.nameKo} T${it.tier}`,
                 img: `../assets/equip/${eqIcon(sl, it.tier)}.png` };
      }));
    } else {
      toast(`${n}회 소환 — 전부 분해 (${scrapped}개)`);
    }
  }
}

const scrapGold = tier => D.equipment.duplicateHandling.goldByTier[tier] || 0;


// --- 스테이지 ---
/** 탑 한 층을 건다. 배경은 마지막 배경대(마왕성)를 쓴다. */
async function runTowerFloor(floor) {
  await scene.setBackground('BG-06');
  await scene.setParty(S.party);
  $('#stg').innerHTML = `무한의 탑<i>${floor}층</i>`;
  markEncounter(-1);
  scene.activeSkills = S.skills.active.filter(Boolean);
  await scene.startTowerFloor(floor, towerCp(D, floor), partyDps());
  renderTop();
}

async function runStage() {
  const bgId = bgFor(S.stage);
  await scene.setBackground(bgId);
  await scene.setParty(S.party);
  const lb = stageLabel(S.stage);
  $('#stg').innerHTML = `${lb.text}<i>${lb.zone}</i>`;
  markEncounter(-1);
  // 장착된 액티브 스킬만 전투 이펙트로 나온다
  scene.activeSkills = S.skills.active.filter(Boolean);
  await scene.startStage(S.stage, requiredCp(S.stage), partyDps());
  renderTop();
}

/**
 * 보스 도전. VS 구도를 먼저 보여주고 전투를 건다.
 * 단장이 좌하단, 보스가 우상단 — 대각선이 정면 대치보다 긴장이 산다.
 */
// 보스에 진 뒤 자동 도전 잠금. [보스 도전] 을 눌러야 풀린다.
let bossLocked = false;

async function challengeBoss() {
  if (!scene || scene.bossFight) return;
  bossLocked = false;
  $('#hudC').classList.remove('farm');
  const id = scene.bossAssetId();
  const b = D.stages.bosses.find(x => x.stage === S.stage);
  $('#vsBossImg').src = `../assets/boss/${id}.png`;
  $('#vsCapImg').src = '../assets/captain/captain_warrior.png';
  // 보스 이름은 안 띄운다. 그림과 체력바로 충분하다.
  $('#bossGo').classList.remove('show');

  const v = $('#vs');
  v.classList.remove('show'); void v.offsetWidth;   // 애니메이션 재시작
  v.classList.add('show');
  await new Promise(r => setTimeout(r, 1500));
  v.classList.remove('show');
  await scene.challengeBoss();
}

/** 퀘스트가 가리키는 화면으로 이동한다. track 이 있으면 그 트랙까지 연다. */
function questGoto(t) {
  // 목적지가 없으면 아무것도 안 한다. 전투 화면에서 '전투하세요' 는 소음이다.
  if (!t || !t.goto) return;
  if (t.goto === 'shop') shop.open(t.track);
  else if (t.goto === 'forge') openForge();
  else if (t.goto === 'dungeon') openDungeons();
}

function onEvent(e) {
  if (e.type === 'wave') {
    markEncounter(e.encounter);
    // 보스전이 시작되면 도전 버튼을 숨긴다
    if (e.boss) $('#bossGo').classList.remove('show');
  } else if (e.type === 'bossReady') {
    // 잡몹 3웨이브 정리. 평소엔 바로 보스로 — 단, 직전에 진 상태면 자동 도전을 멈추고
    // 잡몹만 계속 돈다. 자동으로 또 붙으면 지는 화면이 무한 반복된다.
    if (bossLocked) { setTimeout(runStage, 400); return; }
    $('#bossGo').classList.remove('show');
    challengeBoss();
  } else if (e.type === 'tick') {
    const t = $('#timer');
    // 제한 없는 구간(잡몹)은 숫자를 숨긴다 — 0 이 떠 있으면 곧 진다고 읽힌다
    if (e.timeLeft == null) { t.style.visibility = 'hidden'; return; }
    t.style.visibility = '';
    t.textContent = Math.max(0, Math.ceil(e.timeLeft));
    t.classList.toggle('low', e.timeLeft < 6);
  } else if (e.type === 'towerWin') {
    towerClear(D, S, toast);
    save(); renderTop();
    setTimeout(() => { tower.open(); runStage(); }, 900);
  } else if (e.type === 'towerLose') {
    showResult(`${e.floor}층 실패`, '#ff5a6a');
    setTimeout(() => { tower.open(); runStage(); }, 1200);
  } else if (e.type === 'win') {
    bossLocked = false;
    $('#hudC').classList.remove('farm');
    $('#bossGo').classList.remove('show');
    // 클리어 표시는 띄우지 않는다 — 매 스테이지 뜨면 진행이 끊긴다
    S.maxStage = Math.max(S.maxStage, S.stage);
    S.gold += Math.round(Math.pow(requiredCp(S.stage), 1.35) * D.stages.rewards.repeatClear.gold.coefficient);
    S.eqTicket += 12; S.hourglass += 3;
    renderQuest();
    capGain(1);
    // AUTO 가 꺼져 있으면 같은 스테이지를 반복한다 (골드 파밍).
    // stages.json > rewards.repeatClear - 반복 클리어 보상은 골드 단독이다.
    S.stage++;
    save();
    setTimeout(runStage, 250);
  } else if (e.type === 'lose') {
    showResult('보스 실패', '#ff5a6a');
    // 스테이지는 그대로다. 잡몹을 다시 돌면서 다음 도전을 기다린다.
    // 여기서 runStage 를 다시 안 걸면 scene.phase 가 'done' 인 채 화면이 멈춘다 —
    // 실제로 그랬다. 자동 재도전은 bossLocked 가 막는다.
    bossLocked = true;
    $('#hudC').classList.add('farm');   // 진행도 점 대신 루프 표시
    $('#bossGo').classList.add('show');
    setTimeout(runStage, 1200);
  }
}

// --- 부트 ---
function rollParty() {
  const pool = [...D.characters.characters];
  S.party = Array.from({ length: 5 }, () => {
    const c = pool.splice((Math.random() * pool.length) | 0, 1)[0];
    return { id: c.id, nameKo: c.nameKo, grade: c.grade, class: c.class, level: 0 };
  });
}

function rollSkills() {
  const act = D.skills.skills.filter(s => s.id.startsWith('SK-A'));
  const pas = D.skills.skills.filter(s => s.id.startsWith('SK-P'));
  const take = (src, n, owned) => Array.from({ length: n }, (_, i) => {
    if (i >= owned) return null;
    const s = src[(Math.random() * src.length) | 0];
    return { id: s.id, nameKo: s.nameKo, grade: 'R', level: 0 };
  });
  S.skills.active = take(act, 4, 2);
  S.skills.passive = take(pas, 4, 1);
}

(async function boot() {
  await loadData('../data');
  $('#cap').src = '../assets/captain/captain_warrior.png';

  load();
  if (!S.party.length) {
    rollParty(); rollSkills();
    for (const p of S.party) if (!S.codex.mercenary.includes(p.id)) S.codex.mercenary.push(p.id);
    for (const s of [...S.skills.active, ...S.skills.passive]) if (s) S.codex.skill[s.id] = s.grade;
  }

  reveal = new SummonReveal($('#app'));
  codex = new CodexScreen($('#app'), { state: S, data: D });
  rank = new RankScreen($('#app'), { state: S, data: D, cp: totalCp });
  mail = new MailScreen($('#app'), {
    state: S, data: D,
    claim: i => claimMail(i),
    claimAll: () => { while ((S.mailbox || []).some(x => !x.claimed)) claimMail(0); },
  });
  tower = new TowerScreen($('#app'), {
    state: S, data: D, cp: totalCp,
    challenge: f => runTowerFloor(f),
  });
  profile = new ProfileScreen($('#app'), {
    state: S, data: D, cp: totalCp,
    nickCost, setNick: n => setNickname(n), toast,
    set: (k, v) => { S.profile = S.profile || {}; S.profile[k] = v; save(); renderCaptain(); },
  });
  settings = new SettingsScreen($('#app'), {
    state: S, data: D,
    set: (k, v) => {
      if (k === 'speed') { S.speed = v; scene.speed = v; syncSpeedBtns(); }
      else if (k === 'skip') S.skipBattle = !!v;
      else if (k === 'fx') { S.fxOn = !!v; scene.fx.enabled = !!v; }
      else if (k === 'shake') { S.shakeOn = !!v; scene.impact.opts.shake = !!v; }
      else if (k === 'nums') { S.numsOn = !!v; scene.numbers.enabled = !!v; }
      else if (k === 'bgm') S.bgm = v;
      else if (k === 'sfx') S.sfx = v;
      save();
    },
    action: a => {
      if (a === 'reset') { localStorage.removeItem(SAVE_KEY); location.reload(); }
      else if (a === 'rates') { settings.close(); shop.open(); }
      else toast('미구현');
    },
  });
  shop = new ShopScreen($('#app'), {
    claimSummonLevel,
    state: S, data: D, toast,
    pull: (trackId, n) => pull(trackId, n),
  });
  scene = new BattleScene($('#cv'), { data: D, onEvent });
  window.__scene = scene;   // 디버그용
  window.__S = S;
  await scene.init();

  renderSkills(); renderEquip(); renderQuest(); renderCaptain(); renderTop();
  await runStage();
  // 닉네임이 없으면 아무거나 붙여 준다. 유저는 나중에 한 번 공짜로 바꾼다.
  if (!S.nickname) { S.nickname = autoNickname(); save(); }
  seedMail();
  renderChest();

  document.querySelectorAll('#speed .sbtn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#speed .sbtn').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    scene.speed = +b.dataset.sp;
    S.speed = +b.dataset.sp;
    save();
  }));

  // 제작대 오브젝트 = 수동 1회 소환. 참고 화면과 같은 조작이다.
  $('#bossGo').addEventListener('click', challengeBoss);
  $('#fgObj').addEventListener('click', () => pullOne('#fgObj'));   // 이벤트 객체가 인자로 새면 안 된다
  $('#fgLv').addEventListener('click', e => { e.stopPropagation(); openForge(); });
  $('#b_auto').addEventListener('click', openAutoPanel);
  $('#capbox').addEventListener('click', () => profile.open());
  $('#chest').addEventListener('click', openIdle);
  $('#idOk').addEventListener('click', () => claimIdle(1));
  $('#idAd').addEventListener('click', () => claimIdle(idleDef().adDoubleMultiplier));
  $('#idFree').addEventListener('click', () => claimInstant(false));
  $('#idAdInstant').addEventListener('click', () => claimInstant(true));
  $('#idClose').addEventListener('click', () => $('#idle').classList.remove('show'));
  // 퀘스트 바 — 완료면 즉시 수령, 아니면 상세 화면
  // 퀘스트는 화면을 옮기지 않는다. 달성했으면 눌러서 바로 수령한다.
  // 달성했으면 그 자리에서 수령, 아직이면 할 일이 있는 화면으로 데려간다.
  $('#quest').addEventListener('click', () => {
    const def = questAt(D, S.quest);
    if (qProgress(def) >= def.target) { claimQuest(); return; }
    questGoto(QUEST_TYPE[def.type]);
  });
  document.querySelectorAll('#nav .nv').forEach(n => n.addEventListener('click', () => {
    document.querySelectorAll('#nav .nv').forEach(x => x.classList.remove('on'));
    n.classList.add('on');
    // ui.json > mainScreen.navBar.items 기준. 장비는 하단 패널에 있으므로 뺐다.
    if (n.dataset.tab === 'shop') shop.open();
    else if (n.dataset.tab === 'dungeon') openDungeons();
    else if (n.dataset.tab === 'alliance') openAlliance();
    else if (n.dataset.tab === 'merc') openRoster('mercenary');
    else if (n.dataset.tab === 'skill') openRoster('skill');
    else toast(`${n.textContent} 탭 — 미구현`);
  }));

  // 설정은 사이드 열에서 상단바로 옮겼다. 스테이지 표시는 HUD 진행도와 중복이라 뺐다.
  $('#topSet').addEventListener('click', () => settings.open());
  // 스킬 자동 토글. 기본 ON — 방치형이라 손을 떼도 돌아가야 한다.
  $('#skAuto').addEventListener('click', () => {
    S.skillAuto = !S.skillAuto;
    $('#skAuto').classList.toggle('on', S.skillAuto);
    $('#skAuto').querySelector('i').textContent = S.skillAuto ? 'ON' : 'OFF';
    scene.skillAuto = S.skillAuto;
    save();
  });
  document.querySelectorAll('.side button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.s === 'arena') openArena();
    else if (b.dataset.s === 'pass') openPass();
    else if (b.dataset.s === 'codex') codex.open();
    else if (b.dataset.s === 'training') openTraining();
    else if (b.dataset.s === 'rank') rank.open();
    else if (b.dataset.s === 'settings') settings.open();
    else if (b.dataset.s === 'mail') mail.open();
    else toast(`${b.textContent} — 미구현`);
  }));
  $('#ovx').addEventListener('click', () => {
    if ($('#ov').classList.contains('forced')) return;
    $('#ov').classList.remove('show');
    $('#ovinfo').classList.remove('show');
    $('#ovi').classList.remove('on');
  });
  $('#ovi').addEventListener('click', () => {
    $('#ovinfo').classList.toggle('show');
    $('#ovi').classList.toggle('on');
  });
  // 카드 바깥을 누르면 닫힌다
  // 바깥을 눌러 닫는 것도 강제 선택 화면에서는 막는다
  $('#ov').addEventListener('click', e => {
    if (e.target.id === 'ov' && !$('#ov').classList.contains('forced')) $('#ovx').click();
  });

  const CHAT = [
    '단장님, 오늘도 잘 부탁드립니다!', '수정 동굴이 열렸다는 소문이 있어요.',
    '보물 창고에서 열쇠를 모으는 게 빠릅니다.', '제작대를 올리면 소환이 편해집니다.',
    '보스는 시간 안에 못 잡으면 실패입니다.',
  ];
  let chatI = 0;
  setInterval(() => {
    chatI = (chatI + 1) % CHAT.length;
    $('#chatline').textContent = CHAT[chatI];
  }, 6000);

  setInterval(() => {
    // 제작대 타이머
    if (S.forgeStart && forgeRemain() <= 0) finishForge();
    if ($('#ov').classList.contains('show') && $('#fgLeft')) {
      $('#fgLeft').textContent = dur(forgeRemain());
      const tot = forgeCost(S.forgeTarget);
      if (tot && $('#fgProgFill')) {
        $('#fgProgFill').style.width = (1 - forgeRemain() / tot.sec) * 100 + '%';
      }
    }

    // 자동 소환 — 배치를 초당 1회로 묶는다 (Verse8 호출 제한 10회/초)
    if (S.autoSummon && autoUnlocked() && S.eqTicket > 0) {
      const n = Math.min(S.eqTicket, S.autoBatch || batchSize());
      if (n > 0) summonEquip(n, true);
    }
    renderTop();
    renderChest();
    renderForgeDock();
    save();
  }, 1000);
})();
