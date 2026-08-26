// Verse8 게임서버 접속 — **remoteFunction 을 만드는 유일한 곳.**
//
// net/live.js 와 core/cloudsave.js 는 오랫동안 findServer() 로 전역을 뒤져
// remoteFunction 을 가진 객체를 찾고 있었다. 그런데 그걸 **만드는 코드가
// 어디에도 없었다** — 호스트가 넣어 주기를 기다렸지만 호스트는 넣지 않는다.
// 그래서 배포본에서 채팅·랭킹·연합·클라우드 세이브가 전부 데모로 돌았다
// (단장 지적 2026-08-26). 여기서 직접 붙인다.
//
// ── 왜 이런 임포트인가 ────────────────────────────────────
// 공식 문서에 나온 접속법은 React 훅(useV8Server)뿐이다. 그런데 그 훅이 쓰는
// RemoteServer 는 **React 를 안 쓰는 순수 클래스**다. 훅은 그 위의 얇은 껍질이라,
// 클래스를 직접 쓰면 vanilla 에서도 같은 접속이 된다.
//   · @verse8/react-client 는 exports 맵이 없어 깊은 경로 임포트가 통한다
//   · 대신 **공개 API 가 아니다.** SDK 를 올릴 때 이 파일이 먼저 깨진다 —
//     그래서 SDK 접촉면을 이 파일 하나로 묶는다 (net/ads.js·net/vxshop.js 와 같은 규칙)
//
// ── SDK 의 두 가지 함정 (여기서 막는다) ──────────────────────
//   1. callRemoteFunctionSocket 은 **타임아웃도 reject 도 없다.** 서버가 응답을
//      안 주면 프라미스가 영원히 매달린다. 부팅이 live.warmup() 을 await 하므로
//      그대로 두면 **부팅 화면에서 게임이 멈춘다.**
//   2. 매 호출이 'fn:return' 리스너를 달고, 자기 callId 가 올 때만 뗀다.
//      응답이 안 오면 리스너가 영원히 쌓인다.
// 그래서 호출을 직접 만든다. socket 과 on() 은 공개 멤버라 이건 안전하다.
import { Verse8 } from '@verse8/platform/vanilla';
import { RemoteServer } from '@verse8/react-client/dist/utils/RemoteServer.js';

// 부팅이 이 접속을 **기다린다** (클라우드 세이브가 로컬보다 앞선지 먼저 알아야
// 화면을 열 수 있다). 그래서 상한이 곧 최악의 부팅 지연이다 — 짧게 잡는다.
const CONNECT_MS = 6000;
const CALL_MS = 10_000;     // 서버 함수 한 번의 상한

let rs = null;

/**
 * 내가 누구인가. 웹셸이 iframe 에 넘기는 `?auth=` 토큰에서 꺼낸다.
 *
 * **없으면 붙지 않는다.** RemoteServer 의 기본값은 `?account=` 아니면
 * `anonymous+난수`인데, 그걸로 붙으면 접속할 때마다 다른 사람이 되어
 * 백엔드에 빈 계정이 쌓이고 클라우드 세이브가 매번 새로 시작한다.
 * 호스트 밖(로컬 dev·직접 배포)에서는 예전처럼 조용히 데모로 도는 것이 맞다.
 */
function identity() {
  try {
    const u = Verse8.getUser();
    if (u && u.verse && u.account) return { verse: u.verse, account: u.account };
  } catch { /* ?auth= 가 없다 — 호스트 밖이다 */ }
  return null;
}

const withTimeout = (p, ms, what) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} 시간 초과 (${ms}ms)`)), ms)),
]);

/**
 * 서버 함수 한 번.
 * @param opts.needResponse false 면 던지고 잊는다 (떠날 때의 마지막 저장).
 *   응답을 기다리지 않으므로 리스너도 안 단다.
 */
function remoteFunction(fn, args = [], opts = {}) {
  if (!rs || !rs.socket || !rs.connected) return Promise.reject(new Error('서버에 붙어 있지 않다'));
  const callId = Math.random().toString(36).slice(2, 15);

  if (opts.needResponse === false) {
    rs.socket.emit('fn:call', { callId, fn, args });
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    let done = false;
    const unsub = rs.on('fn:return', ret => {
      if (done || !ret || ret.callId !== callId) return;
      done = true; clearTimeout(timer); unsub();
      resolve(ret.result);
    });
    // 응답이 안 와도 **반드시** 리스너를 뗀다 — SDK 가 안 하는 일이다
    const timer = setTimeout(() => {
      if (done) return;
      done = true; unsub();
      reject(new Error(`${fn} 응답 없음 (${CALL_MS}ms)`));
    }, CALL_MS);
    rs.socket.emit('fn:call', { callId, fn, args });
  });
}

/**
 * 붙는다. **절대 던지지 않는다** — 실패하면 null 을 주고, 부르는 쪽은
 * 예전처럼 데모로 떨어진다. 서버가 없다고 게임이 안 열리면 안 된다.
 *
 * @param override {verse, account} 를 직접 준다. 호스트 밖에서 서버 경로를
 *   시험할 때만 쓴다 (__dbg.connectGameServer — live.initLive(mockServer) 와 같은 성격).
 *   부팅은 언제나 인자 없이 부른다.
 * @returns {Promise<{remoteFunction:Function, account:string, verse:string}|null>}
 */
export async function connectGameServer(override) {
  // **아직 켜지 않는다.** SDK 에 박힌 백엔드
  // (verse8-simple-game-backend-….run.app)가 /socket.io/ 를 열지 않는 것을
  // 확인했다 — 404 를 준다. 성공할 수 없는 접속을 시도하면 CONNECT_MS 만큼
  // 부팅이 늦어질 뿐이라, 접속 URL 이 확인될 때까지 꺼 둔다 (2026-08-26).
  //
  // 켜는 조건: Verse8 대시보드에서 게임서버 접속 URL 을 확인하고
  //   1) rs.config({ verse, account, remoteUrl }) 에 remoteUrl 을 넘기고
  //   2) 이 플래그를 true 로
  // __dbg.connectGameServer({verse, account}) 는 이 플래그와 무관하게 돈다 —
  // 호스트 밖에서 접속 경로를 시험할 때 쓴다.
  const ENABLED = false;
  if (!ENABLED && !override) {
    console.log('[냥냥] gameserver 꺼짐 — 접속 URL 확인 전까지 시도하지 않는다');
    return null;
  }
  const id = override && override.verse && override.account ? override : identity();
  if (!id) {
    console.log('[냥냥] gameserver 없음 — ?auth= 가 없다 (호스트 밖이면 정상)');
    return null;
  }
  try {
    rs = new RemoteServer();
    rs.config({ verse: id.verse, account: id.account });
    await withTimeout(rs.connect(), CONNECT_MS, '게임서버 접속');
    if (!rs.connected) throw new Error('소켓은 열렸는데 connected 신호가 없다');
    console.log('[냥냥] gameserver 연결됨', id.verse, id.account);
    return { remoteFunction, account: id.account, verse: id.verse };
  } catch (e) {
    console.warn('[냥냥] gameserver 접속 실패 — 데모로 계속', e);
    try { rs?.socket?.disconnect(); } catch { /* 이미 죽었다 */ }
    rs = null;
    return null;
  }
}
