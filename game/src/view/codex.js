// 도감 — 전체 화면.
//
// codex.json > meta.purpose:
//   "자동장착과 캐스케이드 때문에 하위 등급은 뽑자마자 소모되고 파티에 낄 일이 없다.
//    도감은 1회 획득 시 영구 등록되므로 '쓸모없어도 한 번은 뽑아야 하는' 이유를 만든다."
//
// 예산은 32% 고정이다 (codex.json > budget.budgetLock). 늘리면 CP 천장이 오르고
// stages.json 의 곡선·벽·St200 목표가 전부 재계산 대상이 된다.

import { tn } from '../core/i18n.js';

const GC = { N: '#b5a69a', R: '#4CAF50', SR: '#2196F3', SSR: '#9C27B0', UR: '#FF9800', LR: '#E91E63' };
const GRADES = ['N', 'R', 'SR', 'SSR', 'UR', 'LR'];
const pct = v => (v * 100).toFixed(2).replace(/\.?0+$/, '') + '%';

export class CodexScreen {
  constructor(root, api) {
    this.api = api;
    this.tab = 'mercenary';
    this.el = document.createElement('div');
    this.el.id = 'codex';
    this.el.className = 'fullscr';
    this.el.innerHTML = `
      <div class="sh-head">
        <button class="sh-back">‹</button>
        <span class="sh-title">도감</span>
        <span class="sh-cur" id="cxBonus"></span>
      </div>
      <div class="sh-tabs" id="cxTabs"></div>
      <div class="sh-body" id="cxBody"></div>`;
    root.appendChild(this.el);
    this.el.querySelector('.sh-back').addEventListener('click', () => this.close());
  }

  open() { this.el.classList.add('show'); this.render(); }
  close() { this.el.classList.remove('show'); }

  /** 등록된 용병 개별 보너스 합 — codex.json > mercenary.individualByGrade */
  bonus() {
    const D = this.api.data, S = this.api.state;
    const byG = D.codex.mercenary.individualByGrade;
    let m = 0;
    for (const id of S.codex.mercenary) {
      const c = D.characters.characters.find(x => x.id === id);
      if (c && byG[c.grade]) m += byG[c.grade].bonusEach;
    }
    const skG = D.codex.skill.individualByGrade;
    let s = 0;
    for (const g of Object.values(S.codex.skill)) s += skG[g] || 0;
    return { merc: m, skill: s, total: Math.min(D.codex.budget.totalMaxBonus, m + s) };
  }

  render() {
    const D = this.api.data, S = this.api.state;
    const b = this.bonus();
    this.el.querySelector('#cxBonus').innerHTML =
      `전투력 <b style="color:var(--up);margin-left:4px">+${pct(b.total)}</b>`;

    const tabs = [
      { id: 'mercenary', nameKo: `용병 ${S.codex.mercenary.length}/${D.codex.mercenary.totalEntries}` },
      { id: 'skill', nameKo: `스킬 ${Object.keys(S.codex.skill).length}/${D.codex.skill.totalEntries}` },
    ];
    this.el.querySelector('#cxTabs').innerHTML = tabs.map(t =>
      `<button data-t="${t.id}" class="${t.id === this.tab ? 'on' : ''}">${t.nameKo}</button>`).join('');
    this.el.querySelectorAll('#cxTabs button').forEach(x =>
      x.addEventListener('click', () => { this.tab = x.dataset.t; this.render(); }));

    this.el.querySelector('#cxBody').innerHTML =
      this.tab === 'mercenary' ? this.mercTab(b) : this.skillTab(b);
    // 등록된 칸을 누르면 상세 — 도감이 곧 컬렉션 뷰어다
    if (this.api.openUnitInfo) this.el.querySelectorAll('[data-info]').forEach(el =>
      el.addEventListener('click', () => this.api.openUnitInfo(el.dataset.kind, el.dataset.info)));
  }

