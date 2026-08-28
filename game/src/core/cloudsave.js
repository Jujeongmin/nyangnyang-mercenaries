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
const UPLOAD_INTERVAL = 30_000;

let server = null;          // Verse8 server 객체 (remoteFunction 보유)
let lastUpload = 0;
let pending = false;
let getState = null;        // () => S — 통합부가 준다
let wiping = false;         // 초기화 중 — flush·업로드가 지운 것을 되살리면 안 된다

// **세대(epoch).** 초기화할 때마다 서버가 1 올린다. 이 기기가 마지막으로 본
// 세대를 로컬에 남겨 두고, 부팅 때 서버 세대와 비교한다. 뒤처져 있으면 이
// 기기의 로컬 세이브는 이미 남이 지운 것이라 버려야 한다 — 안 그러면 이
// 기기가 30초 업로드로 그것을 도로 살려낸다 (단장 재현 2026-08-28:
// PC 초기화 -> 폰이 그대로 -> PC 재접속하면 옛 캐릭터가 돌아옴)
const EPOCH_KEY = 'nyang:cloud:epoch';
let epoch = 0;
let wipedElsewhere = false;

const readEpoch = () => {
  try { return Math.max(0, +(localStorage.getItem(EPOCH_KEY) || 0) || 0); }
  catch { return 0; }
};
const writeEpoch = n => {
  epoch = n;
  try { localStorage.setItem(EPOCH_KEY, String(n)); } catch { /* 시크릿 모드 */ }
};

/** 다른 기기에서 초기화됐나 — initCloud 직후에 본다. 참이면 로컬을 버려야 한다 */
export const cloudWiped = () => wipedElsewhere;

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
    if (document.visibilityState === 'hidden') flush();
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
      wipedElsewhere = true;
      wiping = true;            // 이 세션의 flush·업로드를 막는다
      return null;
    }
    writeEpoch(serverEpoch);

    if (!cloud) return null;                       // 신규 계정 — 로컬이 곧 진실
    if (cloud.v !== SAVE_VERSION) return null;     // 다른 버전 — 마이그레이션 전까지 무시
    const local = getState();
    const cs = progressScore(cloud.s), ls = progressScore(local);
    if (cs > ls) return cloud.s;                   // 클라우드가 앞선다 — 채택
    if (ls > cs) upload(true);                     // 로컬이 앞선다 — 즉시 올린다
    return null;
  } catch (e) {
    console.warn('[cloud] load 실패 — 로컬로 계속', e);
    return null;
  }
}

/**
 * 저장 훅. main 의 save() 가 부른다. 스로틀 — 마지막 업로드에서 30초 안이면
 * 예약만 걸고, 창이 닫혀도 pagehide flush 가 있어 유실 창은 짧다.
 */
export function cloudSave(immediate = false) {
  if (!server) return;
  const now = Date.now();
  if (!immediate && now - lastUpload < UPLOAD_INTERVAL) {
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
  try {
    const S = getState();
    const res = await server.remoteFunction('saveState', [{ v: SAVE_VERSION, s: S, epoch }, false]);
    if (res && res.ok === false && res.reason === 'wiped') {
      // 이 기기가 도는 사이에 다른 기기가 초기화했다. 더 올리지 않고 로컬을
      // 버린 뒤 새로 뜬다 — 안 그러면 계속 옛 세이브를 밀어 넣는다
      writeEpoch(res.epoch | 0);
      wiping = true;
      try { localStorage.removeItem('nyang:proto:v1'); } catch {}
      location.reload();
      return;
    }
    if (res && res.ok === false && res.reason === 'regression') {
      // 서버본이 훨씬 앞서 있다 — 이 기기가 낡았다. 서버본을 받아 로컬을 갱신한다.
      // (기기 교체 직후의 빈 로컬이 여기로 들어온다)
      const cloud = await server.remoteFunction('loadState', []);
      if (cloud?.s && typeof window !== 'undefined') {
        localStorage.setItem('nyang:proto:v1',
          JSON.stringify({ v: 1, lastSeenAt: Date.now(), s: cloud.s }));
        location.reload();                          // 채택은 재부팅으로 — 반쯤 섞인 상태가 최악이다
      }
    }
  } catch (e) {
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
