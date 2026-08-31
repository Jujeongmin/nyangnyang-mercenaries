// Verse8 게임서버 함수 — 이 파일을 Verse8 프로젝트의 server.js 로 등록한다.
//
// **시그니처는 공식 문서에서 확인한 것만 쓴다** (net/verse8.js 의 원칙과 동일):
//   · 서버 메서드는 class Server 의 메서드다  (docs/gameserver/sdk/remoteFunction)
//   · $global.getMyState() / $global.updateMyState(state)   (globalUserState)
//   · $sender.account 가 요청자 식별                        (globalUserState)
//   · 클라 호출: server.remoteFunction("name", [args...])   — 초당 약 10회 제한
//
// ── 1단계 범위: 클라우드 세이브 ──────────────────────────────
// 프로토타입은 클라가 판정하고 세이브를 통짜로 올린다. 서버는 **저장·복원·
// 상식 검증**만 한다. 판정을 서버로 옮기는 2단계(net/backend.js 경계로 전부
// 이관)는 별도 작업이다 — 여기서 어설프게 반만 옮기면 클라·서버가 서로
// 다른 규칙으로 굴러 세이브가 갈라진다.
//
// 검증이 막는 것 (통짜 저장이라도 이것만은):
//   · 크기 폭탄 — 직렬화 200KB 초과 거부 (상태 크기 제한이 문서에 없어
//     보수적으로 잡는다. 초과는 버그거나 조작이다)
//   · 형식 파괴 — v 필드 불일치, s 가 객체가 아님
//   · 음수 재화 — 음수로 올린 뒤 서버 로직의 뺄셈을 뒤집는 고전 수법
//   · 진행 후퇴 덮어쓰기 — 실수로 빈 세이브가 큰 세이브를 덮는 것.
//     progressScore 가 서버 보관본의 60% 미만이면 force 없이는 거부한다.
//     (기기 교체 직후 새 기기의 빈 로컬이 올라오는 사고가 이걸로 막힌다)

// ── 수용량 메모 (2026-08-24 문서 조사) ──────────────────────
// 공식 문서에 룸 인원·동시접속 상한 수치가 **없다** (roomState 문서에 제한 미기재,
// 검색·개요 페이지에도 없음. Google Cloud 사례에 "GKE 대규모 운영" 언급뿐).
// 인프라 스케일링은 플랫폼(관리형) 몫이고, 우리 쪽 병목은 구조상 세 가지다:
//   1. globalUserState — 계정당 독립 문서라 유저 수에 수평적. 병목 아님.
//      remoteFunction 레이트리밋(~10/s)도 **유저당**이다.
//   2. rankings 컬렉션 — 유일한 전역 공유 자원. 유저가 커지면 여기가 먼저 아프다.
//      대비: 제출은 best-only + 클라 debounce(이미), 조회는 화면 진입 1회 + 캐시,
//      시즌마다 컬렉션을 새로 판다 (rankings_s1, s2 — 낡은 시즌은 안 긁는다).
//   3. 연합 실시간(마을·보스) — roomState 를 쓰게 되면 연합 하나 = 룸 하나다.
//      연합 정원이 30명이라 룸이 자연 샤드가 된다. 전 유저 단일 룸은 만들지 않는다.
// 정확한 상한이 필요해지면(동접 1만+) Verse8 지원에 직접 확인할 것 — 추측 금지.

const SAVE_VERSION = 1;
const MAX_BYTES = 200 * 1024;
// Firestore 문서 한도는 **두 축**이고 서로 별개다:
//   1MB      문서 바이트 — 값이 큰가
//   40,000   인덱스 엔트리 — 필드가 많은가. Firestore 가 모든 필드를 자동 색인하고
//            leaf(스칼라 하나 또는 배열 원소 하나) 1개당 약 2엔트리다
// 둘 중 하나만 넘어도 저장이 **재시도 없이 조용히 실패**한다. 바이트만 재면
// 200KB 짜리 작은 값 수만 개가 40k 를 먼저 넘겨 통과해 버린다 — 그래서 leaf 도 센다.
// 15,000 leaf ≈ 30,000 엔트리로, 상한의 75% 에서 막는다 (여유 25%).
const MAX_LEAVES = 15000;
const CURRENCY_FIELDS = ['dia', 'gold', 'eqTicket', 'mercTicket', 'skillTicket',
  'hourglass', 'medal', 'allyCoin'];

/** 진행도 점수 — 어느 세이브가 "더 앞서 있나"의 단일 잣대.
 *  클라(core/cloudsave.js)와 같은 식이어야 한다. 한쪽만 바꾸면 충돌 판정이 갈린다. */
function progressScore(s) {
  if (!s || typeof s !== 'object') return 0;
  const sumExp = (s.summonExp?.mercenary || 0) + (s.summonExp?.skill || 0);
  return (s.maxStage || 0) * 1000
    + (s.forgeLv || 0) * 200
    + (s.trainLv || 0) * 50
    + sumExp
    + (s.quest || 0) * 100;
}

/**
 * leaf 개수. Firestore 인덱스 엔트리의 근사치를 내는 유일한 방법이다 —
 * 스칼라 하나, 배열 원소 하나가 각각 leaf 다. 재귀 깊이는 세이브 구조상 얕다.
 *
 * **한 번 부풀면 되돌리기 어렵다**: Firestore 는 merge 저장이라 클라가 필드를
 * 지워도 문서에는 남는다. 그래서 "넘으면 거부" 가 사실상 유일한 예방책이고,
 * 넘긴 뒤에 줄이는 것으로는 안 풀린다 ($global 을 통째로 비우기 전까지).
 */
function countLeaves(v, depth = 0) {
  if (v === null || typeof v !== 'object') return 1;
  if (depth > 12) return 1;                       // 순환·과도한 중첩 방어
  let n = 0;
  if (Array.isArray(v)) {
    for (const x of v) n += countLeaves(x, depth + 1);
    return n;
  }
  for (const k of Object.keys(v)) n += countLeaves(v[k], depth + 1);
  return n;
}

function validate(payload) {
  if (!payload || payload.v !== SAVE_VERSION || typeof payload.s !== 'object') {
    throw new Error('bad_format');
  }
  const bytes = JSON.stringify(payload).length;
  if (bytes > MAX_BYTES) throw new Error('too_big:' + bytes);
  const leaves = countLeaves(payload.s);
  if (leaves > MAX_LEAVES) throw new Error('too_many_fields:' + leaves);
  const s = payload.s;
  for (const f of CURRENCY_FIELDS) {
    if (typeof s[f] === 'number' && (s[f] < 0 || !Number.isFinite(s[f]))) {
      throw new Error('bad_currency:' + f);
    }
  }
  return payload;
}


// -- 2단계: 랭킹·친구·연합·결제 -----------------------------
//
// 여기부터는 **여러 계정이 같이 만지는 것**만 다룬다. 개인 진행(스테이지·소환·
// 강화)은 여전히 클라가 판정하고 saveState 로 통짜 저장한다 - 반만 옮기면
// 클라·서버가 서로 다른 규칙으로 굴러 세이브가 갈라진다(파일 상단 참조).
//
// 공유 자원은 전부 컬렉션이다. $global.updateMyState 는 계정 하나만 만질 수 있어
// 연합처럼 "여러 계정이 같은 값을 더한다" 를 담을 수 없다.
//   rankings     CP 랭킹 (best-only)
//   profiles     공개 프로필 - 아레나 상대·친구 목록·랭킹 행이 전부 여기서 읽는다
//   friendReq    친구 신청 (수락하면 지운다)
//   friends      성립한 친구. **양방향 2행**으로 넣는다 - 한 행이면 내 친구를
//                찾을 때 from/to 두 번 조회해야 하고, 조회는 컬렉션이 가장 아픈 축이다
//   alliances    연합 본체 (레벨·XP·보스 HP)
//   allyMembers  단원. 연합 아이템 안에 배열로 넣지 않는다 - 30명이 동시에
//                기부하면 읽고-쓰기가 서로를 덮는다 (alliance.json > verse8.concurrency)
//   allyBossLog  보스 딜 기록 (주간)
//   gifts        친구 선물. **계정을 넘는 유일한 우호 행위다** - 이게 없으면
//                "선물 보내기" 는 내 기기에만 표시가 남고 상대는 아무것도 모른다
//   chatWorld    전체 채팅
//   chatAlly_<연합id>  연합 채팅. **연합마다 컬렉션을 판다** - 구독
//                (subscribeGlobalCollection) 이 컬렉션 단위라 한 컬렉션에 담고
//                필터로 가르면 남의 연합 대화까지 전부 받아 버린다

const MAX_MEMBERS = 30;              // alliance.json > membership.maxMembers
const JOIN_MIN_STAGE = 30;           // membership.joinRequirement.minStage
const LEAVE_COOLDOWN_MS = 24 * 3600e3;
const CREATE_COST_DIA = 1000;
const DAILY_COIN_CAP = 95;           // contribution.dailyCoinCap (5단계 합)
const BOSS_ATTEMPTS = 6;             // boss.attemptsPerWeek (구 3 — HP 10배와 같이 올렸다)
const BOSS_TIERS = [1, 1.35, 1.8, 2.4, 3.2];
// boss.hp.coefficient. 0.5 -> 10.0 (2026-08-31). 0.5 에서는 한 사람의 한 번이
// 1단계 HP 를 통째로 넘겨서 단원이 적은 연합은 보스를 한 방에 눕혔다.
// 시도딜이 화면 전투 실측(cp x 3.6)으로 바뀐 것까지 합쳐 10.0 이 "체감 10배" 다.
// 만근 연합이 주 6회를 다 써서 1단계를 잡는다 — 사다리는 주간이 아니라 시즌 단위로 오른다.
const BOSS_HP_COEF = 10.0;
// 딜 상한 배수. 화면 전투 실측(cp x 3.6)의 약 2배 — allianceBossHit 주석 참조
const BOSS_DMG_CAP_PER_CP = 7.5;

// 기부 5단계. **비용도 서버가 안다** - 클라가 "얼마 냈다"를 보내면 0원 기부가 된다
const DONATE_STEPS = [
  { n: 1, kind: 'free',    cost: 0,       coin: 5 },
  { n: 2, kind: 'gold',    cost: 2000000, coin: 10 },
  { n: 3, kind: 'gold',    cost: 5000000, coin: 15 },
  { n: 4, kind: 'diamond', cost: 100,     coin: 25 },
  { n: 5, kind: 'diamond', cost: 250,     coin: 40 },
];

