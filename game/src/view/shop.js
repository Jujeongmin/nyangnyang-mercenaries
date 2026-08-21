// 상점 — 전체 화면.
//
// ui.json > navBar.behavior: "full_screen_overlay" — 네비는 카드가 아니라 화면을 띄운다.
// 상점은 결제 화면이다. 카드 하나에 버튼 몇 개로는 결제 욕구가 안 생긴다.
//
// 탭 구성은 shop.json > tabs (다이아/특가/교환) + 소환.
// 패스는 여기 없다 — 우측 사이드 열로 옮겼다 (shop.json > subscriptionMoved).
// 훈장 탭은 없다 — 아레나 화면 안의 상점 아이콘으로 옮겼다 (arena.json > medalShop.ui).
// 장비 소환은 여기 없다 — 제작대(메인 화면)에서만 한다. 자동 소환이 거기 물려 있다.

import { num, mdb } from '../core/fmt.js';
const GC = { N: '#9aa4b5', R: '#4CAF50', SR: '#2196F3', SSR: '#9C27B0', UR: '#FF9800', LR: '#E91E63' };

/** 소환 레벨 진행 — gacha.json > tracks[].levelRequirement */
export function summonProgress(track, exp) {
  const req = track.levelRequirement || [];
  let lv = 1, prev = 0;
  for (const b of req) {
    if (exp >= b.cumulativeAtEnd) { lv = b.toLevel; prev = b.cumulativeAtEnd; continue; }
    const into = exp - prev;
    lv = b.fromLevel + Math.floor(into / b.pullsPerLevel);
    const inLv = into % b.pullsPerLevel;
    return { level: lv, cur: inLv, need: b.pullsPerLevel, max: track.maxLevel };
  }
  return { level: Math.min(lv, track.maxLevel), cur: 0, need: 0, max: track.maxLevel };
}

/**
 * 소환 레벨 보상. gacha.json > tracks[].levelReward
 * claimed 다음 레벨부터 현재 레벨까지의 구간 보상을 합산한다.
 */
export function levelRewardPending(track, level, claimed) {
  const lr = track.levelReward;
  if (!lr) return 0;
  let n = 0;
  for (let lv = (claimed || 1) + 1; lv <= level; lv++) {
    const band = lr.byBand.find(b => lv <= b.toLevel) || lr.byBand[lr.byBand.length - 1];
    n += band.tickets;
  }
  return n;
}

export class ShopScreen {
  /**
   * @param api  { state, data, pull(trackId,n), toast(msg) }
   */
  constructor(root, api) {
    this.api = api;
    this.tab = 'summon';
    this.track = 'mercenary';   // 소환 탭에서 지금 보고 있는 쪽
    this.el = document.createElement('div');
    this.el.id = 'shop';
    this.el.innerHTML = `
      <div class="sh-head">
        <button class="sh-back">‹</button>
        <span class="sh-title">상점</span>
        <span class="sh-cur"></span>
      </div>
      <div class="sh-tabs"></div>
      <div class="sh-body"></div>`;
    root.appendChild(this.el);
    this.el.querySelector('.sh-back').addEventListener('click', () => this.close());
  }

  /** track 을 주면 소환 탭의 그 트랙을 펼친 채로 연다 (퀘스트에서 바로 이동) */
  open(track) {
    if (track) { this.tab = 'summon'; this.track = track === 'skill' ? 'skill' : 'mercenary'; }
    this.el.classList.add('show');
    this.render();
  }

  close() { this.el.classList.remove('show'); }

