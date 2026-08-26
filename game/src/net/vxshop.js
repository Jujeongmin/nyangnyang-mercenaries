// VXShop 결제 — Verse8 상점으로 나가는 유일한 창구.
//
// net/ads.js 와 같은 원칙이다: **SDK 는 여기서만 만진다.** 호출부(main.js,
// view/shop.js)는 productId 하나만 알면 되고, 나중에 SDK 가 바뀌어도 이 파일만
// 고친다.
//
// **호스트 안에서만 동작한다.** verse8.io 웹셸 밖(로컬 dev·직접 배포)에서는
// verseId/account 가 없어 결제창이 뜨지 않는다. 그럴 때는 buy() 가 false 를
// 돌려주고, 호출부가 "결제 연동 전" 안내로 떨어진다 — 광고와 같은 구조다.
//
// ── 지급은 누가 하는가 ────────────────────────────────────
// 공식 문서는 **서버가 지급해야 한다**고 못 박는다 (server.js 의
// $onItemPurchased). 클라 콜백은 화면 갱신용이고, 클라가 지급하면 조작 창구가
// 된다. 지금은 세이브 자체가 클라 판정이라(1단계) 클라에서 지급하고 있고,
// 서버 2단계로 옮길 때 onClose 지급을 걷어내고 서버 상태를 읽는 것으로 바꾼다.
// 그때까지 이 주석이 그 자리를 표시한다.

import { VXShop } from '@verse8/platform/vanilla';

let ready = false;          // init 이 끝났나
let live = false;           // 실제로 상품 목록을 받아왔나 (= 호스트 안이다)
let onPurchase = null;      // (productId) => void
let onItems = null;         // 상품 목록이 처음 도착했을 때 (화면 다시 그리기)

/**
 * 부팅 때 한 번 부른다.
 * @param handler      결제가 성사됐을 때 부를 함수 — (productId) => void
 * @param itemsHandler 상품 목록(=가격)이 처음 도착했을 때 부를 함수
 */
export function initVXShop(handler, itemsHandler) {
  onPurchase = handler;
  onItems = itemsHandler;
  try {
    // verseId·account 를 안 넘기면 SDK 가 환경변수 → URL 쿼리 순으로 찾는다.
    // 호스트가 그 값을 넣어 주므로 여기서 추측하지 않는다.
    VXShop.init({ autoRefresh: true });
    ready = true;

    // 목록이 한 번이라도 들어오면 호스트 안이라는 뜻이다. 이 신호가 없으면
    // 결제창을 띄워도 빈 화면이 뜨므로, 아예 안 띄우고 안내로 떨어뜨린다
    VXShop.subscribe(s => {
      if (s.items && s.items.length) {
        const first = !live;
        live = true;
        // 목록이 처음 들어온 순간 상점을 다시 그린다 — 가격은 **대시보드가
        // 정한다.** 데이터의 vx 값은 목록이 오기 전/호스트 밖에서만 쓰는 폴백이라,
        // 다시 안 그리면 대시보드에서 가격을 바꿔도 화면이 옛 값에 머문다
        if (first) onItems?.();
      }
    });

    VXShop.onClose(p => {
      // p = { purchased, productId, action }
      if (!p || !p.purchased) return;      // 그냥 닫음 — 아무 일도 없다
      try { onPurchase?.(p.productId); }
      catch (e) { console.error('결제 지급 실패', p.productId, e); }
      VXShop.refresh();                    // 재고·구매 상한 갱신
    });
  } catch (e) {
    console.warn('VXShop 초기화 실패 (호스트 밖이면 정상)', e);
  }
}

/** 이 환경에서 결제를 걸 수 있나 */
export const vxLive = () => ready && live;

/**
 * 결제창을 연다. 열지 못하면 false — 호출부가 안내 토스트를 띄운다.
 * **여기서는 아무것도 지급하지 않는다.** 지급은 onClose 가 성사를 알린 뒤다.
 */
export function vxBuy(productId) {
  if (!vxLive() || !productId) return false;
  try { VXShop.buyItem(productId); return true; }
  catch (e) { console.error('결제창 열기 실패', productId, e); return false; }
}

/** 대시보드에 등록된 상품 정보 (가격·재고·구매 상한). 없으면 undefined */
export const vxItem = productId => {
  try { return VXShop.getItem(productId); } catch { return undefined; }
};

/** 표시용 가격. 대시보드 값이 진짜다 — 데이터의 vx 는 참고치다 */
export function vxPrice(productId, fallback) {
  const it = vxItem(productId);
  return typeof it?.price === 'number' ? it.price : fallback;
}
