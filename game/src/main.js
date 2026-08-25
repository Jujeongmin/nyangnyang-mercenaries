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
import { initCloud, cloudSave } from './core/cloudsave.js';
import { passiveAgg, passiveAtkMult } from './core/passives.js';
import * as live from './net/live.js';
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
import { t, tn, loadLang, LANGS, watchDom } from './core/i18n.js';
import { showRewarded, initAds, AD_OK, AD_SKIPPED, AD_IDLE_DOUBLE, AD_INSTANT_CLAIM } from './net/ads.js';

const $ = s => document.querySelector(s);
const GC = { N: '#b5a69a', R: '#4CAF50', SR: '#2196F3', SSR: '#9C27B0', UR: '#FF9800', LR: '#E91E63' };

const S = {
  stage: 1, maxStage: 1,
  // **빈손으로 시작한다** (2026-08-24). 다이아·골드를 쥐여 주고 시작하면 첫
  // 소환의 무게가 사라진다 — 재화는 Q1 부터 퀘스트 보상으로 들어온다
  dia: 0, gold: 0,
  // 장비 소환 주재화(구 황금 열쇠). 제련석은 폐기됐다.
  // 10개만 준다 — 제작대가 무엇인지 한 바퀴 돌려 볼 만큼이고, 그 뒤로는 벌어야 한다
  eqTicket: 10,
  forgeLv: 1, forgeStart: null, forgeTarget: null, forgeCut: 0,
  eqSummons: 0,                            // 장비 소환 누적 횟수 (Q1 이 이걸 센다)
  party: [], equip: {}, inv: [],
  // 캐스케이드 이월. 레벨로 못 바꾼 중복 가치가 여기 남아 다음 중복 때 합산된다.
  // (혼을 폐기해서 적립할 재화가 없다 — economy.json > cascade.carryNote)
  carry: { mercenary: 0, skill: 0 },
  // 레벨을 1부터 세도록 바꾼 뒤 옛 세이브를 한 번 올렸다는 표시 (load 참고)
  lv1Base: 0,
  // 1:1 개편 때 옛 이월 포인트를 한 번 비웠다는 표시 (load 참고).
  // **기본값은 0 이어야 한다** — 1 로 두면 Object.assign 이 옛 세이브를 덮은 뒤에도
  // 기본값이 남아 "이미 비웠다" 로 읽혀 리셋이 안 돈다 (실제로 그랬다)
  carryReset1to1: 0,
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
  // 소환 퀘스트의 기준점. "이번 퀘스트 동안 N회" 를 세려고 퀘스트를 넘길 때마다
  // 다시 찍는다 (markQuestBase). 신규는 아무것도 안 뽑았으니 0 이다
  questBase: { merc: 0, skill: 0, eq: 0, kills: 0 },
  // 던전 열쇠 — 던전별로 따로 센다. 매일 05:00 KST 에 3개로 채워진다.
  dgKeys: {}, dgKeyDay: 0,
  // 무한의 탑 — 입장 제한 없음, 직전에 뚫은 층 다음부터
  tower: { floor: 1, best: 0 },
  dg: {}, arenaScore: 1000, medal: 0,      // 훈장은 아레나에서만 벌고 아레나에서만 쓴다
  // 아레나 일일 — 입장 사용 수·광고 사용·티어 보상 수령일 (05:00 리셋)
  arena: { day: null, used: 0, adUsed: 0, tierClaimedDay: null },
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
  // 소속 연합. null 이면 미가입 — 연합 탭이 생성/가입 화면을 연다.
  // 서버 연동 전에는 로컬 기록뿐이다 (실명단은 verse8 연동 때)
  ally: null,
  // 친구 — 선물은 보내는 쪽 코스트가 없다 (표준 문법: 서로 보내면 서로 이득).
  // sentDay/recvDay 는 dayIdx. 서버 전에는 데모 친구가 자리를 지킨다
  friends: { list: [], sentDay: null, recvDay: null },
  allyDonate: { day: null, step: 0 },       // 오늘 기부 단계 (0~5)
  allyXp: 0,                               // 연합 XP — 기부 코인 누적 (안 줄어든다)
  allyLeftAt: null,                        // 탈퇴 시각 — 24시간 재가입 쿨다운
  allyShopBuy: { week: null, n: {} },      // 연합 상점 주간 구매 횟수
  capLv: 1, capXp: 0,                      // 단장(계정) 레벨. 스탯 효과 없음
  codex: { mercenary: [], skill: {} },     // 1회 획득 시 영구 등록
  trainLv: 0,                              // 훈련소
  promo: { warrior: 1, archer: 1, mage: 1 },   // 직군별 전직 단계
  // 전직으로 고른 길. 하나를 고르면 다른 직군은 잠긴다 — 초기화로만 되돌린다.
  // 단장의 모습·공격 모션도 이 직업을 따른다
  promoClass: null,
  promoSkillLv: 0,                         // 전직 스킬 강화 단계 (골드 소모처)
  promoSkillLv2: 0,                        // 3차 전직 스킬 (다른 축 — 보스/연사/쿨감)
  cosmetics: { wing: null, owned: [] },    // 이벤트 한정 외형 (단장 날개 등)
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
  // 냥냥 주사위 — 굴림은 이벤트 미션 보상으로만 얻는다. mClaimed 는 매일 초기화
  dice: { day: null, rolls: 0, mClaimed: [], pos: 0, laps: 0, totalRolls: 0 },
  // 이벤트 시계의 원점 — 첫 접속 시각. D-day 가 여기서 나온다
  evStart: null,
  mailbox: [],
  idle: { lastClaimAt: Date.now(), freeUsed: 0, adUsed: 0, resetAt: Date.now() },
};

let scene, reveal, shop, codex, rank, settings, mail, profile, tower, roster, alli;

// --- CP ---
// 전직 배수는 **그 용병의 직군**에서 온다 (goldsinks > training_camp.promotion).
// class 가 없는 옛 세이브·스킬 객체는 배수 1 로 떨어진다
// 레벨은 **1부터** 센다. 그래서 성장항은 (level - 1) 이다 — 레벨 1 이 기준값이고
// 밸런스는 0부터 세던 때와 같다. 그냥 level 을 쓰면 전원 CP 가 6% 뛴다.
const cpOf = m => D.characters.gradeCoef[m.grade]
  * (1 + ((m.level || 1) - 1) * D.characters.levelGrowthPerLevel)
  * (m.class ? promoMult(m.class) : 1);
const skillCp = s => D.skills.gradeCoef[s.grade] * (1 + ((s.level || 1) - 1) * 0.06);

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

/** 이벤트 한정 상품 CP 보너스 — 보유 기준 합산 (events.json > rollRewards.cpBonus) */
function cosmeticBonus() {
  let b = 0;
  for (const r of D.events.diceBoard.rollRewards || []) {
    const got = r.title ? S.profile.ownedTitles.includes(r.title)
      : r.profile_frame ? (S.profile.ownedFrames || []).includes(r.profile_frame)
      : S.cosmetics?.owned?.includes(r.cosmetic);
    if (got) b += r.cpBonus || 0;
  }
  return b;
}

/**
 * 단장이 들고 있는 기본 전투력.
 *
 * 예전에는 0 이었다 (characters.json > captain.statEffect: "none"). 그런데
 * **시작 편성이 비어 있게 바뀌면서** 신규 계정의 전투력이 그대로 0 으로 떴다 —
 * 화면 한가운데 서서 실제로 때리는 단장이 있는데 전투력은 0 이라는 모순이다.
 *
 * 스테이지 1 요구치의 **4%(=50)** 다. 처음엔 12%(151)로 뒀는데, 바탕이 그만큼
 * 크면 장비 한 칸·용병 한 명이 붙어도 표시가 별로 안 움직인다 — 초반 바탕은
 * 낮을수록 성장이 보인다. 요구치가 지수로 오르는 뒤쪽에서는 어차피 사라진다.
 */
const captainCp = () => Math.round(D.stages.curve.baseCp * 0.04);

/**
 * 장비의 **고정 전투력**. 등급 보너스(equipBonus)는 총합에 곱해지는 퍼센트라
 * 초반처럼 바탕이 작을 때는 한 칸 끼워도 1~2 밖에 안 올랐다 — 장비를 맞추는
 * 재미가 숫자로 안 보였다.
 *
 * 그래서 **바탕에 더하는 몫**을 따로 둔다. 스테이지 1 요구치의 3% × 등급이라
 * 일반(1등급) 한 칸이 38, 여섯 칸을 다 채우면 225 다 — 단장(50)·첫 용병(N 250)과
 * 나란히 놓았을 때 "장비를 맞추는 것"이 용병 한 명에 버금가게 보인다.
 * 뒤로 갈수록 요구치가 지수로 오르므로 저절로 퍼센트 쪽이 주도권을 가져간다.
 *
 * 퍼센트 상한(equipment.json > maxBonusVerification)은 안 건드렸다 —
 * 그 표가 CP 천장 계산의 근거라 손대면 곡선 전체를 다시 재야 한다.
 */
function equipFlatCp() {
  let flat = 0;
  for (const s of D.equipment.slots) {
    const it = S.equip[s.id];
    if (it) flat += D.stages.curve.baseCp * 0.03 * it.tier;
  }
  return flat;
}

function totalCp() {
  let base = captainCp();
  base += equipFlatCp();
  base += S.party.reduce((a, m) => a + cpOf(m), 0);
  base += [...S.skills.active, ...S.skills.passive].reduce((a, s) => a + (s ? skillCp(s) : 0), 0);
  return base
    * (1 + equipBonus())
    * (1 + codexBonus())
    * (1 + trainingBonus(trainDef(), S.trainLv))
    * (1 + S.forgeLv * 0.008)
    * (1 + cosmeticBonus());
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

/**
 * 읽은 우편 정리. **세이브에서 개수로 자라는 유일한 배열이었다.**
 *
 * 수령해도 claimed 만 찍고 남겨 두면 계정 수명만큼 쌓인다. 일일 보상·아레나
 * 티어 보상이 우편으로 오므로 하루 몇 통씩 늘고, 우편 한 통이 leaf 5~7개다 —
 * 1년이면 leaf 만 1만 개다.
 *
 * Firestore 문서는 **인덱스 엔트리 40,000** 이 바이트(1MB)와 **별개 축**이라
 * 크기가 작아도 필드 수로 먼저 죽는다. 게다가 merge 저장이라 한 번 부풀면
 * 필드를 지워도 문서에는 남는다 — 애초에 안 쌓는 것이 유일한 예방책이다.
 * (server/server.js 의 MAX_LEAVES 가 같은 이유로 leaf 를 센다)
 *
 * 안 받은 우편은 **절대 안 지운다.** 받은 것만 최근 KEEP 통까지 남긴다.
 */
const MAIL_KEEP_CLAIMED = 20;
function pruneMail() {
  const box = S.mailbox || [];
  const claimed = box.filter(x => x.claimed);
  if (claimed.length <= MAIL_KEEP_CLAIMED) return;
  const drop = new Set(claimed.slice(0, claimed.length - MAIL_KEEP_CLAIMED));
  S.mailbox = box.filter(x => !drop.has(x));
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
  pruneMail();
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
    f1kPendingN() > 0 || diceMissionReady());
  document.querySelector('[data-s="friend"]')?.classList.toggle('hasnew',
    friendGiftReady() || friendIncoming().length > 0);
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

/**
 * 그 칸이 열리는 퀘스트 번호. idx 는 0 부터다.
 * 잠긴 칸을 눌렀을 때 "언제 열리는지" 를 말해 주려고 쓴다 — 자물쇠만 보이고
 * 조건이 어디에도 안 적혀 있으면 유저는 그 칸을 없는 것으로 여긴다.
 */
function slotUnlockQuest(kind, idx) {
  const tbl = D.quests.slotUnlockQuests?.[kind] || [];
  for (const r of tbl) if (r.slots >= idx + 1) return r.afterQuest;
  return null;
}
const SLOT_KIND_KO = { mercenary: '용병', skillActive: '액티브 스킬',
  skillPassive: '패시브 스킬' };

/** 잠긴 칸 안내. 어디서 눌러도 같은 문장이 나오게 한 곳에 둔다 */
function tellSlotLock(kind, idx) {
  const q = slotUnlockQuest(kind, idx);
  const ko = SLOT_KIND_KO[kind] || '';
  if (q == null) return toast(t('더 열리지 않는 칸입니다'));
  const left = q - questCleared();
  toast(left > 0
    ? t('{0} {1}번째 칸 — 퀘스트 {2} 개를 더 깨면 열립니다 ({3}/{4})',
        ko, idx + 1, left, questCleared(), q)
    : t('{0} {1}번째 칸이 곧 열립니다', ko, idx + 1));
}

function slotsOf(kind) {
  const tbl = D.quests.slotUnlockQuests?.[kind] || [];
  let n = 0;
  for (const r of tbl) if (questCleared() >= r.afterQuest) n = r.slots;
  return n;
}

/** 보상 수령. 실제로는 서버 함수다 (net/backend.js > claimQuest). */
/**
 * 회차형 퀘스트의 기준점. **"이번 퀘스트 동안 몇 번 했나"** 를 센다 —
 * 소환(용병·스킬) · 무기 제작 · 몬스터 처치가 여기에 해당한다.
 *
 * 예전에는 계정 누적 소환수(summonExp)를 그대로 목표와 비교했다 — 그래서
 * 사이클 5 의 목표가 131 처럼 커졌고, 이미 많이 뽑아 둔 사람은 새 퀘스트가
 * 시작하자마자 완료됐다. 기준점을 퀘스트마다 다시 찍으면 목표를 10~30 같은
 * 읽히는 숫자로 둘 수 있다.
 */
function markQuestBase() {
  S.questBase = {
    merc: S.summonExp?.mercenary || 0,
    skill: S.summonExp?.skill || 0,
    eq: S.eqSummons || 0,      // 무기 제작 횟수
    kills: S.kills || 0,       // 몬스터 처치
  };
}

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
  // 소환 퀘스트의 기준점을 여기서 다시 찍는다 — "이번 퀘스트 동안 N회" 라서
  // 누적값이 아니라 **직전 퀘스트를 넘긴 순간부터** 센다 (questBase)
  markQuestBase();
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
    saveNow();
    cloudSave();            // Verse8 안이면 30초 스로틀로 올라간다. 밖이면 무동작
    pushPublic();           // 랭킹·공개 프로필. 아래 규칙대로 대부분은 무동작이다
  }, 400);
}

/**
 * 공개 프로필·랭킹 제출.
 *
 * **호출 예산이 좁다** — remoteFunction 은 초당 약 10회고, 소환 1회마다 올리면
 * 10연차에서 즉시 한계다 (ranking.json > rateLimitBudget). 그래서 세 겹으로 막는다:
 *   60초 debounce · 최소 변화율 0.5% · 하루 30회
 * net/backend.js 의 submitCp 와 같은 규칙이다 — 그쪽은 서버 판정 이관(2단계)에서
 * 쓰고, 지금 실제로 도는 경로는 여기다.
 */
let _cpSent = 0, _cpAt = 0, _cpDay = 0, _cpToday = 0;
function pushPublic() {
  if (!live.liveReady()) return;
  const now = Date.now(), day = dayIdx(now);
  if (_cpDay !== day) { _cpDay = day; _cpToday = 0; }
  if (_cpToday >= 30) return;
  if (now - _cpAt < 60_000) return;
  const cp = Math.round(totalCp());
  if (_cpSent && Math.abs(cp - _cpSent) / _cpSent < 0.005) return;
  _cpAt = now; _cpSent = cp; _cpToday++;
  const nick = S.profile?.nick || S.nickname || '단장';
  // 프로필과 랭킹을 같이 올린다. 랭킹 행은 점수만 갖고 있어서, 프로필이 낡으면
  // 남의 화면에 뜨는 내 편성·칭호가 옛날 것으로 남는다
  Promise.all([
    live.pushProfile(publicProfile()),
    live.pushCp(cp, nick),
  ]).catch(e => console.warn('[live] 제출 실패', e));
}

/**
 * 즉시 저장. save() 는 400ms 디바운스라 **그 사이에 페이지가 사라지면
 * 마지막 변경이 통째로 날아간다** — location.reload() 직전이 정확히 그 경우다
 * (언어 변경이 이걸로 한 번 먹혔다). 그런 자리에서만 이걸 쓴다.
 */
function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, lastSeenAt: Date.now(), s: S }));
  } catch (e) { console.warn('저장 실패', e); }
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
    // 레벨을 1부터 세게 바꿨다 (2026-08-24). 옛 세이브의 0레벨은 1레벨과 같은
    // 것이므로 올려 준다 — 전투력 식이 (level - 1) 이라 값은 그대로다
    if (!S.lv1Base) {
      const bump = x => { if (x && (x.level || 0) < 1) x.level = 1; };
      (S.party || []).forEach(bump);
      (S.own?.mercenary || []).forEach(bump);
      (S.own?.skill || []).forEach(bump);
      (S.skills?.active || []).forEach(bump);
      (S.skills?.passive || []).forEach(bump);
      S.lv1Base = 1;
    }
    // 이월 포인트(carry)는 예전에 **등급 배수**로 쌓였다 (LR 중복 하나 = 300).
    // 지금은 1 포인트 = 1 레벨이라, 옛 값을 그대로 두면 스킬 150레벨을 공짜로
    // 받는다. 환산할 기준이 없으므로(어느 등급이 얼마나 쌓였는지 기록이 없다)
    // 한 번만 0 으로 내린다. 다음 중복부터는 새 규칙으로 정확히 쌓인다.
    if (!S.carryReset1to1) {
      S.carry = { mercenary: 0, skill: 0 };
      S.carryReset1to1 = 1;
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
  return { ch, sub, zone: zone ? zone.nameKo : '', text: `${t('일반')} ${ch}-${sub}` };
}
const bgFor = n => {
  const b = D.stages.backgrounds.find(x => n >= x.from && n <= x.to)
    || D.stages.backgrounds[D.stages.backgrounds.length - 1];
  return b.asset.replace('bg_BG', 'BG-');
};

// 파티 총 DPS. 환산 패시브(DEF/HP → ATK)를 반영한다 —
// characters.json > statDerivation.conversion 과 같은 식이어야 한다.
//
// 장착 패시브의 **상시** 항(공격력·공격 속도 강화)도 여기서 곱한다. 예전에는
// 패시브가 총 전투력(totalCp)에만 더해졌고 DPS 는 용병 CP 만 봤다 — "공격력 +11%"
// 스킬을 껴도 실제 타격이 1도 안 늘었다. 발동형(치명타·즉사·이중 공격 등)은
// 여기 넣지 않는다. 그건 매 타격마다 굴려야 해서 scene 이 쥔다.
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
  return dps * gear * csDpsMult() * passiveAtkMult(passiveAgg(S.skills.passive, D.skills));
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
/** 스킬 칸은 액티브·패시브 각각 최종 4칸이다 (skills.json > 장착 상한) */
const SLOT_ROW = [0, 1, 2, 3];

