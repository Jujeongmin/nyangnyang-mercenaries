// 전투 연출 데모 — 기존 2D 에셋으로 rig / motions / impact / numbers 를 눈으로 비교한다.
// 게임 로직 없음. 연출만 본다.

import { UnitRig } from './view/battle/rig.js';
import { Impact } from './view/battle/impact.js';
import { DamageNumbers } from './view/battle/numbers.js';
import { MOTIONS } from './view/battle/motions.js';

const PIXI = window.PIXI;
const $ = s => document.querySelector(s);

// 무기 종류별로 한 명씩 세운다
const ALLIES = [
  { src: '../assets/captain/captain_warrior.png', motion: 'slash', label: '전사 · 베기', size: 150 },
  { src: '../assets/char/SR-06.png', motion: 'draw', label: '궁수 · 활', size: 146 },
  { src: '../assets/char/SR-05.png', motion: 'cast', label: '마법사 · 지팡이', size: 150 },
];
const ENEMIES = [
  { src: '../assets/enemy/E-01.png', motion: 'pounce', label: '무기없음 · 점프', size: 128 },
  { src: '../assets/enemy/E-03.png', motion: 'slash', label: '전사 · 베기', size: 132 },
  { src: '../assets/enemy/E-05.png', motion: 'slash', label: '전사 · 베기', size: 138 },
];
const BG = '../assets/bg/BG-01.png';

const OPTS = [
  ['g1', '스프라이트'],
  ['principles', '애니메이션 원칙', '예비동작·오버슛·스쿼시. 트랜스폼을 쓰되 제대로 쓰는 것'],
  ['deform', '메시 디폼', '격자 정점을 흔든다. 자르지 않고 휘어짐·탄성을 만든다'],
  ['breathe', '호흡', '가만히 있어도 미세하게 움직인다'],
  ['shadow', '바닥 그림자', '뜬 높이에 반비례. 무게가 생긴다'],
  ['arm', '팔 파트', '컷아웃한 무기 팔을 관절로 회전. 아직 컷아웃 없음'],
  ['g2', '타격감'],
  ['hitStop', '히트스톱', '명중 순간 70ms 전체 정지. 단일 항목 중 효과 최대'],
  ['shake', '화면 흔들림', '스킬 타격에만. 평타마다 흔들면 계속 진동해서 스킬이 안 특별해진다'],
  ['flash', '피격 플래시', '맞은 쪽 흰색 2프레임'],
  ['dust', '먼지', '돌진·착지에 흙먼지'],
  ['g3', 'UI'],
  ['numbers', '데미지 숫자', '포물선 + 스케일 팝. 크리는 크기·색이 다르다'],
];

const state = Object.fromEntries(OPTS.filter(o => o.length > 2).map(o => [o[0], true]));

