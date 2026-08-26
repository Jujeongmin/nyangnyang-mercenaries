// 서버가 쥔 것들(연합·친구·아레나 상대·랭킹)을 화면에 대는 얇은 층.
//
// 왜 캐시인가 — 화면 렌더 함수들은 전부 **동기**다. 서버 호출은 비동기라
// 렌더 안에서 await 하려면 화면 코드 전체를 async 로 바꿔야 하고, 그러면
// 스크롤 위치·포커스가 매 프레임 날아가는 흔한 사고가 따라온다.
// 그래서 규칙을 하나로 잡는다:
//
//   1. 화면을 열 때 pull() 을 쏘고 **캐시로 즉시 그린다** (없으면 데모)
//   2. 응답이 오면 캐시를 갈고 onDone 으로 **다시 그린다**
//
// 서버가 없으면(로컬 dev) 모든 pull 이 즉시 no-op 이라 화면은 데모 그대로다.
// 이게 이 파일의 핵심 계약이다 — **붙든 안 붙든 화면 코드는 한 벌이다.**
//
// 접속점은 core/cloudsave.js 와 같다: window.__V8_SERVER 또는 주입.
// Verse8 의 비-React 접속법이 문서에 없어 추측하지 않는다 (net/verse8.js 원칙).

let server = null;

const cache = {
  alliances: null,     // 가입할 수 있는 연합 목록
  myAlliance: null,    // { alliance, me, members }
  boss: null,          // { hp, max, tier, triesLeft }
  bossLog: null,       // [{ account, damage }]
  friends: null,       // publicProfile 모양 + since
  friendReqs: null,    // 받은 신청
  arenaFoes: null,     // 상대 표본
  friendCands: null,   // 친구 추천 표본 (아레나보다 넓은 대역)
  rankTop: null,       // 상위 20 (CP — rankings 컬렉션)
  // 보드별 순위. profiles 에서 뽑으므로 party·title·frame 까지 들어 있다 —
  // 순위 행이 곧 프로필 카드다
  topPower: null,
  topStage: null,
  topArena: null,
  myRank: null,        // { bestEntry, rank }
  giftBox: null,       // { sent:[account], inbox:[{id, from, fromNick, day}] }
  chatRooms: null,     // { world, ally } 구독할 컬렉션 이름
  chatWorld: null,     // 최근 대화 (전체)
  chatAlly: null,      // 최근 대화 (연합)
};

/** 마지막으로 성공한 시각. 같은 화면을 다시 열 때 과하게 다시 안 쏘려고 본다 */
const at = {};
const FRESH_MS = 20_000;

/**
 * 호스트가 넣어 준 게임서버 객체를 찾는다.
 *
 * 문서에 있는 접속법은 React 훅(`useGameServer()`)뿐이라 vanilla 에서 쓸
 * 전역 이름이 확인된 적이 없다. 그래서 **이름을 하나로 못 박지 않고**
 * `remoteFunction` 을 가진 객체를 전역에서 찾는다 — 호스트가 어떤 이름으로
 * 넣든 붙는다. 못 찾으면 예전처럼 조용히 데모로 떨어진다.
 */
