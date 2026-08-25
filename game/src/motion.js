// 모션 랩 — 공격 모션을 세워놓고 프레임 단위로 본다.
//
// 전투 씬 안에서는 스테이지가 진행되며 리그가 갈아치워져 모션을 못 본다.
// 여기는 유닛 하나만 크게 띄우고 시간을 직접 잡는다.

import { UnitRig } from './view/battle/rig.js';
import { MOTIONS, motionForClass } from './view/battle/motions.js';
import { loadCutout } from './view/battle/cutout.js';

const PIXI = window.PIXI;
const $ = s => document.querySelector(s);

const UNITS = [
  { id: 'captain_warrior', cat: 'captain', name: '냥이 단장 (전사)', motion: 'slash' },
];

const st = { p: 0, playing: true, loop: true, speed: 1, rig: null, motion: 'slash', src: null };
let app, root, pivotG, strip = [];

async function boot() {
  // 용병 목록은 characters.json 에서
  try {
    const ch = await (await fetch('/data/characters.json')).json();
    for (const c of ch.characters) {
      UNITS.push({ id: c.id, cat: 'char', name: `${c.id} ${c.nameKo}`, motion: motionForClass(c.class) });
    }
  } catch { /* 없어도 단장은 본다 */ }

  const us = $('#unit');
  UNITS.forEach((u, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = u.name;
    us.appendChild(o);
  });
  const ms = $('#motion');
  for (const k of Object.keys(MOTIONS)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = k;
    ms.appendChild(o);
  }

  app = new PIXI.Application();
  await app.init({ canvas: $('#cv'), background: '#131b28', resizeTo: $('#stage'), antialias: true });
  root = new PIXI.Container(); app.stage.addChild(root);
  pivotG = new PIXI.Graphics(); app.stage.addChild(pivotG);

  // 바닥선
  const g = new PIXI.Graphics();
  app.stage.addChildAt(g, 0);
  const drawGround = () => {
    g.clear();
    const y = app.screen.height * 0.72;
    g.rect(0, y, app.screen.width, 1).fill({ color: 0xffffff, alpha: 0.10 });
  };
  drawGround();
  app.renderer.on('resize', () => { drawGround(); place(); });

  app.ticker.add(t => tick(t.deltaMS));

  us.addEventListener('change', () => load(+us.value));
  ms.addEventListener('change', () => { st.motion = ms.value; restart(); });
  $('#play').addEventListener('click', () => {
    st.playing = !st.playing;
    $('#play').textContent = st.playing ? '정지' : '재생';
    $('#play').classList.toggle('on', st.playing);
  });
  $('#loop').addEventListener('click', () => {
    st.loop = !st.loop; $('#loop').classList.toggle('on', st.loop);
  });
  document.querySelectorAll('[data-sp]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-sp]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); st.speed = +b.dataset.sp;
  }));
  $('#scrub').addEventListener('input', e => {
    st.playing = false;
    $('#play').textContent = '재생'; $('#play').classList.remove('on');
    setP(+e.target.value / 1000);
  });
  for (const [id, key] of [['c_arm', 'arm'], ['c_deform', 'deform'],
                           ['c_breathe', 'breathe'], ['c_shadow', 'shadow']]) {
    $('#' + id).addEventListener('change', e => {
      if (st.rig) st.rig.opts[key] = e.target.checked;
    });
  }
  $('#c_pivot').addEventListener('change', () => drawPivot());

  $('#play').textContent = '정지';
  $('#play').classList.add('on');
  await load(0);
}

async function load(i) {
  const u = UNITS[i];
  if (st.rig) st.rig.view.destroy({ children: true });
  // char/boss/enemy 는 webp 로 다시 구웠다 (2026-08-25 해상도 축소). captain 은 png 그대로
  const src = `/assets/${u.cat}/${u.id}.${u.cat === 'captain' ? 'png' : 'webp'}`;
  st.src = src;
  const tex = await PIXI.Assets.load(src);

  let arm = null;
  try {
    const r = await fetch(`/assets/cutout/${u.id}.json`);
    if (r.ok) arm = await loadCutout(PIXI, src, await r.json());
  } catch { /* 컷아웃 없으면 몸통만 */ }
  $('#k_cut').textContent = arm ? '있음' : '없음';
  $('#k_cut').style.color = arm ? 'var(--up)' : 'var(--dim)';

  st.motion = u.motion;
  $('#motion').value = u.motion;

  st.rig = new UnitRig(PIXI, tex, {
    size: 360, facing: 1, grid: [5, 11], motion: u.motion, arm,
    features: { breathe: $('#c_breathe').checked, deform: $('#c_deform').checked,
                shadow: $('#c_shadow').checked, arm: $('#c_arm').checked, principles: true },
  });
  root.addChild(st.rig.view);
  window.__rig = st.rig;   // 계측용
  place();
  restart();
  buildStrip();
}

