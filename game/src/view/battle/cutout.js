// 다각형 좌표로 스프라이트를 몸통/무기팔 두 장으로 쪼갠다.
//
// 편집기(app/cutout.html)는 좌표만 저장하고, 실제 분리는 여기서 런타임에 한다.
// PNG 를 두 배로 늘리지 않고, 다각형을 고치면 결과가 바로 따라온다.
//
// 몸통에서 팔을 도려낼 때 관절 주변을 **넉넉히 원형으로** 잘라야 한다.
// 그래야 팔이 회전해도 구멍이 팔에 가려진다 — 인페인팅이 필요 없다.

/**
 * @param {HTMLImageElement|HTMLCanvasElement} img 원본
 * @param {{x:number,y:number}[]} poly  팔 영역 다각형 (원본 픽셀 좌표)
 * @param {{x:number,y:number}} pivot   어깨 관절
 * @returns {{body:HTMLCanvasElement, arm:HTMLCanvasElement}}
 */
export function buildParts(img, poly, pivot) {
  const w = img.width, h = img.height;

  const mask = document.createElement('canvas');
  mask.width = w; mask.height = h;
  const mx = mask.getContext('2d');
  mx.beginPath();
  poly.forEach((p, i) => (i ? mx.lineTo(p.x, p.y) : mx.moveTo(p.x, p.y)));
  mx.closePath();
  mx.fillStyle = '#fff';
  mx.fill();
  // 관절 주변은 항상 팔에 포함시킨다 — 회전축이 몸통에 남아 있으면 구멍이 뜬다
  mx.beginPath();
  mx.arc(pivot.x, pivot.y, Math.max(w, h) * 0.055, 0, Math.PI * 2);
  mx.fill();

  // 팔 = 원본 ∩ 마스크
  const arm = document.createElement('canvas');
  arm.width = w; arm.height = h;
  const ax = arm.getContext('2d');
  ax.drawImage(mask, 0, 0);
  ax.globalCompositeOperation = 'source-in';
  ax.drawImage(img, 0, 0);

  // 몸통 = 원본 − 마스크
  const body = document.createElement('canvas');
  body.width = w; body.height = h;
  const bx = body.getContext('2d');
  bx.drawImage(img, 0, 0);
  bx.globalCompositeOperation = 'destination-out';
  bx.drawImage(mask, 0, 0);

  return { body, arm };
}

/** PixiJS 텍스처로 만들어 rig 에 넘길 형태로 돌려준다. */
export async function loadCutout(PIXI, srcPath, meta) {
  const img = new Image();
  img.src = srcPath;
  await img.decode();
  const { body, arm } = buildParts(img, meta.polygon, meta.pivot);
  return {
    bodyTexture: PIXI.Texture.from(body),
    texture: PIXI.Texture.from(arm),
    pivot: meta.pivot,
    tip: meta.tip,
    mirror: meta.mirror,
  };
}