  render() {
    const D = this.api.data;
    const tabs = [{ id: 'summon', nameKo: '소환' }, ...D.shop.tabs];
    this.el.querySelector('.sh-tabs').innerHTML = tabs.map(t =>
      `<button data-t="${t.id}" class="${t.id === this.tab ? 'on' : ''}">${t.nameKo}</button>`).join('');
    this.el.querySelectorAll('.sh-tabs button').forEach(b =>
      b.addEventListener('click', () => { this.tab = b.dataset.t; this.render(); }));

    const S = this.api.state;
    this.el.querySelector('.sh-cur').innerHTML =
      `<img src="/assets/ui/CU-01.png" alt="">${num(S.dia)}`;

    const body = this.el.querySelector('.sh-body');
    body.innerHTML = ({
      summon: () => this.summonTab(),
      diamond: () => this.diamondTab(),
      deal: () => this.dealTab(),
      exchange: () => this.exchangeTab(),
    }[this.tab] || (() => '<div class="sh-empty">준비 중</div>'))();
    body.scrollTop = 0;

    body.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => {
      this.track = b.dataset.track; this.render();
    }));
    body.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', () => {
      this.api.claimSummonLevel(b.dataset.claim); this.render();
    }));
    body.querySelectorAll('[data-pull]').forEach(b => b.addEventListener('click', () => {
      this.api.pull(b.dataset.pull, +b.dataset.n);
    }));
    body.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
      this.api.toast('결제 연동 전 — VXShop 등록 후 붙는다');
    }));
  }

  // ── 소환 ──
  //
  // 용병 / 스킬 토글. 고른 쪽 하나만 크게 박는다.
  // 둘을 나란히 놓으면 소환진 그림이 둘 다 반쪽이 돼서 간판 화면이 안 산다.
  summonTab() {
    const D = this.api.data, S = this.api.state;
    const DEF = {
      mercenary: { alt: 'ALT-01', tint: '#ffb648', desc: '용병 32종', icon: 'CU-05' },
      skill: { alt: 'ALT-02', tint: '#5ad8ff', desc: '액티브 12 · 패시브 10', icon: 'CU-06' },
    };
    const d = DEF[this.track], id = this.track;
    const tr = D.gacha.tracks[id];
    const pg = summonProgress(tr, S.summonExp?.[id] ?? 0);
    const pend = levelRewardPending(tr, pg.level, S.summonLvClaimed?.[id]);
    const band = D.gacha.rateBands.find(x => pg.level >= x.minLevel && pg.level <= x.maxLevel)
      || D.gacha.rateBands[0];
    const top = Object.entries(band.rates).filter(([, v]) => v > 0).slice(-2)
      .map(([g, v]) => `<span style="color:${GC[g]}">${g} ${v}%</span>`).join(' · ');
    const c1 = tr.costs.diamondPerPull, c10 = tr.costs.diamondPer10Pull;
    const disc = Math.round((1 - c10 / (c1 * 10)) * 100);
    const held = id === 'skill' ? (S.skillTicket || 0) : (S.mercTicket || 0);

    const tab = k => {
      const p = levelRewardPending(D.gacha.tracks[k],
        summonProgress(D.gacha.tracks[k], S.summonExp?.[k] ?? 0).level, S.summonLvClaimed?.[k]);
      return `<button class="sm-t${k === id ? ' on' : ''}" data-track="${k}">
        ${D.gacha.tracks[k].nameKo}${p ? '<i class="dot"></i>' : ''}</button>`;
    };

    return `<div class="sm-toggle">${tab('mercenary')}${tab('skill')}</div>
      <div class="sh-summon big" style="--tint:${d.tint}">
        <div class="sh-art" style="background-image:url(/assets/ui/${d.alt}.png)"></div>
        <div class="sh-sgrad"></div>
        <div class="sh-sbody">
          <div class="sh-srow">
            <b>${tr.nameKo}</b>
            <span class="sm-tk" title="보유 소환권 — 다이아보다 먼저 쓴다"><img src="/assets/ui/${d.icon}.png" alt="">${num(held)}</span>
            <span class="sh-lv">소환 Lv ${pg.level}<i>/${pg.max}</i></span>
          </div>
          <div class="sh-desc">${d.desc}</div>
          <div class="sh-bar"><i style="width:${pg.need ? pg.cur / pg.need * 100 : 100}%"></i></div>
          <div class="sh-barTx">
            <span>다음 레벨까지 ${pg.need ? pg.need - pg.cur : 0}회</span>
            <span>${top}</span>
          </div>
          ${pend ? `<button class="sm-claim" data-claim="${id}">
              레벨 보상 <img src="/assets/ui/${d.icon}.png" alt="">${pend} 받기<i class="dot"></i>
            </button>` : ''}
          <div class="sh-btns">
            <button class="sh-b" data-pull="${id}" data-n="1">
              1회<em>${held > 0
                ? `<img src="/assets/ui/${d.icon}.png" alt="">1`
                : `<img src="/assets/ui/CU-01.png" alt="">${c1}`}</em></button>
            <button class="sh-b hot" data-pull="${id}" data-n="10">
              10연<em>${held >= 10
                ? `<img src="/assets/ui/${d.icon}.png" alt="">10`
                : `<img src="/assets/ui/CU-01.png" alt="">${num(c10)}`}</em>
              ${disc > 0 && held < 10 ? `<span class="sh-tag">-${disc}%</span>` : ''}</button>
          </div>
        </div></div>
      <div class="sh-note">소환 레벨이 오르면 최하위 등급이 풀에서 <b>영구 제거</b>되고
        최고 등급 확률이 오른다. 레벨 자체도 전투력에 곱연산으로 기여한다
        (트랙당 레벨×0.5%).<br>
        장비 소환은 <b>제작대</b>에서 한다.</div>`;
  }

  // ── 다이아 ──
  diamondTab() {
    const p = this.api.data.economy.diamondPackages;
    return `<div class="sh-grid2">` + p.packages.map(x => {
      const bonus = x.bonusDiamond ? `+${num(x.bonusDiamond)}` : '';
      return `<div class="sh-pack${x.oncePerAccount ? ' first' : ''}">
        ${x.oncePerAccount ? '<span class="sh-ribbon">첫 결제 2배</span>' : ''}
        <img src="/assets/ui/CU-01.png" alt="">
        <b>${num(x.diamond)}</b>
        ${bonus ? `<span class="sh-bonus">${bonus}</span>` : ''}
        <button class="sh-price" data-buy="${x.id}">구매</button>
      </div>`;
    }).join('') + `</div>
      <div class="sh-note">${mdb(p.exchangeRate)}<br>실결제는 VXShop 등록 후 연동된다.</div>`;
  }

  // ── 특가 ──
  dealTab() {
    const d = this.api.data.shop.dailyDeal;
    return `<div class="sh-timer">다음 갱신 ${d.refreshTime} · 광고 1회로 전체 갱신</div>`
      + d.items.map(x => `<div class="sh-card deal">
          <b>${x.nameKo}</b>
          <span class="sh-desc">${typeof x.grant === 'string' ? x.grant : Object.entries(x.grant)
            .map(([k, v]) => `${k} ×${v}`).join(', ')}</span>
          <button class="sh-price" data-buy="${x.id}">
            <img src="/assets/ui/CU-01.png" alt="">${x.price.diamond}</button>
        </div>`).join('')
      + `<div class="sh-note">${mdb(d.scalingPrinciple)}</div>`;
  }

  // ── 교환 ──
  exchangeTab() {
    const e = this.api.data.shop.exchange;
    return `<div class="sh-h2">골드 환전소</div>`
      + e.goldExchange.rates.map((r, i) => `<div class="sh-card">
          <b>${r}</b>
          <span class="sh-desc">회차마다 환율이 나빠진다</span>
          <button class="sh-price" data-buy="ex_${i}">교환</button>
        </div>`).join('')
      + `<div class="sh-note">${mdb(e.goldExchange.purpose)}<br>
          <b>제외</b> ${e.goldExchange.excluded} — ${mdb(e.goldExchange.excludedReason)}</div>`;
  }
}