(async function main() {
  const app = new PIXI.Application();
  await app.init({ canvas: $('#cv'), background: '#111823', resizeTo: $('#stage'), antialias: true });

  const world = new PIXI.Container(); app.stage.addChild(world);
  const bgLayer = new PIXI.Container(); world.addChild(bgLayer);
  const field = new PIXI.Container(); field.sortableChildren = true; world.addChild(field);
  const uiLayer = new PIXI.Container(); world.addChild(uiLayer);

  const impact = new Impact(PIXI, world);
  const numbers = new DamageNumbers(PIXI, uiLayer);

  try {
    const t = await PIXI.Assets.load(BG);
    const sp = new PIXI.Sprite(t);
    bgLayer.addChild(sp);
    const fit = () => {
      const s = Math.max(app.screen.width / t.width, app.screen.height / t.height);
      sp.scale.set(s);
      sp.x = (app.screen.width - t.width * s) / 2;
      sp.y = (app.screen.height - t.height * s) / 2;
    };
    fit(); app.renderer.on('resize', fit);
  } catch { /* 배경 없어도 돈다 */ }

  // 컷아웃이 있으면 팔 파트를 붙인다 (없으면 몸통만)
  async function loadArm(src) {
    const id = src.split('/').pop().replace('.png', '');
    try {
      const meta = await fetch(`../assets/cutout/${id}.json`).then(r => r.ok ? r.json() : null);
      if (!meta) return null;
      const texture = await PIXI.Assets.load(`../assets/cutout/${id}_arm.png`);
      return { texture, pivot: meta.pivot, tip: meta.tip };
    } catch { return null; }
  }

  const mk = async (def, facing) => {
    const tex = await PIXI.Assets.load(def.src);
    const arm = await loadArm(def.src);
    const rig = new UnitRig(PIXI, tex, {
      size: def.size, facing, grid: [5, 9], motion: def.motion, arm,
    });
    rig.label = def.label;
    rig.hasArm = !!arm;
    field.addChild(rig.view);

    return rig;
  };

  const allies = [], enemies = [];
  for (const d of ALLIES) allies.push(await mk(d, 1));
  for (const d of ENEMIES) enemies.push(await mk(d, -1));
  const all = [...allies, ...enemies];

  const layout = () => {
    const W = app.screen.width, H = app.screen.height;
    const groundY = H * 0.86;
    const gap = Math.min(W * 0.085, 96);
    allies.forEach((r, i) => { r.setBase(W * 0.30 - i * gap * 0.55, groundY - i * H * 0.10); r.view.zIndex = 10 - i; });
    enemies.forEach((r, i) => { r.setBase(W * 0.70 + i * gap * 0.55, groundY - i * H * 0.10); r.view.zIndex = 10 - i; });
  };
  layout();
  app.renderer.on('resize', layout);

  const applyOpts = () => {
    for (const r of all) Object.assign(r.opts, {
      principles: state.principles, deform: state.deform,
      breathe: state.breathe, shadow: state.shadow, arm: state.arm,
    });
    Object.assign(impact.opts, {
      hitStop: state.hitStop, shake: state.shake, flash: state.flash, dust: state.dust,
    });
    numbers.enabled = state.numbers;
  };

  /**
   * @param skill 스킬 타격인가. 화면 흔들림은 스킬에만 붙는다 —
   *   평타마다 흔들면 초당 여러 번 흔들려서 화면이 계속 진동하고,
   *   정작 스킬이 터졌을 때 특별해 보이지 않는다.
   */
  function strike(from, to, skill = false) {
    if (!from || !to) return;
    const dir = from.facing;
    // 점프 공격은 착지 순간 먼지가 크게 인다
    impact.puff(from.view.x + dir * from.w * 0.1, from.view.y, dir, from.motion === 'pounce' ? 8 : 4);

    from.attack(() => {
      const crit = Math.random() < 0.28;
      const mult = (skill ? 6 : 1) * (crit ? 3.2 : 1);
      const dmg = Math.round(mult * (900 + Math.random() * 2600));
      to.hit(dir);
      impact.hitStop(skill ? (crit ? 130 : 100) : from.motion === 'pounce' ? 90 : 70);
      if (skill) impact.shake(crit ? 16 : 11, dir);
      impact.flash(to);
      impact.puff(to.view.x - dir * to.w * 0.12, to.view.y, -dir, skill ? 12 : crit ? 9 : 5);
      numbers.spawn(to.view.x, to.view.y - to.h * 0.95, dmg, crit ? 'crit' : 'normal');
    });
  }

  // 방치형은 턴제가 아니다. 각 유닛이 자기 쿨타임으로 계속 때린다.
  // 쿨타임을 유닛마다 어긋나게 줘야 화면이 겹치지 않고 계속 움직인다.
  let paused = false;
  for (const r of all) {
    r.cd = 0.4 + Math.random() * 1.2;
    r.cdMax = 1.1 + Math.random() * 0.9;
    r.skillCd = 4 + Math.random() * 4;      // 액티브 스킬 쿨타임
  }
  const tick = dtMs => {
    const s = dtMs / 1000;
    for (const r of all) {
      r.cd -= s;
      r.skillCd -= s;
      if (r.cd > 0 || r.act) continue;
      const foes = allies.includes(r) ? enemies : allies;
      // 스킬이 준비됐으면 스킬로 친다. 아군만 — 화면 흔들림이 겹치지 않게.
      const useSkill = r.skillCd <= 0 && allies.includes(r);
      if (useSkill) r.skillCd = 6 + Math.random() * 5;
      r.cd = r.cdMax;
      strike(r, foes[(Math.random() * foes.length) | 0], useSkill);
    }
  };

  // 모든 유닛이 동시에 자기 모션을 보여준다 — 비교용
  const showAll = () => {
    allies.forEach((r, i) => setTimeout(() => strike(r, enemies[i % enemies.length], true), i * 220));
    enemies.forEach((r, i) => setTimeout(() => strike(r, allies[i % allies.length]), 700 + i * 220));
  };

  $('#stage').addEventListener('pointerdown', showAll);
  addEventListener('keydown', e => { if (e.code === 'Space') { paused = !paused; e.preventDefault(); } });

  // Verse8 등 실제 실행 환경은 144fps 가 아니다. 저프레임에서 동작이 같은지
  // 확인할 수 있게 캡을 둔다. 스프링은 고정 스텝이라 결과가 같아야 한다.
  let capFps = 60, capAcc = 0;
  window.__setCap = v => { capFps = v; capAcc = 0; };

  let fpsT = 0, frames = 0;
  app.ticker.add(t => {
    let raw = t.deltaMS;
    if (paused) return;
    if (capFps) {
      capAcc += raw;
      const need = 1000 / capFps;
      if (capAcc < need) return;
      raw = capAcc; capAcc = 0;
    }
    const dt = impact.update(raw);
    for (const r of all) r.update(dt);
    numbers.update(dt);
    tick(dt);

    frames++; fpsT += raw;
    if (fpsT > 500) { $('#fps').textContent = `${Math.round(frames / (fpsT / 1000))} fps`; frames = 0; fpsT = 0; }
  });

  // --- 사이드 패널 ---
  const box = $('#opts');
  for (const o of OPTS) {
    if (o.length === 2) {
      const d = document.createElement('div');
      d.className = 'grp'; d.textContent = o[1];
      box.appendChild(d);
      continue;
    }
    const [key, name, why] = o;
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" checked><span class="n">${name}</span>`;
    l.querySelector('input').dataset.key = key;
    l.querySelector('input').addEventListener('change', e => {
      state[key] = e.target.checked; applyOpts(); syncPreset();
    });
    box.appendChild(l);
    const w = document.createElement('span');
    w.className = 'why'; w.textContent = why;
    box.appendChild(w);
  }

  const setAll = v => {
    for (const k of Object.keys(state)) state[k] = v;
    box.querySelectorAll('input').forEach(i => { i.checked = v; });
    applyOpts();
  };
  const syncPreset = () => {
    const on = Object.values(state).filter(Boolean).length;
    $('#p_min').classList.toggle('on', on === 0);
    $('#p_full').classList.toggle('on', on === Object.keys(state).length);
  };
  document.querySelectorAll('#caps button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#caps button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    window.__setCap(+b.dataset.fps);
  }));

  $('#p_min').addEventListener('click', () => { setAll(false); syncPreset(); });
  $('#p_full').addEventListener('click', () => { setAll(true); syncPreset(); });

  // 범례 — 어떤 유닛이 어떤 모션인지
  const legend = document.createElement('div');
  legend.innerHTML = '<div class="grp">모션</div>'
    + all.map(r => `<div class="lg"><b>${r.label.split(' · ')[0]}</b>`
      + `<span>${r.label.split(' · ')[1]}</span>`
      + `<i>${r.hasArm ? '팔 분리됨' : '팔 미분리'}</i></div>`).join('');
  $('#opts').appendChild(legend);

  applyOpts();
})();