  mercTab(b) {
    const D = this.api.data, S = this.api.state;
    const own = new Set(S.codex.mercenary);
    const byG = D.codex.mercenary.individualByGrade;
    const order = ['LR', 'UR', 'SSR', 'SR', 'R', 'N'];

    return order.map(g => {
      const list = D.characters.characters.filter(c => c.grade === g);
      if (!list.length) return '';
      const got = list.filter(c => own.has(c.id)).length;
      return `<div class="cx-h">
          <span style="color:${GC[g]}">${g}</span>
          <span class="cx-cnt">${got}/${list.length}</span>
          <span class="cx-sub">개당 +${pct(byG[g].bonusEach)}</span>
        </div>
        <div class="cx-grid">` + list.map(c => {
          const has = own.has(c.id);
          // 미보유여도 등급 액자를 쓴다 (색만 죽인다). 용병은 등급이 고정이라
          // 안 뽑아도 무엇인지 알고, 액자가 곧 "이걸 뽑으면 이 등급"이라는 예고다
          return `<div class="cx-cell g-${g}${has ? '' : ' lock'}"
              ${has ? `data-info="${c.id}" data-kind="merc"` : ''} title="${tn(c.id, c.nameKo)}">
            <img src="/assets/art/${c.id}-ART.png" alt=""
              onerror="this.onerror=null;this.src='/assets/char/${c.id}.webp'">
            <span>${has ? tn(c.id, c.nameKo) : '???'}</span>
          </div>`;
        }).join('') + `</div>`;
    }).join('')
    + `<div class="sh-note">용병 개별 보너스 <b>+${pct(b.merc)}</b> / 예산
        ${pct(D.codex.budget.breakdown.mercIndividual)}<br>
        1회 획득 시 영구 등록된다. 캐스케이드로 소모되거나 미장착이어도 유지된다.</div>`;
  }

  skillTab(b) {
    const D = this.api.data, S = this.api.state;
    const byG = D.codex.skill.individualByGrade;
    const kinds = [['SK-A', '액티브'], ['SK-P', '패시브']];

    return kinds.map(([pre, label]) => {
      // 등급순으로 세운다. 등급이 종류에 고정이라 이제 정렬이 가능하다
      const list = D.skills.skills.filter(s => s.id.startsWith(pre))
        .sort((a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade));
      const got = list.filter(s => S.codex.skill[s.id]).length;
      return `<div class="cx-h"><span>${label}</span>
          <span class="cx-cnt">${got}/${list.length}</span></div>
        <div class="cx-grid">` + list.map(s => {
          const has = !!S.codex.skill[s.id];
          // 등급은 미보유여도 안다 — 액자를 깔고 색만 죽인다 (.cx-cell.lock)
          return `<div class="cx-cell g-${s.grade}${has ? '' : ' lock'}"
              ${has ? `data-info="${s.id}" data-kind="skill"` : ''} title="${tn(s.id, s.nameKo)} — ${s.grade}">
            <img src="/assets/skill/${s.id}.png" alt="" onerror="this.remove()">
            <span>${has ? tn(s.id, s.nameKo) : '???'}</span>
            <i style="background:${GC[s.grade]}">${s.grade}</i>
          </div>`;
        }).join('') + `</div>`;
    }).join('')
    + `<div class="sh-note">스킬 개별 보너스 <b>+${pct(b.skill)}</b><br>
        ${D.codex.skill.registerRuleNote}</div>`;
  }
}

// ─────────────────────────────────────────────

/**
 * 훈련소 — goldsinks.json > sinks[training_camp]
 *   비용 = 5000 * 1.055^level, Lv200 상한, 레벨당 +0.2% (최대 +40%)
 * 무한 레벨이면 CP 천장이 사라져 스테이지 곡선 기준이 무너진다.
 */
export function trainingCost(def, level) {
  return Math.round(5000 * Math.pow(1.055, level));
}

export function trainingBonus(def, level) {
  return Math.min(def.maxBonus, level * def.bonusPerLevel);
}
