// 이벤트 버스. 상태가 바뀌면 여기로 알리고, 뷰가 구독한다.
// 뷰끼리 직접 부르지 않게 하는 게 목적이다.

const subs = new Map();

export function on(evt, fn) {
  if (!subs.has(evt)) subs.set(evt, new Set());
  subs.get(evt).add(fn);
  return () => off(evt, fn);
}

export function once(evt, fn) {
  const un = on(evt, (...a) => { un(); fn(...a); });
  return un;
}

export function off(evt, fn) {
  subs.get(evt)?.delete(fn);
}

export function emit(evt, payload) {
  const s = subs.get(evt);
  if (s) for (const fn of [...s]) {
    try { fn(payload); } catch (err) { console.error(`[bus] ${evt}`, err); }
  }
  const all = subs.get('*');
  if (all) for (const fn of [...all]) {
    try { fn(evt, payload); } catch (err) { console.error('[bus] *', err); }
  }
}

// 같은 프레임에 여러 번 emit 돼도 뷰는 한 번만 그린다
const pending = new Set();
let scheduled = false;
export function emitCoalesced(evt, payload) {
  pending.add(evt);
  if (payload !== undefined) coalescedPayload.set(evt, payload);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const list = [...pending];
    pending.clear();
    for (const e of list) {
      const p = coalescedPayload.get(e);
      coalescedPayload.delete(e);
      emit(e, p);
    }
  });
}
const coalescedPayload = new Map();

// 알려진 이벤트 이름. 오타로 조용히 죽는 걸 막는다.
export const EV = {
  STATE: 'state',            // store 전체 교체
  CURRENCY: 'currency',
  CP: 'cp',
  ROSTER: 'roster',          // 용병·스킬 보유 변동
  EQUIP: 'equip',
  INVENTORY: 'inventory',
  SUMMON_RESULT: 'summon:result',
  FORGE: 'forge',            // 장비 소환 레벨 타이머
  STAGE: 'stage',
  BATTLE_LOG: 'battle:log',  // 전투 계산 완료 → 재생 시작
  BATTLE_END: 'battle:end',
  BADGE: 'badge',
  TOAST: 'toast',
  ERROR: 'error',
};