function renderSkills() {
  const box = $('#skills');
  box.innerHTML = '';
  // 열린 칸 수. 이걸 안 보면 "비어 있음" 과 "아직 안 열림" 이 같은 모습이 된다
  const openA = slotsOf('skillActive');
  const openP = slotsOf('skillPassive');
  const mk = (s, i, kind, open) => {
    const d = document.createElement('div');
    const locked = i >= open;
    d.className = 'sk' + (s ? '' : locked ? ' lock' : ' free');
    if (s) {
      d.style.borderColor = GC[s.grade];
      d.style.boxShadow = `0 0 6px ${GC[s.grade]}55`;
      // 신규 스킬은 그림이 아직 없을 수 있다. 깨진 아이콘 대신 빼 버린다
      d.innerHTML = `<img src="/assets/skill/${s.id}.png" alt="" onerror="this.remove()">`
        + '<i class="cdwipe"></i>';
      d.title = `${tn(s.id, s.nameKo)} ${s.grade} Lv${s.level}`;
      d.dataset.sid = s.id;
    } else {
      d.title = locked
        ? `${kind} ${i + 1}번 칸 — 아직 열리지 않음`
        : `${kind} ${i + 1}번 칸 — 비어 있음`;
    }
    return d;
  };
  // 칸은 **항상 4개를 그린다.** 배열 길이에 맡기면 신규 계정(빈 배열)에서
  // 스킬바가 통째로 사라져 "아직 안 열림" 표시조차 안 나온다
  SLOT_ROW.forEach((_, i) => {
    const s = S.skills.active[i] || null;
    const d = mk(s, i, '액티브', openA);
    if (!s && i >= openA) d.addEventListener('click', () => tellSlotLock('skillActive', i));
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
  SLOT_ROW.forEach((_, i) => {
    const s = S.skills.passive[i] || null;
    const d = mk(s, i, '패시브', openP);
    if (s) d.addEventListener('click', () => openUnitInfo('skill', s.id));
    else if (i >= openP) d.addEventListener('click', () => tellSlotLock('skillPassive', i));
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
  // 자동이 **실제로 도는 동안**만 망치질이 이어진다 (결과 대기 중이면 선다)
  $('#fgObj').classList.toggle('auto', !!S.autoSummon && !S.eqPending);

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
  setSkin('forge');
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
    // 날개 칸은 이벤트 한정 날개가 실제로 쓴다 — 획득하면 잠금이 풀리고
    // 낀 날개가 보인다. 누르면 상품 정보(효과·출처)가 뜬다
    if (nm === '날개' && S.cosmetics?.wing) {
      // 무한(T10) 등급 액자 — 지금 얻을 수 있는 가장 좋은 날개라는 뜻이다.
      // fre-3 는 장비 최상위 밴드(태초~무한)의 화려 액자다
      const t10 = D.equipment.grades[D.equipment.grades.length - 1];
      d.className = 'slot wing-on fre-3';
      d.style.setProperty('--au', t10.color);
      d.style.setProperty('--aw', '1');
      d.innerHTML = `<img src="/assets/captain/EV-WING1.png" alt=""
          onerror="this.remove()"><b style="color:${t10.color}">${nm}</b>`;
      d.title = '축제의 날개 — 장착 중';
      d.addEventListener('click', () => {
        const i = (D.events.diceBoard.rollRewards || []).findIndex(r => r.cosmetic);
        if (i >= 0) openPrizeInfo(i);
      });
      future.appendChild(d);
      continue;
    }
    d.className = 'slot future';
    d.innerHTML = `<img class="lk" src="/assets/ui/IC-LOCK-S.png" alt=""><span>${nm}</span>`;
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
  // 상자 라벨은 **얼마나 쌓였나(시간)** 다 — 액수는 눌러서 패널에서 본다.
  // 좁은 라벨에 큰 숫자를 넣으면 상자 그림을 덮는다
  $('#chestT').textContent = h < 1 ? `${Math.floor(h * 60)}${t('분')}` : `${h.toFixed(1)}${t('시간')}`;
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
/**
 * 소환 n 회의 실제 결제 내역. **버튼 표시와 실제 차감이 같은 식이어야 한다** —
 * 예전엔 UI 가 따로 계산해서, 소환권 10장으로 10연을 돌리는데도 버튼엔
 * 다이아 값이 그려졌다.
 *   { ticket, dia, bag }  ticket 장 + dia 개로 낸다
 */
function pullCost(trackId, n) {
  const tr = D.gacha.tracks[trackId];
  const bag = trackId === 'skill' ? 'skillTicket' : 'mercTicket';
  const ticket = Math.min(S[bag] || 0, n);
  const rest = n - ticket;
  // 10연 할인은 10장을 실제로 다이아로 낼 때만 적용된다
  const full = n >= 10 ? tr.costs.diamondPer10Pull : tr.costs.diamondPerPull * n;
  return { bag, ticket, dia: rest === n ? full : tr.costs.diamondPerPull * rest };
}

function pull(trackId, n) {
  const tr = D.gacha.tracks[trackId];
  if (!tr) return;
  // 소환권이 있으면 그만큼 먼저 쓴다. economy.json > currencies.*_ticket 의 '소환 1회 대체'.
  const { bag, ticket: byTicket, dia: cost } = pullCost(trackId, n);
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
  // 소환은 퀘스트 진행도다 (Q2 용병 10회 등). 안 그리면 10연을 돌려도
  // 배너가 0/10 그대로다 (실사용 보고 2026-08-25)
  renderQuest();
}

// ─────────────────────────────────────────────
// 캐스케이드 — economy.json > cascade
//
// 캡을 찍었거나 편성에 못 든 중복은 버리지 않고 **편성된 대상의 레벨로 넘긴다**.
// 규칙은 하나다: **중복 1개 = 레벨 1**. 등급을 안 본다 (dupeValue·levelCost 전부 1).
//
// 예전에는 등급마다 값이 달라(N 1 … LR 300) "N 100장 = UR 1레벨" 이었다. 계산이
// 필요한 만큼 유저가 확인할 것도 늘었고, 두 값 중 하나만 손대면 LR 이 중복 두 개로
// 만렙이 되는 식으로 조용히 뒤집혔다. 1:1 이면 그런 어긋남이 구조적으로 안 생긴다.
// ─────────────────────────────────────────────

/**
 * 레벨 한 칸의 비용. 지금은 **늘 1** 이다 — 등급도 현재 레벨도 안 본다.
 * 식을 남겨 두는 이유: 나중에 계단을 다시 넣고 싶어지면 데이터만 고치면 된다
 * (characters/skills.json > levelCost).
 */
function lvCost(track, level) {
  const c = (track === 'skill' ? D.skills : D.characters).levelCost
    || { base: 5, stepEvery: 10, stepAdd: 2 };
  // 레벨이 1부터이므로 (level - 1) 로 구간을 센다 — Lv1~10 이 한 구간이다
  return c.base + Math.floor(Math.max(0, (level || 1) - 1) / c.stepEvery) * c.stepAdd;
}

/** 편성된 용병/스킬을 CP 내림차순으로. 캡 미달인 것만. */
function cascadeTargets(track) {
  const cap = track === 'skill' ? D.skills.levelCap : D.characters.levelCap;
  const list = track === 'skill'
    ? [...S.skills.active, ...S.skills.passive].filter(Boolean)
    : S.party.filter(Boolean);
  return list
    .filter(x => (x.level || 1) < (cap?.[x.grade] ?? 0))
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
    // 비용은 **지금 레벨**이 정한다 (등급 무관). 한 칸씩 사면서 남는 만큼 올린다
    const t = cascadeTargets(track).find(x =>
      S.carry[track] >= lvCost(track, x.level || 1));
    if (!t) break;                                   // 전부 캡이거나 이월이 모자라다
    const room = (cap[t.grade] ?? 0) - (t.level || 1);
    const from = t.level || 1;
    let up = 0;
    while (up < room && S.carry[track] >= lvCost(track, from + up)) {
      S.carry[track] -= lvCost(track, from + up);
      up++;
    }
    if (up < 1) break;
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
        ? { id: g.id, nameKo: g.name, grade: g.grade, level: 1 }
        : { id: g.id, nameKo: g.name, grade: g.grade, class: g.cls, level: 1 });
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
    const room = own ? (cap[own.grade] ?? 0) - (own.level || 1) : 0;
    if (own && room > 0) {
      // 중복은 **그 유닛에게 쌓인다**. 다음 레벨 비용을 채울 때마다 한 칸 오른다 —
      // 화면의 "3/5" 가 이 값이다 (예전엔 중복이 곧 레벨이라 셀 것이 없었다)
      const from = own.level || 1;
      own.exp = (own.exp || 0) + 1;
      let up = 0;
      while (up < room && own.exp >= lvCost(track, (own.level || 1))) {
        own.exp -= lvCost(track, own.level || 1);
        own.level = (own.level || 1) + 1;
        up++;
      }
      if (up) logs.push({ name: tn(own.id, own.nameKo), from, to: own.level });
    } else {
      // 만렙이거나 주인 없음 — 버리지 않고 편성된 대상의 레벨로 넘긴다
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
  // 패시브는 연출용이다 — 판정은 전투력에만 반영된다

  scene.passiveSkills = S.skills.passive.filter(Boolean);
  scene.syncPassiveAura?.();
  scene.captainClass = S.promoClass || 'warrior';
  scene.skillDmgMult = csSkillMult();
  // 3차 전직 스킬 — 각자 다른 축으로 전투에 꽂힌다
  const s2 = cs2Mine();
  scene.bossDmgMult = s2?.effect === 'boss_damage' ? 1 + cs2Val() : 1;
  scene.doubleHitChance = s2?.effect === 'double_hit' ? cs2Val() : 0;
  scene.skillCdMult = s2?.effect === 'skill_cooldown' ? 1 - cs2Val() : 1;
  scene.captainWing = S.cosmetics?.wing || null;
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
          : locked ? '<i class="ps-mark"><img src="/assets/ui/IC-LOCK-S.png" alt="잠김"></i>'
          : !open ? '' : '<i class="ps-mark ps-go">받기</i>'}</button>`;
    };
    return `<div class="ps-row${t === cur ? ' now' : ''}" data-tier="${t}">
      <span class="ps-tier"><b>${t}</b><span>St${t * per}</span></span>
      ${cell('free', f)}${cell('paid', p2)}</div>`;
  };

  // 제목은 짧게. 시즌 이름까지 넣으면 좁은 화면에서 잘린다 —
  // 시즌 이름은 아래 본문(진행 카드)이 이미 보여 준다
  $('#ovt').textContent = t('시즌 패스');
  setSkin('pass');
  $('#ovb').innerHTML =
    `<div class="ps-top">
      <div class="ps-tinfo"><b>${cur}</b><span>${t('/ {0} 티어', P.progress.maxTier)}</span></div>
      <div class="ps-tnext">${cur >= P.progress.maxTier
        ? t('최고 티어') : t('다음 티어까지 스테이지 {0}', Math.max(0, nextAt - (S.maxStage || 1)))}</div>
    </div>`
    // 전부 받기가 왼쪽, 프리미엄이 오른쪽. 매번 누르는 버튼을 엄지 쪽에 두고
    // 결제 버튼은 반대편에 둬야 오조작 결제가 안 난다
    + `<div class="ps-buy">
      <button class="mdBuy" id="psAll">${t('전부 받기')}</button>
      ${S.pass.bought
        ? `<span class="ps-own">${t('프리미엄 보유 중')}</span>`
        : `<button class="fgbtn" id="psBuy">${t('프리미엄 {0}원', numExact(P.tracks.paid.price.krw))}</button>`}
      </div>`
    + `<div class="ps-head"><span></span><span>${t('무료')}</span><span>${t('프리미엄')}</span></div>`
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
const GC_COL = { N: '#b5a69a', R: '#4CAF50', SR: '#2196F3', SSR: '#9C27B0', UR: '#FF9800', LR: '#E91E63' };
const ELEM_KO = { fire: '불', water: '물', nature: '풀', light: '빛', dark: '암' };
const SKILL_CAT_KO = { attack: '공격', buff: '버프', survival: '생존', summon: '소환',
  stat: '능력치', special: '특수' };

/**
 * 스킬 설명 문장. skills.json 에 서술 필드가 없으므로 effect 에서 만든다 —
 * 데이터에 문장을 넣으면 수치를 고칠 때마다 문장이 낡는다. kind 가 곧 문법이다.
 */
function skillDesc(sk, level) {
  const e = sk.effect || {};
  const mult = D.skills.gradeCoef[sk.grade] * (1 + ((level || 1) - 1) * 0.06)
    / (D.skills.gradeCoef[D.skills.effectScaling.baselineGrade] || 1500);
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
    case 'opening_burst': return `전투 시작 ${e.sec}초간 공격력 +${pct(e.pct)}`;
    case 'thorns_aura': return `적이 공격할 때마다 공격력의 ${pct(e.atkPct)} 피해로 되돌림`;
    case 'vigor': return `초당 최대 체력의 ${(e.maxHpRatioPerSec * mult * 100).toFixed(1)}% 재생`
      + ` · 체력이 가득 차 있으면 공격력 +${pct(e.fullHpAtkPct)}`;
    case 'rage_ramp': return `전투가 이어질수록 초당 피해 +${rawPct(e.pctPerSec)}`
      + ` (최대 +${rawPct(e.maxPct)})`;
    case 'def_pierce': return `적 방어력 ${pct(e.pct)} 무시`;
    case 'lifesteal': return `피해의 ${pct(e.pct)}만큼 흡혈`
      + (e.atkPct ? ` · 공격력 +${pct(e.atkPct)}` : '');
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
  const mult = D.skills.gradeCoef[sk.grade] * (1 + ((level || 1) - 1) * 0.06)
    / (D.skills.gradeCoef[D.skills.effectScaling.baselineGrade] || 1500);
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
  const level = held?.level || 1;
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
  const pct = v => (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
  const set = (el, sk, lv, val) => {
    if (!el) return;
    if (!sk) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<img src="/assets/skill/${sk.fx}.png" alt=""
        onerror="this.remove()"><i>Lv${lv || 0}</i>`;
    el.title = `${sk.nameKo} — ${sk.descKo.replace('{v}', pct(val))}`;
  };
  set($('#csChip'), csMine(), S.promoSkillLv, csVal());
  set($('#csChip2'), cs2Mine(), S.promoSkillLv2, cs2Val());
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
      <div class="mq-bar" style="--seg:${mqSeg(q.target)}"><i
        style="width:${cur / q.target * 100}%"></i></div>
      <span class="mq-p">+${q.points}</span>
    </div>`;
  }).join('');

  const nextR = def.pointRewards.find(r => !st.claimed.includes(r.points));
  $('#ovt').textContent = t('임무');
  setSkin('quest');
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

// ── 출시 기념 · 냥냥 주사위 (events.json > diceBoard) ─────
// 굴림은 상점도 리필도 아니고 **이벤트 미션 보상**이다. 미션 진행도는 일일
// 임무 카운터(S.dq.c)를 그대로 읽는다 — 같은 행동을 두 군데서 세지 않는다.
function diceState() {
  const day = dayIdx(Date.now());
  if (S.dice.day !== day) {
    S.dice.day = day;
    S.dice.mClaimed = [];             // 미션 수령 기록만 매일 리셋. 굴림은 이월
  }
  return S.dice;
}

/** 이벤트 남은 일수. 0 이하면 끝났다. 원점은 첫 접속(S.evStart) */
function evDaysLeft(durationDays) {
  if (!S.evStart) { S.evStart = Date.now(); save(); }
  const passed = Math.floor((Date.now() - S.evStart) / 86400e3);
  return durationDays - passed;
}
const diceOver = () => evDaysLeft(D.events.diceBoard.durationDays) <= 0;

/** 출석 미션 — 구 7일 축제를 흡수했다. 오늘 안 받았으면 수령 가능 */
const diceAttendReady = () => !diceOver() && S.ev7.lastAt !== attendToday();

function claimDiceAttend() {
  if (!diceAttendReady()) return;
  const E = D.events.diceBoard;
  S.ev7.lastAt = attendToday();
  S.dice.rolls += E.attendMission.rolls;
  // 7일치 축제 보상 — 아직 남았으면 그 일차 것을 같이 준다
  const fd = D.dailies.newbie7Day.days[S.ev7.day];
  if (fd) {
    S.ev7.day++;
    const got = passGrant(fd.grant || {});
    if (got.pairs.length) gainToast(got.pairs);
  }
  save(); syncNav(); syncDiceDots();
  toast(t('주사위 +{0}', E.attendMission.rolls));
  renderDiceBoard(); renderDiceMissions();
}

/**
 * 화면에 떠 있는 주사위 점들을 지금 상태로 맞춘다.
 * 사이드 아이콘은 syncNav 가 보지만, **탭바(판/미션) 점은 다시 그려야만**
 * 갱신돼서 다 받고도 빨간불이 남아 있었다.
 */
function syncDiceDots() {
  const tab = document.querySelector('[data-dctab="mission"]');
  if (!tab) return;
  const on = diceMissionReady();
  const dot = tab.querySelector('.dot');
  if (on && !dot) tab.insertAdjacentHTML('beforeend', '<i class="dot"></i>');
  if (!on && dot) dot.remove();
}

/** 받을 수 있는 미션이 있나 — 배너·사이드 점 */
function diceMissionReady() {
  if (diceOver()) return false;
  diceState(); missionState();
  return diceAttendReady() || D.events.diceBoard.missions.some((m, i) =>
    !S.dice.mClaimed.includes(i) && (S.dq.c[m.id] || 0) >= m.target);
}

function claimDiceMission(i) {
  diceState(); missionState();
  const m = D.events.diceBoard.missions[i];
  if (!m || S.dice.mClaimed.includes(i)) return;
  if ((S.dq.c[m.id] || 0) < m.target) return;
  S.dice.mClaimed.push(i);
  S.dice.rolls += m.rolls;
  save(); syncNav();
  toast(t('주사위 +{0}', m.rolls));
  renderDiceBoard(); renderDiceMissions(); syncDiceDots();
}

/** 버튼 안에 넣는 작은 주사위. 이모지는 기기마다 모양이 달라 에셋을 쓴다 */
const diceIco = () => `<img class="dc-ico" src="/assets/ui/EV-DICE-5.png" alt=""`
  + ` onerror="this.replaceWith(document.createTextNode('\u{1F3B2}'))">`;

/** 주사위 눈 — 에셋(EV-DICE-N)이 있으면 그림, 없으면 숫자. 한 번 실패하면 기억한다 */
let diceImgOk = true;
function setDiceFace(el, n) {
  if (!el) return;
  if (!diceImgOk) { el.textContent = n; return; }
  el.innerHTML = `<img src="/assets/ui/EV-DICE-${n}.png" alt="${n}"
    onerror="this.parentNode.textContent='${n}';window.__diceImgFail=1">`;
  if (window.__diceImgFail) diceImgOk = false;
}

/** 한정 상품 설명 — 진열장 카드를 누르면 뜬다. 효과·조건·보유 상태를 한 창에 */
function openPrizeInfo(i) {
  const r = D.events.diceBoard.rollRewards[i];
  if (!r) return;
  const got = r.title ? S.profile.ownedTitles.includes(r.title)
    : r.profile_frame ? (S.profile.ownedFrames || []).includes(r.profile_frame)
    : S.cosmetics.owned.includes(r.cosmetic);
  const img = r.cosmetic ? '/assets/captain/EV-WING1.png'
    : r.profile_frame ? '/assets/ui/PF-S1.png' : '/assets/ui/IC-QUEST.png';
  const ttl = $('#smTitle'); if (ttl) ttl.textContent = t('한정 상품');
  $('#smBody').innerHTML = `
    <div class="pz-hero"><img src="${img}" alt="" onerror="this.remove()"></div>
    <div class="pz-name">${r.kindKo} · <b>${r.nameKo}</b></div>
    <div class="frow"><span class="k">${t('효과')}</span>
      <span class="v" style="font-size:11px">${t('전투력 +{0}%', (r.cpBonus * 100).toFixed(1).replace('.0', ''))}</span></div>
    <div class="frow"><span class="k">${t('획득 조건')}</span>
      <span class="v" style="font-size:11px">${t('누적 굴림 {0}회', r.rolls)}${
        r.cosmetic ? ` · ${t('또는 날개 칸 0.1%')}` : ''}</span></div>
    <div class="frow"><span class="k">${t('보유')}</span>
      <span class="v">${got ? '✓' : `${num(S.dice.totalRolls || 0)}/${r.rolls}`}</span></div>
    <div class="sh-note">${r.descKo}${r.cosmetic
      ? `<br>${t('획득 즉시 장착되어 전투 화면에 표시됩니다')}` : ''}</div>`;
  $('#smPop').classList.add('show');
}

/** 주사위 유료 구매 — 이 이벤트의 BM. 유료 굴림도 확정 트랙(totalRolls)을 똑같이 센다 */
function buyRolls(i) {
  const o = (D.events.diceBoard.rollShop?.options || [])[i];
  if (!o) return;
  if (S.dia < o.diamond) return toast(`다이아 ${num(o.diamond - S.dia)} 부족`);
  S.dia -= o.diamond;
  S.dice.rolls += o.n;
  save(); renderTop(); syncNav();
  toast(t('주사위 +{0}', o.n));
  renderDiceBoard();
}

let diceBusy = false;                  // 굴리는 동안 연타 금지

async function rollDice() {
  const d = diceState();
  const E = D.events.diceBoard;
  if (diceBusy) return;
  if (d.rolls < 1) return toast(t('미션을 깨서 주사위를 얻으세요'));
  diceBusy = true;
  d.rolls--;
  S.dice.totalRolls = (S.dice.totalRolls || 0) + 1;
  const step = 1 + ((Math.random() * 6) | 0);
  const face = $('#dcFace');
  for (let i = 0; i < 7; i++) {
    setDiceFace(face, 1 + ((Math.random() * 6) | 0));
    await new Promise(r => setTimeout(r, 70));
  }
  setDiceFace(face, step);
  // 토큰이 한 칸씩 걷는다 — 순간이동이면 보드가 장식이 된다
  for (let i = 0; i < step; i++) {
    S.dice.pos = (S.dice.pos + 1) % E.cells.length;
    renderDiceBoard();
    if (S.dice.pos === 0) {            // 완주
      S.dice.laps++;
      const got = passGrant(E.lapBonus);
      if (got.pairs.length) gainToast(got.pairs);
      toast(t('완주! {0}바퀴째', S.dice.laps + 1));
    }
    await new Promise(r => setTimeout(r, 190));
  }
  const cell = E.cells[S.dice.pos];
  if (cell.type === 'grant') {
    const got = passGrant(cell.grant);
    if (got.pairs.length) gainToast(got.pairs);
  } else if (cell.type === 'gold_h') {
    const g = idleGold(cell.v);
    S.gold += g;
    gainToast([['gold', g]]);
  } else if (cell.type === 'again') {
    d.rolls++;
    toast(t('한 번 더!'));
  } else if (cell.type === 'wing') {
    // 얼리 잭팟 — 0.1%. 확정 경로(rollRewards 90회)가 따로 있어 여기는 순수 운이다
    if (!S.cosmetics.owned.includes('wing_launch') && Math.random() < cell.chance) {
      grantCosmetic('wing_launch', t('단장 날개 [축제의 날개]'));
    } else {
      const got = passGrant(cell.fallback);
      if (got.pairs.length) gainToast(got.pairs);
      toast(t('아쉽! 위로 보상을 받았습니다'));
    }
  }
  claimRollRewards();
  save(); renderTop(); syncNav();
  diceBusy = false;
  renderDiceBoard();
}

/** 한정 코스메틱 지급 + 즉시 장착 — 보여야 자랑이 된다 */
function grantCosmetic(id, label) {
  if (S.cosmetics.owned.includes(id)) return;
  S.cosmetics.owned.push(id);
  S.cosmetics.wing = id;
  toast(t('한정 획득: {0}', label));
  refreshParty();
  renderEquip();          // 하단 인벤 날개 칸이 잠금에서 실물로 바뀐다
}

/** 누적 굴림 한정 상품 — 전부 코스메틱 (rollRewardsNote). 굴릴 때마다 확인한다 */
function claimRollRewards() {
  for (const r of D.events.diceBoard.rollRewards || []) {
    if ((S.dice.totalRolls || 0) < r.rolls) continue;
    if (r.title && !S.profile.ownedTitles.includes(r.title)) {
      S.profile.ownedTitles.push(r.title);
      toast(t('한정 칭호 획득: {0}', r.nameKo));
    } else if (r.profile_frame) {
      S.profile.ownedFrames = S.profile.ownedFrames || [];
      if (!S.profile.ownedFrames.includes(r.profile_frame)) {
        S.profile.ownedFrames.push(r.profile_frame);
        toast(t('한정 획득: {0}', r.nameKo));
      }
    } else if (r.cosmetic) {
      grantCosmetic(r.cosmetic, r.nameKo);
    }
  }
  save();
}

/** 보드만 다시 그린다 — 걷는 애니메이션이 프레임마다 부른다 */
function renderDiceBoard() {
  const el = $('#dcBoard');
  if (!el) return;
  const E = D.events.diceBoard;
  // 16칸을 5x5 테두리에 감는다. 코너(0/4/8/12)가 특별칸 — 모노폴리 문법
  const ring = [[0,0],[0,1],[0,2],[0,3],[0,4],[1,4],[2,4],[3,4],
                [4,4],[4,3],[4,2],[4,1],[4,0],[3,0],[2,0],[1,0]];
  el.innerHTML = E.cells.map((c, i) => {
    const [r, col] = ring[i];
    const here = i === S.dice.pos;
    const corner = i % 4 === 0;
    let inner = '';
    if (c.type === 'grant') {
      const [k, v] = Object.entries(c.grant)[0];
      inner = `<img src="/assets/ui/${CUR_ICON[k]}.png" alt=""><b>${num(v)}</b>`;
    } else if (c.type === 'gold_h') {
      // "4h" 는 얼마를 받는지 안 알려 준다. 지금 내 진행도로 환산한 액수를 적는다
      inner = `<img src="/assets/ui/CU-04.png" alt=""><b>${num(idleGold(c.v))}</b>`;
    } else if (c.type === 'again') {
      // 주사위 그림이 있으면 그림, 없으면 이모지 — setDiceFace 와 같은 폴백
      inner = `<i><img src="/assets/ui/EV-DICE-1.png" alt="🎲"
        onerror="this.replaceWith('🎲')"></i><b>+1</b>`;
    } else if (c.type === 'wing') {
      // 날개 얼리 잭팟 — 확률은 공시 의무 대상이라 칸에 바로 적는다
      inner = `<i><img src="/assets/captain/EV-WING1.png" alt="🪽"
        onerror="this.replaceWith('🪽')"></i><b>${(c.chance * 100).toFixed(1)}%</b>`;
    } else {
      inner = `<b>${t('출발')}</b>`;
    }
    return `<div class="dc-cell t-${c.type}${here ? ' here' : ''}${
        corner ? ' corner' : ''}${c.jackpot ? ' jackpot' : ''}"
        style="grid-row:${r + 1};grid-column:${col + 1}">
      ${inner}
      ${here ? `<img class="dc-tok" src="/assets/captain/captain_face_normal.png" alt=""
        onerror="this.remove()">` : ''}
    </div>`;
  }).join('');
  const d = diceState();
  const rl = $('#dcRolls'); if (rl) rl.textContent = d.rolls;
  const btn = $('#dcRoll'); if (btn) btn.disabled = diceBusy || d.rolls < 1;
}

/**
 * 게이지 칸 수. **목표치 그대로**가 기본이다 — 1/1 은 한 칸, 0/10 은 열 칸이라
 * 몇 번 남았는지가 눈으로 세어진다. 다만 50회짜리를 50칸으로 그리면 칸이
 * 실오라기가 되므로, 20칸을 넘으면 5의 배수로 묶어 20칸 아래로 내린다.
 */
function mqSeg(target) {
  let n = Math.max(1, target | 0);
  while (n > 20) n = Math.ceil(n / 5);
  return n;
}

/** 미션 목록 — 진행도는 일일 임무 카운터에서 온다 */
function renderDiceMissions() {
  const el = $('#dcMissions');
  if (!el) return;
  diceState(); missionState();
  const E = D.events.diceBoard;
  // 출석 미션이 맨 위 — 구 7일 축제. 7일차까지는 그 일차 축제 보상이 함께 나온다
  const fd = D.dailies.newbie7Day.days[S.ev7.day];
  const attended = !diceAttendReady();
  const attRow = `<div class="mq-row${attended ? ' done' : ''}">
    <div class="mq-h"><b>${t('매일 출석')}${fd
      ? ` <u class="dc-fest">${t('{0}일차 축제 보상', fd.day)}</u>` : ''}</b>
      <span>${attended ? '1/1' : '0/1'}</span></div>
    <div class="mq-bar" style="--seg:1"><i style="width:${attended ? 100 : 0}%"></i></div>
    <button class="dc-mbtn rt-b${attended ? '' : ' go'}" id="dcAttend"
      ${attended ? 'disabled' : ''}>${attended ? '✓' : `${diceIco()}+${E.attendMission.rolls}`}</button>
  </div>`;
  el.innerHTML = attRow + D.events.diceBoard.missions.map((m, i) => {
    const cur = Math.min(m.target, S.dq.c[m.id] || 0);
    const done = S.dice.mClaimed.includes(i);
    const can = !done && cur >= m.target;
    return `<div class="mq-row${done ? ' done' : ''}">
      <div class="mq-h"><b>${t(m.nameKo)}</b><span>${cur}/${m.target}</span></div>
      <div class="mq-bar" style="--seg:${mqSeg(m.target)}"><i
        style="width:${cur / m.target * 100}%"></i></div>
      <button class="dc-mbtn rt-b${can ? ' go' : ''}" data-dcm="${i}" ${can ? '' : 'disabled'}>
        ${done ? '✓' : `${diceIco()}+${m.rolls}`}</button>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-dcm]').forEach(b =>
    b.addEventListener('click', () => claimDiceMission(+b.dataset.dcm)));
  $('#dcAttend')?.addEventListener('click', claimDiceAttend);
}

