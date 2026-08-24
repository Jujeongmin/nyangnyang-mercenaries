// 랭킹 · 설정 — 전체 화면.
//
// ranking.json > ui.defaultTab: "score"
//   "시즌 보상이 걸린 유일한 보드. 경쟁 동기가 가장 강하다."
// ranking.json > ui.seasonTimerReason:
//   "'지금 47위, 이대로면 훈장 6000' 이 보이면 순위를 올릴 이유가 즉시 생긴다."
//
// 실제 순위는 Verse8 leaderboard 가 준다 (rank_stage / rank_power / rank_score_s{N}).
// 여기 목록은 화면 검증용 더미다. antiCheat 원칙상 점수는 전부 서버가 산출한다.

import { cpNum, num } from '../core/fmt.js';
import { LANGS } from '../core/i18n.js';


const NAMES = ['냥냥단장', '불꽃여우', '별빛기사', '해태단', '구미호', '판다현자', '백호',
  '심연상어', '봉황', '흑기린', '초코냥', '방패병', '숲사슴', '펭귄대장', '수달'];

// display.showProfile: ["칭호","프로필 테두리","대표 용병 썸네일"]
// 상위권일수록 상위 등급 용병을 대표로 걸고 있게 만든다 — 순위표가 곧 목표가 된다.
const FEATURED = ['LR-01', 'UR-02', 'UR-01', 'UR-03', 'LR-02', 'SSR-02', 'SSR-03',
  'SSR-05', 'SSR-01', 'SSR-04', 'SR-01', 'R-02', 'SR-06', 'SR-03', 'SR-04'];

export class RankScreen {
  constructor(root, api) {
    this.api = api;
    this.tab = 'score';                 // ui.defaultTab
    this.el = document.createElement('div');
    this.el.id = 'rank';
    this.el.className = 'fullscr';
    this.el.innerHTML = `
      <div class="sh-head">
        <button class="sh-back">‹</button>
        <span class="sh-title">랭킹</span>
      </div>
      <div class="sh-tabs" id="rkTabs"></div>
      <div class="sh-body" id="rkBody"></div>
      <div id="rkMine"></div>`;
    root.appendChild(this.el);
    this.el.querySelector('.sh-back').addEventListener('click', () => this.close());
  }

  open() { this.el.classList.add('show'); this.render(); }
  close() { this.el.classList.remove('show'); }

  myScore(board) {
    const S = this.api.state;
    return board === 'stage' ? S.maxStage
      : board === 'power' ? Math.round(this.api.cp())
      : S.arenaScore;
  }

  /**
   * 내 점수 주변으로 더미 순위를 만든다.
   * 실제 데이터는 getTopRankings() — **인자 없이 상위 20명 고정**이다.
   * 100명을 원하면 $global.getCollectionItems('rankings', {orderBy, limit:100}) 로 직접 조회한다.
   */
  rows(board) {
    const mine = this.myScore(board);
    const out = [];
    for (let i = 0; i < 20; i++) {
      const f = board === 'stage' ? 1 + (19 - i) * 0.06 : 1 + (19 - i) * 0.22;
      const P = this.api.data.profile;
      // 상위권일수록 높은 등급 칭호·테두리를 건다
      const tIdx = Math.min(P.titles.list.length - 1, Math.floor(i / 2) + (i < 3 ? 12 : 0));
      const fIdx = Math.min(P.profileFrame.unlocks.length - 1, 3 - Math.floor(i / 6));
      out.push({
        rank: i + 1,
        name: NAMES[i % NAMES.length] + (i > 14 ? i : ''),
        merc: FEATURED[i % FEATURED.length],
        title: P.titles.list[tIdx]?.nameKo || '',
        frame: P.profileFrame.unlocks[Math.max(0, fIdx)]?.color || '#9E9E9E',
        score: Math.max(1, Math.round(mine * f)),
      });
    }
    return out;
  }

