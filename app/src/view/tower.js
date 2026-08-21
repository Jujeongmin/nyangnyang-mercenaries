// 무한의 탑.
//
// tower.json > entry.model = 'unlimited'
//   입장권이 없다. 요구 CP 가 지수로 오르므로 자연히 막힌다 —
//   그 지점이 곧 "내 전투력이 어디까지인가"다. 입장권을 두면 랭킹이
//   실력이 아니라 입장권 싸움이 된다.
//
// tower.json > rewards.model = 'rotating_per_floor'
//   층마다 **다른 재화**를 순서대로 준다. 총량은 고정이고 종류만 돈다.
//   매 층 같은 걸 주면 5층쯤에서 보상을 안 보게 된다. 돌아가면 "다음 층은 뭐지"가 생긴다.
import { num, cpNum, mdb } from '../core/fmt.js';

const CUR = {
  diamond: { icon: 'CU-01', name: '다이아', bag: 'dia' },
  equip_ticket: { icon: 'CU-07', name: '장비 소환권', bag: 'eqTicket' },
  speedup_5m: { icon: 'CU-10', name: '모래시계', bag: 'hourglass' },
  merc_ticket: { icon: 'CU-05', name: '용병 소환권', bag: 'mercTicket' },
  skill_ticket: { icon: 'CU-06', name: '스킬 소환권', bag: 'skillTicket' },
};

/** tower.json > floors.requiredCpFormula */
export function towerCp(D, floor) {
  const f = D.tower.floors;
  return f.towerBaseCp * Math.pow(f.growth, Math.max(1, floor) - 1);
}

/**
 * 그 층을 처음 뚫었을 때 주는 것.
 * tower.json > rewards.rotation 을 층 번호로 돌려 하나를 고른다. 10층마다 마일스톤이 더해진다.
 */
export function towerReward(D, floor) {
  const r = D.tower.rewards;
  const rot = r.rotation[(Math.max(1, floor) - 1) % r.rotation.length];
  const out = { [rot.currency]: rot.amount };
  const ms = r.milestone;
  if (ms && floor % ms.every === 0) {
    for (const [k, v] of Object.entries(ms.bonus)) out[k] = (out[k] || 0) + v;
  }
  return out;
}

const rewardHtml = g => Object.entries(g).map(([k, v]) =>
  `<span class="tw-rw"><img src="../assets/ui/${CUR[k].icon}.png" alt="">${num(v)}</span>`).join('');

export class TowerScreen {
  constructor(root, api) {
    this.api = api;
    this.el = document.createElement('div');
    this.el.id = 'tower-scr';
    this.el.className = 'fullscr';
    this.el.innerHTML = `
      <div class="sh-head">
        <button class="sh-back">‹</button>
        <span class="sh-title">무한의 탑</span>
      </div>
      <div class="sh-body" id="twBody"></div>`;
    root.appendChild(this.el);
    this.el.querySelector('.sh-back').addEventListener('click', () => this.close());
  }

  open() { this.el.classList.add('show'); this.render(); }
  close() { this.el.classList.remove('show'); }

  render() {
    const D = this.api.data, S = this.api.state;
    const T = S.tower || (S.tower = { floor: 1, best: 0 });
    const cp = this.api.cp();
    const need = towerCp(D, T.floor);
    const can = cp >= need;

    // 지금 전투력으로 어디까지 갈 수 있는지 — 막힌 이유가 보여야 강화하러 간다
    let reach = T.floor;
    while (towerCp(D, reach + 1) <= cp && reach < T.floor + 999) reach++;

    const rows = [];
    for (let n = T.floor; n < T.floor + 6; n++) {
      const c = towerCp(D, n);
      const ok = cp >= c;
      rows.push(`<div class="tw-row${n === T.floor ? ' now' : ''}${ok ? '' : ' lock'}">
        <span class="tw-f">${n}층</span>
        <span class="tw-cp">${cpNum(Math.round(c))}</span>
        <span class="tw-rw-box">${rewardHtml(towerReward(D, n))}</span>
      </div>`);
    }

    this.el.querySelector('#twBody').innerHTML = `
      <div class="tw-hero">
        <div class="tw-best">최고 ${T.best}층</div>
        <div class="tw-now">${T.floor}<span>층 도전</span></div>
        <div class="tw-need">요구 전투력 <b class="${can ? 'ok' : 'no'}">${cpNum(Math.round(need))}</b>
          <span>/ 내 ${cpNum(Math.round(cp))}</span></div>
        <button class="tw-go" id="twGo" ${can ? '' : 'disabled'}>
          ${can ? `${T.floor}층 도전` : '전투력 부족'}</button>
        <div class="tw-reach">지금 전투력이면 <b>${reach}층</b>까지 갈 수 있다</div>
      </div>

      <div class="sh-h2">다음 층들</div>
      ${rows.join('')}

      <div class="sh-note">${mdb(D.tower.rewards.modelNote)}</div>
      <div class="sh-note">${mdb(D.tower.entry.modelNote)}</div>`;

    this.el.querySelector('#twGo').addEventListener('click', () => {
      this.close();
      this.api.challenge(T.floor);
    });
  }
}

/** 층 돌파 처리. 처음 뚫은 층에서만 보상을 준다. */
export function towerClear(D, S, toast) {
  const T = S.tower;
  const first = T.floor > T.best;
  if (first) {
    T.best = T.floor;
    const g = towerReward(D, T.floor);
    for (const [k, v] of Object.entries(g)) S[CUR[k].bag] += v;
    toast(`${T.floor}층 돌파 · ` + Object.entries(g)
      .map(([k, v]) => `${CUR[k].name} +${num(v)}`).join(' '));
  } else {
    toast(`${T.floor}층 돌파`);
  }
  T.floor++;
  return first;
}
