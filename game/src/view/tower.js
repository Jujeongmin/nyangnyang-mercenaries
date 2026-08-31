// 무한의 탑.
//
// **화면이 탑 그 자체다** (단장 스케치 2026-08-31). 층이 아래에서 위로 쌓이고,
// 맨 아래 칸이 지금 서 있는 층이다. 한 층은 가로 띠 하나이고 그 안에
// 왼쪽부터 [단장] [보상] [보스] 세 칸이 선다 — 내가 어디 있고, 뭘 받고,
// 누구를 넘어야 하는지가 한 줄에 다 있다.
//
// 예전에는 위에 보라색 히어로 패널이 있고 그 아래 층 목록이 따로 있었다.
// 같은 것(지금 층·요구 전투력·도전)이 두 곳에 적혀 화면이 두 번 말했다.
// 패널을 지우고 그 역할을 **맨 아래 층 띠**에 넘겼다.
//
// 층 폭은 전부 같다. 위로 갈수록 좁히는 원근 실루엣은 안 쓴다 (단장 확정) —
// 좁아지면 위층의 보상·보스 칸이 같이 줄어 읽기가 나빠진다.
//
// tower.json > entry.model = 'unlimited'
//   입장권이 없다. 요구 CP 가 지수로 오르므로 자연히 막힌다 —
//   그 지점이 곧 "내 전투력이 어디까지인가"다.
//
//   **요구 CP 미달이어도 도전은 열어 둔다** (2026-08-31). 버튼을 잠그면
//   "내 한계"를 화면이 대신 판정해 버린다. 실패해도 잃는 것이 없다.
//
// tower.json > rewards.model = 'rotating_per_floor'
//   층마다 다른 재화를 순서대로 준다. 총량은 고정이고 종류만 돈다.
import { num, cpNum } from '../core/fmt.js';

const CUR = {
  diamond: { icon: 'CU-01', name: '다이아', bag: 'dia' },
  equip_ticket: { icon: 'CU-07', name: '장비 소환권', bag: 'eqTicket' },
  speedup_5m: { icon: 'CU-10', name: '모래시계', bag: 'hourglass' },
  merc_ticket: { icon: 'CU-05', name: '용병 소환권', bag: 'mercTicket' },
  skill_ticket: { icon: 'CU-06', name: '스킬 소환권', bag: 'skillTicket' },
};

/** 한 화면에 쌓는 층 수. 맨 아래가 지금 층이고 위로 이만큼 미리 보여준다. */
const ROWS = 12;

/** tower.json > floors.requiredCpFormula */
export function towerCp(D, floor) {
  const f = D.tower.floors;
  return f.towerBaseCp * Math.pow(f.growth, Math.max(1, floor) - 1);
}

/**
 * 그 층의 보스 그림. **scene.startTowerFloor 와 같은 식이어야 한다** —
 * 목록에서 본 얼굴과 실제로 나오는 얼굴이 다르면 목록이 거짓말이 된다.
 * (tower.json > floors.enemy.assetRotation — B-01~B-06 을 층마다 순환)
 */
export function towerBoss(floor) {
  return `B-${String(1 + (Math.max(1, floor) % 6)).padStart(2, '0')}`;
}

/** 10층마다의 마일스톤 층인가 — 보상이 한 번 더 붙는 자리다 */
const isMilestone = (D, floor) => floor % (D.tower.rewards.milestone?.every || 10) === 0;

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
  `<span class="tw-rw"><img src="/assets/ui/${CUR[k].icon}.png" alt="">${num(v)}</span>`).join('');

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


    const capImg = `/assets/captain/captain_${S.promoClass || 'warrior'}.webp`;

    // **높은 층부터 그린다.** DOM 위쪽이 곧 탑 위쪽이라, 마지막에 그린
    // 지금 층이 화면 맨 아래에 온다 — 올라갈 길이 위로 보인다
    const rows = [];
    for (let n = T.floor + ROWS - 1; n >= T.floor; n--) {
      const c = towerCp(D, n);
      const ok = cp >= c;
      const now = n === T.floor;
      const ms = isMilestone(D, n);
      // 층 띠 배경은 세 장을 돌려 쓴다 — 같은 그림이 열두 줄이면 탑이 아니라 벽지다
      rows.push(`<div class="tw-fl${now ? ' now' : ''}${ms ? ' ms' : ''}" data-floor="${n}"
        style="--tw-band:url(/assets/tower/TW-FLOOR-0${1 + (n % 3)}.webp);--tw-i:${n % 7}">
        <span class="tw-f">${n}<i>F</i></span>
        <span class="tw-me">${now
          ? `<img src="${capImg}" alt=""
              onerror="this.src='/assets/captain/captain_warrior.webp'">`
          : ''}</span>
        <span class="tw-rw-box">${rewardHtml(towerReward(D, n))}</span>
        <span class="tw-boss">
          <img src="/assets/boss/${towerBoss(n)}.webp" alt=""
            onerror="this.replaceWith(document.createTextNode('👹'))">
          <i class="${ok ? 'ok' : 'no'}">${cpNum(Math.round(c))}</i>
          ${ms ? '<em class="tw-ms">10F</em>' : ''}
        </span>
        ${now
          ? `<button class="tw-btn${ok ? '' : ' risky'}" data-go="${n}">도전</button>`
          : '<span class="tw-btn off"></span>'}
      </div>`);
    }

    this.el.querySelector('#twBody').innerHTML = `
      <div class="tw-line">
        <b>최고 ${T.best}층</b>
        <span>내 전투력 ${cpNum(Math.round(cp))}</span>
      </div>
      <div class="tw-tower">${rows.join('')}</div>`;

    // **맨 아래로 내려 둔다.** 지금 층이 목록 바닥이라, 열자마자 위(23층)를
    // 보고 있으면 내가 어디 서 있는지가 화면 밖이다
    const body = this.el.querySelector('#twBody');
    body.scrollTop = body.scrollHeight;

    // 도전은 **지금 층 띠에만** 붙는다. 줄 전체가 아니라 버튼이다 —
    // 층 띠를 통째로 누르게 두면 스크롤하다 손이 스치면 전투가 시작된다
    this.el.querySelector('[data-go]')?.addEventListener('click', () => {
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
