// 우편함 · 프로필 — 전체 화면.
//
// profile.json > meta.purpose:
//   "자동장착 게임이라 플레이 자체의 자기표현이 거의 없다. 프로필이 그 자리를 메운다 —
//    무엇을 모았고 어디까지 갔는지를 남에게 보이는 유일한 창구."
//
// 서버 규약
//   우편 수령은 서버 함수다 (net/backend.js > claimMail).
//   save-schema.json > mailbox.retentionDays: 14 — 서버가 만료를 정리한다.
//   닉네임은 Verse8 leaderboard 제약으로 1~15자다. 초과하면 서버가 거부한다.

const GC = { N: '#b5a69a', R: '#4CAF50', SR: '#2196F3', SSR: '#9C27B0', UR: '#FF9800', LR: '#E91E63' };
import { cpNum, num } from '../core/fmt.js';


const CUR_ICON = {
  diamond: 'CU-01', gold: 'CU-04', speedup_5m: 'CU-10',
  merc_ticket: 'CU-05', skill_ticket: 'CU-06', equip_ticket: 'CU-07',
 arena_medal: 'CU-11',
};
const CUR_NAME = {
  diamond: '다이아', gold: '골드', speedup_5m: '모래시계',
  merc_ticket: '용병 소환권', skill_ticket: '스킬 소환권', equip_ticket: '장비 소환권',
 arena_medal: '투기장 훈장',
};

export class MailScreen {
  constructor(root, api) {
    this.api = api;
    this.el = document.createElement('div');
    this.el.id = 'mail';
    this.el.className = 'fullscr';
    this.el.innerHTML = `
      <div class="sh-head">
        <button class="sh-back">‹</button>
        <span class="sh-title">우편함</span>
        <button class="ml-all" id="mlAll">일괄 수령</button>
      </div>
      <div class="sh-body" id="mlBody"></div>`;
    root.appendChild(this.el);
    this.el.querySelector('.sh-back').addEventListener('click', () => this.close());
    this.el.querySelector('#mlAll').addEventListener('click', () => this.api.claimAll());
  }

  open() { this.el.classList.add('show'); this.render(); }
  close() { this.el.classList.remove('show'); }

  render() {
    const S = this.api.state;
    const list = (S.mailbox || []).filter(m => !m.claimed);
    this.el.querySelector('#mlAll').disabled = !list.length;

    if (!list.length) {
      this.el.querySelector('#mlBody').innerHTML =
        `<div class="sh-empty">받은 우편이 없습니다</div>
         <div class="sh-note">던전 일일 수령 · 아레나 티어 보상 · 시즌 보상이 여기로 온다.
           보관 기간은 14일이며 서버가 만료분을 정리한다.</div>`;
      return;
    }

    this.el.querySelector('#mlBody').innerHTML = list.map((m, i) => `
      <div class="ml-row">
        <div class="ml-info">
          <b>${m.title}</b>
          <span class="sh-desc">${m.from} · ${ago(m.createdAt)}</span>
          <div class="ml-grants">${Object.entries(m.grants).map(([k, v]) =>
            `<span><img src="/assets/ui/${CUR_ICON[k] || 'CU-04'}.png" alt="">${num(v)}</span>`).join('')}</div>
        </div>
        <button class="sh-price" data-i="${i}">수령</button>
      </div>`).join('')
      + `<div class="sh-note">보관 14일. 수령은 서버가 처리하며 중복 수령은 차단된다.</div>`;

    this.el.querySelectorAll('#mlBody button[data-i]').forEach(b =>
      b.addEventListener('click', () => this.api.claim(+b.dataset.i)));
  }
}

function ago(t) {
  const h = (Date.now() - t) / 3600e3;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}분 전`;
  if (h < 24) return `${Math.round(h)}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

// ─────────────────────────────────────────────

export class ProfileScreen {
  constructor(root, api) {
    this.api = api;
    this.el = document.createElement('div');
    this.el.id = 'profile';
    this.el.className = 'fullscr';
    this.el.innerHTML = `
      <div class="sh-head">
        <button class="sh-back">‹</button>
        <span class="sh-title">프로필</span>
      </div>
      <div class="sh-body" id="pfBody"></div>`;
    root.appendChild(this.el);
    this.el.querySelector('.sh-back').addEventListener('click', () => this.close());
  }

  open() { this.el.classList.add('show'); this.render(); }
  close() { this.el.classList.remove('show'); }

