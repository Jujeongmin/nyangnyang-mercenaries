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
import { RosterSheet } from './view/roster.js';
import { AllianceVillage } from './view/alliance.js';
import { t, tn, loadLang, LANGS } from './core/i18n.js';
import { showRewarded, initAds, AD_OK, AD_SKIPPED, AD_IDLE_DOUBLE, AD_INSTANT_CLAIM } from './net/ads.js';

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
  // 보유함 — 뽑았지만 장착 안 된 것. 장착분(party/skills)과 배열을 나눠 가진다.
  // 같은 객체를 두 배열이 참조하게 하면 JSON 세이브를 거치며 동일성이 깨져 레벨이 갈라진다.
  own: { mercenary: [], skill: [] },
  // 강화 대기열. 등급 문자열만 쌓는다 — dupeValue 가 등급에서 나오기 때문이다.
  // 시트의 [자동강화] 를 눌러야 캐스케이드로 흘러간다.
  pend: { mercenary: [], skill: [] },
  auto: true, autoSummon: false, autoAcc: 0,
  // 자동 소환은 **켜 둔 상태(autoWanted)** 와 **지금 도는 중(autoSummon)** 이 다르다.
  // 좋은 장비가 나와서 서는 것은 정지가 아니라 일시정지다 — 유저가 착용·분해를
  // 고르면 다시 돈다. 완전 정지는 AUTO 버튼을 다시 눌렀을 때만이다.
  autoWanted: false,
  // 자동이 잡아 두고 유저 판단을 기다리는 장비. 제작대 모루가 이걸로 빛난다
  eqPending: null,
  // 자동 소환 정지 기준. -1 = 지금 낀 것보다 좋으면(기본), N = 그 등급 이상.
  // 끄는 선택지는 없다 — 좋은 장비가 대기함에 묻히기 때문이다.
  autoStopTier: -1, autoBatch: 0,
  // 제작대 분할 납부. 다음 레벨에 지금까지 몇 회분을 넣었나
  forgePaid: 0,
  // 모래시계 — 제작 시간 단축 전용. 상단바에는 안 띄운다.
  hgUse: 1,                                // 시간 단축에 한 번에 쓸 개수 (창 #hgPop)
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
  speed: 1,                                // 배속. speedMax() 안에서만 고를 수 있다
  speed3: false,                           // 3배속 구매 여부. 서버 권한 (save-schema)
  speed3DailyAt: null,                     // 3배속 일일 다이아 마지막 수령일
  lang: null,                              // 언어. 첫 부팅 로딩 화면에서 고른다
  // 출석 — dailies.json > attendance. day = 7일 주기 위치(0~6, 다음에 받을 칸),
  // monthDays = 이번 달 누적 출석일, cumClaimed = 수령한 누적 마일스톤(days 값들)
  attend: { day: 0, lastAt: null, month: null, monthDays: 0, cumClaimed: [] },
  // 편성 프리셋 3개. id 만 저장한다 — 실객체는 로드 때 보유·장착 풀에서 다시 찾는다.
  // 실객체를 넣으면 레벨업·캐스케이드 뒤 프리셋 속 사본이 낡는다
  presets: [null, null, null],
  // 연합 코인 — 프로토타입은 로컬 보유. 서버 연동 시 net/backend.js 로 옮긴다
  allyCoin: 0,
  allyDonate: { day: null, gold: 0, eq: 0 },   // 일일 기부 횟수
  capLv: 1, capXp: 0,                      // 단장(계정) 레벨. 스탯 효과 없음
  codex: { mercenary: [], skill: {} },     // 1회 획득 시 영구 등록
  trainLv: 0,                              // 훈련소
  promo: { warrior: 1, archer: 1, mage: 1 },   // 직군별 전직 단계
  // 전직으로 고른 길. 하나를 고르면 다른 직군은 잠긴다 — 초기화로만 되돌린다.
  // 단장의 모습·공격 모션도 이 직업을 따른다
  promoClass: null,
  promoSkillLv: 0,                         // 전직 스킬 강화 단계 (골드 소모처)
  kills: 0,                                // 누적 몬스터 처치 (퀘스트 monster_kill)
  nickname: null,                          // 첫 부팅에 자동 배정된다
  nickChanged: 0,                          // 변경 횟수. 0 이면 다음 변경이 무료
  nickChangedAt: 0,
  profile: { titleId: null, frameId: 'pf_default', featuredMercId: null, ownedTitles: [] },
  // 일일·주간 임무. c 는 퀘스트 id 별 진행도, claimed 는 수령한 포인트 관문.
  // day/week 가 바뀌면 통째로 갈아 끼운다 (dailies.json > dailyQuests/weeklyQuests)
  dq: { day: null, c: {}, claimed: [], full: 0 },
  wq: { week: null, c: {}, claimed: [] },
  // 출시 7일 축제 — 접속일 기준 하루 1칸 (dailies.json > newbie7Day)
  ev7: { day: 0, lastAt: null },
  // 무료 1000뽑 — 스테이지 마일스톤 자동 지급 (free1000.json). total = 지급 누계
  f1k: { claimed: [], total: 0 },
  mailbox: [],
  idle: { lastClaimAt: Date.now(), freeUsed: 0, adUsed: 0, resetAt: Date.now() },
};

let scene, reveal, shop, codex, rank, settings, mail, profile, tower, roster, alli;

// --- CP ---
// 전직 배수는 **그 용병의 직군**에서 온다 (goldsinks > training_camp.promotion).
// class 가 없는 옛 세이브·스킬 객체는 배수 1 로 떨어진다
const cpOf = m => D.characters.gradeCoef[m.grade]
  * (1 + m.level * D.characters.levelGrowthPerLevel)
  * (m.class ? promoMult(m.class) : 1);
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
  // individualByGrade 는 {count, bonusEach, subtotal} 다 — 위 용병 쪽처럼
  // bonusEach 를 꺼내야 한다. 객체를 그대로 더하면 NaN 이 되고, 그 NaN 이
  // totalCp 를 타고 내려가 전투력이 "0" 으로 표시됐다
  for (const g of Object.values(S.codex.skill)) b += skG[g]?.bonusEach || 0;
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

/**
 * 지금 쓸 수 있는 최고 배속.
 *
 * 배속은 전투 재생 속도이면서 **방치 수익의 곱셈 항**이다
 * (stages.json > idleReward.speedBasis). 그래서 성장·과금 축으로 쓴다:
 *   1x 기본 / 2x 퀘스트 / 3x 구매
 *
 * 해금 기준이 CP 가 아니라 퀘스트인 이유는 슬롯과 같다 — 뽑기 운이 순서를 흔들면 안 된다.
 */
function speedMax() {
  const tbl = D.combat.clientRendering.speedUp || [];
  let m = 1;
  for (const r of tbl) {
    if (r.unlock === 'default') m = Math.max(m, r.mult);
    else if (r.unlock === 'quest' && questCleared() >= r.afterQuest) m = Math.max(m, r.mult);
    else if (r.unlock === 'purchase' && S.speed3) m = Math.max(m, r.mult);
  }
  return m;
}

/**
 * 3배속 해금 구매.
 *
 * **실결제는 아직 없다** — VXShop 등록 전이라 검증할 방법이 없고, 해금 판정은
 * 원래 서버가 쥐어야 한다 (save-schema.json > schema.speed3: "서버 권한").
 * 그래서 개발 빌드에서만 즉시 해금해 테스트를 열어 두고, 프로덕션 번들에는
 * 이 분기가 아예 안 들어간다 (net/ads.js 의 unsupported_env 처리와 같은 방식).
 */
function buySpeed3() {
  if (S.speed3) return toast(t('이미 해금되어 있습니다'));
  if (!import.meta.env.DEV) return toast('결제 연동 전 — VXShop 등록 후 붙는다');
  S.speed3 = true;
  S.speed = 3;
  if (scene) scene.speed = 3;
  save(); syncSpeedBtns(); shop.render();
  toast('[개발 빌드] 3배속 해금');
}

/**
 * 3배속 패키지의 일일 다이아. **자동 지급이 아니라 수령이다** —
 * 자동이면 받은 줄도 모르고 지나가서 접속 이유가 안 된다 (소환 레벨 보상과 같은 규칙).
 */
function claimSpeed3Daily() {
  if (!S.speed3) return;
  const pk = (D.shop.packages || []).find(x => x.id === 'speed3_unlock');
  const n = pk?.dailyGrant?.diamond ?? 0;
  // 서버 시각이 아니라 클라 날짜다. 서버 연동 때 net/backend.js 로 옮긴다
  const today = new Date().toISOString().slice(0, 10);
  if (S.speed3DailyAt === today) return toast('오늘은 이미 받았습니다');
  S.speed3DailyAt = today;
  S.dia += n;
  save(); renderTop(); shop.render();
  gainToast([['diamond', n]]);
}

/** 잠긴 배속을 눌렀을 때 무엇을 해야 열리는지 */
function speedHint(mult) {
  const r = (D.combat.clientRendering.speedUp || []).find(x => x.mult === mult);
  if (!r) return '';
  if (r.unlock === 'quest') return `퀘스트 ${r.afterQuest} 를 끝내면 ${mult}배속이 열립니다`;
  if (r.unlock === 'purchase') return `${mult}배속은 상점에서 해금합니다`;
  return '';
}

/** 설정과 전투 화면 버튼이 같은 값을 보게 한다 */
function syncSpeedBtns() {
  const max = speedMax();
  // 해금이 내려가는 일은 없지만, 세이브가 앞서 있으면 고른 값을 끌어내린다
  if ((S.speed || 1) > max) { S.speed = max; if (scene) scene.speed = max; }
  document.querySelectorAll('#speed .sbtn[data-sp]').forEach(x => {
    const sp = +x.dataset.sp;
    x.classList.toggle('on', sp === (S.speed || 1));
    // 잠긴 배속도 **보여준다.** 숨기면 해금이 보상으로 안 읽힌다
    x.classList.toggle('lock', sp > max);
  });
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

/**
 * 우편 빨간 점. **renderTop(1초 루프)에서 매번 다시 계산한다.**
 * 예전에는 renderCaptain 안에 있었는데 그 함수는 부팅·레벨업 때만 불린다 —
 * 다 받아도 점이 남고, 새 우편이 와도 점이 안 켜졌다.
 */
function renderMailDot() {
  const un = (S.mailbox || []).filter(x => !x.claimed).length;
  // 우편은 사이드가 아니라 상단 프로필 줄에 있다. 자리를 안 박고 data-s 로 찾는다
  const mb = document.querySelector('[data-s="mail"]');
  if (mb) mb.classList.toggle('hasnew', un > 0);
}

function renderCaptain() {
  $('#caplv').textContent = S.capLv;
  renderMailDot();
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
  alliance_coin: 'allyCoin',   // 마을 기부 프로토타입. 서버 연동 시 net/ 으로
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
  // 우편 빨간 점은 renderCaptain 이 계산한다. 여기서 안 부르면 다 받아도 점이 남는다
  save(); mail.render(); renderCaptain(); renderTop();
  gainToast(Object.entries(m0.grants).filter(([k]) => MAIL_CUR[k]));
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

/**
 * 퀘스트 보상 → 세이브 필드.
 *
 * **소환권 3종이 빠져 있었다** (2026-08-23 발견). quests.json 은 Q1 에
 * merc_ticket 10 을 주는데 여기 없는 키는 지급 코드가 조용히 무시한다 —
 * Q2(용병 소환 10회)의 재료가 통째로 증발해 사슬이 첫 칸에서 끊겼다.
 * audit.mjs 가 못 잡은 이유: 그쪽은 MAIL_CUR 만 본다.
 * **새 재화를 만들면 이 표에도 넣는다.**
 */
const QUEST_CUR = { diamond: 'dia', gold: 'gold', equip_ticket: 'eqTicket',
  speedup_5m: 'hourglass', merc_ticket: 'mercTicket', skill_ticket: 'skillTicket',
  arena_medal: 'medal', alliance_coin: 'allyCoin' };

// ─────────────────────────────────────────────
// 해금 — **퀘스트 진행도가 기준이다.** 전투력이 아니다.
//
// CP 로 열면 순서를 보장할 수 없다. CP 는 뽑기 운으로 튀어서 UR 하나 잘 뽑으면
// 던전이 순서를 건너뛰고 열린다. dungeons.json > unlockOrder 가 "골드 → 열쇠 →
// 제련석 → 다이아 순으로 시스템이 하나씩 열려 신규 유저가 7개 재화를 한꺼번에
// 마주치지 않는다"를 요구하는데, CP 기준은 그 계단을 무너뜨린다.
// quests.json > slotUnlockQuests.canonicalSource: true — 그 표가 단일 소스다.
// ─────────────────────────────────────────────

/**
 * 하단 네비 강조 — **지금 열려 있는 것에서 파생시킨다.**
 *
 * 누를 때 `.on` 을 붙이는 방식은 닫는 경로가 여러 개(#ovx · 배경 탭 · 시트 닫기 ·
 * 상점 뒤로 · 다른 화면으로 이동)라 반드시 하나를 빠뜨린다 — 실제로 패널을 닫아도
 * 강조가 남았다. 열린 패널이 하나도 없으면 강조도 없다.
 */
let navTab = null;

function syncNav() {
  const open = $('#sheet')?.classList.contains('show')
    || $('#ov')?.classList.contains('show')
    || $('#shop')?.classList.contains('show')
    || !!document.querySelector('.fullscr.show');
  if (!open) navTab = null;
  document.querySelectorAll('#nav .nv').forEach(x =>
    x.classList.toggle('on', !!navTab && x.dataset.tab === navTab));
  // 임무 수령 대기 — 사이드 아이콘 빨간 점. 놓치면 사라지는 것이라 점을 붙인다
  document.querySelector('[data-s="mission"]')?.classList.toggle('hasnew', mqWaiting());
  document.querySelector('[data-s="event"]')?.classList.toggle('hasnew',
    ev7Ready() || f1kPendingN() > 0);
}

/** 완료한 최대 퀘스트 번호. S.quest 는 '지금 진행 중'이라 1을 뺀다 */
const questCleared = () => (S.quest || 1) - 1;
const questDone = n => questCleared() >= (n || 0);

/**
 * 장착 칸 수. quests.json > slotUnlockQuests
 * @param kind 'mercenary' | 'skillActive' | 'skillPassive'
 */
/**
 * 네비 탭이 열렸나. quests.json > navUnlockQuests 가 단일 소스다.
 * 처음엔 전투만 보이고 퀘스트를 넘길 때마다 하나씩 열린다 — 다섯 탭을 한 번에
 * 주면 첫 화면이 메뉴판이 되고 무엇부터 할지가 안 보인다.
 */
function navOpen(tab) {
  const t = D.quests.navUnlockQuests?.tabs?.[tab];
  return !t || questCleared() >= t.afterQuest;
}

/** 잠긴 탭에 자물쇠를 씌우고, 열리면 벗긴다 */
function renderNavLocks() {
  document.querySelectorAll('#nav .nv').forEach(el => {
    const t = el.dataset.tab;
    const open = navOpen(t);
    el.classList.toggle('locked', !open);
    if (!open) {
      const need = D.quests.navUnlockQuests.tabs[t].afterQuest;
      el.title = `퀘스트 ${need} 완료 시 열립니다`;
    } else el.removeAttribute('title');
  });
}

function slotsOf(kind) {
  const tbl = D.quests.slotUnlockQuests?.[kind] || [];
  let n = 0;
  for (const r of tbl) if (questCleared() >= r.afterQuest) n = r.slots;
  return n;
}

/** 보상 수령. 실제로는 서버 함수다 (net/backend.js > claimQuest). */
function claimQuest() {
  const def = questAt(D, S.quest);
  if (qProgress(def) < def.target) return toast(t('아직 조건 미달'));
  for (const [k, v] of Object.entries(def.rewards)) {
    const bag = QUEST_CUR[k];
    if (bag) S[bag] += v;
  }
  // **올리기 전에** 잰다. 뒤에서 재면 이미 해금된 값이라 알림이 안 뜬다
  const before = speedMax();
  S.quest++;
  save();
  renderQuest(); renderTop();
  // 퀘스트 5 를 넘기면 2배속이 열린다 (quests.json > speedUnlockQuests)
  syncSpeedBtns();
  renderNavLocks();
  // 퀘스트는 **아무 팝업도 안 띄운다.** 보상이 배너에 이미 아이콘+개수로 떠 있고
  // 수령하면 그 자리가 다음 퀘스트로 바뀐다 — 그게 곧 "받았다"는 신호다.
  // 상단 획득 배너까지 띄우면 화면 중앙이 매 퀘스트마다 가려진다
  if (speedMax() > before) setTimeout(() => toast(`${speedMax()}배속 해금!`), 1400);
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
    // 보유함·대기열은 나중에 생긴 필드다. 옛 세이브에는 없으므로 채워 준다.
    S.own = { mercenary: [], skill: [], ...(S.own || {}) };
    S.pend = { mercenary: [], skill: [], ...(S.pend || {}) };
    // 대기열은 처음에 등급 문자열만 담았다. 지금은 {id, grade} 다 —
    // 주인을 모르는 옛 항목은 id 없이 넣어 캐스케이드로 흘려 보낸다.
    for (const t of ['mercenary', 'skill']) {
      S.pend[t] = (S.pend[t] || []).map(e =>
        typeof e === 'string' ? { id: null, grade: e } : e);
    }
    // 전직 배타 규칙(promoClass) 이전의 세이브 — 여러 직군이 승급돼 있을 수 있다.
    // 가장 높은 단계 하나만 "고른 길"로 남기고 나머지는 1로 되돌린다
    if (!S.promoClass && S.promo) {
      const top = ['warrior', 'archer', 'mage']
        .filter(c => (S.promo[c] || 1) > 1)
        .sort((a, b) => S.promo[b] - S.promo[a])[0];
      if (top) {
        S.promoClass = top;
        for (const c of ['warrior', 'archer', 'mage']) if (c !== top) S.promo[c] = 1;
      }
    }
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
  return dps * gear * csDpsMult();
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
  mq('forge_lv', Math.max(1, S.forgeTarget - S.forgeLv));
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
/** 그 해금이 열리는 레벨. 안내 문구에 숫자를 박지 않으려고 데이터에서 꺼낸다 */
const unlockLv = kind =>
  D.equipment.summon.progression.find(p => p.unlock === kind)?.summonLv ?? '?';

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
      // 신규 스킬은 그림이 아직 없을 수 있다. 깨진 아이콘 대신 빼 버린다
      d.innerHTML = `<img src="/assets/skill/${s.id}.png" alt="" onerror="this.remove()">`
        + '<i class="cdwipe"></i>';
      d.title = `${tn(s.id, s.nameKo)} ${s.grade} Lv${s.level}`;
      d.dataset.sid = s.id;
    } else {
      d.title = `${kind} ${i + 1}번 칸 — 비어 있음`;
    }
    return d;
  };
  S.skills.active.forEach((s, i) => {
    const d = mk(s, i, '액티브');
    // 수동 모드에서는 탭이 곧 발동이다. 준비 표시는 scene 이 ready 클래스로 준다.
    if (s) d.addEventListener('click', () => {
      // 수동 모드에서 탭 = 발동. 자동 모드에서는 발동할 게 없으니 탭 = 설명이다
      if (!S.skillAuto) scene.castSkillManual?.(i);
      else openUnitInfo('skill', s.id);
    });
    d.dataset.si = i;
    box.appendChild(d);
  });
  const gap = document.createElement('div'); gap.className = 'skgap'; box.appendChild(gap);
  S.skills.passive.forEach((s, i) => {
    const d = mk(s, i, '패시브');
    if (s) d.addEventListener('click', () => openUnitInfo('skill', s.id));
    box.appendChild(d);
  });
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
const eqImg = (slot, tier) => `<img src="/assets/equip/${eqIcon(slot, tier)}.png" alt=""`
  + ` onerror="this.onerror=null;this.src='/assets/equip/${eqIcon(slot)}.png'"`;

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
    anim.style.setProperty('--strip', `url(/assets/ui/FO-0${st}-STRIP.png)`);
  }
  // 제작 중이면 뱃지가 남은 시간을 띄운다. 투입 진행도는 패널에서 본다.
  const busy = !!S.forgeStart;
  $('#fgLv').classList.toggle('busy', busy);
  $('#fgLv').textContent = busy ? dur(forgeRemain()) : `Lv ${S.forgeLv}`;
  $('#fgTicketN').textContent = num(S.eqTicket);
  $('#fgObj').classList.toggle('empty', S.eqTicket < 1 && !S.eqPending);
  // 자동이 잡아 둔 장비가 있으면 모루가 빛난다. 이게 유일한 알림이다
  $('#fgObj').classList.toggle('pend', !!S.eqPending);

  const b = $('#b_auto');
  b.disabled = !autoUnlocked();
  // 상태는 톱니가 도는지로 말한다 — 글자를 안 쓴다
  b.title = !autoUnlocked() ? `제작대 Lv ${unlockLv('auto_summon')} 에 해금`
    : (S.autoWanted ? (S.autoSummon ? '자동 소환 중 · 눌러서 정지' : '결과 대기 중') : '자동 소환 꺼짐');
  b.classList.toggle('on', !!S.autoWanted && autoUnlocked());
}