// VXShop 상품 -> 지급량. economy.json > diamondPackages 와 같아야 한다.
// **여기 없는 productId 는 지급하지 않는다.** 상점에 없는 id 로 결제 웹훅이 들어오면
// 그건 우리 상품이 아니다
const PRODUCTS = {
  pack_xs:   { dia: 1500 },
  pack_s:    { dia: 8000 },
  pack_m:    { dia: 17000 },
  pack_l:    { dia: 55000 },
  pack_xl:   { dia: 100000 },
  pack_xxl:  { dia: 220000 },
  // 프리미엄 = 3배속 + 광고 제거 (구 speed3_unlock · adfree_pack 을 합친 상품)
  premium_pack: { unlock: 'premium', once: true },
  starter_pack: { dia: 4800, mercTicket: 30, skillTicket: 20, eqTicket: 100, once: true },
  growth_pack_50:  { dia: 3000, eqTicket: 200, once: true },
  growth_pack_100: { dia: 6000, eqTicket: 500, hourglass: 50, once: true },
  growth_pack_150: { dia: 12000, eqTicket: 1200, hourglass: 100, once: true },
  // 시즌 패스는 시즌마다 새 SKU 다 (pass_premium_s1, s2 …) — once 는 SKU 단위라
  // 새 시즌 상품이 등록되면 그 시즌에 다시 한 번 살 수 있다
  pass_premium_s1: { unlock: 'pass', once: true },
};

// 배포 반영 확인용 표식. **server.js 를 고칠 때마다 올린다.**
// serverInfo() 가 이 값을 돌려주므로 클라에서 어느 판이 도는지 바로 보인다.
const SERVER_REV = 24;

const CHAT_WORLD = 'chatWorld';
const CHAT_ALLY = 'chatAlly_';
const CHAT_MAX_LEN = 100;
const CHAT_MIN_GAP_MS = 1000;      // 초당 한 줄. 도배 방어의 1차선
// 방에 남기는 줄 수. 채팅은 **개수로 자라는 컬렉션**이라 상한이 없으면
// 조회가 점점 무거워지고 Firestore 인덱스 엔트리도 같이 늘어난다
const CHAT_KEEP = 120;

const KST = 9 * 3600e3;
/** KST 기준 날짜 번호. 일일 상한은 서버 시각으로만 센다 - 클라 시계는 못 믿는다 */
/**
 * 일 번호. **리셋은 05:00 KST** — 클라(main.js > dayIdx)와 같은 식이어야 한다.
 *
 * 예전에는 -5h 오프셋이 빠져 자정 KST 로 굴렀다. 바로 아래 weekIdx 에는 있는데
 * 여기만 없었다. 그래서 00:00~05:00 사이에는 서버가 "새 날", 클라가 "어제" 로
 * 갈려서, 친구 선물의 하루 한 번과 연합 기부 단계가 그 창에서 어긋났다
 * (단장 지적 2026-08-28: 폰에서 보냈는데 PC 에서 또 보내짐).
 */
function dayIdx(t) { return Math.floor((t + KST - 5 * 3600e3) / 86400e3); }
/** 주 번호. 리셋은 월요일 05:00 KST (alliance.json > boss.resetAt) */
function weekIdx(t) { return Math.floor((t + KST - 5 * 3600e3 - 4 * 86400e3) / (7 * 86400e3)); }

/** 서버가 쥐는 계정 부가 상태. 게임 세이브(save)와 섞지 않는다 -
 *  섞으면 클라가 통짜로 덮어쓸 때 서버 카운터까지 같이 날아간다 */
async function srvState() {
  const cur = await $global.getMyState();
  return (cur && cur.srv) || {};
}
async function srvPatch(patch) {
  const srv = await srvState();
  await $global.updateMyState({ srv: { ...srv, ...patch } });
  return { ...srv, ...patch };
}

/** scope -> 컬렉션 이름. 연합 방은 소속이 있어야 존재한다 */
/**
 * 정렬 상위 N개. **orderBy 를 믿지 않는다.**
 *
 * 백엔드가 orderBy 에 색인을 요구하고, 없으면 오류가 아니라 **빈 배열**을 준다.
 * 그래서 "저장은 ok 인데 목록이 늘 비어 있다" 가 된다 — 채팅에서 실제로 그랬다
 * (sendChat 은 {ok:true} 인데 getChat 은 [] 였다, 단장 확인 2026-08-26).
 * 랭킹·연합 목록도 같은 방식이라 같은 병을 앓는다.
 *
 * 정렬 조회를 먼저 시도하고, 비면 통째로 받아 여기서 정렬한다. 이 컬렉션들은
 * 상한이 작아서(채팅 CHAT_KEEP, 랭킹·연합 수십) 통째로 받아도 부담이 없다.
 */
async function sortedTop(collection, opts, field, n) {
  // orderBy 는 필드에 따라 죽는다 (인덱스 없는 cp·stage). 시도했다 실패하면
  // 왕복이 두 번이라, 처음부터 통째로 받아 여기서 정렬한다 — 이 컬렉션들은
  // 상한이 작아 풀스캔이 더 빠르고 늘 같은 시간이 걸린다
  const rows = (await $global.getCollectionItems(collection, opts)) || [];
  rows.sort((a, b) => (b[field] || 0) - (a[field] || 0));
  return rows.slice(0, n);
}

async function chatRoomOf(scope) {
  if (scope === 'world') return CHAT_WORLD;
  if (scope !== 'ally') return null;
  const mem = await oneByAccount('allyMembers', $sender.account);
  return mem ? CHAT_ALLY + mem.allianceId : null;
}

/**
 * 컬렉션 행 수를 **숫자로** 뽑는다.
 *
 * countCollectionItems 가 숫자가 아니라 객체를 돌려준다 (배포본에서 확인,
 * 2026-08-26). 그걸 그대로 비교하면 `객체 <= 180` 이 false 라 "넘쳤다" 로
 * 읽히고, 이어지는 뺄셈은 NaN 이 된다. 그 결과 pruneChat 이 **방금 쓴 줄을
 * 곧바로 지웠다** — "채팅을 쳐도 바로 사라진다" 의 진짜 원인이었다.
 *
 * 모양을 못 알아보면 **-1 을 준다.** 모르는 채로 지우느니 안 지우는 게 낫다.
 */
function countOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') {
    for (const k of ['count', 'total', 'n', 'size', 'length']) {
      if (typeof v[k] === 'number' && Number.isFinite(v[k])) return v[k];
    }
  }
  return -1;
}

/**
 * 오래된 줄 지우기. **매번 다 세지 않는다** - 보낼 때마다 count + 정렬 조회를
 * 돌리면 채팅 한 줄이 쿼리 세 번이 된다. 여유분(CHAT_KEEP 의 1.5배)을 넘겼을 때만
 * 한 번에 잘라 낸다.
 */
async function pruneChat(room) {
  const n = countOf(await $global.countCollectionItems(room, {}));
  // 셀 수 없으면 **아무것도 지우지 않는다.** 모르는 채로 삭제하면 대화가 통째로
  // 날아간다 — 실제로 그랬다
  if (n < 0 || n <= CHAT_KEEP * 1.5) return;
  const cut = Math.max(0, Math.min(n - CHAT_KEEP, CHAT_KEEP));   // 한 번에 과하게 안 지운다
  if (!cut) return;
  // 오래된 것부터. 정렬 조회를 못 믿으므로 받아서 여기서 고른다 (sortedTop 설명)
  const rows = (await $global.getCollectionItems(room, {})) || [];
  rows.sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const r of rows.slice(0, cut)) {
    if (r && r.__id) await $global.deleteCollectionItem(room, r.__id);
  }
}

/** 계정의 표시 이름. 공개 프로필이 단일 소스다 (submitProfile) */
/**
 * '단장' 을 표시하지 않는다 — 계정에서 결정적으로 만든 자동 닉으로 바꾼다.
 *
 * publicProfile 버그 시절(2026-08-27 이전)의 행은 nickname 이 전부 '단장'
 * 인데, 그 유저가 재접속해야 진짜 닉이 올라온다. 그때까지 랭킹·친구가
 * '단장' 으로 도배되면 안 된다 (단장 지적 2026-08-27). 목록은 클라의
 * profile.json > autoAssign 과 같은 것 — 계정 해시가 시드라 어디서 봐도
 * 같은 이름이고, 진짜 닉이 오면 그걸로 대체된다.
 */
const NICK_ADJ = ['용감한', '날쌘', '귀여운', '든든한', '엉뚱한', '단단한',
  '반짝', '느긋한', '까칠한', '포근한', '씩씩한', '해맑은'];
const NICK_ANI = ['냥이', '멍뭉', '햄찌', '토깽', '너굴', '펭귄',
  '여우', '곰돌', '다람', '두더지', '박쥐', '고슴'];
