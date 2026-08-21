// 데미지 숫자. 방치형은 유저가 화면을 오래 보므로 여기가 체감의 절반이다.
//
//   · 포물선으로 튄다 (직선으로 올라가면 싸구려)
//   · 뜰 때 스케일 팝 — 커졌다 정상으로
//   · 크리티컬은 크기·색·기울기가 전부 다르다. 같으면 크리가 안 읽힌다

import { ease } from './rig.js';

const STYLE_BASE = {
  fontFamily: '"Black Han Sans", "Jua", system-ui, sans-serif',
  fontWeight: '400',
  stroke: { color: 0x1a1020, width: 5, join: 'round' },
};

export class DamageNumbers {
  constructor(PIXI, layer) {
    this.PIXI = PIXI;
    this.layer = layer;
    this.items = [];
    this.enabled = true;
  }

  /**
   * @param kind 'normal' | 'crit' | 'heal' | 'miss'
   */
  spawn(x, y, value, kind = 'normal') {
    if (!this.enabled) return;
    const PIXI = this.PIXI;

    const cfg = {
      normal: { size: 22, fill: 0xffffff, rise: 54, spread: 34 },
      crit: { size: 36, fill: 0xffd24a, rise: 78, spread: 46 },
      heal: { size: 22, fill: 0x7ef07e, rise: 50, spread: 26 },
      miss: { size: 20, fill: 0xa8b4c8, rise: 44, spread: 22 },
    }[kind];

    const t = new PIXI.Text({
      text: kind === 'miss' ? 'MISS' : (kind === 'heal' ? '+' : '') + Math.round(value).toLocaleString('ko-KR'),
      style: { ...STYLE_BASE, fontSize: cfg.size, fill: cfg.fill },
    });
    t.anchor.set(0.5);
    t.x = x + (Math.random() - 0.5) * cfg.spread;
    t.y = y;
    if (kind === 'crit') t.rotation = (Math.random() - 0.5) * 0.28;
    this.layer.addChild(t);

    this.items.push({
      t, life: 0,
      ttl: kind === 'crit' ? 1.0 : 0.75,
      x0: t.x, y0: y,
      vx: (Math.random() - 0.5) * 40,
      rise: cfg.rise,
      big: kind === 'crit' ? 1.45 : 1.15,
    });
  }

  update(dtMs) {
    const s = dtMs / 1000;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += s;
      const p = it.life / it.ttl;
      if (p >= 1) { it.t.destroy(); this.items.splice(i, 1); continue; }

      // 포물선 — 빠르게 솟았다 느리게 떨어진다
      it.t.x = it.x0 + it.vx * it.life;
      it.t.y = it.y0 - it.rise * Math.sin(Math.min(1, p * 1.15) * Math.PI * 0.72);

      // 스케일 팝 — 등장 15% 구간에서 커졌다 제자리
      const pop = p < 0.15
        ? 1 + (it.big - 1) * ease.outQuad(p / 0.15)
        : 1 + (it.big - 1) * Math.max(0, 1 - (p - 0.15) / 0.2);
      it.t.scale.set(pop);

      it.t.alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    }
  }
}