/**
 * 자동 소환 켜기/끄기. off=true 면 완전 정지(유저 의사), 아니면 시작.
 * autoWanted 는 좋은 장비가 나와 잠깐 서 있는 동안에도 유지된다.
 */
function stopAuto(off) {
  S.autoWanted = !off;
  S.autoSummon = S.autoWanted;
  save(); renderForgeDock();
  toast(S.autoWanted ? '자동 소환 시작' : '자동 소환 정지');
}

/** 결과 창에서 착용·분해를 고른 뒤 다시 돌린다. 소환권이 없으면 그때 멈춘다 */
function resumeAuto() {
  if (!S.autoWanted || !autoUnlocked()) return;
  if (S.eqTicket < 1) { S.autoWanted = false; S.autoSummon = false; renderForgeDock(); return; }
  S.autoSummon = true;
  save(); renderForgeDock();
}

/**
 * 자동 소환 설정. 참고 화면의 AUTO 토글을 누르면 뜨는 패널이다.
 *   멈춤 등급  이 등급 이상이 나오면 자동을 멈춘다 (equipment.json > summon filter_grade, Lv20 해금)
 *   동시 개수  한 배치에 몇 개를 여는가 (progression.pullsPerBatch 가 상한)
 */
function openAutoPanel() {
  if (!autoUnlocked()) return toast(`제작대 Lv ${unlockLv('auto_summon')} 부터 자동 소환이 열립니다`);
  const maxB = batchSize();
  // 배치는 레벨마다 +1 로 올라가므로(Lv22 면 20단계) 해금된 값을 다 버튼으로
  // 깔면 스무 개가 된다. **눈금 몇 개 + 항상 최대**만 보여 준다
  const opts = [...new Set([1, 5, 10, 25, 50, 100, 250, maxB]
    .filter(v => v >= 1 && v <= maxB))].sort((a, b) => a - b);
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
    + (S.autoWanted ? '자동 소환 정지' : '자동 소환 시작') + '</button>');

  $('#ovt').textContent = '자동 소환';
  delete $('#ovcard').dataset.skin;
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
    // 시작하면 패널을 닫는다 — 설정을 마쳤으니 볼 것은 전투 화면이지 이 창이 아니다
    stopAuto(S.autoWanted);
    if (S.autoWanted) $('#ov').classList.remove('show');
    else openAutoPanel();
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
    d.innerHTML = `<img class="lk" src="/assets/ui/UI-LOCK.png" alt=""><span>${nm}</span>`;
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

/**
 * 시간당 골드 = stageGold(최고돌파) x 156.5 x **해금 최고 배속** x 0.35
 *
 * 배속을 안 곱하던 때는 3배속으로 켜두고 파밍하는 쪽이 방치보다 8.6배를 벌었다.
 * 방치형인데 화면을 켜두는 게 이득인 구조라, offlineEfficiency 0.35 가 의도한
 * 2.9배 격차와 어긋났다 (stages.json > idleReward.speedBasisNote).
 */
function idleGold(hours) {
  const r = idleDef();
  const stageGold = Math.pow(requiredCp(S.maxStage), 1.35) * D.stages.rewards.repeatClear.gold.coefficient;
  return Math.round(stageGold * r.stagesPerHour * speedMax() * r.offlineEfficiency * hours);
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
  const src = `/assets/ui/CH-0${step}.png`;
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

/**
 * 방치 보상 수령. mult > 1 이면 광고를 먼저 끝까지 보여 준다.
 *
 * 광고는 net/ads.js 창구로만 부른다 — 지금은 SDK 가 없어 즉시 통과하지만,
 * 나중에 @verse8/ads 를 꽂을 때 호출부를 안 고치기 위해서다.
 */
async function claimIdle(mult) {
  const h = idleHours();
  if (h < 0.02) return;
  if (mult > 1 && !await playAd(AD_IDLE_DOUBLE)) return;
  const g = idleGold(h) * mult;
  S.gold += g;
  S.idle.lastClaimAt = Date.now();
  $('#idle').classList.remove('show');
  save(); renderTop(); renderChest();
  gainToast([['gold', g]]);
}

/** 광고를 끝까지 보여 주고 보상을 줘도 되는지 판정한다. 실패 사유는 토스트로 알린다 */
async function playAd(placementId) {
  const r = await showRewarded(placementId);
  if (r === AD_OK) { mq('ad'); return true; }
  toast(r === AD_SKIPPED ? '광고를 끝까지 봐야 보상이 지급됩니다' : '지금은 광고를 볼 수 없습니다');
  return false;
}

/** 2시간분을 즉시 지급. 누적 타이머는 건드리지 않는다. */
async function claimInstant(useAd) {
  idleResetIfNeeded();
  const inst = instDef();
  if (useAd) {
    if (S.idle.freeUsed < inst.freeDaily) return toast(t('무료 수령을 먼저 사용하세요'));
    if (S.idle.adUsed >= inst.adDaily) return toast(t('오늘 광고 수령을 모두 사용했습니다'));
    // 횟수는 광고를 **끝까지 본 뒤에** 깎는다. 먼저 깎으면 중간에 닫았을 때
    // 보상도 못 받고 일일 횟수만 사라진다
    if (!await playAd(AD_INSTANT_CLAIM)) return;
    S.idle.adUsed++;
  } else {
    if (S.idle.freeUsed >= inst.freeDaily) return toast(t('오늘 무료 수령을 모두 사용했습니다'));
    S.idle.freeUsed++;
  }
  const g = idleGold(inst.hoursPerClaim);
  S.gold += g;
  save(); renderTop(); openIdle();
  gainToast([['gold', g]]);
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
  mq('summon', n);

  // 소환 레벨이 오르면 확률표가 좋아지고 낮은 등급이 풀에서 영구히 빠진다
  // (gacha.json > levelEffects.gradeFloorRise). 여기가 1로 박혀 있어서 소환 레벨이
  // 통째로 죽어 있었다 — 상점은 실제 레벨의 확률을 보여 주는데 뽑기는 Lv1 로 굴렸다.
  // exp 는 이번 뽑기분을 이미 더한 뒤이므로 그만큼 빼고 구간을 고른다.
  const lv = summonProgress(tr, (S.summonExp[trackId] || 0) - n).level;
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
      // 스킬도 용병과 같다 — 등급을 먼저 굴리고 **그 등급의 스킬 중에서** 하나를 고른다.
      // 예전에는 전체 32종에서 아무거나 뽑고 등급을 따로 붙였는데, 그러면
      // gacha.json > perItemRateFormula(등급확률 / 그 등급의 종수)가 거짓말이 된다
      const pool = D.skills.skills.filter(x => x.grade === g);
      const sk = pool[(Math.random() * pool.length) | 0];
      return { grade: sk.grade, name: tn(sk.id, sk.nameKo), img: `/assets/skill/${sk.id}.png`,
               id: sk.id, kind: 'skill' };
    }
    const pool = D.characters.characters.filter(c => c.grade === g);
    const c = pool[(Math.random() * pool.length) | 0];
    return { grade: g, name: tn(c.id, c.nameKo), img: `/assets/char/${c.id}.png`,
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
    log.push({ name: tn(t.id, t.nameKo), from, to: t.level });
  }
  return log;
}

const GRADE_ORDER = ['N', 'R', 'SR', 'SSR', 'UR', 'LR'];
const gradeRank = g => GRADE_ORDER.indexOf(g);

/**
 * 소환 결과 반영 — 임시. 확정은 서버가 한다 (net/backend.js).
 *
 * **여기서는 편성도 레벨도 안 건드린다.** 새로 나온 것은 보유함(S.own)에,
 * 중복은 강화 대기열(S.pend)에 쌓기만 한다. 편성 시트의 [자동장착]·[자동강화] 를
 * 눌러야 반영된다 — 유저가 뽑기 결과에 개입하는 지점이 여기뿐이다.
 */
function applyPulls(out) {
  // 도감 등록 — 1회 획득이면 영구. 스킬은 최고 등급을 갱신한다.
  for (const g of out) {
    if (g.kind === 'skill') {
      const cur = S.codex.skill[g.id];
      if (!cur || gradeRank(g.grade) > gradeRank(cur)) S.codex.skill[g.id] = g.grade;
    } else if (!S.codex.mercenary.includes(g.id)) {
      S.codex.mercenary.push(g.id);
    }
  }

  for (const g of out) {
    const track = g.kind === 'skill' ? 'skill' : 'mercenary';
    const held = ownedOf(track).find(x => x.id === g.id);

    if (!held) {
      S.own[track].push(g.kind === 'skill'
        ? { id: g.id, nameKo: g.name, grade: g.grade, level: 0 }
        : { id: g.id, nameKo: g.name, grade: g.grade, class: g.cls, level: 0 });
    } else if (track === 'skill' && gradeRank(g.grade) > gradeRank(held.grade)) {
      // 같은 스킬의 상위 등급이 나왔다. 등급을 올리고, 밀려난 옛 등급은 **주인이 없는**
      // 잉여라 id 없이 넣는다 (등급만 올려 주고 레벨까지 얹으면 이중 보상이 된다)
      S.pend.skill.push({ id: null, grade: held.grade });
      held.grade = g.grade;
    } else {
      // 중복은 **누구의 중복인지**를 들고 간다. 그래야 그 용병 본인이 레벨업한다
      S.pend[track].push({ id: g.id, grade: g.grade });
    }
  }

  save();
  roster?.render();
  renderTop();
}

/** 장착분 + 보유함. 같은 id 가 두 번 나오지 않는다 */
function ownedOf(track) {
  const eq = track === 'skill'
    ? [...S.skills.active, ...S.skills.passive].filter(Boolean)
    : S.party.filter(Boolean);
  return [...eq, ...(S.own[track] || [])];
}

/**
 * 자동강화 — 대기열을 비우며 레벨로 바꾼다. economy.json > cascade 의 2단계 설계다.
 *
 *   1. **중복 1개 = 그 용병/스킬 본인 1레벨.** 나눗셈이 없으므로 나머지도 안 생긴다.
 *   2. 본인이 **이미 만렙**이거나 주인이 없는 잉여면 → 그때만 가치로 환산해
 *      다른 대상에게 이관한다 (cascade). 이월은 여기서만 나온다.
 *
 * 1번이 빠져 있어서 서리늑대를 또 뽑아도 서리늑대가 안 크고 엉뚱한 최강 유닛이
 * 컸다. 이월은 그 환산 과정의 찌꺼기였을 뿐이다.
 *
 * @returns 로그 [{name, from, to}]
 */
function autoEnhance(track) {
  const pend = S.pend[track] || [];
  if (!pend.length) return [];
  mq('enhance');
  const cap = track === 'skill' ? D.skills.levelCap : D.characters.levelCap;
  const logs = [];

  for (const e of pend) {
    const own = e.id ? ownedOf(track).find(x => x.id === e.id) : null;
    const room = own ? (cap[own.grade] ?? 0) - (own.level || 0) : 0;
    if (own && room > 0) {
      const from = own.level || 0;
      own.level = from + 1;
      logs.push({ name: tn(own.id, own.nameKo), from, to: own.level });
    } else {
      // 만렙이거나 주인 없음 — 버리지 않고 가치로 환산해 넘긴다
      logs.push(...cascade(track, e.grade));
    }
  }

  S.pend[track] = [];
  save();
  refreshParty();
  return logs;
}

/**
 * 자동장착이 뽑을 결과. 장착분 + 보유함을 CP 내림차순으로 정렬해 앞에서 자른다.
 * **자르는 개수는 퀘스트로 열린 칸 수다** (quests.json > slotUnlockQuests).
 * 칸을 천천히 열어 초반 성장이 계단식으로 느껴지게 하는 게 그 표의 목적이다.
 */
function bestOf(track) {
  const cpFn = track === 'skill' ? skillCp : cpOf;
  const pool = ownedOf(track).slice().sort((a, b) => cpFn(b) - cpFn(a));
  if (track !== 'skill') {
    const n = slotsOf('mercenary');
    return { party: pool.slice(0, n), rest: pool.slice(n) };
  }
  const take = (pre, n) => pool.filter(x => x.id.startsWith(pre)).slice(0, n);
  const act = take('SK-A', slotsOf('skillActive'));
  const pas = take('SK-P', slotsOf('skillPassive'));
  const on = new Set([...act, ...pas]);
  return { act, pas, rest: pool.filter(x => !on.has(x)) };
}

/**
 * 열린 칸보다 많이 장착돼 있으면 초과분을 보유함으로 되돌린다.
 *
 * 정상 플레이로는 안 생긴다 — 편성 경로가 전부 slotsOf 를 지킨다. 다만
 * quests.json > slotUnlockQuests 를 고치면 **옛 세이브가 그 상태로 남는다.**
 * 그대로 두면 잠긴 칸에 있는 유닛이 전투에 계속 참여하면서 화면에는 안 보인다.
 */
function trimToSlots() {
  const back = [];
  const cut = (arr, n) => {
    const keep = arr.filter(Boolean);
    back.push(...keep.slice(n));
    return keep.slice(0, n);
  };
  const over = S.party.filter(Boolean).length > slotsOf('mercenary');
  if (over) {
    S.party = cut(S.party, slotsOf('mercenary'));
    S.own.mercenary = [...(S.own.mercenary || []), ...back.splice(0)];
  }
  const pad = arr => Array.from({ length: 4 }, (_, i) => arr[i] || null);
  const a = cut(S.skills.active, slotsOf('skillActive'));
  const p = cut(S.skills.passive, slotsOf('skillPassive'));
  if (back.length) {
    S.skills.active = pad(a);
    S.skills.passive = pad(p);
    S.own.skill = [...(S.own.skill || []), ...back];
  }
}

/**
 * 지금 편성과 자동장착 결과가 다른가. 같으면 버튼을 비활성한다.
 *
 * **열린 칸이 하나도 없으면 무조건 비활성이다.** 안 그러면 이런 일이 난다 —
 * 칸이 0인데 뭔가 장착돼 있으면 "지금 ≠ 최적"이 성립해 버튼이 켜지고, 누르면
 * 벗기기만 실행된다. 화면은 잠긴 칸만 그리므로 유저 눈에는 아무 일도 안 일어난
 * 채 버튼만 눌린 것으로 보인다. (스킬은 퀘스트 3/9 전까지 칸이 0이라 실제로 났다.)
 */
function canAutoEquip(track) {
  const b = bestOf(track);
  const same = (a, c) => a.length === c.length && a.every((x, i) => x && c[i] && x.id === c[i].id);
  if (track !== 'skill') {
    if (slotsOf('mercenary') === 0) return false;
    return !same(S.party.filter(Boolean), b.party);
  }
  if (slotsOf('skillActive') + slotsOf('skillPassive') === 0) return false;
  return !same(S.skills.active.filter(Boolean), b.act)
      || !same(S.skills.passive.filter(Boolean), b.pas);
}