function fallbackNick(account) {
  let h = 0;
  for (const c of String(account || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const n = String(h % 99 + 1).padStart(2, '0');
  return NICK_ADJ[h % 12] + NICK_ANI[((h / 12) | 0) % 12] + n;
}
/** 계정당 한 행 — submitProfile 경합이 남긴 중복 방어 (updatedAt 최신이 진짜) */
function dedupAcc(rows) {
  const seen = new Map();
  for (const r of rows) {
    const cur = seen.get(r.account);
    if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) seen.set(r.account, r);
  }
  // Map 은 삽입 순서를 지키므로 정렬 순서가 유지된다
  return [...seen.values()];
}

/**
 * 보낸 사람 이름 칸을 표시용으로 확정한다 (friendReq.fromNick, gifts.fromNick).
 * fixNick 은 nickname 필드만 보므로 이 둘에는 안 먹는다.
 * @param accField  계정이 담긴 필드 이름  @param nickField  이름이 담긴 필드 이름
 */
function fixSenderNick(r, accField, nickField) {
  if (!r) return r;
  const n = String(r[nickField] || '');
  if (n && n !== '단장') return r;
  return { ...r, [nickField]: fallbackNick(r[accField]) };
}

/**
 * 보낸 사람 이름을 **지금 프로필로** 이어 준다.
 *
 * 친구 신청·선물은 보낼 때의 이름을 행에 굳혀 담는다 (받는 쪽이 프로필을
 * 조회하지 않아도 누구인지 보이게 하려고). 그런데 그 뒤 그 사람이 개명하면
 * 신청함·선물함에만 옛 이름이 남아, 같은 사람이 친구 목록과 다른 이름으로
 * 보인다 (2026-08-31). 채팅과 같은 병이다 — 읽을 때 잇는다.
 *
 * 프로필은 **한 번만** 받아 잇는다 (friendList 와 같은 방식).
 */
async function relinkSenderNick(rows, accField, nickField) {
  if (!rows.length) return rows;
  const profs = await qItems('profiles', { limit: 500 }).catch(() => []);
  const byAcc = new Map(profs.map(x => [x.account, String(x.nickname || '').slice(0, 15)]));
  return rows.map(r => {
    const now = byAcc.get(r[accField]);
    const row = now ? { ...r, [nickField]: now } : r;
    return fixSenderNick(row, accField, nickField);
  });
}

/** 행의 nickname 을 표시용으로 확정한다 — 빈 값·'단장' 은 자동 닉으로 */
function fixNick(r) {
  if (!r) return r;
  const n = String(r.nickname || '');
  return (!n || n === '단장') ? { ...r, nickname: fallbackNick(r.account) } : r;
}

async function nickOf(account) {
  const p = await oneByAccount('profiles', account);
  const n = p ? String(p.nickname || '').slice(0, 15) : '';
  return (!n || n === '단장') ? fallbackNick(account) : n;
}

/**
 * 필터 조회 — **실패해도 죽지 않는다.**
 *
 * getCollectionItems 의 filters/orderBy 는 필드에 따라 예외를 던지거나
 * 빈 결과를 준다 (인덱스가 없는 필드 — cp 정렬이 그랬고, cp 범위·day 필터도
 * 같은 병이다). 추천 친구가 안 뜨고 선물함이 데모로 굴러떨어진 원인
 * (단장 확인 2026-08-27). 조회가 죽으면 통째로 받아 여기서 거른다 —
 * 이 게임의 컬렉션들은 상한이 작아 풀스캔이 감당된다.
 */
async function qItems(collection, opts = {}) {
  const fs0 = opts.filters || [];
  // **단일 == 필터만 네이티브로 간다** — account== 패턴은 처음부터 잘 동작해
  // 온 유일한 모양이다. 복합·범위·정렬 필터는 시도해 봐야 죽거나 비므로,
  // 시도-실패-풀스캔의 왕복 두 번이 화면 지연으로 그대로 보였다
  // (단장 확인 2026-08-27: 아레나·친구·랭킹이 늦게 뜨거나 안 뜸).
  if (fs0.length === 1 && fs0[0].operator === '==' && !opts.orderBy) {
    try {
      const rows = await $global.getCollectionItems(collection, opts);
      if (rows) return rows;
    } catch (e) { /* 아래 풀스캔 */ }
  }
  let all;
  try {
    all = (await $global.getCollectionItems(collection, {
      limit: Math.max(500, (opts.limit || 0) * 10),
    })) || [];
  } catch (e) { return []; }
  const fs = opts.filters || [];
  const pass = it => fs.every(f => {
    const v = it[f.field];
    switch (f.operator) {
      case '==': return v === f.value;
      case '>':  return (v || 0) >  f.value;
      case '>=': return (v || 0) >= f.value;
      case '<':  return (v || 0) <  f.value;
      case '<=': return (v || 0) <= f.value;
      default: return true;
    }
  });
  let rows = all.filter(pass);
  const ob = opts.orderBy && opts.orderBy[0];
  if (ob) rows.sort((a, b) => ob.direction === 'desc'
    ? (b[ob.field] || 0) - (a[ob.field] || 0)
    : (a[ob.field] || 0) - (b[ob.field] || 0));
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

/**
 * 한 연합의 **실제 단원 수**. alliances.members 는 표시용 캐시라 못 믿는다.
 *
 * countCollectionItems 로 세면 안 된다 — 이 플랫폼은 filters 를 못 먹고
 * "filters is not iterable" 로 던진다 (sortedTop·myProfileRank 주석과 같은 이유).
 * 연합 가입·탈퇴가 그걸 그대로 쓰고 있어서, 던지는 순간 정원 검사와 빈 연합
 * 정리가 통째로 건너뛰어졌다 (단장 지적 2026-08-28: 초기화한 뒤 빈 연합이 남음).
 */
async function countMembers(allianceId) {
  const rows = await qItems('allyMembers', {
    filters: [{ field: 'allianceId', operator: '==', value: allianceId }],
    limit: MAX_MEMBERS,
  });
  return rows.length;
}

async function oneByAccount(collection, account) {
  const rows = await qItems(collection, {
    filters: [{ field: 'account', operator: '==', value: account }],
    limit: 1,
  });
  return rows[0] || null;
}

class Server {
  /**
   * **지금 어느 server.js 가 도는가.** 배포가 반영됐는지 1초에 확인하는 용도다.
   *
   * 필요해진 이유: 채팅이 저장은 되는데(sendChat ok) 읽히지 않아서(getChat [])
   * 서버 코드를 고쳤는데, 고친 게 실제로 배포됐는지 알 방법이 없었다.
   * 코드를 고칠 때마다 아래 SERVER_REV 를 올린다.
   *
   * 클라에서:  __dbg.live.raw('serverInfo').then(console.log)
   */
  async serverInfo() {
    return {
      rev: SERVER_REV,
      chatWorld: CHAT_WORLD,
      // 지금 이 컬렉션에 몇 줄이 있나 — 조회가 비는 게 "없어서"인지
      // "못 읽어서"인지 가른다
      chatCount: countOf(await $global.countCollectionItems(CHAT_WORLD, {}).catch(() => -1)),
      // 원본 모양도 같이 준다 — countOf 가 못 알아보는 새 모양이 오면 여기서 보인다
      chatCountRaw: await $global.countCollectionItems(CHAT_WORLD, {}).catch(e => String(e)),
      chatRows: ((await $global.getCollectionItems(CHAT_WORLD, {})) || []).length,
      account: $sender.account,
      // **서버가 이 계정에 대해 실제로 들고 있는 것.**
      // "PC 진행이 폰에 안 온다" 를 두 갈래로 가른다 — PC 의 업로드가 서버에
      // 닿지 않는 것인지(has=false 이거나 savedAt 이 옛날), 닿았는데 폰이
      // 안 받는 것인지(savedAt 은 최신인데 폰의 마지막동기가 더 크다).
      // 이게 없으면 두 기기의 화면만 보고는 어느 쪽이 끊겼는지 알 수 없다.
      mySave: await (async () => {
        try {
          const cur = await $global.getMyState();
          const sv = cur && cur.save;
          return {
            has: !!sv,
            savedAt: (sv && sv.savedAt) || 0,
            epoch: (cur && cur.saveEpoch) || 0,
            score: sv ? progressScore(sv.s) : 0,
            maxStage: (sv && sv.s && sv.s.maxStage) || 0,
            gold: Math.floor((sv && sv.s && sv.s.gold) || 0),
          };
        } catch (e) { return { error: String(e && e.message || e) }; }
      })(),
    };
  }

  /** 세이브 저장. force 는 진행 후퇴 가드를 넘을 때만 — 클라가 유저에게
   *  "서버 저장이 더 앞서 있다. 정말 덮어쓰나?" 를 물은 뒤에 준다. */
  async saveState(payload, force) {
    validate(payload);
    const cur = await $global.getMyState();
    // **세대 가드.** 초기화는 saveEpoch 를 올린다. 옛 세대를 들고 있는 다른
    // 기기가(로컬 세이브가 그대로 살아 있다) 30초 주기 업로드나 pagehide flush 로
    // 지운 세이브를 도로 올려놨다 — PC 에서 초기화해도 폰이 되살려서, PC 로
    // 돌아오면 옛 캐릭터가 그대로였다 (단장 재현 2026-08-28).
    // 서버가 막아야 한다. 클라의 협조에 기댈 수 없다 (flush 는 응답도 안 받는다).
    const epoch = cur && cur.saveEpoch || 0;
    // 세대를 안 보내는 클라(감싸기 전 번들)는 초기화 이력이 없는 계정에서만
    // 통과시킨다. epoch > 0 은 누군가 초기화했다는 뜻이라, 세대를 모르는
    // 업로드는 지운 세이브를 되살릴 후보다 — 그 기기가 새 번들을 받을 때까지 막는다
    if (epoch > 0 && (payload.epoch == null || payload.epoch < epoch)) {
      return { ok: false, reason: 'wiped', epoch };
    }
    if (cur && cur.save && !force) {
      const oldScore = progressScore(cur.save.s);
      const newScore = progressScore(payload.s);
      if (newScore < oldScore * 0.6) {
        return { ok: false, reason: 'regression', serverScore: oldScore, clientScore: newScore };
      }
    }
    await $global.updateMyState({
      save: { v: payload.v, s: payload.s, savedAt: Date.now() },   // ★ 서버 시각
      saveEpoch: epoch,
    });
    return { ok: true, savedAt: Date.now(), epoch };
  }

  /**
   * 세이브 삭제 — "저장 데이터 초기화" 전용. regression 가드 때문에 빈
   * 세이브 업로드로는 지울 수 없고 (후퇴로 거부된다), 로컬만 지우면 다음
   * 부팅에 클라우드가 도로 살린다 (단장 확인 2026-08-27). 그래서 명시적
   * 삭제 창구가 필요하다. 공개 프로필도 같이 지운다 — 초기화한 계정이
   * 랭킹에 옛 기록으로 남으면 안 된다.
   */
  async wipeState() {
    const me = $sender.account;
    // 세이브와 서버쪽 개인 상태(아레나 갱신 쿨타임·연합 탈퇴 쿨타임 등)를 같이 비운다.
    // srv 를 남기면 초기화한 계정에 쿨타임만 유령처럼 붙어 있다.
    //
    // **saveEpoch 를 올리는 게 핵심이다.** 이게 없으면 같은 계정의 다른 기기가
    // 아직 들고 있는 옛 로컬 세이브를 도로 올려서 초기화가 무효가 된다.
    // 올린 뒤로 옛 세대의 업로드는 saveState 가 거부하고, 그 기기는 부팅 때
    // loadState 의 epoch 를 보고 자기 로컬을 버린다
    const cur = await $global.getMyState();
    const epoch = ((cur && cur.saveEpoch) || 0) + 1;
    await $global.updateMyState({ save: null, srv: {}, saveEpoch: epoch });

    /** 한 컬렉션에서 내가 걸린 행을 전부 지운다. 필드가 여럿이면 각각 훑는다 */
    const purge = async (col, fields) => {
      const seen = new Set();
      for (const field of fields) {
        let rows = [];
        try {
          rows = await qItems(col, { filters: [{ field, operator: '==', value: me }] });
        } catch { rows = []; }
        for (const it of rows) {
          if (!it || !it.__id || seen.has(it.__id)) continue;
          seen.add(it.__id);
          try { await $global.deleteCollectionItem(col, it.__id); } catch { /* 이미 없음 */ }
        }
      }
      return seen.size;
    };

    // 초기화는 **남이 보는 흔적까지** 지워야 한다. 프로필만 지웠더니 보낸 친구
    // 신청·친구 관계·랭킹 행이 그대로 남아, 새로 시작한 계정에 옛 인연이
    // 따라붙었다 (단장 지적 2026-08-28).
    const n = {};
    n.profiles = await purge('profiles', ['account']);
    n.rankings = await purge('rankings', ['account']);
    // 보낸 신청(from)과 받은 신청(to) 둘 다
    n.friendReq = await purge('friendReq', ['from', 'to']);
    // 친구는 양방향 2행이라 내 행(account)과 상대가 나를 가리키는 행(friend) 둘 다
    n.friends = await purge('friends', ['account', 'friend']);
    n.gifts = await purge('gifts', ['from', 'to']);

    // 연합은 인원 캐시를 되돌려 놓고 빠진다. 그냥 행만 지우면 정원이 영영 찬 채로 남는다
    try {
      const mem = await qItems('allyMembers', {
        filters: [{ field: 'account', operator: '==', value: me }],
      });
      for (const it of mem) {
        await $global.deleteCollectionItem('allyMembers', it.__id);
        const al = it.allianceId && await $global.getCollectionItem('alliances', it.allianceId);
        if (al && al.__id) {
          const left = await countMembers(it.allianceId);
          // **비면 연합 자체를 지운다.** 예전에는 인원 캐시만 0 으로 낮춰서,
          // 초기화한 계정이 만들었던 연합이 단원 0 인 채로 목록에 남았다
          if (left <= 0) {
            await $global.deleteCollectionItem('alliances', al.__id);
          } else {
            const patch = { ...al, members: left };
            // 단장이 초기화했으면 가장 오래 있은 사람이 잇는다 — 빈 단장 자리를
            // 두면 그 연합은 공지도 추방도 영영 못 한다 (allianceLeave 와 같은 규칙)
            if (al.leader === me) {
              const rest = await qItems('allyMembers', {
                filters: [{ field: 'allianceId', operator: '==', value: it.allianceId }],
                limit: MAX_MEMBERS,
              });
              const heir = rest.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))[0];
              if (heir) {
                patch.leader = heir.account;
                await $global.updateCollectionItem('allyMembers', { ...heir, role: 'leader' });
              }
            }
            await $global.updateCollectionItem('alliances', patch);
          }
        }
      }
      n.allyMembers = mem.length;
    } catch { n.allyMembers = -1; }

    return { ok: true, epoch, deleted: n };
  }

  /** 세이브 복원. 없으면 null — 신규 계정이다. */
  async loadState() {
    const cur = await $global.getMyState();
    // 세대를 같이 줘야 클라가 자기 로컬이 죽은 세대인지 안다.
    //
    // **v/s 를 같은 높이에 같이 싣는다.** { save, epoch } 로만 감쌌더니 아직 새
    // 번들을 못 받은 기기가 cloud.v 를 못 찾아 "다른 버전"으로 보고 클라우드를
    // 아예 채택하지 못했다 — 기기 간 이어하기가 배포 사이에 끊긴다.
    // 옛 클라는 v/s 를 읽고, 새 클라는 save/epoch 를 읽는다.
    const save = (cur && cur.save) || null;
    return {
      ...(save || {}),                                   // v, s, savedAt — 옛 클라용
      save, epoch: (cur && cur.saveEpoch) || 0,          // 새 클라용
    };
  }

  /** 랭킹 제출 (best-only). net/verse8.js SERVER_REFERENCE 의 패턴 그대로. */
  async submitCp(score, nickname) {
    if (typeof score !== 'number' || score < 0 || !Number.isFinite(score)) throw new Error('score');
    if (!nickname || nickname.length < 1 || nickname.length > 15) throw new Error('nickname');
    const mine = await qItems('rankings', {
      filters: [{ field: 'account', operator: '==', value: $sender.account }],
    });
    for (const it of mine) {
      if (it.score >= score) return it;
      // 컬렉션 아이템의 식별자는 **`__id`** 다 (globalCollection 문서의 채팅 예제).
      // `it.id` 로 지우면 undefined 가 넘어가 삭제가 조용히 실패하고, 계정마다
      // 낡은 기록이 계속 쌓여 best-only 가 아니게 된다
      await $global.deleteCollectionItem('rankings', it.__id);
    }
    return $global.addCollectionItem('rankings', {
      account: $sender.account, score, nickname, createdAt: Date.now(),
    });
  }

  /**
   * 공개 프로필 스냅샷. **남이 볼 수 있는 것은 여기 담긴 것뿐이다** —
   * 아레나 상대 카드, 친구 목록, 랭킹 행이 전부 이 컬렉션에서 읽는다.
   * 개인 세이브($global.getMyState)는 본인만 읽을 수 있어 남의 편성을
   * 가져올 수 없다. 화면이 보여 주는 항목이 늘면 여기도 같이 늘려야 한다.
   *
   * 크기: party 5개 x (id·grade·level) + 코스메틱 3개 ≈ 300바이트.
   * 컬렉션 아이템 상한이 문서에 없어 넉넉히 잡아도 안전한 크기다.
   */
  async submitProfile(p) {
    if (!p || typeof p !== 'object') throw new Error('profile');
    if (!p.nickname || p.nickname.length > 15) throw new Error('nickname');
    if (typeof p.cp !== 'number' || !Number.isFinite(p.cp) || p.cp < 0) throw new Error('cp');
    const party = Array.isArray(p.party) ? p.party.slice(0, 5).map(x => ({
      id: String(x.id || '').slice(0, 12),
      grade: String(x.grade || '').slice(0, 3),
      level: Math.max(0, Math.min(99, x.level | 0)),
    })) : [];
    const item = {
      account: $sender.account,
      nickname: String(p.nickname).slice(0, 15),
      cp: Math.floor(p.cp),
      stage: Math.max(0, p.stage | 0),
      capCls: ['warrior', 'archer', 'mage'].includes(p.capCls) ? p.capCls : 'warrior',
      capTier: Math.max(1, Math.min(3, p.capTier | 0 || 1)),
      party,
      title: String(p.title || '').slice(0, 24),
      frame: String(p.frame || '').slice(0, 24),
      featured: String(p.featured || '').slice(0, 12),   // 대표 용병 id
      wing: String(p.wing || '').slice(0, 24),
      arenaScore: Math.max(0, p.arenaScore | 0),
      updatedAt: Date.now(),
    };
    const mine = await qItems('profiles', {
      filters: [{ field: 'account', operator: '==', value: $sender.account }],
    });
    // **지우고 다시 넣지 않는다.** 삭제와 추가 사이에 같은 계정의 두 번째
    // 호출이 끼면 행이 두 개가 된다 — 실제로 1초 차 중복 2행이 생겨 랭킹
    // 1·2위가 같은 사람이었다 (단장 진단 2026-08-27). 첫 행을 제자리에서
    // 갱신하고, 경합이 이미 남긴 잉여 행만 지운다.
    if (mine.length) {
      const keep = mine[0];
      for (const it of mine.slice(1)) {
        try { await $global.deleteCollectionItem('profiles', it.__id); } catch (e) {}
      }
      await $global.updateCollectionItem('profiles', keep.__id, item);
      return { ...item, __id: keep.__id };
    }
    return $global.addCollectionItem('profiles', item);
  }

  /**
   * 상대 후보. 아레나는 내 전투력 주변에서, 친구 찾기는 아무나 뽑는다.
   * 실매칭이 아니라 **표본**이다 — 정교한 매칭은 서버 부하가 커서 나중에.
   */
  /**
   * 아레나 상대 표본 — **경쟁 점수(arenaScore)가 가까운 순**이다 (단장 확정
   * 2026-08-27). CP 로 거르지 않는다: 색도 얻는 점수도 전부 점수 기준으로
   * 통일했는데 목록만 CP 면 화면과 매칭이 따로 논다. 범위 조건도 없다 —
   * 초반 서버는 인구가 적어 구간을 걸면 그대로 빈 화면이 된다.
   */
  async findArenaFoes(myScore = 1000, limit = 12) {
    const n = Math.min(50, Math.max(1, limit | 0));
    const all = (await qItems('profiles', { limit: 500 }))
      .filter(r => r.account !== $sender.account);
    all.sort((a, b) =>
      Math.abs((a.arenaScore || 0) - myScore) - Math.abs((b.arenaScore || 0) - myScore));
    return dedupAcc(all).slice(0, n).map(fixNick);
  }

  /**
   * 친구 추천 — 조건 없이 **최근에 논 사람부터**다 (단장 확정 2026-08-27:
   * 친구에 CP 조건을 건 적 없다). updatedAt 이 곧 활동 신호다.
   */
  async findFriendCands(limit = 12) {
    const n = Math.min(50, Math.max(1, limit | 0));
    const all = (await qItems('profiles', { limit: 500 }))
      .filter(r => r.account !== $sender.account);
    all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return dedupAcc(all).slice(0, n).map(fixNick);
  }

  /** 구버전 클라 호환 — 새 함수로 넘긴다 */
  async findProfiles({ limit = 12 } = {}) {
    return this.findFriendCands(limit);
  }

  // -- 랭킹 조회 --------------------------------------------
  // leaderboard 문서의 옵션 형태 그대로: orderBy [{field, direction}] · limit · filters.
  // 상위 100 은 안 준다 - 조회는 컬렉션에서 가장 비싼 축이고, 화면이 실제로
  // 보여 주는 것은 20행 + 내 순위 하나다 (ranking.json 정정: getTopRankings 는 20 고정)
  async getTopRankings(limit) {
    const n = Math.min(50, Math.max(1, limit | 0 || 20));
    return sortedTop('rankings', {}, 'score', n);
  }

  /**
   * 보드별 순위를 **profiles 에서** 뽑는다.
   *
   * rankings 컬렉션은 CP 하나뿐이라, 스테이지·아레나 보드는 화면이 더미를
   * 지어내고 있었다 (단장 지적 2026-08-26). 보드마다 컬렉션을 새로 파면
   * 조회가 유일한 전역 공유 자원을 세 배로 때린다.
   *
   * profiles 에는 이미 cp·stage·arenaScore 가 다 들어 있다 (submitProfile).
   * 게다가 party·title·frame 까지 있어서 **순위 행이 곧 프로필 카드**가 된다 —
   * 등수를 누르면 그 사람 편성을 볼 수 있다.
   */
  async topProfiles(board, limit) {
    const FIELD = { power: 'cp', stage: 'stage', arena: 'arenaScore', score: 'arenaScore' };
    const f = FIELD[board] || 'cp';
    const n = Math.min(50, Math.max(1, limit | 0 || 20));
    const rows = await sortedTop('profiles', {}, f, n * 2);
    // 계정당 한 행 — submitProfile 경합이 남긴 중복(updatedAt 최신이 진짜)이
    // 표에 두 번 서면 안 된다
    const seen = new Map();
    for (const r of rows) {
      const cur = seen.get(r.account);
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) seen.set(r.account, r);
    }
    const uniq = [...seen.values()].sort((a, b) => (b[f] || 0) - (a[f] || 0)).slice(0, n);
    // 그 보드 점수가 0 인 사람은 아직 순위에 낄 자격이 없다 — 스테이지 0,
    // 아레나 무기록이 상위에 섞이면 표가 거짓이 된다
    return uniq.filter(r => (r[f] || 0) > 0).map(r => fixNick({ ...r, score: r[f] || 0 }));
  }

  /**
   * 이 보드에서 내 실제 등수. "나보다 높은 점수의 사람 수 + 1" 이다.
   * 예전에는 전투력 보드만 등수가 있었고 스테이지·아레나는 화면이 47 을
   * 지어냈다 (단장 지적 2026-08-27). 내 profiles 행이 없거나 그 보드 점수가
   * 0 이면 -1 — 화면은 그때 순위를 지어내지 말고 비워 둔다.
   */
  async myProfileRank(board) {
    const FIELD = { power: 'cp', stage: 'stage', arena: 'arenaScore', score: 'arenaScore' };
    const f = FIELD[board] || 'cp';
    const me = await oneByAccount('profiles', $sender.account);
    const v = me ? (me[f] || 0) : 0;
    if (v <= 0) return { rank: -1, value: 0 };
    // countCollectionItems 는 filters 를 못 먹는다 ("filters is not iterable",
    // 단장 진단 2026-08-27) — qItems 로 받아서 계정 중복을 걷어내고 센다
    const above = await qItems('profiles', {
      filters: [{ field: f, operator: '>', value: v }],
      limit: 300,
    });
    const accs = new Set(above.filter(r => r.account !== $sender.account).map(r => r.account));
    return { rank: accs.size + 1, value: v };
  }

  /** 내 최고 기록과 등수. 등수는 "나보다 높은 점수의 개수 + 1" 이다 */
  async getMyBestRank() {
    const mine = await qItems('rankings', {
      filters: [{ field: 'account', operator: '==', value: $sender.account }],
    });
    if (!mine.length) return { bestEntry: null, rank: -1 };
    const best = mine.sort((a, b) => b.score - a.score)[0];
    // countCollectionItems 는 filters 를 못 먹는다 — qItems 로 세고 계정 중복 제거
    const above = await qItems('rankings', {
      filters: [{ field: 'score', operator: '>', value: best.score }],
      limit: 300,
    });
    const accs = new Set(above.filter(r => r.account !== $sender.account).map(r => r.account));
    return { bestEntry: best, rank: accs.size + 1 };
  }

  // -- 친구 --------------------------------------------------
  /** 닉네임으로 찾기. 완전 일치만 본다 - 부분 일치는 컬렉션 인덱스로 못 건다 */
  async findByNickname(nickname) {
    if (!nickname || typeof nickname !== 'string') return [];
    const rows = await qItems('profiles', {
      filters: [{ field: 'nickname', operator: '==', value: nickname.slice(0, 15) }],
      limit: 10,
    });
    return rows.filter(r => r.account !== $sender.account);
  }

  /** 친구 신청. 중복 신청·이미 친구·자기 자신을 막는다 */
  async friendRequest(toAccount) {
    if (!toAccount || toAccount === $sender.account) throw new Error('target');
    const already = await qItems('friends', {
      filters: [{ field: 'account', operator: '==', value: $sender.account },
                { field: 'friend', operator: '==', value: toAccount }],
      limit: 1,
    });
    if (already.length) return { ok: false, reason: 'already_friend' };
    const dup = await qItems('friendReq', {
      filters: [{ field: 'from', operator: '==', value: $sender.account },
                { field: 'to', operator: '==', value: toAccount }],
      limit: 1,
    });
    if (dup.length) return { ok: false, reason: 'already_sent' };
    const me = await oneByAccount('profiles', $sender.account);
    await $global.addCollectionItem('friendReq', {
      from: $sender.account, to: toAccount,
      // nickOf 는 프로필이 없거나 옛 '단장' 행이어도 계정에서 만든 자동 닉을
      // 돌려준다. 여기서 '단장' 을 그대로 적으면 그 문자열이 신청 목록에
      // 박제되어 나중에 고쳐도 안 사라진다 (단장 지적 2026-08-28)
      fromNick: await nickOf($sender.account), fromCp: me ? me.cp : 0,
      createdAt: Date.now(),
    });
    return { ok: true };
  }

  /** 나에게 온 신청 목록. **fromNick 은 읽을 때 지금 프로필로 잇는다** — 신청
   *  행의 이름은 보낼 때 굳은 값이라 개명이 반영 안 되고, 예전 행에는 '단장' 이
   *  그대로 박제돼 있어 목록이 전부 같은 이름으로 보였다 */
  async friendRequests() {
    const rows = await qItems('friendReq', {
      filters: [{ field: 'to', operator: '==', value: $sender.account }],
      limit: 30,
    });
    return relinkSenderNick(rows, 'from', 'fromNick');
  }

  /**
   * 수락/거절. 수락하면 **양방향 2행**을 넣는다 - 목록 조회가 한 번으로 끝난다.
   * 신청 아이템은 어느 쪽이든 지운다 (남겨 두면 목록에 계속 뜬다)
   */
  async friendRespond(reqId, accept) {
    const req = await $global.getCollectionItem('friendReq', reqId);
    if (!req || req.to !== $sender.account) throw new Error('not_mine');
    await $global.deleteCollectionItem('friendReq', reqId);
    if (!accept) return { ok: true, accepted: false };
    const me = await oneByAccount('profiles', $sender.account);
    const now = Date.now();
    await $global.addCollectionItem('friends',
      { account: $sender.account, friend: req.from, nick: req.fromNick, since: now });
    await $global.addCollectionItem('friends',
      { account: req.from, friend: $sender.account,
        nick: await nickOf($sender.account), since: now });
    return { ok: true, accepted: true };
  }

  /**
   * 친구 목록. 저장해 둔 nick 이 아니라 **프로필을 다시 읽어** 돌려준다 -
   * 상대가 닉네임·전투력을 바꿔도 목록이 낡지 않는다
   */
  async friendList() {
    const edges = await qItems('friends', {
      filters: [{ field: 'account', operator: '==', value: $sender.account }],
      limit: 60,
    });
    if (!edges.length) return [];
    // 친구마다 프로필을 한 명씩 조회하면(N+1) 목록이 친구 수에 비례해
    // 느려진다 — profiles 를 한 번 받아 여기서 잇는다
    const profs = await qItems('profiles', { limit: 500 });
    const byAcc = new Map(profs.map(p => [p.account, p]));
    return edges.map(e => {
      const prof = byAcc.get(e.friend);
      return fixNick(prof
        ? { ...prof, since: e.since }
        : { account: e.friend, nickname: e.nick, cp: 0, since: e.since });
    });
  }

  /** 친구 끊기 - 양쪽 행을 다 지운다. 한쪽만 지우면 상대 목록에 유령이 남는다 */
  async friendRemove(account) {
    for (const pair of [[$sender.account, account], [account, $sender.account]]) {
      const rows = await qItems('friends', {
        filters: [{ field: 'account', operator: '==', value: pair[0] },
                  { field: 'friend', operator: '==', value: pair[1] }],
        limit: 2,
      });
      for (const r of rows) await $global.deleteCollectionItem('friends', r.__id);
    }
    return { ok: true };
  }

  // -- 연합 --------------------------------------------------
  /**
   * 목록. 정원이 찬 연합도 보여 준다 - 안 보이면 "왜 안 뜨지" 가 된다.
   *
   * **단원이 0인 연합은 감추고 그 자리에서 지운다.** alliances.members 는
   * 표시용 캐시라 실제와 어긋날 수 있고, 초기화·탈퇴가 실패한 흔적이 빈
   * 연합으로 남는다 (단장 지적 2026-08-28: 만들었다 초기화한 연합이 그대로 뜸).
   * 여기가 유일하게 모든 연합을 훑는 자리라 청소를 같이 한다 — 따로 도는
   * 정리 작업을 두지 않는다.
   *
   * 단원 표는 **한 번만** 받아 JS 에서 센다. 연합마다 세면 N+1 이다.
   */
  async allianceList(limit) {
    const n = Math.min(30, Math.max(1, limit | 0 || 20));
    const rows = await sortedTop('alliances', {}, 'weekly', n);
    if (!rows.length) return rows;

    const mems = await qItems('allyMembers', { limit: 500 });
    const cnt = new Map();
    for (const m of mems) cnt.set(m.allianceId, (cnt.get(m.allianceId) || 0) + 1);

    const live = [];
    for (const al of rows) {
      const c = cnt.get(al.__id) || 0;
      if (c > 0) { live.push(c === al.members ? al : { ...al, members: c }); continue; }
      // 빈 연합 — 지운다. 실패해도 목록에서는 빠지므로 화면은 깨끗하다
      try { await $global.deleteCollectionItem('alliances', al.__id); } catch (e) { /* 다음에 */ }
    }
    return live;
  }

  /** 내 소속. 없으면 null */
  async allianceMy() {
    const mem = await oneByAccount('allyMembers', $sender.account);
    if (!mem) return null;
    const al = await $global.getCollectionItem('alliances', mem.allianceId);
    // **연합은 사라졌는데 단원 행만 남은 경우** — 그대로 두면 allianceJoin 과
    // allianceCreate 가 "이미 소속돼 있다" 로 막아 영영 아무 데도 못 들어간다.
    // 가리키는 곳이 없는 행이므로 여기서 치운다
    if (!al || !al.__id) {
      try { await $global.deleteCollectionItem('allyMembers', mem.__id); } catch (e) { /* 다음에 */ }
      return null;
    }
    const members = await qItems('allyMembers', {
      filters: [{ field: 'allianceId', operator: '==', value: mem.allianceId }],
      limit: MAX_MEMBERS,
    });
    return { alliance: al, me: mem, members };
  }

  /**
   * 연합 마을에 세울 사람들. **단원 행에는 얼굴 정보가 없다** — allyMembers 는
   * 닉네임·전투력만 담는다. 마을은 각자의 **대표 용병**으로 서야 하므로
   * (단장 지시 2026-08-30) 그 정보가 있는 profiles 를 같이 읽어 붙인다.
   *
   * 계정마다 한 번씩 읽는다. 정원이 30이라 최악이 30읽기인데, 단일 == 필터라
   * 네이티브 경로로 가고(qItems 주석) 서로 독립이라 한꺼번에 던진다.
   * profiles 를 통째로 훑는 쪽이 왕복은 한 번이지만, 유저가 늘면 그쪽이 먼저
   * 무너진다 — 남의 행까지 500개씩 끌어오게 된다.
   *
   * updatedAt 을 그대로 넘긴다. **"접속 중"의 판정은 클라가 한다** — 얼마나
   * 최근이어야 접속으로 볼지는 화면의 문제이고, 서버가 정하면 그 값을 바꿀 때마다
   * 서버를 다시 올려야 한다.
   */
  async allianceVillage() {
    const mem = await oneByAccount('allyMembers', $sender.account);
    if (!mem) return null;
    const members = await qItems('allyMembers', {
      filters: [{ field: 'allianceId', operator: '==', value: mem.allianceId }],
      limit: MAX_MEMBERS,
    });
    const rows = await Promise.all(members.map(async m => {
      const p = await oneByAccount('profiles', m.account).catch(() => null);
      return {
        account: m.account,
        role: m.role || 'member',
        // 이름은 프로필이 먼저다 — 단원 행의 닉네임은 가입 시점에 굳은 값이라
        // 개명이 반영되지 않는다
        nickname: (p && String(p.nickname || '').slice(0, 15)) || m.nickname || fallbackNick(m.account),
        capCls: (p && p.capCls) || 'warrior',
        capTier: (p && p.capTier) || 1,
        featured: (p && p.featured) || '',
        cp: (p && p.cp) || m.cp || 0,
        updatedAt: (p && p.updatedAt) || 0,
      };
    }));
    return rows;
  }

  async allianceCreate(name, myStage, myCp) {
    if (!name || name.length < 2 || name.length > 12) throw new Error('name');
    if ((myStage | 0) < JOIN_MIN_STAGE) return { ok: false, reason: 'stage' };
    if (await oneByAccount('allyMembers', $sender.account)) return { ok: false, reason: 'already' };
    const dup = await qItems('alliances', {
      filters: [{ field: 'name', operator: '==', value: name }], limit: 1,
    });
    if (dup.length) return { ok: false, reason: 'name_taken' };
    // 창설 비용은 **서버가 깎는다**. 클라가 깎고 보내면 0 다이아 창설이 된다.
    // 이름 중복 검사를 **먼저** 한다 - 깎고 나서 실패하면 환불 경로가 생기고,
    // 환불은 실패할 수 있는 또 하나의 쓰기다
    if (!(await spendDia($sender.account, CREATE_COST_DIA))) return { ok: false, reason: 'diamond' };
    const al = await $global.addCollectionItem('alliances', {
      name, leader: $sender.account, level: 1, xp: 0, members: 1, weekly: 0,
      bossTier: 1, bossHp: 0, bossMax: 0, bossWeek: weekIdx(Date.now()),
      notice: '', createdAt: Date.now(),
    });
    await $global.addCollectionItem('allyMembers', {
      allianceId: al.__id, account: $sender.account, role: 'leader',
      // 닉네임은 **프로필에서 읽는다**. 클라가 보내면 남의 이름을 사칭할 수 있고,
      // 안 담아 두면 단원 목록이 지갑 주소 나열이 된다
      nickname: await nickOf($sender.account),
      cp: Math.max(0, myCp | 0), coin: 0, weekly: 0, joinedAt: Date.now(),
    });
    return { ok: true, alliance: al };
  }

  async allianceJoin(allianceId, myStage, myCp) {
    if ((myStage | 0) < JOIN_MIN_STAGE) return { ok: false, reason: 'stage' };
    if (await oneByAccount('allyMembers', $sender.account)) return { ok: false, reason: 'already' };
    const srv = await srvState();
    if (srv.allyLeftAt && Date.now() - srv.allyLeftAt < LEAVE_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', until: srv.allyLeftAt + LEAVE_COOLDOWN_MS };
    }
    const al = await $global.getCollectionItem('alliances', allianceId);
    if (!al || !al.__id) return { ok: false, reason: 'gone' };
    // 정원은 **행을 세어서** 판단한다. alliances.members 는 표시용 캐시라
    // 동시 가입에서 어긋날 수 있다
    const n = await countMembers(allianceId);
    if (n >= MAX_MEMBERS) return { ok: false, reason: 'full' };
    await $global.addCollectionItem('allyMembers', {
      allianceId, account: $sender.account, role: 'member',
      nickname: await nickOf($sender.account),
      cp: Math.max(0, myCp | 0), coin: 0, weekly: 0, joinedAt: Date.now(),
    });
    await $global.updateCollectionItem('alliances', { ...al, members: n + 1 });
    return { ok: true, alliance: al };
  }

  async allianceLeave() {
    const mem = await oneByAccount('allyMembers', $sender.account);
    if (!mem) return { ok: false, reason: 'none' };
    await $global.deleteCollectionItem('allyMembers', mem.__id);
    const al = await $global.getCollectionItem('alliances', mem.allianceId);
    if (al && al.__id) {
      const n = await countMembers(mem.allianceId);
      // 마지막 한 명이 나가면 연합을 지운다 - 빈 연합이 목록을 채우면
      // 신규 유저가 들어갈 곳을 못 찾는다
      if (n <= 0) {
        await $global.deleteCollectionItem('alliances', al.__id);
      } else {
        const patch = { ...al, members: n };
        if (al.leader === $sender.account) {
          const rest = await qItems('allyMembers', {
            filters: [{ field: 'allianceId', operator: '==', value: mem.allianceId }],
            limit: MAX_MEMBERS,
          });
          // 단장이 나가면 가장 오래 있은 사람이 잇는다. 빈 단장 자리를 두면
          // 공지·추방이 영영 안 된다
          const heir = rest.sort((a, b) => a.joinedAt - b.joinedAt)[0];
          if (heir) {
            patch.leader = heir.account;
            await $global.updateCollectionItem('allyMembers', { ...heir, role: 'leader' });
          }
        }
        await $global.updateCollectionItem('alliances', patch);
      }
    }
    await srvPatch({ allyLeftAt: Date.now() });
    return { ok: true };
  }

  /**
   * 기부. **단계 번호만 받는다** - 비용과 보상은 서버 표(DONATE_STEPS)에서 읽는다.
   * 하루 5단계 고정이라 순서를 건너뛰지 못한다. 코인 1 = 연합 XP 1 이고
   * XP 는 연합 아이템에 누적된다 (단원 전체 합산 - 로컬 데모가 못 하던 지점이다)
   */
  async allianceDonate(stepN) {
    const step = DONATE_STEPS.find(x => x.n === (stepN | 0));
    if (!step) throw new Error('step');
    const mem = await oneByAccount('allyMembers', $sender.account);
    if (!mem) return { ok: false, reason: 'none' };
    const srv = await srvState();
    const today = dayIdx(Date.now());
    const done = srv.donateDay === today ? (srv.donateDone || 0) : 0;
    if (done >= DONATE_STEPS.length) return { ok: false, reason: 'daily' };
    if (step.n !== done + 1) return { ok: false, reason: 'order', next: done + 1 };

    if (step.kind === 'gold' && !(await spendGold($sender.account, step.cost))) {
      return { ok: false, reason: 'gold' };
    }
    if (step.kind === 'diamond' && !(await spendDia($sender.account, step.cost))) {
      return { ok: false, reason: 'diamond' };
    }
    // 상한은 5단계 합(95)이라 순서 검사만 통과하면 저절로 지켜진다.
    // 그래도 한 번 더 자른다 - 표를 고칠 때 상한을 같이 못 고치는 사고를 막는다
    const coin = Math.min(step.coin, DAILY_COIN_CAP);
    await srvPatch({ donateDay: today, donateDone: step.n });
    await $global.updateCollectionItem('allyMembers',
      { ...mem, coin: (mem.coin || 0) + coin, weekly: (mem.weekly || 0) + coin });
    const al = await $global.getCollectionItem('alliances', mem.allianceId);
    if (al && al.__id) {
      await $global.updateCollectionItem('alliances',
        { ...al, xp: (al.xp || 0) + coin, weekly: (al.weekly || 0) + coin });
    }
    return { ok: true, coin, step: step.n };
  }

  /**
   * 연합 보스 상태. HP 는 **단원 CP 합 x 10.0 x 단계배수** 다
   * (alliance.json > boss.hp.formula). 주가 바뀌면 HP 를 새로 채운다.
   *
   * **단계는 주가 바뀌어도 안 내려간다** (2026-08-31). HP 10배 뒤로는 한 주에
   * 한 단계가 한계라, 매주 1단계로 되돌리면 2~5단계가 데이터에만 있고 화면에는
   * 영영 안 나온다 (alliance.json > boss.hp.tierNote).
   */
  async allianceBoss() {
    const mem = await oneByAccount('allyMembers', $sender.account);
    if (!mem) return null;
    let al = await $global.getCollectionItem('alliances', mem.allianceId);
    if (!al || !al.__id) return null;
    const wk = weekIdx(Date.now());
    if (al.bossWeek !== wk || !al.bossMax) {
      const rows = await qItems('allyMembers', {
        filters: [{ field: 'allianceId', operator: '==', value: mem.allianceId }],
        limit: MAX_MEMBERS,
      });
      const sumCp = rows.reduce((a, r) => a + (r.cp || 0), 0);
      const tier = al.bossTier || 1;      // 주가 바뀌어도 단계는 그대로 — HP 만 다시 찬다
      const max = Math.max(1, Math.round(sumCp * BOSS_HP_COEF * BOSS_TIERS[tier - 1]));
      al = { ...al, bossWeek: wk, bossTier: tier, bossMax: max, bossHp: max,
             weekly: al.bossWeek === wk ? al.weekly : 0 };
      await $global.updateCollectionItem('alliances', al);
    }
    const srv = await srvState();
    const used = srv.bossWeek === wk ? (srv.bossTries || 0) : 0;
    return { hp: al.bossHp, max: al.bossMax, tier: al.bossTier, triesLeft: BOSS_ATTEMPTS - used };
  }

  /**
   * 보스 딜 제출. **전투가 끝난 뒤 1회만** 부른다 (alliance.json > verse8.rateLimit -
   * 30명이 실시간으로 밀어 넣으면 초당 10회를 넘긴다).
   *
   * 딜량은 클라가 계산해서 보낸다. 1단계 통짜 저장과 같은 신뢰 모델이라 이게 상한이고,
   * 대신 **파티 CP 의 배수로 자른다**.
   *
   * 3.5 -> 7.5 (2026-08-31). 화면 전투를 붙이면서 시도딜이 추정치 cp x 1.723 에서
   * 실측 cp x 3.6 (측정 3.21~4.06) 으로 올랐다 — 3.5 를 그대로 두면 **정상 도전을
   * 거의 다 잘라먹는다**. 실측 평균의 약 2배로 두면 편차·패시브·장비는 다 통과하고
   * 조작만 걸린다 (옛 3.5/1.723 과 같은 여유 비율이다).
   */
  async allianceBossHit(damage, myCp) {
    const mem = await oneByAccount('allyMembers', $sender.account);
    if (!mem) return { ok: false, reason: 'none' };
    const wk = weekIdx(Date.now());
    const srv = await srvState();
    const used = srv.bossWeek === wk ? (srv.bossTries || 0) : 0;
    if (used >= BOSS_ATTEMPTS) return { ok: false, reason: 'no_tries' };
    if (typeof damage !== 'number' || !Number.isFinite(damage) || damage < 0) throw new Error('damage');

    const al = await $global.getCollectionItem('alliances', mem.allianceId);
    if (!al || !al.__id || al.bossWeek !== wk) return { ok: false, reason: 'closed' };
    // 죽어서 다음 개장을 기다리는 보스(bossMax 0 또는 HP 0)는 못 때린다.
    // killed 판정이 hp<=0 이라, 막지 않으면 시체를 때릴 때마다 "처치" 가 되어
    // 단계가 공짜로 오른다 — 테스트에서 실제로 tier 1 -> 5 로 뛰었다.
    // 클라는 allianceBoss() 를 먼저 불러 새 단계를 개장한 뒤 도전한다.
    if (!al.bossMax || (al.bossHp || 0) <= 0) return { ok: false, reason: 'closed' };
    const cap = Math.max(0, myCp | 0) * BOSS_DMG_CAP_PER_CP;
    const dmg = Math.min(damage, cap);
    const hp = Math.max(0, (al.bossHp || 0) - dmg);
    const killed = hp <= 0;
    const next = { ...al, bossHp: hp };
    if (killed) {
      // 잡으면 다음 단계가 바로 열린다. HP 는 다음 allianceBoss() 호출이 다시 잰다
      next.bossTier = Math.min(BOSS_TIERS.length, (al.bossTier || 1) + 1);
      next.bossMax = 0;
    }
    await $global.updateCollectionItem('alliances', next);
    await srvPatch({ bossWeek: wk, bossTries: used + 1 });
    await $global.addCollectionItem('allyBossLog', {
      allianceId: mem.allianceId, account: $sender.account,
      week: wk, tier: al.bossTier || 1, damage: Math.round(dmg), at: Date.now(),
    });
    await $global.updateCollectionItem('allyMembers',
      { ...mem, cp: Math.max(mem.cp || 0, myCp | 0) });
    return { ok: true, damage: Math.round(dmg), hp, killed, triesLeft: BOSS_ATTEMPTS - used - 1 };
  }

    // -- 친구 선물 ---------------------------------------------
  /**
   * 선물 보내기. **보내는 쪽은 아무 비용도 안 낸다** - 서로 보내면 서로 이득이라
   * 매일 누를 이유가 생긴다. 그래서 서버가 막아야 하는 것은 딱 둘이다:
   * 친구가 맞는가, 오늘 이미 보냈는가.
   *
   * 금액은 **받는 쪽이 정한다**. 방치 골드 공식이 받는 사람의 진행도에 물려 있어
   * (고정액은 후반에 휴지조각이다) 보내는 사람의 세이브로는 계산할 수 없다.
   * 그래서 이 행은 "누가 누구에게 오늘 보냈다" 는 사실만 담는다.
   */
  async friendGift(toAccount) {
    if (!toAccount || toAccount === $sender.account) throw new Error('target');
    const pair = await qItems('friends', {
      filters: [{ field: 'account', operator: '==', value: $sender.account },
                { field: 'friend', operator: '==', value: toAccount }],
      limit: 1,
    });
    if (!pair.length) return { ok: false, reason: 'not_friend' };
    const day = dayIdx(Date.now());

    // **오늘 누구에게 보냈나는 계정 상태에 적는다.**
    //
    // 예전에는 gifts 컬렉션을 (from, to, day) 로 뒤져서 중복을 걸렀다. 그런데
    // 필터가 셋이라 qItems 가 풀스캔 경로를 타고, 그 경로는 컬렉션을 최대
    // 500줄만 긁어 JS 로 거른다 — 행이 그 페이지 밖이면 중복을 못 찾는다.
    // 그래서 폰에서 보낸 뒤 PC 에서 또 보낼 수 있었다 (단장 지적 2026-08-28).
    // getMyState 는 이 계정을 직접 읽으므로 기기가 몇 대든 어긋나지 않고,
    // 500줄 스캔도 사라져 보내기가 빨라진다.
    const srv = await srvState();
    const sentTo = srv.giftDay === day ? (srv.giftTo || []) : [];
    if (sentTo.includes(toAccount)) return { ok: false, reason: 'already_sent' };

    await $global.addCollectionItem('gifts', {
      from: $sender.account, to: toAccount,
      fromNick: await nickOf($sender.account), day, at: Date.now(),
    });
    // 행을 넣은 **뒤에** 기록한다. 먼저 적고 넣기가 실패하면 상대 선물함에는
    // 아무것도 없는데 오늘은 이미 보낸 것이 된다
    await srvPatch({ giftDay: day, giftTo: [...sentTo, toAccount] });
    return { ok: true };
  }

  /**
   * 선물함. 오늘 내가 보낸 목록과 나에게 온 목록을 같이 준다 -
   * 화면이 [선물]/[받기] 두 버튼을 한 줄에 그리므로 한 번에 와야 한다.
   *
   * **이틀 지난 것은 읽으면서 지운다.** 안 받고 쌓이면 컬렉션이 개수로만 자라고,
   * 어제 선물을 오늘 받는 것은 어차피 규칙이 아니다 (하루 한 번이 리듬이다).
   */
  async friendGiftBox() {
    const day = dayIdx(Date.now());
    // 보낸 목록도 **계정 상태에서** 읽는다 (friendGift 주석). 컬렉션을 두 필터로
    // 뒤지면 풀스캔이라 늦고, 놓치면 화면의 [선물] 버튼이 도로 눌리는 상태가 된다.
    // 받은 목록은 to== 하나뿐이라 네이티브 필터가 그대로 먹는다
    const [srv, inbox] = await Promise.all([
      srvState(),
      qItems('gifts', {
        filters: [{ field: 'to', operator: '==', value: $sender.account }],
        limit: 60,
      }),
    ]);
    const fresh = [];
    for (const g of inbox) {
      if (g.day < day - 1) await $global.deleteCollectionItem('gifts', g.__id);
      else fresh.push(g);
    }
    // 보낸 사람 이름은 지금 프로필로 잇는다 — 굳은 값만 쓰면 개명이 선물함에만
    // 반영 안 돼 같은 사람이 친구 목록과 다른 이름으로 보인다
    const named = await relinkSenderNick(fresh, 'from', 'fromNick');
    return {
      sent: srv.giftDay === day ? (srv.giftTo || []) : [],
      inbox: named.map(g => ({ id: g.__id, from: g.from, fromNick: g.fromNick, day: g.day })),
    };
  }

  /** 수령 - 행을 지운다. 골드는 클라가 자기 진행도로 계산해 넣는다 */
  async friendGiftClaim(ids) {
    if (!Array.isArray(ids) || !ids.length) return { ok: true, n: 0 };
    let n = 0;
    for (const id of ids.slice(0, 60)) {
      const g = await $global.getCollectionItem('gifts', id);
      // 남의 선물함을 비우지 못하게 한다. id 만 알면 지울 수 있으면 안 된다
      if (g && g.to === $sender.account) {
        await $global.deleteCollectionItem('gifts', g.__id);
        n++;
      }
    }
    return { ok: true, n };
  }

  // -- 채팅 --------------------------------------------------
  /**
   * 보내기. scope 는 'world' 또는 'ally'.
   *
   * 컬렉션을 갈라 두는 이유는 **구독이 컬렉션 단위**이기 때문이다
   * (globalCollection 문서 > subscribeGlobalCollection). 한 컬렉션에 담고
   * allianceId 로 거르면 클라가 남의 연합 대화까지 전부 받아 놓고 버리게 된다.
   *
   * 도배는 **초당 한 줄**로 막는다. remoteFunction 자체가 유저당 초당 10회라
   * 그것만으로는 한 사람이 채팅방을 혼자 채울 수 있다.
   */
  async sendChat(scope, text) {
    const body = String(text == null ? '' : text).trim().slice(0, CHAT_MAX_LEN);
    if (!body) throw new Error('empty');
    const room = await chatRoomOf(scope);
    if (!room) return { ok: false, reason: 'no_room' };

    const now = Date.now();
    const srv = await srvState();
    if (srv.chatAt && now - srv.chatAt < CHAT_MIN_GAP_MS) {
      return { ok: false, reason: 'too_fast' };
    }
    await srvPatch({ chatAt: now });

    // 아바타를 그리려면 직군이 줄마다 있어야 한다. 프로필을 계정마다 다시
    // 조회하게 두면 채팅 40줄 = 조회 40번이다 — 보낼 때 한 번 굳혀 담는다.
    // 개명·전직이 지난 줄에 반영 안 되는 것은 채팅의 관행이다 (로그는 과거다)
    const me = await oneByAccount('profiles', $sender.account);
    const item = await $global.addCollectionItem(room, {
      account: $sender.account,
      // 프로필을 못 찾아도 **비워 두지 않는다.** 빈 이름은 보는 쪽에서 자동 닉으로
      // 대체되는데, 그러면 같은 사람이 채팅에서만 다른 이름으로 보인다.
      // nickOf 는 프로필이 있으면 그 이름을, 없으면 계정에서 만든 자동 닉을 준다
      nickname: (me && String(me.nickname || '').slice(0, 15)) || await nickOf($sender.account),
      capCls: me && ['warrior', 'archer', 'mage'].includes(me.capCls) ? me.capCls : 'warrior',
      text: body, at: now,
    });
    await pruneChat(room);
    return { ok: true, item };
  }

  /**
   * 최근 대화. 오래된 것이 위로 오게 뒤집어 준다 - 화면은 아래가 최신이다.
   *
   * **이름과 직군은 지금 프로필로 덮어 돌려준다** (2026-08-31). 줄에 굳혀
   * 담긴 값은 보낸 순간의 것이라, 그 사람이 개명·전직하면 지난 대화가 통째로
   * 옛 이름으로 남았다 — 내 줄만 클라가 덮고 있어서 남의 이름만 안 바뀌었다
   * (단장 지적 2026-08-31). 로그를 고쳐 쓰는 것이 아니라 **읽을 때** 잇는다.
   *
   * 프로필은 한 번만 받아 잇는다 (친구 목록과 같은 방식) — 줄마다 조회하면
   * 40줄 = 40번이다. 이 함수는 부팅과 방 전환에서만 불린다: 그 뒤의 새 줄은
   * 구독으로 오는데, sendChat 이 보낼 때 프로필에서 읽어 담으므로 이미 최신이다.
   */
  async getChat(scope, limit) {
    const room = await chatRoomOf(scope);
    if (!room) return [];
    const n = Math.min(CHAT_KEEP, Math.max(1, limit | 0 || 40));
    // 최신이 먼저 오게 받아서 뒤집는다 — 화면은 아래가 최신이다.
    // orderBy 를 못 믿는 이유는 sortedTop 설명 참고
    const rows = await sortedTop(room, {}, 'at', n);
    const profs = await qItems('profiles', { limit: 500 }).catch(() => []);
    const byAcc = new Map(profs.map(x => [x.account, x]));
    return rows.reverse().map(r => {
      const p2 = byAcc.get(r.account);
      if (!p2) return r;                      // 프로필을 아직 안 올린 계정 — 굳은 값 그대로
      const nick = String(p2.nickname || '').slice(0, 15);
      return {
        ...r,
        nickname: nick || r.nickname,
        capCls: ['warrior', 'archer', 'mage'].includes(p2.capCls) ? p2.capCls : r.capCls,
      };
    });
  }

  /**
   * 계정 하나의 공개 프로필. 채팅 줄을 눌렀을 때 뜨는 카드가 읽는다.
   * findProfiles 는 CP 대역 조회라 특정 계정을 집어 못 가져온다 — 그래서 따로 둔다.
   * 없으면 null — 프로필을 아직 안 올린 계정이다 (카드는 이름·직군만 그린다).
   */
  async getProfile(account) {
    if (!account || typeof account !== 'string') return null;
    return oneByAccount('profiles', account);
  }

  /**
   * 구독할 컬렉션 이름. 클라가 `subscribeGlobalCollection` 에 넣는다.
   * 이름을 클라가 조립하게 두지 않는다 - 규칙이 두 곳에 생기면 반드시 어긋난다.
   */
  async chatRooms() {
    const mem = await oneByAccount('allyMembers', $sender.account);
    return { world: CHAT_WORLD, ally: mem ? CHAT_ALLY + mem.allianceId : null };
  }

  /** 이번 주 딜 순위 - 누가 얼마나 쳤나. 협동은 보여야 협동이다 */
  async allianceBossLog() {
    const mem = await oneByAccount('allyMembers', $sender.account);
    if (!mem) return [];
    const rows = await qItems('allyBossLog', {
      filters: [{ field: 'allianceId', operator: '==', value: mem.allianceId },
                { field: 'week', operator: '==', value: weekIdx(Date.now()) }],
      limit: MAX_MEMBERS * BOSS_ATTEMPTS,
    });
    const byAcc = new Map();
    for (const r of rows) byAcc.set(r.account, (byAcc.get(r.account) || 0) + r.damage);
    // 이름은 **프로필이 먼저**다 (2026-08-31). 딜 로그마다 닉네임을 복사해 두면
    // leaf 수만 늘어나고, 단원 행의 닉네임은 가입 시점에 굳은 값이라 개명이
    // 반영되지 않는다 — allianceMembers 가 쓰는 것과 같은 순서로 맞춘다
    const members = await qItems('allyMembers', {
      filters: [{ field: 'allianceId', operator: '==', value: mem.allianceId }],
      limit: MAX_MEMBERS,
    });
    const profs = await qItems('profiles', { limit: 500 }).catch(() => []);
    const nickByAcc = new Map(profs.map(x => [x.account, String(x.nickname || '').slice(0, 15)]));
    const nameOf = new Map(members.map(m => [m.account, nickByAcc.get(m.account) || m.nickname]));
    return [...byAcc]
      .map(pair => ({ account: pair[0], nickname: nameOf.get(pair[0]) || '', damage: pair[1] }))
      .sort((a, b) => b.damage - a.damage);
  }
}

