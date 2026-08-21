// 타격감. 캐릭터 애니메이션이 아니라 이 묶음이 타격감을 만든다.
//
//   히트스톱 — 명중 순간 화면 전체를 잠깐 멈춘다. 단일 항목 중 효과가 가장 크다
//   셰이크   — 방향성 있게 흔들고 감쇠시킨다
//   플래시   — 맞은 쪽을 흰색으로 2프레임
//   먼지     — 착지·돌진에 흙먼지
//
// 시간을 여기서 관리한다. update() 가 돌려주는 dt 를 써야 히트스톱이 먹는다.

export class Impact {
  /**
   * @param {PIXI.Container} world  흔들 대상 (배경 포함 전체)
   */
  constructor(PIXI, world) {
    this.PIXI = PIXI;
    this.world = world;
    this.stopMs = 0;
    this.shakeAmt = 0;
    this.shakeDir = 1;
    this.shakeT = 0;
    this.dust = [];
    this.dustLayer = new PIXI.Container();
    world.addChild(this.dustLayer);
    this.opts = { hitStop: true, shake: true, flash: true, dust: true };
  }

  /** 명중 순간 전체 정지. 60~90ms 가 적당하다. 길면 끊겨 보인다. */
  hitStop(ms = 70) {
    if (!this.opts.hitStop) return;
    this.stopMs = Math.max(this.stopMs, ms);
  }

  /** amount 는 데미지 비례. dirX 는 밀리는 방향. */
  shake(amount = 6, dirX = 1) {
    if (!this.opts.shake) return;
    this.shakeAmt = Math.max(this.shakeAmt, amount);
    this.shakeDir = dirX;
    this.shakeT = 0;
  }

  /** 피격자 흰색 플래시. rig.mesh 에 필터를 잠깐 붙였다 뗀다. */
  flash(rig, ms = 90) {
    if (!this.opts.flash) return;
    const PIXI = this.PIXI;
    if (!rig._flashFilter) rig._flashFilter = new PIXI.ColorMatrixFilter();
    const f = rig._flashFilter;
    rig.mesh.filters = [f];
    const start = performance.now();
    const step = () => {
      const p = (performance.now() - start) / ms;
      if (p >= 1 || rig.dead) { rig.mesh.filters = []; return; }
      f.brightness(1 + 2.6 * (1 - p), false);
      requestAnimationFrame(step);
    };
    f.brightness(3.6, false);
    requestAnimationFrame(step);
  }

  /** 흙먼지 퍼프. 착지·돌진 시작에 뿌린다. */
  puff(x, y, dirX = 1, n = 6) {
    if (!this.opts.dust) return;
    const PIXI = this.PIXI;
    for (let i = 0; i < n; i++) {
      const g = new PIXI.Graphics();
      const r = 3 + Math.random() * 5;
      g.circle(0, 0, r).fill({ color: 0xd8cdb8, alpha: 0.55 });
      g.x = x + (Math.random() - 0.5) * 14;
      g.y = y + (Math.random() - 0.5) * 5;
      this.dustLayer.addChild(g);
      this.dust.push({
        g, life: 0, ttl: 0.35 + Math.random() * 0.25,
        vx: dirX * (18 + Math.random() * 46) * (Math.random() < 0.25 ? -0.4 : 1),
        vy: -(14 + Math.random() * 34),
      });
    }
  }

  /**
   * @returns {number} 히트스톱이 적용된 dt(ms). 게임 로직은 이걸 써야 한다.
   */
  update(dtMs) {
    // 먼지는 정지 중에도 멈춘다 — 안 그러면 정지가 안 읽힌다
    let dt = dtMs;
    if (this.stopMs > 0) {
      this.stopMs -= dtMs;
      dt = 0;
    }

    const s = dt / 1000;

    // 셰이크 — 감쇠 진동. 가로를 세로보다 크게 흔들어야 타격처럼 보인다.
    if (this.shakeAmt > 0.05) {
      this.shakeT += s;
      const k = Math.exp(-this.shakeT * 9);
      const a = this.shakeAmt * k;
      this.world.x = this.shakeDir * Math.sin(this.shakeT * 62) * a;
      this.world.y = Math.sin(this.shakeT * 47 + 1.1) * a * 0.45;
      if (k < 0.03) { this.shakeAmt = 0; this.world.x = 0; this.world.y = 0; }
    }

    for (let i = this.dust.length - 1; i >= 0; i--) {
      const p = this.dust[i];
      p.life += s;
      if (p.life >= p.ttl) { p.g.destroy(); this.dust.splice(i, 1); continue; }
      p.vy += 150 * s;
      p.g.x += p.vx * s;
      p.g.y += p.vy * s;
      const q = 1 - p.life / p.ttl;
      p.g.alpha = 0.55 * q;
      p.g.scale.set(0.6 + q * 0.8);
    }

    return dt;
  }
}