  render() {
    const D = this.api.data;
    const boards = D.ranking.boards.map(b => ({ id: b.id, nameKo: b.nameKo }));
    this.el.querySelector('#rkTabs').innerHTML = boards.map(b =>
      `<button data-t="${b.id}" class="${b.id === this.tab ? 'on' : ''}">${b.nameKo}</button>`).join('');
    this.el.querySelectorAll('#rkTabs button').forEach(x =>
      x.addEventListener('click', () => { this.tab = x.dataset.t; this.render(); }));

    // 전투력 보드만 k/m 표기 — 자릿수가 커서 만/억 보다 한눈에 읽힌다
    // 오른쪽 숫자가 무엇인지 값 옆에 붙인다 — "St 12" 는 무슨 단위인지 안 읽힌다
    const fmt = v => this.tab === 'stage' ? `${num(v)}<i>스테이지</i>`
      : this.tab === 'power' ? cpNum(v)
      : `${num(v)}<i>점</i>`;
    const rows = this.rows(this.tab);
    const myRank = 47;                  // 실제로는 getMyBestRank()

    let head = '';
    if (this.tab === 'score') {
      // 시즌 타이머 + 내 순위의 예상 보상 — ui.seasonTimerReason
      const t = D.ranking.rankRewards.tiers.find(x => inRank(x.rank, myRank))
        || D.ranking.rankRewards.tiers[D.ranking.rankRewards.tiers.length - 1];
      head = `<div class="rk-season">
        <div class="rk-srow"><b>시즌 1</b><span>남은 시간 6일 04:12</span></div>
        <div class="rk-pred">지금 <b>${myRank}위</b> · 이대로면
          훈장 <b>${num(t.medals)}</b> · 다이아 <b>${num(t.diamond)}</b></div>
      </div>`;
    } else if (this.tab === 'power') {
      head = `<div class="sh-note" style="margin:0 0 10px">
        서버가 유저 state 로 CP 를 재계산한다. 클라 전송값은 신뢰하지 않는다.
        제출은 debounce 60초 + 최소 변화율 0.5% + 일 30회로 제한된다.</div>`;
    } else {
      head = `<div class="sh-note" style="margin:0 0 10px">
        ${D.ranking.boards[0].tiebreak} — CP 가 낮아도 빨리 민 유저가 위로 온다.</div>`;
    }

    this.el.querySelector('#rkBody').innerHTML = head + rows.map(r => `
      <div class="rk-row${r.rank <= 3 ? ' top' : ''}">
        <span class="rk-n rk-${r.rank <= 3 ? r.rank : 'x'}">${r.rank}</span>
        <span class="rk-ava" style="border-color:${r.frame}">
          <img src="/assets/char/${r.merc}.png" alt="">
        </span>
        <span class="rk-who">
          <b>${r.name}</b>
          ${r.title ? `<i>${r.title}</i>` : ''}
        </span>
        <span class="rk-sc">${fmt(r.score)}</span>
      </div>`).join('');

    // 내 순위는 하단 고정 — display.myRankAlwaysVisible
    const S = this.api.state, P = D.profile;
    const myMerc = S.profile?.featuredMercId
      || S.codex.mercenary[S.codex.mercenary.length - 1] || null;
    const myFrame = P.profileFrame.unlocks.find(f => f.id === (S.profile?.frameId || 'pf_default'));
    const myTitle = P.titles.list.find(t => t.id === S.profile?.titleId);
    this.el.querySelector('#rkMine').innerHTML = `
      <div class="rk-row mine">
        <span class="rk-n">${myRank}</span>
        <span class="rk-ava" style="border-color:${myFrame?.color || '#9E9E9E'}">
          <img src="${myMerc ? `/assets/char/${myMerc}.png`
                             : '/assets/captain/captain_warrior.png'}" alt="">
        </span>
        <span class="rk-who">
          <b>${S.nickname || '단장'}</b>
          ${myTitle ? `<i>${myTitle.nameKo}</i>` : ''}
        </span>
        <span class="rk-sc">${fmt(this.myScore(this.tab))}</span>
      </div>`;
  }
}

function inRank(spec, n) {
  if (spec.includes('-')) {
    const [a, b] = spec.split('-').map(x => parseInt(x.replace(/\D/g, ''), 10));
    return n >= a && n <= b;
  }
  return n === parseInt(spec, 10);
}

// ─────────────────────────────────────────────

export class SettingsScreen {
  constructor(root, api) {
    this.api = api;
    this.el = document.createElement('div');
    this.el.id = 'settings';
    this.el.className = 'fullscr';
    this.el.innerHTML = `
      <div class="sh-head">
        <button class="sh-back">‹</button>
        <span class="sh-title">설정</span>
      </div>
      <div class="sh-body" id="stBody"></div>`;
    root.appendChild(this.el);
    this.el.querySelector('.sh-back').addEventListener('click', () => this.close());
  }

