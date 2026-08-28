import { findServer } from '../net/live.js';

// 클라우드 세이브 어댑터 — Verse8 게임서버(루트 server.js)와 짝이다.
//
// 원칙 (신중하게 가는 지점들):
//   · **서버 객체는 주입받는다.** Verse8 의 비-React 접속법이 문서화돼 있지 않아
//     시그니처를 추측하지 않는다 — 호스트 환경이 window.__V8_SERVER 로 주거나,
//     통합 코드가 initCloud(server) 로 꽂는다. 없으면 이 모듈은 조용히 잔다.
//     (로컬 dev·직접 배포에서는 localStorage 만 도는 게 정상이다)
//   · **업로드는 스로틀한다.** remoteFunction 은 초당 약 10회 제한이고 세이브는
//     저장할 때마다 부를 이유가 없다 — 30초에 한 번 + 떠날 때(flush) 한 번.
//   · **충돌은 진행도 점수로 푼다.** progressScore 는 server/server.js 와 같은
//     식이다. 한쪽만 바꾸면 클라와 서버의 판정이 갈린다.
//   · **후퇴 덮어쓰기는 서버가 거부한다** (regression 가드). 클라는 그 응답을
//     받으면 서버본을 내려받아 로컬을 갱신한다 — 유저에게 물어보는 UI 는
//     충돌이 실제로 관측되면 붙인다. 지금은 "더 앞선 쪽이 이긴다"가 규칙이다.

const SAVE_VERSION = 1;
// 30초였다. **30초를 못 채우고 창을 닫으면 그 세션의 진행이 통째로 사라졌다** —
// 주기 업로드가 한 번도 안 돌고, 닫을 때의 마지막 밀어넣기는 needResponse:false 라
// 소켓이 먼저 닫히면 그냥 없어진다. 그래서 짧게 놀다 끈 PC 의 진행이 폰에 안 왔다
// (단장 재현 2026-08-28). remoteFunction 예산은 초당 10회라 10초에 한 번은 싸다.
const UPLOAD_INTERVAL = 10_000;

// 진행이 실제로 늘었으면 스로틀을 안 기다린다. progressScore 는 스테이지·제작대·
// 훈련소·소환·퀘스트를 담고 있어 "지금 저장 안 되면 아까운 것" 과 거의 겹친다.
// 다만 이것도 하한은 둔다 — 소환 10연이 한 프레임에 여러 번 올리면 예산이 샌다.
const MILESTONE_MIN_GAP = 3_000;

let server = null;          // Verse8 server 객체 (remoteFunction 보유)
let lastUpload = 0;
let lastScore = null;       // 마지막으로 올린 진행도. null 이면 아직 안 올렸다
let pending = false;
let getState = null;        // () => S — 통합부가 준다
let wiping = false;         // 초기화 중 — flush·업로드가 지운 것을 되살리면 안 된다

// **세대(epoch).** 초기화할 때마다 서버가 1 올린다. 이 기기가 마지막으로 본
// 세대를 로컬에 남겨 두고, 부팅 때 서버 세대와 비교한다. 뒤처져 있으면 이
// 기기의 로컬 세이브는 이미 남이 지운 것이라 버려야 한다 — 안 그러면 이
// 기기가 30초 업로드로 그것을 도로 살려낸다 (단장 재현 2026-08-28:
// PC 초기화 -> 폰이 그대로 -> PC 재접속하면 옛 캐릭터가 돌아옴)
const EPOCH_KEY = 'nyang:cloud:epoch';
const LOCAL_SAVE_KEY = 'nyang:proto:v1';   // main.js 의 SAVE_KEY 와 같아야 한다
let wipedElsewhere = false;

const readEpoch = () => {
  try { return Math.max(0, +(localStorage.getItem(EPOCH_KEY) || 0) || 0); }
  catch { return 0; }
};
const writeEpoch = n => {
  epoch = n;
  try { localStorage.setItem(EPOCH_KEY, String(n)); } catch { /* 시크릿 모드 */ }
};

/** 이 기기에 버릴 로컬 세이브가 실제로 있나 */
const hasLocalSave = () => {
  try { return !!localStorage.getItem(LOCAL_SAVE_KEY); } catch { return false; }
};