/**
 * 자동장착 — 밀려난 것은 보유함으로 돌아간다. **레벨은 그대로 따라간다.**
 * 옛 구조처럼 밀려날 때 레벨을 가치로 환급하면 편성이 흔들릴 때마다 손해가 나므로,
 * 아예 환급 경로를 안 탄다.
 */
function applyAutoEquip(track) {
  const b = bestOf(track);
  if (track === 'skill') {
    // 배열 길이는 최종 4칸 그대로 두고 열린 칸만 채운다. 잠긴 칸은 null 이라
    // 스킬바·시트가 빈칸으로 그리고, 칸이 열리면 다음 자동장착이 채운다
    const pad = arr => Array.from({ length: 4 }, (_, i) => arr[i] || null);
    S.skills.active = pad(b.act);
    S.skills.passive = pad(b.pas);
  } else {
    S.party = b.party;
  }
  S.own[track] = b.rest;
  save();
  refreshParty();
}

/**
 * 용병·스킬 탭에 빨간 점. 뽑기가 즉시 반영되지 않게 바뀌었으므로
 * **누를 게 생겼다는 신호가 없으면 유저는 시트를 안 연다** — 그러면 캐릭터가
 * 영원히 안 세진다. 강화할 게 있거나 편성이 최적이 아닐 때 켠다.
 */
function rosterWaiting(track) {
  return (S.pend?.[track] || []).length > 0 || canAutoEquip(track);
}

function renderRosterDots() {
  $('.nv[data-tab="merc"]')?.classList.toggle('hasnew', rosterWaiting('mercenary'));
  $('.nv[data-tab="skill"]')?.classList.toggle('hasnew', rosterWaiting('skill'));
}