export function findServer() {
  if (typeof window === 'undefined') return null;

  /**
   * **속성을 읽는 것 자체가 예외를 던질 수 있다.** 전역에는 다른 출처의
   * 프레임(window.parent · window.top · window[0] …)이 섞여 있는데, 그 객체의
   * 속성에 손대면 브라우저가 SecurityError 로 막는다 — 게임이 프리뷰 iframe
   * 안에서 돌 때 실제로 터졌다 ("Blocked a frame with origin …", 2026-08-25).
   * 그래서 읽기를 통째로 try 로 감싼다.
   */
  const ok = o => {
    try { return !!o && typeof o.remoteFunction === 'function'; } catch { return false; }
  };
  const at = k => { try { return window[k]; } catch { return null; } };

  // 이름이 알려진 후보부터 (확인되면 이 줄만 남기면 된다)
  for (const k of ['__V8_SERVER', 'server', '$server', 'gameServer', 'agent8', '__AGENT8__']) {
    const v = at(k);
    if (ok(v)) return v;
    if (v) { try { if (ok(v.server)) return v.server; } catch { /* 다른 출처 */ } }
  }

  // 그래도 없으면 전역을 한 번 훑는다. 창·프레임 자신을 가리키는 이름과
  // 프레임 번호(window[0])는 건드리지 않는다 — 전부 다른 출처일 수 있다
  const SKIP = /^(webkit|chrome|on|\d+$)/;
  const FRAMES = new Set(['window', 'self', 'top', 'parent', 'frames', 'opener', 'document']);
  for (const k of Object.getOwnPropertyNames(window)) {
    if (SKIP.test(k) || FRAMES.has(k)) continue;
    const v = at(k);
    if (ok(v)) return v;
  }
  return null;
}

export function initLive(injected) {
  server = injected || findServer();
  if (!server || typeof server.remoteFunction !== 'function') server = null;
  // 붙었는지/못 붙었는지를 콘솔에 남긴다 — 배포 환경에서 이게 없으면
  // 채팅·랭킹·연합이 전부 데모로 도는데, 화면만 봐서는 이유를 알 수 없다
  console.log('[냥냥] gameserver', server ? '연결됨' : '없음 (데모로 동작)');
  return !!server;
}

export const liveReady = () => !!server;

/** 캐시 읽기. 서버가 없거나 아직 안 왔으면 null — 부르는 쪽이 데모로 떨어진다 */
export const get = key => cache[key];

const call = (name, args = []) => server.remoteFunction(name, args);

/**
 * 서버 함수를 이름으로 직접 부른다. **진단 전용이다.**
 * 화면 코드는 위의 이름 붙은 함수들을 쓴다 — 여기로 부르면 어디서 무엇을
 * 부르는지 추적이 안 된다.
 *
 * 이게 있는 이유: 배포본에서 "서버가 무엇을 돌려주나" 를 볼 때마다 클라
 * 코드를 고쳐 배포할 수는 없다. 콘솔에서 바로 찔러 본다.
 *   __dbg.live.raw('serverInfo').then(console.log)
 */
export const raw = (name, args = []) => (server ? call(name, args)
  : Promise.reject(new Error('서버에 안 붙어 있다')));

/**
 * 어떤 값을 받아 캐시에 넣고 onDone 을 부른다.
 * 실패는 **조용히 삼킨다** — 연합 목록이 안 온다고 게임이 멈추면 안 된다.
 * 대신 캐시를 안 건드려서 화면은 직전 값(또는 데모)을 유지한다.
 */
async function pull(key, fn, onDone, force = false) {
  if (!server) return null;
  if (!force && at[key] && Date.now() - at[key] < FRESH_MS && cache[key] != null) {
    return cache[key];
  }
  try {
    const v = await fn();
    cache[key] = v;
    at[key] = Date.now();
    onDone?.(v);
    return v;
  } catch (e) {
    console.warn('[live] ' + key + ' 실패', e);
    return null;
  }
}

// **force 를 쓰지 않는다.** 화면은 "pull -> 응답 -> 다시 그리기 -> 또 pull" 로 도는데
// 매번 강제로 받으면 그 고리가 끊기지 않는다 (요청 무한 루프). 캐시가 신선하면
// pull 이 onDone 을 부르지 않고 조용히 끝나서 두 번째 바퀴에서 멈춘다.
// 방금 바꾼 값을 꼭 다시 받아야 하는 곳은 invalidate() 를 먼저 부른다.
export const pullAlliances = onDone => pull('alliances', () => call('allianceList', [20]), onDone);
export const pullMyAlliance = onDone => pull('myAlliance', () => call('allianceMy'), onDone);
export const pullBoss = onDone => pull('boss', () => call('allianceBoss'), onDone);
export const pullBossLog = onDone => pull('bossLog', () => call('allianceBossLog'), onDone);
export const pullFriends = onDone => pull('friends', () => call('friendList'), onDone);
export const pullFriendReqs = onDone => pull('friendReqs', () => call('friendRequests'), onDone);
export const pullGiftBox = onDone => pull('giftBox', () => call('friendGiftBox'), onDone);
export const pullRank = onDone => {
  pull('rankTop', () => call('getTopRankings', [20]), onDone);
  pull('myRank', () => call('getMyBestRank'), onDone);
};