// **마지막으로 서버와 맞춘 시각(서버 시계).** 기기 간 최신본을 가리는 기준이다.
//
// 예전에는 progressScore 만 비교했는데, 그 식에는 장비·골드·명부가 안 들어간다.
// PC 에서 장비만 맞추고 폰을 켜면 점수가 그대로라 "클라우드가 앞서지 않는다"로
// 보고 무시했다 — PC 진행이 폰에 영영 안 왔다 (단장 지적 2026-08-28).
// 서버는 저장할 때마다 savedAt 을 남기므로, 그게 이 기기의 마지막 동기화보다
// 뒤면 다른 기기가 그 뒤에 진행한 것이다.
const SYNC_KEY = 'nyang:cloud:syncedAt';
const readSync = () => {
  try { return Math.max(0, +(localStorage.getItem(SYNC_KEY) || 0) || 0); } catch { return 0; }
};
const writeSync = n => {
  if (!n) return;
  try { localStorage.setItem(SYNC_KEY, String(n)); } catch { /* 시크릿 모드 */ }
};

// 초기값은 **로컬 기록**이다. 0 으로 두면 loadState 가 실패해 세대를 못 읽었을 때
// 0 을 보내 거부당하고, 그 처리가 reload 라서 재부팅 루프가 된다
let epoch = readEpoch();

/** 다른 기기에서 초기화됐나 — initCloud 직후에 본다. 참이면 로컬을 버려야 한다 */
export const cloudWiped = () => wipedElsewhere;

/** 이 기기가 아는 세대 — 설정의 접속 진단이 보여 준다 */
export const cloudEpoch = () => epoch;

/** 마지막으로 서버와 맞춘 시각(서버 시계). 0 이면 아직 한 번도 못 맞췄다 */
export const cloudSyncedAt = () => readSync();

// **마지막 업로드의 결과를 남긴다.** upload() 가 거부 응답을 조용히 삼키고
// 있어서, 저장이 서버에 안 닿아도 화면에 아무 표시가 없었다 — "PC 진행이 폰에
// 안 온다" 를 여기서 못 갈랐다 (단장 재현 2026-08-28)
let lastUp = { at: 0, ok: null, reason: null, note: null };
export const cloudLastUpload = () => lastUp;

/**
 * 지금 당장 한 번 올리고 **서버 응답을 그대로 돌려준다.** 진단 화면의
 * [지금 서버에 올리기] 가 쓴다. 스로틀도 무시한다 — 손으로 누른 것이다.
 */
export async function forceUpload() {
  if (!server) return { ok: false, reason: 'no_server' };
  try {
    const res = await server.remoteFunction('saveState',
      [{ v: SAVE_VERSION, s: getState(), epoch }, false]);
    lastUp = { at: Date.now(), ok: !!(res && res.ok), reason: (res && res.reason) || null, note: 'manual' };
    if (res && res.ok && res.savedAt) writeSync(res.savedAt);
    return res;
  } catch (e) {
    lastUp = { at: Date.now(), ok: false, reason: String(e && e.message || e), note: 'manual' };
    return { ok: false, reason: lastUp.reason };
  }
}

/** server/server.js 의 progressScore 와 반드시 같은 식 */
export function progressScore(s) {
  if (!s || typeof s !== 'object') return 0;
  const sumExp = (s.summonExp?.mercenary || 0) + (s.summonExp?.skill || 0);
  return (s.maxStage || 0) * 1000
    + (s.forgeLv || 0) * 200
    + (s.trainLv || 0) * 50
    + sumExp
    + (s.quest || 0) * 100;
}

export const cloudReady = () => !!server;

/**
 * 부트 통합. stateGetter 는 현재 S 를 돌려주는 함수.
 * 반환: 클라우드 세이브가 로컬보다 앞서 있으면 그 s 를 (채택하라고) 돌려준다.
 */