function place() {
  if (!st.rig) return;
  st.rig.setBase(app.screen.width * 0.46, app.screen.height * 0.72);
}

function restart() { setP(0); }

/** 시간을 직접 잡는다. 스프링은 건너뛰고 authored 포즈를 그대로 적용한다. */
function setP(p) {
  const rig = st.rig;
  if (!rig) return;
  st.p = p;
  const M = MOTIONS[st.motion];
  rig.act = { m: M, t: M.dur * p, fired: true, onImpact: null, kind: 'attack' };
  const pose = M.pose(p);
  rig.bend = pose.bend; rig.bendVel = 0;
  // 정규값(-1~1)이 아니라 rig 가 계산한 실제 회전량을 넣어야 한다.
  // 그냥 pose.arm 을 쓰면 -1 rad(-57°) 로 읽혀 엉뚱한 각도가 된다.
  rig.armRot = rig.armTarget(pose); rig.armVel = 0;
  rig.squash = pose.squash;
  rig.springAcc = 0;
  rig.update(0.0001);
  $('#scrub').value = Math.round(p * 1000);
  $('#k_p').textContent = p.toFixed(3);
  // 정규값이 아니라 **화면상 무기가 향한 실제 각도**를 보여준다.
  // 0° = 오른쪽, -90° = 위, 180° = 왼쪽
  const absDeg = rig.armRest != null
    ? ((rig.armRest + rig.armRot) * 57.2958 + 540) % 360 - 180
    : pose.arm * 57.2958;
  $('#k_arm').textContent = absDeg.toFixed(0) + '°  (정규 ' + pose.arm.toFixed(2) + ')';
  $('#k_fwd').textContent = pose.fwd.toFixed(2);
  $('#k_sq').textContent = pose.squash.toFixed(2);
  $('#k_bend').textContent = pose.bend.toFixed(2);
  $('#k_rot').textContent = (pose.rot * 57.2958).toFixed(1) + '°';
  const im = M.impactAt;
  $('#phase').textContent = p < im * 0.9 ? '예비동작'
    : p < im + 0.06 ? '★ 타격'
    : p < im + 0.2 ? '충격 흡수' : '복귀';
  drawPivot();
}

function drawPivot() {
  pivotG.clear();
  if (!$('#c_pivot').checked || !st.rig?.armPivot) return;
  const r = st.rig;
  const s = r.scale0 * r.view.scale.x;
  const x = r.view.x + r.facing * (r.armPivot.x - r.texW / 2) * s;
  const y = r.view.y + (r.armPivot.y - r.texH) * s;
  pivotG.circle(x, y, 7).stroke({ color: 0xffc94a, width: 2 });
  const tip = r.weaponTip();
  pivotG.circle(tip.x, tip.y, 5).fill({ color: 0x5ad8ff });
  pivotG.moveTo(x, y).lineTo(tip.x, tip.y).stroke({ color: 0x5ad8ff, alpha: 0.5, width: 1.5 });
}

function tick(dtMs) {
  if (!st.rig || !st.playing) return;
  const M = MOTIONS[st.motion];
  let p = st.p + (dtMs * st.speed) / M.dur;
  if (p >= 1) p = st.loop ? 0 : 1;
  setP(p);
}

/** 아래 스트립 — 주요 프레임을 나란히 굽는다 */
function buildStrip() {
  const box = $('#strip');
  box.innerHTML = '';
  strip = [];
  const M = MOTIONS[st.motion];
  const keys = [0, M.impactAt * 0.5, M.impactAt * 0.92, M.impactAt,
                M.impactAt + 0.05, M.impactAt + 0.14, 0.78, 1];
  for (const k of keys) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    c.title = 'p=' + k.toFixed(2);
    c.addEventListener('click', () => { st.playing = false; setP(k); });
    box.appendChild(c);
    strip.push({ c, p: k });
  }
}

boot();
