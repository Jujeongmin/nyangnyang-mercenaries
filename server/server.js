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
      party,
      title: String(p.title || '').slice(0, 24),
      frame: String(p.frame || '').slice(0, 24),
      wing: String(p.wing || '').slice(0, 24),
      arenaScore: Math.max(0, p.arenaScore | 0),
      updatedAt: Date.now(),
    };
    const mine = await $global.getCollectionItems('profiles', {
      filters: [{ field: 'account', operator: '==', value: $sender.account }],
    });
    for (const it of mine) await $global.deleteCollectionItem('profiles', it.id);
    return $global.addCollectionItem('profiles', item);
  }

  /**
   * 상대 후보. 아레나는 내 전투력 주변에서, 친구 찾기는 아무나 뽑는다.
   * 실매칭이 아니라 **표본**이다 — 정교한 매칭은 서버 부하가 커서 나중에.
   */
  async findProfiles({ minCp = 0, maxCp = Number.MAX_SAFE_INTEGER, limit = 12 } = {}) {
    const rows = await $global.getCollectionItems('profiles', {
      filters: [
        { field: 'cp', operator: '>=', value: Math.max(0, minCp | 0) },
        { field: 'cp', operator: '<=', value: maxCp },
      ],
      limit: Math.min(50, Math.max(1, limit | 0)),
    });
    // 본인은 뺀다 — 자기 자신과 싸우거나 친구 신청하게 되면 안 된다
    return rows.filter(r => r.account !== $sender.account);
  }
}
