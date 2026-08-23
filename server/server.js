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

const SAVE_VERSION = 1;
const MAX_BYTES = 200 * 1024;
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

function validate(payload) {
  if (!payload || payload.v !== SAVE_VERSION || typeof payload.s !== 'object') {
    throw new Error('bad_format');
  }
  const bytes = JSON.stringify(payload).length;
  if (bytes > MAX_BYTES) throw new Error('too_big:' + bytes);
  const s = payload.s;
  for (const f of CURRENCY_FIELDS) {
    if (typeof s[f] === 'number' && (s[f] < 0 || !Number.isFinite(s[f]))) {
      throw new Error('bad_currency:' + f);
    }
  }
  return payload;
}

class Server {
  /** 세이브 저장. force 는 진행 후퇴 가드를 넘을 때만 — 클라가 유저에게
   *  "서버 저장이 더 앞서 있다. 정말 덮어쓰나?" 를 물은 뒤에 준다. */
  async saveState(payload, force) {
    validate(payload);
    const cur = await $global.getMyState();
    if (cur && cur.save && !force) {
      const oldScore = progressScore(cur.save.s);
      const newScore = progressScore(payload.s);
      if (newScore < oldScore * 0.6) {
        return { ok: false, reason: 'regression', serverScore: oldScore, clientScore: newScore };
      }
    }
    await $global.updateMyState({
      save: { v: payload.v, s: payload.s, savedAt: Date.now() },   // ★ 서버 시각
    });
    return { ok: true, savedAt: Date.now() };
  }

  /** 세이브 복원. 없으면 null — 신규 계정이다. */
  async loadState() {
    const cur = await $global.getMyState();
    return cur && cur.save ? cur.save : null;
  }

  /** 랭킹 제출 (best-only). net/verse8.js SERVER_REFERENCE 의 패턴 그대로. */
  async submitCp(score, nickname) {
    if (typeof score !== 'number' || score < 0 || !Number.isFinite(score)) throw new Error('score');
    if (!nickname || nickname.length < 1 || nickname.length > 15) throw new Error('nickname');
    const mine = await $global.getCollectionItems('rankings', {
      filters: [{ field: 'account', operator: '==', value: $sender.account }],
    });
    for (const it of mine) {
      if (it.score >= score) return it;
      await $global.deleteCollectionItem('rankings', it.id);
    }
    return $global.addCollectionItem('rankings', {
      account: $sender.account, score, nickname, createdAt: Date.now(),
    });
  }
}
