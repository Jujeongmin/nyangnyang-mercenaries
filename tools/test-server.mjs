// server.js 헤드리스 점검 — $global/$sender 를 메모리로 흉내 내고 시나리오를 돌린다.
//   node server/test-server.mjs (server.js 는 저장소 루트)
// Verse8 에 올리기 전에 로직 버그를 잡는 용도다. 컬렉션 흉내는 문서에서 확인한
// 동작만 구현한다: __id 자동 부여, filters(==/>/>=/<=), orderBy, limit,
// getCollectionItem 은 없으면 {} 를 돌려준다.

import { readFileSync } from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'server.js'), 'utf8');

// ── $global 흉내 ─────────────────────────────────────────────
let seq = 0;
const cols = new Map();          // name -> Map(__id -> item)
const users = new Map();         // account -> state

const colOf = n => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
const OPS = {
  '==': (a, b) => a === b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b,
};

const $global = {
  async getMyState() { return users.get(ctx.account) ?? null; },
  async updateMyState(patch) {
    users.set(ctx.account, { ...(users.get(ctx.account) || {}), ...patch });
  },
  async getUserState(a) { return users.get(a) ?? null; },
  async updateUserState(a, patch) {
    users.set(a, { ...(users.get(a) || {}), ...patch });
  },
  async addCollectionItem(n, item) {
    const it = { ...item, __id: 'i' + (++seq) };
    colOf(n).set(it.__id, it);
    return it;
  },
  async getCollectionItem(n, id) { return colOf(n).get(id) ?? {}; },
  async updateCollectionItem(n, item) {
    if (!item.__id || !colOf(n).has(item.__id)) throw new Error('no such item');
    colOf(n).set(item.__id, { ...item });
    return item;
  },
  async deleteCollectionItem(n, id) {
    if (id == null) throw new Error('deleteCollectionItem: id is ' + id);   // 실서버도 여기서 죽는다고 가정
    colOf(n).delete(id);
  },
  async deleteCollection(n) { cols.delete(n); },
  async getCollectionItems(n, opt = {}) {
    let rows = [...colOf(n).values()];
    for (const f of opt.filters || []) rows = rows.filter(r => OPS[f.operator](r[f.field], f.value));
    for (const o of [...(opt.orderBy || [])].reverse()) {
      rows.sort((a, b) => (a[o.field] < b[o.field] ? -1 : a[o.field] > b[o.field] ? 1 : 0)
        * (o.direction === 'desc' ? -1 : 1));
    }
    if (opt.limit) rows = rows.slice(0, opt.limit);
    return rows.map(r => ({ ...r }));
  },
  async countCollectionItems(n, opt = {}) {
    let rows = [...colOf(n).values()];
    for (const f of opt.filters || []) rows = rows.filter(r => OPS[f.operator](r[f.field], f.value));
    return rows.length;
  },
};

const ctx = { account: 'A' };
const sandbox = { $global, $sender: { get account() { return ctx.account; } }, Date, Math, JSON, console };
vm.createContext(sandbox);
vm.runInContext(src + '\n;globalThis.__S = new Server(); globalThis.__P = $onItemPurchased;', sandbox);
const S = sandbox.__S;
const buy = sandbox.__P;

const as = a => { ctx.account = a; return S; };

// ── 검사 도구 ────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
const seed = (a, s = {}) => users.set(a, { save: { v: 1, s: { dia: 5000, gold: 9e6, maxStage: 50, ...s }, savedAt: 1 } });

// ── 시나리오 ─────────────────────────────────────────────────
console.log('[세이브]');
{
  seed('A');
  const r = await as('A').saveState({ v: 1, s: { dia: 10, gold: 5, maxStage: 60 } });
  ok(r.ok === true, 'saveState 정상 저장');
  const back = await as('A').loadState();
  ok(back?.s?.maxStage === 60, 'loadState 왕복');
  const reg = await as('A').saveState({ v: 1, s: { dia: 0, gold: 0, maxStage: 1 } });
  ok(reg.ok === false && reg.reason === 'regression', '진행 후퇴 거부');
  const forced = await as('A').saveState({ v: 1, s: { dia: 0, gold: 0, maxStage: 1 } }, true);
  ok(forced.ok === true, 'force 로 덮어쓰기');
  let threw = null;
  try { await as('A').saveState({ v: 1, s: { dia: -5 } }); } catch (e) { threw = e.message; }
  ok(threw === 'bad_currency:dia', '음수 재화 거부');
}