/** 편성이 바뀐 뒤 전투 화면·상단바를 다시 맞춘다 */
function refreshParty() {
  renderSkills();
  renderCsChip();
  scene.activeSkills = S.skills.active.filter(Boolean);
  scene.captainClass = S.promoClass || 'warrior';
  scene.skillDmgMult = csSkillMult();
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

/** 지급. 시즌 장식은 보유 목록에 영구 등록하고 즉시 착용한다. */
function passGrant(g) {
  const bag = { diamond: 'dia', gold: 'gold', equip_ticket: 'eqTicket',
    speedup_5m: 'hourglass', merc_ticket: 'mercTicket', skill_ticket: 'skillTicket',
    alliance_coin: 'allyCoin' };
  const got = [];
  got.pairs = [];
  for (const [k, v] of Object.entries(g)) {
    if (bag[k] && typeof v === "number") {
      S[bag[k]] = (S[bag[k]] || 0) + v;
      got.push(`${CUR_KO[k] || k} +${num(v)}`);
      got.pairs.push([k, v]);
    } else if (k === 'profile_frame' && typeof v === 'string') {
      S.profile = S.profile || {};
      S.profile.ownedFrames = S.profile.ownedFrames || [];
      if (!S.profile.ownedFrames.includes(v)) S.profile.ownedFrames.push(v);
      S.profile.frameId = v;
    }
  }
  return got;
}

/**
 * 어느 티어의 [받기]를 눌러도 **그 트랙에서 열린 것 전부**를 받는다.
 * 티어를 하나씩 누르게 하면 20티어 = 탭 20번 — 수령이 노동이 된다.
 * 개별 수령이 필요한 경우가 없어 버튼 하나가 곧 일괄이다.
 */
function passClaim(tier, track) {
  S.pass = S.pass || { bought: false, free: [], paid: [] };
  if (track === 'paid' && !S.pass.bought) return toast(t('프리미엄을 구매하면 열립니다'));
  if (tier > passTier()) return toast(`스테이지 ${tier * D.pass.progress.tierEvery} 도달 필요`);
  const pairs = claimPassTrack(track);
  if (!pairs.length) return;
  save(); renderTop(); openPass();
  gainToast(mergePairs(pairs));
}

/** 한 트랙의 열린 티어 전부 수령. 받은 [재화, 수량] 목록을 돌려준다 */
function claimPassTrack(track) {
  const max = passTier();
  const pairs = [];
  for (let t = 1; t <= max; t++) {
    if (S.pass[track].includes(t)) continue;
    pairs.push(...passGrant(passReward(t, track)).pairs);
    S.pass[track].push(t);
  }
  return pairs;
}

/** 같은 재화를 합산한다 — 티어 12개에서 다이아가 12줄 뜨면 배너가 벽이 된다 */
function mergePairs(pairs) {
  const m = new Map();
  for (const [k, v] of pairs) m.set(k, (m.get(k) || 0) + v);
  return [...m];
}

function passClaimAll() {
  S.pass = S.pass || { bought: false, free: [], paid: [] };
  const pairs = [];
  for (const track of ['free', 'paid']) {
    if (track === 'paid' && !S.pass.bought) continue;
    pairs.push(...claimPassTrack(track));
  }
  if (!pairs.length) return toast(t('받을 것이 없습니다'));
  save(); renderTop(); openPass();
  gainToast(mergePairs(pairs));
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
      ? `<span class="ps-c"><img src="/assets/ui/${CUR_ICON2[k] || 'CU-01'}.png" alt="">${num(v)}</span>`
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

  // 제목은 짧게. 시즌 이름까지 넣으면 좁은 화면에서 잘린다 —
  // 시즌 이름은 아래 본문(진행 카드)이 이미 보여 준다
  $('#ovt').textContent = '시즌 패스';
  $('#ovcard').dataset.skin = 'pass';
  $('#ovb').innerHTML =
    `<div class="ps-top">
      <div class="ps-tinfo"><b>${cur}</b><span>/ ${P.progress.maxTier} 티어</span></div>
      <div class="ps-tnext">${cur >= P.progress.maxTier
        ? '최고 티어' : `다음 티어까지 스테이지 ${Math.max(0, nextAt - (S.maxStage || 1))}`}</div>
    </div>`
    // 전부 받기가 왼쪽, 프리미엄이 오른쪽. 매번 누르는 버튼을 엄지 쪽에 두고
    // 결제 버튼은 반대편에 둬야 오조작 결제가 안 난다
    + `<div class="ps-buy">
      <button class="mdBuy" id="psAll">전부 받기</button>
      ${S.pass.bought
        ? '<span class="ps-own">프리미엄 보유 중</span>'
        : `<button class="fgbtn" id="psBuy">프리미엄 ${numExact(P.tracks.paid.price.krw)}원</button>`}
      </div>`
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

  // 스크롤 위치를 기억한다. 150티어짜리 목록이라 닫을 때마다 현재 티어로 튕기면
  // 위쪽 미수령분을 훑던 중에 자리를 잃는다. 처음 열 때만 현재 티어를 가운데로.
  const body = $('#ovb');
  if (!body._passScrollBound) {
    body._passScrollBound = true;
    body.addEventListener('scroll', () => {
      // #ovb 는 10개 패널이 돌려 쓴다. 다른 패널이 innerHTML 을 덮으면 .ps-row 가
      // 사라지므로, 그걸 그대로 판정에 쓴다 — 따로 표식을 떼 줄 필요가 없다
      if (body.querySelector('.ps-row')) S.passScroll = body.scrollTop;
    }, { passive: true });
  }
  if (typeof S.passScroll === 'number') body.scrollTop = S.passScroll;
  else body.querySelector('.ps-row.now')?.scrollIntoView({ block: 'center' });
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
// ── 유닛 상세 ─────────────────────────────────────────────
const CLASS_KO = { warrior: '전사', archer: '궁수', mage: '마법사' };
const ELEM_KO = { fire: '불', water: '물', nature: '풀', light: '빛', dark: '암' };
const SKILL_CAT_KO = { attack: '공격', buff: '버프', survival: '생존', summon: '소환',
  stat: '능력치', special: '특수' };

/**
 * 스킬 설명 문장. skills.json 에 서술 필드가 없으므로 effect 에서 만든다 —
 * 데이터에 문장을 넣으면 수치를 고칠 때마다 문장이 낡는다. kind 가 곧 문법이다.
 */
function skillDesc(sk, level) {
  const e = sk.effect || {};
  const mult = D.skills.gradeCoef[sk.grade] * (1 + (level || 0) * 0.06)
    / (D.skills.gradeCoef[D.skills.effectScaling.baselineGrade] || 600000);
  // 피해 배율은 **퍼센트**로 쓴다 — "1.14배"는 계산을 시키고 "114%"는 그냥 읽힌다.
  // x() 는 배수 표기가 맞는 자리(쿨타임 가속처럼 속도를 곱하는 것)에만 남긴다.
  const x = v => (v * mult).toFixed(2).replace(/\.?0+$/, '');
  const atk = v => (v * mult * 100).toFixed(0) + '%';
  const pct = v => (v * mult * 100).toFixed(0) + '%';
  const rawPct = v => (v * 100).toFixed(0) + '%';
  const STAT = { atk: '공격력', def: '방어력', hp: '체력', atkSpeed: '공격 속도',
    dmgTaken: '받는 피해' };
  switch (e.kind) {
    case 'aoe_damage': return `적 ${e.targets}체에게 공격력의 ${atk(e.atkRatio)} 피해`
      + (e.burnPct ? ` + ${e.burnSec}초간 화상(${pct(e.burnPct)})` : '');
    case 'single_damage': return `적 하나에게 공격력의 ${atk(e.atkRatio)} 피해`
      + (e.slowPct ? ` + ${e.slowSec}초간 둔화 ${rawPct(e.slowPct)}` : '');
    case 'pierce_damage': return `일직선 ${e.targets}체를 관통해 공격력의 ${atk(e.atkRatio)} 피해`;
    case 'chain_damage': return `번개가 ${e.targets}체를 연쇄해 공격력의 ${atk(e.atkRatio)} 피해`
      + ` (연쇄마다 ${rawPct(e.chainFalloff)}로 감소)`;
    case 'party_buff': return `${e.durationSec}초간 아군 전체 ${STAT[e.stat] || e.stat} +${pct(e.pct)}`;
    case 'cooldown_reduce': return `${e.durationSec}초간 아군 스킬 쿨타임 ${x(e.pct)}배 가속`;
    case 'party_heal': return `아군 전체를 최대 체력의 ${pct(e.maxHpRatio)}만큼 회복`;
    case 'party_shield': return `${e.durationSec}초간 아군 전체에 최대 체력 ${pct(e.maxHpRatio)} 보호막`;
    case 'summon': return `${e.durationSec}초간 소환수 ${e.count}기 (공격력의 ${atk(e.atkRatio)}로 공격)`;
    case 'enemy_debuff': return `${e.durationSec}초간 적 전체 ${STAT[e.stat] || e.stat} +${pct(e.pct)}`;
    case 'enemy_stun': return `적 전체를 ${e.durationSec}초간 정지`;
    case 'stat_pct': return `${STAT[e.stat] || e.stat} +${pct(e.pct)}`;
    case 'crit_chance': return `치명타 확률 +${pct(e.add)}`;
    case 'crit_damage': return `치명타 피해 +${pct(e.add)}`;
    case 'evade_chance': return `회피 확률 +${pct(e.add)}`;
    case 'def_pierce': return `적 방어력 ${pct(e.pct)} 무시`;
    case 'lifesteal': return `피해의 ${pct(e.pct)}만큼 흡혈`;
    case 'reflect': return `받은 피해의 ${pct(e.pct)}를 반사`;
    case 'execute': return `체력 ${rawPct(e.hpThreshold)} 이하의 적을 ${rawPct(e.chance)} 확률로 즉시 처치`;
    case 'double_hit': return `${rawPct(e.chance)} 확률로 공격력의 ${atk(e.atkRatio)} 추가 타격`;
    case 'regen': return `초당 최대 체력의 ${(e.maxHpRatioPerSec * mult * 100).toFixed(1)}% 재생`;
    case 'revive_once': return `전투당 ${e.perBattle}회, 쓰러질 때 체력 ${pct(e.healRatio)}로 부활`;
    case 'kill_stack_atk': return `처치마다 공격력 +${rawPct(e.pctPerStack)} (최대 ${e.maxStacks}중첩)`;
    case 'damage_amplify': return `${rawPct(e.chance)} 확률로 피해 ${(e.mult * 100).toFixed(0)}%`;
    default: return '';
  }
}

/** 스킬 효과를 사람이 읽는 줄들로. 수치는 effectScaling 이 등급·레벨로 곱한 실효값 */
function skillEffectRows(sk, level) {
  const e = sk.effect || {};
  const mult = D.skills.gradeCoef[sk.grade] * (1 + (level || 0) * 0.06)
    / (D.skills.gradeCoef[D.skills.effectScaling.baselineGrade] || 600000);
  const pct = v => (v * 100).toFixed(0) + '%';
  const rows = [];
  if (e.atkRatio) rows.push(['위력', `공격력의 ${(e.atkRatio * mult * 100).toFixed(0)}%`]);
  if (e.targets) rows.push(['대상', `${e.targets}체`]);
  if (e.pct && e.stat) rows.push(['효과', `${e.stat} +${pct(e.pct * mult)}`]);
  else if (e.pct) rows.push(['효과', `+${pct(e.pct * mult)}`]);
  if (e.add) rows.push(['효과', `+${pct(e.add * mult)}`]);
  if (e.maxHpRatio) rows.push(['회복/보호', `최대 체력의 ${pct(e.maxHpRatio * mult)}`]);
  if (e.chance) rows.push(['발동 확률', pct(e.chance)]);
  if (e.durationSec) rows.push(['지속', `${e.durationSec}초`]);
  if (e.cooldownSec) rows.push(['쿨타임', `${e.cooldownSec}초`]);
  return rows;
}

/**
 * 수동 장착. 빈 칸이 있으면 거기, 꽉 찼으면 **가장 약한 장착분과 교체**한다.
 * 슬롯을 고르는 UI 는 안 만든다 — 칸 수가 4~5개라 "누굴 빼고 넣을까"의 답이
 * 사실상 최저 CP 하나뿐이고, 그걸 유저 손에 맡기면 탭이 두 번 늘 뿐이다.
 */
function equipUnit(kind, id) {
  const isSkill = kind === 'skill';
  if (isSkill) {
    const own = S.own.skill;
    const i = own.findIndex(x => x.id === id);
    if (i < 0) return;
    const it = own[i];
    const isActive = it.id.startsWith('SK-A');
    const arr = isActive ? S.skills.active : S.skills.passive;
    const slots = slotsOf(isActive ? 'skillActive' : 'skillPassive');
    if (!slots) return toast(t('아직 열린 칸이 없습니다'));
    let idx = arr.findIndex((x, k) => k < slots && !x);
    if (idx < 0) {
      // 꽉 참 — 최저 CP 와 교체
      idx = arr.slice(0, slots).reduce((m, x, k) => skillCp(arr[m]) <= skillCp(x) ? m : k, 0);
      own.push(arr[idx]);
      toast(`${tn(arr[idx].id, arr[idx].nameKo)} ↔ ${tn(it.id, it.nameKo)} 교체`);
    }
    arr[idx] = it;
    own.splice(i, 1);
  } else {
    const own = S.own.mercenary;
    const i = own.findIndex(x => x.id === id);
    if (i < 0) return;
    const it = own[i];
    const slots = slotsOf('mercenary');
    if (S.party.filter(Boolean).length >= slots) {
      const w = S.party.reduce((m, x, k) => cpOf(S.party[m]) <= cpOf(x) ? m : k, 0);
      own.push(S.party[w]);
      toast(`${S.party[w].id} ↔ ${it.id} 교체`);
      S.party[w] = it;
    } else {
      S.party.push(it);
    }
    own.splice(i, 1);
  }
  save(); refreshParty();
  if (roster.isOpen) roster.render();
}

function unequipUnit(kind, id) {
  const isSkill = kind === 'skill';
  if (isSkill) {
    for (const key of ['active', 'passive']) {
      const arr = S.skills[key];
      const i = arr.findIndex(x => x && x.id === id);
      if (i >= 0) { S.own.skill.push(arr[i]); arr[i] = null; break; }
    }
  } else {
    const i = S.party.findIndex(x => x && x.id === id);
    if (i < 0) return;
    if (S.party.filter(Boolean).length <= 1) return toast(t('마지막 용병은 해제할 수 없습니다'));
    S.own.mercenary.push(S.party[i]);
    S.party.splice(i, 1);
  }
  save(); refreshParty();
  if (roster.isOpen) roster.render();
}

// ── 프리셋 — 현재 편성 스냅샷 3칸 ───────────────────────────
function savePreset(n) {
  S.presets[n] = {
    party: S.party.filter(Boolean).map(x => x.id),
    active: S.skills.active.map(x => x && x.id),
    passive: S.skills.passive.map(x => x && x.id),
  };
  save();
  toast(`프리셋 ${n + 1} 저장`);
  if (roster.isOpen) roster.render();
}

function loadPreset(n) {
  const p = S.presets[n];
  if (!p) return toast(`프리셋 ${n + 1} 이 비어 있습니다 — [저장] 으로 현재 편성을 기록하세요`);
  // 지금 장착분을 전부 보유함에 합치고, 프리셋 id 를 그 풀에서 다시 찾는다.
  // 캐스케이드로 사라진 id 는 조용히 건너뛴다 — 남은 것만으로 최대한 복원한다
  const pool = { mercenary: [...S.party.filter(Boolean), ...S.own.mercenary],
                 skill: [...S.skills.active, ...S.skills.passive].filter(Boolean).concat(S.own.skill) };
  const take = (arr, id) => {
    const i = id ? arr.findIndex(x => x.id === id) : -1;
    return i < 0 ? null : arr.splice(i, 1)[0];
  };
  S.party = p.party.map(id => take(pool.mercenary, id)).filter(Boolean);
  S.skills.active = p.active.map(id => take(pool.skill, id));
  S.skills.passive = p.passive.map(id => take(pool.skill, id));
  S.own.mercenary = pool.mercenary;
  S.own.skill = pool.skill;
  save(); refreshParty();
  toast(`프리셋 ${n + 1} 적용`);
  if (roster.isOpen) roster.render();
}

/**
 * 유닛 상세. 용병은 도감 일러(-ART)를 크게, 스킬은 아이콘 확대.
 * 목록·도감·장착 줄 어디서든 보유한 것을 누르면 여기로 온다.
 */
function openUnitInfo(kind, id) {
  const isSkill = kind === 'skill';
  const def = isSkill
    ? D.skills.skills.find(x => x.id === id)
    : D.characters.characters.find(x => x.id === id);
  if (!def) return;
  // 장착분·보유분에서 레벨을 찾는다. 도감에만 있으면 Lv 0 취급
  const pool = isSkill
    ? [...S.skills.active, ...S.skills.passive, ...(S.own?.skill || [])]
    : [...S.party, ...(S.own?.mercenary || [])];
  const held = pool.filter(Boolean).find(x => x.id === id);
  const level = held?.level || 0;
  const cap = (isSkill ? D.skills.levelCap : D.characters.levelCap)[def.grade];

  const card = $('#unitCard');
  card.style.setProperty('--ug', GC[def.grade]);
  $('#unitName').textContent = tn(def.id, def.nameKo);
  $('#unitGrade').textContent = def.grade;

  const art = $('#unitArt'), img = $('#unitImg');
  if (isSkill) {
    art.classList.add('icon');
    img.src = `/assets/skill/${def.id}.png`;
  } else {
    art.classList.remove('icon');
    // 도감 일러가 본체다. 없으면 전투 원화로 물러난다
    img.src = `/assets/art/${def.id}-ART.png`;
    img.onerror = () => { img.onerror = null; img.src = `/assets/char/${def.id}.png`; };
  }

  const tags = isSkill
    ? [def.type === 'active' ? '액티브' : '패시브', SKILL_CAT_KO[def.category] || def.category]
    : [CLASS_KO[def.class] || def.class, ELEM_KO[def.element] || def.element];
  $('#unitTags').innerHTML = tags.map(t => `<span>${t}</span>`).join('');
  $('#unitDesc').textContent = isSkill ? skillDesc(def, level) : '';
  $('#unitDesc').style.display = isSkill ? '' : 'none';

  const rows = [];
  rows.push(['레벨', held ? `Lv ${level} / ${cap}` : '미보유 (도감 등록)']);
  rows.push(['전투력', num(isSkill ? skillCp({ grade: def.grade, level }) : cpOf({ grade: def.grade, level }))]);
  if (isSkill) rows.push(...skillEffectRows(def, level));
  $('#unitRows').innerHTML = rows.map(([k, v]) =>
    `<div class="frow"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

  // 수동 장착 — 자동장착과 별개로, 이 유닛을 콕 집어 넣고 뺀다
  const worn = isSkill
    ? [...S.skills.active, ...S.skills.passive].filter(Boolean).some(x => x.id === id)
    : S.party.filter(Boolean).some(x => x.id === id);
  const act = $('#unitAct');
  if (held) {
    act.innerHTML = worn
      ? '<button class="rt-b" id="unitEq">장착 해제</button>'
      : '<button class="rt-b go" id="unitEq">장착</button>';
    $('#unitEq').addEventListener('click', () => {
      (worn ? unequipUnit : equipUnit)(kind, id);
      openUnitInfo(kind, id);   // 버튼 상태를 새로 그린다
    });
  } else act.innerHTML = '';

  $('#unit').classList.add('show');
}

// ── 일일·주간 임무 ─────────────────────────────────────────────────
// 리셋은 05:00 KST (dayIdx 가 이미 그 오프셋을 갖고 있다).
// 주는 월요일 05:00 — dayIdx 0 이 1970-01-01 목요일이라 +3 을 더해야
// 월요일이 주 경계가 된다.
const weekIdx = t => Math.floor((dayIdx(t) + 3) / 7);

/** 행동 하나가 일일·주간 양쪽을 먹인다. id 가 dq_/wq_ 로 갈려 있어 표로 잇는다 */
const MQ_MAP = {
  enhance: ['dq_enhance', 'wq_enhance'],
  summon: ['dq_summon', 'wq_summon'],
  dungeon_enter: ['dq_dungeon'],
  dungeon_floor: ['wq_dungeon'],
  stage: ['dq_stage', 'wq_stage'],
  arena: ['dq_arena'],
  arena_win: ['wq_arena'],
  ad: ['dq_ad', 'wq_ad'],
  forge_lv: ['wq_equip_lv'],
  daily_full: ['wq_daily'],
};

/** 스킬바 옆 전직 스킬 칩. 패시브라 액티브 8칸에는 못 끼지만 "내 스킬"이긴 하다 */
function renderCsChip() {
  const el = $('#csChip');
  if (!el) return;
  const sk = csMine();
  if (!sk) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<img src="/assets/fx/${sk.fx}.png" alt=""
      onerror="this.remove()"><i>Lv ${S.promoSkillLv || 0}</i>`;
  el.title = `${sk.nameKo} — ${sk.descKo.replace('{v}',
    (csVal() * 100).toFixed(1).replace(/\.0$/, '') + '%')}`;
}

function missionState() {
  const d = dayIdx(Date.now()), w = weekIdx(Date.now());
  if (S.dq.day !== d) S.dq = { day: d, c: {}, claimed: [], full: 0 };
  if (S.wq.week !== w) S.wq = { week: w, c: {}, claimed: [] };
  return S;
}

/** 미해금 콘텐츠(아레나 Q26)의 퀘스트는 목록에서 빠지고 그만큼 만점이 낮아진다 */
const mqList = def => def.quests.filter(q => !q.unlockQuest || S.quest >= q.unlockQuest);
const mqDone = (q, c) => (c[q.id] || 0) >= q.target;
const mqPoints = (def, c) => mqList(def).reduce((a, q) => a + (mqDone(q, c) ? q.points : 0), 0);
const mqMax = def => mqList(def).reduce((a, q) => a + q.points, 0);
const mqBox = (kind) => kind === 'daily'
  ? { def: D.dailies.dailyQuests, st: S.dq }
  : { def: D.dailies.weeklyQuests, st: S.wq };

/** 받을 게 밀려 있나 — 사이드 아이콘 빨간 점 */
function mqWaiting() {
  missionState();
  for (const k of ['daily', 'weekly']) {
    const { def, st } = mqBox(k);
    const p = mqPoints(def, st.c);
    if (def.pointRewards.some(r => p >= r.points && !st.claimed.includes(r.points))) return true;
  }
  return false;
}

/** 진행도 적립. 게임 행동 쪽에서 부른다 */
function mq(action, n = 1) {
  missionState();
  for (const id of MQ_MAP[action] || []) {
    const c = id.startsWith('dq_') ? S.dq.c : S.wq.c;
    c[id] = (c[id] || 0) + n;
  }
  // 일일 만점을 **처음** 채운 순간 주간 wq_daily 에 하루를 적는다.
  // full 플래그가 없으면 그 뒤 모든 적립마다 하루씩 더 세어진다
  const dd = D.dailies.dailyQuests;
  if (!S.dq.full && mqPoints(dd, S.dq.c) >= mqMax(dd)) { S.dq.full = 1; mq('daily_full'); }
  save(); syncNav();
}

function mqClaim(kind, points) {
  const { def, st } = mqBox(kind);
  if (st.claimed.includes(points)) return;
  if (mqPoints(def, st.c) < points) return toast(t('포인트가 모자랍니다'));
  const r = def.pointRewards.find(x => x.points === points);
  if (!r) return;
  st.claimed.push(points);
  const got = passGrant(r.grant || {});
  save(); renderTop(); syncNav(); openMissions(kind);
  if (got.pairs.length) gainToast(got.pairs);
}

/**
 * 임무 창. 참고한 방치형들의 배치를 그대로 따른다 —
 * **위에 포인트 게이지와 보상 상자, 아래에 퀘스트 줄.**
 * 상자를 게이지 위 제 위치에 얹어야 "얼마 남았나"가 한눈에 읽힌다.
 * 목록만 있으면 유저는 개별 퀘스트를 보상으로 착각한다 (실제 보상은 포인트다).
 */
function openMissions(kind = 'daily') {
  missionState();
  const { def, st } = mqBox(kind);
  const list = mqList(def);
  const pts = mqPoints(def, st.c), max = mqMax(def);
  const gicons = g => Object.entries(g || {}).map(([k, v]) =>
    `<em>${CUR_ICON[k] ? `<img src="/assets/ui/${CUR_ICON[k]}.png" alt="" onerror="this.remove()">` : ''}${num(v)}</em>`
  ).join('');

  const boxes = def.pointRewards.map(r => {
    const got = st.claimed.includes(r.points);
    const can = !got && pts >= r.points;
    return `<button class="mq-box${got ? ' done' : ''}${can ? ' can' : ''}${r.highlight ? ' hi' : ''}"
      style="left:${Math.min(100, r.points / max * 100)}%"
      data-claim="${r.points}" ${can ? '' : 'disabled'}>
      <i>${got ? '✓' : r.points}</i></button>`;
  }).join('');

  const rows = list.map(q => {
    const cur = Math.min(q.target, st.c[q.id] || 0);
    const done = cur >= q.target;
    return `<div class="mq-row${done ? ' done' : ''}">
      <div class="mq-h"><b>${t(q.nameKo)}</b><span>${num(cur)}/${num(q.target)}</span></div>
      <div class="mq-bar"><i style="width:${cur / q.target * 100}%"></i></div>
      <span class="mq-p">+${q.points}</span>
    </div>`;
  }).join('');

  const nextR = def.pointRewards.find(r => !st.claimed.includes(r.points));
  $('#ovt').textContent = t('임무');
  delete $('#ovcard').dataset.skin;
  $('#ovinfo').innerHTML = '';
  $('#ovb').innerHTML = `
    <div class="mq-tabs">
      <button class="mq-t${kind === 'daily' ? ' on' : ''}" data-k="daily">${t('일일')}</button>
      <button class="mq-t${kind === 'weekly' ? ' on' : ''}" data-k="weekly">${t('주간')}</button>
    </div>
    <div class="mq-track">
      <div class="mq-gauge"><i style="width:${max ? pts / max * 100 : 0}%"></i></div>
      ${boxes}
    </div>
    <div class="mq-sum"><b>${pts}</b> / ${max} ${t('포인트')}
      <span>${nextR ? t('다음 보상까지 {0}', Math.max(0, nextR.points - pts)) : t('전부 수령')}</span></div>
    <div class="mq-rw">${def.pointRewards.map(r => `<div class="mq-rwc${
      st.claimed.includes(r.points) ? ' done' : ''}"><u>${r.points}</u>${gicons(r.grant)}</div>`).join('')}</div>
    <div class="lbl" style="margin:10px 0 6px">${kind === 'daily' ? t('오늘의 임무') : t('이번 주 임무')}</div>
    ${rows}
    <div class="sh-note">${kind === 'daily'
      ? t('매일 05:00 에 초기화됩니다')
      : t('매주 월요일 05:00 에 초기화됩니다')}</div>`;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
  $('#ovb').querySelectorAll('[data-k]').forEach(b =>
    b.addEventListener('click', () => openMissions(b.dataset.k)));
  $('#ovb').querySelectorAll('[data-claim]').forEach(b =>
    b.addEventListener('click', () => mqClaim(kind, +b.dataset.claim)));
}

/**
 * 출석 — dailies.json > attendance.
 *
 * 7일 주기 + 월 누적 28일 두 트랙이다. 7일 주기는 끊겨도 진행도가 남는다
 * (resetRule: "끊섹해도 진행도는 유지") — 끊길 때 리셋하면 복귀 유저가 더 이탈한다.
 * 월 누적은 달이 바뀌면 0에서 다시 시작하고, 수령 기록도 같이 비운다.
 */
const attendToday = () => new Date().toISOString().slice(0, 10);

// ── 이벤트 ────────────────────────────────────────────────
// 출시 7일 축제 — 출석과 같은 리듬(하루 1칸)이되 보상이 훨씬 크다.
// 데이터는 dailies.json > newbie7Day. 7칸을 다 받으면 배너가 내려간다.
const ev7Done = () => (S.ev7?.day || 0) >= D.dailies.newbie7Day.days.length;
const ev7Ready = () => !ev7Done() && S.ev7.lastAt !== attendToday();

function claimEv7() {
  if (ev7Done()) return;
  if (!ev7Ready()) return toast(t('오늘 보상은 이미 받았습니다'));
  const d = D.dailies.newbie7Day.days[S.ev7.day];
  const got = passGrant(d.grant || {});
  S.ev7.day++;
  S.ev7.lastAt = attendToday();
  save(); renderTop(); syncNav(); openEventDetail('launch7');
  if (got.pairs.length) gainToast(got.pairs);
}

// 무료 1000뽑 — 스테이지 마일스톤 자동 지급. 수령 버튼이 없다:
// 지급 자체가 자동이라야 "스테이지를 밀면 계속 나온다"로 읽힌다.
function f1kSplit(tickets, split) {
  const out = {};
  let used = 0;
  const keys = Object.keys(split);
  keys.forEach((k, i) => {
    const v = i === keys.length - 1 ? tickets - used : Math.round(tickets * split[k]);
    used += v;
    if (v > 0) out[k] = v;
  });
  return out;
}

/** 도달했지만 아직 안 받은 마일스톤들. 수령은 유저가 누른다 — 자동으로 넣으면
 * 1000뽑이 쌓이는 걸 볼 일도, 받는 손맛도 없다 (소환 레벨 보상과 같은 원칙) */
function f1kPending() {
  const out = [];
  for (const b of D.free1000.distribution) {
    for (let st = b.fromStage; st <= b.toStage; st += b.interval) {
      if (st > S.maxStage) break;
      if (!S.f1k.claimed.includes(st)) out.push({ st, b });
    }
  }
  return out;
}
const f1kPendingN = () => f1kPending().reduce((a, x) => a + x.b.ticketsPerGrant, 0);

/** 열린 것 전부 일괄 수령 — 패스의 [보상 받기]와 같은 문법 */
function f1kClaim() {
  const pend = f1kPending();
  if (!pend.length) return toast(t('받을 보상이 없습니다'));
  const sum = {};
  for (const { st, b } of pend) {
    S.f1k.claimed.push(st);
    S.f1k.total += b.ticketsPerGrant;
    const g = f1kSplit(b.ticketsPerGrant, b.split);
    for (const [k, v] of Object.entries(g)) sum[k] = (sum[k] || 0) + v;
  }
  const got = passGrant(sum);
  save(); renderTop(); syncNav(); openEventDetail('free1000');
  if (got.pairs.length) gainToast(got.pairs);
}

/** 다음 지급 스테이지와 수량. 배너·상세의 훅 문구가 이걸 쓴다 */
function f1kNext() {
  for (const b of D.free1000.distribution) {
    for (let st = b.fromStage; st <= b.toStage; st += b.interval) {
      if (!S.f1k.claimed.includes(st)) return { stage: st, n: b.ticketsPerGrant };
    }
  }
  return null;
}

/**
 * 이벤트 탭 — 배너 목록. 배너가 곧 입구다: 그림 위에 제목·진행이 얹히고,
 * 누르면 상세로 들어간다. 끝난 이벤트 배너는 회색으로 내려앉는다.
 */
function openEvents() {
  const nx = f1kNext();
  const banners = [];
  banners.push(`<button class="evb${ev7Done() ? ' end' : ''}" data-ev="launch7"
      style="--img:url(/assets/art/LR-01-ART.png)">
    <span class="evb-tag">${ev7Done() ? t('종료') : t('진행 중')}</span>
    <b>${t('출시 기념 7일 축제')}</b>
    <span class="evb-sub">${ev7Done() ? t('모든 보상을 받았습니다')
      : t('{0}일차 보상 대기', Math.min(7, S.ev7.day + 1))}</span>
    ${ev7Ready() ? `<i class="evb-dot"></i>` : ''}
  </button>`);
  const pendN = f1kPendingN();
  banners.push(`<button class="evb${nx || pendN ? '' : ' end'}" data-ev="free1000"
      style="--img:url(/assets/art/UR-01-ART.png)">
    <span class="evb-tag">${nx || pendN ? t('진행 중') : t('종료')}</span>
    <b>${t('무료 1000뽑')}</b>
    <span class="evb-sub">${pendN
      ? t('받을 수 있는 소환권 {0}장', num(pendN))
      : `${num(S.f1k.total)} / 1000${nx ? ` · ${t('다음: 스테이지 {0}', nx.stage)}` : ''}`}</span>
    <span class="evb-bar"><i style="width:${S.f1k.total / 10}%"></i></span>
    ${pendN ? `<i class="evb-dot"></i>` : ''}
  </button>`);

  $('#ovt').textContent = t('이벤트');
  delete $('#ovcard').dataset.skin;
  $('#ovh').classList.remove('has-cur');
  $('#ovinfo').innerHTML = '';
  $('#ovb').innerHTML = banners.join('');
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
  $('#ovb').querySelectorAll('[data-ev]').forEach(b =>
    b.addEventListener('click', () => openEventDetail(b.dataset.ev)));
}

function openEventDetail(id) {
  const gicons = g => Object.entries(g || {}).map(([k, v]) =>
    `<em>${CUR_ICON[k] ? `<img src="/assets/ui/${CUR_ICON[k]}.png" alt="" onerror="this.remove()">` : ''}${num(v)}</em>`
  ).join('');
  const h = [`<button class="ev-back" id="evBack">‹ ${t('이벤트 목록')}</button>`];

  if (id === 'launch7') {
    const days = D.dailies.newbie7Day.days;
    // 히어로 — 축하하는 단장 + 색종이. 이벤트는 첫 화면이 잔치처럼 보여야
    // "받을 것이 있다"가 전해진다. 색종이는 CSS 조각 12개, 절전과 무관한 창 안이다
    h.push(`<div class="ev7-hero">
      ${Array.from({ length: 12 }, (_, i) =>
        `<i class="cf c${i % 4}" style="left:${6 + i * 8}%;animation-delay:${(i * 0.37) % 2.2}s"></i>`).join('')}
      <img class="ev7-cap" src="/assets/captain/captain_face_happy.png" alt=""
        onerror="this.onerror=null;this.src='/assets/captain/captain_warrior.png'">
      <div class="ev7-ht">
        <b>${t('출시 기념 7일 축제')}</b>
        <span>${t('매일 접속해 7일간 보상을 받으세요')}</span>
        <u>${t('{0}일차 진행 중', Math.min(7, S.ev7.day + (ev7Done() ? 0 : 1)))}</u>
      </div>
    </div>`);
    // 1~6일은 3칸 x 2줄, 7일차는 한 줄 전체를 쓰는 대형 카드 — 최종 보상이
    // 목적지로 보여야 남은 날짜를 세게 된다
    const cell = (d, i, big) => {
      const done = i < S.ev7.day;
      const now = i === S.ev7.day && ev7Ready();
      return `<div class="ev7-cell${big ? ' big' : ''}${done ? ' done' : ''}${
          now ? ' now' : ''}${d.highlight ? ' hi' : ''}">
        <b>${big ? t('최종 보상 · {0}일', d.day) : t('{0}일', d.day)}</b>
        <span class="ev7-rw">${gicons(d.grant)}</span>
        ${done ? '<i>✓</i>' : ''}${now ? `<em>${t('오늘')}</em>` : ''}
      </div>`;
    };
    h.push('<div class="ev7-grid">' + days.slice(0, 6).map((d, i) => cell(d, i, false)).join('')
      + cell(days[6], 6, true) + '</div>');
    h.push(ev7Done()
      ? `<div class="sh-note">${t('모든 보상을 받았습니다')}</div>`
      : `<button class="fgbtn ev7-btn" id="ev7Claim" ${ev7Ready() ? '' : 'disabled'}>
          ${ev7Ready() ? t('{0}일차 보상 받기', S.ev7.day + 1) : t('내일 다시 받을 수 있습니다')}</button>`);
  } else {
    const F = D.free1000;
    const nx = f1kNext();
    h.push(`<div class="ev-big"><b>${num(S.f1k.total)}</b> / 1000</div>`);
    h.push(`<div class="mq-gauge" style="position:static;height:10px;margin:0 2px 10px">
      <i style="width:${S.f1k.total / 10}%"></i></div>`);
    const pend = f1kPendingN();
    h.push(pend
      ? `<button class="fgbtn" id="f1kClaim">${t('소환권 {0}장 받기', num(pend))}</button>`
      : nx
        ? `<div class="pr-note">${t('다음 지급: 스테이지 {0} (소환권 {1}장)', nx.stage, nx.n)}</div>`
        : `<div class="pr-note">${t('모든 보상을 받았습니다')}</div>`);
    h.push('<div class="lbl" style="margin:8px 0 6px">' + t('지급 구간') + '</div>');
    h.push(F.distribution.map(b => {
      const got = S.f1k.claimed.filter(st => st >= b.fromStage && st <= b.toStage).length;
      return `<div class="frow" style="padding:7px 10px;margin-bottom:5px">
        <span class="k">${b.band}</span>
        <span class="v" style="font-size:11px">${got}/${b.grants} · ${t('{0}장씩', b.ticketsPerGrant)}</span>
      </div>`;
    }).join(''));
    h.push(`<div class="sh-note">${t('스테이지를 돌파하면 보상이 열립니다. 여기서 받으세요')}</div>`);
  }

  $('#ovt').textContent = t('이벤트');
  $('#ovb').innerHTML = h.join('');
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
  $('#evBack').addEventListener('click', openEvents);
  $('#ev7Claim')?.addEventListener('click', claimEv7);
  $('#f1kClaim')?.addEventListener('click', f1kClaim);
}

function attendState() {
  const a = S.attend;
  const month = attendToday().slice(0, 7);
  if (a.month !== month) { a.month = month; a.monthDays = 0; a.cumClaimed = []; }
  return a;
}

/** 오늘 출석분을 받을 수 있나 */
const attendReady = () => attendState().lastAt !== attendToday();

function claimAttend() {
  const a = attendState();
  if (!attendReady()) return toast(t('오늘 출석은 이미 받았습니다'));
  const def = D.dailies.attendance;
  const r = def.cycle.rewards[a.day % def.cycle.lengthDays];
  const got = passGrant(r.grant || {});
  a.day = (a.day + 1) % def.cycle.lengthDays;
  a.lastAt = attendToday();
  a.monthDays++;
  save(); renderTop(); openAttend();
  if (got.pairs.length) gainToast(got.pairs); else toast(t('출석 완료'));
}

function claimAttendCum(days) {
  const a = attendState();
  const m = D.dailies.attendance.monthlyCumulative.find(x => x.days === days);
  if (!m || a.cumClaimed.includes(days) || a.monthDays < days) return;
  a.cumClaimed.push(days);
  const got = passGrant(m.grant || {});
  save(); renderTop(); openAttend();
  gainToast(got.pairs);
}

function openAttend() {
  const a = attendState();
  const def = D.dailies.attendance;
  // 보상은 글자가 아니라 **그림**으로 — 재화 아이콘 + 수량.
  // 글줄로 쓰면 칸마다 문장을 읽어야 하는데, 아이콘이면 훑기만 하면 된다
  const gicons = g => Object.entries(g || {}).map(([k, v]) =>
    `<em>${CUR_ICON[k] ? `<img src="/assets/ui/${CUR_ICON[k]}.png" alt="" onerror="this.remove()">` : ''}${num(v)}</em>`
  ).join('') || '<em>—</em>';

  const cells = def.cycle.rewards.map((r, i) => {
    const cur = i === a.day && attendReady();
    return `<div class="at-cell${i < a.day ? ' done' : ''}${cur ? ' now' : ''}${r.highlight ? ' hi' : ''}">
      <b>${i + 1}일</b>${gicons(r.grant)}${i < a.day ? '<i>✓</i>' : ''}</div>`;
  }).join('');

  const cums = def.monthlyCumulative.map(m => {
    const got = a.cumClaimed.includes(m.days);
    const can = !got && a.monthDays >= m.days;
    return `<div class="at-cum${got ? ' done' : ''}">
      <span>${m.days}일</span>${gicons(m.grant)}
      <button class="rt-b" data-cum="${m.days}" ${can ? '' : 'disabled'}>
        ${got ? '✓' : '받기'}</button></div>`;
  }).join('');

  $('#ovt').textContent = '출석';
  $('#ovcard').dataset.skin = 'attend';
  $('#ovb').innerHTML = `
    <div class="at-grid">${cells}</div>
    <button class="fgbtn" id="atClaim" ${attendReady() ? '' : 'disabled'}>
      ${attendReady() ? `${(a.day % 7) + 1}일차 출석 받기` : '오늘 출석 완료'}</button>
    <div class="lbl" style="margin:10px 0 5px">이번 달 누적 <b style="color:var(--gold)">${a.monthDays}일</b></div>
    ${cums}`;
  $('#ovinfo').innerHTML = '';
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
  $('#atClaim')?.addEventListener('click', claimAttend);
  document.querySelectorAll('[data-cum]').forEach(b =>
    b.addEventListener('click', () => claimAttendCum(+b.dataset.cum)));
}

// ── 전직 ──────────────────────────────────────────────────
// 직군 단위 승급. 게이트는 **훈련소 레벨**이다 (goldsinks > training_camp.promotion).
// 개별 용병이 아니라 직군 전체가 같이 오른다 — 32종을 하나씩 올리게 하면
// 자동편성 게임의 손맛과 어긋난다.
const promoDef = () => trainDef().promotion;
const promoTier = cls => (S.promo && S.promo[cls]) || 1;
/** 그 직군의 스탯 배수. cpOf 곱연산 항으로 들어간다 */
const promoMult = cls => {
  const t = promoDef().tiers.find(x => x.tier === promoTier(cls));
  return t ? t.statMult : 1;
};
const promoNext = cls => promoDef().tiers.find(x => x.tier === promoTier(cls) + 1);

// ── 전직 스킬 — 고른 길의 전용 패시브. 골드로 강화한다 (goldsinks > classSkills) ──
const csDef = () => promoDef().classSkills;
const csMine = () => S.promoClass && promoTier(S.promoClass) >= csDef().unlockTier
  ? csDef().skills[S.promoClass] : null;
const csVal = () => {
  const sk = csMine();
  return sk ? Math.min(sk.max, (S.promoSkillLv || 0) * sk.perLevel) : 0;
};
const csCost = () => Math.round(csDef().goldCost.base
  * Math.pow(csDef().goldCost.growth, S.promoSkillLv || 0));
/** DPS 에 곱해질 몫. 전사(공격력)와 궁수(공속)는 DPS 에서 등가다 */
const csDpsMult = () => {
  const sk = csMine();
  return sk && (sk.effect === 'party_atk' || sk.effect === 'party_atkspeed')
    ? 1 + csVal() : 1;
};
/** 스킬 피해에 곱해질 몫 (마법사) */
const csSkillMult = () => {
  const sk = csMine();
  return sk && sk.effect === 'skill_damage' ? 1 + csVal() : 1;
};

function upgradeClassSkill() {
  const sk = csMine();
  if (!sk) return;
  if ((S.promoSkillLv || 0) >= csDef().maxLevel) return toast(t('최대 레벨입니다'));
  const c = csCost();
  if (S.gold < c) return toast(`골드 ${num(c - S.gold)} 부족`);
  S.gold -= c;
  S.promoSkillLv = (S.promoSkillLv || 0) + 1;
  save(); refreshParty(); renderTop(); openPromotion();
}

function doPromote(cls) {
  // 한 길만 간다. 셋 다 올리면 "전직"이 아니라 전 직군 패시브가 된다
  if (S.promoClass && S.promoClass !== cls) return toast(t('다른 길을 걷는 중입니다'));
  const nx = promoNext(cls);
  if (!nx) return toast('이미 최종 단계입니다');
  if (S.trainLv < nx.trainLv) return toast(`훈련소 Lv ${nx.trainLv} 필요`);
  // 비용 없음 — 훈련소 레벨이 이미 값을 치렀다 (goldsinks > promotion.costNote)
  S.promo = S.promo || {};
  S.promo[cls] = nx.tier;
  S.promoClass = cls;
  save(); refreshParty(); applyCaptainClass();
  const nm = promoDef().names[cls][nx.tier - 1];
  toast(`${CLASS_KO[cls]} → ${nm}`);
}

/** 전직 초기화 — 단계·선택을 모두 되돌린다. 비용이 없으니 잃는 것도 없다 */
function resetPromotion() {
  if (!S.promoClass) return;
  S.promo = { warrior: 1, archer: 1, mage: 1 };
  S.promoClass = null;
  // 스킬 레벨은 남긴다 — 골드를 이미 태웠고, 새 길의 스킬에 그대로 이어진다.
  // 리셋할 때마다 강화가 날아가면 초기화가 벌이 된다
  save(); refreshParty(); applyCaptainClass();
  toast(t('전직을 초기화했습니다'));
  openPromotion();
}

/** 단장 모습·모션을 전직 직업으로. 전투 장면을 다시 세운다 */
function applyCaptainClass() {
  scene.captainClass = S.promoClass || 'warrior';
  scene.setParty(S.party);
}

const CLASS_IMG = { warrior: 'captain_warrior', archer: 'captain_archer', mage: 'captain_mage' };
const PROMO_COL = { 1: '#b09a7e', 2: '#5ad8ff', 3: '#ffc94a' };

/** 단계별 전용 그림(PR-cls-t). 아직 없으면 직군 기본 그림으로 떨어진다 */
const promoImg = (cls, tier) =>
  `<img src="/assets/captain/PR-${cls}-${tier}.png" alt=""
    onerror="this.onerror=null;this.src='/assets/captain/${CLASS_IMG[cls]}.png'">`;

/**
 * 전직 — 직군 카드 3장 + **단계 여정**. 지금 모습만 보여 주면 "다음이 있다"가
 * 안 읽힌다. 아래 여정 줄이 최종 단계까지의 이름·배수·조건을 미리 보여 주고,
 * 다음 단계 그림은 실루엣으로 감춰 "저게 뭐지"를 남긴다.
 */
function openPromotion() {
  const P = promoDef();
  const cards = ['warrior', 'archer', 'mage'].map(cls => {
    const cur = promoTier(cls);
    const nx = promoNext(cls);
    const canLv = nx && S.trainLv >= nx.trainLv;
    // 여정 줄 — 단계마다 미니 초상 + 이름 + 배수. 현재는 등급색, 지난 것은 체크,
    // 다음 것은 실루엣(brightness 0)이다
    const path = P.tiers.map(ti => {
      const nm = P.names[cls][ti.tier - 1];
      const state = ti.tier < cur ? 'past' : ti.tier === cur ? 'now' : 'next';
      const reach = S.trainLv >= ti.trainLv;
      return `<div class="pj-node ${state}" style="--c:${PROMO_COL[ti.tier]}">
        <span class="pj-ic">${promoImg(cls, ti.tier)}${state === 'past' ? '<i>✓</i>' : ''}</span>
        <b>${nm}</b>
        <span>×${ti.statMult.toFixed(2)}</span>
        <u>${ti.trainLv ? `${t('훈련소')} ${ti.trainLv}${reach ? ' ✓' : ''}` : t('기본')}</u>
      </div>`;
    }).join('<span class="pj-arrow">›</span>');

    const lockedOut = S.promoClass && S.promoClass !== cls;
    return `<div class="pr-card t${cur}${lockedOut ? ' out' : ''}" style="--au:${PROMO_COL[cur]}">
      ${S.promoClass === cls ? `<span class="pr-chosen">${t('나의 길')}</span>` : ''}
      <span class="pr-img">${promoImg(cls, cur)}</span>
      <b class="pr-name" style="color:${PROMO_COL[cur]}">${P.names[cls][cur - 1]}</b>
      <span class="pr-cls">${CLASS_KO[cls]} · ×${promoMult(cls).toFixed(2)}</span>
      <div class="pj-path">${path}</div>
      ${lockedOut
        ? `<span class="pr-next">${t('다른 길을 걷는 중')}</span>`
        : nx
          ? `<button class="fgbtn pr-btn" data-promo="${cls}" ${canLv ? '' : 'disabled'}>
              ${canLv ? t('{0} 로 전직', P.names[cls][nx.tier - 1])
                      : t('훈련소 Lv {0} 필요', nx.trainLv)}</button>`
          : `<span class="pr-next done">${t('최종 단계')}</span>`}
    </div>`;
  }).join('');

  $('#ovt').textContent = t('전직');
  delete $('#ovcard').dataset.skin;
  $('#ovh').classList.remove('has-cur');
  $('#ovb').innerHTML = `
    <div class="frow"><span class="k">${t('훈련소 레벨')}</span>
      <span class="v">Lv ${S.trainLv}</span></div>
    <div class="pr-note">${t('한 길만 갈 수 있습니다')} · ${t('그 직군 용병 전체가 함께 강해집니다')}</div>
    ${cards}
    ${(() => {
      const sk = csMine();
      if (!sk) return S.promoClass
        ? `<div class="pr-note">${t('전직 스킬은 2차부터 열립니다')}</div>` : '';
      const lv = S.promoSkillLv || 0, mx = csDef().maxLevel;
      const pct = v => (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
      return `<div class="cs-card" style="--au:${PROMO_COL[promoTier(S.promoClass)]}">
        <img class="cs-fx" src="/assets/fx/${sk.fx}.png" alt="" onerror="this.remove()">
        <div class="cs-body">
          <b>${sk.nameKo} <i>Lv ${lv}</i></b>
          <span>${sk.descKo.replace('{v}', pct(csVal()))}${lv < mx
            ? ` → <em>${pct(Math.min(sk.max, (lv + 1) * sk.perLevel))}</em>` : ''}</span>
        </div>
        ${lv < mx
          ? `<button class="fgbtn cs-up" id="csUp" ${S.gold < csCost() ? 'disabled' : ''}>
              <img src="/assets/ui/CU-04.png" alt=""> ${num(csCost())}</button>`
          : `<span class="pr-next done">MAX</span>`}
      </div>`;
    })()}
    ${S.promoClass ? `<button class="st-danger" id="prReset">${t('전직 초기화')}</button>` : ''}`;
  $('#ovinfo').innerHTML = `<div class="sub" style="line-height:1.55">${P.gateNote}</div>`;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
  $('#ovb').querySelectorAll('[data-promo]').forEach(bt =>
    bt.addEventListener('click', () => { doPromote(bt.dataset.promo); openPromotion(); }));
  $('#prReset')?.addEventListener('click', resetPromotion);
  $('#csUp')?.addEventListener('click', upgradeClassSkill);
}

function openTraining() {
  const def = trainDef();
  const lv = S.trainLv;
  const cost = trainingCost(def, lv);
  const bonus = trainingBonus(def, lv);
  const next = trainingBonus(def, lv + 1);
  const maxed = lv >= def.maxLevel;

  $('#ovt').textContent = '용병단 훈련소';
  $('#ovcard').dataset.skin = 'training';
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
        <img src="/assets/ui/CU-04.png" alt="">${num(cost)}</span></div>
    <button class="fgbtn" id="tcUp" ${maxed || S.gold < cost ? 'disabled' : ''}>
      ${maxed ? '최대 레벨' : '강화'}</button>
    <button class="fgbtn" id="tcUp10" style="margin-top:7px" ${maxed ? 'disabled' : ''}>
      가능한 만큼 강화</button>
    <button class="fgbtn" id="tcPromo" style="margin-top:14px">전직 보러 가기</button>`;
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
  $('#tcPromo').addEventListener('click', openPromotion);
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

/**
 * 던전 목록 — 용병·스킬과 같은 바텀시트에 담는다 (view/roster.js 의 'dungeon' 모드).
 *
 * 던전 하나가 **한 줄**이다. 2열 카드로 두면 이름·층·열쇠·요구 CP 네 가지가
 * 좁은 칸에 접혀서 어느 던전을 돌지 고를 수가 없다. 한 줄이면 층과 열쇠가
 * 같은 자리에 세로로 정렬돼 6개를 훑는 눈이 한 번만 움직인다.
 */
function dungeonHtml() {
  dgKeyRefill();
  const entries = D.dungeons.entry.dailyKeyGrant;
  const cp = totalCp();
  // 탑을 맨 위에 둔다. 던전은 일일 배출, 탑은 상한 없는 도전 —
  // 나란히 놓아야 둘의 역할 차이가 보인다.
  const T = S.tower || (S.tower = { floor: 1, best: 0 });

  return `<div id="twCard">
      <span class="tw-ico"><img src="/assets/ui/IC-TOWER.png" alt=""
        onerror="this.replaceWith(document.createTextNode('🗼'))"></span>
      <span class="nm"><b>무한의 탑</b><span>최고 ${T.best}층 · 입장 제한 없음</span></span>
      <i>${T.floor}층 ›</i>
    </div>`
    + '<div id="dungeons">'
    + D.dungeons.dungeons.map(dg => {
      const st = S.dg[dg.id] || (S.dg[dg.id] = { floor: 1 });
      const open = questDone(dg.unlockQuest);
      const need = dg.unlockCp * Math.pow(1.18, st.floor - 1);
      const yieldNow = dg.baseYield * Math.pow(1.15, st.floor - 1);
      // 던전 그림(DG-NN)은 아직 없다. 열쇠(DK-NN)와 번호를 맞춰 두고,
      // 없으면 배경(BG-NN)으로 떨어진다 — 에셋이 들어오면 코드 수정 없이 바뀐다.
      // 배경으로 떨어뜨리는 이유: 열쇠를 깔면 우측 열쇠 칩과 같은 그림이 두 번 나온다
      const n = dg.keyId.replace('DK-', '');
      return `<div class="dg${open ? '' : ' lock'}" data-id="${dg.id}"
        style="--dg-art:url(/assets/dungeon/DG-${n}.png),url(/assets/bg/${DG_BG[dg.id] || 'BG-01'}.png)">
        <span class="nm">
          <b>${dg.nameKo}</b>
          <span class="why">${open
            ? `요구 ${num(need)} · 수령 ${num(yieldNow)}`
            : dg.purpose}</span>
        </span>
        ${open
          ? `<span class="ent">${st.floor}층</span>
             <span class="keys"><img src="/assets/ui/${dg.keyId}.png" alt="열쇠"
               ><b>${dgKeysOf(dg.id)}<i>/${entries}</i></b></span>`
          : `<span class="ent lockv"><img class="lockIc" src="/assets/ui/UI-LOCK.png" alt="잠김"
             ><i>퀘스트 ${dg.unlockQuest}</i></span>`}
      </div>`;
    }).join('')
    + '</div>'
    + `<div class="sh-note">열쇠는 매일 ${entries}개로 채워진다 (광고 +${
        D.dungeons.entry.adBonus.entries}). ${D.dungeons.entry.failureCost}</div>`;
}

/** 시트에 뿌린 던전 줄에 클릭을 건다 */
function bindDungeons(root) {
  root.querySelector('#twCard')?.addEventListener('click', () => {
    roster.close();
    tower.open();
  });
  root.querySelectorAll('.dg:not(.lock)').forEach(el =>
    el.addEventListener('click', () =>
      runDungeon(D.dungeons.dungeons.find(d => d.id === el.dataset.id))));
}

function openDungeons() { roster.open('dungeon'); }

// 용병 / 스킬 편성은 바텀시트로 뺐다 (view/roster.js). 화면 60% 를 쓰고
// 전체 목록 + [자동강화]·[자동장착] 을 담아야 해서 가운데 카드로는 좁았다.

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
  $('#ovcard').dataset.skin = 'arena';
  $('#ovb').innerHTML =
    `<div class="frow"><span class="k">내 전투력</span><span class="v">${cpNum(my)}</span></div>`
    + `<div class="frow"><span class="k">점수 · 티어</span>
        <span class="v" style="font-size:12px">${S.arenaScore} · ${tierOf(S.arenaScore)}</span></div>`
    + `<div class="frow"><span class="k">투기장 훈장</span>
        <span class="v">${num(S.medal)}
          <button id="aShop" title="훈장 상점">
            <img src="/assets/ui/IC-SHOP.png" alt="" onerror="this.replaceWith(document.createTextNode('\uD83D\uDED2'))"></button>
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
  $('#ovcard').dataset.skin = 'arena';
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
/**
 * 기부 — alliance.json > contribution.donate. 골드는 두 번째 무한 골드 배수구다.
 * 일일 한도는 마을이 "매일 들를 이유"가 되는 선에서 데이터가 정한다.
 */
function donate(kind) {
  const d = D.alliance.contribution.donate[kind];
  if (!d) return;
  const a = S.allyDonate;
  const today = new Date().toISOString().slice(0, 10);
  if (a.day !== today) { a.day = today; a.gold = 0; a.eq = 0; }
  const key = kind === 'gold' ? 'gold' : 'eq';
  if (a[key] >= d.dailyLimit) return toast(t('오늘 기부 한도를 다 썼습니다'));
  if (kind === 'gold') {
    if (S.gold < d.unit) return toast(`골드가 부족합니다 (${num(d.unit)} 필요)`);
    S.gold -= d.unit;
  } else {
    if (S.eqTicket < d.unit) return toast(`장비 소환권이 부족합니다 (${d.unit}장 필요)`);
    S.eqTicket -= d.unit;
  }
  a[key]++;
  S.allyCoin = (S.allyCoin || 0) + d.coin;
  save(); renderTop(); alli.render();
  gainToast([['alliance_coin', d.coin]]);
  if ($('#ov').classList.contains('show')) openAlliance('donate');
}

/** 서버 연동 전 데모 단원. 마을 산책 봇과 같은 얼굴을 쓴다 */
const ALLY_DEMO = [
  { ava: 'SR-03', name: '펭귄대장', role: '부단장', coin: 320, on: true },
  { ava: 'R-02', name: '멍뭉이', role: '단원', coin: 210, on: true },
  { ava: 'N-03', name: '개굴개굴', role: '단원', coin: 180, on: false, last: '3시간 전' },
  { ava: 'SR-06', name: '숲사슴', role: '단원', coin: 95, on: false, last: '어제' },
];

function openAlliance(tab = 'home') {
  const A = D.alliance;
  const coin = `<img src="/assets/ui/CU-12.png" alt="" onerror="this.replaceWith(document.createTextNode('\u25C6'))">`;

  const tabs = [['home', '연합'], ['boss', '보스'], ['donate', '기부'], ['shop', '상점'], ['member', '단원']];
  const head = `<div class="al-tabs">${tabs.map(([k, n]) =>
    `<button class="al-t${k === tab ? ' on' : ''}" data-al="${k}">${n}</button>`).join('')}</div>`;

  // 길드 홈의 관례(버섯커·AFK·세나키): 엠블럼 + 이름 + Lv + 인원 + 공지 한 줄,
  // 그 아래 내 요약(코인·오늘 기부). 설계 수치 나열은 유저 화면이 아니다
  const home = () => {
    const today = new Date().toISOString().slice(0, 10);
    const dn = S.allyDonate.day === today ? S.allyDonate : { gold: 0, eq: 0 };
    const d = A.contribution.donate;
    const doneN = dn.gold + dn.eq, capN = d.gold.dailyLimit + d.equip_ticket.dailyLimit;
    return `<div class="al-hero">
        <img class="al-emblem" src="/assets/alliance/AL-04.png" alt="" onerror="this.remove()">
        <div class="al-hero-t">
          <b>냥냥 용병단 <i class="al-lv">Lv 3</i></b>
          <span>단원 ${ALLY_DEMO.length + 1} / ${A.membership.maxMembers} · 주간 기여 ${coin}${num((S.allyCoin || 0))}</span>
          <em>"매일 기부하고 주말엔 보스! (서버 연동 전 데모)"</em>
        </div>
      </div>
      <div class="al-sum">
        <div><span>내 연합 코인</span><b>${coin}${num(S.allyCoin || 0)}</b></div>
        <div><span>오늘 기부</span><b>${doneN} / ${capN}</b></div>
        <div><span>보스 단계</span><b>${(S.allyBossTier || 0) + 1}단계</b></div>
      </div>
      <button class="rt-b go" data-al-go="donate" style="width:100%;margin-top:8px">기부하러 가기</button>`;
  };

  // 보스전 관례: 보스가 화면의 주인공 + 남은 HP 바 + 내 시도 + [도전] 큰 버튼.
  // HP 계수·배수 표 같은 설계 수치는 유저 화면에서 뺐다
  const boss = () => {
    const B = A.boss;
    const tier = (S.allyBossTier || 0) + 1;
    const hpLeft = S.allyBossHp ?? 0.72;         // 데모 진행도. 서버 연동 시 컬렉션 값
    const tries = S.allyBossTries ?? 0;
    return `<div class="al-boss">
        <img src="/assets/boss/B-0${Math.min(6, tier)}.png" alt="" onerror="this.remove()">
        <div class="al-boss-t"><b>${tier}단계 심연의 군주</b>
          <span>주 ${B.attemptsPerWeek}회 도전 · ${B.resetAt} 초기화</span></div>
      </div>
      <div class="al-hpbar"><i style="width:${hpLeft * 100}%"></i>
        <b>${Math.round(hpLeft * 100)}%</b></div>
      <div class="al-sum">
        <div><span>내 도전</span><b>${tries} / ${B.attemptsPerWeek}</b></div>
        <div><span>참가 보상</span><b>${coin}${B.rewards.participation.alliance_coin}</b></div>
        <div><span>처치 보상</span><b>${coin}${B.rewards.clearBonus.alliance_coin}</b></div>
      </div>
      <button class="rt-b go" data-al-fight style="width:100%;margin-top:9px">도전 (60초 전력전)</button>
      <div class="sh-note">${B.rewards.participationNote}</div>`;
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

  // 단원 리스트 관례: 아바타 + 이름/직위 + 기여도 + 접속 표시.
  // 진짜 명단은 서버 컬렉션이다 — 그때까지 데모 주민으로 화면 문법만 세워 둔다
  const member = () =>
    `<div class="al-mem me">
       <span class="rk-ava"><img src="/assets/captain/captain_warrior.png" alt=""></span>
       <span class="al-mem-t"><b>${S.nickname || '나'}</b><i>단장</i></span>
       <span class="al-mem-c">${coin}${num(S.allyCoin || 0)}</span>
       <span class="al-on">접속 중</span></div>`
    + ALLY_DEMO.map(m => `<div class="al-mem">
       <span class="rk-ava"><img src="/assets/char/${m.ava}.png" alt=""></span>
       <span class="al-mem-t"><b>${m.name}</b><i>${m.role}</i></span>
       <span class="al-mem-c">${coin}${num(m.coin)}</span>
       <span class="al-on${m.on ? '' : ' off'}">${m.on ? '접속 중' : m.last}</span></div>`).join('')
    + '<div class="sh-note">서버 연동 전 데모 명단입니다. 실명단은 연합 컬렉션에서 온다.</div>';

  // 기부 — 마을 창고에서 온다. 보기만 하는 표가 아니라 실제 실행 버튼이다
  const donateTab = () => {
    const d = A.contribution.donate;
    const a = S.allyDonate.day === new Date().toISOString().slice(0, 10)
      ? S.allyDonate : { gold: 0, eq: 0 };
    return `<div class="frow"><span class="k">보유 연합 코인</span>
        <span class="v">${coin}${num(S.allyCoin || 0)}</span></div>
      <div class="al-dn"><div>
          <b>골드 ${num(d.gold.unit)}</b>
          <span>${coin}${d.gold.coin} · 오늘 ${a.gold}/${d.gold.dailyLimit}</span></div>
        <button class="rt-b go" data-dn="gold"
          ${a.gold >= d.gold.dailyLimit ? 'disabled' : ''}>기부</button></div>
      <div class="al-dn"><div>
          <b>장비 소환권 ${d.equip_ticket.unit}장</b>
          <span>${coin}${d.equip_ticket.coin} · 오늘 ${a.eq}/${d.equip_ticket.dailyLimit}</span></div>
        <button class="rt-b go" data-dn="equip_ticket"
          ${a.eq >= d.equip_ticket.dailyLimit ? 'disabled' : ''}>기부</button></div>
      <div class="sh-note">${A.contribution.donateNote}</div>`;
  };

  $('#ovt').textContent = '연합';
  $('#ovcard').dataset.skin = 'alliance';
  $('#ovb').innerHTML = head + ({ home, boss, donate: donateTab, shop, member }[tab] || home)();
  $('#ovb').querySelectorAll('[data-dn]').forEach(b =>
    b.addEventListener('click', () => donate(b.dataset.dn)));
  $('#ovb').querySelectorAll('[data-al-go]').forEach(b =>
    b.addEventListener('click', () => openAlliance(b.dataset.alGo)));
  $('#ovb').querySelector('[data-al-fight]')?.addEventListener('click', () =>
    toast('보스전은 서버 연동 후 열립니다 — 판정이 연합 공유 HP 라 클라 혼자 못 굴린다'));
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

// 던전 배너 그림이 없을 때 깔 배경. 테마가 가장 가까운 스테이지 배경을 쓴다.
// 열쇠 그림으로 떨어뜨리면 우측 열쇠 칩과 같은 그림이 한 줄에 두 번 나온다.
const DG_BG = {
  gold_mine: 'BG-03',        // 동굴 — 갱도
  treasure_vault: 'BG-06',   // 마왕성 — 석조 보물고
  furnace: 'BG-04',          // 화산 — 용광로
  crystal_cave: 'BG-03',     // 동굴 — 수정
  trial_tower: 'BG-06',      // 마왕성 — 탑
};

function runDungeon(dg) {
  const st = S.dg[dg.id];
  const entries = D.dungeons.entry.dailyKeyGrant;
  if (dgKeysOf(dg.id) < 1) return toast(`${dg.nameKo} 열쇠 부족 · 매일 ${entries}개 지급`);
  S.dgKeys[dg.id]--;
  mq('dungeon_enter');
  const need = dg.unlockCp * Math.pow(1.18, st.floor - 1);
  const gain = dg.baseYield * Math.pow(1.15, st.floor - 1);
  if (totalCp() < need) {
    // 실패해도 횟수는 소모된다 (dungeons.json > entry.failureCost)
    openDungeons();
    return toast(`${dg.nameKo} ${st.floor}층 실패 — CP ${num(need)} 필요`);
  }
  st.floor++;
  mq('dungeon_floor');
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
  // 완료하면 카드가 통째로 "받아라"로 바뀐다 — 진행 숫자를 그대로 두면
  // 다 찼는데도 아직 할 일처럼 읽힌다
  $('#qname').textContent = done ? `Q${def.q} 완료` : `Q${def.q} ${t.label}`;
  $('#qprog').textContent = done ? '보상 받기' : `${num(cur)}/${num(def.target)}`;
  $('#qfill').style.width = Math.min(100, cur / def.target * 100) + '%';
  // 보상 미리보기 — 담을 자리가 있는 재화만 (QUEST_CUR). 없는 키를 그리면
  // 화면에는 보이는데 눌러도 안 들어오는 유령 보상이 된다
  $('#qrw').innerHTML = Object.entries(def.rewards || {})
    .filter(([k]) => QUEST_CUR[k] && CUR_ICON[k])
    .map(([k, v]) => `<span title="${CUR_KO[k] || k} ${num(v)}">
      <img src="/assets/ui/${CUR_ICON[k]}.png" alt="" onerror="this.remove()">
      <b>${num(v)}</b></span>`).join('');
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
  // 오늘 출석을 아직 안 받았으면 점이 켜진다 — 일일 루틴의 첫 신호
  $('.side [data-s="attend"]')?.classList.toggle('hasnew', attendReady());
  renderRosterDots();
  renderMailDot();
  $('#dpsInfo').textContent = `초당 피해 ${num(partyDps())}`;
  floatCurrency();
  renderForgeDock();
  const cap = D.stages.enemyDerivation.encountersPerStage;
  if ($('#enc').children.length !== cap + 1) {
    $('#enc').innerHTML = Array.from({ length: cap + 1 },
      (_, i) => `<i class="dotw ${i === cap ? 'boss' : ''}"></i>`).join('');
  }
}

/**
 * 조우 진행 표시. 지나온 것은 채우고(on), **지금 하는 것 위에 화살표**를 둔다.
 * 점만 있으면 "몇 번째를 하는 중"이 안 읽혔다 — 채워진 마지막 점과 다음 점의
 * 경계가 곧 현재 위치다.
 */
const markEncounter = i =>
  document.querySelectorAll('#enc .dotw').forEach((e, k) => {
    e.classList.toggle('on', k <= i);
    e.classList.toggle('now', k === i + 1);
  });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 1400);
}

/** 재화 id → 아이콘. 획득 배너·우편 등 공용 */
const CUR_ICON = {
  diamond: 'CU-01', gold: 'CU-04', merc_ticket: 'CU-05', skill_ticket: 'CU-06',
  equip_ticket: 'CU-07', speedup_5m: 'CU-10', arena_medal: 'CU-11', alliance_coin: 'CU-12',
};

/**
 * 획득 배너 — 상단에서 내려와 쌓이는 [아이콘 이름 +수량] 줄.
 * "무엇을 받았다"는 전부 이걸로 띄운다. 문장형 안내만 toast() 로 남는다.
 * @param pairs [[curId, qty], ...] 또는 [[curId, qty, label]] (label 이 이름을 대체)
 */
function gainToast(pairs) {
  const box = $('#gains');
  for (const [id, qty, label] of pairs) {
    if (!qty) continue;
    const el = document.createElement('div');
    el.className = 'gain';
    const ic = CUR_ICON[id];
    el.innerHTML = (ic ? `<img src="/assets/ui/${ic}.png" alt="" onerror="this.remove()">` : '')
      + `<i>${label || CUR_KO[id] || id}</i> +${num(qty)}`;
    el.addEventListener('animationend', e => { if (e.animationName === 'gainOut') el.remove(); });
    box.appendChild(el);
  }
  // 폭주 방지 — 6줄 넘으면 오래된 것부터 지운다
  while (box.children.length > 6) box.firstChild.remove();
}

/**
 * 벽 안내 — 보스에 진 직후, 왜 막혔고 무엇을 하면 뚫리는지.
 *
 * 데이터는 전부 이미 있었다 (stages.json > curve.walls 의 gates,
 * wallEscapeValves). 화면에 안 꺼내면 유저는 스테이지 번호와 CP 만 보고
 * "왜 안 되지"에서 끝난다 — 벽에서 할 일이 안 보이면 이탈한다
 * (wallEscapeValvesNote).
 */
function showWallHint() {
  const need = requiredCp(S.stage);
  const my = totalCp();
  // 다음 벽 정보. 지금 스테이지가 벽이면 그 벽의 gates 를 띄운다
  const wall = D.stages.curve.walls?.[String(S.stage)];
  const pct = Math.min(100, my / need * 100);
  // 탈출구 — 화면에서 바로 열 수 있는 세 개만 추린다
  const valves = [
    { label: '훈련소 (골드로 전 용병 강화)', go: () => openTraining() },
    { label: '장비 소환 — 제작대', go: () => openForge() },
    { label: '던전 (재화 수급)', go: () => openDungeons() },
  ];
  $('#wallNeed').textContent = num(need);
  $('#wallMy').textContent = num(my);
  $('#wallMy').style.color = my >= need ? 'var(--txt)' : 'var(--warn)';
  $('#wallBar').style.width = pct + '%';
  $('#wallGate').textContent = wall?.gates ? `이 구간: ${wall.gates}` : '';
  const box = $('#wallGo');
  box.innerHTML = '';
  valves.forEach(v => {
    const b = document.createElement('button');
    b.textContent = v.label;
    b.addEventListener('click', () => { $('#wall').classList.remove('show'); v.go(); });
    box.appendChild(b);
  });
  $('#wall').classList.add('show');
  clearTimeout($('#wall')._t);
  // 자동으로 닫지 않는다 — 읽는 속도는 사람마다 다르다. 탭하면 닫힌다
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

/** 지금 제작대 레벨의 장비 등급 확률. gacha.json > equipmentRateBands */
function eqBandNow(lv = S.forgeLv) {
  const bs = D.gacha.equipmentRateBands.bands;
  return bs.find(b => lv >= b.minLevel && lv <= b.maxLevel) || bs[bs.length - 1];
}

/** 확률창에서 보고 있는 구간. null 이면 내 레벨 구간부터 연다 */
let fgRateIdx = null;
// 표의 원본은 소수점 넷째 자리까지다(합이 정확히 100 이 되게). 화면에는 줄인다 —
// 1% 미만은 자릿수가 곧 정보라 세 자리, 그 위는 두 자리
const fgPct = v => (v < 1 ? +v.toFixed(3) : +v.toFixed(2));

/**
 * 제작대 레벨별 확률. **한 번에 한 구간**만 보여 주고 ‹ › 로 넘긴다 —
 * 15개 구간을 한 번에 펴면 스크롤만 길고 정작 지금 확률이 안 읽힌다.
 * 확률은 공시 의무 대상이라 전 구간에 닿을 수 있어야 하고, 그 통로가 화살표다.
 */
function openForgeRates(idx) {
  const bands = D.gacha.equipmentRateBands.bands;
  const mine = Math.max(0, bands.findIndex(b => S.forgeLv >= b.minLevel && S.forgeLv <= b.maxLevel));
  fgRateIdx = Math.max(0, Math.min(bands.length - 1, idx ?? mine));
  const b = bands[fgRateIdx];
  const now = fgRateIdx === mine;
  const nSlots = D.equipment.slots.length;
  // 레벨당 1행이라 화살표만 두면 다음 해금까지 수십 번을 눌러야 한다
  const ji = bands.findIndex((x, i) => i > fgRateIdx && x.unlocks);
  const jump = ji >= 0 ? { i: ji, b: bands[ji] } : null;
  // 낮은 등급이 위다. 표를 읽는 사람은 "내가 주로 받는 것"부터 보고
  // 아래로 내려가며 희귀도가 오르는 순서를 기대한다
  const rows = Object.entries(b.rates)
    .filter(([, v]) => v > 0)
    .sort((x, y) => +x[0] - +y[0])
    .map(([t, v]) => {
      const g = D.equipment.grades[+t - 1];
      // 부위는 균등 추첨이므로 개별 확률 = 등급 확률 / 부위 수
      const per = v / nSlots;
      return `<div class="sm-g"><i style="background:${g.color}"></i>
        <b style="color:${g.color}">${g.nameKo}</b>
        <span class="sm-p">${fgPct(v)}%</span>
        <span class="sm-e">부위당 ${fgPct(per)}%</span></div>`;
    }).join('');

  const ttl = $('#smTitle');
  if (ttl) ttl.textContent = '제작대 확률';
  $('#smBody').innerHTML = `
    <div class="fr-nav">
      <button class="fr-a" data-d="-1" ${fgRateIdx === 0 ? 'disabled' : ''}
        aria-label="이전 구간">‹</button>
      <span class="fr-lv"><b>Lv ${b.minLevel === b.maxLevel
        ? b.minLevel : `${b.minLevel}~${b.maxLevel}`}</b>
        ${now ? '<i>현재</i>' : ''}</span>
      <button class="fr-a" data-d="1" ${fgRateIdx === bands.length - 1 ? 'disabled' : ''}
        aria-label="다음 구간">›</button>
    </div>
    ${b.unlocks ? `<div class="fr-unlock" style="--c:${D.equipment.grades[b.unlocks - 1].color}">
        <b>${D.equipment.grades[b.unlocks - 1].nameKo}</b> 등급이 이 레벨에서 열린다</div>` : ''}
    <div class="sm-now fr-rows">${rows}</div>
    ${jump ? `<button class="fr-jump" data-j="${jump.i}">
        다음 해금 <b style="color:${D.equipment.grades[jump.b.unlocks - 1].color}">${
          D.equipment.grades[jump.b.unlocks - 1].nameKo}</b> · Lv ${jump.b.minLevel} 로</button>` : ''}
    ${now ? '' : `<button class="fr-jump" data-j="${mine}">내 제작대 Lv ${S.forgeLv} 로</button>`}
    <div class="sh-note">${D.gacha.perItemRateFormula.legalRequirement}<br>
      부위 확률 = 등급 확률 ÷ 부위 ${nSlots}종 (부위는 균등 추첨)</div>`;
  $('#smBody').querySelectorAll('.fr-a').forEach(el => el.addEventListener('click',
    () => openForgeRates(fgRateIdx + +el.dataset.d)));
  $('#smBody').querySelectorAll('.fr-jump').forEach(el => el.addEventListener('click',
    () => openForgeRates(+el.dataset.j)));
  $('#smPop').classList.add('show');
}

function openForge() {
  const next = S.forgeLv + 1;
  const c = forgeCost(next);
  const running = !!S.forgeStart;
  const vis = forgeStageAsset();
  const stageNo = vis ? vis.stage : 1;
  const pct = running ? (1 - forgeRemain() / forgeCost(S.forgeTarget).sec) * 100
    : (S.forgePaid || 0) / (c ? c.parts : 1) * 100;

  const cur = n => `<img src="/assets/ui/${n}.png" alt="">`;
  const h = [];

  // 제작대 이미지를 누르면 장비를 소환한다
  h.push(`<div id="fgHero">
      <img src="/assets/ui/FG-0${stageNo}.png" alt="" id="fgSummon" title="탭하여 장비 소환">
      <button id="fgLvBadge" title="이 레벨의 장비 등급 확률">Lv ${S.forgeLv} <i>ⓘ</i></button>
      <span id="fgHeroSpark"></span>
      <div id="fgStage">${stageNo}단계 대장간 · ${vis ? vis.levelRange : ''} 구간</div>
    </div>`);

  // 소환 버튼. 제작대 그림을 탭해도 같지만, 탭만으로는 눌러도 되는 건지 안 읽힌다
  h.push(`<div class="fg-pull">
    <button class="fgbtn" id="fgP1" ${S.eqTicket < 1 ? 'disabled' : ''}>1회 소환
      <em>${cur('CU-07')}1</em></button>
  </div>`);


  if (running) {
    h.push(`<div id="fgProg"><div id="fgProgFill" style="width:${pct}%"></div></div>`);
    const can = Math.min(S.hourglass || 0, Math.ceil(forgeRemain() / 300));
    const use = Math.max(1, Math.min(S.hgUse || 1, can));
    // 남은 시간 옆에서 바로 단축을 연다. 항상 펼쳐 두면 대기 중에도 자리를 먹는다.
    h.push(`<div class="frow"><span class="k">Lv ${S.forgeTarget} 제작 중</span>
      <span class="v" id="fgLeft">${dur(forgeRemain())}</span>
      <button class="hg-open" id="fgHgOpen"
        ${can < 1 ? 'disabled' : ''}>${cur('CU-10')} 사용</button></div>`);

    // 사용 UI 는 별도 창(#hgPop)에서 연다 — 인라인으로 펼치면 제작대 카드가
    // 늘었다 줄었다 하며 아래 내용이 밀린다
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
  delete $('#ovcard').dataset.skin;
  // 모래시계는 이 화면에서만 쓰는 재화다. 헤더에 두면 본문이 안 밀린다.
  $('#ovh').classList.add('has-cur');
  $('#ovcur').innerHTML = `${cur('CU-10')}<b>${num(S.hourglass || 0)}</b>`;
  $('#ovb').innerHTML = h.join('');
  $('#ovinfo').innerHTML = '<div class="lbl" style="margin-bottom:6px">해금 현황</div>'
    + D.equipment.summon.progression.map(p => {
      const on = p.summonLv <= S.forgeLv;
      return `<div class="frow" style="opacity:${on ? 1 : .42};padding:6px 10px;margin-bottom:5px">
        <span class="k">Lv ${p.summonLv}</span>
        <span class="v" style="font-size:11px">${p.nameKo || p.unlock}</span>
        <span>${on ? '✅' : `<img class="lockIc" src="/assets/ui/UI-LOCK.png" alt="잠김">`}</span></div>`;
    }).join('');
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

  $('#fgSummon')?.addEventListener('click', () => pullOne('#fgHero'));
  $('#fgP1')?.addEventListener('click', () => pullOne('#fgHero'));
  // 레벨 배지를 누르면 이 레벨의 등급 확률을 편다. 제작대는 확률이 레벨로
  // 갈리는데(equipmentRateBands) 그 값을 볼 데가 없었다
  $('#fgLvBadge')?.addEventListener('click', e => { e.stopPropagation(); openForgeRates(); });
  $('#fgPayBtn')?.addEventListener('click', payForge);
  $('#fgHgOpen')?.addEventListener('click', openHourglass);
}

/** 모래시계로 줄일 수 있는 최대 개수. 보유량과 남은 시간 둘 다에 걸린다 */
const hgCan = () => Math.min(S.hourglass || 0, Math.ceil(forgeRemain() / 300));

/**
 * 시간 단축 창. 제작대 위에 겹쳐 뜬다 — 제작대 본문에 펼치면 카드 높이가
 * 바뀌면서 아래 항목이 밀려 손가락이 엉뚱한 걸 누른다.
 */
function openHourglass() {
  const can = hgCan();
  if (can < 1) return toast('모래시계가 없습니다');
  const use = Math.max(1, Math.min(S.hgUse || 1, can));
  $('#hgBody').innerHTML = `
    <div class="hg-left"><span>남은 시간</span><b>${dur(forgeRemain())}</b></div>
    <div class="hg-left"><span>보유 모래시계</span>
      <b>${num(S.hourglass || 0)}</b></div>
    <div class="hg-row">
      <button class="hg-step" data-hgd="-10">‹‹</button>
      <button class="hg-step" data-hgd="-1">‹</button>
      <span class="hg-val">${use}<i>/ ${can}</i></span>
      <button class="hg-step" data-hgd="1">›</button>
      <button class="hg-step" data-hgd="10">››</button>
      <button class="hg-max ${use === can ? 'on' : ''}" data-hgm="1">MAX</button>
    </div>
    <button class="fgbtn" id="fgHgUse" style="margin-top:10px">
      ${cur('CU-10')} ${use}개 · ${dur(use * 300)} 단축</button>`;
  $('#hgBody').querySelectorAll('[data-hgd]').forEach(x =>
    x.addEventListener('click', () => {
      S.hgUse = Math.max(1, Math.min(hgCan(), (S.hgUse || 1) + (+x.dataset.hgd)));
      openHourglass();
    }));
  $('#hgBody').querySelector('[data-hgm]')?.addEventListener('click', () => {
    S.hgUse = hgCan(); openHourglass();
  });
  $('#fgHgUse')?.addEventListener('click', () => {
    useHourglass(Math.max(1, Math.min(S.hgUse || 1, hgCan())));
    // 다 쓰면 창을 닫는다. 남았으면 갱신해서 이어 쓸 수 있게 둔다
    if (hgCan() < 1) closeHourglass(); else openHourglass();
  });
  $('#hgPop').classList.add('show');
}

const closeHourglass = () => $('#hgPop').classList.remove('show');

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

const cur = n => `<img src="/assets/ui/${n}.png" alt="" class="cui">`;

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
      <span class="ei-ic fre-${Math.min(3, eqBand(it.tier))}"
        style="border-color:${g.color}">${eqImg(sl, it.tier)}></span>
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
  delete $('#ovcard').dataset.skin;
  $('#ovb').innerHTML = h.join('');
  $('#ovinfo').innerHTML = '';
  $('#ov').classList.add('show', 'forced');   // 닫기 없음 — 반드시 고른다

  const finish = (wear) => {
    const drop = wear ? S.equip[it.slot] : it;
    if (wear) S.equip[it.slot] = it;
    if (drop) S.gold += scrapGold(drop.tier);
    $('#ov').classList.remove('show', 'forced');
    save(); renderEquip(); renderTop(); renderForgeDock();
    scene.partyDps = partyDps();
    // 착용은 토스트를 안 띄운다 — CP 상승은 상단 CP 배지(+n ▲)가 이미 알린다.
    // 분해만 획득 배너
    if (!wear) gainToast([['gold', scrapGold(it.tier)]]);
    if (S.eqPending === it) S.eqPending = null;   // 불빛을 끈다
    renderForgeDock();
    resumeAuto();          // 자동을 켜 둔 상태였으면 여기서 다시 돈다
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
    // 일시정지다. autoWanted 는 그대로 두고, 결과를 고르면 resumeAuto() 가 다시 돌린다
    S.autoSummon = false;
    const g = D.equipment.grades[stopHit.tier - 1];
    // 멈춘 시점 이후로 안 돌린 만큼은 소환권을 돌려준다
    const used = kept + scrapped + 1;
    if (used < n) S.eqTicket += n - used;
    // 창을 강제로 띄우지 않는다 — 방치형인데 화면을 가로채면 자동의 의미가 없다.
    // 제작대에 불빛만 남기고, 유저가 눌렀을 때 보여 준다
    S.eqPending = stopHit;
    save(); renderEquip(); renderTop(); renderForgeDock();
    toast(`${g.nameKo} 등장 · 제작대에서 확인`);
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
                 img: `/assets/equip/${eqIcon(sl, it.tier)}.png` };
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
  scene.captainClass = S.promoClass || 'warrior';
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
  $('#vsBossImg').src = `/assets/boss/${id}.png`;
  $('#vsCapImg').src = '/assets/captain/captain_warrior.png';
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

/** 이 스테이지 1회 클리어의 골드 총액 (stages.json > rewards.repeatClear.gold) */
function stageGold(n = S.stage) {
  const g = D.stages.rewards.repeatClear.gold;
  return Math.pow(requiredCp(n), g.exponent) * g.coefficient;
}

function onEvent(e) {
  if (e.type === 'kill') {
    // 누적 처치. 퀘스트 진행도라 렌더까지 해야 배너가 즉시 찬다
    S.kills = (S.kills || 0) + 1;
    // 잡몹도 골드를 준다. 보스만 주면 벽에 막힌 유저의 수입이 0 이 되고,
    // 절전으로 밤새 돌려도 획득 골드가 0 이다 (gold.splitNote)
    const g = D.stages.rewards.repeatClear.gold;
    S.gold += Math.round(stageGold() * g.split.mobs / g.mobsPerStage);
    renderTop();
    renderQuest();
    return;
  }
  if (e.type === 'skillCast') {
    // 자동 발동이 보이게 — 시전된 칸에 쿨타임 와이프를 돌린다.
    // 원뿔 그라데이션 각도를 CSS 변수로 깎는 rAF 하나. 칸당 동시 1개
    const cell = document.querySelector(`#skills .sk[data-sid="${e.id}"]`);
    if (cell) {
      cell.classList.add('cool');
      const t0 = performance.now(), dur = e.sec * 1000;
      cancelAnimationFrame(cell._cdRaf);
      const step = now => {
        const p = Math.min(1, (now - t0) / dur);
        cell.style.setProperty('--cd', (360 - p * 360) + 'deg');
        if (p < 1) cell._cdRaf = requestAnimationFrame(step);
        else { cell.classList.remove('cool'); cell.classList.add('flash');
               setTimeout(() => cell.classList.remove('flash'), 500); }
      };
      cell._cdRaf = requestAnimationFrame(step);
    }
    return;
  }
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
    // 보스 몫만. 잡몹 몫은 처치할 때마다 이미 들어갔다
    S.gold += Math.round(stageGold() * D.stages.rewards.repeatClear.gold.split.boss);
    mq('stage');
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
    // 실패 표시가 걷힌 뒤 벽 안내를 띄운다. 동시에 뜨면 서로 가린다
    setTimeout(showWallHint, 1600);
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
// 시작 편성은 **열린 칸 수만큼만** 만든다 (quests.json > slotUnlockQuests).
// 시작 3칸이며 Q8 에 4칸, Q20 에 5칸으로 늘어난다.
function rollParty() {
  const pool = [...D.characters.characters];
  S.party = Array.from({ length: slotsOf('mercenary') }, () => {
    const c = pool.splice((Math.random() * pool.length) | 0, 1)[0];
    return { id: c.id, nameKo: c.nameKo, grade: c.grade, class: c.class, level: 0 };
  });
}

function rollSkills() {
  const act = D.skills.skills.filter(s => s.id.startsWith('SK-A'));
  const pas = D.skills.skills.filter(s => s.id.startsWith('SK-P'));
  // 배열은 최종 4칸, 채우는 건 열린 칸까지. 스킬 소환 자체가 Q2·Q3 해금이라
  // 시작 시점(Q0)에는 액티브·패시브 둘 다 0칸인 것이 정상이다
  const take = (src, owned) => Array.from({ length: 4 }, (_, i) => {
    if (i >= owned) return null;
    const s = src[(Math.random() * src.length) | 0];
    // 등급은 스킬 종류에 고정이다 (skills.json > meta.gradeIsFixed).
    // 예전에는 여기서 'R' 을 박아 첫 스킬이 항상 R 이었다
    return { id: s.id, nameKo: s.nameKo, grade: s.grade, level: 0 };
  });
  S.skills.active = take(act, slotsOf('skillActive'));
  S.skills.passive = take(pas, slotsOf('skillPassive'));
}

/**
 * 부트 진행 표시. 문구는 단계 설명이 아니라 **게임 세계의 소리**다 —
 * "데이터 로드 중" 같은 개발자 말은 분위기를 깬다.
 */
const BOOT_FLAVOR = [
  '냥이들을 낮잠에서 깨우는 중…',
  '수염을 고르게 빗는 중…',
  '활시위를 팽팽하게 당겨 보는 중…',
  '방패에 묻은 생선 냄새를 닦는 중…',
  '보급 수레에 츄르를 싣는 중…',
  '단장의 망토를 다림질하는 중…',
  '초원의 슬라임에게 선전포고하는 중…',
];
let bootFlavorI = (Math.random() * BOOT_FLAVOR.length) | 0;
function bootStep(pct, msg) {
  const f = $('#bootFill'), m = $('#bootMsg');
  if (f) f.style.width = pct + '%';
  // msg 를 안 주면 플레이버를 순환한다
  if (m) m.textContent = msg || BOOT_FLAVOR[bootFlavorI++ % BOOT_FLAVOR.length];
}

/**
 * 언어 선택 — 첫 실행(세이브에 lang 없음)에만 로딩 끝에 뜬다.
 * 실제 번역은 아직 없다 — 지금은 선택을 저장만 하고 전부 한국어로 그린다.
 * 문구를 t() 로 감싸는 i18n 작업은 별도 결정(보류 목록) 뒤에 한다.
 */
function bootLangPick() {
  return new Promise(res => {
    const box = $('#bootLang');
    // 이미 고른 적 있으면 그 사전만 불러오고 넘어간다
    if (S.lang) return loadLang(S.lang).then(res);
    // 버튼은 i18n 의 LANGS 가 만든다 — 언어를 늘릴 때 HTML 을 안 고쳐도 된다
    const btns = box.querySelector('#bootLangBtns');
    btns.innerHTML = LANGS.map(l => `<button data-lang="${l.id}">${l.label}</button>`).join('');
    box.classList.add('show');
    btns.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', async () => {
      S.lang = b.dataset.lang;
      save();
      await loadLang(S.lang);
      box.classList.remove('show');
      res();
    }));
  });
}

