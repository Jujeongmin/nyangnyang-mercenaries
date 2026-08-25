// 컷아웃 편집기 — 무기 팔을 다각형으로 지정하고 어깨 관절을 찍는다.
//
// PNG 를 두 장으로 쪼개 저장하지 않는다. **다각형 좌표만 JSON 으로 저장**하고
// 게임이 런타임에 캔버스로 잘라 쓴다 (view/battle/cutout.js).
// 파일이 늘지 않고, 나중에 다시 열어 고칠 수 있다.

import { buildParts } from './view/battle/cutout.js';

const $ = s => document.querySelector(s);
const API = id => `/api/cutout/${id}`;

// 편집 대상 — 무기를 든 것만
const TARGETS = [
  ['captain', 'captain_warrior'],
  ...['R-02', 'R-03', 'R-04', 'R-07', 'R-08', 'R-09',
      'SR-01', 'SR-02', 'SR-03', 'SR-05', 'SR-06', 'SR-07', 'SR-08',
      'SSR-01', 'SSR-02', 'SSR-03', 'SSR-04', 'SSR-05',
      'UR-01', 'UR-02', 'UR-03', 'LR-01', 'LR-02',
      'N-01', 'N-02', 'N-03', 'N-04', 'N-05', 'N-06',
      'R-05', 'R-06', 'SR-04'].map(id => ['char', id]),
  ...['E-03', 'E-05', 'E-12'].map(id => ['enemy', id]),
  ...['B-02', 'B-03'].map(id => ['boss', id]),
];

const st = {
  cat: 'captain', id: 'captain_warrior',
  img: null, poly: [], pivot: null, tip: null,
  mode: 'poly', scale: 1, preview: 0,
};

const cv = $('#cv');
const cx = cv.getContext('2d');

function fit() {
  const box = $('#stage').getBoundingClientRect();
  const s = Math.min((box.width - 40) / st.img.width, (box.height - 40) / st.img.height, 1);
  st.scale = s;
  cv.width = Math.round(st.img.width * s);
  cv.height = Math.round(st.img.height * s);
}

async function load(cat, id) {
  st.cat = cat; st.id = id;
  st.poly = []; st.pivot = null; st.tip = null; st.preview = 0;
  const img = new Image();
  // char/boss/enemy 는 webp 로 다시 구웠다 (2026-08-25). captain 만 png 그대로
  img.src = `/assets/${cat}/${id}.${cat === 'captain' ? 'png' : 'webp'}`;
  await img.decode();
  st.img = img;
  fit();
  // 기존 컷아웃이 있으면 불러온다
  try {
    const r = await fetch(`/assets/cutout/${id}.json`);
    if (r.ok) {
      const j = await r.json();
      st.poly = j.polygon || []; st.pivot = j.pivot || null; st.tip = j.tip || null;
      $('#mirror').checked = !!j.mirror;
      msg('기존 컷아웃을 불러왔다.', 'var(--dim)');
    } else msg('');
  } catch { msg(''); }
  draw();
}

function toImg(e) {
  const r = cv.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - r.left) / st.scale),
    y: Math.round((e.clientY - r.top) / st.scale),
  };
}

function draw() {
  const { width: W, height: H } = cv;
  cx.clearRect(0, 0, W, H);
  cx.drawImage(st.img, 0, 0, W, H);

  const S = st.scale;
  // 팔 영역
  if (st.poly.length) {
    cx.save();
    cx.beginPath();
    st.poly.forEach((p, i) => (i ? cx.lineTo(p.x * S, p.y * S) : cx.moveTo(p.x * S, p.y * S)));
    if (st.poly.length > 2) cx.closePath();
    cx.fillStyle = 'rgba(90,216,106,.22)';
    cx.strokeStyle = '#5ad86a';
    cx.lineWidth = 2;
    cx.fill(); cx.stroke();
    cx.restore();
    for (const p of st.poly) {
      cx.beginPath();
      cx.arc(p.x * S, p.y * S, 4, 0, 7);
      cx.fillStyle = '#5ad86a'; cx.fill();
      cx.strokeStyle = '#170f0b'; cx.lineWidth = 1.5; cx.stroke();
    }
  }
  // 어깨
  if (st.pivot) {
    const x = st.pivot.x * S, y = st.pivot.y * S;
    cx.beginPath(); cx.arc(x, y, 9, 0, 7);
    cx.strokeStyle = '#ffc94a'; cx.lineWidth = 2.5; cx.stroke();
    cx.beginPath(); cx.moveTo(x - 14, y); cx.lineTo(x + 14, y);
    cx.moveTo(x, y - 14); cx.lineTo(x, y + 14); cx.stroke();
  }
  // 무기 끝
  if (st.tip) {
    const x = st.tip.x * S, y = st.tip.y * S;
    cx.beginPath(); cx.arc(x, y, 6, 0, 7);
    cx.fillStyle = '#5ad8ff'; cx.fill();
    if (st.pivot) {
      cx.beginPath();
      cx.moveTo(st.pivot.x * S, st.pivot.y * S); cx.lineTo(x, y);
      cx.strokeStyle = '#5ad8ff88'; cx.lineWidth = 1.5; cx.setLineDash([5, 4]);
      cx.stroke(); cx.setLineDash([]);
    }
  }

  $('#k_pts').textContent = st.poly.length;
  $('#k_pivot').textContent = st.pivot ? `${st.pivot.x}, ${st.pivot.y}` : '—';
  $('#k_tip').textContent = st.tip ? `${st.tip.x}, ${st.tip.y}` : '—';
  $('#save').disabled = !(st.poly.length >= 3 && st.pivot);
}