  render() {
    const S = this.api.state, D = this.api.data, P = D.profile;
    const featured = S.profile?.featuredMercId
      || S.codex.mercenary[S.codex.mercenary.length - 1] || null;
    const fc = featured ? D.characters.characters.find(c => c.id === featured) : null;
    const frame = P.profileFrame.unlocks.find(f => f.id === (S.profile?.frameId || 'pf_default'))
      || P.profileFrame.unlocks[0];
    const title = P.titles.list.find(t => t.id === S.profile?.titleId);

    // 칭호 조건 판정 — 스테이지 도달 기반만 자동으로 본다
    const owned = P.titles.list.filter(t => titleMet(t, S));

    const codexPct = (S.codex.mercenary.length / D.codex.mercenary.totalEntries * 100).toFixed(0);

    const c = this.api.nickCost ? this.api.nickCost() : { free: false, dia: 0, waitDays: 0 };
    const locked = P.titles.list.length - owned.length;

    this.el.querySelector('#pfBody').innerHTML = `
      <div class="pf-card" style="--fr:${frame.color}">
        <div class="pf-ava pfr-${frame.tier || 1}" title="${frame.nameKo}"
          ${frame.asset ? `style="--pfr-img:url(/assets/ui/${frame.asset}.png)"` : ''}>
          ${fc ? `<img src="/assets/char/${fc.id}.webp" alt="">`
               : `<img src="/assets/captain/captain_warrior.png" alt="">`}
        </div>
        <div class="pf-nick">
          <b>${S.nickname || '단장'}</b>
          <button id="pfEdit" title="닉네임 변경">✎</button>
        </div>
        ${title ? `<span class="pf-title">${title.nameKo}</span>` : ''}
        <div class="pf-cp"><span>전투력</span><b>${cpNum(Math.round(this.api.cp()))}</b></div>
      </div>

      <div class="pf-stats">
        <div><span>최고 스테이지</span><b>${S.maxStage}</b></div>
        <div><span>단장 레벨</span><b>${S.capLv}</b></div>
        <div><span>도감</span><b>${codexPct}%</b></div>
        <div><span>경쟁점수</span><b>${num(S.arenaScore)}</b></div>
      </div>

      <div class="sh-h2">칭호 <span class="cx-cnt">${owned.length}/${P.titles.list.length}</span></div>
      <div class="pf-titles">${owned.map(t => {
        const on = S.profile?.titleId === t.id;
        return `<button class="pf-t${on ? ' on' : ''}" data-title="${t.id}">
          <b>${t.nameKo}</b><span>${t.condition}</span></button>`;
      }).join('') || '<div class="sh-note">아직 얻은 칭호가 없습니다.</div>'}</div>
      ${locked ? `<div class="sh-note">잠긴 칭호 ${locked}개</div>` : ''}

      <div class="sh-h2">대표 용병</div>
      <div class="pf-mercs">${S.codex.mercenary.slice(0, 12).map(id => {
        const ch = D.characters.characters.find(x => x.id === id);
        if (!ch) return '';
        return `<button class="pf-m g-${ch.grade}${featured === id ? ' on' : ''}" data-merc="${id}"
          title="${ch.nameKo}">
          <img src="/assets/char/${id}.webp" alt=""></button>`;
      }).join('') || '<div class="sh-note">용병을 소환하면 여기에 걸 수 있습니다.</div>'}</div>`;

    // 닉네임 변경 — 게임 안 입력 모달 (main.js > askText). prompt() 는
    // 모바일 WebView 가 막아 변경이 통째로 죽었다 (단장 지적 2026-08-27)
    this.el.querySelector('#pfEdit').addEventListener('click', () => this.api.editNick?.());

    this.el.querySelectorAll('[data-title]').forEach(b => b.addEventListener('click', () => {
      this.api.set('titleId', b.dataset.title); this.render();
    }));
    this.el.querySelectorAll('[data-merc]').forEach(b => b.addEventListener('click', () => {
      this.api.set('featuredMercId', b.dataset.merc); this.render();
    }));
  }
}

/** 칭호 조건. 스테이지 도달만 자동 판정하고 나머지는 서버가 준 보유 목록을 본다. */
function titleMet(t, S) {
  if ((S.profile?.ownedTitles || []).includes(t.id)) return true;
  const m = /스테이지\s*(\d+)/.exec(t.condition || '');
  if (m) return S.maxStage >= +m[1];
  return false;
}
