// UI 겹침·화면밖 검사기. 브라우저에서 불러 쓴다.
//
//   const m = await import('/tools/uicheck.js');
//   m.check();                    // 현재 해상도
//   await m.sweep();              // 세로형 5종을 순회
//
// 이 게임은 모바일 **세로형**이다. 가로가 좁아질수록 가운데 정렬된 것과
// 좌우 고정된 것이 먼저 부딪힌다. 그래서 폭이 제일 좁은 360 부터 본다.

/** 검사 대상. 실제로 눌리거나 읽혀야 하는 것만 넣는다. */
const TARGETS = [
  '#top', '#stg', '#enc', '#timer', '#speed', '#bossGo', '#bossHp',
  '#sideL', '#sideR', '#corner', '#quest', '#chest', '#skills', '#dpsInfo',
  '#chat', '#eq', '#eqInfo', '#fgObj', '#fgLv', '#b_auto', '#fgTicket', '#nav',
];

/** 부모-자식이거나 의도적으로 겹치는 쌍 */
const ALLOWED = [
  ['#corner', '#quest'], ['#top', '#stg'], ['#top', '#timer'],
  ['#chest', '#chestT'], ['#fgObj', '#fgTicket'],
  ['#skills', '#dpsInfo'], ['#bossHp', '#bhName'],
];
const allowed = (a, b) => ALLOWED.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

const box = el => {
  const r = el.getBoundingClientRect();
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
};
const visible = el => {
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
};

export function check(label = `${innerWidth}x${innerHeight}`) {
  const items = [];
  for (const sel of TARGETS) {
    const el = document.querySelector(sel);
    if (el && visible(el)) items.push({ sel, ...box(el) });
  }

  const overlaps = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (allowed(a.sel, b.sel)) continue;
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ox > 1 && oy > 1) {
        overlaps.push(`${a.sel} x ${b.sel}  ${Math.round(ox)}x${Math.round(oy)}px`);
      }
    }
  }

  // 화면 밖으로 나간 것. 세로형에서는 가로 넘침이 치명적이다.
  const off = items
    .filter(x => x.l < -1 || x.r > innerWidth + 1)
    .map(x => `${x.sel} [${Math.round(x.l)}~${Math.round(x.r)}] / 폭 ${innerWidth}`);

  // 손가락으로 누르기엔 작은 것 (권장 44px, 최소 32px)
  const tiny = items
    .filter(x => {
      const el = document.querySelector(x.sel);
      const clickable = el.tagName === 'BUTTON' || getComputedStyle(el).cursor === 'pointer';
      return clickable && (x.w < 32 || x.h < 32);
    })
    .map(x => `${x.sel} ${Math.round(x.w)}x${Math.round(x.h)}`);

  return { label, overlaps, off, tiny, ok: !overlaps.length && !off.length };
}

/** 세로형 대표 해상도. 좁은 순. */
export const SIZES = [
  [360, 640],   // 갤럭시 A 계열 / 가장 좁음
  [375, 667],   // iPhone SE
  [390, 844],   // iPhone 14
  [412, 915],   // Pixel 7
  [430, 932],   // iPhone 15 Pro Max
];

/**
 * 뷰포트를 실제로 바꿀 수 없는 환경(iframe 등)에서는 #app 폭만 흉내낸다.
 * 자동화 도구로 resize 할 수 있으면 그쪽이 정확하다.
 */
export async function sweep(resize) {
  if (!resize) {
    // 이 함정에 한 번 빠졌다. resize 없이 부르면 크기가 안 바뀐 채로 5번 검사하고
    // 전부 통과했다고 보고한다 — 360px 에서 사이드 열이 퀘스트 배너를 덮고 있는데도.
    throw new Error(
      'sweep(resize) 에 크기 변경 함수를 넘겨야 한다. 없으면 같은 크기로 5번 잴 뿐이다. '
      + '  브라우저 자동화라면 resize 콜백을, 아니면 해상도마다 check() 를 직접 불러라.');
  }
  const out = [];
  for (const [w, h] of SIZES) {
    await resize(w, h);
    await new Promise(r => setTimeout(r, 260));
    out.push(check(`${w}x${h}`));
  }
  return out;
}

export function report(results) {
  const bad = results.filter(r => !r.ok);
  const lines = results.map(r => {
    const head = `${r.ok ? 'OK  ' : 'FAIL'} ${r.label}`;
    const body = [
      ...r.overlaps.map(x => `      겹침 ${x}`),
      ...r.off.map(x => `      화면밖 ${x}`),
      ...r.tiny.map(x => `      작음 ${x}`),
    ];
    return [head, ...body].join('\n');
  });
  return `${lines.join('\n')}\n\n${bad.length ? `${bad.length}개 해상도에서 문제` : '전 해상도 통과'}`;
}

