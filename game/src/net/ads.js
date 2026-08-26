// 보상형 광고 — Verse8 호스트로 나가는 유일한 창구.
//
// SDK 는 전송 계층일 뿐이다. 광고망을 직접 부르지 않고 postMessage 로 Verse8
// 호스트(verse8.io 웹셸 iframe · 모바일 WebView 브리지)에 넘긴다. 그래서
// **호스트 안에서만 동작한다** — 로컬 dev 나 직접 배포한 페이지는 top-frame 이라
// 핸드셰이크가 500ms 뒤 unsupported_env 로 끝난다.
//
// **timeoutMs 를 넘기지 않는다.** 호스트가 응답할 때까지 무한정 기다린다.
// 클라가 임의로 끊으면 유저는 광고를 끝까지 봤는데 보상이 안 나오는 상태가 되고,
// 그 판정을 클라가 내리게 되어 조작 창구가 된다. (SDK 는 timeoutMs 를 안 주면
// timeout 코드를 아예 만들지 않는다.)

import { Verse8Ads } from '@verse8/ads';

/** 광고 재생 결과 */
export const AD_OK = 'ok';
export const AD_SKIPPED = 'skipped';       // 유저가 끝까지 안 봄 — 보상 없음
export const AD_UNAVAILABLE = 'unavailable';

/**
 * 광고 지면 id. Verse8 대시보드에 등록한 이름과 같아야 한다.
 * 지면을 나눠야 노출·완주율이 자리별로 갈려 보이고, 나중에 한쪽만 빼거나
 * 보상을 조정할 수 있다.
 */
export const AD_IDLE_DOUBLE = 'idle_double';    // 방치 보상 2배 수령
export const AD_INSTANT_CLAIM = 'instant_claim'; // 2시간분 즉시 수령
export const AD_ARENA_ENTRIES = 'arena_entries'; // 아레나 입장권 +3
export const AD_DUNGEON_KEYS = 'dungeon_keys';   // 던전 열쇠 +1 (열쇠를 다 썼을 때)

/**
 * 테스트·대체 구현 주입구. `{ showRewarded({placementId}) }` 모양이면 된다.
 * 안 꽂으면 실제 SDK 를 쓴다.
 */
let sdk = Verse8Ads;
export function setAdSdk(impl) { sdk = impl || Verse8Ads; }

/**
 * 부팅 때 한 번 부른다. inbound message 리스너를 미리 걸어 두는 게 목적이다.
 *
 * **부팅 시점에 부르는 이유** — SDK 는 첫 show 호출 때 PING/PONG 핸드셰이크를
 * 하고 그 결과를 페이지 세션 내내 캐시한다. 호스트의 광고 핸들러가 우리보다
 * 늦게 뜬 상태에서 광고를 먼저 부르면 unsupported 로 굳어 새로고침 전까지
 * 광고가 전부 죽는다. 리스너를 일찍 걸어 그 창을 좁힌다.
 */
export function initAds() {
  Verse8Ads.init({ debug: !!import.meta.env.DEV });
}

/**
 * 보상형 광고를 끝까지 보여 주고 성공 여부를 돌려준다.
 *
 * @param placementId Verse8 대시보드의 지면 id
 * @returns {Promise<AD_OK|AD_SKIPPED|AD_UNAVAILABLE>}
 */
export async function showRewarded(placementId = AD_IDLE_DOUBLE) {
  let r;
  try {
    // timeoutMs 를 넘기지 않는다 (위 주석). placementId 가 비면 SDK 가 동기로 던진다
    r = await sdk.showRewarded({ placementId });
  } catch (e) {
    console.warn('광고 재생 실패', e);
    return AD_UNAVAILABLE;
  }

  if (r?.status === 'rewarded') return AD_OK;
  if (r?.status === 'dismissed') return AD_SKIPPED;   // 중간에 닫음 — 보상 없음

  // status === 'failed'. busy(중복 호출) · platform_error · unsupported_env
  const code = r?.error?.code;

  // 호스트 밖에서는 개발 빌드만 통과시킨다. 로컬에서 방치 2배·즉시 수령을
  // 눌러 볼 수 있어야 하는데, 프로덕션 번들에 이 분기가 남으면 배포본을 그냥
  // 열어서 무한정 2배 수령이 된다 — Vite 가 DEV 를 false 로 접어 통째로 지운다
  if (code === 'unsupported_env' && import.meta.env.DEV) {
    console.warn('[ads] Verse8 호스트 밖 — 개발 빌드라 통과시킨다');
    return AD_OK;
  }

  console.warn('광고 실패', code, r?.error?.message ?? '');
  return AD_UNAVAILABLE;
}