export async function initCloud(stateGetter, injected) {
  getState = stateGetter;
  // 찾는 방법은 net/live.js 가 정한다 — 두 곳이 다른 이름을 보면 한쪽만
  // 붙는 어긋남이 난다 (세이브는 되는데 채팅은 안 되는 식)
  server = injected || findServer();
  if (!server || typeof server.remoteFunction !== 'function') { server = null; return null; }

  // 떠날 때 마지막 상태를 흘려 보낸다 — 응답을 기다릴 수 없는 시점이라
  // fire-and-forget(needResponse:false)이다. 문서의 두 번째 호출 패턴.
  const flush = () => {
    if (wiping) return;     // 초기화 직후의 reload 가 옛 상태를 도로 올린다
    try {
      const S = getState();
      server.remoteFunction('saveState', [{ v: SAVE_VERSION, s: S, epoch }, false],
        { needResponse: false });
    } catch { /* 떠나는 중 — 실패해도 다음 접속의 스로틀 업로드가 만회한다 */ }
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    // **숨을 때는 응답을 받는 업로드를 쓴다.** flush 는 fire-and-forget 이라
    // 서버가 남긴 savedAt 을 못 받고, 그러면 이 기기의 동기화 시각이 뒤처져
    // 다음 부팅에 자기가 올린 세이브를 "남의 최신본"으로 보고 채택한다
    // (재부팅이 한 번 더 돈다). 폰은 홈으로 나가는 게 이 경로다.
    // pagehide 는 응답을 기다릴 수 없는 시점이라 그대로 flush 다.
    if (document.visibilityState === 'hidden') { if (!wiping) upload(true); }
  });

  try {
    const res = await server.remoteFunction('loadState', []);
    // 서버는 { save, epoch } 로 준다 (SERVER_REV 16~). 낡은 서버는 세이브를
    // 그대로 주므로 그 모양도 받아 준다 — 배포 순서가 어긋나도 안 죽는다
    const wrapped = res && typeof res === 'object' && 'epoch' in res;
    const cloud = wrapped ? res.save : res;
    const serverEpoch = wrapped ? (res.epoch | 0) : 0;
    const localEpoch = readEpoch();

    if (serverEpoch > localEpoch) {
      // 다른 기기가 초기화했다. 이 기기의 로컬은 죽은 세대다 — 올리지 말고 버린다.
      // 세대를 먼저 기록해야 재부팅 뒤에 같은 판정이 또 나지 않는다
      writeEpoch(serverEpoch);
      wiping = true;            // 이 세션의 flush·업로드를 막는다
      // **버릴 로컬이 있을 때만 재부팅을 요청한다.**
      // 스토리지가 막힌 환경(시크릿 모드 등)에서는 세대 기록도 로컬 세이브도
      // 남지 않아, 매 부팅 이 가지로 들어와 무한 reload 가 된다. 지울 것이
      // 없으면 이 기기는 어차피 빈 채로 시작하므로 그냥 진행하면 된다
      wipedElsewhere = hasLocalSave();
      return null;
    }
    writeEpoch(serverEpoch);

    if (!cloud) return null;                       // 신규 계정 — 로컬이 곧 진실
    if (cloud.v !== SAVE_VERSION) return null;     // 다른 버전 — 마이그레이션 전까지 무시
    const local = getState();
    const cs = progressScore(cloud.s), ls = progressScore(local);
    const stamp = +cloud.savedAt || 0;
    const mySync = readSync();

    // **최신본이 이긴다.** 서버본이 이 기기의 마지막 동기화보다 뒤에 저장됐다면
    // 다른 기기가 그 뒤에 진행한 것이다. progressScore 만 보면 장비·골드·명부가
    // 식에 없어서 "PC 에서 장비만 맞춘 것"이 폰에 영영 안 온다 (위 SYNC_KEY 주석).
    //
    // 다만 진행도가 크게 뒷걸음질하는 서버본은 채택하지 않는다 — 서버의
    // regression 가드와 같은 0.6 문턱이다. 한 번도 안 맞춘 기기(mySync 0)가
    // 오프라인으로 쌓은 진행을 통째로 날리는 것을 막는다.
    if (stamp && stamp > mySync && cs >= ls * 0.6) {
      writeSync(stamp);
      // 내용이 같으면 채택할 것이 없다. 여기서 안 걸러 내면 자기가 올린 세이브를
      // 도로 채택하며 재부팅한다 (flush 는 응답을 안 받아 동기화 시각이 뒤처진다)
      if (JSON.stringify(cloud.s) === JSON.stringify(local)) return null;
      return cloud.s;
    }
    if (cs > ls) { writeSync(stamp); return cloud.s; }   // 클라우드가 앞선다 — 채택
    if (ls > cs) upload(true);                           // 로컬이 앞선다 — 즉시 올린다
    return null;
  } catch (e) {
    console.warn('[cloud] load 실패 — 로컬로 계속', e);
    return null;
  }
}

/**
 * 저장 훅. main 의 save() 가 부른다.
 *
 * 세 갈래다:
 *   1. 손으로 시킨 것(immediate) — 바로 올린다
 *   2. **진행이 늘었다** — 스로틀을 안 기다리고 바로 올린다 (하한 3초).
 *      스테이지를 깨고 30초 안에 창을 닫으면 그 진행이 사라지던 구멍이 여기다.
 *   3. 그 밖 — 10초 스로틀. 예약 타이머로 마지막 상태 하나가 올라간다
 */
