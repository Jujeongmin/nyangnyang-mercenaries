// 이징. rig 와 motions 가 서로 참조하지 않도록 따로 뺐다.

export const ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inCubic: t => t * t * t,
  outCubic: t => 1 - (1 - t) ** 3,
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  // 지나쳤다 되돌아온다. 오버슛이 없으면 기계처럼 보인다.
  outBack: t => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
  inBack: t => 2.7 * t ** 3 - 1.7 * t ** 2,
  outElastic: t =>
    t === 0 || t === 1 ? t : 2 ** (-9 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
};

/** 감쇠 진동 — 때린 뒤 흔들리다 멎는 것 */
export const damped = (t, freq, decay) => Math.sin(t * freq) * Math.exp(-t * decay);

/** 구간 정규화. a~b 사이에서 0~1 을 돌려준다. */
export const seg = (p, a, b) => Math.max(0, Math.min(1, (p - a) / (b - a)));

export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = d => (d * Math.PI) / 180;
