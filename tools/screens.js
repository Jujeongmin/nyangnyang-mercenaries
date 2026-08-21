// 모든 화면을 열어 정렬·겹침을 훑는다. 브라우저에서 불러 쓴다.
//
//   const s = await import('/tools/screens.js');
//   await s.run();                       // 지금 해상도
//   await s.runAll(resize);              // 세로형 5종 (resize(w,h) 를 넘겨야 한다)
//
// 화면 목록을 여기 두는 이유 — 한 화면을 고치면 다른 화면이 깨지는 일이 반복됐다.
// (UI 킷을 깔았더니 사이드 열 버튼이 34px→45px 로 커져 퀘스트 배너를 덮은 게 그 예다.)
// 손으로 하나씩 열어 보는 대신 전부 열어 재고, 새 화면을 만들면 여기 한 줄 추가한다.

import { strict, check, SIZES } from './uicheck.js';

const q = s => document.querySelector(s);
const wait = ms => new Promise(r => setTimeout(r, ms));

const closeAll = () => {
  document.querySelectorAll('.fullscr.show, #shop.show').forEach(e => e.classList.remove('show'));
  q('#ov')?.classList.remove('show', 'forced');
};
const openShop = t => { closeAll(); q('.nv[data-tab="shop"]').click(); q(`.sh-tabs [data-t="${t}"]`)?.click(); };
const side = s => { closeAll(); q(`.side [data-s="${s}"]`).click(); };
const nav = t => { closeAll(); q(`.nv[data-tab="${t}"]`).click(); };

/** [이름, 여는 함수, 검사할 뿌리] */
export const SCREENS = [
  ['메인', () => closeAll(), '#app'],
  ['용병탭', () => nav('merc'), '#ovcard'],
  ['스킬탭', () => nav('skill'), '#ovcard'],
  ['상점:소환', () => openShop('summon'), '#shop'],
  ['상점:소환-스킬', () => { openShop('summon'); q('.sm-t[data-track="skill"]')?.click(); }, '#shop'],
  ['상점:다이아', () => openShop('diamond'), '#shop'],
  ['상점:특가', () => openShop('deal'), '#shop'],
  ['상점:교환', () => openShop('exchange'), '#shop'],
  ['도감', () => side('codex'), '#codex'],
  ['프로필', () => { closeAll(); q('#capbox').click(); }, '#profile'],
  ['패스', () => side('pass'), '#ovcard'],
  ['랭킹', () => side('rank'), '#rank'],
  ['우편', () => side('mail'), '#mail'],
  ['설정', () => { closeAll(); q('#topSet').click(); }, '#settings'],
  ['연합', () => nav('alliance'), '#ovcard'],
  ['연합:보스', () => { nav('alliance'); q('.al-t[data-al="boss"]').click(); }, '#ovcard'],
  ['연합:상점', () => { nav('alliance'); q('.al-t[data-al="shop"]').click(); }, '#ovcard'],
  ['연합:단원', () => { nav('alliance'); q('.al-t[data-al="member"]').click(); }, '#ovcard'],
  ['던전', () => nav('dungeon'), '#ovcard'],
  ['탑', () => { nav('dungeon'); q('#twCard').click(); }, '#tower-scr'],
  ['아레나', () => side('arena'), '#ovcard'],
  ['훈장 상점', () => { side('arena'); q('#aShop').click(); }, '#ovcard'],
  ['제작대', () => { closeAll(); q('#fgLv').click(); }, '#ovcard'],
  ['훈련소', () => side('training'), '#ovcard'],
  ['출석', () => side('attend'), '#ovcard'],
  ['이벤트', () => side('event'), '#ovcard'],
];

/** 지금 해상도에서 전 화면 검사. 문제 문자열 배열을 돌려준다 (빈 배열이면 통과) */
export async function run() {
  const bad = [];
  for (const [name, open, root] of SCREENS) {
    try { open(); } catch (e) { bad.push(`${name} 열기 실패 — ${e.message}`); continue; }
    await wait(170);
    const el = document.querySelector(root);
    if (!el) { bad.push(`${name} 뿌리 없음 — ${root}`); continue; }
    const s = strict(el);
    const c = check(name);
    const msgs = [
      ...s.bad, ...s.clipped,
      ...c.overlaps.map(x => '겹침 ' + x),
      ...c.off.map(x => '화면밖 ' + x),
    ];
    if (msgs.length) bad.push(`${name} :: ${msgs.join(' | ')}`);
  }
  closeAll();
  return bad;
}

/**
 * 세로형 5종을 전부. resize(w, h) 는 **반드시** 넘겨야 한다 —
 * 안 넘기면 같은 크기로 다섯 번 재고 통과했다고 보고한다. 실제로 그래서
 * 360px 에서 사이드 열이 퀘스트 배너를 덮고 있는 걸 한참 못 봤다.
 */
export async function runAll(resize) {
  if (!resize) throw new Error('runAll(resize) 에 크기 변경 함수가 필요하다');
  const out = {};
  for (const [w, h] of SIZES) {
    await resize(w, h);
    await wait(320);
    out[`${w}x${h}`] = await run();
  }
  return out;
}

export function report(out) {
  const lines = Object.entries(out).map(([size, bad]) =>
    bad.length ? `FAIL ${size}\n${bad.map(x => '  ' + x).join('\n')}` : `OK   ${size}`);
  const n = Object.values(out).filter(b => b.length).length;
  return `${lines.join('\n')}\n\n${n ? `${n}개 해상도에서 문제` : '전 해상도·전 화면 통과'}`;
}