console.log('[랭킹 best-only]');
{
  seed('A'); seed('B');
  await as('A').submitCp(100, '냥A');
  await as('A').submitCp(50, '냥A');          // 더 낮다 — 무시돼야
  await as('A').submitCp(200, '냥A');         // 갱신 — 옛 행 삭제
  await as('B').submitCp(150, '냥B');
  const rows = await as('A').getTopRankings(20);
  ok(rows.length === 2, '계정당 1행', 'got ' + rows.length);
  ok(rows[0].score === 200 && rows[1].score === 150, '내림차순 + best 유지');
  const mine = await as('B').getMyBestRank();
  ok(mine.rank === 2, '내 등수', 'rank=' + mine.rank);
}

console.log('[프로필·표본]');
{
  await as('A').submitProfile({ nickname: '냥A', cp: 1000, stage: 60, capCls: 'mage',
    party: [{ id: 'SR-01', grade: 'SR', level: 3 }], arenaScore: 10 });
  await as('A').submitProfile({ nickname: '냥A2', cp: 1100, stage: 61, capCls: 'mage', party: [] });
  const n = await $global.countCollectionItems('profiles',
    { filters: [{ field: 'account', operator: '==', value: 'A' }] });
  ok(n === 1, '프로필 재제출 시 1행 유지', 'n=' + n);
  await as('B').submitProfile({ nickname: '냥B', cp: 900, stage: 40, capCls: 'archer', party: [] });
  const foes = await as('A').findProfiles({ minCp: 500, maxCp: 2000 });
  ok(foes.length === 1 && foes[0].account === 'B', 'findProfiles 본인 제외');
}

console.log('[친구]');
{
  const r1 = await as('A').friendRequest('B');
  ok(r1.ok === true, '신청');
  const dup = await as('A').friendRequest('B');
  ok(dup.ok === false && dup.reason === 'already_sent', '중복 신청 거부');
  const reqs = await as('B').friendRequests();
  ok(reqs.length === 1 && reqs[0].from === 'A', '받은 신청 조회');
  const acc = await as('B').friendRespond(reqs[0].__id, true);
  ok(acc.accepted === true, '수락');
  const again = await as('A').friendRequest('B');
  ok(again.ok === false && again.reason === 'already_friend', '이미 친구 거부');
  const listA = await as('A').friendList();
  const listB = await as('B').friendList();
  ok(listA.length === 1 && listB.length === 1, '양방향 목록');
  ok(listA[0].nickname === '냥B', '목록이 프로필을 되읽음', JSON.stringify(listA[0].nickname));
}

console.log('[선물]');
{
  const g1 = await as('A').friendGift('B');
  ok(g1.ok === true, '보내기');
  const g2 = await as('A').friendGift('B');
  ok(g2.ok === false && g2.reason === 'already_sent', '하루 한 번');
  const g3 = await as('A').friendGift('C');
  ok(g3.ok === false && g3.reason === 'not_friend', '친구 아니면 거부');
  const boxB = await as('B').friendGiftBox();
  ok(boxB.inbox.length === 1 && boxB.inbox[0].from === 'A', '받는 쪽 선물함');
  const boxA = await as('A').friendGiftBox();
  ok(boxA.sent.includes('B'), '보낸 목록');
  // 남의 선물을 내가 못 지운다
  const steal = await as('A').friendGiftClaim([boxB.inbox[0].id]);
  ok(steal.n === 0, '남의 선물 수령 차단');
  const claim = await as('B').friendGiftClaim([boxB.inbox[0].id]);
  ok(claim.n === 1, '수령');
  const boxB2 = await as('B').friendGiftBox();
  ok(boxB2.inbox.length === 0, '수령 후 비워짐');
}