// ── 이벤트 ────────────────────────────────────────────────
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
  // 출시 간판 — 냥냥 주사위 (7일 축제 통합). D-day 가 붙는다
  const dd = diceState();
  const left = evDaysLeft(D.events.diceBoard.durationDays);
  const over = left <= 0;
  banners.push(`<button class="evb${over ? ' end' : ''}" data-ev="dice"
      style="--img:url(/assets/ui/EV-01.webp)">
    <span class="evb-tag">${over ? t('종료') : t('출시 기념')}</span>
    ${over ? '' : `<span class="evb-dday">D-${left}</span>`}
    <b>${t('냥냥 주사위')}</b>
    <span class="evb-sub">${over ? t('이벤트가 끝났습니다')
      : t('주사위 {0}개 · 누적 {1}회', dd.rolls, num(S.dice.totalRolls || 0))}</span>
    ${!over && (dd.rolls > 0 || diceMissionReady()) ? `<i class="evb-dot"></i>` : ''}
  </button>`);
  // 무료 1000뽑 — 진행형이라 기간이 없다
  const pendN = f1kPendingN();
  banners.push(`<button class="evb${nx || pendN ? '' : ' end'}" data-ev="free1000"
      style="--img:url(/assets/ui/EV-02.webp)">
    <span class="evb-tag">${nx || pendN ? t('진행 중') : t('종료')}</span>
    <b>${t('무료 1000뽑')}</b>
    <span class="evb-sub">${pendN
      ? t('받을 수 있는 소환권 {0}장', num(pendN))
      : `${num(S.f1k.total)} / 1000${nx ? ` · ${t('다음: 스테이지 {0}', nx.stage)}` : ''}`}</span>
    <span class="evb-bar"><i style="width:${S.f1k.total / 10}%"></i></span>
    ${pendN ? `<i class="evb-dot"></i>` : ''}
  </button>`);

  $('#ovt').textContent = t('이벤트');
  setSkin('event');
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

  if (false) {
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
  }
  if (id === 'dice') {
    const E = D.events.diceBoard;
    const d = diceState();
    const left = evDaysLeft(E.durationDays);
    h.length = 1;
    // 상세에는 머리 배너도 축제 히어로도 안 쓴다. 목록에서 이미 본 그림이고,
    // 둘 다 자리를 먹어 정작 주사위판이 스크롤 밖으로 밀렸다. 남은 기간만 한 줄
    h.push(`<div class="dc-head">
      <b>${t('출시 기념 냥냥 주사위')}</b>
      <u>${left > 0 ? `D-${left}` : t('종료')}</u>
    </div>`);
    // 탭 — 미션이 화면 밑바닥에 있으면 "주사위를 어디서 얻나" 가 안 보인다.
    // 주사위가 없을 때는 미션 쪽을 먼저 펴 준다
    const dTab = S.dice.tab || (d.rolls > 0 ? 'board' : 'mission');
    h.push(`<div class="dc-tabs">
      <button class="${dTab === 'board' ? 'on' : ''}" data-dctab="board">${t('주사위판')}</button>
      <button class="${dTab === 'mission' ? 'on' : ''}" data-dctab="mission">${t('미션')}${
        diceMissionReady() ? '<i class="dot"></i>' : ''}</button>
      <button class="${dTab === 'shop' ? 'on' : ''}" data-dctab="shop">${t('상점')}</button>
    </div>`);
    if (dTab === 'shop') {
      // 주사위 상점 — 다이아 상품과 같은 카드 문법. 그림이 값의 크기를 말한다
      h.push('<div class="dc-store">' + (E.rollShop?.options || []).map((o, i) => `
        <button class="dc-item" data-dcbuy="${i}">
          ${o.tagKo ? `<u>${t(o.tagKo)}</u>` : ''}
          <img src="/assets/ui/${o.asset || 'EV-DICE-5'}.png" alt=""
            onerror="this.onerror=null;this.src='/assets/ui/EV-DICE-5.png'">
          <b>${t('주사위')} ${o.n}</b>
          <em><img src="/assets/ui/CU-01.png" alt="">${num(o.diamond)}</em>
        </button>`).join('') + '</div>');
    } else if (dTab === 'mission') {
      h.push(`<div class="lbl" style="margin:2px 0 6px">${t('주사위 미션')} · ${t('매일 초기화')}</div>`);
      h.push('<div id="dcMissions"></div>');
    } else {
    h.push(`<div class="dc-wrap">
      <div id="dcBoard"></div>
      <div class="dc-center">
        <span id="dcFace"></span>
        <button class="fgbtn" id="dcRoll">${t('굴리기')} <em id="dcRolls">${d.rolls}</em></button>
      </div>
    </div>`);
    // 상품은 **판과 같은 화면**에 있어야 한다 — 굴리면서 다음 목표가 보인다
    h.push(`<div class="dc-goal">${t('누적 굴림')}
      <b>${num(S.dice.totalRolls || 0)}${t('회')}</b></div>`);
    h.push('<div class="dc-shop">' + (E.rollRewards || []).map(r => {
      const got = r.title ? S.profile.ownedTitles.includes(r.title)
        : r.profile_frame ? (S.profile.ownedFrames || []).includes(r.profile_frame)
        : S.cosmetics.owned.includes(r.cosmetic);
      return `<button class="dc-prize${got ? ' got' : ''}${
          (S.dice.totalRolls || 0) >= r.rolls ? '' : ' far'}" data-prize="${(E.rollRewards).indexOf(r)}">
        <u>${r.rolls}${t('회')}</u><em>${r.kindKo}</em><b>${r.nameKo}</b>${got ? '<i>✓</i>' : ''}
      </button>`;
    }).join('') + '</div>');
    h.push(`<div class="frow"><span class="k">${t('완주 보상')}</span>
      <span class="v" style="font-size:11px">${Object.entries(E.lapBonus).map(([k, v]) =>
        `${CUR_KO[k] || k} ${num(v)}`).join(' · ')}</span></div>`);
    }
  }

  $('#ovt').textContent = t('이벤트');
  // 상세는 **배너 없이** 뜬다 — 목록에서 이미 본 그림을 또 깔면 같은 화면이
  // 두 번 나오고, "목록 위에 다른 창이 열렸다" 는 느낌이 안 산다
  $('#ovcard').classList.add('no-banner');
  $('#ovinfo').innerHTML = '';        // 설명이 없다 — ⓘ 버튼도 같이 사라진다
  $('#ovinfo').classList.remove('show');
  $('#ovb').innerHTML = h.join('');
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
  $('#evBack').addEventListener('click', openEvents);
  $('#f1kClaim')?.addEventListener('click', f1kClaim);
  $('#ovb').querySelectorAll('[data-dctab]').forEach(b =>
    b.addEventListener('click', () => { S.dice.tab = b.dataset.dctab; openEventDetail('dice'); }));
  if (id === 'dice') {
    // 탭마다 있는 요소가 다르다 — 판 탭에만 굴리기 버튼이 있으므로 없을 수도 있다
    renderDiceBoard(); renderDiceMissions();
    const face = $('#dcFace');
    if (face) setDiceFace(face, 1 + ((Math.random() * 6) | 0));   // 굴리기 전에도 주사위가 보인다
    $('#dcRoll')?.addEventListener('click', rollDice);
    $('#ovb').querySelectorAll('[data-dcbuy]').forEach(b =>
      b.addEventListener('click', () => { buyRolls(+b.dataset.dcbuy); }));
    $('#ovb').querySelectorAll('[data-prize]').forEach(b =>
      b.addEventListener('click', () => openPrizeInfo(+b.dataset.prize)));
  }
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

  $('#ovt').textContent = t('출석');
  setSkin('attend');
  $('#ovb').innerHTML = `
    <div class="at-grid">${cells}</div>
    <button class="fgbtn" id="atClaim" ${attendReady() ? '' : 'disabled'}>
      ${attendReady() ? t('{0}일차 출석 받기', (a.day % 7) + 1) : t('오늘 출석 완료')}</button>
    <div class="lbl" style="margin:10px 0 5px">${t('이번 달 누적 {0}', `<b style="color:var(--gold)">${t('{0}일', a.monthDays)}</b>`)}</div>
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

// ── 2차 전직 스킬 — 3차에 열린다. %가 아니라 전투의 리듬을 바꾸는 축 ──
const cs2Mine = () => S.promoClass && promoTier(S.promoClass) >= 3
  ? csDef().skills2[S.promoClass] : null;
const cs2Val = () => {
  const sk = cs2Mine();
  return sk ? Math.min(sk.max, (S.promoSkillLv2 || 0) * sk.perLevel) : 0;
};
const cs2Cost = () => Math.round(csDef().goldCost2.base
  * Math.pow(csDef().goldCost2.growth, S.promoSkillLv2 || 0));

function upgradeClassSkill2() {
  const sk = cs2Mine();
  if (!sk) return;
  if ((S.promoSkillLv2 || 0) >= csDef().maxLevel) return toast(t('최대 레벨입니다'));
  const c = cs2Cost();
  if (S.gold < c) return toast(`골드 ${num(c - S.gold)} 부족`);
  S.gold -= c;
  S.promoSkillLv2 = (S.promoSkillLv2 || 0) + 1;
  save(); refreshParty(); renderTop(); openPromotion();
}
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
  setSkin('promo');
  $('#ovh').classList.remove('has-cur');
  $('#ovb').innerHTML = `
    <div class="frow"><span class="k">${t('훈련소 레벨')}</span>
      <span class="v">Lv ${S.trainLv}</span></div>
    <div class="pr-note">${t('한 길만 갈 수 있습니다')} · ${t('그 직군 용병 전체가 함께 강해집니다')}</div>
    ${cards}
    ${(() => {
      const sk = csMine();
      if (!sk) return '';
      const lv = S.promoSkillLv || 0, mx = csDef().maxLevel;
      const pct = v => (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
      return `<div class="cs-card" style="--au:${PROMO_COL[promoTier(S.promoClass)]}">
        <img class="cs-fx" src="/assets/skill/${sk.fx}.png" alt="" onerror="this.remove()">
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
    ${(() => {
      if (!S.promoClass) return '';
      const sk2 = cs2Mine();
      const tier = promoTier(S.promoClass);
      if (!sk2) return '';
      const lv = S.promoSkillLv2 || 0, mx = csDef().maxLevel;
      const pct = v => (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
      return `<div class="cs-card" style="--au:${PROMO_COL[3]}">
        <img class="cs-fx" src="/assets/skill/${sk2.fx}.png" alt="" onerror="this.remove()">
        <div class="cs-body">
          <b>${sk2.nameKo} <i>Lv ${lv}</i></b>
          <span>${sk2.descKo.replace('{v}', pct(cs2Val()))}${lv < mx
            ? ` → <em>${pct(Math.min(sk2.max, (lv + 1) * sk2.perLevel))}</em>` : ''}</span>
        </div>
        ${lv < mx
          ? `<button class="fgbtn cs-up" id="csUp2" ${S.gold < cs2Cost() ? 'disabled' : ''}>
              <img src="/assets/ui/CU-04.png" alt=""> ${num(cs2Cost())}</button>`
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
  $('#csUp2')?.addEventListener('click', upgradeClassSkill2);
}

function openTraining() {
  const def = trainDef();
  const lv = S.trainLv;
  const cost = trainingCost(def, lv);
  const bonus = trainingBonus(def, lv);
  const next = trainingBonus(def, lv + 1);
  const maxed = lv >= def.maxLevel;

  $('#ovt').textContent = '용병단 훈련소';
  setSkin('training');
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
      <span class="nm"><b>${t('무한의 탑')}</b><span>${t('최고 {0}층 · 입장 제한 없음', T.best)}</span></span>
      <i>${t('{0}층', T.floor)} ›</i>
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
        style="--dg-art:url(/assets/dungeon/DG-${n}.webp),url(/assets/bg/${DG_BG[dg.id] || 'BG-01'}.webp)">
        <span class="nm">
          <b>${t(dg.nameKo)}</b>
          <span class="why">${open
            ? t('요구 {0} · 수령 {1}', num(need), num(yieldNow))
            : t(dg.purpose)}</span>
        </span>
        ${open
          ? `${sweepBtnHtml(dg, st)}
             <span class="ent">${t('{0}층', st.floor)}</span>
             <span class="keys"><img src="/assets/ui/${dg.keyId}.png" alt="열쇠"
               ><b>${dgKeysOf(dg.id)}<i>/${entries}</i></b></span>`
          : `<span class="ent lockv"><img class="lockIc" src="/assets/ui/IC-LOCK-S.png" alt="잠김"
             ><i>${t('퀘스트 {0}', dg.unlockQuest)}</i></span>`}
      </div>`;
    }).join('')
    + '</div>'
    + `<div class="sh-note">${t('열쇠는 매일 {0}개로 채워진다 (광고 +{1}).',
        entries, D.dungeons.entry.adBonus.entries)} ${t(D.dungeons.entry.failureCost)}</div>`;
}

/**
 * 소탕 단추. **한 번이라도 깬 층이 있어야** 뜬다 (1층에서 소탕할 것이 없다).
 * 깨 본 적 없는 층을 소탕으로 얻을 수 있으면 전투를 아예 안 하고 진행하게 된다.
 */
function sweepBtnHtml(dg, st) {
  const cleared = st.floor - 1;
  if (cleared < 1) return '';
  const keys = dgKeysOf(dg.id);
  return `<button class="dg-sweep${keys < 1 ? ' off' : ''}" data-sweep="${dg.id}"
    title="${cleared}층 보상 즉시 수령">소탕<i>${cleared}층</i></button>`;
}

/**
 * 소탕 — **이미 깬 최고층의 보상만** 즉시 받는다. 전투도 없고 층도 안 오른다.
 *
 * 진행은 직접 싸워야만 된다. 소탕으로 층이 오르면 그것은 소탕이 아니라
 * "전투를 안 보는 진행 수단"이고, 방금 걷어낸 스킵과 같은 물건이 된다.
 *
 * 열쇠는 입장과 똑같이 1개 쓴다. 소탕만 공짜면 일일 배출 상한이 무너진다
 * (dungeons.json > entry.model — 하루에 뭘 얼마나 돌 수 있는지가 곧 열쇠다).
 */
function sweepDungeon(dg) {
  if (dgRun || arRun) return;
  const st = S.dg[dg.id];
  const cleared = st.floor - 1;
  if (cleared < 1) return toast(`${dg.nameKo} — 1층을 먼저 돌파해야 소탕할 수 있습니다`);
  if (dgKeysOf(dg.id) < 1) {
    return toast(`${dg.nameKo} 열쇠 부족 · 매일 ${D.dungeons.entry.dailyKeyGrant}개 지급`);
  }
  S.dgKeys[dg.id]--;
  mq('dungeon_enter');          // 열쇠를 쓰는 입장이므로 입장 퀘스트는 센다.
                                // 층 퀘스트(dungeon_floor)는 층이 안 오르니 안 센다
  const gain = Math.round(dgYield(dg, cleared));
  const bag = DG_BAG[dg.reward];
  if (bag) S[bag] += gain;
  save(); renderTop(); renderQuest();
  openDungeons();               // 열쇠 숫자·소탕 단추 상태를 다시 그린다
  if (bag) gainToast([[dg.reward, gain]]);
  else toast(`${dg.nameKo} ${cleared}층 소탕`);
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
  // 소탕은 줄 **안에** 있다 — 전파를 막지 않으면 소탕과 입장이 같이 일어난다
  root.querySelectorAll('[data-sweep]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      sweepDungeon(D.dungeons.dungeons.find(d => d.id === b.dataset.sweep));
    }));
}

function openDungeons() { roster.open('dungeon'); }

// 용병 / 스킬 편성은 바텀시트로 뺐다 (view/roster.js). 화면 60% 를 쓰고
// 전체 목록 + [자동강화]·[자동장착] 을 담아야 해서 가운데 카드로는 좁았다.

const tierOf = score => {
  const t = [...D.arena.tiers].reverse().find(x => score >= x.minScore);
  return t ? t.nameKo : D.arena.tiers[0].nameKo;
};

/** 아레나. arena.json > battle.winProbability 로 예상 승률을 보여준다. */
// ── 연합 게이트 — 미가입이면 생성/가입부터 ─────────────────
/**
 * 연합 목록. 서버가 붙어 있으면 컬렉션(`allianceList`), 아니면 데모다.
 * 필드 이름을 서버 쪽(`name` / `members` / `weekly` / `__id`)에 맞춰 데모도 같이 낸다 —
 * 화면이 두 벌이 되지 않게 하는 것이 이 층의 존재 이유다.
 */
function allianceRows() {
  const rows = live.get('alliances');
  return rows ? rows.map(a => ({
    id: a.__id, name: a.name, members: a.members || 0, weekly: a.weekly || 0,
  })) : demoAlliances();
}

/** 데모 연합 목록 — 서버가 없을 때. 날짜 시드라 하루 동안은 같은 목록이다 */
function demoAlliances() {
  const day = dayIdx(Date.now());
  const rng = k => { const x = Math.sin(day * 733 + k * 191) * 10000; return x - Math.floor(x); };
  const NAMES = ['츄르 원정대', '캣타워 수호자', '연어 동맹', '골골단', '낮잠 기사단',
    '수염 특공대', '방울 연구소', '츤데레 냥단'];
  return NAMES.slice(0, 5 + (day % 3)).map((name, i) => ({
    id: 'demo_' + i, name,
    members: 8 + Math.floor(rng(i) * 20),
    weekly: Math.floor(rng(i + 9) * 90000),
  }));
}

function openAllianceGate() {
  const A = D.alliance;
  const need = A.membership.joinRequirement.minStage;
  const coolMs = A.membership.leaveCooldownHours * 3600e3;
  const coolLeft = S.allyLeftAt ? Math.max(0, S.allyLeftAt + coolMs - Date.now()) : 0;
  const canJoin = S.maxStage >= need && coolLeft <= 0;
  const cost = A.membership.createCost.diamond;
  const rows = allianceRows().map(a => `
    <div class="frow" style="padding:8px 11px;margin-bottom:5px">
      <span><b style="font-size:12px">${a.name}</b>
        <span class="k" style="display:block">${t('단원 {0} / {1}', a.members, A.membership.maxMembers)}
          · ${t('주간 기여 {0}', num(a.weekly))}</span></span>
      <button class="rt-b go" data-join="${a.id}" data-name="${a.name}"
        ${canJoin ? '' : 'disabled'}>${t('가입')}</button>
    </div>`).join('');

  $('#ovt').textContent = t('연합');
  setSkin('alliance');
  $('#ovh').classList.remove('has-cur');
  $('#ovinfo').innerHTML = `<div class="sub" style="line-height:1.5">${A.membership.maxMembersNote}</div>`;
  $('#ovb').innerHTML = `
    ${S.maxStage < need ? `<div class="pr-note" style="color:var(--warn)">${t('스테이지 {0} 부터 연합에 들어갈 수 있습니다', need)}</div>` : ''}
    ${coolLeft > 0 ? `<div class="pr-note" style="color:var(--warn)">${t('탈퇴 후 {0} 뒤에 가입할 수 있습니다', dur(Math.ceil(coolLeft / 1000)))}</div>` : ''}
    <div class="cs-card" style="--au:var(--gold)">
      <img class="cs-fx" src="/assets/alliance/AL-04.png" alt="" onerror="this.remove()">
      <div class="cs-body"><b>${t('연합 만들기')}</b>
        <span>${t('내가 단장이 됩니다')} · <img src="/assets/ui/CU-01.png" alt=""
          style="width:11px;height:11px;vertical-align:-2px"> ${num(cost)}</span></div>
      <button class="fgbtn cs-up" id="alCreate"
        ${canJoin && S.dia >= cost ? '' : 'disabled'}>${t('만들기')}</button>
    </div>
    <div class="lbl" style="margin:10px 0 6px">${t('가입할 수 있는 연합')}</div>
    ${rows}
    `;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

  $('#alCreate')?.addEventListener('click', async () => {
    const name = prompt(t('연합 이름 (2~12자)'));
    if (!name) return;
    if (name.length < 2 || name.length > 12) return toast(t('이름은 2~12자입니다'));
    if (S.dia < cost) return toast(t('다이아 부족'));
    if (live.liveReady()) {
      // 다이아는 **서버가 깎는다** (server.js > allianceCreate). 여기서 미리 깎으면
      // 이름 중복으로 실패했을 때 되돌려 줄 곳이 없다
      const r = await live.createAlliance(name, S.maxStage || 0, Math.round(totalCp()))
        .catch(e => ({ ok: false, reason: String(e && e.message || e) }));
      if (!r?.ok) return toast(t(ALLY_ERR[r?.reason] || '연합을 만들지 못했습니다'));
      S.ally = { id: r.alliance.__id, name, role: 'leader', joinedAt: Date.now() };
      live.invalidate('alliances', 'myAlliance', 'boss');
      await syncSaveFromServer();
    } else {
      S.dia -= cost;
      S.ally = { id: 'mine', name, role: 'leader', joinedAt: Date.now() };
    }
    save(); renderTop();
    toast(t('연합 [{0}] 창설!', name));
    $('#ov').classList.remove('show');
    alli.open();
  });
  $('#ovb').querySelectorAll('[data-join]').forEach(b =>
    b.addEventListener('click', async () => {
      if (live.liveReady()) {
        const r = await live.joinAlliance(b.dataset.join, S.maxStage || 0, Math.round(totalCp()))
          .catch(e => ({ ok: false, reason: String(e && e.message || e) }));
        if (!r?.ok) return toast(t(ALLY_ERR[r?.reason] || '가입하지 못했습니다'));
        live.invalidate('alliances', 'myAlliance', 'boss');
      }
      S.ally = { id: b.dataset.join, name: b.dataset.name, role: 'member', joinedAt: Date.now() };
      save();
      toast(t('연합 [{0}] 가입!', b.dataset.name));
      $('#ov').classList.remove('show');
      alli.open();
    }));

  // 목록이 늦게 오면 그때 다시 그린다. 처음 열 때는 캐시(또는 데모)로 즉시 뜬다 —
  // 빈 화면을 보여 주고 기다리게 하지 않는다
  live.pullAlliances(() => {
    if ($('#ov').classList.contains('show') && $('#ovt').textContent === t('연합')) openAllianceGate();
  });
}

/** 서버가 돌려주는 실패 사유 → 사람 말. 사유를 그대로 띄우면 유저가 영어를 읽는다 */
const ALLY_ERR = {
  stage: '스테이지가 모자랍니다',
  already: '이미 연합에 속해 있습니다',
  diamond: '다이아가 부족합니다',
  gold: '골드가 부족합니다',
  name_taken: '같은 이름의 연합이 있습니다',
  full: '정원이 찼습니다',
  gone: '없어진 연합입니다',
  cooldown: '탈퇴 대기 시간이 남았습니다',
  none: '연합에 속해 있지 않습니다',
  daily: '오늘 기부를 다 했습니다',
  order: '기부 순서가 어긋났습니다',
  no_tries: '이번 주 도전을 다 썼습니다',
  closed: '보스가 닫혀 있습니다',
};

/**
 * 연합 소속을 서버 기준으로 맞춘다.
 *
 * **소속의 진실은 서버에 있다** (allyMembers 컬렉션). 로컬 `S.ally` 는 화면이
 * 읽는 사본일 뿐인데, 두 값이 갈리는 경로가 실제로 있다:
 *   · 다른 기기에서 탈퇴 — 로컬은 아직 소속이라 믿고 연합 화면을 연다
 *   · 단장이 연합을 해산 — 없어진 연합의 게시판이 계속 열린다
 *   · 다른 기기에서 가입 — 이 기기는 가입 화면부터 다시 보여 준다
 * 부팅 때 한 번 맞춰 두면 그 뒤로는 화면이 서버와 같은 것을 본다.
 */
function syncAllyFromServer() {
  const my = live.get('myAlliance');
  if (my?.alliance) {
    S.ally = {
      id: my.alliance.__id,
      name: my.alliance.name,
      role: my.me?.role || 'member',
      joinedAt: my.me?.joinedAt || Date.now(),
    };
  } else if (S.ally) {
    // 서버가 "소속 없음" 이라고 한다. 로컬 기록을 지운다 —
    // 탈퇴 쿨다운(allyLeftAt)은 서버가 따로 세므로 여기서 새로 찍지 않는다
    S.ally = null;
  }
  save();
}

/**
 * 서버가 세이브 안의 재화를 깎은 뒤 클라를 맞춘다.
 * 연합 창설비·기부처럼 **서버가 깎는** 것들이 있어서(server.js > spendDia),
 * 이걸 안 하면 화면의 다이아가 낡은 값으로 남고 다음 saveState 가 그걸 되돌려 쓴다.
 */
async function syncSaveFromServer() {
  const sv = (typeof window !== 'undefined' && window.__V8_SERVER) || null;
  if (!sv) return;
  try {
    const cloud = await sv.remoteFunction('loadState', []);
    if (!cloud?.s) return;
    // 재화만 가져온다. 진행도까지 통째로 덮으면 방금 전 전투 결과가 날아간다
    for (const k of ['dia', 'gold']) if (typeof cloud.s[k] === 'number') S[k] = cloud.s[k];
  } catch (e) { console.warn('[live] 재화 동기화 실패', e); }
}

// ── 친구 — 선물은 보내는 쪽 코스트가 없다 ──────────────────
// 서로 보내면 서로 이득이라 매일 누를 이유가 생긴다. 액수는 방치 골드
// 공식에 물려 진행도 비례 (고정액은 후반에 휴지조각).
const FRIEND_GIFT_HOURS = 0.2;          // 친구 1명당 방치 12분 분량
const FRIEND_MAX = 30;

const FR_FACES = ['normal', 'happy', 'surprise', 'trouble'];
const FR_CLS = ['warrior', 'archer', 'mage'];

function demoFriends() {
  // publicProfile() 과 같은 필드만 — 서버가 붙으면 findProfiles() 가 준다
  const NAMES = ['까칠한 츄르', '엉덩이 탐정', '식빵 굽는 냥', '새벽 야옹', '츄르 도둑'];
  const CLS = ['warrior', 'archer', 'mage'];
  return NAMES.map((name, i) => ({
    id: 'f' + i, name,
    cp: Math.round(totalCp() * (0.6 + i * 0.2)),
    stage: Math.max(1, (S.maxStage || 1) + (i - 2) * 5),
    capCls: CLS[i % 3],
  }));
}

/** 친구 아바타 — 단장 표정 + 프로필 프레임. i 시드라 항상 같은 얼굴이다 */
const friendAvatar = (i, px, frame) => `
  <span class="fr-av" style="width:${px}px;height:${px}px">
    <img class="fr-face" src="/assets/captain/captain_face_${FR_FACES[i % 4]}.png" alt="">
    <img class="fr-ring" src="/assets/ui/PFRAME-0${((frame ?? i) % 4) + 1}.png" alt=""
      onerror="this.remove()">
  </span>`;

/** 친구 프로필 — 목록에서 이름을 누르면 온다. 데모라 수치는 i 시드 */
function openFriendProfile(i) {
  const f = friendState();
  const x = f.list[i];
  if (!x) return;
  // 화면이 지어내면 안 된다 — 서버가 주는 필드만 읽는다 (publicProfile)
  const cls = x.capCls || FR_CLS[i % 3];
  const clsKo = { warrior: '전사', archer: '궁수', mage: '마법사' }[cls];
  const stage = x.stage ?? 0;
  const sent = f.sent.includes(x.id), got = f.recv.includes(x.id);
  const gift = idleGold(FRIEND_GIFT_HOURS);

  $('#ovt').textContent = x.name;
  setSkin('friend');
  $('#ovh').classList.remove('has-cur');
  $('#ovinfo').innerHTML = '';
  $('#ovb').innerHTML = `
    <div class="fr-hero">
      ${friendAvatar(i, 92)}
      <b>${x.name}</b>
      <span class="fr-cls"><img src="/assets/skill/CS-${cls[0].toUpperCase()}1.png" alt=""
        onerror="this.remove()">${t(clsKo)} ${t('단장')}</span>
    </div>
    <div class="frow"><span class="k">${t('전투력')}</span><span class="v">${num(x.cp)}</span></div>
    <div class="frow"><span class="k">${t('최고 스테이지')}</span><span class="v">${stage}</span></div>
    <div class="frow"><span class="k">${t('오늘 선물')}</span>
      <span class="v">${sent ? t('보냄 ✓') : t('안 보냄')} · ${got ? t('받음 ✓') : t('안 받음')}</span></div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="fgbtn" data-fsend="${x.id}" ${sent ? 'disabled' : ''} style="flex:1">
        ${sent ? t('선물 보냄') : t('선물 보내기')}</button>
      <button class="fgbtn" data-frecv="${x.id}" ${got ? 'disabled' : ''} style="flex:1">
        ${got ? t('받았습니다') : `${t('받기')} +${num(gift)}`}</button>
    </div>
    <button class="rt-b" id="frBack" style="width:100%;margin-top:8px">‹ ${t('친구 목록')}</button>`;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

  $('#frBack').addEventListener('click', openFriends);
  $('#ovb').querySelector('[data-fsend]')?.addEventListener('click', e => {
    if (!f.sent.includes(x.id)) f.sent.push(x.id);
    save(); syncNav(); openFriendProfile(i);
  });
  $('#ovb').querySelector('[data-frecv]')?.addEventListener('click', e => {
    if (!f.recv.includes(x.id)) {
      f.recv.push(x.id); S.gold += gift;
      save(); renderTop(); syncNav(); gainToast([['gold', gift]]);
    }
    openFriendProfile(i);
  });
}

/**
 * 친구 상태.
 *
 * 서버가 붙으면 목록은 서버가 주고(friendList), **선물 주고받기 기록은 로컬**이다 —
 * 선물은 내 골드만 늘리는 일방 행위라 상대 계정을 만지지 않는다. 서버에 올릴
 * 이유가 생기는 건 "상대가 보낸 것을 내가 받는다" 로 바꿀 때다.
 * 그때는 우편(mail)으로 가는 게 맞고, 지금 구조로는 못 한다.
 */
function friendState() {
  const day = dayIdx(Date.now());
  const rows = live.get('friends');
  if (rows) {
    // id = account. 선물 기록(sent/recv)이 이 id 로 걸려 있어 키를 바꾸면 안 된다
    S.friends.list = rows.map(x => ({
      id: x.account, name: x.nickname || '단장', cp: x.cp || 0,
      stage: x.stage || 1, capCls: x.capCls || 'warrior',
    }));
  } else if (!S.friends.list.length && !live.liveReady()) {
    S.friends.list = demoFriends();   // 서버가 없을 때만
  }
  if (S.friends.day !== day) {
    S.friends.day = day;
    S.friends.sent = [];      // 오늘 선물 보낸 친구 id
    S.friends.recv = [];      // 오늘 선물 받은(수령한) 친구 id
  }
  return S.friends;
}
const friendGiftReady = () => {
  const f = friendState();
  const box = live.get('giftBox');
  // 서버가 붙으면 **받을 게 실제로 있을 때**만 뱃지를 띄운다. 보낼 곳이 남은 것도
  // 뱃지 사유다 — 보내는 쪽이 공짜라 매일 누를 이유가 그것이다
  if (box) return (box.inbox || []).length > 0
    || f.list.some(x => !(box.sent || []).includes(x.id));
  return f.list.some(x => !f.sent.includes(x.id) || !f.recv.includes(x.id));
};

// 신청 목록은 10초마다 새로 고칠 수 있다. 후보는 시드로 만들어서
// 새로 고치기 전까지는 같은 얼굴이 남는다 (서버 연동 전 자리)
const FRIEND_REFRESH_SEC = 10;
const FR_SURNAME = ['까칠한', '엉덩이', '식빵 굽는', '새벽', '츄르', '골골', '낮잠',
  '수염', '방울', '츤데레', '통통한', '발라당', '창가의', '지붕 위'];
const FR_NAME = ['츄르', '탐정', '냥', '야옹', '도둑', '기사', '사냥꾼', '집사',
  '대장', '학자', '나그네', '요리사'];

/**
 * 신청 후보. 서버가 붙으면 **실제 프로필 표본**(findProfiles) 이고,
 * 아니면 seed 로 지어낸 얼굴이다. 이미 친구거나 신청을 보낸 계정은 뺀다.
 */
function friendCandidates(seed, n = 6) {
  const rows = live.get('friendCands');
  if (rows?.length) {
    const f = friendState();
    const mine = new Set([...f.list.map(x => x.id), ...(f.req || [])]);
    return rows.filter(x => !mine.has(x.account)).slice(0, n).map((x, i) => ({
      id: x.account, name: x.nickname || '단장', cp: x.cp || 0,
      face: i % 4, frame: i % 4,
    }));
  }
  return demoFriendCandidates(seed, n);
}

/** 서버가 없을 때의 후보. seed 가 같으면 같은 목록이다 */
function demoFriendCandidates(seed, n = 6) {
  const rng = k => { const x = Math.sin(seed * 977 + k * 131) * 10000; return x - Math.floor(x); };
  const f = friendState();
  const mine = new Set([...f.list.map(x => x.id), ...(f.req || [])]);
  const out = [];
  for (let i = 0; out.length < n && i < n * 4; i++) {
    const id = 'c' + seed + '_' + i;
    if (mine.has(id)) continue;
    out.push({
      id,
      name: `${FR_SURNAME[Math.floor(rng(i) * FR_SURNAME.length)]} ${
        FR_NAME[Math.floor(rng(i + 40) * FR_NAME.length)]}`,
      cp: Math.round(totalCp() * (0.35 + rng(i + 80) * 1.5)),
      face: Math.floor(rng(i + 120) * 4),
      frame: Math.floor(rng(i + 160) * 4),
    });
  }
  return out;
}

/**
 * 나에게 온 신청. 서버가 붙으면 friendReq 컬렉션이다.
 * `id` 는 **신청 아이템의 `__id`** 다 — 수락/거절이 그걸로 컬렉션을 지운다.
 */
function friendIncoming() {
  const reqs = live.get('friendReqs');
  if (reqs) return reqs.map((r, i) => ({
    id: r.__id, account: r.from, name: r.fromNick || '단장',
    cp: r.fromCp || 0, face: i % 4, frame: i % 4,
  }));
  const f = friendState();
  f.inbox = f.inbox || [];
  return f.inbox;
}

/** 신청 목록 새로 고침. 쿨다운이 남았으면 남은 초를 돌려준다 */
function friendRefresh(force = false) {
  const f = friendState();
  const now = Date.now();
  const left = Math.ceil((f.reqAt || 0) + FRIEND_REFRESH_SEC * 1000 - now) / 1000;
  if (!force && left > 0) return Math.ceil(left);
  f.reqAt = now;
  f.seed = (f.seed || 1) + 1;
  if (live.liveReady()) {
    // 서버가 있으면 표본을 새로 받는다. 지어낸 신청은 더 이상 안 만든다.
    // **새로 고침은 캐시를 버리는 것이 곧 새로 고침이다** — 안 버리면 pull 이
    // 신선하다고 판단해 그대로 돌아온다
    live.invalidate('friendCands', 'friendReqs');
    const redraw = () => { if ($('#ov').classList.contains('show')) openFriendRequests(); };
    live.pullFriendCands(totalCp(), redraw);
    live.pullFriendReqs(redraw);
    return 0;
  }
  // 새로 고치면 이따금 나에게도 신청이 들어와 있다 — 목록이 살아 있다고 읽힌다
  f.inbox = f.inbox || [];
  if (f.list.length < FRIEND_MAX && Math.random() < 0.6) {
    const c = friendCandidates(f.seed + 500, 2);
    for (const x of c) if (!f.inbox.some(y => y.id === x.id)) f.inbox.push(x);
  }
  return 0;
}

/** 서버 실패 사유 → 사람 말 */
const FR_ERR = {
  already_friend: '이미 친구입니다',
  already_sent: '이미 신청을 보냈습니다',
  target: '보낼 수 없는 상대입니다',
  not_mine: '내게 온 신청이 아닙니다',
};

/** 친구 목록에 넣는다. 정원을 넘으면 거절한다 */
function friendAdd(x) {
  const f = friendState();
  if (f.list.length >= FRIEND_MAX) { toast(t('친구가 가득 찼습니다')); return false; }
  if (f.list.some(y => y.id === x.id)) return false;
  f.list.push({ id: x.id, name: x.name, cp: x.cp });
  return true;
}

/** 친구 신청 화면 — 받은 신청이 위, 추천이 아래 */
function openFriendRequests() {
  const f = friendState();
  if (!f.seed) friendRefresh(true);
  const inbox = friendIncoming();
  const cands = friendCandidates(f.seed);
  const left = Math.ceil(((f.reqAt || 0) + FRIEND_REFRESH_SEC * 1000 - Date.now()) / 1000);

  const row = (x, i, kind) => `<div class="frow fr-row" style="padding:7px 9px;margin-bottom:5px">
      ${friendAvatar(x.face ?? i, 40, x.frame)}
      <span style="flex:1;min-width:0"><b style="font-size:12px">${x.name}</b>
        <span class="k" style="display:block">${t('전투력')} ${num(x.cp)}</span></span>
      ${kind === 'in'
        ? `<span style="display:flex;gap:5px">
             <button class="rt-b go" data-fyes="${x.id}">${t('수락')}</button>
             <button class="rt-b" data-fno="${x.id}">${t('거절')}</button></span>`
        : `<button class="rt-b${(f.req || []).includes(x.id) ? '' : ' go'}"
             data-freq="${x.id}" ${(f.req || []).includes(x.id) ? 'disabled' : ''}>${
             (f.req || []).includes(x.id) ? t('신청함') : t('친구 신청')}</button>`}
    </div>`;

  // 표본·신청이 늦게 오면 그때 다시 그린다
  const frRedraw = () => {
    if ($('#ov').classList.contains('show') && $('#ovt').textContent === t('친구 신청')) {
      openFriendRequests();
    }
  };
  live.pullFriendCands(totalCp(), frRedraw);
  live.pullFriendReqs(frRedraw);

  $('#ovt').textContent = t('친구 신청');
  setSkin('friend');
  $('#ovh').classList.remove('has-cur');
  $('#ovinfo').innerHTML = '';
  $('#ovb').innerHTML = `
    <div class="fr-tabs">
      <button data-frtab="list">${t('내 친구')}</button>
      <button class="on" data-frtab="req">${t('친구 신청')}${
        inbox.length ? `<i class="dot"></i>` : ''}</button>
    </div>
    ${inbox.length ? `<div class="lbl" style="margin:8px 0 6px">${
      t('받은 신청')} <b style="color:var(--gold)">${inbox.length}</b></div>
      ${inbox.map((x, i) => row(x, i, 'in')).join('')}` : ''}
    <div class="fr-sec">
      <span class="lbl">${t('추천 단장')}</span>
      <button class="rt-b" id="frRe" ${left > 0 ? 'disabled' : ''}>${
        left > 0 ? `${left}${t('초')}` : `⟳ ${t('새로 고침')}`}</button>
    </div>
    ${cands.map((x, i) => row(x, i, 'out')).join('')}
    `;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

  $('#ovb').querySelectorAll('[data-frtab]').forEach(b =>
    b.addEventListener('click', () =>
      b.dataset.frtab === 'list' ? openFriends() : openFriendRequests()));
  $('#ovb').querySelectorAll('[data-freq]').forEach(b =>
    b.addEventListener('click', async () => {
      if (live.liveReady()) {
        const r = await live.addFriend(b.dataset.freq)
          .catch(e => ({ ok: false, reason: String(e && e.message || e) }));
        if (!r?.ok) return toast(t(FR_ERR[r?.reason] || '신청하지 못했습니다'));
      }
      // 보낸 신청은 로컬에도 남긴다 — 서버는 "내가 보낸 것" 목록을 안 준다.
      // 버튼이 [신청함] 으로 굳는 건 이 기록이다
      f.req = f.req || [];
      if (!f.req.includes(b.dataset.freq)) f.req.push(b.dataset.freq);
      save();
      toast(t('친구 신청을 보냈습니다'));
      openFriendRequests();
    }));
  $('#ovb').querySelectorAll('[data-fyes]').forEach(b =>
    b.addEventListener('click', async () => {
      const x = friendIncoming().find(y => y.id === b.dataset.fyes);
      if (live.liveReady()) {
        const r = await live.respondFriend(b.dataset.fyes, true)
          .catch(e => ({ ok: false, reason: String(e && e.message || e) }));
        if (!r?.ok) return toast(t(FR_ERR[r?.reason] || '수락하지 못했습니다'));
        if (x) toast(t('{0} 님과 친구가 되었습니다', x.name));
        live.invalidate('friends', 'friendReqs');
        live.pullFriends();
        live.pullFriendReqs(() => { if ($('#ov').classList.contains('show')) openFriendRequests(); });
        syncNav();
        return;
      }
      if (x && friendAdd(x)) toast(t('{0} 님과 친구가 되었습니다', x.name));
      f.inbox = f.inbox.filter(y => y.id !== b.dataset.fyes);
      save(); syncNav(); openFriendRequests();
    }));
  $('#ovb').querySelectorAll('[data-fno]').forEach(b =>
    b.addEventListener('click', async () => {
      if (live.liveReady()) {
        await live.respondFriend(b.dataset.fno, false).catch(() => {});
        live.invalidate('friendReqs');
        live.pullFriendReqs(() => { if ($('#ov').classList.contains('show')) openFriendRequests(); });
        return;
      }
      f.inbox = f.inbox.filter(y => y.id !== b.dataset.fno);
      save(); openFriendRequests();
    }));
  $('#frRe').addEventListener('click', () => {
    const l = friendRefresh();
    if (l > 0) return toast(t('{0}초 뒤에 새로 고칠 수 있습니다', l));
    save(); openFriendRequests();
  });
  // 쿨다운이 도는 동안 버튼 숫자를 살려 둔다 — 멈춘 숫자는 고장으로 읽힌다
  clearInterval(window.__frTick);
  window.__frTick = setInterval(() => {
    const btn = $('#frRe');
    if (!btn || !$('#ov').classList.contains('show')) return clearInterval(window.__frTick);
    const l = Math.ceil(((f.reqAt || 0) + FRIEND_REFRESH_SEC * 1000 - Date.now()) / 1000);
    btn.disabled = l > 0;
    btn.textContent = l > 0 ? `${l}${t('초')}` : `⟳ ${t('새로 고침')}`;
  }, 250);
}

/**
 * 선물 상태. 서버가 붙으면 **계정을 넘는 진짜 주고받기**다.
 *   sent  오늘 내가 보낸 상대  — 서버가 센다 (gifts 컬렉션)
 *   box   나에게 온 선물       — 보낸 사람이 실제로 눌렀을 때만 생긴다
 *
 * 예전에는 둘 다 로컬이었다. "선물"은 내 기기에 표시만 남고 "받기"는 상대가
 * 뭘 보냈든 상관없이 내 골드를 줬다 — 혼자 도는 고리였고, 받는 쪽은 누가
 * 선물을 보냈는지 영영 알 수 없었다.
 *
 * **금액은 여전히 받는 쪽이 정한다** (idleGold). 방치 골드가 받는 사람의
 * 진행도에 물려 있어(고정액은 후반에 휴지조각) 보내는 쪽 세이브로는 못 잰다.
 */
function giftState() {
  const f = friendState();
  const box = live.get('giftBox');
  if (!box) return { sent: f.sent, inbox: null, live: false };
  return { sent: box.sent || [], inbox: box.inbox || [], live: true };
}

function openFriends() {
  const f = friendState();
  const gift = idleGold(FRIEND_GIFT_HOURS);
  const G = giftState();
  // 서버가 붙으면 **온 선물만** 받을 수 있다. 안 온 칸은 눌러도 줄 게 없다 —
  // 예전처럼 늘 켜 두면 "받기" 가 그냥 매일 누르는 무료 골드 버튼이 된다
  const fromOf = new Map((G.inbox || []).map(g => [g.from, g]));
  const rows = f.list.map((x, i) => {
    const sent = G.sent.includes(x.id);
    const pend = G.live ? fromOf.get(x.id) : null;
    const got = G.live ? !pend : f.recv.includes(x.id);
    return `<div class="frow fr-row" style="padding:7px 9px;margin-bottom:5px" data-fp="${i}">
      ${friendAvatar(i, 40)}
      <span style="flex:1;min-width:0"><b style="font-size:12px">${x.name}</b>
        <span class="k" style="display:block">${t('전투력')} ${num(x.cp)}</span></span>
      <span style="display:flex;gap:5px">
        <button class="rt-b${sent ? '' : ' go'}" data-fsend="${x.id}"
          ${sent ? 'disabled' : ''}>${sent ? '✓' : t('선물')}</button>
        <button class="rt-b${got ? '' : ' go'}" data-frecv="${x.id}"
          data-gid="${pend ? pend.id : ''}"
          ${got ? 'disabled' : ''}>${got ? '✓' : t('받기')}</button>
      </span></div>`;
  }).join('');
  const anySend = f.list.some(x => !G.sent.includes(x.id));
  const anyRecv = G.live ? (G.inbox || []).length > 0
    : f.list.some(x => !f.recv.includes(x.id));
  const allLeft = anySend || anyRecv;

  live.pullFriends(() => {
    if ($('#ov').classList.contains('show') && $('#ovt').textContent === t('친구')) openFriends();
  });
  live.pullGiftBox(() => {
    if ($('#ov').classList.contains('show') && $('#ovt').textContent === t('친구')) openFriends();
  });
  $('#ovt').textContent = t('친구');
  setSkin('friend');
  $('#ovh').classList.remove('has-cur');
  $('#ovinfo').innerHTML = `<div class="sub" style="line-height:1.5">${t('선물을 보내도 내 골드는 줄지 않습니다. 서로 보내면 서로 이득입니다')}</div>`;
  $('#ovb').innerHTML = `
    <div class="fr-tabs">
      <button class="on" data-frtab="list">${t('내 친구')}</button>
      <button data-frtab="req">${t('친구 신청')}${
        friendIncoming().length ? '<i class="dot"></i>' : ''}</button>
    </div>
    <div class="frow"><span class="k">${t('친구')}</span>
      <span class="v">${f.list.length} / ${FRIEND_MAX}</span></div>
    <div class="frow"><span class="k">${t('선물 골드 (1명당)')}</span>
      <span class="v"><img src="/assets/ui/CU-04.png" alt=""
        style="width:12px;height:12px;vertical-align:-2px"> ${num(gift)}</span></div>
    ${G.live ? `<div class="frow"><span class="k">${t('받을 선물')}</span>
      <span class="v">${(G.inbox || []).length}</span></div>` : ''}
    <button class="fgbtn" id="frAll" style="margin:8px 0 10px"
      ${allLeft ? '' : 'disabled'}>${allLeft ? t('전체 선물 보내기 + 받기') : t('오늘은 다 주고받았습니다')}</button>
    ${rows}
    `;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

  const recvOne = id => {
    if (f.recv.includes(id)) return 0;
    f.recv.push(id);
    S.gold += gift;
    return gift;
  };
  /** 서버 수령 — 행을 지운 **개수만큼** 골드를 넣는다. 없는 선물은 0이다 */
  const claim = async ids => {
    const list = ids.filter(Boolean);
    if (!list.length) return 0;
    const r = await live.claimGifts(list).catch(() => null);
    const n = r?.n || 0;
    if (n) S.gold += gift * n;
    live.invalidate('giftBox');
    return gift * n;
  };
  $('#ovb').querySelectorAll('[data-frtab]').forEach(b =>
    b.addEventListener('click', () =>
      b.dataset.frtab === 'req' ? openFriendRequests() : openFriends()));
  $('#ovb').querySelectorAll('.fr-row').forEach(r =>
    r.addEventListener('click', e => {
      if (e.target.closest('button')) return;   // 선물 버튼은 프로필로 안 샌다
      openFriendProfile(+r.dataset.fp);
    }));
  $('#ovb').querySelectorAll('[data-fsend]').forEach(b =>
    b.addEventListener('click', async () => {
      if (G.live) {
        const r = await live.sendGift(b.dataset.fsend)
          .catch(e => ({ ok: false, reason: String(e && e.message || e) }));
        if (!r?.ok) return toast(t(GIFT_ERR[r?.reason] || '선물을 보내지 못했습니다'));
        live.invalidate('giftBox');
        live.pullGiftBox(() => { if ($('#ov').classList.contains('show')) openFriends(); });
        toast(t('선물을 보냈습니다'));
        return;
      }
      if (!f.sent.includes(b.dataset.fsend)) f.sent.push(b.dataset.fsend);
      save(); syncNav(); openFriends();
    }));
  $('#ovb').querySelectorAll('[data-frecv]').forEach(b =>
    b.addEventListener('click', async () => {
      const g = G.live ? await claim([b.dataset.gid]) : recvOne(b.dataset.frecv);
      save(); renderTop(); syncNav();
      if (G.live) live.pullGiftBox(() => { if ($('#ov').classList.contains('show')) openFriends(); });
      else openFriends();
      if (g) gainToast([['gold', g]]);
    }));
  $('#frAll').addEventListener('click', async () => {
    let got = 0;
    if (G.live) {
      // 보내기는 각자 한 번씩 (서버가 쌍마다 하루 한 번을 센다), 받기는 한 번에
      for (const x of f.list) {
        if (G.sent.includes(x.id)) continue;
        await live.sendGift(x.id).catch(() => {});
      }
      got = await claim((G.inbox || []).map(x => x.id));
      live.invalidate('giftBox');
      save(); renderTop(); syncNav();
      live.pullGiftBox(() => { if ($('#ov').classList.contains('show')) openFriends(); });
      if (got) gainToast([['gold', got]]);
      return;
    }
    for (const x of f.list) {
      if (!f.sent.includes(x.id)) f.sent.push(x.id);
      got += recvOne(x.id);
    }
    save(); renderTop(); syncNav(); openFriends();
    if (got) gainToast([['gold', got]]);
  });
}

/** 선물 실패 사유 → 사람 말 */
const GIFT_ERR = {
  not_friend: '친구가 아닙니다',
  already_sent: '오늘 이미 보냈습니다',
  target: '보낼 수 없는 상대입니다',
};

// ── 채팅 ───────────────────────────────────────────────────
//
// 방은 둘이다. [전체] 는 모두가 쓰고, [연합] 은 소속이 있을 때만 열린다.
// alliance.json 은 "채팅은 하나만" 이라고 적혀 있었지만 그건 **채팅 입구가**
// 하나라는 뜻으로 받는다 — 입구는 하단 채팅바 하나고, 그 안에서 탭으로 가른다.
// 무소속 유저(초반 전원)에게 채팅이 아예 없으면 초반이 텅 빈 게임이 된다.
//
// 새 글은 **구독**으로 온다 (net/live.js > subscribeChat). 폴링이 아니라서
// 화면을 열어 두면 상대가 친 순간 뜬다. 대신 닫을 때 반드시 해제해야 한다 —
// 방치 게임을 몇 시간 켜 두는 동안 구독이 살아 있으면 트래픽이 계속 흐른다.
let chatScope = 'world';
let chatUnsub = null;

/** 구독 해제. 화면을 닫는 모든 경로가 이걸 지난다 */
function chatDetach() {
  if (chatUnsub) { try { chatUnsub(); } catch { /* 이미 끊겼다 */ } chatUnsub = null; }
}

const chatRows = () => live.get(chatScope === 'ally' ? 'chatAlly' : 'chatWorld') || [];
const chatMine = m => m.account && m.account === live.get('myAlliance')?.me?.account;

/**
 * 채팅 한 줄. 아바타(단장 직군)가 붙고, 이름·아바타를 누르면 프로필 카드가 뜬다.
 * account 는 data- 로 싣는다 — 줄 40개에 리스너 40개를 다는 대신 chBody 하나가
 * 위임으로 받는다 (chatRedraw 마다 리스너를 다시 달지 않아도 된다).
 */
const chatLineHtml = m => `<div class="ch-line${chatMine(m) ? ' me' : ''}">
    <img class="ch-av" src="/assets/captain/captain_${
      ['warrior', 'archer', 'mage'].includes(m.capCls) ? m.capCls : 'warrior'}.png"
      alt="" data-chacc="${esc(m.account || '')}" onerror="this.remove()">
    <b data-chacc="${esc(m.account || '')}">${esc(m.nickname || '단장')}</b>
    <span>${esc(m.text || '')}</span>
    <i>${chatTime(m.at)}</i></div>`;

/** 시:분. 초까지 붙이면 한 줄이 시각으로 가득 찬다 */
const chatTime = at => {
  const d = new Date(at || 0);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function openChat(scope) {
  if (scope) chatScope = scope;
  const ready = live.liveReady();
  const rooms = live.get('chatRooms');
  const hasAlly = !!rooms?.ally;
  if (chatScope === 'ally' && !hasAlly) chatScope = 'world';

  const rows = ready ? chatRows() : [];
  const body = !ready
    // 서버가 없으면 대화 상대가 없다. 빈 말풍선을 띄우느니 이유를 적는다
    ? `<div class="sh-note">${t('채팅은 서버에 연결된 뒤에 열립니다')}</div>`
    : rows.length
      ? rows.map(chatLineHtml).join('')
      : `<div class="sh-note">${t('아직 아무도 말이 없습니다. 먼저 인사해 보세요')}</div>`;

  $('#ovt').textContent = t('채팅');
  setSkin('friend');
  $('#ovh').classList.remove('has-cur');
  $('#ovinfo').innerHTML = '';
  $('#ovb').innerHTML = `
    <div class="fr-tabs">
      <button class="${chatScope === 'world' ? 'on' : ''}" data-chtab="world">${t('전체')}</button>
      <button class="${chatScope === 'ally' ? 'on' : ''}" data-chtab="ally"
        ${hasAlly ? '' : 'disabled'}>${t('연합')}</button>
    </div>
    <div id="chBody" class="ch-body">${body}</div>
    <div class="ch-send">
      <input id="chIn" maxlength="100" placeholder="${
        ready ? t('메시지를 입력하세요') : t('연결 대기 중')}" ${ready ? '' : 'disabled'}>
      <button class="rt-b go" id="chGo" ${ready ? '' : 'disabled'}>${t('보내기')}</button>
    </div>`;
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
  chatToBottom();

  $('#ovb').querySelectorAll('[data-chtab]').forEach(b =>
    b.addEventListener('click', () => openChat(b.dataset.chtab)));

  // 방을 옮기면 이전 구독을 반드시 먼저 끊는다. 안 끊으면 탭을 오갈 때마다
  // 구독이 하나씩 쌓여 같은 줄이 두 번 세 번 그려진다
  chatDetach();
  if (ready) {
    chatUnsub = live.subscribeChat(chatScope, () => {
      if (!$('#ov').classList.contains('show') || $('#ovt').textContent !== t('채팅')) return;
      chatRedraw();
    });
    // 구독이 안 되는 환경이면(문서에 없는 호스트) 최소한 열 때 한 번은 받아 둔다
    if (!chatUnsub) live.fetchChat(chatScope).then(r => {
      if (r) { live.setChat(chatScope, r); chatRedraw(); }
    }).catch(() => {});
  }

  const send = async () => {
    const el = $('#chIn');
    const text = (el.value || '').trim();
    if (!text) return;
    el.value = '';
    const r = await live.sendChat(chatScope, text)
      .catch(e => ({ ok: false, reason: String(e && e.message || e) }));
    if (!r?.ok) {
      el.value = text;                    // 실패하면 쓴 글을 돌려준다
      return toast(t(CHAT_ERR[r?.reason] || '보내지 못했습니다'));
    }
    // 구독이 곧 새 목록을 주지만, 내가 친 줄은 **즉시** 보여야 한다
    if (!chatUnsub) {
      const rowsNow = live.fetchChat(chatScope).catch(() => null);
      rowsNow.then(v => { if (v) { live.setChat(chatScope, v); chatRedraw(); } });
    }
  };
  $('#chGo').addEventListener('click', send);
  $('#chIn').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  // 줄마다 리스너를 달지 않는다 — chatRedraw 가 innerHTML 을 갈아치우면
  // 리스너도 같이 사라져 매번 다시 달아야 한다. 위임 하나면 끝이다
  $('#chBody').addEventListener('click', e => {
    const acc = e.target.dataset?.chacc;
    if (acc) openChatProfile(acc);
  });
}

/**
 * 채팅 프로필 카드. 계정으로 공개 프로필을 그때그때 받아 #smPop 에 띄운다
 * (아레나 상대 카드 openFoeInfo 와 같은 그릇).
 *
 * 캐시하지 않는다 — 채팅에서 만나는 계정은 매번 다르고, 카드 하나가 조회
 * 한 번이라 예산(초당 10회)에도 안 걸린다. 프로필이 없으면(아직 안 올린 계정)
 * 채팅 줄이 가진 것(이름·직군)만 그린다.
 */
async function openChatProfile(account) {
  if (!account || !live.liveReady()) return;
  // 나를 누르면 내 프로필 화면이 낫다 — 남 카드 모양으로 나를 보여 줄 이유가 없다
  if (account === live.get('myAlliance')?.me?.account) return;
  const line = chatRows().find(m => m.account === account);
  const ttl = $('#smTitle'); if (ttl) ttl.textContent = line?.nickname || t('단장');
  $('#smBody').innerHTML = `<div class="sh-note">${t('불러오는 중…')}</div>`;
  $('#smPop').classList.add('show');

  const x = await live.fetchProfile(account).catch(() => null);
  // 기다리는 사이 카드를 닫았거나 다른 카드를 열었으면 그리지 않는다
  if (!$('#smPop').classList.contains('show')) return;
  const nick = x?.nickname || line?.nickname || '단장';
  const cls = ['warrior', 'archer', 'mage'].includes(x?.capCls || line?.capCls)
    ? (x?.capCls || line?.capCls) : 'warrior';
  if (ttl) ttl.textContent = nick;

  const f = friendState();
  const isFriend = f.list.some(y => y.id === account);
  const asked = (f.req || []).includes(account);
  $('#smBody').innerHTML = `
    <div class="af-hero">
      <img src="/assets/captain/captain_${cls}.png" alt="" onerror="this.remove()">
      <div>
        <b>${esc(nick)}</b>
        <span>${CLASS_KO[cls]} ${t('단장')}${x ? ` · ${t('전투력')} ${num(x.cp || 0)}` : ''}</span>
        ${x ? `<span>${t('최고 스테이지')} ${num(x.stage || 0)} · ${t('점수')} ${num(x.arenaScore || 0)}</span>` : ''}
      </div>
    </div>
    ${x?.title ? `<div class="frow"><span class="k">${t('칭호')}</span><span class="v">${esc(x.title)}</span></div>` : ''}
    ${x?.party?.length ? `
      <div class="lbl" style="margin:8px 0 6px">${t('착용 용병')}</div>
      <div class="af-party">${x.party.map(c => `
        <span class="af-m" style="--c:${GC_COL[c.grade] || '#999'}">
          <img src="/assets/char/${esc(c.id)}.png" alt="" onerror="this.remove()">
          <b style="color:${GC_COL[c.grade] || '#999'}">${esc(c.grade)}</b>
        </span>`).join('')}</div>` : ''}
    ${!x ? `<div class="sh-note">${t('아직 프로필을 올리지 않은 단장입니다')}</div>` : ''}
    <button class="fgbtn" id="chFr" style="margin-top:8px"
      ${isFriend || asked ? 'disabled' : ''}>${
      isFriend ? t('이미 친구입니다') : asked ? t('신청함') : t('친구 신청')}</button>`;

  $('#chFr')?.addEventListener('click', async () => {
    const r = await live.addFriend(account)
      .catch(e => ({ ok: false, reason: String(e && e.message || e) }));
    if (!r?.ok) return toast(t(FR_ERR[r?.reason] || '신청하지 못했습니다'));
    f.req = f.req || [];
    if (!f.req.includes(account)) f.req.push(account);
    save();
    toast(t('친구 신청을 보냈습니다'));
    $('#chFr').disabled = true;
    $('#chFr').textContent = t('신청함');
  });
}

/** 목록만 다시 그린다. 통째로 다시 그리면 입력 중이던 글자가 날아간다 */
function chatRedraw() {
  const el = $('#chBody');
  if (!el) return;
  const rows = chatRows();
  el.innerHTML = rows.length
    ? rows.map(chatLineHtml).join('')
    : `<div class="sh-note">${t('아직 아무도 말이 없습니다. 먼저 인사해 보세요')}</div>`;
  chatToBottom();
  chatBarSync();
}

/** 최신이 아래다. 새 줄이 왔는데 위를 보고 있으면 온 줄 모른다 */
function chatToBottom() {
  const el = $('#chBody');
  if (el) el.scrollTop = el.scrollHeight;
}

/**
 * 하단 채팅바 한 줄. 서버가 붙으면 **마지막 대화**를, 아니면 예전처럼 공지를 돈다.
 * 바 자체가 채팅 입구라 여기 남의 말이 흐르는 것이 곧 "누르면 대화가 있다" 는 신호다.
 */
function chatBarSync() {
  const line = $('#chatline'), who = document.querySelector('#chat .who');
  if (!line) return;
  const rows = live.get('chatWorld') || [];
  const last = rows[rows.length - 1];
  if (!last) return;
  if (who) who.textContent = esc(last.nickname || '단장');
  line.textContent = last.text || '';
}

/** 채팅 실패 사유 → 사람 말 */
const CHAT_ERR = {
  too_fast: '조금 천천히 보내 주세요',
  no_room: '연합에 속해 있지 않습니다',
  empty: '내용을 입력하세요',
};

/** 남이 친 글을 화면에 그린다. **반드시 이스케이프한다** — innerHTML 이다 */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function arenaState() {
  const day = dayIdx(Date.now());
  if (S.arena.day !== day) S.arena = { day, used: 0, adUsed: 0,
    tierClaimedDay: S.arena.tierClaimedDay };
  return S.arena;
}
const arenaLeft = () => {
  const a = arenaState();
  return D.arena.entries.baseDaily + (a.adUsed ? D.arena.entries.adBonus.entries : 0) - a.used;
};

/** 오늘의 상대 5명 — 날짜 시드로 고정한다. 열 때마다 바뀌면 "고르는 맛"이 없다 */
/**
 * 상대 3명. 다섯 명을 늘어놓으면 화면이 넘쳐 스크롤이 생겼다 —
 * 셋만 띄우고 **새로 고침**으로 다른 상대를 부른다 (S.arena.foeSeed).
 */
/**
 * 남에게 보여 줄 내 프로필. **서버 컬렉션에 올라가는 것과 같은 모양**이다
 * (server.js > submitProfile). 아레나 상대·친구 카드도 이 모양을 읽으므로,
 * 화면에 항목을 더하려면 여기와 서버 양쪽에 필드를 더해야 한다.
 *
 * 여기 없는 것은 실서버에서 **가져올 수 없다** — 개인 세이브는 본인만 읽는다.
 */
function publicProfile() {
  return {
    account: null,                       // 서버가 $sender.account 로 채운다
    nickname: S.profile?.nick || '단장',
    cp: Math.round(totalCp()),
    stage: S.maxStage || 0,
    capCls: S.promoClass || 'warrior',
    party: S.party.filter(Boolean).slice(0, 5)
      .map(x => ({ id: x.id, grade: x.grade, level: x.level || 1 })),
    title: S.profile?.title || '',
    frame: S.profile?.frame || '',
    wing: S.cosmetics?.wing || '',
    arenaScore: S.arenaScore || 0,
  };
}

/**
 * 아레나 상대 셋. 서버가 붙으면 **실제 유저 프로필**(findProfiles) 에서 고르고,
 * 아니면 날짜 시드 더미다.
 *
 * 서버 표본은 내 CP 의 ±40% 대역이라 셋보다 많이 온다. 약간 약한 상대 · 비슷한
 * 상대 · 약간 센 상대로 **셋만 남긴다** — 목록이 길면 유저가 가장 약한 하나만
 * 골라 점수를 긁고, 그러면 아레나가 랭킹이 아니라 작업이 된다.
 */
function arenaFoes() {
  const rows = live.get('arenaFoes');
  if (rows?.length) {
    const my = totalCp();
    const sorted = [...rows].sort((a, b) => Math.abs(a.cp - my) - Math.abs(b.cp - my));
    const weak = [...rows].filter(r => r.cp < my).sort((a, b) => b.cp - a.cp)[0];
    const strong = [...rows].filter(r => r.cp > my).sort((a, b) => a.cp - b.cp)[0];
    // 같은 계정이 두 칸에 앉으면 "다른 상대" 로 안 읽힌다.
    // 겹쳐서 셋이 안 되면 **남은 표본으로 채운다** — 두 칸짜리 아레나는 고장으로 보인다
    const seen = new Set();
    const uniq = [];
    for (const x of [weak, sorted[0], strong, ...sorted]) {
      if (uniq.length >= 3) break;
      if (!x || seen.has(x.account)) continue;
      seen.add(x.account); uniq.push(x);
    }
    if (uniq.length) return uniq.map((x, i) => ({
      i, account: x.account, name: x.nickname || '단장',
      cp: x.cp || 0, score: x.arenaScore || 0, stage: x.stage || 1,
      capCls: x.capCls || 'warrior',
      // 서버가 주는 party 는 { id, grade, level } 이다. 화면은 characters 를
      // id 로 찾아 그림을 붙인다 — 없는 id 면 조용히 빠진다
      party: (x.party || []).map(m => D.characters.characters.find(c => c.id === m.id))
        .filter(Boolean),
    }));
  }
  return demoArenaFoes();
}

/** 서버가 없을 때의 상대. 날짜 시드라 하루 동안은 같은 얼굴이다 */
function demoArenaFoes() {
  const my = totalCp();
  const day = dayIdx(Date.now());
  const seed = (S.arena?.foeSeed || 0) * 37;
  const rng = k => { const x = Math.sin((day + seed) * 977 + k * 131) * 10000; return x - Math.floor(x); };
  const chars = D.characters.characters;
  return [0.82, 1.0, 1.25].map((k, i) => {
    // 상대 편성 — 같은 시드에서 5명. CP 배율이 높을수록 상위 등급이 잘 나온다
    const gradesByPower = k < 0.9 ? ['R', 'SR'] : k < 1.2 ? ['SR', 'SSR'] : ['SSR', 'UR'];
    const pool = chars.filter(c => gradesByPower.includes(c.grade));
    const party = Array.from({ length: 5 }, (_, j) =>
      pool[Math.floor(rng(i * 7 + j) * pool.length)]);
    const capCls = ['warrior', 'archer', 'mage'][Math.floor(rng(i + 40) * 3)];
    // **publicProfile() 과 같은 필드만** 쓴다 — 서버가 붙으면 이 자리에
    // findProfiles() 결과가 그대로 들어온다 (server.js > submitProfile)
    return {
      i, name: `단장 ${1000 + Math.floor(rng(i) * 8999)}`,
      cp: Math.round(my * k * (0.95 + rng(i + 9) * 0.1)),
      score: Math.max(0, S.arenaScore + Math.round((k - 1) * 400)),
      stage: Math.max(1, (S.maxStage || 1) + Math.round((k - 1) * 30)),
      party, capCls,
    };
  });
}

/**
 * 도전 — CP 확률 판정 (arena.json > battle). 틱 시뮬이 아닌 이유는
 * whyNotTickSim 에 있다: 5v5 단판은 CP 비교와 상관 0.97이라 계산만 비싸다.
 */
// 진행 중인 아레나 판. 던전의 dgRun 과 같은 이유로 전역이다
let arRun = null;

/**
 * 도전. **판정은 예전 그대로 CP 확률 한 번이고**(arena.json > battle), 달라진
 * 것은 그 결과를 화면에서 재생한다는 것뿐이다 (hp_drain).
 *
 * 틱 시뮬로 안 가는 이유는 arena.json > whyNotTickSim 에 기록돼 있다 —
 * 위치·사거리가 없어 동일 CP 단판이 결정론적이 되고 직군 승률이 35% 대 100%
 * 로 갈라졌다. 판정을 그대로 두면 서버 이관도 그대로다.
 */
function arenaFight(foe) {
  if (arRun || dgRun) return;
  if (arenaLeft() < 1) return toast(t('오늘 입장을 다 썼습니다'));
  arenaState().used++;
  const a = D.arena;
  const my = totalCp();
  const p = 1 / (1 + Math.pow(foe.cp / my, a.battle.winProbability.exponent));
  const win = Math.random() < p;
  let delta;
  if (win) {
    delta = Math.max(10, Math.min(50, 30 - Math.floor((S.arenaScore - foe.score) / 50)));
  } else {
    delta = -Math.max(5, Math.min(25, 15 + Math.floor((S.arenaScore - foe.score) / 50)));
  }

  // 점수는 **연출이 끝난 뒤에** 반영한다 — 먼저 올리면 카운트업할 값이 없다
  arRun = { foe, win, delta, from: S.arenaScore };
  save();
  playArenaMatch(foe, win, my);
}

/**
 * 연출 재생. 승자의 남은 HP 와 길이는 arena.json > battle.presentation 의 식이다.
 * CP 격차가 클수록 승자 HP 가 많이 남아 압승으로 보이고, 접전이면 아슬아슬하다.
 */
async function playArenaMatch(foe, win, myCp) {
  const P = D.arena.battle.presentation;
  // 이긴 쪽 기준의 전력비 — 진 쪽이 나면 상대가 승자다
  const ratio = win ? foe.cp / Math.max(1, myCp) : myCp / Math.max(1, foe.cp);
  let remain = Math.min(0.85, Math.max(0.08, 1 - Math.pow(ratio, 2) * 0.9));
  // 열세가 이기면 신승으로 — 압승 그림이 나오면 "왜 이겼지"가 남는다
  if (ratio > 1) remain = 0.05 + Math.random() * 0.1;
  const duration = 6 + 8 * (1 - remain);

  // 아레나 창(#ov)을 닫아야 전투 화면이 보인다
  roster.close();
  $('#ov').classList.remove('show', 'forced');
  showArenaBars(foe);
  $('#stg').innerHTML = `아레나<i>${foe.name}</i>`;
  markEncounter(-1);

  // VS 컷 — 이미 만들어 놓고 보스전에만 쓰고 있었다. 사람 대 사람이라는 것이
  // 한 장으로 읽히는 자리가 여기다 (연출 기획서 3-2)
  await showVs(foe);

  await scene.setBackground('BG-03');
  scene.captainClass = S.promoClass || 'warrior';
  await scene.setParty(S.party);
  scene.activeSkills = S.skills.active.filter(Boolean);
  scene.passiveSkills = S.skills.passive.filter(Boolean);
  scene.syncPassiveAura?.();
  await scene.startArenaMatch({
    foeParty: foe.party, win, hpRemain: remain, duration,
  });
}

/** 아레나 VS 컷. 보스전 것과 같은 #vs 를 쓰되 오른쪽이 상대 단장이다 */
function showVs(foe) {
  $('#vsBossImg').src = `/assets/captain/captain_${foe.capCls || 'warrior'}.png`;
  $('#vsCapImg').src = `/assets/captain/captain_${S.promoClass || 'warrior'}.png`;
  const v = $('#vs');
  v.classList.remove('show'); void v.offsetWidth;
  v.classList.add('show');
  return new Promise(r => setTimeout(() => { v.classList.remove('show'); r(); }, 900));
}

/** 상단 양측 HP 바 — arena.json > presentation.uiRequirement */
function showArenaBars(foe) {
  const el = $('#arBars');
  el.querySelector('.ar-me b').textContent = S.profile?.nick || '단장';
  el.querySelector('.ar-foe b').textContent = foe.name;
  el.querySelector('.ar-me i').style.width = '100%';
  el.querySelector('.ar-foe i').style.width = '100%';
  el.classList.add('show');
}

function hideArenaBars() { $('#arBars').classList.remove('show'); }

/** 점수 카운트업. 0.8초 동안 숫자가 굴러간다 — 이긴 값이 즉시 박히면 안 읽힌다 */
function countUpScore(from, to, win) {
  const el = $('#arScore');
  el.classList.remove('up', 'down');
  el.classList.add('show', win ? 'up' : 'down');
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / 800);
    el.textContent = num(Math.round(from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else setTimeout(() => el.classList.remove('show'), 900);
  };
  requestAnimationFrame(step);
}

/** 티어 일일 보상 — 하루 1회, 현재 티어 기준 (arena.json > tiers) */
function claimArenaDaily() {
  const day = dayIdx(Date.now());
  if (S.arena.tierClaimedDay === day) return toast(t('오늘 보상은 이미 받았습니다'));
  const tier = [...D.arena.tiers].reverse().find(x => S.arenaScore >= x.minScore)
    || D.arena.tiers[0];
  S.arena.tierClaimedDay = day;
  const got = passGrant({ diamond: tier.dailyDiamond });
  S.medal += tier.dailyMedals;
  got.pairs.push(['arena_medal', tier.dailyMedals]);
  save(); renderTop(); openArena();
  gainToast(got.pairs);
}

async function arenaAd() {
  const a = arenaState();
  if (a.adUsed) return toast(t('오늘 광고 입장은 받았습니다'));
  if (!(await playAd('arena_entries'))) return;
  a.adUsed = 1;
  save(); openArena();
}

function openArena(view) {
  if (view === 'shop') return openMedalShop();

  const a = D.arena;
  const my = totalCp();
  const day = dayIdx(Date.now());
  const foes = arenaFoes();
  // 표본이 늦게 오면 그때 다시 그린다. 처음엔 캐시(또는 더미)로 즉시 뜬다
  live.pullArenaFoes(my, () => {
    if ($('#ov').classList.contains('show') && $('#ovt').textContent === '아레나') openArena();
  });
  const winP = cp => 1 / (1 + Math.pow(cp / my, a.battle.winProbability.exponent));
  const left = arenaLeft();

  const rows = foes.map(f => {
    const p = winP(f.cp);
    const col = p > 0.6 ? 'var(--up)' : p > 0.35 ? 'var(--gold)' : 'var(--warn)';
    return `<div class="frow af-row" data-afinfo="${f.i}" style="padding:7px 11px;margin-bottom:5px">
      <span class="af-ava"><img src="/assets/captain/captain_${f.capCls}.png" alt=""
        onerror="this.remove()"></span>
      <span style="flex:1;min-width:0"><b style="font-size:12px">${f.name}</b>
        <span class="k" style="display:block">${t('전투력')} ${num(f.cp)} · ${(p * 100).toFixed(0)}%</span></span>
      <button class="ar-fight" data-af="${f.i}" ${left < 1 ? 'disabled' : ''}
        style="--wc:${col}">${t('도전')}</button></div>`;
  }).join('');

  const tier = [...a.tiers].reverse().find(x => S.arenaScore >= x.minScore) || a.tiers[0];
  const claimed = S.arena.tierClaimedDay === day;
  $('#ovt').textContent = '아레나';
  setSkin('arena');
  // 상대가 맨 위다 — 이 화면에 온 이유가 그것이고, 나머지(점수·훈장·입장)는
  // 확인만 하는 줄이라 아래로 내린다. 한 화면에 다 들어온다
  $('#ovb').innerHTML =
    `<div class="ar-sec">
      <span class="lbl">${t('상대')}</span>
      <button class="rt-b" id="aRe">⟳ ${t('새로 고침')}</button>
    </div>`
    + rows
    + `<div class="ar-stat">
        <span><i>${t('점수')}</i><b>${num(S.arenaScore)}</b><u>${tier.nameKo}</u></span>
        <span><i>${t('훈장')}</i><b><img src="/assets/ui/CU-11.png" alt=""
          onerror="this.remove()">${num(S.medal)}</b>
          <button class="ar-shopb ic" id="aShop" title="${t('훈장 상점')}">
            <img src="/assets/ui/IC-SHOP.png" alt="${t('상점')}"
              onerror="this.replaceWith(document.createTextNode('${t('상점')}'))"></button></span>
        <span><i>${t('남은 입장')}</i><b>${left} / ${
          a.entries.baseDaily + (arenaState().adUsed ? a.entries.adBonus.entries : 0)}</b>
          ${arenaState().adUsed ? '' : `<button class="ar-shopb" id="aAd">+${
            a.entries.adBonus.entries} ${t('광고')}</button>`}</span>
      </div>`
    + `<button class="fgbtn" id="aDaily" style="margin-top:8px" ${claimed ? 'disabled' : ''}>
        ${claimed ? t('오늘 티어 보상 수령 완료')
          : t('{0} 일일 보상 받기 (훈장 {1} · 다이아 {2})', tier.nameKo, tier.dailyMedals, tier.dailyDiamond)}</button>`;
  $('#ovinfo').innerHTML = '';
  $('#aShop').addEventListener('click', () => openArena('shop'));
  $('#aRe').addEventListener('click', () => {
    S.arena.foeSeed = (S.arena.foeSeed || 0) + 1;
    save(); openArena();
  });
  $('#aDaily').addEventListener('click', claimArenaDaily);
  $('#aAd')?.addEventListener('click', arenaAd);
  $('#ovb').querySelectorAll('[data-af]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); arenaFight(arenaFoes()[+b.dataset.af]); }));
  // 행을 누르면 편성이 보인다 — 도전 버튼과 분리 (버튼은 stopPropagation)
  $('#ovb').querySelectorAll('[data-afinfo]').forEach(el =>
    el.addEventListener('click', () => openFoeInfo(+el.dataset.afinfo)));
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');
}

/** 상대 정보 — 단장 모습과 착용 용병 5명. 승률·도전까지 한 창에서 */
function openFoeInfo(i) {
  const f = arenaFoes()[i];
  if (!f) return;
  const p = 1 / (1 + Math.pow(f.cp / totalCp(), D.arena.battle.winProbability.exponent));
  const ttl = $('#smTitle'); if (ttl) ttl.textContent = f.name;
  $('#smBody').innerHTML = `
    <div class="af-hero">
      <img src="/assets/captain/captain_${f.capCls}.png" alt="" onerror="this.remove()">
      <div>
        <b>${f.name}</b>
        <span>${CLASS_KO[f.capCls]} ${t('단장')} · ${t('전투력')} ${num(f.cp)}</span>
        <span>${t('점수')} ${num(f.score)} · ${t('최고 스테이지')} ${num(f.stage || 0)}</span>
      </div>
    </div>
    <div class="lbl" style="margin:8px 0 6px">${t('착용 용병')}</div>
    <div class="af-party">${f.party.map(c => `
      <span class="af-m" style="--c:${GC_COL[c.grade]}">
        <img src="/assets/char/${c.id}.png" alt="" onerror="this.remove()">
        <b style="color:${GC_COL[c.grade]}">${c.grade}</b>
      </span>`).join('')}</div>
    <div class="frow" style="margin-top:10px"><span class="k">${t('예상 승률')}</span>
      <span class="v" style="color:${p > 0.6 ? 'var(--up)' : p > 0.35 ? 'var(--gold)' : 'var(--warn)'}">
        ${(p * 100).toFixed(0)}%</span></div>
    <button class="fgbtn" id="afGo" style="margin-top:8px"
      ${arenaLeft() < 1 ? 'disabled' : ''}>${t('도전')}</button>`;
  $('#afGo').addEventListener('click', () => {
    $('#smPop').classList.remove('show');
    arenaFight(f);
  });
  $('#smPop').classList.add('show');
}

/**
 * 훈장 상점. arena.json > medalShop 이 단일 소스다.
 * 상점 탭이 아니라 아레나 화면 안에 둔다 — 훈장은 아레나에서만 벌고
 * 아레나에서만 쓰는 닫힌 재화라, 버는 곳과 쓰는 곳이 붙어 있어야 한다.
 */
function openMedalShop() {
  const sh = D.arena.medalShop;
  $('#ovt').textContent = '훈장 상점';
  setSkin('arena');
  $('#ovb').innerHTML =
    `<div class="ar-sec"><span class="lbl">${t('훈장')} ${num(S.medal)}</span>
      <button id="mdBack" class="rt-b">‹ ${t('아레나로')}</button></div>`
    // 글줄만 늘어놓으면 무엇을 파는지가 안 읽힌다 — 품목 그림을 크게
    + '<div class="md-grid">' + sh.items.map(x => {
      const lim = x.seasonLimit ? t('시즌 {0}회', x.seasonLimit) : t('일일 {0}회', x.dailyLimit);
      const can = S.medal >= x.cost;
      return `<div class="md-card">
        <img src="/assets/ui/${x.icon || 'CU-11'}.png" alt="" onerror="this.remove()">
        <b>${x.nameKo}</b><span>${lim}</span>
        <button class="mdBuy${can ? '' : ' off'}" data-m="${x.id}">
          <img src="/assets/ui/CU-11.png" alt="" onerror="this.remove()">${num(x.cost)}</button>
      </div>`; }).join('') + '</div>';
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
/** 연합 레벨 — 기부 코인 누적(allyXp)이 XP 다 (alliance.json > level) */
/**
 * 연합 XP. 서버가 붙어 있으면 **단원 전체 합산**이고(alliances.xp), 아니면 내 기부만이다.
 * 로컬 데모가 못 하던 지점이 정확히 여기다 — 혼자 쌓으면 하루 최대 95,
 * 30명이면 2,850 이라 곡선(alliance.json > level.curveNote)이 이 값을 전제로 잡혀 있다.
 */
const allyXpNow = () => live.get('myAlliance')?.alliance?.xp ?? (S.allyXp || 0);

function allyLevel() {
  const L = D.alliance.level.levels;
  let cur = L[0];
  for (const l of L) if (allyXpNow() >= l.xp) cur = l;
  return cur;
}
const allyNextLevel = () =>
  D.alliance.level.levels.find(l => l.xp > allyXpNow()) || null;

/** 단원 목록. 서버가 붙으면 실명단, 아니면 데모 주민이다 */
function allyMembers() {
  const my = live.get('myAlliance');
  if (!my) return null;
  return [...my.members].sort((a, b) => (b.coin || 0) - (a.coin || 0));
}

/**
 * 오늘 기부 상태. 하루 5회 **계단**이라 남은 건 "몇 번"이 아니라 "몇 번째"다.
 * 옛 저장본({gold, eq})은 단계 0 으로 흘려보낸다 — 하루치라 복구할 가치가 없다.
 */
function donateState() {
  const a = S.allyDonate;
  const today = new Date().toISOString().slice(0, 10);
  if (a.day !== today || typeof a.step !== 'number') {
    S.allyDonate = { day: today, step: 0 };
  }
  return S.allyDonate;
}
const donateSteps = () => D.alliance.contribution.donate.steps;
/** 지금 눌러야 할 단계. 다 했으면 null */
const donateNext = () => donateSteps()[donateState().step] || null;

/**
 * 기부 한 번 = 한 계단. 화면이 다음 계단으로 갈아탄다.
 *
 * 서버가 붙어 있으면 **단계 번호만 보낸다** — 비용도 보상도 서버 표에 있다
 * (server.js > DONATE_STEPS). 클라가 "얼마 냈다"를 보내면 0원 기부가 된다.
 */
async function donate() {
  const a = donateState();
  const st = donateNext();
  if (!st) return toast(t('오늘 기부를 다 했습니다'));

  if (live.liveReady()) {
    const r = await live.donateStep(st.n)
      .catch(e => ({ ok: false, reason: String(e && e.message || e) }));
    if (!r?.ok) return toast(t(ALLY_ERR[r?.reason] || '기부하지 못했습니다'));
    a.step = r.step;
    S.allyCoin = (S.allyCoin || 0) + r.coin;
    await syncSaveFromServer();            // 골드·다이아는 서버가 깎았다
    live.invalidate('myAlliance');
    live.pullMyAlliance(() => {
      if ($('#ov').classList.contains('show')) openAlliance('donate');
    });
    save(); renderTop(); alli.render();
    gainToast([['alliance_coin', r.coin]]);
    return;
  }

  if (st.kind === 'gold') {
    if (S.gold < st.cost) return toast(`골드가 부족합니다 (${num(st.cost)} 필요)`);
    S.gold -= st.cost;
  } else if (st.kind === 'diamond') {
    if (S.dia < st.cost) return toast(`다이아가 부족합니다 (${num(st.cost)} 필요)`);
    S.dia -= st.cost;
  }
  a.step++;
  S.allyCoin = (S.allyCoin || 0) + st.coin;
  S.allyXp = (S.allyXp || 0) + st.coin;     // 코인 1 = XP 1. 써도 XP 는 남는다
  save(); renderTop(); alli.render();
  gainToast([['alliance_coin', st.coin]]);
  if ($('#ov').classList.contains('show')) openAlliance('donate');
}

/** 서버 연동 전 데모 단원. 마을 산책 봇과 같은 얼굴을 쓴다 */
const ALLY_DEMO = [
  { ava: 'SR-03', name: '펭귄대장', role: '부단장', coin: 320, on: true },
  { ava: 'R-02', name: '멍뭉이', role: '단원', coin: 210, on: true },
  { ava: 'N-03', name: '개굴개굴', role: '단원', coin: 180, on: false, last: '3시간 전' },
  { ava: 'SR-06', name: '숲사슴', role: '단원', coin: 95, on: false, last: '어제' },
];

/** 연합 상점 구매. 코인만 깎는다 — XP 는 그대로 (성장은 안 되돌린다) */
function allyBuy(id) {
  const x = D.alliance.shop.items.find(i => i.id === id);
  if (!x) return;
  if (allyLevel().lv < (x.unlockLevel || 1)) return toast(t('연합 레벨이 부족합니다'));
  const wk = weekIdx(Date.now());
  if (S.allyShopBuy.week !== wk) S.allyShopBuy = { week: wk, n: {} };
  const used = S.allyShopBuy.n[id] || 0;
  if (x.weeklyLimit && used >= x.weeklyLimit) return toast(t('이번 주 한도를 다 샀습니다'));
  if ((S.allyCoin || 0) < x.cost) return toast(t('연합 코인이 부족합니다'));
  S.allyCoin -= x.cost;
  S.allyShopBuy.n[id] = used + 1;
  const pairs = [];
  for (const [k, v] of Object.entries(x.grant)) {
    if (k === 'dungeon_key_all') {
      for (const dg of D.dungeons.dungeons) S.dgKeys[dg.id] = (S.dgKeys[dg.id] || 0) + v;
      pairs.push(['dungeon_key', v * D.dungeons.dungeons.length]);
    } else if (k === 'profile_frame') {
      S.profile.ownedFrames = S.profile.ownedFrames || [];
      if (!S.profile.ownedFrames.includes(v)) S.profile.ownedFrames.push(v);
    } else {
      const got = passGrant({ [k]: v });
      pairs.push(...got.pairs);
    }
  }
  save(); renderTop(); openAlliance('shop');
  if (pairs.length) gainToast(pairs.filter(p => CUR_ICON[p[0]]));
  toast(`${x.nameKo} ${t('구매')}`);
}

/** 연합 탈퇴 — 24시간 재가입 쿨다운 (alliance.json > leaveCooldownHours) */
async function allyLeave() {
  if (!S.ally) return;
  const h = D.alliance.membership.leaveCooldownHours;
  if (!confirm(t('연합을 탈퇴하면 {0}시간 동안 다른 연합에 가입할 수 없습니다. 탈퇴할까요?', h))) return;
  if (live.liveReady()) {
    const r = await live.leaveAlliance().catch(e => ({ ok: false, reason: String(e) }));
    if (!r?.ok) return toast(t(ALLY_ERR[r?.reason] || '탈퇴하지 못했습니다'));
    live.invalidate('myAlliance', 'boss', 'bossLog', 'alliances');
  }
  S.ally = null;
  S.allyLeftAt = Date.now();
  save();
  toast(t('연합을 탈퇴했습니다'));
  $('#ov').classList.remove('show', 'forced');
  document.querySelector('#alli')?.classList.remove('show');
}

function openAlliance(tab = 'home') {
  const A = D.alliance;
  const coin = `<img src="/assets/ui/CU-12.png" alt="" onerror="this.replaceWith(document.createTextNode('\u25C6'))">`;

  // 탭바 없음 — 마을의 건물이 곧 네비다. 보스 소굴 = 보스, 기부 창고 = 기부,
  // 연합 상점 = 상점, 게시판 = 연합 정보 + 단원. 패널 안에 탭을 또 두면
  // 마을을 걸어 다닐 이유가 없어진다
  const TITLE = { boss: '보스 소굴', donate: '기부 창고', shop: '연합 상점', member: '게시판' };
  const head = '';

  // 길드 홈의 관례(버섯커·AFK·세나키): 엠블럼 + 이름 + Lv + 인원 + 공지 한 줄,
  // 그 아래 내 요약(코인·오늘 기부). 설계 수치 나열은 유저 화면이 아니다
  const home = () => {
    // 기부는 하루 **5단계 계단**이다. 예전 코드는 {gold, eq} 두 갈래를 세던
    // 시절의 필드를 그대로 읽어 doneN 이 NaN 이었고, d.gold.dailyLimit 은
    // 아예 없는 필드라 화면이 터졌다
    const dn = donateState();
    const d = A.contribution.donate;
    const doneN = dn.step || 0, capN = d.steps.length;
    const my = live.get('myAlliance');
    const memberN = my ? my.members.length : ALLY_DEMO.length + 1;
    const weekly = my ? (my.alliance.weekly || 0) : (S.allyCoin || 0);
    return `<div class="al-hero">
        <img class="al-emblem" src="/assets/alliance/AL-04.png" alt="" onerror="this.remove()">
        <div class="al-hero-t">
          <b>${my?.alliance?.name || S.ally?.name || '냥냥 용병단'} <i class="al-lv">Lv ${allyLevel().lv}</i></b>
          <span>단원 ${memberN} / ${A.membership.maxMembers} · 주간 기여 ${coin}${num(weekly)}</span>
          <em>"${my?.alliance?.notice || (live.liveReady()
            ? '매일 기부하고 주말엔 보스!' : '매일 기부하고 주말엔 보스! (서버 연동 전 데모)')}"</em>
        </div>
      </div>
      <div class="al-sum">
        <div><span>내 연합 코인</span><b>${coin}${num(S.allyCoin || 0)}</b></div>
        <div><span>오늘 기부</span><b>${doneN} / ${capN}</b></div>
        <div><span>보스 단계</span><b>${live.get('boss')?.tier ?? (S.allyBossTier || 0) + 1}단계</b></div>
      </div>
      ${(() => {
        const nx = allyNextLevel();
        if (!nx) return `<div class="al-lvbar"><i style="width:100%"></i><b>${t('최고 레벨')}</b></div>`;
        const prev = allyLevel().xp;
        const p = (allyXpNow() - prev) / (nx.xp - prev) * 100;
        return `<div class="al-lvbar"><i style="width:${p}%"></i>
          <b>Lv ${nx.lv} ${t('까지')} ${num(nx.xp - allyXpNow())} XP</b></div>`;
      })()}
      <button class="rt-b go" data-al-go="donate" style="width:100%;margin-top:8px">기부하러 가기</button>`;
  };

  // 보스전 관례: 보스가 화면의 주인공 + 남은 HP 바 + 내 시도 + [도전] 큰 버튼.
  // HP 계수·배수 표 같은 설계 수치는 유저 화면에서 뺐다
  const boss = () => {
    const B = A.boss;
    // 서버가 붙으면 **연합 공유 HP** 다. 없으면 데모 진행도(0.72 고정)
    const bs = live.get('boss');
    const tier = bs?.tier ?? (S.allyBossTier || 0) + 1;
    const hpLeft = bs ? (bs.max ? bs.hp / bs.max : 0) : (S.allyBossHp ?? 0.72);
    const tries = bs ? B.attemptsPerWeek - bs.triesLeft : (S.allyBossTries ?? 0);
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
      <button class="rt-b go" data-al-fight style="width:100%;margin-top:9px"
        ${bs && bs.triesLeft <= 0 ? 'disabled' : ''}>도전 (60초 전력전)</button>
      ${bossLogRows()}
      <div class="sh-note">${B.rewards.participationNote}</div>`;
  };

  /** 이번 주 딜 순위. 협동은 보여야 협동이다 — 안 보이면 혼자 치는 것과 같다 */
  const bossLogRows = () => {
    const log = live.get('bossLog');
    if (!log?.length) return '';
    const me = live.get('myAlliance')?.me?.account;
    return `<div class="lbl" style="margin:10px 0 6px">${t('이번 주 기여')}</div>`
      + log.slice(0, 10).map((r, i) => `<div class="al-mem">
          <span class="al-mem-t"><b>${i + 1}. ${
            r.account === me ? t('나') : (r.nickname || shortAcc(r.account))}</b></span>
          <span class="al-mem-c">${num(r.damage)}</span></div>`).join('');
  };

  const shop = () => {
    const S2 = A.shop;
    const lv = allyLevel().lv;
    // 주간 구매 기록 — 월요일 05:00 리셋 (임무 주간과 같은 시계)
    const wk = weekIdx(Date.now());
    if (S.allyShopBuy.week !== wk) S.allyShopBuy = { week: wk, n: {} };
    return `<div class="frow"><span class="k">${t('연합 레벨')}</span>
        <span class="v">Lv ${lv} · ${allyLevel().nameKo}</span></div>`
      + '<div class="als-grid">' + S2.items.map(x => {
        const lim = x.weeklyLimit ? `주 ${x.weeklyLimit}` : `시즌 ${x.seasonLimit}`;
        const locked = lv < (x.unlockLevel || 1);
        const used = S.allyShopBuy.n[x.id] || 0;
        const soldout = x.weeklyLimit && used >= x.weeklyLimit;
        return `<div class="als-card${locked ? ' locked' : ''}">
          <img class="als-img" src="/assets/ui/${x.icon}.png" alt="" onerror="this.remove()">
          <b>${x.nameKo}</b>
          <span>${lim}${x.weeklyLimit ? ` · ${used}/${x.weeklyLimit}` : ''}</span>
          ${locked
            ? `<em class="als-lock"><img src="/assets/ui/IC-LOCK-S.png" alt="">${
                t('연합 Lv {0}', x.unlockLevel)}</em>`
            : `<button class="mdBuy${soldout || (S.allyCoin || 0) < x.cost ? ' off' : ''}"
                data-albuy="${x.id}" ${soldout ? 'disabled' : ''}>${coin}${x.cost}</button>`}
        </div>`;
      }).join('') + '</div>'
      + `<div class="sh-note">${S2.unlockNote}</div>`;
  };

  // 단원 리스트 관례: 아바타 + 이름/직위 + 기여도 + 접속 표시.
  // 진짜 명단은 서버 컬렉션이다 — 그때까지 데모 주민으로 화면 문법만 세워 둔다
  const member = () => {
    const real = allyMembers();
    const list = real
      ? real.map(m => `<div class="al-mem${m.account === live.get('myAlliance')?.me?.account ? ' me' : ''}">
         <span class="rk-ava"><img src="/assets/captain/captain_warrior.png" alt=""></span>
         <span class="al-mem-t"><b>${m.account === live.get('myAlliance')?.me?.account
           ? (S.profile?.nick || S.nickname || '나')
           : (m.nickname || shortAcc(m.account))}</b>
           <i>${ROLE_KO[m.role] || '단원'}</i></span>
         <span class="al-mem-c">${coin}${num(m.coin || 0)}</span></div>`).join('')
      // 서버가 없을 때. 화면 문법만 세워 두는 데모 주민이다
      : `<div class="al-mem me">
         <span class="rk-ava"><img src="/assets/captain/captain_warrior.png" alt=""></span>
         <span class="al-mem-t"><b>${S.nickname || '나'}</b><i>단장</i></span>
         <span class="al-mem-c">${coin}${num(S.allyCoin || 0)}</span>
         <span class="al-on">접속 중</span></div>`
        + ALLY_DEMO.map(m => `<div class="al-mem">
         <span class="rk-ava"><img src="/assets/char/${m.ava}.png" alt=""></span>
         <span class="al-mem-t"><b>${m.name}</b><i>${m.role}</i></span>
         <span class="al-mem-c">${coin}${num(m.coin)}</span>
         <span class="al-on${m.on ? '' : ' off'}">${m.on ? '접속 중' : m.last}</span></div>`).join('');
    return home() + `<div class="lbl" style="margin:12px 0 6px">${t('단원')}</div>` + list
      + `<button class="st-danger" data-al-leave style="margin-top:8px">${t('연합 탈퇴')}</button>`;
  };

  /**
   * 기부 — 하루 5회 **계단**. 한 번 누르면 다음 계단으로 화면이 통째로 갈아탄다.
   * 표를 다섯 줄 늘어놓으면 무엇을 눌러야 하는지 매번 고르게 된다. 계단은
   * 고를 게 없다 — 지금 칸 하나만 크게 띄우고, 나머지는 발자국(pip)으로 남긴다.
   */
  const donateTab = () => {
    const A2 = A.contribution.donate;
    const a = donateState();
    const st = donateNext();
    const steps = A2.steps;

    // 발자국 — 지난 칸은 도장, 지금 칸은 빛나는 칸, 남은 칸은 값만 흐리게
    const pips = steps.map((x, i) => {
      const done = i < a.step, now = i === a.step;
      return `<div class="dn-pip ${done ? 'done' : now ? 'now' : ''}" data-tone="${x.tone}">
        <img src="/assets/ui/${x.icon}.png" alt="" onerror="this.remove()">
        <em>${done ? '✓' : x.kind === 'free' ? t('무료') : num(x.cost)}</em>
      </div>`;
    }).join('<i class="dn-line"></i>');

    const held = st && st.kind === 'gold' ? S.gold : st && st.kind === 'diamond' ? S.dia : 0;
    const lack = st && st.cost > held;

    const card = st
      ? `<div class="dn-card" data-tone="${st.tone}">
          <span class="dn-no">${t('{0} / {1} 번째', st.n, A2.dailyLimit)}</span>
          <img class="dn-ico" src="/assets/ui/${st.icon}.png" alt="" onerror="this.remove()">
          <b>${st.nameKo}</b>
          <span class="dn-desc">${st.descKo}</span>
          <div class="dn-trade">
            <span class="dn-give">${st.kind === 'free'
              ? t('비용 없음')
              : `<img src="/assets/ui/${st.icon}.png" alt="">${num(st.cost)}`}</span>
            <i>→</i>
            <span class="dn-get">${coin}${st.coin}</span>
          </div>
          ${st.kind === 'free' ? '' : `<span class="dn-have${lack ? ' lack' : ''}">${
            t('보유')} <img src="/assets/ui/${st.icon}.png" alt="">${num(held)}</span>`}
          <button class="fgbtn dn-go${lack ? ' off' : ''}" data-dn="1">
            ${lack ? t('{0} 부족', st.kind === 'gold' ? t('골드') : t('다이아')) : t('기부하기')}</button>
        </div>`
      : `<div class="dn-card done" data-tone="done">
          <img class="dn-ico" src="/assets/ui/CU-12.png" alt="" onerror="this.remove()">
          <b>${t('오늘 기부 완료')}</b>
          <span class="dn-desc">${t('내일 05:00 에 다섯 칸이 다시 열립니다')}</span>
          <div class="dn-trade"><span class="dn-get">${coin}${
            steps.reduce((n, x) => n + x.coin, 0)} ${t('획득')}</span></div>
        </div>`;

    // 보유 줄 — 기부에 쓰는 재화를 전부 띄운다. 눌러 보고서야 부족한 걸
    // 아는 화면이면 계단을 오를 계획을 못 세운다
    return `<div class="dn-wallet">
        <span><img src="/assets/ui/CU-12.png" alt="" onerror="this.remove()">${num(S.allyCoin || 0)}</span>
        <span><img src="/assets/ui/CU-04.png" alt="" onerror="this.remove()">${num(S.gold)}</span>
        <span><img src="/assets/ui/CU-01.png" alt="" onerror="this.remove()">${num(S.dia)}</span>
      </div>
      <div class="dn-track">${pips}</div>
      ${card}
      <div class="sh-note">${A.contribution.donateNote}</div>`;
  };

  $('#ovt').textContent = TITLE[tab] || '연합';
  setSkin('alliance');
  $('#ovb').innerHTML = head + ({ boss, donate: donateTab, shop, member, home: member }[tab] || member)();
  $('#ovb').querySelector('[data-al-leave]')?.addEventListener('click', allyLeave);
  $('#ovb').querySelectorAll('[data-albuy]').forEach(b =>
    b.addEventListener('click', () => allyBuy(b.dataset.albuy)));
  $('#ovb').querySelectorAll('[data-dn]').forEach(b =>
    b.addEventListener('click', () => donate()));
  $('#ovb').querySelectorAll('[data-al-go]').forEach(b =>
    b.addEventListener('click', () => openAlliance(b.dataset.alGo)));
  $('#ovb').querySelector('[data-al-fight]')?.addEventListener('click', () => allyBossFight());
  $('#ovinfo').innerHTML = '<div class="lbl" style="margin-bottom:6px">왜 이렇게 짰나</div>'
    + `<div class="sub" style="line-height:1.6">${A.meta.designNote}</div>`
    + `<div class="sub" style="line-height:1.6;margin-top:8px">
        골드 순유입 ${A.budgetImpact.goldFlow.net}</div>`;
  $('#ovb').querySelectorAll('[data-al]').forEach(x =>
    x.addEventListener('click', () => openAlliance(x.dataset.al)));
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

  // 서버 값이 늦게 오면 그때 다시 그린다. 처음엔 캐시(또는 데모)로 즉시 뜬다
  const redraw = () => { if ($('#ov').classList.contains('show')) openAlliance(tab); };
  live.pullMyAlliance(redraw);
  // 보스 단계는 홈 요약에도 뜬다 — 보스 탭에서만 받으면 홈이 늘 1단계로 보인다
  live.pullBoss(redraw);
  if (tab === 'boss') live.pullBossLog(redraw);
}

