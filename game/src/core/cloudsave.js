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
    try {
      const S = getState();
      server.remoteFunction('saveState', [{ v: SAVE_VERSION, s: S }, false],
        { needResponse: false });
    } catch { /* 떠나는 중 — 실패해도 다음 접속의 스로틀 업로드가 만회한다 */ }
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  try {
    const cloud = await server.remoteFunction('loadState', []);
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
    const res = await server.remoteFunction('saveState', [{ v: SAVE_VERSION, s: S }, false]);
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