const msg = (t, c) => { $('#msg').textContent = t; $('#msg').style.color = c || 'var(--dim)'; };

cv.addEventListener('pointerdown', e => {
  const p = toImg(e);
  if (st.mode === 'poly') st.poly.push(p);
  else if (st.mode === 'pivot') st.pivot = p;
  else st.tip = p;
  draw();
});

document.querySelectorAll('.mode button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.mode button').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  st.mode = b.dataset.m;
}));

$('#undo').addEventListener('click', () => { st.poly.pop(); draw(); });
$('#clear').addEventListener('click', () => {
  st.poly = []; st.pivot = null; st.tip = null; draw();
});

// 회전 미리보기 — 실제 게임과 같은 방식으로 잘라서 돌려본다
$('#test').addEventListener('click', () => {
  if (st.poly.length < 3 || !st.pivot) return msg('다각형과 어깨를 먼저 지정해라', 'var(--warn)');
  const parts = buildParts(st.img, st.poly, st.pivot);
  const mir = $('#mirror').checked;
  const box = $('#preview');
  box.innerHTML = '';
  const SZ = 108;
  for (const deg of [-46, 0, 46, 92]) {
    const c = document.createElement('canvas');
    c.width = SZ; c.height = SZ;
    const g = c.getContext('2d');
    const s = SZ / Math.max(st.img.width, st.img.height);
    g.drawImage(parts.body, 0, 0, SZ, SZ);
    g.save();
    g.translate(st.pivot.x * s, st.pivot.y * s);
    g.rotate(deg * Math.PI / 180);
    if (mir) g.scale(-1, 1);
    g.translate(-st.pivot.x * s, -st.pivot.y * s);
    g.drawImage(parts.arm, 0, 0, SZ, SZ);
    g.restore();
    g.fillStyle = '#8fa0ba';
    g.font = '10px sans-serif';
    g.fillText(deg + '°', 4, 12);
    box.appendChild(c);
  }
  msg('구멍이 보이면 다각형을 어깨 쪽으로 더 넓혀라.', 'var(--dim)');
});

$('#save').addEventListener('click', async () => {
  const body = {
    id: st.id, cat: st.cat,
    size: { w: st.img.width, h: st.img.height },
    polygon: st.poly, pivot: st.pivot,
    mirror: $('#mirror').checked,
    tip: st.tip || { x: st.pivot.x, y: Math.round(st.pivot.y - st.img.height * 0.3) },
  };
  try {
    const r = await fetch(API(st.id), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    msg(`저장됨 — ${j.saved}`, 'var(--up)');
    markDone(st.id);
  } catch (e) {
    msg('저장 실패: ' + e.message + '  (tools/devserver.js 로 띄웠는지 확인)', 'var(--warn)');
  }
});

function markDone(id) {
  const o = [...$('#pick').options].find(o => o.value.endsWith('/' + id));
  if (o && !o.textContent.startsWith('✅')) o.textContent = '✅ ' + o.textContent;
}

// --- 부트 ---
(async function boot() {
  const sel = $('#pick');
  let done = new Set();
  try {
    const r = await fetch('/assets/cutout/');
    if (r.ok) {
      const t = await r.text();
      done = new Set([...t.matchAll(/([\w.-]+)\.json/g)].map(m => m[1]));
    }
  } catch { /* 목록을 못 받아도 편집은 된다 */ }

  for (const [cat, id] of TARGETS) {
    const o = document.createElement('option');
    o.value = `${cat}/${id}`;
    o.textContent = (done.has(id) ? '✅ ' : '') + `${cat} / ${id}`;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    const [cat, id] = sel.value.split('/');
    load(cat, id);
  });
  addEventListener('resize', () => { fit(); draw(); });
  await load('captain', 'captain_warrior');
})();