// -- 세이브 안의 재화를 서버가 직접 만진다 --------------------
//
// 1단계는 통짜 저장이라 재화의 진실도 세이브 안에 있다. 연합 창설비·기부처럼
// **서버가 깎아야 하는** 것만 여기를 지난다 - 클라가 깎고 결과만 보내면
// 0원 기부가 된다. 개인 진행(소환·강화)은 여전히 클라 몫이다.
//
// 주의: 클라의 다음 saveState 가 이 변경을 덮을 수 있다. 그래서 서버가 깎은
// 직후 클라는 loadState 로 받아 가야 한다 (core/cloudsave.js 의 규칙과 같다).
async function spendDia(account, cost) {
  if (!cost) return true;
  const cur = await $global.getUserState(account);
  const s = cur && cur.save && cur.save.s;
  if (!s || (s.dia || 0) < cost) return false;
  s.dia -= cost;
  await $global.updateUserState(account, { save: { ...cur.save, s, savedAt: Date.now() } });
  return true;
}
async function spendGold(account, cost) {
  if (!cost) return true;
  const cur = await $global.getUserState(account);
  const s = cur && cur.save && cur.save.s;
  if (!s || (s.gold || 0) < cost) return false;
  s.gold -= cost;
  await $global.updateUserState(account, { save: { ...cur.save, s, savedAt: Date.now() } });
  return true;
}

