// 클라이언트 상태. save-schema.json 구조를 그대로 따른다.
//
// **클라는 이걸 직접 못 고친다.** 쓰기는 전부 net/backend.js 를 통과하고,
// 그 응답만 apply() 로 반영한다. (save-schema.json > meta.authority: server_write_only)
//
// 파생값(CP·스탯)은 저장하지 않는다. game/cp.js 가 매번 계산한다.

import { emit, EV } from './bus.js';

let S = null;
let frozen = true;

export const state = () => S;

// 신규 계정 초기값. 서버가 진짜 소스지만 로컬 백엔드가 이걸 쓴다.
export function blankState(now) {
  return {
    schemaVersion: 1,
    account: 'local',
    createdAt: now,
    lastSeenAt: now,
    profile: {
      nickname: '단장', nicknameChangedAt: null, titleId: null, frameId: null,
      featuredMercId: null, ownedTitles: [], ownedFrames: [],
    },
    currency: {
      diamond: 0, gold: 0,
      mercTicket: 0, skillTicket: 0, equipTicket: 0,
      hourglass: 0,                        // 5분 단축. 가속권 3종이 여기로 통합됐다
      arenaMedal: 0,                       // 아레나 전용. 혼은 폐기했다
    },
    mercenaries: {}, mercenariesPendingEnhance: {},
    skills: {}, skillsPendingEnhance: {},
    equipped: {
      mercenary: [], mercenaryLocked: [],
      skillActive: [], skillPassive: [], equipment: {},
    },
    equipmentInventory: [],
    summonLevels: {
      mercenary: { level: 1, exp: 0 },
      skill: { level: 1, exp: 0 },
      equipment: { level: 1, exp: 0, upgradeSlots: [], adSpeedupUsedToday: 0 },
    },
    progress: { maxStage: 1, currentStage: 1, questNumber: 1, questProgress: 0, trainingCampLevel: 0 },
    codex: { mercenary: [], skill: {} },
    dungeons: {},
    arena: {
      score: 0, tier: 'bronze', seasonId: 1, entriesUsedToday: 0,
      adEntryUsedToday: 0, refreshUsedToday: 0, defenseSnapshot: null, lastSeasonClaimed: null,
    },
    dailies: {
      lastResetAt: now, questProgress: {}, questPointsClaimed: [],
      attendanceDays: 0, attendanceCycleDay: 0, monthlyAttendanceClaimed: [],
      adUsage: {}, freeSummonUsed: false, newbie7DayClaimed: [],
    },
    weeklies: { lastResetAt: now, questProgress: {}, questPointsClaimed: [] },
    freePulls: { claimedMilestones: [], totalGranted: 0 },
    settings: {
      autoSummonEnabled: false,
      summonFilter: { minTier: 1, minCpContribution: 0, slots: [] },
      battleSpeed: 1, skipBattle: false, sound: { bgm: 0.7, sfx: 0.9 },
    },
    purchases: { firstBuyUsed: false, premiumPassExpiresAt: null, totalSpentVx: 0 },
    mailbox: [],
    tutorial: { currentPhase: null, completedAt: null, skipped: false, shownHints: [] },
  };
}

// 서버 응답을 통째로 반영한다. 부분 병합이 아니라 교체다 —
// 부분 병합은 클라와 서버가 서로 다른 상태를 믿게 만든다.
export function apply(next, changed = []) {
  S = next;
  emit(EV.STATE, S);
  for (const c of changed) emit(c);
}

// 연출용 낙관적 갱신. 서버 응답이 오면 apply() 가 통째로 덮는다.
// 잔액 표시가 0.3초 늦게 줄어드는 것보다 낫다.
export function optimistic(fn) {
  if (!S) return;
  frozen = false;
  try { fn(S); } finally { frozen = true; }
  emit(EV.CURRENCY);
}

// 개발 중 실수로 클라가 상태를 고치는 걸 잡는다
export function guard() {
  if (frozen) {
    throw new Error('클라는 상태를 직접 못 고친다. net/backend.js 를 거쳐라.');
  }
}

// --- 조회 ---
export const cur = k => S?.currency[k] ?? 0;
export const mercLevel = id => S?.mercenaries[id];
export const ownedMercs = () => Object.keys(S?.mercenaries ?? {});
export const ownedSkills = () => Object.keys(S?.skills ?? {});
export const party = () => S?.equipped.mercenary ?? [];
export const gearOf = slot => S?.equipped.equipment[slot] ?? null;
export const summonLevel = track => S?.summonLevels[track]?.level ?? 1;
export const stage = () => S?.progress.currentStage ?? 1;
export const maxStage = () => S?.progress.maxStage ?? 1;
export const codexCount = () => S?.codex.mercenary.length ?? 0;
