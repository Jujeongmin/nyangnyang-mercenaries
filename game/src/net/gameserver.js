// Verse8 게임서버 접속 — **remoteFunction 을 만드는 유일한 곳.**
//
// net/live.js 와 core/cloudsave.js 는 오랫동안 findServer() 로 전역을 뒤져
// remoteFunction 을 가진 객체를 찾고 있었다. 그런데 **호스트는 그런 걸 넣어
// 주지 않는다** — 배포본 콘솔이 그걸 확정했다 ("gameserver 없음 (데모로 동작)").
// 그래서 채팅·랭킹·연합·클라우드 세이브가 전부 데모로 돌았다. 여기서 직접 붙는다.
//
// ── 어느 SDK 인가 (한 번 헤맸다) ──────────────────────────
// 처음에 @verse8/react-client 로 붙였다가 실패했다. 그건 socket.io 로
// verse8-simple-game-backend-… 에 붙는데, 그 경로는 404 를 준다.
// 공식 문서(docs.verse8.io/ko/docs/gameserver/sdk/remoteFunction)가 가리키는 것은
// **@agent8/gameserver** 이고, 이쪽은 전혀 다르다:
//   · 전송이 socket.io 가 아니라 **순수 WebSocket**
//   · 백엔드가 wss://verse8-game-backend-kr-….run.app  (101 Switching Protocols 확인)
// 패키지 이름이 비슷해서 헷갈리기 쉽다. 문서가 가리키는 쪽이 맞다.
//
// ── 왜 클래스를 직접 쓰나 ─────────────────────────────────
// 문서 예제는 React 훅(useGameServer)뿐이지만, 그 훅이 쓰는 GameServer 는
// **React 를 안 쓰는 순수 클래스**이고 최상위에서 export 된다. vanilla 인 이
// 게임에서 그대로 쓸 수 있다.
//
// verse·account·auth 를 손으로 넘기지 않는다 — SDK 가 알아서 찾는다:
//   verse    VITE_AGENT8_VERSE (.env / .agent8.lock)
//   account  ?account= → 없으면 호스트가 준 값 → 없으면 난수
//   auth     ?auth=   (웹셸이 iframe 에 넘긴다)
// 넘기면 오히려 어긋난다. 플랫폼이 이 값들의 단일 소스다.
import { GameServer } from '@agent8/gameserver';

// 부팅이 이 접속을 **기다린다** (클라우드 세이브가 로컬보다 앞선지 먼저 알아야
// 화면을 열 수 있다). 그래서 상한이 곧 최악의 부팅 지연이다 — 짧게 잡는다.
const CONNECT_MS = 6000;

let server = null;

/**
 * 지금 붙어 있는 verse. **계정이 같아도 verse 가 다르면 데이터 공간이 다르다** —
 * 한쪽이 옛 배포 주소를 북마크로 들고 있으면 세이브가 서로 안 보인다.
 * 설정 > 접속 진단이 이걸 띄워서 그 경우를 가른다 (단장 재현 2026-08-28).
 */
export const currentVerse = () => (server && server.verse) || null;

const withTimeout = (p, ms, what) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} 시간 초과 (${ms}ms)`)), ms)),
]);

/**
 * 붙는다. **절대 던지지 않는다** — 실패하면 null 을 주고, 부르는 쪽은
 * 예전처럼 데모로 떨어진다. 서버가 없다고 게임이 안 열리면 안 된다.
 *
 * @param override {verse, account, remoteUrl} 을 직접 준다. 호스트 밖에서
 *   접속을 시험할 때만 쓴다 (__dbg.connectGameServer).
 * @returns {Promise<GameServer|null>} 그대로 remoteFunction 을 가진 객체다 —
 *   시그니처가 (fn, args, {needResponse}) 로 live.js·cloudsave.js 가 부르는
 *   방식과 정확히 같아서 어댑터가 필요 없다.
 */
export async function connectGameServer(override) {
  try {
    server = new GameServer(override || {});
    const ok = await withTimeout(server.connect(), CONNECT_MS, '게임서버 접속');
    if (!ok || !server.connected) throw new Error('connect 가 false 를 돌려줬다');
    console.log('[냥냥] gameserver 연결됨', server.verse, server.account);
    return server;
  } catch (e) {
    console.warn('[냥냥] gameserver 접속 실패 — 데모로 계속', e);
    // **정리를 기다리지 않는다.** disconnect() 를 await 하면 소켓이 어중간한
    // 상태일 때 그대로 매달려서 부팅이 로딩 화면에서 멈춘다 (실제로 멈췄다,
    // 2026-08-26). 실패한 접속을 치우는 데 유저를 기다리게 할 이유가 없다.
    const dead = server;
    server = null;
    Promise.resolve().then(() => dead?.disconnect?.()).catch(() => { /* 이미 죽었다 */ });
    return null;
  }
}
