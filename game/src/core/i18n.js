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

/** 언어 선택 화면에 쓸 목록. 여기 추가하면 부트 화면에도 자동으로 뜬다 */
export const LANGS = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
];