console.log('[연합]');
{
  seed('A', { maxStage: 50 }); seed('B', { maxStage: 50 }); seed('C', { maxStage: 10 });
  const low = await as('C').allianceCreate('저렙연합', 10, 100);
  ok(low.ok === false && low.reason === 'stage', '스테이지 미달 거부');
  const c1 = await as('A').allianceCreate('츄르원정대', 50, 100000);
  ok(c1.ok === true, '창설');
  ok(users.get('A').save.s.dia === 4000, '창설비 서버 차감', 'dia=' + users.get('A').save.s.dia);
  const dupName = await as('B').allianceCreate('츄르원정대', 50, 900);
  ok(dupName.ok === false && dupName.reason === 'name_taken', '이름 중복 거부');
  ok(users.get('B').save.s.dia === 5000, '중복 실패 시 다이아 안 깎임', 'dia=' + users.get('B').save.s.dia);
  const alId = c1.alliance.__id;
  const j1 = await as('B').allianceJoin(alId, 50, 90000);
  ok(j1.ok === true, '가입');
  const j2 = await as('B').allianceJoin(alId, 50, 90000);
  ok(j2.ok === false && j2.reason === 'already', '중복 가입 거부');
  const my = await as('B').allianceMy();
  ok(my.members.length === 2, '단원 2명');
  ok(my.members.every(m => typeof m.nickname === 'string'), '단원 행에 닉네임');
}

console.log('[기부]');
{
  const wrong = await as('A').allianceDonate(2);
  ok(wrong.ok === false && wrong.reason === 'order', '순서 건너뛰기 거부');
  const d1 = await as('A').allianceDonate(1);
  ok(d1.ok === true && d1.coin === 5, '무료 기부');
  const goldBefore = users.get('A').save.s.gold;
  const d2 = await as('A').allianceDonate(2);
  ok(d2.ok === true && users.get('A').save.s.gold === goldBefore - 2000000, '골드 기부 서버 차감');
  await as('A').allianceDonate(3);
  const diaBefore = users.get('A').save.s.dia;
  const d4 = await as('A').allianceDonate(4);
  ok(d4.ok === true && users.get('A').save.s.dia === diaBefore - 100, '다이아 기부 서버 차감');
  await as('A').allianceDonate(5);
  const d6 = await as('A').allianceDonate(1);
  ok(d6.ok === false && d6.reason === 'daily', '하루 5회 상한');
  const my = await as('A').allianceMy();
  ok(my.alliance.xp === 95, '연합 XP 누적 5+10+15+25+40', 'xp=' + my.alliance.xp);
  // 무일푼 계정의 골드 기부
  users.get('B').save.s.gold = 0;
  await as('B').allianceDonate(1);
  const poor = await as('B').allianceDonate(2);
  ok(poor.ok === false && poor.reason === 'gold', '잔액 부족 거부');
}

console.log('[연합 보스]');
{
  const st = await as('A').allianceBoss();
  ok(st && st.tier === 1 && st.hp === st.max && st.max > 0, '보스 개장', JSON.stringify(st));
  const myCp = 1000;
  const h1 = await as('A').allianceBossHit(myCp * 1.7, myCp);
  ok(h1.ok === true && h1.damage === Math.round(myCp * 1.7), '딜 제출');
  const h2 = await as('A').allianceBossHit(1e9, myCp);          // 조작 딜
  ok(h2.ok === true && h2.damage <= myCp * 3.5, '딜 상한 CP x 3.5', 'dmg=' + h2.damage);
  const h3 = await as('A').allianceBossHit(10, myCp);
  ok(h3.ok === true && h3.triesLeft === 0, '3회 소진');
  const h4 = await as('A').allianceBossHit(10, myCp);
  ok(h4.ok === false && h4.reason === 'no_tries', '4번째 거부');
  const log = await as('A').allianceBossLog();
  ok(log.length === 1 && log[0].damage === h1.damage + h2.damage + h3.damage, '딜 합산 로그');
  ok(typeof log[0].nickname === 'string', '로그에 닉네임');
}