(async function boot() {
  // 광고 SDK 는 데이터 로드보다 먼저 건다 — 호스트 메시지 리스너를 일찍 걸수록
  // 핸드셰이크가 unsupported 로 굳을 창이 좁아진다 (net/ads.js > initAds)
  initAds();

  bootStep(12);
  // **세이브를 먼저 읽는다.** 언어 선택은 S.lang 을 보고 "첫 실행인지"를 판단하는데,
  // load() 앞에서 물으면 S.lang 이 늘 비어 있어 매번 다시 묻고 거기서 멈춘다.
  // localStorage 라 동기이고, loadData 보다 앞서도 안전하다
  load();
  await bootLangPick();
  await loadData('/data');
  $('#cap').src = '/assets/captain/captain_warrior.png';

  // load() 는 위(언어 선택 앞)에서 이미 했다. 아래는 읽은 값의 유효성 검사다.
  // 배속 오염 방어. NaN 이 JSON 을 거치면 null 이 되고, 그대로 scene.speed 에
  // 들어가면 전투가 0배속으로 영영 멈춘다 — 유효값(1·2·3) 아니면 1로 되돌린다
  if (![1, 2, 3].includes(S.speed)) S.speed = 1;
  if (!Array.isArray(S.presets) || S.presets.length !== 3) S.presets = [null, null, null];
  if (!S.attend) S.attend = { day: 0, lastAt: null, month: null, monthDays: 0, cumClaimed: [] };
  // 세이브를 읽은 직후에 한 번 — 잠긴 칸에 남아 있는 유닛을 보유함으로 되돌린다
  trimToSlots();
  if (!S.party.length) {
    rollParty(); rollSkills();
    for (const p of S.party) if (!S.codex.mercenary.includes(p.id)) S.codex.mercenary.push(p.id);
    for (const s of [...S.skills.active, ...S.skills.passive]) if (s) S.codex.skill[s.id] = s.grade;
  }

  bootStep(38);
  reveal = new SummonReveal($('#app'));
  roster = new RosterSheet({
    state: S, data: D, cpOf, skillCp, toast, openUnitInfo, savePreset, loadPreset,
    enhance: autoEnhance, equip: applyAutoEquip, canEquip: canAutoEquip,
    dungeonHtml, bindDungeons, slotsOf,
  });
  codex = new CodexScreen($('#app'), { state: S, data: D, openUnitInfo });
  alli = new AllianceVillage($('#app'), {
    state: S, data: D, toast, num,
    // 건물 → 패널. 마을(fullscr z70)이 열려 있으므로 패널을 그 위로 띄운다
    openPanel: b => { $('#ov').classList.add('over-alli'); openAlliance(b); },
  });
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
    // 다이아 -> 골드 빠른 구매. 액수는 방치 공식 그대로다 (idleGold) —
    // 별도 표를 두면 스테이지가 오를 때마다 갈라진다
    quickGold: hours => idleGold(hours),
    buyEquipTicket: (count, dia) => {
      if (S.dia < dia) { toast(`다이아 ${num(dia - S.dia)} 부족`); return false; }
      S.dia -= dia;
      S.eqTicket += count;
      save(); renderTop(); renderForgeDock();
      gainToast([['equip_ticket', count]]);
      return true;
    },
    buyGold: (hours, dia) => {
      if (S.dia < dia) { toast(`다이아 ${num(dia - S.dia)} 부족`); return false; }
      S.dia -= dia;
      const g = idleGold(hours);
      S.gold += g;
      save(); renderTop();
      gainToast([['gold', g]]);
      return true;
    },
    state: S, data: D, toast,
    pull: (trackId, n) => pull(trackId, n),
    buySpeed3, claimSpeed3Daily,
  });
  bootStep(55);
  scene = new BattleScene($('#cv'), { data: D, onEvent });
  window.__scene = scene;   // 디버그용
  window.__S = S;
  window.__wall = showWallHint;   // 디버그용 — 벽 안내를 손으로 띄워 본다
  await scene.init();
  bootStep(82);

  renderSkills(); renderCsChip(); renderEquip(); renderQuest(); renderCaptain(); renderTop();
  // 세이브의 배속을 화면에 반영 + 해금 안 된 값이면 끌어내린다
  if (scene) scene.speed = Math.min(S.speed || 1, speedMax());
  syncSpeedBtns();
  renderNavLocks();
  // 닉네임이 없으면 아무거나 붙여 준다. 유저는 나중에 한 번 공짜로 바꾼다.
  if (!S.nickname) { S.nickname = autoNickname(); save(); }
  seedMail();
  renderChest();

  // ⚠️ runStage() 는 **여기서 await 하지 않는다.**
  // 첫 전투가 끝나야 아래 버튼들이 붙는 구조였는데, 스테이지가 올라갈수록 전투가
  // 길어져 고스테이지 세이브에서는 수십 초 동안 화면이 먹통이었다. 전투는 배선이
  // 다 끝난 뒤(부트 맨 끝)에 띄운다.

  // [data-sp] 한정 — 절전 버튼(#pwrSave)도 #speed 안의 .sbtn 이다. 전체에 걸면
  // 절전 클릭이 +undefined = NaN 을 배속에 넣어 전투가 0배속으로 죽는다 (실제로 났다)
  document.querySelectorAll('#speed .sbtn[data-sp]').forEach(b => b.addEventListener('click', () => {
    const sp = +b.dataset.sp;
    // 잠긴 배속은 고르는 대신 **무엇을 해야 열리는지** 알린다.
    // 버튼을 아예 숨기면 해금이 보상으로 안 읽혀서, 눌리되 안 바뀌는 쪽으로 뒀다
    if (sp > speedMax()) return toast(speedHint(sp));
    scene.speed = sp;
    S.speed = sp;
    save(); syncSpeedBtns();
  }));

  // 제작대 오브젝트 = 수동 1회 소환. 참고 화면과 같은 조작이다.
  $('#bossGo').addEventListener('click', challengeBoss);
  $('#fgObj').addEventListener('click', () => {
    // 대기 중인 장비가 있으면 소환이 아니라 그것부터 보여 준다
    if (S.eqPending) return openEquipResult(S.eqPending);
    pullOne('#fgObj');                 // 이벤트 객체가 인자로 새면 안 된다
  });
  $('#fgLv').addEventListener('click', e => { e.stopPropagation(); openForge(); });
  // AUTO 버튼: 돌고 있으면 **완전 정지**하고 패널을 연다. 꺼져 있으면 패널만 연다
  $('#b_auto').addEventListener('click', () => {
    if (S.autoWanted && autoUnlocked()) stopAuto(true);
    openAutoPanel();
  });
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
    const t = n.dataset.tab;
    if (!navOpen(t)) {
      const need = D.quests.navUnlockQuests.tabs[t].afterQuest;
      return toast(`퀘스트 ${need} 를 끝내면 열립니다`);
    }
    // **켜진 탭을 다시 누르면 닫는다.** 시트 탭에서 닫는 경로가 X 버튼뿐이면
    // 열었던 손가락이 그대로 한 번 더 눌러 닫는 자연스러운 왕복이 안 된다
    if (navTab === t && ['merc', 'skill', 'dungeon'].includes(t) && roster.isOpen) {
      roster.close();
      navTab = null;
      syncNav();
      return;
    }
    navTab = t;
    // 시트는 네비 위에 떠 있다. 시트를 안 쓰는 탭으로 가면 닫아 준다
    if (!['merc', 'skill', 'dungeon'].includes(t)) roster.close();
    // ui.json > mainScreen.navBar.items 기준. 장비는 하단 패널에 있으므로 뺐다.
    if (t === 'shop') shop.open();
    else if (t === 'dungeon') openDungeons();
    else if (t === 'alliance') alli.open();
    else if (t === 'merc') roster.open('mercenary');
    else if (t === 'skill') roster.open('skill');
    else toast(`${n.textContent} 탭 — 미구현`);
    // **연 뒤에** 맞춘다. 열기 전에 부르면 아직 아무것도 안 떠 있어 바로 지워진다
    syncNav();
  }));

  // 설정은 사이드 열에서 상단바로 옮겼다. 스테이지 표시는 HUD 진행도와 중복이라 뺐다.
  $('#topSet').addEventListener('click', () => settings.open());
  // 다이아 [+] — 상점 다이아 탭 지름길
  $('#diaPlus')?.addEventListener('click', () => shop.open('diamond'));
  $('#goldPlus')?.addEventListener('click', () => shop.open('exchange'));
  // 스킬 자동 토글. 기본 ON — 방치형이라 손을 떼도 돌아가야 한다.
  $('#skAuto').addEventListener('click', () => {
    S.skillAuto = !S.skillAuto;
    $('#skAuto').classList.toggle('on', S.skillAuto);
    $('#skAuto').querySelector('i').textContent = S.skillAuto ? 'ON' : 'OFF';
    scene.skillAuto = S.skillAuto;
    save();
  });
  // 사이드 열 + 상단 우편. data-s 를 가진 것은 전부 같은 경로로 연다
  document.querySelectorAll('.side button, #top button[data-s]').forEach(b => b.addEventListener('click', () => {
    if (b.id === 'pwrSave') return;          // 전용 리스너가 따로 있다 (pwr)
    if (b.dataset.s === 'arena') openArena();
    else if (b.dataset.s === 'attend') openAttend();
    else if (b.dataset.s === 'mission') openMissions();
    else if (b.dataset.s === 'event') openEvents();
    else if (b.dataset.s === 'pass') openPass();
    else if (b.dataset.s === 'codex') codex.open();
    else if (b.dataset.s === 'training') openTraining();
    else if (b.dataset.s === 'rank') rank.open();
    else if (b.dataset.s === 'settings') settings.open();
    else if (b.dataset.s === 'mail') mail.open();
    else toast(`${b.textContent} — 미구현`);
  }));
  // 편성 시트 헤드의 훈련소·도감. 오버레이(#ov z-index 60)가 시트(65) 아래라
  // 시트를 먼저 닫아야 한다 — 안 닫으면 오버레이가 시트에 가려 안 보인다
  document.querySelectorAll('.sh-go').forEach(b => b.addEventListener('click', () => {
    roster.close();
    if (b.dataset.go === 'training') openTraining();
    else if (b.dataset.go === 'promo') openPromotion();
    else if (b.dataset.go === 'codex') codex.open();
  }));
  // 절전 — 렌더만 10fps 로. 시뮬·보상은 계속 흐른다 (scene.setPowerSave).
  // 해제는 **밀어서**만 한다. 탭 해제는 주머니 속 오터치로 꺼진다
  let pvTimer = null, pvSince = 0, pvGold0 = 0;
  const pwr = on => {
    scene.setPowerSave(on);
    $('#pwrveil').classList.toggle('show', on);
    $('#pwrSave').classList.toggle('on', on);
    // #app 전체를 렌더 트리에서 뺀다. veil 로 가리기만 하면 그 밑에서
    // CSS 애니메이션(제작대 시트·재화 반짝임)과 페인트가 계속 돌아 배터리를 먹는다.
    // display:none 은 서브트리의 CSS 애니·레이아웃·페인트를 전부 멈춘다.
    // WebGL 캔버스 컨텍스트는 유지되고, 시뮬 ticker 는 DOM 과 무관하게 돈다
    $('#app').style.display = on ? 'none' : '';
    if (!on) {
      // 숨긴 동안 뷰포트가 바뀌었을 수 있다 — 캔버스 크기를 다시 잡게 한다
      window.dispatchEvent(new Event('resize'));
      renderTop();
    }
    clearInterval(pvTimer); pvTimer = null;
    if (on) {
      // 켠 시점을 기억해 두고 경과 시간·그동안 번 골드를 보여 준다.
      // "화면을 껐는데도 벌고 있다"가 절전을 쓰는 이유 그 자체다
      pvSince = Date.now(); pvGold0 = S.gold;
      const tick = () => {
        const d = new Date();
        $('.pv-clock').textContent =
          `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const sec = Math.floor((Date.now() - pvSince) / 1000);
        const el = sec < 3600
          ? `${Math.floor(sec / 60)}분 ${sec % 60}초`
          : `${Math.floor(sec / 3600)}시간 ${Math.floor(sec % 3600 / 60)}분`;
        $('#pvStage').textContent = `절전 ${el}`;
        $('#pvGold').textContent = `획득 골드 +${num(Math.max(0, S.gold - pvGold0))}`;
      };
      tick(); pvTimer = setInterval(tick, 1000);
    }
  };
  $('#csChip')?.addEventListener('click', openPromotion);
  $('#pwrSave').addEventListener('click', () => pwr(true));
  // 밀어서 해제 — 트랙 82% 를 넘기면 풀린다. 못 미치면 제자리로
  {
    const track = $('#pvTrack'), handle = $('#pvHandle');
    let startX = null;
    const maxX = () => track.clientWidth - handle.offsetWidth - 6;
    handle.addEventListener('pointerdown', e => {
      startX = e.clientX;
      handle.classList.add('drag');
      // 캡처 실패(비표준 입력)는 무시한다 — 캡처 없이도 move 는 온다
      try { handle.setPointerCapture(e.pointerId); } catch { /* noop */ }
    });
    handle.addEventListener('pointermove', e => {
      if (startX == null) return;
      const x = Math.max(0, Math.min(maxX(), e.clientX - startX));
      handle.style.left = (3 + x) + 'px';
    });
    handle.addEventListener('pointerup', () => {
      const x = parseFloat(handle.style.left || '3') - 3;
      handle.classList.remove('drag');
      startX = null;
      if (x >= maxX() * 0.82) pwr(false);
      handle.style.left = '3px';
    });
  }

  // 시간 단축 창 닫기 — X 또는 카드 밖
  $('#hgX').addEventListener('click', closeHourglass);
  $('#hgPop').addEventListener('click', e => {
    if (e.target.id === 'hgPop') closeHourglass();
  });

  // 유닛 상세 닫기 — X 또는 카드 밖
  $('#unitX').addEventListener('click', () => $('#unit').classList.remove('show'));
  $('#unit').addEventListener('click', e => {
    if (e.target.id === 'unit') $('#unit').classList.remove('show');
  });

  // 벽 안내 — 카드 밖을 탭하면 닫힌다
  $('#wall').addEventListener('click', e => {
    if (e.target.id === 'wall') $('#wall').classList.remove('show');
  });
  $('#ovx').addEventListener('click', () => {
    if ($('#ov').classList.contains('forced')) return;
    $('#ov').classList.remove('show', 'over-alli');
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
    syncNav();
    save();
  }, 1000);

  // 배선이 전부 끝난 뒤에 전투를 시작한다. 이 await 이 부트의 마지막이다
  bootStep(100, t('출격 준비 완료!'));
  $('#boot')?.classList.add('hide');
  setTimeout(() => $('#boot')?.remove(), 500);
  await runStage();
})();
