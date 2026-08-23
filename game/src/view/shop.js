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
const GC = { N: '#b5a69a', R: '#4CAF50', SR: '#2196F3', SSR: '#9C27B0', UR: '#FF9800', LR: '#E91E63' };

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

/** 레벨 L 에 닿기까지 필요한 누적 뽑기 수. 해금까지 몇 회 남았나를 말해 주려고 쓴다 */
export function pullsToLevel(track, L) {
  let n = 0;
  for (const b of track.levelRequirement || []) {
    if (L <= b.fromLevel) break;
    n += (Math.min(L, b.toLevel) - b.fromLevel) * b.pullsPerLevel;
  }
  return n;
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
    // 소환 레벨 창 닫기 — X 또는 카드 밖
    const sm = document.querySelector('#smPop');
    const hide = () => sm.classList.remove('show');
    document.querySelector('#smX')?.addEventListener('click', hide);
    sm?.addEventListener('click', e => { if (e.target.id === 'smPop') hide(); });
  }

  /** track 을 주면 소환 탭의 그 트랙을 펼친 채로 연다 (퀘스트에서 바로 이동) */
  open(track) {
    // 'diamond' 같은 탭 id 를 직접 주면 그 탭으로 연다 (다이아 [+] 지름길).
    // 소환 트랙 이름이면 기존대로 소환 탭 + 트랙 선택이다
    if (track === 'diamond' || track === 'exchange') this.tab = track;
    else if (track) { this.tab = 'summon'; this.track = track === 'skill' ? 'skill' : 'mercenary'; }
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
      exchange: () => this.exchangeTab(),
    }[this.tab] || (() => '<div class="sh-empty">준비 중</div>'))();
    body.scrollTop = 0;

    body.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => {
      this.track = b.dataset.track; this.render();
    }));
    body.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', () => {
      this.api.claimSummonLevel(b.dataset.claim); this.render();
    }));
    body.querySelectorAll('[data-smlv]').forEach(b =>
      b.addEventListener('click', () => this.openLevelInfo(b.dataset.smlv)));
    body.querySelectorAll('[data-pull]').forEach(b => b.addEventListener('click', () => {
      this.api.pull(b.dataset.pull, +b.dataset.n);
    }));
    body.querySelectorAll('[data-eqbuy]').forEach(b => b.addEventListener('click', () => {
      const o = (this.api.data.shop.quickEquip || [])[+b.dataset.eqbuy];
      if (o && this.api.buyEquipTicket(o.count, o.diamond)) this.render();
    }));
    body.querySelectorAll('[data-goldbuy]').forEach(b => b.addEventListener('click', () => {
      const o = (this.api.data.shop.quickGold || [])[+b.dataset.goldbuy];
      if (o && this.api.buyGold(o.hours, o.diamond)) this.render();
    }));
    body.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
      // 3배속만 창구가 따로 있다. 실결제는 아직 없고, 개발 빌드에서만 즉시 해금된다
      if (b.dataset.buy === 'speed3_unlock' && this.api.buySpeed3) return this.api.buySpeed3();
      this.api.toast('결제 연동 전 — VXShop 등록 후 붙는다');
    }));
    body.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.claim === 'speed3') this.api.claimSpeed3Daily?.();
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
    // 소환권이 10장 미만이면 **가진 만큼** 뽑는다 — "10연"만 있으면 7장 든 유저는
    // 버튼이 다이아 결제로 바뀌어 티켓이 그대로 묵는다.
    // 10장 이상이거나 아예 없으면(다이아 결제) 기존대로 10연이다
    const multiN = held > 0 && held < 10 ? held : 10;
    // 가격표는 **실제 결제 식**에서 그린다. 여기서 따로 계산하면 소환권으로
    // 내는데 버튼엔 다이아가 그려지는 어긋남이 다시 생긴다
    const price = n => {
      const c = this.api.pullCost(id, n);
      const bits = [];
      if (c.ticket) bits.push(`<img src="/assets/ui/${d.icon}.png" alt="">${c.ticket}`);
      if (c.dia) bits.push(`<img src="/assets/ui/CU-01.png" alt="">${num(c.dia)}`);
      return bits.join('<i class="sh-plus">+</i>') || '—';
    };
    const noDia = this.api.pullCost(id, multiN).dia === 0;

    const tab = k => {
      const p = levelRewardPending(D.gacha.tracks[k],
        summonProgress(D.gacha.tracks[k], S.summonExp?.[k] ?? 0).level, S.summonLvClaimed?.[k]);
      return `<button class="sm-t${k === id ? ' on' : ''}" data-track="${k}">
        ${D.gacha.tracks[k].nameKo}${p ? '<i class="dot"></i>' : ''}</button>`;
    };

    return `<div class="sm-toggle">${tab('mercenary')}${tab('skill')}</div>
      <div class="sh-summon big" style="--tint:${d.tint}">
        <div class="sh-art" style="background-image:url(/assets/ui/${d.alt}.png)"></div>
        <!-- 보유 소환권 — 그림 위 우상단. 가장 먼저 확인하는 숫자라 크게 띄운다 -->
        <span class="sm-tk" title="보유 소환권 — 다이아보다 먼저 쓴다">
          <img src="/assets/ui/${d.icon}.png" alt="">${num(held)}</span>
        <div class="sh-sgrad"></div>
        <div class="sh-sbody">
          <div class="sh-srow">
            <b>${tr.nameKo}</b>
            <span class="sh-lv" data-smlv="${id}" title="확률표 · 레벨 보상"
              >소환 Lv ${pg.level}<i>/${pg.max}</i> ⓘ${pend ? '<i class="dot"></i>' : ''}</span>
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
              1회<em>${price(1)}</em></button>
            <button class="sh-b hot" data-pull="${id}" data-n="${multiN}">
              ${multiN}연<em>${price(multiN)}</em>
              ${disc > 0 && !noDia ? `<span class="sh-tag">-${disc}%</span>` : ''}</button>
          </div>
        </div></div>
      <div class="sh-note">소환 레벨이 오르면 최하위 등급이 풀에서 <b>영구 제거</b>되고
        최고 등급 확률이 오른다. 레벨 자체도 전투력에 곱연산으로 기여한다
        (트랙당 레벨×0.5%).<br>
        장비 소환은 <b>제작대</b>에서 한다.</div>`;
  }

  /**
   * 소환 레벨 상세 — 지금 확률 / 다음 해금 / 레벨 보상, 그리고 접어 둔 전 레벨 표.
   *
   * v3 에서 밴드가 레벨당 1행(50행)이 되면서 전부 펼치면 아무도 안 읽는다.
   * 유저가 실제로 묻는 건 두 가지다 — **지금 뭐가 나오나**, **다음에 뭐가 열리나**.
   * 그 둘을 위로 올리고 전체 표는 토글 뒤에 둔다. 확률 공시 의무는 표를
   * 없애는 게 아니라 닿을 수 있게 두는 것으로 지킨다.
   */
  openLevelInfo(id) {
    const D = this.api.data, S = this.api.state;
    const tr = D.gacha.tracks[id];
    const exp = S.summonExp?.[id] ?? 0;
    const pg = summonProgress(tr, exp);
    const pend = levelRewardPending(tr, pg.level, S.summonLvClaimed?.[id]);
    const icon = id === 'skill' ? 'CU-06' : 'CU-05';
    const kind = id === 'skill' ? D.skills.skills : D.characters.characters;
    const count = g => kind.filter(x => x.grade === g).length || 1;
    const bandAt = lv => D.gacha.rateBands.find(b => lv >= b.minLevel && lv <= b.maxLevel)
      || D.gacha.rateBands[D.gacha.rateBands.length - 1];
    // 표의 원본은 소수점 넷째 자리까지다(합이 정확히 100 이 되게). 화면에는 줄인다 —
    // 1% 미만은 자릿수가 곧 정보라 그대로 두고, 그 위는 소수 둘째까지
    const pct = v => (v < 1 ? String(+v.toFixed(4)) : v.toFixed(2).replace(/\.00$/, ''));

    // 등급 한 줄 — 등급 확률과 개별 확률(등급확률 ÷ 종수)을 같이 준다
    // 낮은 등급이 위다 (제작대 확률창과 같은 순서). JSON 의 등급 순서가
    // 그대로 N -> LR 이라 뒤집지 않는 것이 곧 오름차순이다
    const gradeRows = b => Object.entries(b.rates).filter(([, v]) => v > 0)
      .map(([g, v]) => `<div class="sm-g"><i style="background:${GC[g]}"></i>
        <b style="color:${GC[g]}">${g}</b>
        <span class="sm-p">${pct(v)}%</span>
        <span class="sm-e">1종당 ${pct(v / count(g))}%</span></div>`).join('');

    // 다음 해금 — gradeUnlock 에서 현재 레벨보다 위인 것 중 가장 가까운 것
    const ul = D.gacha.gradeUnlock || {};
    const next = Object.entries(ul).filter(([, lv]) => lv > pg.level)
      .sort((a, b) => a[1] - b[1])[0];
    const left = next ? Math.max(0, pullsToLevel(tr, next[1]) - exp) : 0;

    // 같은 창을 제작대 확률도 쓴다 — 제목을 되돌려 놓는다
    const ttl = document.querySelector('#smTitle');
    if (ttl) ttl.textContent = '소환 레벨';
    document.querySelector('#smBody').innerHTML = `
      <div class="sm-now">
        <div class="sm-nh">현재 <b>Lv ${pg.level}</b>
          <span>${pg.need ? `다음 레벨까지 ${pg.need - pg.cur}회` : '만렙'}</span></div>
        ${gradeRows(bandAt(pg.level))}
      </div>
      ${next ? `<div class="sm-next">
          <b style="color:${GC[next[0]]}">${next[0]}</b> 등급이 <b>Lv ${next[1]}</b> 에 열린다
          <span>${left}회 남음</span></div>`
        : '<div class="sm-next">모든 등급이 열렸다</div>'}
      ${pend ? `<button class="rt-b go" id="smClaim" style="width:100%;margin:10px 0 0">
          레벨 보상 받기 <img src="/assets/ui/${icon}.png" alt=""
            style="width:15px;height:15px;vertical-align:-3px">${pend}</button>`
        : '<div class="sh-note" style="margin:10px 0 0">받을 레벨 보상이 없습니다</div>'}
      <button class="sm-all" id="smAll" aria-expanded="false">레벨별 전체 확률 보기</button>
      <div id="smTable" hidden>
        ${D.gacha.rateBands.map(b => {
          const now = pg.level >= b.minLevel && pg.level <= b.maxLevel;
          // N·R 은 처음부터 있는 풀이다 — Lv1 에 "해금" 딱지를 붙이면 계단이 안 읽힌다
          const opened = Object.entries(ul)
            .filter(([g, lv]) => lv === b.minLevel && lv > 1 && g !== 'N' && g !== 'R')
            .map(([g]) => `<em style="color:${GC[g]}">${g} 해금</em>`).join('');
          const rates = Object.entries(b.rates).filter(([, v]) => v > 0)
            .map(([g, v]) => `<span style="color:${GC[g]}">${g} ${pct(v)}</span>`).join('');
          return `<div class="sm-band${now ? ' now' : ''}">
            <span class="lv">Lv ${b.minLevel}${opened}</span>
            <span class="rates">${rates}</span></div>`;
        }).join('')}
      </div>
      <div class="sh-note">${D.gacha.perItemRateFormula.legalRequirement}<br>
        개별 확률 = 등급 확률 ÷ 그 등급의 종수</div>`;
    document.querySelector('#smClaim')?.addEventListener('click', () => {
      this.api.claimSummonLevel(id);
      this.openLevelInfo(id);
      this.render();
    });
    const all = document.querySelector('#smAll'), tbl = document.querySelector('#smTable');
    all.addEventListener('click', () => {
      const open = tbl.hidden;
      tbl.hidden = !open;
      all.setAttribute('aria-expanded', String(open));
      all.textContent = open ? '전체 확률 접기' : '레벨별 전체 확률 보기';
      if (open) tbl.querySelector('.sm-band.now')?.scrollIntoView({ block: 'center' });
    });
    document.querySelector('#smPop').classList.add('show');
  }

  /**
   * 3배속 해금 카드. 다이아 탭 맨 위에 둔다 — 다이아 묶음보다 먼저 눈에 와야
   * "돈으로 살 수 있는 유일한 성능"이라는 게 읽힌다.
   * 배속은 방치 수익의 곱셈 항이라 2배속 대비 시간당 +50% 다.
   */
  speedCard() {
    const D = this.api.data, S = this.api.state;
    const pk = (D.shop.packages || []).find(x => x.id === 'speed3_unlock');
    if (!pk) return '';
    const owned = !!S.speed3;
    const today = new Date().toISOString().slice(0, 10);
    const got = S.speed3DailyAt === today;
    const daily = pk.dailyGrant?.diamond ?? 0;
    return `<div class="sh-card speed3${owned ? ' owned' : ''}">
      <b>${pk.nameKo}</b>
      <span class="sh-desc">전투·방치 수익이 3배속 기준이 된다 · 매일 다이아 ${daily}</span>
      ${owned
        ? `<button class="sh-price" data-claim="speed3" ${got ? 'disabled' : ''}>
             ${got ? '오늘 수령 완료' : `오늘 다이아 ${daily} 받기`}</button>`
        : `<button class="sh-price" data-buy="speed3_unlock">해금</button>`}
    </div>`;
  }

  // ── 다이아 ──
  diamondTab() {
    const p = this.api.data.economy.diamondPackages;
    return this.speedCard() + `<div class="sh-grid3">` + p.packages.map((x, i) => {
      const bonus = x.bonusDiamond ? `+${num(x.bonusDiamond)}` : '';
      return `<div class="sh-pack${x.oncePerAccount ? ' first' : ''}">
        ${x.oncePerAccount ? '<span class="sh-ribbon">첫 결제 2배</span>' : ''}
        <img src="/assets/ui/SHOP-D${i + 1}.png" alt="">
        <b>${num(x.diamond)}</b>
        ${bonus ? `<span class="sh-bonus">${bonus}</span>` : ''}
        <button class="sh-price" data-buy="${x.id}">구매</button>
      </div>`;
    }).join('') + `</div>
      <div class="sh-note">${mdb(p.exchangeRate)}<br>실결제는 VXShop 등록 후 연동된다.</div>`;
  }

  // ── 교환 ──
  // 교환 — 다이아로 골드·장비권을 산다. **골드 환전소는 뺐다 (2026-08-24)**:
  // 누르면 "결제 연동 전" 토스트만 뜨는 빈 칸이었고, 골드 소모처 역할은
  // 연합 기부(하루 700만)와 제작대 골드 투입이 이미 받고 있다.
  exchangeTab() {
    // 다이아 -> 골드. 액수는 방치 공식(idleGold)이라 스테이지가 오르면 같이 오른다.
    // "N시간 분량" 표기가 정직하다 — 고정 액수는 후반에 휴지조각이 된다
    const qg = (this.api.data.shop.quickGold || []).map((o, i) => `<div class="sh-card">
        <b>방치 ${o.hours}시간 분량</b>
        <span class="sh-desc"><img src="/assets/ui/CU-04.png" alt=""
          style="width:12px;height:12px;vertical-align:-2px"> ${num(this.api.quickGold(o.hours))}</span>
        <button class="sh-price" data-goldbuy="${i}">
          <img src="/assets/ui/CU-01.png" alt=""
            style="width:12px;height:12px;vertical-align:-2px"> ${num(o.diamond)}</button>
      </div>`).join('');
    const qe = (this.api.data.shop.quickEquip || []).map((o, i) => `<div class="sh-card">
        <b>장비 소환권 ${o.count}장</b>
        <span class="sh-desc"><img src="/assets/ui/CU-07.png" alt=""
          style="width:12px;height:12px;vertical-align:-2px"> ${num(o.count)} · 개당 ${(o.diamond / o.count).toFixed(0)}</span>
        <button class="sh-price" data-eqbuy="${i}">
          <img src="/assets/ui/CU-01.png" alt=""
            style="width:12px;height:12px;vertical-align:-2px"> ${num(o.diamond)}</button>
      </div>`).join('');
    return `<div class="sh-h2">골드 구매</div>${qg}
      <div class="sh-h2" style="margin-top:12px">장비 소환권</div>${qe}`;
  }
}