/**
 * 보드별 순위. **profiles 에서 뽑는다** — cp·stage·arenaScore 가 다 거기 있고,
 * party·title·frame 까지 딸려 와서 순위 행을 그대로 프로필 카드로 쓸 수 있다.
 * 예전에는 rankings 컬렉션에 CP 하나뿐이라 스테이지·아레나 보드가 더미였다.
 */
const TOP_KEY = { power: 'topPower', stage: 'topStage', arena: 'topArena' };
export const pullTop = (board, onDone) => {
  const key = TOP_KEY[board];
  if (key) pull(key, () => call('topProfiles', [board, 20]), onDone);
};
export const getTop = board => cache[TOP_KEY[board]] || null;

/**
 * 아레나 상대. 내 CP 의 ±40% 대역에서 표본을 받는다 — 정교한 매칭이 아니라
 * **표본**이다 (server.js > findProfiles). 대역이 비면 화면은 데모로 떨어진다.
 */
export const pullArenaFoes = (myCp, onDone) => pull('arenaFoes',
  () => call('findProfiles', [{
    minCp: Math.floor(myCp * 0.6), maxCp: Math.ceil(myCp * 1.4), limit: 12,
  }]), onDone);

// ── 상태를 바꾸는 것 ──────────────────────────────────────
// 전부 **서버 판정**이다. 클라는 요청만 하고 결과를 받는다.
// 실패는 삼키지 않는다 — 부르는 쪽이 토스트를 띄워야 한다.

export const pushProfile = p => server ? call('submitProfile', [p]) : null;
export const pushCp = (score, nickname) => server ? call('submitCp', [score, nickname]) : null;

export const createAlliance = (name, stage, cp) => call('allianceCreate', [name, stage, cp]);
export const joinAlliance = (id, stage, cp) => call('allianceJoin', [id, stage, cp]);
export const leaveAlliance = () => call('allianceLeave');
export const donateStep = n => call('allianceDonate', [n]);
export const bossHit = (damage, cp) => call('allianceBossHit', [damage, cp]);

export const sendGift = account => call('friendGift', [account]);
export const claimGifts = ids => call('friendGiftClaim', [ids]);

export const sendChat = (scope, text) => call('sendChat', [scope, text]);
export const fetchChat = (scope, limit = 40) => call('getChat', [scope, limit]);

/**
 * 채팅 구독. 새 글이 즉시 온다 (globalCollection > subscribeGlobalCollection).
 *
 * **해제 함수를 반드시 돌려준다.** 화면을 닫아도 구독이 살아 있으면 방치 게임을
 * 몇 시간 켜 두는 동안 트래픽이 계속 흐르고, 같은 화면을 다시 열 때마다 구독이
 * 하나씩 겹쳐 같은 줄이 두 번 세 번 그려진다.
 *
 * 콜백 인자는 문서 예제와 같은 `{ items, changes }` 다. items 전체가 오므로
 * 화면은 매번 통째로 다시 그린다 - 채팅은 40줄이라 부분 갱신이 이득이 아니다.
 */
export function subscribeChat(scope, cb) {
  const rooms = cache.chatRooms;
  const room = scope === 'ally' ? rooms?.ally : rooms?.world;
  if (!server || !room || typeof server.subscribeGlobalCollection !== 'function') return null;
  try {
    return server.subscribeGlobalCollection(room, ({ items }) => {
      const rows = [...(items || [])].sort((a, b) => (a.at || 0) - (b.at || 0));
      cache[scope === 'ally' ? 'chatAlly' : 'chatWorld'] = rows;
      cb?.(rows);
    });
  } catch (e) {
    console.warn('[live] 채팅 구독 실패 - 폴링 없이 수동 새로 고침만 된다', e);
    return null;
  }
}

