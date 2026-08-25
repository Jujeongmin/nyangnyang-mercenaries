// Verse8 백엔드 구현 (골격).
//
// **여기 있는 시그니처는 공식 문서에서 확인한 것만 쓴다.** 추측하지 않는다.
//   globalUserState  https://docs.verse8.io/ko/docs/gameserver/sdk/globalUserState
//   leaderboard      https://docs.verse8.io/ko/docs/gameserver/sdk/leaderboard
//
// 확인된 API
//   서버:  $global.getMyState() / $global.updateMyState(state)
//          $global.getUserState(account) / $global.updateUserState(account, state)
//          $sender.account                                   요청자 식별
//          $global.addCollectionItem(name, item)
//          $global.getCollectionItems(name, { orderBy, filters })
//          $global.getCollectionItem(name, itemId)          없으면 {} 를 돌려준다
//          $global.updateCollectionItem(name, item)         item.__id 로 찾는다
//          $global.deleteCollectionItem(name, itemId)
//          $global.countCollectionItems(name, options)
//          컬렉션 아이템의 식별자 필드는 **`__id`** 다 (globalCollection 문서 예제).
//          options 형태: { orderBy: [{field, direction}], filters: [{field, operator, value}], limit }
//          결제:  $onItemPurchased(data)  — data { account, purchaseId, productId, quantity, metadata }
//   클라:  subscribeGlobalMyState() / useGlobalMyState()
//   랭킹:  submitScore(score, nickname)   nickname 1~15자, score >= 0
//          getTopRankings()               **파라미터 없음. 상위 20명 고정**
//          getMyBestRank()                { bestEntry, rank }
//          getMyAllRankings()
//
// ⚠️ 문서에 없어서 확인이 필요한 것
//   · $global 상태 크기 제한          (save-schema.json > meta.todo 와 동일)
//   · 동시 갱신 트랜잭션 보장
//   · 스케줄러/크론 — 없다고 보고 일일 리셋은 lazy 처리한다
//
// ⚠️ ranking.json 정정 필요
//   verse8Implementation.getTopRankings 가 "getTopRankings(limit)" / limit 100 으로
//   적혀 있으나 실제 API 는 인자가 없고 20명을 돌려준다.
//   상위 100 을 원하면 getCollectionItems 로 직접 조회해야 한다.

const NICK_MAX = 15;      // leaderboard 제약. 초과하면 서버가 거부한다

export function create(opts = {}) {
  const call = opts.remoteFunction;      // 프로젝트가 주입한다
  if (!call) {
    throw new Error('verse8 백엔드에는 remoteFunction 이 필요하다. 아직 연결되지 않았다.');
  }

  const op = name => args => call(name, args);

  return {
    /** 서버 시각. 클라 시계를 절대 쓰지 않는다. */
    now: () => Date.now(),               // TODO: 서버가 내려준 시각으로 교체

    /** $global.getMyState() 로 세이브를 읽는다. 쓰기는 전부 서버 함수 안에서. */
    load: op('load'),

    summon: op('summon'),
    summonBatch: op('summonBatch'),
    autoEnhance: op('autoEnhance'),
    applyAutoEquip: op('applyAutoEquip'),
    equipGear: op('equipGear'),
    enhanceGear: op('enhanceGear'),
    upgradeStart: op('upgradeStart'),
    upgradeClaim: op('upgradeClaim'),
    upgradeSpeedup: op('upgradeSpeedup'),
    stageAttempt: op('stageAttempt'),
    claimIdle: op('claimIdle'),
    claimQuest: op('claimQuest'),
    claimAttendance: op('claimAttendance'),
    claimMail: op('claimMail'),
    watchAd: op('watchAd'),
    setSettings: op('setSettings'),

    /**
     * CP 제출. ranking.json > rateLimitBudget 이 경고한 지점이다 —
     * "CP 제출을 소환 1회마다 하면 10연차에서 10회 호출 = 즉시 한계".
     * 실제 debounce 는 net/backend.js 가 이미 걸고 있다.
     */
    submitCp: op('submitCp'),

    // --- 2단계: 여러 계정이 같이 만지는 것 (server/server.js) ---
    // 개인 진행은 여전히 saveState 통짜 저장이다. 여기 있는 것만 서버가 판정한다.
    submitProfile: op('submitProfile'),      // 공개 프로필 갱신 — 남이 보는 건 이것뿐이다
    findProfiles: op('findProfiles'),        // 아레나 상대 표본 (arenaFoes 자리)
    findByNickname: op('findByNickname'),
    getTopRankings: op('getTopRankings'),
    getMyBestRank: op('getMyBestRank'),

    friendRequest: op('friendRequest'),
    friendRequests: op('friendRequests'),
    friendRespond: op('friendRespond'),
    friendList: op('friendList'),
    friendRemove: op('friendRemove'),

    allianceList: op('allianceList'),
    allianceMy: op('allianceMy'),
    allianceCreate: op('allianceCreate'),
    allianceJoin: op('allianceJoin'),
    allianceLeave: op('allianceLeave'),
    allianceDonate: op('allianceDonate'),    // 단계 번호만 보낸다 — 비용은 서버 표에 있다
    allianceBoss: op('allianceBoss'),
    allianceBossHit: op('allianceBossHit'),  // 전투가 끝난 뒤 **1회만**
    allianceBossLog: op('allianceBossLog'),

    friendGift: op('friendGift'),            // 선물 — 계정을 넘는 유일한 우호 행위
    friendGiftBox: op('friendGiftBox'),
    friendGiftClaim: op('friendGiftClaim'),

    sendChat: op('sendChat'),                // scope: 'world' | 'ally'
    getChat: op('getChat'),
    chatRooms: op('chatRooms'),              // 구독할 컬렉션 이름 — 클라가 조립하지 않는다
    getProfile: op('getProfile'),            // 계정 하나의 공개 프로필 (채팅 카드)
  };
}