/**
 * VXShop 결제 완료. 플랫폼이 부른다 - 클라는 이 경로에 못 끼어든다.
 *
 * **멱등이어야 한다.** 같은 purchaseId 가 두 번 오면(재시도·중복 웹훅) 두 번
 * 지급된다. 지급한 id 를 계정 상태에 남겨 두 번째는 무시한다.
 * 목록이 무한정 자라지 않도록 최근 50건만 남긴다 - Firestore 는 개수로도 죽는다
 * (파일 상단 MAX_LEAVES 참조).
 */
async function $onItemPurchased(data) {
  const account = data && data.account;
  const purchaseId = data && data.purchaseId;
  const productId = data && data.productId;
  if (!account || !purchaseId || !productId) return;
  const p = PRODUCTS[productId];
  if (!p) return;                                  // 우리 상품이 아니다

  const cur = await $global.getUserState(account);
  const srv = (cur && cur.srv) || {};
  const done = srv.purchases || [];
  if (done.includes(purchaseId)) return;           // 이미 지급했다
  if (p.once && (srv.onceBought || []).includes(productId)) return;

  const s = cur && cur.save && cur.save.s;
  if (!s) return;                                  // 세이브가 없다 - 접속 전이다

  // ── 이중 지급 방어 (2026-08-26) ──────────────────────────
  // **지금은 클라가 지급한다** (main.js > onVxPurchased). 세이브가 클라 판정
  // 통짜 저장이라(1단계) 서버가 여기서 같은 상품을 또 얹으면, 클라 지급분과
  // 합쳐져 두 배가 되거나 - 클라가 통짜로 덮어써 서버 지급분이 사라지거나 -
  // 둘 중 하나다. 어느 쪽이든 사고고, 어느 쪽이 이길지는 저장 순서가 정한다.
  //
  // 그래서 **접속 중인 계정에는 서버가 지급하지 않고 영수증만 남긴다.**
  // 클라가 못 받은 경우(결제 직후 앱이 죽었다·다른 기기다)를 위해 미지급
  // 목록에 쌓아 두고, 클라가 다음 로드에서 그것을 받아 간다.
  //
  // 2단계(서버 판정)로 옮기면 이 분기를 지우고 위의 지급 코드만 남긴다 -
  // 그때는 클라의 onVxPurchased 지급을 걷어내는 것이 같은 작업의 반대쪽이다.
  const pending = [...(srv.pendingGrants || []), { purchaseId, productId, at: Date.now() }].slice(-20);
  await $global.updateUserState(account, {
    srv: {
      ...srv,
      pendingGrants: pending,
      purchases: [...done, purchaseId].slice(-50),
      onceBought: p.once ? [...(srv.onceBought || []), productId] : (srv.onceBought || []),
    },
  });
  return;

  /* eslint-disable no-unreachable -- 2단계에서 되살릴 지급 코드 */
  const n = Math.max(1, (data.quantity | 0) || 1);
  if (p.dia) s.dia = (s.dia || 0) + p.dia * n;
  if (p.mercTicket) s.mercTicket = (s.mercTicket || 0) + p.mercTicket * n;
  if (p.skillTicket) s.skillTicket = (s.skillTicket || 0) + p.skillTicket * n;
  if (p.eqTicket) s.eqTicket = (s.eqTicket || 0) + p.eqTicket * n;
  if (p.hourglass) s.hourglass = (s.hourglass || 0) + p.hourglass * n;
  // 해금형 상품 — 수량과 무관하게 플래그다
  if (p.unlock === 'premium') { s.speed3 = true; s.adFree = true; }
  if (p.unlock === 'pass') { s.pass = { ...(s.pass || {}), bought: true }; }

  await $global.updateUserState(account, {
    save: { ...cur.save, s, savedAt: Date.now() },
    srv: {
      ...srv,
      purchases: [...done, purchaseId].slice(-50),
      onceBought: p.once ? [...(srv.onceBought || []), productId] : (srv.onceBought || []),
    },
  });
  /* eslint-enable no-unreachable */
}