console.log('[보스 처치·단계 상승]');
{
  // 죽은 보스 재타격 방어 — B 가 죽인 **뒤에** 또 치면 closed 여야 한다 (아래에서 확인)
  // B 가 남은 HP 를 다 깎는다 — killed + 다음 단계
  const st = await as('B').allianceBoss();
  users.get('B').save.s.gold = 9e6;
  const big = Math.ceil(st.hp / 3.5) + 1;         // cap 을 통과할 만큼의 CP 로
  const kill = await as('B').allianceBossHit(st.hp, big);
  ok(kill.ok === true && kill.killed === true, '처치');
  const corpse = await as('B').allianceBossHit(100, big);
  ok(corpse.ok === false && corpse.reason === 'closed', '죽은 보스 재타격 거부');
  const st2 = await as('B').allianceBoss();
  ok(st2.tier === 2 && st2.hp === st2.max && st2.max > 0, '다음 단계 개장', JSON.stringify(st2));
}

console.log('[탈퇴·승계]');
{
  const leave = await as('A').allianceLeave();   // A 는 단장이다
  ok(leave.ok === true, '단장 탈퇴');
  const myB = await as('B').allianceMy();
  ok(myB.alliance.leader === 'B', '단장 승계', 'leader=' + myB.alliance.leader);
  ok(myB.me.role === 'leader', '역할 갱신');
  const cd = await as('A').allianceJoin(myB.alliance.__id, 50, 1000);
  ok(cd.ok === false && cd.reason === 'cooldown', '재가입 쿨다운');
  await as('B').allianceLeave();                 // 마지막 한 명
  const gone = await $global.countCollectionItems('alliances', {});
  ok(gone === 0, '빈 연합 삭제', 'n=' + gone);
}

console.log('[채팅]');
{
  seed('D', { maxStage: 50 });
  const c1 = await as('D').sendChat('world', '  안녕하세요  ');
  ok(c1.ok === true && c1.item.text === '안녕하세요', '보내기 + trim');
  const fast = await as('D').sendChat('world', '연타');
  ok(fast.ok === false && fast.reason === 'too_fast', '초당 1줄 제한');
  const noAlly = await as('D').sendChat('ally', '연합 없음');
  ok(noAlly.ok === false && noAlly.reason === 'no_room', '무소속 연합 채팅 거부');
  const rooms = await as('D').chatRooms();
  ok(rooms.world === 'chatWorld' && rooms.ally === null, '방 이름');
  const rows = await as('D').getChat('world');
  ok(rows.length === 1 && rows[0].text === '안녕하세요', '조회');
  let threw = null;
  try { await as('D').sendChat('world', '   '); } catch (e) { threw = e.message; }
  ok(threw === 'empty', '빈 글 거부');
  // 프로필이 있는 계정의 줄에는 직군·이름이 굳어 담긴다
  await as('D').submitProfile({ nickname: '냥D', cp: 10, stage: 1, capCls: 'mage', party: [] });
  await new Promise(r => setTimeout(r, 1100));       // 초당 1줄 제한을 넘긴다
  const c2 = await as('D').sendChat('world', '프로필 갖고 왔다');
  ok(c2.item.nickname === '냥D' && c2.item.capCls === 'mage', '줄에 닉네임·직군');
  const prof = await as('A').getProfile('D');
  ok(prof && prof.nickname === '냥D', 'getProfile 조회');
  const noProf = await as('A').getProfile('GHOST');
  ok(noProf === null, '없는 프로필은 null');
}

console.log('[결제 멱등]');
{
  seed('E');
  await buy({ account: 'E', purchaseId: 'pu1', productId: 'pack_s', quantity: 1 });
  ok(users.get('E').save.s.dia === 5000 + 8000, '지급');
  await buy({ account: 'E', purchaseId: 'pu1', productId: 'pack_s', quantity: 1 });
  ok(users.get('E').save.s.dia === 13000, '같은 purchaseId 재지급 안 됨');
  await buy({ account: 'E', purchaseId: 'pu2', productId: 'first_buy' });
  await buy({ account: 'E', purchaseId: 'pu3', productId: 'first_buy' });
  ok(users.get('E').save.s.dia === 13000 + 3000, 'once 상품 1회만');
  await buy({ account: 'E', purchaseId: 'pu4', productId: 'speed3_unlock' });
  ok(users.get('E').save.s.speed3 === true, 'speed3 해금');
  await buy({ account: 'E', purchaseId: 'pu5', productId: 'not_ours' });
  ok(users.get('E').save.s.dia === 16000, '모르는 상품 무시');
}

console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
