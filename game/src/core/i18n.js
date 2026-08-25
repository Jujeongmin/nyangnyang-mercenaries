// 다국어 — 사전 계층.
//
// **왜 t('key') 전면 치환이 아닌가.** main.js 한 곳에만 한글 문자열이 296개고
// 그 대부분이 `${}` 가 섞인 템플릿 리터럴이다. 전량을 키로 바꾸면 한 번에
// 수백 줄이 바뀌어 리뷰가 불가능하고, 되돌리기도 비싸다.
//
// 그래서 **번역 대상을 밖에서 주입**한다:
//   · 데이터(JSON)의 nameKo 는 `L.data[id]` 로 덮어쓴다
//   · UI 고정 문구는 `t(ko)` — **한국어 원문 자체가 키다.** 키를 새로 짓지 않으므로
//     호출부가 `toast('오늘 출석은 이미 받았습니다')` → `toast(t('오늘 출석은 이미 받았습니다'))`
//     로 한 글자만 늘고, 사전에 없으면 원문이 그대로 나온다 (안전한 폴백)
//   · 숫자가 낀 문장은 사전 값에 `{0}` 자리표를 쓴다 — t('X 남음', n)
//
// 사전은 `/public/i18n/<lang>.json` 에서 런타임에 받는다. 없으면 한국어다.

let LANG = 'ko';
let DICT = {};        // { ui: {원문: 번역}, data: {id: 이름} }

export const currentLang = () => LANG;

/** 사전 로드. 실패해도 게임은 한국어로 계속 뜬다 — 번역은 부가 기능이다 */
export async function loadLang(lang) {
  LANG = lang || 'ko';
  DICT = {};
  if (LANG === 'ko') return;
  try {
    const r = await fetch(`/i18n/${LANG}.json`);
    if (r.ok) DICT = await r.json();
  } catch { /* 폴백: 한국어 */ }
}

/**
 * UI 문구. 한국어 원문이 곧 키다.
 * @param ko 한국어 원문
 * @param args {0} {1} 자리표에 넣을 값들
 */
export function t(ko, ...args) {
  let s = (DICT.ui && DICT.ui[ko]) || ko;
  if (args.length) s = s.replace(/\{(\d+)\}/g, (_, i) => args[i] ?? '');
  return s;
}

/**
 * 데이터 이름(용병·스킬·아이템). id 로 찾고 없으면 준 이름(nameKo) 그대로.
 * JSON 을 언어별로 복제하지 않는 이유 — 밸런스 수치가 사본마다 갈라진다.
 */
export function tn(id, nameKo) {
  return (DICT.data && DICT.data[id]) || nameKo;
}

/**
 * DOM 번역기 — t() 를 안 거친 화면 글자를 사전으로 치환한다.
 *
 * 이 게임 화면은 innerHTML 재조립이 수백 곳이라, 전부 `${t('…')}` 로 감싸는 것은
 * 한 번에 끝나지 않고 새 화면을 만들 때마다 빠뜨리게 된다. 대신 **원문=키** 체계를
 * 그대로 이용한다: 문서에 새로 붙는 텍스트 노드의 한국어가 사전에 있으면 바꾼다.
 *
 *   · 한국어면 아무것도 안 한다 (observer 자체를 안 단다 — 비용 0)
 *   · 사전에 없는 문장은 그대로 둔다 (t() 와 같은 폴백)
 *   · 숫자가 낀 동적 문장은 못 잡는다 — 그런 곳만 t('… {0}', v) 로 감싼다
 *   · placeholder · title 속성도 본다
 *
 * 전투는 canvas(PIXI)라 DOM 변이는 화면을 열 때뿐이다 — 프레임 비용이 아니다.
 */
export function watchDom(root = document.body) {
  if (LANG === 'ko' || typeof MutationObserver === 'undefined') return;
  // 번역이 원문보다 길어 칸을 넘칠 수 있다 (영어가 특히 길다).
  // 치환한 요소를 모아 두고 프레임 끝에 한 번만 잰다 — 치환마다 재면
  // 레이아웃 계산이 문장 수만큼 반복된다
  const dirty = new Set();
  let raf = 0;
  const queueFit = el => {
    if (!el || el.nodeType !== 1) return;
    dirty.add(el);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; for (const e of dirty) fit(e); dirty.clear(); });
  };
  /** 넘치면 글자를 줄인다. 9px 아래로는 안 간다 — 그건 읽기를 포기한 크기다 */
  const fit = el => {
    if (!el.isConnected || el.children.length > 3) return;   // 컨테이너 통째는 건드리지 않는다
    let size = parseFloat(getComputedStyle(el).fontSize);
    if (!size) return;
    let guard = 6;
    while (guard-- > 0 && size > 9 && el.scrollWidth > el.clientWidth + 1) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  };
  const xl = node => {
    if (node.nodeType === 3) {                     // 텍스트
      const raw = node.nodeValue, k = raw.trim();
      if (k && DICT.ui && DICT.ui[k]) {
        node.nodeValue = raw.replace(k, DICT.ui[k]);
        queueFit(node.parentElement);
      }
      return;
    }
    if (node.nodeType !== 1) return;
    for (const a of ['placeholder', 'title']) {
      const v = node.getAttribute?.(a);
      if (v && DICT.ui && DICT.ui[v]) node.setAttribute(a, DICT.ui[v]);
    }
    for (const c of node.childNodes) xl(c);
  };
  xl(root);                                        // 정적 마크업(index.html) 1회
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') xl(m.target);
      else for (const n of m.addedNodes) xl(n);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}

/** 언어 선택 화면에 쓸 목록. 여기 추가하면 부트 화면에도 자동으로 뜬다 */
export const LANGS = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'zh-Hans', label: '简体中文' },
  { id: 'zh-Hant', label: '繁體中文' },
];
