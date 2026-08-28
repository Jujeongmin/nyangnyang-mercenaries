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
import { LANGS, t } from '../core/i18n.js';
import * as live from '../net/live.js';

// 지어낸 순위표는 **개발 빌드에서만**. 배포본에서 가짜 등수가 서 있으면
// 유저는 그걸 진짜로 믿는다 — 아무도 없으면 빈 표가 사실이다
// (main.js 의 DEMO_SOCIAL 과 같은 원칙, 단장 지시 2026-08-26)
const DEMO_RANK = !import.meta.env.PROD;


// 더미 순위표의 이름. **닉네임은 고유명사라 번역하지 않는다** — 다만 한국어
// 이름만 늘어놓으면 외국어 화면에서 이 표만 한글 덩어리가 된다. 로마자를 같이 둔다
const NAMES = ['Nyang', 'Blaze Fox', 'Starlight', 'Haetae', 'Gumiho', 'Panda Sage', 'White Tiger',
  'Abyss Shark', 'Phoenix', 'Kirin', 'Choco Cat', 'Shieldpaw', 'Forest Deer', 'Captain Pengu', 'Otter'];

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
    // 순위 아바타를 누르면 그 사람 프로필 카드. 채팅과 같은 규칙이다 —
    // **그림을 누른다**, 이름이나 점수 글자가 아니라.
    // 20행에 리스너 20개를 다는 대신 한 곳이 위임으로 받는다
    this.el.addEventListener('click', e => {
      const acc = e.target.closest?.('[data-rkacc]')?.dataset.rkacc;
      if (acc) this.api.openProfile?.(acc);
    });
  }

  open() {
    this.el.classList.add('show');
    this.render();
    // 서버 값이 늦게 오면 그때 다시 그린다. 처음엔 캐시(또는 더미)로 즉시 뜬다
    const again = () => { if (this.el.classList.contains('show')) this.render(); };
    live.pullRank(again);
    live.pullTop(this.tab || 'power', again);
    live.pullMyBoardRank(this.tab || 'power', again);
  }
  close() { this.el.classList.remove('show'); }

  myScore(board) {
    const S = this.api.state;
    return board === 'stage' ? S.maxStage
      : board === 'power' ? Math.round(this.api.cp())
      : S.arenaScore;
  }

  /**
   * 순위 20행.
   *
   * 서버가 붙으면 `getTopRankings(20)` 이 준다 — 다만 **rankings 컬렉션은 CP 하나뿐**이다
   * (server.js > submitCp). 스테이지·아레나 보드는 아직 보드별 컬렉션이 없어 더미로
   * 남는다. 보드마다 컬렉션을 파면 조회가 유일한 전역 공유 자원인 rankings 를 세 배로
   * 때린다 — 시즌 컬렉션(rankings_s1…)을 설계할 때 같이 정하는 게 맞다.
   */
  rows(board) {
    // **세 보드 다 profiles 에서 온다** (단장 지시 2026-08-26).
    // 예전에는 power 만 rankings 컬렉션을 쓰고 stage·arena 는 더미를 지어냈다.
    // profiles 에는 cp·stage·arenaScore 가 다 있고 party·title·frame 까지 딸려
    // 와서, 행이 그대로 프로필 카드가 된다 — 눌러서 남의 편성을 볼 수 있다.
    const top = live.getTop(board);
    if (top?.length) {
      const P = this.api.data.profile;
      const D = this.api.data;
      return top.map((r, i) => ({
        rank: i + 1,
        name: r.nickname || '단장',
        // 대표 용병은 **그 사람 편성의 첫 자리**다. 예전에는 등수로 고른
        // 장식이라 남의 조합과 아무 상관이 없었다
        // 편성이 비어 있으면(옛 세대 행) 지어내지 않는다 — merc 를 비우면
        // 아래 렌더가 그 사람 단장 초상으로 그린다 (단장 지적 2026-08-27:
        // "실제 착용한 프로필이 아니다")
        // 대표 용병(프로필에서 직접 고른 것) > 편성 첫 자리 > 단장 초상
        merc: (r.featured && D.characters.characters.some(c => c.id === r.featured)
            ? r.featured : null)
          || (r.party || []).map(m => m.id)
            .find(id => D.characters.characters.some(c => c.id === id)) || null,
        capCls: r.capCls || 'warrior',
        title: r.title || '',
        frame: P.profileFrame.unlocks.find(f => f.id === r.frame)?.color
          || P.profileFrame.unlocks[Math.max(0, 3 - Math.floor(i / 6))]?.color || '#9E9E9E',
        score: r.score || 0,
        account: r.account || '',       // 눌렀을 때 카드를 띄우는 열쇠
      }));
    }
    // 서버에 아직 아무도 없으면 **개발 빌드에서만** 더미를 세운다.
    // 배포본에서 지어낸 순위표는 유저가 진짜로 믿는다
    return DEMO_RANK ? this.dummyRows(board) : [];
  }

  /** 서버가 없거나 보드에 컬렉션이 없을 때. 내 점수 주변으로 지어낸다 */
  dummyRows(board) {
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
      `<button data-t="${b.id}" class="${b.id === this.tab ? 'on' : ''}">${t(b.nameKo)}</button>`).join('');
    this.el.querySelectorAll('#rkTabs button').forEach(x =>
      x.addEventListener('click', () => { this.tab = x.dataset.t; this.render(); }));

    // 전투력 보드만 k/m 표기 — 자릿수가 커서 만/억 보다 한눈에 읽힌다
    // 오른쪽 숫자가 무엇인지 값 옆에 붙인다 — "St 12" 는 무슨 단위인지 안 읽힌다
    // 스테이지는 **화면에서 쓰는 표기(일반 2-6)** 로 보여 준다 — "70" 만 적으면
    // 지금 어디쯤인지가 안 읽힌다 (단장 지적 2026-08-25)
    const fmt = v => this.tab === 'stage' ? (this.api.stageText ? this.api.stageText(v) : num(v))
      : this.tab === 'power' ? cpNum(v)
      : `${num(v)}<i>${t('점')}</i>`;
    const rows = this.rows(this.tab);
    // 내 등수 — 서버가 profiles 에서 "나보다 높은 사람 수 + 1" 로 잰 실제
    // 값이다 (server.js > myProfileRank). 예전에는 전투력 보드만 진짜였고
    // 나머지는 47 을 지어냈다 (단장 지적 2026-08-27). 서버가 모르면(-1)
    // 순위를 지어내지 않고 — 로 비워 둔다
    const mine = live.getMyBoardRank(this.tab);
    const myRank = mine && mine.rank > 0 ? mine.rank : null;

    let head = '';
    if (this.tab === 'score') {
      // 시즌 타이머 + 내 순위의 예상 보상 — ui.seasonTimerReason
      const tier = (myRank && D.ranking.rankRewards.tiers.find(x => inRank(x.rank, myRank)))
        || D.ranking.rankRewards.tiers[D.ranking.rankRewards.tiers.length - 1];
      head = `<div class="rk-season">
        <div class="rk-srow"><b>${t('시즌 {0}', 1)}</b><span>${t('남은 시간')} ${t('6일 04:12')}</span></div>
        <div class="rk-pred">${t('지금 {0} · 이대로면 훈장 {1} · 다이아 {2}',
          `<b>${myRank ? t('{0}위', myRank) : t('순위권 밖')}</b>`, `<b>${num(tier.medals)}</b>`, `<b>${num(tier.diamond)}</b>`)}</div>
      </div>`;
    }
    // 전투력·스테이지 보드의 설명문은 뺐다 (단장 지시 2026-08-27). 서버 검증
    // 방식 같은 내부 규칙은 유저가 읽을 글이 아니다

    this.el.querySelector('#rkBody').innerHTML = head + rows.map(r => `
      <div class="rk-row${r.rank <= 3 ? ' top' : ''}">
        <span class="rk-n rk-${r.rank <= 3 ? r.rank : 'x'}">${r.rank}</span>
        <span class="rk-ava" style="border-color:${r.frame}"${
          r.account ? ` data-rkacc="${r.account}"` : ''}>
          <img src="${r.merc ? `/assets/char/${r.merc}.webp`
            : `/assets/captain/captain_${r.capCls || 'warrior'}.png`}" alt="">
        </span>
        <span class="rk-who">
          <b>${r.name}</b>
          ${r.title ? `<i>${t(r.title)}</i>` : ''}
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
        <span class="rk-n">${myRank ?? '—'}</span>
        <span class="rk-ava" style="border-color:${myFrame?.color || '#9E9E9E'}">
          <img src="${myMerc ? `/assets/char/${myMerc}.webp`
                             : '/assets/captain/captain_warrior.png'}" alt="">
        </span>
        <span class="rk-who">
          <b>${S.nickname || t('단장')}</b>
          ${myTitle ? `<i>${t(myTitle.nameKo)}</i>` : ''}
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

/**
 * 디스코드 로고. **그림 파일이 아니라 인라인 SVG 다** — 20px 로고 하나 때문에
 * 에셋 목록을 늘리고 싶지 않았고(tools/check-assets.mjs 가 세는 대상이 된다),
 * 벡터라 화면 크기가 어떻든 안 뭉갠다.
 *
 * 색은 디스코드 브랜드색(#5865F2)을 그대로 쓴다. 이 마크는 "우리 디스코드로
 * 간다"를 말하는 자리이므로, 게임 팔레트에 맞춰 색을 바꾸면 무엇으로 가는
 * 링크인지가 안 읽힌다.
 */
const DISCORD_ICON = `<svg class="st-ic" viewBox="0 0 127.14 96.36" aria-hidden="true"
  fill="#5865F2" xmlns="http://www.w3.org/2000/svg"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>`;

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
      <div class="st-h">${t('일반')}</div>
      <!-- 언어. 첫 부팅 화면에서 한 번 고르고 나면 다시 물을 자리가 없어서
           여기에 둔다. 라벨을 "언어 / Language" 로 둔 것은, 잘못 고른 사람이
           한글을 못 읽는 상태로 이 줄을 찾아야 하기 때문이다 -->
      <div class="st-row stack"><span>언어 / Language</span>
        ${seg('lang', LANGS.map(l => ({ v: l.id, t: l.label })), S.lang || 'ko')}</div>
      <div class="sh-note">${t('언어를 바꾸면 게임이 다시 시작됩니다 — 진행은 저장됩니다.')}</div>
      <!-- 절전. 전투 화면 우측 열에도 같은 버튼이 있지만, 세로가 660px 이 안 되는
           화면에서는 그 열에 자리가 없어 빠진다(index.html > @media max-height:660).
           빠지는 화면에서도 길이 남아야 해서 여기에 둔다 -->
      <div class="st-row link" data-a="pwrsave"><span>${t('절전 모드')}</span>
        <b>${t('켜기')} ›</b></div>

      <!-- 연출 셋을 **한 줄**에 넣는다 (단장 확정 2026-08-26). ON/OFF 토글 세
           줄이 각각 한 칸을 먹어 설정이 한 화면을 넘겼다. 켜고 끄는 값이라
           이름 자체가 곧 상태다 — 눌러서 켜지면 금색, 꺼지면 갈색 -->
      <div class="st-row"><span>${t('연출')}</span>
        <div class="st-seg" data-k="fxset">
          <button data-v="fx"    class="${S.fxOn === false ? '' : 'on'}">${t('타격')}</button>
          <button data-v="shake" class="${S.shakeOn === false ? '' : 'on'}">${t('흔들림')}</button>
          <button data-v="nums"  class="${S.numsOn === false ? '' : 'on'}">${t('피해 숫자')}</button>
        </div></div>

      <div class="st-h">${t('사운드')}</div>
      <div class="st-row"><span>${t('배경음')}</span>
        <input type="range" class="st-rng" data-k="bgm" min="0" max="100" value="${(S.bgm ?? 0.7) * 100}"></div>
      <div class="st-row"><span>${t('효과음')}</span>
        <input type="range" class="st-rng" data-k="sfx" min="0" max="100" value="${(S.sfx ?? 0.9) * 100}"></div>

      <div class="st-h">${t('정보')}</div>
      <!-- 확률표 고지 줄은 뺐다 — 확률은 소환·제작대 화면에서 1탭 이내로
           보이고 있어 여기서 한 번 더 들어가는 통로는 중복이다 (단장 확정) -->
      <!-- 플레이어 코드 — 특정 사람에게 우편을 보낼 때 쓰는 주소다.
           문의할 때 이 값을 알려 주면 그 사람에게만 보상을 넣을 수 있다
           (data/mail.json > entries[].to). 눌러서 복사한다 -->
      <div class="st-row link" data-a="copycode"><span>${t('플레이어 코드')}</span>
        <b id="stCode">${this.api.playerCode ? this.api.playerCode() : '—'}</b></div>
      <!-- 디스코드 — 링크는 data/ui.json > links.discord 에 붙여 넣는다.
           **비어 있으면 줄 자체를 안 그린다.** 눌러도 아무 데도 안 가는 줄이
           설정에 남아 있으면 그건 고장으로 읽힌다.
           아이콘은 인라인 SVG 다 (DISCORD_ICON) — 20px 로고 하나를 위해
           에셋을 늘리지 않았고, 벡터라 어느 화면에서도 안 뭉갠다 -->
      ${D.ui.links?.discord ? `<div class="st-row link" data-a="discord">
        ${DISCORD_ICON}<span>${t('디스코드')}</span><b>${t('열기')} ›</b></div>` : ''}
      <!-- 커밋 해시는 뗐다 (단장 지시 2026-08-25) — 배포판 화면에 개발 표식이
           서 있을 자리가 아니다. 값 자체는 살아 있다: 부팅 때 콘솔에
           "[냥냥] build 해시" 로 찍히므로 배포본 갱신 확인은 그걸로 한다
           (main.js 부트, vite.config.js > buildStamp).
           **이 블록은 템플릿 문자열 안이다 — 백틱을 쓰면 문자열이 끊긴다** -->
      <!-- 커밋 해시는 화면에서 뺐다 (단장 지시 2026-08-27) — 버전 숫자만.
           배포 확인은 이제 이 버전을 올려서 한다. 해시는 콘솔([냥냥] build)에 남는다 -->
      <!-- 버전 줄을 누르면 접속 진단이 펼쳐진다. 폰에는 콘솔을 열 방법이
           마땅치 않아 "서버에 붙었나", "리비전이 몇인가" 를 물어볼 수가 없었다
           (단장 지적 2026-08-28). 평소에는 접혀 있어 눈에 안 띈다 -->
      <div class="st-row link" data-a="diag"><span>${t('버전')}</span>
        <b>v${D.ui.meta.version} ›</b></div>
      <pre id="stDiag" class="st-diag" hidden></pre>
      <button id="stPush" class="st-diagbtn" data-a="pushnow" hidden>지금 서버에 올리기</button>
      <!-- 확률 공시 안내문은 뺐다 (단장 지시 2026-08-25). 확률은 이미 소환·제작대
           화면에 실제 표로 공시되고 있어서, 여기 문장은 그 사실을 말로 한 번 더
           적은 개발 메모였다. 의무 자체는 그 표가 지킨다 (gacha.json 단일 소스) -->
      <button class="st-danger" data-a="reset">${t('저장 데이터 초기화')}</button>`;

    // 연출 줄은 **여러 개를 각각 켜고 끈다** — 하나만 고르는 다른 세그먼트와
    // 규칙이 다르므로 먼저 가로챈다. 안 그러면 아래 핸들러가 fxset 을 단일
    // 선택으로 처리해서 하나를 켜면 나머지가 꺼진다
    this.el.querySelectorAll('.st-seg[data-k="fxset"] button').forEach(b =>
      b.addEventListener('click', e => {
        e.stopPropagation();
        const on = !b.classList.contains('on');
        b.classList.toggle('on', on);
        this.api.set(b.dataset.v, on ? 1 : 0);
      }));
    this.el.querySelectorAll('.st-seg:not([data-k="fxset"]) button').forEach(b => b.addEventListener('click', () => {
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