/** 계정 주소는 길다. 목록에는 앞뒤만 남긴다 — 닉네임은 profiles 에 따로 있다 */
const shortAcc = a => !a ? '단장'
  : a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a;
const ROLE_KO = { leader: '단장', officer: '부단장', member: '단원' };

/**
 * 연합 보스 도전. **판정은 서버가 쥔다** — HP 는 연합 공유라 클라가 깎으면
 * 30명이 서로를 덮어쓴다 (alliance.json > verse8.concurrency).
 * 그래서 전투는 화면에서 돌리고, **끝난 뒤 딜량 한 번만** 올린다.
 */
async function allyBossFight() {
  if (!live.liveReady()) {
    return toast('보스전은 서버 연동 후 열립니다 — 판정이 연합 공유 HP 라 클라 혼자 못 굴린다');
  }
  const bs = live.get('boss');
  if (bs && bs.triesLeft <= 0) return toast(t('이번 주 도전을 다 썼습니다'));
  const cp = Math.round(totalCp());
  // 시도딜 기준은 파티 CP x 1.723 이다 (sim/alliance-boss.js). 전투 연출을 붙이기 전까지
  // 그 값을 그대로 낸다 — 서버가 CP x 3.5 로 자르므로 조작 여지는 여기서 안 생긴다
  const dmg = Math.round(cp * 1.723 * (0.9 + Math.random() * 0.2));
  const r = await live.bossHit(dmg, cp)
    .catch(e => ({ ok: false, reason: String(e && e.message || e) }));
  if (!r?.ok) return toast(t(ALLY_ERR[r?.reason] || '도전하지 못했습니다'));
  live.invalidate('boss', 'bossLog');
  toast(r.killed
    ? t('보스 격파! 다음 단계가 열렸습니다')
    : t('{0} 피해 · 남은 도전 {1}회', num(r.damage), r.triesLeft));
  const redraw = () => { if ($('#ov').classList.contains('show')) openAlliance('boss'); };
  live.pullBoss(redraw); live.pullBossLog(redraw);
}

