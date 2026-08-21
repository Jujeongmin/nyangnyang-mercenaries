// 서버 경계. 상태를 바꾸는 모든 호출은 여기를 통과한다.
//
// Verse8 은 클라이언트 쓰기를 허용하지 않는다 — $global.updateMyState 는 서버 함수 안에서만
// 부른다. (data/README.md > 서버 권한)  그래서 이 인터페이스는 **로컬 구현도 똑같은 제약을
// 지킨다.** 로컬에서 통과하면 실서버에서도 통과한다.
//
// 규칙 셋:
//   1. 반환값은 항상 { state, result } — state 는 갱신된 전체 세이브다
//   2. 시각은 클라가 안 보낸다. 서버가 찍는다
//   3. 호출은 초당 10회 제한. 배치로 묶어라

import * as store from '../core/store.js';
import { emit, EV } from '../core/bus.js';

let impl = null;

export async function init(kind = 'local', opts = {}) {
  impl = kind === 'verse8'
    ? await import('./verse8.js').then(m => m.create(opts))
    : await import('./local.js').then(m => m.create(opts));
  const { state } = await impl.load();
  store.apply(state);
  return impl;
}

// 모든 호출의 공통 경로 — 응답을 store 에 반영하고 이벤트를 쏜다
async function call(name, args, events = []) {
  if (!impl) throw new Error('backend.init() 을 먼저 불러라');
  try {
    const res = await impl[name](args);
    if (res?.state) store.apply(res.state, events);
    return res?.result ?? res;
  } catch (err) {
    emit(EV.ERROR, { op: name, err });
    throw err;
  }
}

// --- 소환 ---
// 확률 판정은 서버가 한다. 클라는 결과만 받는다. (게임산업법 확률 공시 대상)
export const summon = (track, count) =>
  call('summon', { track, count }, [EV.ROSTER, EV.CURRENCY, EV.CP]);

// 자동 소환 배치. Lv60 에서 배치당 700개 — 1초 1회 호출로 N개 결과를 받는다
export const summonBatch = track =>
  call('summonBatch', { track }, [EV.INVENTORY, EV.CURRENCY]);

// --- 강화 / 장착 ---
// 중복 수백 개를 단일 호출로 서버가 일괄 계산한다 (호출 제한 대응)
export const autoEnhance = track =>
  call('autoEnhance', { track }, [EV.ROSTER, EV.CP]);

export const applyAutoEquip = kind =>
  call('applyAutoEquip', { kind }, [EV.EQUIP, EV.CP]);

export const equipGear = (slot, invIndex) =>
  call('equipGear', { slot, invIndex }, [EV.EQUIP, EV.INVENTORY, EV.CP]);

export const enhanceGear = slot =>
  call('enhanceGear', { slot }, [EV.EQUIP, EV.CURRENCY, EV.CP]);

// --- 장비 소환 레벨업 타이머 ---
// startedAt 은 서버 시각이다. 클라가 보내면 시계 조작으로 즉시 완료가 된다.
export const upgradeStart = targetLevel =>
  call('upgradeStart', { targetLevel }, [EV.FORGE, EV.CURRENCY]);

export const upgradeClaim = slotIndex =>
  call('upgradeClaim', { slotIndex }, [EV.FORGE, EV.CP]);

export const upgradeSpeedup = (slotIndex, itemId) =>
  call('upgradeSpeedup', { slotIndex, itemId }, [EV.FORGE, EV.CURRENCY]);

// --- 진행 ---
// CP 3구간 판정. 110% 이상이면 서버가 자동승리로 처리하고 전투 로그를 안 만든다.
export const stageAttempt = stage =>
  call('stageAttempt', { stage }, [EV.STAGE]);

export const claimIdle = () =>
  call('claimIdle', {}, [EV.CURRENCY, EV.STAGE]);

// --- 일일 ---
export const claimQuest = questId => call('claimQuest', { questId }, [EV.CURRENCY]);
export const claimAttendance = () => call('claimAttendance', {}, [EV.CURRENCY]);
export const watchAd = slotId => call('watchAd', { slotId }, [EV.CURRENCY]);

// --- 설정 ---
export const setSettings = patch => call('setSettings', patch, []);

// --- CP 제출 (랭킹) ---
// debounce 60초 + 최소 변화율 0.5% + 일 30회. 여기서 막는다.
let lastCpSent = 0, lastCpAt = 0, cpSentToday = 0;
export async function submitCp(cp) {
  const now = Date.now();
  if (cpSentToday >= 30) return false;
  if (now - lastCpAt < 60_000) return false;
  if (lastCpSent && Math.abs(cp - lastCpSent) / lastCpSent < 0.005) return false;
  lastCpAt = now; lastCpSent = cp; cpSentToday++;
  await call('submitCp', { cp }, []);
  return true;
}

export const serverNow = () => impl?.now() ?? Date.now();