export function cloudSave(immediate = false) {
  if (!server) return;
  const now = Date.now();

  // 진행도가 늘었나 — getState 가 없을 리 없지만 부팅 경합에서 방어한다
  let bumped = false;
  try {
    const sc = progressScore(getState());
    bumped = lastScore != null && sc > lastScore && now - lastUpload >= MILESTONE_MIN_GAP;
  } catch { bumped = false; }

  if (!immediate && !bumped && now - lastUpload < UPLOAD_INTERVAL) {
    if (!pending) {
      pending = true;
      setTimeout(() => { pending = false; upload(); },
        UPLOAD_INTERVAL - (now - lastUpload) + 50);
    }
    return;
  }
  upload(immediate);
}

async function upload(force = false) {
  if (!server) return;
  lastUpload = Date.now();
  try { lastScore = progressScore(getState()); } catch { /* 부팅 경합 */ }
  try {
    const S = getState();
    const res = await server.remoteFunction('saveState', [{ v: SAVE_VERSION, s: S, epoch }, false]);
    lastUp = { at: Date.now(), ok: !!(res && res.ok), reason: (res && res.reason) || null, note: 'auto' };
    // 거부는 조용히 넘기지 않는다. 아래 두 분기(wiped·regression)가 아닌
    // 이유로 거부되면 지금까지 아무 데도 안 남아 저장이 멈춘 줄을 몰랐다
    if (res && res.ok === false) console.warn('[cloud] 저장 거부됨:', res.reason, res);
    // 서버가 남긴 시각을 그대로 받아 둔다 — 다음 부팅에 "내가 올린 것"과
    // "남이 올린 것"을 가르는 기준이다 (SYNC_KEY 주석)
    if (res && res.ok && res.savedAt) writeSync(res.savedAt);
    if (res && res.ok === false && res.reason === 'wiped') {
      // 이 기기가 도는 사이에 다른 기기가 초기화했다. 더 올리지 않고 로컬을
      // 버린 뒤 새로 뜬다 — 안 그러면 계속 옛 세이브를 밀어 넣는다.
      // 지울 로컬이 없으면 재부팅해도 같은 자리라, 업로드만 멈춘다 (위 주석)
      writeEpoch(res.epoch | 0);
      wiping = true;
      if (!hasLocalSave()) return;
      try { localStorage.removeItem(LOCAL_SAVE_KEY); } catch { return; }
      location.reload();
      return;
    }
    if (res && res.ok === false && res.reason === 'regression') {
      // 서버본이 훨씬 앞서 있다 — 이 기기가 낡았다. 서버본을 받아 로컬을 갱신한다.
      // (기기 교체 직후의 빈 로컬이 여기로 들어온다)
      const cloud = await server.remoteFunction('loadState', []);
      if (cloud?.s && typeof window !== 'undefined') {
        localStorage.setItem(LOCAL_SAVE_KEY,
          JSON.stringify({ v: 1, lastSeenAt: Date.now(), s: cloud.s }));
        location.reload();                          // 채택은 재부팅으로 — 반쯤 섞인 상태가 최악이다
      }
    }
  } catch (e) {
    lastUp = { at: Date.now(), ok: false, reason: String(e && e.message || e), note: 'auto' };
    console.warn('[cloud] save 실패 — 다음 주기에 재시도', e);
  }
}

/**
 * 클라우드 세이브 삭제. resetSave 가 reload 직전에 부른다 — 응답을 기다려야
 * 한다. 서버 밖(로컬)이면 지울 것이 없으니 그냥 통과.
 */
export async function wipeCloud() {
  wiping = true;
  // 서버에 안 붙어 있으면 **성공이라고 하지 않는다.** true 를 돌려주던 탓에
  // 로컬만 지우고 "초기화됐다" 로 끝났고, 다음 접속에서 클라우드가 도로
  // 살려 놓아 초기화가 안 먹은 것처럼 보였다 (단장 지적 2026-08-28)
  if (!server) return false;
  try {
    const res = await server.remoteFunction('wipeState', []);
    // 새 세대를 이 기기에 기록해 둔다. 안 그러면 재부팅 때 자기가 올린 초기화를
    // "남이 했다" 로 읽고 한 번 더 로컬을 지우려 든다 (결과는 같지만 소란스럽다)
    if (res && res.epoch != null) writeEpoch(res.epoch | 0);
    return true;
  } catch (e) { console.warn('[cloud] wipe 실패', e); return false; }
}