/**
 * 서버 함수 쪽 참고 구현. Verse8 프로젝트의 server 코드에 넣을 형태다.
 * 클라이언트 번들에서는 쓰지 않는다 — 여기 둔 이유는 클라·서버가 같은 규칙을
 * 본다는 것을 코드로 남기기 위함이다 (app/ARCHITECTURE.md 의존 방향 참조).
 */
export const SERVER_REFERENCE = `
// ── 랭킹 제출 (best-only 모드) ──
// leaderboard 문서의 best-score 패턴: 새 점수를 넣기 전에 기존 엔트리를 지운다.
async function submitBest(score, nickname) {
  if (typeof score !== 'number' || score < 0) throw new Error('score');
  if (!nickname || nickname.length < 1 || nickname.length > ${NICK_MAX}) throw new Error('nickname');
  const mine = await $global.getCollectionItems('rankings', {
    filters: [{ field: 'account', operator: '==', value: $sender.account }],
  });
  for (const it of mine) {
    if (it.score >= score) return it;              // 기록 갱신 아님
    await $global.deleteCollectionItem('rankings', it.id);
  }
  return $global.addCollectionItem('rankings', {
    account: $sender.account, score, nickname, createdAt: Date.now(),
  });
}

// ── 상위 100 ──
// getTopRankings() 는 20명 고정이라 컬렉션을 직접 조회한다.
async function top100() {
  return $global.getCollectionItems('rankings', {
    orderBy: [{ field: 'score', direction: 'desc' }],
    limit: 100,
  });
}

// ── 내 순위 ──
// getMyBestRank() 를 쓰거나, 나보다 높은 점수의 개수를 센다.
// ranking.json > verse8Implementation.getMyBestRank.performanceWarning:
//   "유저 수가 커지면 카운트 비용이 오른다. 화면 진입 시 1회로 제한하고 캐시할 것."
async function myRank(myScore) {
  const above = await $global.countCollectionItems('rankings', [
    { field: 'score', operator: '>', value: myScore },
  ]);
  return above + 1;
}

// ── 장비 소환 레벨업 시작 ──
// save-schema.json > criticalFields:
//   startedAt 이 서버 시각이 아니면 시계 조작으로 즉시 완료 치트가 된다.
async function upgradeStart(targetLevel) {
  const s = await $global.getMyState();
  const cost = ORE_COST[targetLevel - 2];
  if (s.currency.gold < cost) throw new Error('gold');
  s.currency.gold -= cost;
  s.summonLevels.equipment.upgradeSlots.push({
    startedAt: Date.now(),          // ★ 서버 시각
    targetLevel,
  });
  await $global.updateMyState(s);
  return s;
}

// ── 일일 리셋 (lazy) ──
// Verse8 문서에 스케줄러/크론이 확인되지 않는다. 배치 대신 접근 시 판정한다.
function lazyReset(s, nowMs) {
  const day = t => Math.floor((t + 9 * 3600e3 - 5 * 3600e3) / 86400e3);  // 05:00 KST
  if (day(s.dailies.lastResetAt) < day(nowMs)) {
    s.dailies.questProgress = {};
    s.dailies.adUsage = {};
    s.dailies.freeSummonUsed = false;
    s.dailies.lastResetAt = nowMs;
  }
  return s;
}
`;
