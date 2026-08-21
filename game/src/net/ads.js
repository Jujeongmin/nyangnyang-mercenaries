// 보상형 광고 — 호출 자리만 만들어 둔 껍데기.
//
// 실제 SDK(`@verse8/ads`)는 **아직 저장소에 없다.** 이 프로젝트는 번들러가 없는
// 정적 파일이라 npm 패키지를 import 할 수 없고, Verse8 프로젝트 등록 전에는
// 검증도 불가능하다 (작업정리.md > 4. 정해 줘야 하는 것).
//
// 붙일 때 지킬 것 (Verse8 문서 기준, 2026-08-21 확인):
//
//   import { Verse8Ads } from "@verse8/ads";           // package.json: "^0.5.0"
//   const result = await Verse8Ads.showRewarded({ placementId: "rewarded_1" });
//
// **timeout 을 넘기지 않는다.** 호스트가 응답할 때까지 무한정 기다린다.
// 클라가 임의로 끊으면 유저는 광고를 끝까지 봤는데 보상이 안 나오는 상태가 되고,
// 그 판정을 클라가 내리게 되어 조작 창구가 된다.
//
// 지금은 SDK 가 없으므로 **즉시 성공**을 돌려준다. 프로토타입 진행을 막지 않되,
// 보상 지급 자체는 여기 결과를 보고 하도록 호출부를 미리 통일해 둔다 —
// 나중에 SDK 만 꽂으면 호출부는 안 고쳐도 된다.

/** 광고 재생 결과 */
export const AD_OK = 'ok';
export const AD_SKIPPED = 'skipped';       // 유저가 끝까지 안 봄 — 보상 없음
export const AD_UNAVAILABLE = 'unavailable';

/** SDK 가 주입되면 여기 꽂는다. `{ showRewarded({placementId}) }` 모양 */
let sdk = null;
export function setAdSdk(impl) { sdk = impl; }

/**
 * 보상형 광고를 끝까지 보여 주고 성공 여부를 돌려준다.
 *
 * @param placementId Verse8 대시보드의 지면 id (예: 'rewarded_1')
 * @returns {Promise<AD_OK|AD_SKIPPED|AD_UNAVAILABLE>}
 */
export async function showRewarded(placementId = 'rewarded_1') {
  // SDK 미연결 — 프로토타입에서는 통과시킨다
  if (!sdk) return AD_OK;

  try {
    // timeout 인자를 넘기지 않는다. 호스트 응답까지 무한 대기가 맞다
    const result = await sdk.showRewarded({ placementId });
    return result?.rewarded ? AD_OK : AD_SKIPPED;
  } catch (e) {
    console.warn('광고 재생 실패', e);
    return AD_UNAVAILABLE;
  }
}