  open() { this.el.classList.add('show'); this.render(); }
  close() { this.el.classList.remove('show'); }

  render() {
    const S = this.api.state, D = this.api.data;
    const seg = (key, opts, cur) => `<div class="st-seg" data-k="${key}">` + opts.map(o =>
      `<button data-v="${o.v}" class="${o.v === cur ? 'on' : ''}">${o.t}</button>`).join('') + '</div>';

    // 뺀 것 — 배속(전투 화면 1x/2x/3x 와 중복), 전투 스킵(켜도 아무 데서도 안 읽는
    // 죽은 토글이었다). 사운드 슬라이더는 엔진 연동 전이지만 값 저장용으로 남긴다
    // — 소리가 붙는 즉시 이 값이 적용된다 (사용자 결정).
    this.el.querySelector('#stBody').innerHTML = `
      <div class="st-h">일반</div>
      <!-- 언어. 첫 부팅 화면에서 한 번 고르고 나면 다시 물을 자리가 없어서
           여기에 둔다. 라벨을 "언어 / Language" 로 둔 것은, 잘못 고른 사람이
           한글을 못 읽는 상태로 이 줄을 찾아야 하기 때문이다 -->
      <div class="st-row"><span>언어 / Language</span>
        ${seg('lang', LANGS.map(l => ({ v: l.id, t: l.label })), S.lang || 'ko')}</div>
      <div class="sh-note">언어를 바꾸면 게임이 다시 시작됩니다 — 진행은 저장됩니다.</div>

      <div class="st-h">연출</div>
      <div class="st-row"><span>타격 이펙트</span>
        ${seg('fx', [{ v: 1, t: 'ON' }, { v: 0, t: 'OFF' }], S.fxOn === false ? 0 : 1)}</div>
      <div class="st-row"><span>화면 흔들림</span>
        ${seg('shake', [{ v: 1, t: 'ON' }, { v: 0, t: 'OFF' }], S.shakeOn === false ? 0 : 1)}</div>
      <div class="st-row"><span>데미지 숫자</span>
        ${seg('nums', [{ v: 1, t: 'ON' }, { v: 0, t: 'OFF' }], S.numsOn === false ? 0 : 1)}</div>

      <div class="st-h">사운드</div>
      <div class="st-row"><span>배경음</span>
        <input type="range" class="st-rng" data-k="bgm" min="0" max="100" value="${(S.bgm ?? 0.7) * 100}"></div>
      <div class="st-row"><span>효과음</span>
        <input type="range" class="st-rng" data-k="sfx" min="0" max="100" value="${(S.sfx ?? 0.9) * 100}"></div>
      <div class="sh-note">값은 저장되며, 사운드가 연동되는 즉시 적용됩니다.</div>

      <div class="st-h">정보</div>
      <div class="st-row link" data-a="rates"><span>확률표 고지</span><b>›</b></div>
      <div class="st-row link" data-a="account"><span>계정</span><b>${S.nickname || '단장'} ›</b></div>
      <div class="st-row"><span>버전</span><b>proto ${D.ui.meta.version}</b></div>
      <button class="st-danger" data-a="reset">저장 데이터 초기화</button>
      <div class="sh-note" style="text-wrap:balance">확률 공시는 게임산업법(2024.3) 의무다.
        gacha.json 이 단일 소스이며 소환 화면에서 1탭 이내로 접근할 수 있어야 한다.</div>`;

    this.el.querySelectorAll('.st-seg button').forEach(b => b.addEventListener('click', () => {
      // 같은 세그먼트를 ON/OFF(숫자)와 언어(문자열 'ko'·'en')가 같이 쓴다.
      // 전부 +v 로 받으면 언어가 NaN 으로 들어간다
      const v = b.dataset.v;
      this.api.set(b.parentElement.dataset.k, /^-?\d+(\.\d+)?$/.test(v) ? +v : v);
      this.render();
    }));
    this.el.querySelectorAll('.st-rng').forEach(r => r.addEventListener('input', () => {
      this.api.set(r.dataset.k, +r.value / 100);
    }));
    this.el.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
      this.api.action(b.dataset.a);
    }));
  }
}