// ─────────────────────────────────────────────────────────────────────────
// strict() — 지정한 목록이 아니라 **화면에 떠 있는 것 전부**를 훑는다.
//
// check() 는 TARGETS 에 적어 둔 것끼리만 본다. 그래서 상점 헤더의 제목이 장식 뿔에
// 올라타거나, 알약이 띠 밖으로 삐져나오는 건 못 잡았다 — 목록에 없는 요소였다.
// 여기서는 부모-자식 관계를 본다. 자식이 부모의 padding box 를 뚫으면 정렬이 깨진 것이다.
// ─────────────────────────────────────────────────────────────────────────

/** 뚫고 나가도 되는 것. 의도적으로 걸치게 만든 장식·뱃지들. */
const BLEED_OK = [
  'sh-tag',      // 10연 할인 리본 — 모서리에 걸치는 게 디자인
  'sh-ribbon',   // 첫 결제 2배 띠
  'badge', 'arrow', 'cpup', 'dotw',
  'fgHammer', 'fgHeroHam', 'fgSpark', 'fgHeroSpark', 'fgTicket', 'fgLv', 'fgBadge',
  'lockIc', 'aShop',
  'chestImg',    // 보물상자는 일부러 위아래로 통통 튄다 (chBob)
];
const bleedOk = el =>
  BLEED_OK.some(c => el.id === c || el.classList.contains(c)) ||
  getComputedStyle(el).position === 'absolute';

/** 스크롤 컨테이너는 세로로 넘치는 게 정상이다. 가로만 본다. */
const scrollsY = el => {
  const o = getComputedStyle(el).overflowY;
  return o === 'auto' || o === 'scroll';
};

export function strict(root = document.body) {
  const bad = [];
  const clipped = [];

  const walk = el => {
    for (const kid of el.children) {
      if (!visible(kid)) continue;
      const p = el.getBoundingClientRect();
      const k = kid.getBoundingClientRect();
      const s = getComputedStyle(el);
      const pad = {
        l: p.left + parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth),
        r: p.right - parseFloat(s.paddingRight) - parseFloat(s.borderRightWidth),
        t: p.top + parseFloat(s.paddingTop) + parseFloat(s.borderTopWidth),
        b: p.bottom - parseFloat(s.paddingBottom) - parseFloat(s.borderBottomWidth),
      };
      // 부모가 잘라내거나(overflow) 자식이 스스로 clip-path 로 잘리면 눈에는 안 보인다.
      // 상자만 재면 아바타처럼 일부러 확대해 넣은 그림이 전부 오검출로 잡힌다.
      const pClips = /hidden|clip/.test(s.overflow);
      const kClips = getComputedStyle(kid).clipPath !== 'none';
      if (!bleedOk(kid) && !pClips && !kClips) {
        const dx = Math.max(pad.l - k.left, k.right - pad.r);
        const dy = scrollsY(el) ? 0 : Math.max(pad.t - k.top, k.bottom - pad.b);
        if (dx > 1.5 || dy > 1.5) {
          bad.push(`${tag(kid)} 가 ${tag(el)} 밖으로 `
            + `${dx > 1.5 ? `가로 ${Math.round(dx)}px ` : ''}`
            + `${dy > 1.5 ? `세로 ${Math.round(dy)}px` : ''}`.trim());
        }
      }
      // 글자가 자기 상자보다 크면 잘려 읽힌다.
      // scrollWidth 는 절대배치 자식까지 센다 — 모서리에 일부러 걸친 리본(.sh-tag)이
      // 있으면 글자는 멀쩡한데 잘렸다고 나온다. 그런 자식이 있으면 건너뛴다.
      const bleeder = [...kid.children].some(c => bleedOk(c));
      if (!bleeder && kid.scrollWidth > kid.clientWidth + 1 && !scrollsX(kid) && hasText(kid)) {
        clipped.push(`${tag(kid)} 글자 잘림 ${kid.scrollWidth}>${kid.clientWidth}`);
      }
      walk(kid);
    }
  };
  walk(root);
  return { bad: [...new Set(bad)], clipped: [...new Set(clipped)] };
}

const scrollsX = el => {
  const o = getComputedStyle(el).overflowX;
  return o === 'auto' || o === 'scroll';
};
const hasText = el =>
  [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
const tag = el =>
  el.id ? '#' + el.id
    : el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : el.tagName.toLowerCase();

/** 화면 하나를 열고 strict 로 훑는다. open 은 그 화면을 여는 함수. */
export async function strictScreen(name, open, root) {
  open();
  await new Promise(r => setTimeout(r, 220));
  const r = strict(root ? document.querySelector(root) : document.body);
  return { name, ...r, ok: !r.bad.length && !r.clipped.length };
}
