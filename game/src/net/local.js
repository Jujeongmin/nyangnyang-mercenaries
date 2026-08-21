// 로컬 백엔드 = 가짜 서버.
//
// 목적은 "동작하게 하는 것" 이 아니라 **실서버와 같은 제약을 강제하는 것** 이다.
// 여기서 통과하면 Verse8 remoteFunction 으로 그대로 옮길 수 있다.
//
//   · 시각은 서버(=여기)가 찍는다. 클라가 보낸 시각은 전부 무시한다
//   · 호출 10회/초 제한을 실제로 건다
//   · 일일·주간 리셋은 lazy — 호출 시점에 lastResetAt 과 비교한다
//   · 반환은 항상 { state, result }. state 는 갱신된 전체 세이브다
//
// 이 파일은 서버 코드다. 클라 코드가 여기 있는 함수를 직접 부르면 안 된다.

import { D } from '../core/data.js';
import { blankState } from '../core/store.js';

const KEY = 'nyang:save:v1';
const RATE_LIMIT = 10;          // 초당 호출 수 (Verse8 실측 제한)
const RESET_HOUR_KST = 5;       // save-schema.json > resetLogic

export function create(opts = {}) {
  // 서버 시각. 실서버로 옮기면 그냥 Date.now() 가 된다.
  // opts.clockSkew 로 테스트에서 시간을 앞당길 수 있다 — 클라는 못 건드린다.
  const now = () => Date.now() + (opts.clockSkew || 0);

  let S = null;
  const calls = [];

  function gate(op) {
    const t = now();
    while (calls.length && t - calls[0] > 1000) calls.shift();
    if (calls.length >= RATE_LIMIT) {
      throw new Error(`호출 제한 초과 (${RATE_LIMIT}/s) — op=${op}. 배치로 묶어라`);
    }
    calls.push(t);
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { console.warn('[local] 저장 실패', e); }
  }

  // 05:00 KST 기준 일자. 주간은 월요일 05:00.
  const dayIndex = t => Math.floor((t + 9 * 3600e3 - RESET_HOUR_KST * 3600e3) / 86400e3);
  const weekIndex = t => Math.floor((dayIndex(t) - 4) / 7);   // 1970-01-01 = 목요일

  function lazyReset() {
    const t = now();
    if (dayIndex(S.dailies.lastResetAt) < dayIndex(t)) {
      S.dailies.questProgress = {};
      S.dailies.adUsage = {};
      S.dailies.freeSummonUsed = false;
      S.dailies.lastResetAt = t;
      S.summonLevels.equipment.adSpeedupUsedToday = 0;
      S.arena.entriesUsedToday = 0;
      S.arena.adEntryUsedToday = 0;
      S.arena.refreshUsedToday = 0;
      for (const d of Object.values(S.dungeons)) {
        d.entriesUsedToday = 0; d.adEntryUsedToday = 0; d.goldRetryUsedToday = 0;
      }
    }
    if (weekIndex(S.weeklies.lastResetAt) < weekIndex(t)) {
      S.weeklies.questProgress = {};
      S.weeklies.lastResetAt = t;
    }
  }

  // 모든 op 의 공통 껍데기
  function op(name, fn) {
    return async args => {
      gate(name);
      lazyReset();
      const result = fn(args || {}) ?? null;
      S.lastSeenAt = now();
      persist();
      return { state: structuredClone(S), result };
    };
  }

  const notYet = name => op(name, () => {
    throw new Error(`${name} 미구현 — app/ARCHITECTURE.md 이관 순서 6단계`);
  });

  return {
    now,

    async load() {
      const raw = localStorage.getItem(KEY);
      S = raw ? JSON.parse(raw) : null;
      if (S && S.schemaVersion !== 1) {
        console.warn(`[local] schemaVersion ${S.schemaVersion} → 초기화`);
        S = null;
      }
      if (!S) {
        S = blankState(now());
        grantStarter(S);
      }
      lazyReset();
      persist();
      return { state: structuredClone(S), result: null };
    },

    reset: op('reset', () => {
      S = blankState(now());
      grantStarter(S);
    }),

    setSettings: op('setSettings', patch => {
      // 설정은 조작해도 밸런스에 영향이 없는 것만 받는다
      const allow = ['autoSummonEnabled', 'summonFilter', 'battleSpeed', 'skipBattle', 'sound'];
      for (const [k, v] of Object.entries(patch)) {
        if (allow.includes(k)) S.settings[k] = v;
      }
    }),

    // --- 장비 소환 레벨업 타이머 ---
    // startedAt 을 여기서 찍는 것이 이 파일의 존재 이유다.
    upgradeStart: op('upgradeStart', ({ targetLevel }) => {
      const eq = S.summonLevels.equipment;
      const cs = D.economy.equipmentSummonLevel.concurrentSlots;
      const maxSlots = S.purchases.premiumPassExpiresAt > now() ? cs.premium : cs.base;
      if (eq.upgradeSlots.length >= maxSlots) throw new Error('빈 강화 슬롯 없음');
      if (targetLevel !== eq.level + 1) throw new Error('한 단계씩만 올린다');
      const cost = upgradeCost(targetLevel);
      // 골드 분할 납부 — 마지막 회차를 넣어야 슬롯이 돈다
      const per = Math.ceil(cost.gold / cost.parts);
      const paid = eq.paidInstallments || 0;
      if (S.currency.gold < per) throw new Error('골드 부족');
      S.currency.gold -= per;
      eq.paidInstallments = paid + 1;
      if (eq.paidInstallments < cost.parts) return { paid: eq.paidInstallments, parts: cost.parts };
      eq.paidInstallments = 0;
      eq.upgradeSlots.push({ startedAt: now(), targetLevel });
      return { startedAt: now(), durationSec: cost.sec };
    }),

    upgradeClaim: op('upgradeClaim', ({ slotIndex }) => {
      const eq = S.summonLevels.equipment;
      const slot = eq.upgradeSlots[slotIndex];
      if (!slot) throw new Error('슬롯 없음');
      const { sec } = upgradeCost(slot.targetLevel);
      const elapsed = (now() - slot.startedAt) / 1000;
      // 남은 시간이 아니라 startedAt 으로 판정한다 — 클라 시계와 무관하다
      if (elapsed < sec) throw new Error(`아직 ${Math.ceil(sec - elapsed)}초 남음`);
      eq.upgradeSlots.splice(slotIndex, 1);
      eq.level = Math.max(eq.level, slot.targetLevel);
      return { level: eq.level };
    }),

    // --- 미구현 (이관 순서 6단계) ---
    summon: notYet('summon'),
    summonBatch: notYet('summonBatch'),
    autoEnhance: notYet('autoEnhance'),
    applyAutoEquip: notYet('applyAutoEquip'),
    equipGear: notYet('equipGear'),
    enhanceGear: notYet('enhanceGear'),
    upgradeSpeedup: notYet('upgradeSpeedup'),
    stageAttempt: notYet('stageAttempt'),
    claimIdle: notYet('claimIdle'),
    claimQuest: notYet('claimQuest'),
    claimAttendance: notYet('claimAttendance'),
    watchAd: notYet('watchAd'),
    submitCp: op('submitCp', () => null),
  };
}

// economy.json > equipmentSummonLevel.
// timeMinutes / goldCost 는 배열이고 index 0 = Lv1→2 다. (arrayNote)
function upgradeCost(targetLevel) {
  const t = D.economy.equipmentSummonLevel;
  const i = targetLevel - 2;
  if (i < 0 || i >= t.goldCost.length) throw new Error(`Lv${targetLevel} 곡선 범위 밖 (max ${t.maxLevel})`);
  return { gold: t.goldCost[i], parts: t.installments[i], sec: t.timeMinutes[i] * 60 };
}

// 신규 계정 지급분. tutorial.json > grants 는 산문이라 수치를 못 읽는다 —
// 여기 값은 임시다. 튜토리얼 구현(이관 7단계) 때 quests.json / gacha.json
// onboardingGuarantees 기준으로 교체한다.
function grantStarter(S) {
  S.currency.diamond = 300;
  S.currency.gold = 1000;
  S.currency.equipTicket = 10;
  S.currency.gold = D.economy.equipmentSummonLevel.goldCost[0];      // Lv1→2 총액
  S.tutorial.currentPhase = D.tutorial?.phases?.[0]?.id ?? null;
}