/** 보상 표시용 재화 이름. 데이터의 id 를 그대로 띄우면 유저가 못 읽는다. */
const CUR_KO = {
  gold: '골드', diamond: '다이아', equip_ticket: '장비 소환권',
  merc_ticket: '용병 소환권', skill_ticket: '스킬 소환권',
  speedup_5m: '모래시계', alliance_coin: '연합 코인', arena_medal: '훈장',
  dungeon_key: '던전 열쇠', dungeon_key_all: '전 던전 열쇠 +1',
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

/** 던전 보상 종류 → 세이브 필드. `ticket_mixed`(시련의 탑)는 아직 자리가 없다 */
const DG_BAG = { gold: 'gold', equip_ticket: 'eqTicket', diamond: 'dia', speedup_5m: 'hourglass' };

const dgNeedCp = (dg, floor) => dg.unlockCp * Math.pow(1.18, floor - 1);
const dgYield = (dg, floor) => dg.baseYield * Math.pow(1.15, floor - 1);

/**
 * 수문장 얼굴. **10층마다 바뀐다** (2026-08-24 결정).
 * tower.json > enemy.assetRotation 이 적어 둔 "전용 에셋은 10층 단위 마일스톤에만"
 * 과 같은 규칙이다. 던전마다 시작 얼굴을 어긋나게 잡아 — 그러지 않으면 다섯 던전이
 * 늘 같은 얼굴을 동시에 갈아 끼워 "던전마다 다른 곳" 이라는 느낌이 사라진다.
 *
 * 전용 그림(DGB-*)이 아직 없으면 스테이지 보스(B-*)로 떨어진다.
 */
function dgBoss(dg, floor) {
  const i = Math.max(0, D.dungeons.dungeons.findIndex(x => x.id === dg.id));
  const n = ((i * 2 + Math.floor((floor - 1) / 10)) % 6) + 1;
  const id = String(n).padStart(2, '0');
  return { bossId: `DGB-${id}`, fallback: `B-${id}` };
}

// 진행 중인 던전. 전투가 끝나면 onEvent 가 이걸 보고 보상을 준다.
// 전역에 두는 이유 — 전투 결과는 씬에서 비동기로 돌아오므로 호출부의 지역변수가
// 그때까지 살아 있지 않다.
let dgRun = null;

/**
 * 던전 입장. **실제 전투다** (2026-08-24 결정) — 예전에는 전투력 비교 한 줄이었다.
 * 제한시간 20초 안에 수문장을 잡으면 돌파, 시간이 다 되거나 파티가 전멸하면 실패다.
 * 열쇠는 승패와 무관하게 소모된다 (dungeons.json > entry.failureCost).
 */
async function runDungeon(dg) {
  const st = S.dg[dg.id];
  const entries = D.dungeons.entry.dailyKeyGrant;
  if (dgRun || arRun) return;              // 전투 중 재입장 금지 — 씬이 하나뿐이다
  if (dgKeysOf(dg.id) < 1) return toast(`${dg.nameKo} 열쇠 부족 · 매일 ${entries}개 지급`);
  S.dgKeys[dg.id]--;
  mq('dungeon_enter');
  save();


  dgRun = { dg, floor: st.floor, need: dgNeedCp(dg, st.floor) };
  roster.close();
  showDgSign(dg.nameKo, st.floor);
  // 상단 라벨(#stg)은 **비운다.** 층 간판이 바로 아래에 같은 것을 크게 걸고 있어서
  // "황금 광산 50층" 이 화면에 두 번 뜬다. 간판 쪽이 주인공이다.
  // 던전이 끝나면 runStage 가 스테이지 이름으로 다시 채운다.
  // **아래 await 들보다 먼저** 지운다 — 배경·파티 로드가 늦으면 그동안 스테이지
  // 이름이 간판과 나란히 떠 있게 된다
  $('#stg').innerHTML = '';
  markEncounter(-1);

  await scene.setBackground(DG_BG[dg.id] || 'BG-01');
  scene.captainClass = S.promoClass || 'warrior';
  await scene.setParty(S.party);
  scene.activeSkills = S.skills.active.filter(Boolean);
  scene.passiveSkills = S.skills.passive.filter(Boolean);
  scene.syncPassiveAura?.();

  const { bossId, fallback } = dgBoss(dg, st.floor);
  await scene.startDungeonFloor({
    floor: st.floor, requiredCp: dgRun.need, partyDps: partyDps(), bossId, fallback,
  });
}

/**
 * 포기. 20초를 다 보고 있을 이유가 없을 때 — 이미 못 이길 판이 보이거나,
 * 그냥 나가고 싶을 때 누른다. **한 번 누르면 바로 나간다.**
 *
 * 열쇠는 **돌려준다** — 아래 본문 참조.
 */
function dgGiveUp() {
  const r = dgRun;
  if (!r) return;
  scene.abortRun();
  // **열쇠를 돌려준다** (2026-08-24 결정). 포기는 전투를 중단하는 것이지 도전을
  // 쓴 것이 아니다 — 잘못 들어갔거나 화면을 그만 보고 싶을 때 누르는 버튼인데
  // 열쇠까지 날리면 아무도 안 누르고 20초를 그냥 흘려보낸다.
  // 실패(시간 초과·전멸)는 다르다 — 도전을 했으므로 열쇠가 소모된다
  // (dungeons.json > entry.failureCost)
  S.dgKeys[r.dg.id] = (S.dgKeys[r.dg.id] || 0) + 1;
  save(); renderTop();
  showResult('포기', '#ff5a6a');
  toast(`${r.dg.nameKo} ${r.floor}층 포기 — 열쇠를 돌려받았습니다`);
  dgReturn(1100);
}

/** 던전이 끝나면 항상 여기로 — 간판을 걷고 목록을 열고 방치 전투로 돌아간다 */
function dgReturn(delay = 1500) {
  dgRun = null;
  setTimeout(() => { hideDgSign(); openDungeons(); runStage(); }, delay);
}

/**
 * 층 간판. 위에서 떨어져 박히고, 돌파하면 숫자가 뒤집힌다.
 * 골드 액수보다 **한 층 올라갔다**가 진행 실감을 만든다 (연출 기획서 2-2).
 * 포기 버튼도 같이 뜬다 — 간판이 있는 동안이 곧 던전 전투 중이다.
 */
function showDgSign(name, floor) {
  const el = $('#dgSign');
  el.querySelector('b').textContent = name;
  el.querySelector('i').textContent = `${floor}층`;
  el.classList.remove('flip');
  el.classList.add('show');
  $('#dgQuit').classList.add('show');
}

function flipDgSign(floor) {
  const el = $('#dgSign');
  const i = el.querySelector('i');
  el.classList.add('flip');
  // 애니메이션 절반(간판이 모로 서서 안 보이는 순간)에 숫자를 바꾼다
  setTimeout(() => { i.textContent = `${floor}층`; }, 220);
  // 이긴 판에서는 포기 버튼이 바로 사라진다 — 남아 있으면 누를 것이 없는데 눌린다
  $('#dgQuit').classList.remove('show');
}

function hideDgSign() {
  $('#dgSign').classList.remove('show', 'flip');
  $('#dgQuit').classList.remove('show');
}

/**
 * 메인 화면 퀘스트 바. 상시 노출되고 누르면 이동하거나 수령한다.
 * quests.json > ui.showNextRewardNote — 다음 보상이 보이면 뭘 할지 자동으로 안다.
 */
/** 퀘스트 이름. 던전 퀘스트면 던전 이름을 붙인다 */
function questLabel(def) {
  const base = t(QUEST_TYPE[def.type]?.label || '');
  if (def.type === 'dungeon_floor' && def.dungeon) {
    const dg = D.dungeons.dungeons.find(x => x.id === def.dungeon);
    if (dg) return `${tn(dg.id, dg.nameKo)} ${def.target}${t('층')}`;
  }
  return base;
}

function renderQuest() {
  const def = questAt(D, S.quest);
  const cur = qProgress(def);
  const done = cur >= def.target;
  // 완료하면 카드가 통째로 "받아라"로 바뀐다 — 진행 숫자를 그대로 두면
  // 다 찼는데도 아직 할 일처럼 읽힌다
  // 던전 퀘스트는 **어느 던전**인지가 이름에 들어가야 한다 — "던전 도달" 만
  // 보면 다섯 던전 중 어디를 파야 하는지 알 수 없다
  // ⚠ 이 함수 안에 `t` 라는 지역 변수를 만들지 말 것 — i18n 의 t() 를 가려서
  //   퀘스트가 완료되는 순간 TypeError 로 게임이 통째로 멈췄다 (2026-08-25 실사고)
  $('#qname').textContent = done ? `Q${def.q} ${t('완료')}` : `Q${def.q} ${questLabel(def)}`;
  $('#qprog').textContent = done ? t('보상 받기') : `${num(cur)}/${num(def.target)}`;
  $('#qfill').style.width = Math.min(100, cur / def.target * 100) + '%';
  // 보상 미리보기 — 담을 자리가 있는 재화만 (QUEST_CUR). 없는 키를 그리면
  // 화면에는 보이는데 눌러도 안 들어오는 유령 보상이 된다
  $('#qrw').innerHTML = Object.entries(def.rewards || {})
    .filter(([k]) => QUEST_CUR[k] && CUR_ICON[k])
    .map(([k, v]) => `<span title="${CUR_KO[k] || k} ${num(v)}">
      <img src="/assets/ui/${CUR_ICON[k]}.png" alt="" onerror="this.remove()">
      <b>${num(v)}</b></span>`).join('');
  $('#quest').classList.toggle('done', done);
  maybeOnboardHint();
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
 *
 * @param i 지금 싸우는 조우의 번호 (0부터). -1 은 아직 시작 전이다.
 *
 * 씬이 주는 값(onEvent 의 e.encounter)은 **막 스폰한 웨이브**의 번호다 —
 * 즉 "끝낸 것"이 아니라 "지금 하는 것"이다. 예전에는 이걸 끝낸 번호로 읽어서
 * `k <= i` 를 채우고 화살표를 `i + 1` 에 뒀다: 싸우는 중인 조우가 이미 깬 것으로
 * 칠해지고 화살표는 아직 시작도 안 한 다음 점 위에 서 있었다.
 */
const markEncounter = i =>
  document.querySelectorAll('#enc .dotw').forEach((e, k) => {
    e.classList.toggle('on', k < i);        // 지나온 것
    e.classList.toggle('now', k === i);     // 지금 하는 것
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
  dungeon_key: 'DK-01',
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
// (제거됨 2026-08-25) fgRateIdx — 확률표가 밴드 탐색에서 현재/다음 두 열 비교로 바뀌었다
// 표의 원본은 소수점 넷째 자리까지다(합이 정확히 100 이 되게). 화면에는 줄인다 —
// 1% 미만은 자릿수가 곧 정보라 세 자리, 그 위는 두 자리
const fgPct = v => (v < 1 ? +v.toFixed(3) : +v.toFixed(2));

/**
 * 등급 확률 줄들. ratesB 가 있으면 현재/다음 두 열, 없으면 한 열.
 * 전 등급을 다 그린다 — 0% 도 자물쇠로 보여야 "언젠가 저게 나온다" 는
 * 사다리가 보인다.
 */
function forgeRateRows(ratesA, ratesB) {
  return D.equipment.grades.map(g => {
    const a = ratesA[g.tier] || 0;
    const b = ratesB ? (ratesB[g.tier] || 0) : null;
    const locked = a === 0 && (!ratesB || b === 0);
    const up = ratesB && b > a;          // 다음 레벨에서 오르는 등급 — 레벨업의 이유다
    const down = ratesB && b < a;
    return `<div class="fr2-row${locked ? ' locked' : ''}" style="--c:${g.color}">
      <i class="fr2-bar"></i>
      <b>${locked ? '<img class="lockIc" src="/assets/ui/IC-LOCK-S.png" alt="">' : ''}${t(g.nameKo)}</b>
      <span class="fr2-a">${fgPct(a)}%</span>
      ${ratesB ? `<span class="fr2-b${up ? ' up' : down ? ' down' : ''}">${fgPct(b)}%</span>` : ''}
    </div>`;
  }).join('');
}

/** 해금 이름. 데이터 원문이 키다 — 수량이 낀 자동 소환만 자리표 키로 접는다 */
function fgUnlockName(p) {
  const nm = p.nameKo || p.unlock;
  const m = nm.match(/^자동 소환 (\d+)개씩$/);
  return m ? t('자동 소환 {0}개씩', m[1]) : t(nm);
}

/**
 * ⓘ — 다른 레벨 구간의 확률 구성을 ‹ › 로 넘겨 보는 **별도 팝업**(#smPop).
 * (해금 목록이 있던 자리다. 해금은 본문 "다음 해금" 한 줄로 충분하고,
 * 확률은 공시 의무라 전 구간에 닿는 통로가 필요하다 — 단장 확정 2026-08-25.
 * 서랍이 아니라 팝업, 이동은 ‹ › 한 칸씩 — 단장 확정 2026-08-25 2차)
 */
function renderForgeRateBrowser(idx) {
  const bands = D.gacha.equipmentRateBands.bands;
  if (idx == null || idx < 0 || idx >= bands.length)
    idx = Math.max(0, bands.findIndex(b => S.forgeLv >= b.minLevel && S.forgeLv <= b.maxLevel));
  const b = bands[idx];
  const mine = S.forgeLv >= b.minLevel && S.forgeLv <= b.maxLevel;
  const lvLabel = b.minLevel === b.maxLevel ? `Lv ${b.minLevel}` : `Lv ${b.minLevel}–${b.maxLevel}`;
  const newG = b.unlocks ? D.equipment.grades[b.unlocks - 1] : null;
  const ttl = $('#smTitle');
  if (ttl) ttl.textContent = t('레벨별 확률');
  $('#smBody').innerHTML = `
    <!-- 화살표는 &lt; &gt; 다. ‹ › 는 글꼴에 없으면 양쪽이 같은 모양으로 떨어져
         어느 쪽이 다음인지 안 보인다 (단장 지적 2026-08-25) -->
    <div class="fr2-nav">
      <button class="hg-step" data-fgb="${idx - 1}" ${idx === 0 ? 'disabled' : ''}>&lt;</button>
      <span class="${mine ? 'fr2-now' : ''}" style="min-width:96px;text-align:center">
        ${lvLabel}${mine ? ` · ${t('현재')}` : ''}</span>
      <button class="hg-step" data-fgb="${idx + 1}" ${idx === bands.length - 1 ? 'disabled' : ''}>&gt;</button>
    </div>
    <div class="fr-rows">${forgeRateRows(b.rates, null)}</div>
    ${newG ? `<div class="fr-unlock" style="--c:${newG.color}">
        ${lvLabel} — <b>${t(newG.nameKo)}</b> ${t('등급이 새로 열립니다')}</div>` : ''}`;
  $('#smBody').querySelectorAll('[data-fgb]').forEach(x =>
    x.addEventListener('click', e => {
      e.stopPropagation();
      renderForgeRateBrowser(Math.max(0, Math.min(bands.length - 1, +x.dataset.fgb)));
    }));
  $('#smPop').classList.add('show');
}


/** ⓘ 의 화면별 오버라이드. null 이면 기본(서랍 토글). 화면 전환마다 리셋한다 */
let ovInfoAction = null;

/**
 * 패널 스킨 지정. 인라인 --ov-img 를 **반드시 지운다** — 제작대가 단계 그림으로
 * 덮어쓰기 때문에, 안 지우면 다음에 여는 화면이 대장간 배너를 물려받는다.
 */
function setSkin(name) {
  const c = $('#ovcard');
  c.dataset.skin = name;
  c.style.removeProperty('--ov-img');
  c.classList.remove('no-banner');   // 배너를 끈 화면이 다음 화면까지 물려주지 않게
  ovInfoAction = null;               // ⓘ 오버라이드도 화면 소유물이다
  $('#ovi').style.removeProperty('display');
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

  // 이 패널은 **레벨을 올리는 곳**이다. 소환은 본화면의 제작대 오브젝트에서 한다 —
  // 한 화면에서 둘 다 되면 레벨업 골드를 넣으려다 소환을 눌러 소환권이 샌다.
  //
  // 대장간 그림은 **머리 배너가 대신 든다**. 배너와 본문에 같은 그림을 두 장
  // 두면 배경이 겹쳐 보인다(실사용 보고). 배너는 현재 단계를 따라간다.
  // 레벨 배지는 안 단다 — 바로 아래 카드가 "Lv 30 › Lv 31" 로 이미 말하고 있어
  // 같은 숫자가 두 번 뜬다 (단장 지적 2026-08-25)
  h.push(`<div id="fgBar">
      <span id="fgStage">${t('{0}단계 대장간 · {1} 구간', stageNo, vis ? vis.levelRange : '')}</span>
    </div>`);


  // 레벨 카드 하나로 묶는다 — 이 패널의 일은 **레벨을 올리는 것** 하나뿐이라
  // 진행·비용·남은 시간이 흩어져 있으면 무엇을 눌러야 하는지가 안 읽힌다
  if (c || running) {
    const tgt = running ? S.forgeTarget : next;
    const cc = forgeCost(tgt) || c;
    const paid = running ? cc.parts : (S.forgePaid || 0);
    const cells = Array.from({ length: cc.parts },
      (_, i) => `<i class="${i < paid ? 'on' : ''}"></i>`).join('');
    const can = running ? Math.min(S.hourglass || 0, Math.ceil(forgeRemain() / 300)) : 0;

    h.push(`<div class="fg-up${running ? ' busy' : ''}">
      <div class="fg-up-h">
        <span class="fg-lvfrom">Lv ${S.forgeLv}</span>
        <i class="fg-arrow">▸</i>
        <span class="fg-lvto">Lv ${tgt}</span>
        ${running ? `<em class="fg-tag">${t('제작 중')}</em>` : ''}
      </div>
      <div id="fgProg"><div id="fgProgFill" style="width:${pct}%"></div></div>
      ${running
        ? `<div class="fg-up-row"><span class="k">${t('남은 시간')}</span>
             <span class="v" id="fgLeft">${dur(forgeRemain())}</span></div>
           <button class="fgbtn hg-open" id="fgHgOpen" ${can < 1 ? 'disabled' : ''}>
             ${cur('CU-10')} ${can < 1 ? t('모래시계 없음') : t('시간 단축')}</button>`
        : `<div class="fg-up-row"><span class="k">${t('골드 투입')}</span>
             <span class="v"><span class="fg-cells">${cells}</span>
               <b style="margin-left:7px">${paid}/${cc.parts}</b></span></div>
           <div class="fg-up-row"><span class="k">${t('제작 시간')}</span>
             <span class="v">${dur(cc.sec)}
               <span style="color:var(--dim);font-size:10px">(${t('마지막 투입 후')})</span></span></div>
           <button class="fgbtn" id="fgPayBtn" ${S.gold < cc.per ? 'disabled' : ''}>
             ${cur('CU-04')} ${num(cc.per)}</button>`}
    </div>`);
  } else {
    h.push(`<div class="fg-up done"><div class="fg-up-h">
      <span class="fg-lvto">Lv ${S.forgeLv}</span></div>
      <div class="fg-up-row"><span class="k">${t('최대 레벨 도달')}</span>
        <span class="v">${t('더 올릴 곳이 없습니다')}</span></div></div>`);
  }

  // 확률표는 본문 상시 노출이다 (단장 확정 2026-08-25). 배지 팝업에 숨기면
  // 공시 확률을 한 번 더 눌러야 보이고, 레벨업의 이유(다음 열 초록)도 안 보인다.
  {
    const bands = D.gacha.equipmentRateBands.bands;
    const curB = eqBandNow();
    const maxLv = bands[bands.length - 1].maxLevel;
    const nextB = S.forgeLv < maxLv ? eqBandNow(S.forgeLv + 1) : null;
    const unlockNext = nextB?.unlocks
      ? `<div class="fr-unlock" style="--c:${D.equipment.grades[nextB.unlocks - 1].color}">
           Lv ${S.forgeLv + 1} — <b>${t(D.equipment.grades[nextB.unlocks - 1].nameKo)}</b> ${t('등급이 새로 열립니다')}</div>`
      : '';
    // 머리글은 **아래 두 숫자 열과 같은 자리**에 선다 — 가운데 정렬로 두면
    // 어느 퍼센트가 지금이고 어느 게 다음인지 눈으로 짝지어야 한다
    h.push(`<div id="fgRates">
      <div class="fr2-head">
        <span class="fr2-hgap"></span>
        <span class="fr2-now">${t('현재')} Lv ${S.forgeLv}</span>
        ${nextB ? `<span class="fr2-next">${t('다음')} Lv ${S.forgeLv + 1}</span>`
                : `<span class="fr2-next">${t('최대 레벨')}</span>`}
      </div>
      <div class="fr-rows">${forgeRateRows(curB.rates, nextB && nextB.rates)}</div>
      ${unlockNext}
      <div class="sh-note">${t(D.gacha.perItemRateFormula.legalRequirement)}<br>
        ${t('부위 확률 = 등급 확률 ÷ 부위 {0}종 (부위는 균등 추첨)', D.equipment.slots.length)}</div>
    </div>`);
  }

  // 다음 해금 한 줄만 본문에. 전체 해금 목록 대신 ⓘ 는 레벨별 확률 열람기다.
  const nextUnlock = D.equipment.summon.progression.find(p => p.summonLv > S.forgeLv);
  if (nextUnlock) {
    h.push(`<div class="frow" style="padding:7px 12px">
      <span class="k">${t('다음 해금 Lv {0}', nextUnlock.summonLv)}</span>
      <span class="v" style="font-size:12px">${fgUnlockName(nextUnlock)}</span></div>`);
  }

  const reopen = () => { const y = $('#ovb').scrollTop; openForge(); $('#ovb').scrollTop = y; };

  $('#ovt').textContent = '제작대';
  setSkin('forge');
  // 배너를 현재 단계 대장간으로 갈아 끼운다 — 레벨이 오르면 머리 그림이 바뀐다
  $('#ovcard').style.setProperty('--ov-img', `url(/assets/ui/FG-0${stageNo}.webp)`);
  // 모래시계는 이 화면에서만 쓰는 재화다. 헤더에 두면 본문이 안 밀린다.
  $('#ovh').classList.add('has-cur');
  // + 를 누르면 상점 교환 탭(모래시계 묶음)으로 간다 — 부족을 확인한 그 자리가
  // 지갑을 여는 자리다. 다이아/골드의 +와 같은 문법 (top 의 diaPlus/goldPlus)
  $('#ovcur').innerHTML = `${cur('CU-10')}<b>${num(S.hourglass || 0)}</b>
    <button id="fgHgPlus" class="cur-plus" aria-label="모래시계 구매">+</button>`;
  $('#fgHgPlus')?.addEventListener('click', e => {
    e.stopPropagation();
    $('#ov').classList.remove('show');
    shop.open('exchange');
    // 모래시계 칸까지 스크롤 — 탭만 열어 주면 골드 상품이 먼저 보여 헤맨다
    setTimeout(() => document.querySelector('#shHg')?.scrollIntoView({ block: 'start' }), 60);
  });
  $('#ovb').innerHTML = h.join('');
  // ⓘ 는 서랍 대신 **레벨별 확률 팝업**을 연다. 서랍(ovinfo)이 비면 버튼이
  // 숨는 CSS(:has(:empty))가 있어 인라인 display 로 되살린다 — setSkin 이 지운다
  $('#ovinfo').innerHTML = '';
  $('#ovi').style.display = 'block';
  ovInfoAction = () => renderForgeRateBrowser();
  $('#ov').classList.remove('forced'); $('#ov').classList.add('show');

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
    <i>${isNew ? t('새로 나옴') : t('착용 중')}</i>
    ${eqImg(sl, it.tier)}>
    <b style="color:${g.color}">${t(g.nameKo)} T${it.tier}</b>
    <div class="er-cp">${t(sl.nameKo)} · ${t('전투력')} <em>${cpNum(cp)}</em></div>
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
  // 제작 횟수. **수동 1회 제작은 이 경로다** — summonEquip() 은 자동·다연차 전용이라
  // 거기에만 카운터를 두면 모루를 아무리 두드려도 퀘스트가 안 오른다 (실제로 그랬다)
  S.eqSummons = (S.eqSummons || 0) + 1;
  const it = equipRoll();
  save(); renderTop(); renderForgeDock(); renderQuest();
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
  $('#ovt').textContent = t(sl.nameKo);
  setSkin('equip');
  $('#ovh').classList.remove('has-cur');
  $('#ovinfo').innerHTML = '';

  if (!it) {
    $('#ovb').innerHTML = `<div class="ei-empty">
      ${t('{0} 부위가 비어 있습니다.', t(sl.nameKo))}<br>
      ${t('제작대에서 장비를 소환하면 착용할 수 있습니다.')}</div>`;
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
      <span class="ei-name"><b style="color:${g.color}">${t(g.nameKo)} T${it.tier}</b></span>
    </div>`
    + `<div class="frow"><span class="k">${t('전투력 상승량')}</span>
      <span class="v" style="color:var(--up);font-size:15px">+${cpNum(gain)}</span></div>`
;
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
    h.push(`<button class="er-pick" id="erWear">${t('착용하기')}</button>`);
    h.push(`<button class="er-pick scrap" id="erScrap">${t('분해')}</button>`);
    h.push(`<div class="er-note">${t('{0} 부위가 비어 있습니다.', t(sl.nameKo))}</div>`);
  } else {
    // 기준은 "지금 낀 것" 의 전투력. 양쪽 카드가 같은 잣대를 쓴다.
    const base = Math.round(cpWith(it.slot, now));
    h.push(`<div class="er-wrap">${eqCard(now, false, base)}
      <span class="er-vs">VS</span>${eqCard(it, true, base)}</div>`);
    const dCp = Math.round(cpWith(it.slot, it) - cpWith(it.slot, now));
    h.push(`<div class="er-note">${t('고른 쪽을 착용하고 나머지는 분해됩니다.')}<br>
      ${t('새 장비로 바꾸면 전투력 {0}',
        `<b style="color:${dCp >= 0 ? 'var(--up)' : 'var(--warn)'}">${dCp >= 0 ? '+' : ''}${cpNum(dCp)}</b>`)}</div>`);
  }

  $('#ovt').textContent = '장비 소환';
  setSkin('equip');
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
  // 소환 **횟수** 누적. 제작대 레벨(forgeLv)과 다른 축이다 — 레벨은 강화로도
  // 오르지만 이건 "몇 번 뽑았나" 라서 첫 퀘스트가 제작대를 한 바퀴 돌게 만든다
  S.eqSummons = (S.eqSummons || 0) + n;
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
  // 패시브는 연출용이다 — 판정은 전투력에만 반영된다

  scene.passiveSkills = S.skills.passive.filter(Boolean);
  scene.syncPassiveAura?.();
  await scene.startTowerFloor(floor, towerCp(D, floor), partyDps());
  renderTop();
}

async function runStage() {
  // 던전이 도는 중에는 방치 전투로 안 돌아간다. 예약된 setTimeout(runStage) 이
  // 던전 입장 직후에 터지면 배경·파티·웨이브를 전부 스테이지 것으로 갈아 버린다
  if (dgRun) return;
  const bgId = bgFor(S.stage);
  await scene.setBackground(bgId);
  scene.captainClass = S.promoClass || 'warrior';
  await scene.setParty(S.party);
  const lb = stageLabel(S.stage);
  $('#stg').innerHTML = `${lb.text}<i>${lb.zone}</i>`;
  markEncounter(-1);
  // 장착된 액티브 스킬만 전투 이펙트로 나온다
  scene.activeSkills = S.skills.active.filter(Boolean);
  // 패시브는 연출용이다 — 판정은 전투력에만 반영된다

  scene.passiveSkills = S.skills.passive.filter(Boolean);
  scene.syncPassiveAura?.();
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
/**
 * 탭 유도. 목표 버튼 위에서 고양이 발이 톡톡 두드린다.
 *
 * 퀘스트 배너는 **화면까지만** 데려다준다. 거기서 뭘 눌러야 하는지는 따로
 * 말해 주지 않으면, 첫 퀘스트(무기 제작 5회)에서 제작대를 열어 놓고도
 * 모루를 못 찾아 막힌다.
 *
 * 목표를 실제 좌표로 따라가게 fixed 로 띄운다 — 시트 안이든 도크든 상관없다.
 * 한 번 누르면 사라지고, 안 눌러도 6초 뒤에 걷힌다 (계속 떠 있으면 잔소리다).
 */
let tapHintT = null;
let tapHintSel = null;
// 이번 퀘스트에서 **이미 눌러 본** 목표. 한 번 누르면 그 퀘스트 동안은 다시 안
// 뜬다 — renderQuest 가 자주 도는데 그때마다 손이 되살아나면 잔소리가 된다
let tapHintUsed = null;
function showTapHint(sel, ms = 6000) {
  const hint = $('#tapHint');
  const el = typeof sel === 'string' ? $(sel) : sel;
  clearTimeout(tapHintT);
  if (!el || !hint) return;
  // 같은 목표로 이미 떠 있으면 그냥 둔다 — renderQuest 가 자주 도는데 그때마다
  // 다시 걸면 click 리스너가 계속 쌓이고 애니메이션도 매번 처음으로 튄다
  if (tapHintSel === sel && hint.classList.contains('show')) return;
  tapHintSel = sel;
  const place = () => {
    const r = el.getBoundingClientRect();
    if (!r.width) return hideTapHint();
    // 버튼의 오른쪽 아래에 걸친다 — 가운데에 두면 정작 눌러야 할 그림을 가린다
    hint.style.left = Math.round(r.left + r.width * 0.62) + 'px';
    hint.style.top = Math.round(r.top + r.height * 0.58) + 'px';
  };
  place();
  hint.classList.add('show');
  // 목표를 누르면 역할이 끝났다
  el.addEventListener('click', () => {
    if (typeof sel === 'string') tapHintUsed = `${S.quest}:${sel}`;
    hideTapHint();
  }, { once: true });
  // ms 가 0 이면 **안 사라진다** — 온보딩 구간은 누를 때까지 손이 남아 있는다
  if (ms > 0) tapHintT = setTimeout(hideTapHint, ms);
}

function hideTapHint() {
  clearTimeout(tapHintT);
  tapHintSel = null;
  $('#tapHint')?.classList.remove('show');
}

// 파라미터 이름을 t 로 두지 않는다 — i18n 의 t() 를 가리면 나중에 번역을
// 넣는 손이 그대로 지뢰를 밟는다 (renderQuest 에서 실제로 터졌다)
function questGoto(qt) {
  // 목적지가 없으면 아무것도 안 한다. 전투 화면에서 '전투하세요' 는 소음이다.
  if (!qt || !qt.goto) return;
  if (qt.goto === 'shop') shop.open(qt.track);
  else if (qt.goto === 'forge') openForge();
  else if (qt.goto === 'dungeon') openDungeons();
  else if (qt.goto === 'tower') tower.open();
  // 도크의 모루는 이미 화면에 있다 — 열 것이 없고, 덮고 있는 패널만 걷는다
  else if (qt.goto === 'forgeDock') { $('#ov').classList.remove('show', 'forced'); roster.close(); }
  else if (qt.goto === 'training') openTraining();
  // 화면이 뜬 **다음** 프레임에 좌표를 잡는다. 열기 전에 재면 아직 0 이다
  const target = TAP_TARGET[qt.goto];
  if (target) requestAnimationFrame(() => setTimeout(() => showTapHint(target), 120));
}

/** 퀘스트 목적지 → 실제로 눌러야 하는 버튼 */
const TAP_TARGET = {
  forgeDock: '#fgObj',
  shop: '.sh-summon .sh-pull',
  dungeon: '.dg:not(.lock)',
  training: '#tcUp',   // 훈련소 [강화] 버튼
};

/**
 * 온보딩 구간(Q1~Q8)에서는 **누르지 않아도** 손이 뜬다.
 *
 * 퀘스트 배너를 눌러야 유도가 나오면, 배너가 눌리는 것인지 모르는 사람에게는
 * 아무 도움이 안 된다. 기능을 하나씩 소개하는 구간이라 손이 먼저 말을 건다.
 * Q9 부터는 안 뜬다 — 그때는 이미 어디에 뭐가 있는지 안다.
 */
const ONBOARDING_UNTIL = 8;
function maybeOnboardHint() {
  if ((S.quest || 1) > ONBOARDING_UNTIL) return hideTapHint();
  const def = questAt(D, S.quest);
  // **다 채웠으면 목표가 아니라 퀘스트 배너를 가리킨다.** 예전에는 목표만 봐서,
  // Q1 을 다 깨고 나서도 손이 모루 위에서 계속 두드렸다 — 그 시점에 눌러야 할
  // 것은 제작이 아니라 [보상 받기] 다
  if (qProgress(def) >= def.target) return showTapHint('#quest', 0);
  const qt = QUEST_TYPE[def.type];
  const sel = TAP_TARGET[qt?.goto];
  // 목적지 화면이 이미 열려 있을 때만. 안 열려 있으면 가리킬 것이 화면에 없다
  if (!sel || !document.querySelector(sel)?.getBoundingClientRect().width) return hideTapHint();
  // 이 퀘스트에서 이미 한 번 눌렀으면 그만 — 어디를 눌러야 하는지는 배웠다
  if (tapHintUsed === `${S.quest}:${sel}`) return hideTapHint();
  showTapHint(sel, 0);   // 누를 때까지 남는다
}

/** 이 스테이지 1회 클리어의 골드 총액 (stages.json > rewards.repeatClear.gold) */
/**
 * 처치 하나당 골드. **하한 100** 이다 (2026-08-24 결정).
 *
 * 곡선(requiredCp^1.35)만 쓰면 1스테이지에서 킬당 2골드가 나온다 — 숫자가 안
 * 읽히고 "잡아도 아무것도 안 들어온다" 로 느껴진다. 하한은 초반에만 걸리고,
 * 스테이지 49 쯤에서 곡선이 100 을 넘어서면 그때부터 곡선이 주도한다.
 */
const KILL_GOLD_MIN = 100;
/** 처치마다 ±흔들림. 같은 숫자가 반복되면 "고정 지급" 으로 읽혀 잡는 맛이 없다 */
const KILL_GOLD_SPREAD = [0.8, 1.3];
function killGold() {
  const g = D.stages.rewards.repeatClear.gold;
  const base = Math.max(KILL_GOLD_MIN, stageGold() * g.split.mobs / g.mobsPerStage);
  const [lo, hi] = KILL_GOLD_SPREAD;
  return Math.round(base * (lo + Math.random() * (hi - lo)));
}

function stageGold(n = S.stage) {
  const g = D.stages.rewards.repeatClear.gold;
  return Math.pow(requiredCp(n), g.exponent) * g.coefficient;
}

function onEvent(e) {
  // 던전 전투 중에 날아오는 **스테이지 이벤트는 옛 판의 잔여물**이다.
  // 여기서 걸러 내지 않으면 runStage 가 다시 걸려 수문장을 밀어낸다
  if (dgRun && ['win', 'lose', 'bossReady', 'stage'].includes(e.type)) return;
  if (e.type === 'kill') {
    // 누적 처치. 퀘스트 진행도라 렌더까지 해야 배너가 즉시 찬다
    S.kills = (S.kills || 0) + 1;
    // 잡몹도 골드를 준다. 보스만 주면 벽에 막힌 유저의 수입이 0 이 되고,
    // 절전으로 밤새 돌려도 획득 골드가 0 이다 (gold.splitNote)
    S.gold += killGold();
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
  } else if (e.type === 'arenaHp') {
    const el = $('#arBars');
    el.querySelector('.ar-me i').style.width = Math.max(0, e.my * 100) + '%';
    el.querySelector('.ar-foe i').style.width = Math.max(0, e.foe * 100) + '%';
  } else if (e.type === 'arenaEnd') {
    const r = arRun;
    if (!r) return;
    arRun = null;
    S.arenaScore = Math.max(0, r.from + r.delta);
    mq('arena');
    if (r.win) mq('arena_win');
    save(); renderTop();
    // 점수는 **깎이는 것도 보여 준다.** 진 것을 흐리면 다음에 왜 이겨야 하는지가
    // 안 남는다 (연출 기획서 3-1)
    countUpScore(r.from, S.arenaScore, r.win);
    showResult(r.win ? `승리! +${r.delta}` : `패배 ${r.delta}`, r.win ? 'var(--up)' : '#ff5a6a');
    // 진 판은 화면이 회색으로 빠진다. 캔버스에 거는 것이라 유닛만이 아니라
    // 배경까지 같이 죽는다 — 졌다는 것이 한눈에 읽힌다
    if (!r.win) $('#cv').classList.add('gray');
    setTimeout(() => {
      $('#cv').classList.remove('gray');
      hideArenaBars(); openArena(); runStage();
    }, 1500);
  } else if (e.type === 'dungeonWin') {
    const r = dgRun;
    if (!r) return;
    const st = S.dg[r.dg.id];
    st.floor++;
    mq('dungeon_floor');
    const gain = Math.round(dgYield(r.dg, r.floor));
    const bag = DG_BAG[r.dg.reward];
    if (bag) S[bag] += gain;
    save(); renderTop(); renderQuest();
    // 간판이 먼저 뒤집히고, 보상은 그 뒤에 따라온다 — 순서가 반대면
    // 숫자가 시선을 가져가서 "한 층 올라갔다" 가 안 남는다
    flipDgSign(st.floor);
    if (bag) setTimeout(() => gainToast([[r.dg.reward, gain]]), 420);
    dgReturn();
  } else if (e.type === 'dungeonLose') {
    const r = dgRun;
    showResult(e.reason === 'wipe' ? '전멸' : '시간 초과', '#ff5a6a');
    // 왜 졌는지를 남긴다. 토스트 한 줄이면 열쇠만 날린 느낌으로 끝난다 (기획서 2-2)
    if (r) setTimeout(() => toast(
      `${r.dg.nameKo} ${r.floor}층 실패 — 권장 ${t('전투력')} ${num(r.need)} · 지금 ${num(totalCp())}`), 700);
    dgReturn(1400);
  } else if (e.type === 'win') {
    bossLocked = false;
    $('#hudC').classList.remove('farm');
    $('#bossGo').classList.remove('show');
    // 클리어 표시는 띄우지 않는다 — 매 스테이지 뜨면 진행이 끊긴다
    S.maxStage = Math.max(S.maxStage, S.stage);
    // 보스 몫만. 잡몹 몫은 처치할 때마다 이미 들어갔다.
    // 하한과 흔들림은 잡몹과 같은 규칙을 쓴다 — 보스가 잡몹 한 마리보다 적게
    // 주면 이상하고, 매번 같은 숫자가 뜨는 것도 이상하다
    S.gold += Math.max(killGold(),
      Math.round(stageGold() * D.stages.rewards.repeatClear.gold.split.boss));
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

/**
 * 간판 글자를 판 안에 맞춘다. 크기는 10cqi(간판 폭 기준)로 시작하는데,
 * 이는 한국어 5자 기준이라 영어처럼 긴 번역은 판을 좌우로 넘는다.
 * 폰트가 나중에 도착하면 폭이 다시 변하므로 fonts.ready 뒤에 한 번 더 잰다.
 */
function fitBootTitle() {
  const el = $('#bootTitle');
  if (!el) return;
  const fit = () => {
    el.style.fontSize = '';
    // 한 줄이 안 들어가면 **가운데 공백에서 두 줄로 직접 가른다.**
    // 자동 축소에만 맡기면 "두 줄→한 줄" 경계에서 작은 한 줄로 멈춘다 (실측 22px).
    // 컨테이너가 flex 라 <br> 은 span 안에 있어야 줄바꿈이 된다.
    // 두 번째 호출(fonts.ready)에서 textContent 를 다시 읽으면 <br> 자리의
    // 공백이 사라져 "NyangMercenaries" 로 붙는다 — 원문을 캐시해 둔다
    const raw = (el.dataset.full || el.textContent).trim().replace(/\s+/g, ' ');
    el.dataset.full = raw;
    el.textContent = raw;
    if (raw.includes(' ') && el.scrollWidth > el.clientWidth) {
      const ws = raw.split(' ');
      let best = 1, diff = Infinity;
      for (let i = 1; i < ws.length; i++) {
        const d = Math.abs(ws.slice(0, i).join(' ').length - ws.slice(i).join(' ').length);
        if (d < diff) { diff = d; best = i; }
      }
      const sp = document.createElement('span');
      sp.append(ws.slice(0, best).join(' '), document.createElement('br'), ws.slice(best).join(' '));
      el.replaceChildren(sp);
    }
    let size = parseFloat(getComputedStyle(el).fontSize);
    let guard = 30;
    while (guard-- > 0 && size > 9
        && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  };
  fit();
  document.fonts?.ready.then(fit);
}

/**
 * 타이틀 반짝이. 그림(TT-SPARK)은 **한 장**이고 개수·위치·점멸 시점은 여기서
 * 만든다 (에셋 규칙 1-4 — 프레임 그림을 여러 장 뽑지 않는다).
 *
 * 세로 위치는 에셋 문서 21-2 의 가림 표를 따른다: 간판(28~58%)과
 * 시작 문구(86%~) 위에는 뿌리지 않는다 — 뿌려도 가려서 안 보인다.
 */
function bootSparks(n = 16) {
  const host = $('#bootFx');
  if (!host) return;
  const probe = new Image();
  probe.onload = () => {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('img');
      s.src = probe.src;
      s.className = 'tt-spark';
      // 하늘과 초원에 번갈아 — 한쪽에만 몰리면 뿌린 티가 난다
      const top = i % 2 ? 5 + Math.random() * 21 : 60 + Math.random() * 24;
      s.style.cssText = `left:${(2 + Math.random() * 92).toFixed(1)}%;`
        + `top:${top.toFixed(1)}%;width:${(9 + Math.random() * 15).toFixed(0)}px;`
        + `animation-delay:${(Math.random() * 3.4).toFixed(2)}s`;
      frag.appendChild(s);
    }
    host.appendChild(frag);
  };
  probe.onerror = () => { /* 그림이 없으면 안 뿌린다. 나머지 화면은 그대로 */ };
  probe.src = '/assets/ui/TT-SPARK.webp';
}

/**
 * 탭하여 시작 — 로딩이 끝나도 화면을 바로 걷지 않는다.
 *
 * 100% 를 찍자마자 전투가 굴러가면 플레이어가 앉기 전에 첫 웨이브가 지나간다.
 * 한 번의 탭이 그 사이를 끊어 준다 — 그리고 그 탭은 **사용자 제스처**라,
 * 나중에 BGM 을 붙일 때 브라우저 자동재생 잠금을 여는 자리도 여기가 된다.
 *
 * 이 promise 가 풀린 뒤에 runStage() 가 돈다.
 */
function bootTapToStart() {
  return new Promise(res => {
    const box = $('#boot');
    if (!box) return res();                 // 이미 걷혔으면 그냥 진행
    const label = $('#bootStart');
    if (label) label.textContent = t('화면을 눌러 시작');
    box.classList.add('ready');
    // pointerdown 하나로 마우스·터치·펜을 다 받는다. 키보드(데스크톱)는 따로.
    // 어느 쪽이 먼저 오든 start() 는 한 번만 통과한다
    let done = false;
    const start = () => {
      if (done) return;
      done = true;
      box.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      box.classList.add('hide');
      setTimeout(() => box.remove(), 500);  // CSS 의 opacity .4s 가 끝난 뒤
      res();
    };
    box.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  });
}

(async function boot() {
  // 광고 SDK 는 데이터 로드보다 먼저 건다 — 호스트 메시지 리스너를 일찍 걸수록
  // 핸드셰이크가 unsupported 로 굳을 창이 좁아진다 (net/ads.js > initAds)
  initAds();
  bootSparks();

  bootStep(12);
  // **세이브를 먼저 읽는다.** 언어 선택은 S.lang 을 보고 "첫 실행인지"를 판단하는데,
  // load() 앞에서 물으면 S.lang 이 늘 비어 있어 매번 다시 묻고 거기서 멈춘다.
  // localStorage 라 동기이고, loadData 보다 앞서도 안전하다
  load();
  await bootLangPick();
  watchDom();     // 외국어면 이후 붙는 모든 화면 글자를 사전으로 치환한다 (ko 는 no-op)
  fitBootTitle(); // watchDom 이 방금 간판 글자를 번역했다 — 넘치면 여기서 줄인다
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
  // **시작 편성은 비어 있다** (2026-08-24). 예전에는 무작위 용병 3명과 스킬을
  // 쥐여 주고 시작했는데, 뽑기 게임에서 첫 화면부터 SSR 이 서 있으면 첫 소환의
  // 무게가 사라진다. Q1 보상이 용병 소환권 10장이고, 그때까지는 단장이 혼자
  // 싸운다 (scene.capFlatDps).
  //
  // 옛 세이브는 그대로 둔다 — 이미 받은 용병을 빼앗지 않는다.

  bootStep(38);
  reveal = new SummonReveal($('#app'));
  roster = new RosterSheet({
    state: S, data: D, cpOf, skillCp, toast, openUnitInfo, savePreset, loadPreset,
    enhance: autoEnhance, equip: applyAutoEquip, canEquip: canAutoEquip,
    dungeonHtml, bindDungeons, slotsOf, tellSlotLock,
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
      else if (k === 'fx') { S.fxOn = !!v; scene.fx.enabled = !!v; }
      else if (k === 'shake') { S.shakeOn = !!v; scene.impact.opts.shake = !!v; }
      else if (k === 'nums') { S.numsOn = !!v; scene.numbers.enabled = !!v; }
      else if (k === 'bgm') S.bgm = v;
      else if (k === 'sfx') S.sfx = v;
      // 언어는 **다시 시작**한다. 사전만 갈아끼우면 이미 그려진 화면과
      // index.html 에 박힌 한국어가 그대로 남아 반쯤 번역된 화면이 된다.
      // 세이브는 localStorage 라 reload 로 잃는 것이 없다
      else if (k === 'lang') {
        if (v === S.lang) return;
        S.lang = v; saveNow(); location.reload(); return;
      }
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
    buyHourglass: (count, dia) => {
      if (S.dia < dia) { toast(`다이아 ${num(dia - S.dia)} 부족`); return false; }
      S.dia -= dia;
      S.hourglass = (S.hourglass || 0) + count;
      save(); renderTop();
      gainToast([['speedup_5m', count]]);
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
    pullCost: (trackId, n) => pullCost(trackId, n),
    tellSlotLock: (kind, idx) => tellSlotLock(kind, idx),
    buySpeed3, claimSpeed3Daily,
  });
  bootStep(55);
  scene = new BattleScene($('#cv'), { data: D, onEvent });
  // 단장의 고정 피해. **1스테이지 보스를 제한시간 안에 겨우 잡는 크기**로 잡는다.
  // 절대값으로 박으면 밸런스를 고칠 때마다 이 숫자를 따로 기억해야 하므로
  // 요구 전투력에 묶는다 — 요구치가 지수로 오르니 뒤로 갈수록 저절로 사라진다.
  //
  // 기준은 **1스테이지 보스를 평타 3대에 눕히는 것**이다 (사용자 결정).
  //   보스 체력 = 요구 CP × 1.79 · 평타 간격 평균 2.1초
  //   3대 = 3 × (DPS × 2.1) = 요구 × 1.79  →  DPS = 요구 × 0.284
  // 잡몹(요구 × 0.047)은 한 방에 죽는다.
  scene.capFlatDps = requiredCp(1) * 0.284;
  window.__scene = scene;   // 디버그용
  window.__S = S;
  window.__wall = showWallHint;   // 디버그용 — 벽 안내를 손으로 띄워 본다
  // 던전·아레나는 열쇠·입장 횟수를 태워야 볼 수 있어서 손으로 검사하기 번거롭다.
  // 콘솔에서 바로 걸어 볼 수 있게 열어 둔다 (window.__scene 과 같은 성격)
  // 서버 없이 live 경로를 시험할 수 있게 열어 둔다 —
  // __dbg.live.initLive(mockServer) 로 붙였다 떼었다 할 수 있다
  window.__dbg = { runStage, runDungeon, arenaFight, arenaFoes, live,
    openAllianceGate, openAlliance, openArena, openFriends, openChat };
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
    const tab = n.dataset.tab;
    if (!navOpen(tab)) {
      const need = D.quests.navUnlockQuests.tabs[tab].afterQuest;
      return toast(t('퀘스트 {0} 를 끝내면 열립니다', need));
    }
    // **켜진 탭을 다시 누르면 닫는다.** 시트 탭에서 닫는 경로가 X 버튼뿐이면
    // 열었던 손가락이 그대로 한 번 더 눌러 닫는 자연스러운 왕복이 안 된다
    if (navTab === tab && ['merc', 'skill', 'dungeon'].includes(tab) && roster.isOpen) {
      roster.close();
      navTab = null;
      syncNav();
      return;
    }
    navTab = tab;
    // 시트는 네비 위에 떠 있다. 시트를 안 쓰는 탭으로 가면 닫아 준다
    if (!['merc', 'skill', 'dungeon'].includes(tab)) roster.close();
    // ui.json > mainScreen.navBar.items 기준. 장비는 하단 패널에 있으므로 뺐다.
    if (tab === 'shop') shop.open();
    else if (tab === 'dungeon') openDungeons();
    else if (tab === 'alliance') { if (S.ally) alli.open(); else openAllianceGate(); }
    else if (tab === 'merc') roster.open('mercenary');
    else if (tab === 'skill') roster.open('skill');
    else toast(`${n.textContent} 탭 — 미구현`);
    // **연 뒤에** 맞춘다. 열기 전에 부르면 아직 아무것도 안 떠 있어 바로 지워진다
    syncNav();
  }));

  // 설정은 사이드 열에서 상단바로 옮겼다. 스테이지 표시는 HUD 진행도와 중복이라 뺐다.
  $('#topSet').addEventListener('click', () => settings.open());
  $('#dgQuit').addEventListener('click', dgGiveUp);
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
    else if (b.dataset.s === 'friend') openFriends();
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
          ? t('{0}분 {1}초', Math.floor(sec / 60), sec % 60)
          : t('{0}시간 {1}분', Math.floor(sec / 3600), Math.floor(sec % 3600 / 60));
        $('#pvStage').textContent = t('절전 {0}', el);
        $('#pvGold').textContent = t('획득 골드 +{0}', num(Math.max(0, S.gold - pvGold0)));
      };
      tick(); pvTimer = setInterval(tick, 1000);
    }
  };
  $('#csChip')?.addEventListener('click', openPromotion);
  $('#csChip2')?.addEventListener('click', openPromotion);
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
    chatDetach();                 // 화면을 떠나면 구독을 끊는다
    $('#ov').classList.remove('show', 'over-alli');
    $('#ovinfo').classList.remove('show');
    $('#ovi').classList.remove('on');
  });
  $('#ovi').addEventListener('click', () => {
    if (ovInfoAction) return ovInfoAction();   // 화면이 ⓘ 를 팝업으로 쓰겠다고 했다
    $('#ovinfo').classList.toggle('show');
    $('#ovi').classList.toggle('on');
  });
  // 카드 바깥을 누르면 닫힌다
  // 바깥을 눌러 닫는 것도 강제 선택 화면에서는 막는다
  $('#ov').addEventListener('click', e => {
    if (e.target.id === 'ov' && !$('#ov').classList.contains('forced')) $('#ovx').click();
  });

  // 하단 채팅바 = 채팅 입구. 서버가 없으면 예전처럼 공지가 돈다
  $('#chat').addEventListener('click', () => openChat());
  const CHAT = [
    t('단장님, 오늘도 잘 부탁드립니다!'), t('수정 동굴이 열렸다는 소문이 있어요.'),
    t('보물 창고에서 열쇠를 모으는 게 빠릅니다.'), t('제작대를 올리면 소환이 편해집니다.'),
    t('보스는 시간 안에 못 잡으면 실패입니다.'),
  ];
  let chatI = 0;
  setInterval(() => {
    // 진짜 대화가 있으면 공지를 돌리지 않는다 — 남의 말이 6초마다 공지로
    // 덮이면 채팅이 있다는 것을 알아챌 수 없다
    if ((live.get('chatWorld') || []).length) return chatBarSync();
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

  // 클라우드 세이브 — Verse8 호스트 안에서만 산다. 클라우드가 로컬보다
  // 앞서 있으면 그쪽을 채택하고 재부팅한다 (반쯤 섞인 상태가 최악이라
  // 필드 단위 병합은 안 한다 — 세이브는 통짜가 원칙이다)
  try {
    const adopted = await initCloud(() => S);
    if (adopted) {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, lastSeenAt: Date.now(), s: adopted }));
      location.reload();
      return;
    }
  } catch (e) { console.warn('[cloud] 초기화 실패 — 로컬로 계속', e); }

  // ── 서버 연동 마무리 ──────────────────────────────────
  // 붙어 있으면 **로딩이 끝나기 전에 전부 끝낸다.** 화면을 열 때 받으면 유저가
  // 데모를 한 번 보고 진짜 값으로 갈리는 것을 본다 — 목록이 눈앞에서 바뀌면
  // 고장으로 읽힌다. 실패해도 게임은 그대로 돈다 (전부 데모로 떨어진다).
  if (live.initLive()) {
    bootStep(88, t('용병단 명부를 맞추는 중…'));
    try {
      // 프로필이 **먼저**다. 남이 나를 볼 수 있는 것은 이것뿐이고
      // (server.js > submitProfile), 이게 없으면 남의 아레나 상대·친구 목록에
      // 내가 아예 안 나온다. 예열이 이 값을 되읽으므로 순서가 중요하다
      await live.pushProfile(publicProfile());
    } catch (e) { console.warn('[live] 프로필 제출 실패', e); }
    try {
      await live.warmup(Math.round(totalCp()));
      syncAllyFromServer();
      chatBarSync();
    } catch (e) { console.warn('[live] 예열 실패 — 화면마다 다시 받는다', e); }
    bootStep(95);
  }

  // 배선이 전부 끝난 뒤에 전투를 시작한다. 이 await 이 부트의 마지막이다
  bootStep(100, t('출격 준비 완료!'));
  await bootTapToStart();
  await runStage();
})();