/** 구독이 없는 환경에서 화면이 받아 온 목록을 캐시에 꽂는다 */
export const setChat = (scope, rows) => {
  cache[scope === 'ally' ? 'chatAlly' : 'chatWorld'] = rows;
};

/** 계정 하나의 공개 프로필 — 채팅 프로필 카드가 쓴다. 캐시 없이 그때그때 */
export const fetchProfile = account => server ? call('getProfile', [account]) : null;

export const searchNick = nick => call('findByNickname', [nick]);
export const addFriend = account => call('friendRequest', [account]);
export const respondFriend = (reqId, accept) => call('friendRespond', [reqId, accept]);
export const removeFriend = account => call('friendRemove', [account]);

/**
 * 부팅 예열. **서버가 붙어 있으면 로딩이 끝나기 전에 다 받아 둔다.**
 *
 * 왜 부트에서 하나 — 화면을 열 때 받으면 유저가 데모를 한 번 보고 0.3초 뒤에
 * 진짜 값으로 갈리는 것을 본다. 목록이 눈앞에서 바뀌는 화면은 고장으로 읽힌다.
 * 로딩 막대는 어차피 기다리는 시간이니 거기서 끝내는 게 맞다.
 *
 * 전부 **동시에** 쏜다. 하나씩 await 하면 10회 왕복이 직렬로 쌓여 로딩이 그만큼 늘어난다.
 * remoteFunction 은 유저당 초당 약 10회라 10개는 한 번에 나갈 수 있는 한계선이다 —
 * 여기서 더 늘릴 일이 생기면 화면 진입 시점으로 미루는 쪽이 낫다.
 *
 * 하나가 실패해도 나머지는 그대로 간다 (pull 이 각자 삼킨다). 못 받은 것은
 * 해당 화면이 열릴 때 다시 받고, 그때까지는 데모가 자리를 지킨다.
 */
export async function warmup(myCp = 0) {
  if (!server) return false;
  await Promise.all([
    pull('alliances', () => call('allianceList', [20])),
    pull('myAlliance', () => call('allianceMy')),
    pull('boss', () => call('allianceBoss')),
    pull('bossLog', () => call('allianceBossLog')),
    pull('friends', () => call('friendList')),
    pull('friendReqs', () => call('friendRequests')),
    pull('rankTop', () => call('getTopRankings', [20])),
    pull('myRank', () => call('getMyBestRank')),
    pull('arenaFoes', () => call('findProfiles', [{
      minCp: Math.floor(myCp * 0.6), maxCp: Math.ceil(myCp * 1.4), limit: 12 }])),
    pull('friendCands', () => call('findProfiles', [{
      minCp: Math.floor(myCp * 0.2), maxCp: Math.ceil(myCp * 5), limit: 12 }])),
    pull('giftBox', () => call('friendGiftBox')),
    pull('chatRooms', () => call('chatRooms')),
    pull('chatWorld', () => call('getChat', ['world', 40])),
    pull('chatAlly', () => call('getChat', ['ally', 40])),
  ]);
  return true;
}

/**
 * 친구 추천. 아레나보다 **훨씬 넓은 대역**을 본다 — 친구는 이겨야 하는 상대가
 * 아니라 매일 선물을 주고받을 사람이라 CP 가 비슷할 이유가 없다.
 */
export const pullFriendCands = (myCp, onDone) => pull('friendCands',
  () => call('findProfiles', [{
    minCp: Math.floor(myCp * 0.2), maxCp: Math.ceil(myCp * 5), limit: 12,
  }]), onDone);

/** 화면을 떠나거나 편성이 크게 바뀌면 캐시를 버린다 */
export function invalidate(...keys) {
  for (const k of keys.length ? keys : Object.keys(cache)) { cache[k] = null; delete at[k]; }
}
