// 이펙트 레이어.
//
// 에셋_생성_프롬프트.md STEP 13: "캐릭터 스프라이트는 트랜스폼만 한다.
// 화면의 화려함은 전적으로 이 20장이 만든다."
//
// 전부 **절정 프레임 1장**이다. 스프라이트 시트가 아니다.
// 그래서 코드가 확대·회전·페이드로 애니메이션한다 — 그게 이 파일이다.
//
//   HIT-01/02  전사 베기 (수평/대각)     HIT-06  크리티컬
//   HIT-03     연속 베기                HIT-07  피격
//   HIT-04     궁수 관통                HIT-08  사망 소멸
//   HIT-05     마법사 폭발              PX-01~03 직군 패시브

import { ease } from './ease.js';

const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * 액티브 스킬 → 전투 이펙트.
 * 스킬 아이콘(SK-A01)은 UI 용이고, 전투에서 터지는 건 SFX-01 이다. 번호가 같다.
 * 에셋_생성_프롬프트.md STEP 13 「12-2. 액티브 스킬 이펙트 12종」
 */
export const skillFx = id => {
  const m = /^SK-A(\d\d)$/.exec(id);
  return m ? `SFX-${m[1]}` : null;
};

/** 모션 종류 → 타격 이펙트. 크리는 따로 덧씌운다. */
export const HIT_BY_MOTION = {
  slash: ['HIT-01', 'HIT-02'],
  draw: ['HIT-04'],
  cast: ['HIT-05'],
  pounce: ['HIT-03'],
};

export class FxLayer {
  constructor(PIXI, layer) {
    this.PIXI = PIXI;
    this.layer = layer;
    this.items = [];
    this.tex = new Map();
    this.enabled = true;
    this.pool = [];
  }

  async preload(ids, base = '../assets/fx') {
    await Promise.all(ids.map(async id => {
      if (this.tex.has(id)) return;
      try { this.tex.set(id, await this.PIXI.Assets.load(`${base}/${id}.png`)); }
      catch { this.tex.set(id, null); }
    }));
  }

  sprite(id) {
    const t = this.tex.get(id);
    if (!t) return null;
    const s = this.pool.pop() || new this.PIXI.Sprite();
    s.texture = t;
    s.anchor.set(0.5);
    s.visible = true;
    this.layer.addChild(s);
    return s;
  }

  /**
   * 절정 프레임 1장을 애니메이션한다.
   * @param opt
   *   size     기준 크기(px). 스프라이트 긴 변이 이 크기가 된다
   *   dur      길이(ms)
   *   from/to  스케일 시작·끝 (기본 0.55 → 1.25). 커지며 사라지는 게 기본
   *   rot      고정 회전(rad)
   *   spin     회전 속도(rad/s)
   *   flip     좌우 반전
   *   tint     색조
   *   additive 가산 합성 (발광 이펙트는 켜는 게 맞다)
   *   hold     최대 크기에서 머무는 비율 (0~1)
   */
  play(id, x, y, opt = {}) {
    if (!this.enabled) return null;
    const s = this.sprite(id);
    if (!s) return null;

    const size = opt.size ?? 120;
    const base = size / Math.max(s.texture.width, s.texture.height);
    s.x = x; s.y = y;
    s.rotation = opt.rot ?? 0;
    s.alpha = 1;
    s.tint = opt.tint ?? 0xffffff;
    s.blendMode = opt.additive === false ? 'normal' : 'add';
    s.scale.set(base * (opt.from ?? 0.55) * (opt.flip ? -1 : 1), base * (opt.from ?? 0.55));

    this.items.push({
      s, t: 0, dur: opt.dur ?? 340, base,
      from: opt.from ?? 0.55, to: opt.to ?? 1.25,
      spin: opt.spin ?? 0, flip: !!opt.flip,
      hold: opt.hold ?? 0.25,
      vx: opt.vx ?? 0, vy: opt.vy ?? 0,
    });
    return s;
  }

  /** 화살·마법탄. 도착하면 onHit 을 부른다. */
  projectile(id, x0, y0, x1, y1, opt = {}) {
    if (!this.enabled) { opt.onHit?.(); return; }
    const s = this.sprite(id);
    if (!s) { opt.onHit?.(); return; }
    const size = opt.size ?? 70;
    const base = size / Math.max(s.texture.width, s.texture.height);
    s.x = x0; s.y = y0;
    s.alpha = 1;
    s.blendMode = 'add';
    s.rotation = Math.atan2(y1 - y0, x1 - x0);
    s.scale.set(base);
    this.items.push({
      s, t: 0, dur: opt.dur ?? 200, base, proj: true,
      x0, y0, x1, y1, arc: opt.arc ?? 0, onHit: opt.onHit,
      from: 1, to: 1, spin: 0, hold: 1,
    });
  }

  /** 상승하는 입자 — 소멸 연출용 */
  motes(x, y, n, opt = {}) {
    if (!this.enabled) return;
    const P = this.PIXI;
    for (let i = 0; i < n; i++) {
      const g = new P.Graphics();
      const r = rnd(1.5, 3.6);
      g.circle(0, 0, r).fill({ color: opt.color ?? 0xdfe8ff, alpha: 0.9 });
      g.blendMode = 'add';
      g.x = x + rnd(-1, 1) * (opt.spread ?? 26);
      g.y = y + rnd(-1, 1) * (opt.spread ?? 26) * 0.6;
      this.layer.addChild(g);
      this.items.push({
        s: g, t: 0, dur: rnd(420, 900), mote: true,
        vx: rnd(-22, 22), vy: rnd(-70, -26),
        from: 1, to: 1, spin: 0, hold: 1, base: 1,
      });
    }
  }

  update(dtMs) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dtMs;
      const p = Math.min(1, it.t / it.dur);

      if (it.proj) {
        const k = ease.outQuad(p);
        it.s.x = it.x0 + (it.x1 - it.x0) * k;
        it.s.y = it.y0 + (it.y1 - it.y0) * k - Math.sin(p * Math.PI) * it.arc;
        if (p >= 1) { it.onHit?.(); this.retire(it, i); }
        continue;
      }

      if (it.mote) {
        const s = dtMs / 1000;
        it.vy += 26 * s;
        it.s.x += it.vx * s;
        it.s.y += it.vy * s;
        it.s.alpha = 1 - ease.inQuad(p);
        it.s.scale.set(1 - p * 0.5);
        if (p >= 1) { it.s.destroy(); this.items.splice(i, 1); }
        continue;
      }

      // 커지며 사라진다. hold 구간에서는 크기를 유지해 절정이 읽히게 한다.
      const g = p < it.hold ? ease.outCubic(p / it.hold) : 1;
      const sc = it.base * (it.from + (it.to - it.from) * g);
      it.s.scale.set(sc * (it.flip ? -1 : 1), sc);
      it.s.rotation += it.spin * (dtMs / 1000);
      it.s.x += it.vx * (dtMs / 1000);
      it.s.y += it.vy * (dtMs / 1000);
      // 절정을 조금 보여준 뒤에 빠진다
      it.s.alpha = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55;
      if (p >= 1) this.retire(it, i);
    }
  }

  retire(it, i) {
    it.s.visible = false;
    this.layer.removeChild(it.s);
    this.pool.push(it.s);
    this.items.splice(i, 1);
  }

  clear() {
    for (const it of this.items) {
      if (it.mote) it.s.destroy();
      else { this.layer.removeChild(it.s); this.pool.push(it.s); }
    }
    this.items.length = 0;
  }
}
