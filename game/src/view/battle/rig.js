// 유닛 리그 — 정지 스프라이트로 살아있는 움직임을 만든다.
//
// 세 축:
//   1. 트랜스폼  예비동작 / 오버슛 / 스쿼시·스트레치 / 관성
//   2. 메시 디폼 격자 정점을 흔든다 (호흡·휘어짐·충격 진동). 자르지 않아도 된다
//   3. 팔 파트   무기 팔을 따로 떼어 어깨 중심으로 회전 (선택)
//
// 팔 파트가 없으면 모션의 arm 값은 무시되고 몸통 동작만 나온다.
// 있으면 칼을 휘두르고 활을 당기는 게 실제로 보인다.

import { ease, damped } from './ease.js';
import { MOTIONS } from './motions.js';

// 스윙의 절대 기준각 (화면 좌표, 오른쪽을 보는 상태, y 아래가 +).
//   ARM_IDLE 대기 — 무기가 **적 쪽(오른쪽)** 을 향한다
//   ARM_UP   치켜든 끝 — 뒤위
//   ARM_DOWN 내리친 끝 — 앞아래
//
// 원화의 무기 각도(armRest)는 캐릭터마다 제각각이라 그대로 두면 대기 자세가
// 캐릭터마다 다른 데를 가리킨다. 그래서 대기 각도까지 기준으로 잡고,
// 모션은 -1(치켜듦) ~ 0(대기) ~ +1(내리침) 정규값만 준다.
// 스윙 폭은 대기 자세(원화 그대로) 기준 오프셋이다. 어느 무기든 총 90°.
const ARM_UP_OFF = -48 * Math.PI / 180;
const ARM_DOWN_OFF = 42 * Math.PI / 180;

export class UnitRig {
  /**
   * @param opt
   *   size    표시 높이(px)
   *   facing  1 = 오른쪽, -1 = 왼쪽
   *   grid    [가로, 세로] 정점 수
   *   motion  기본 공격 모션 이름
   *   arm     { texture, pivot:{x,y}, tip:{x,y} }  — 원본 텍스처 픽셀 좌표
   */
  constructor(PIXI, texture, opt = {}) {
    this.PIXI = PIXI;
    const gx = opt.grid?.[0] ?? 5;
    const gy = opt.grid?.[1] ?? 9;

    this.view = new PIXI.Container();
    this.shadow = new PIXI.Graphics();
    this.view.addChild(this.shadow);

    // 몸통 아래에 팔이 오는 경우가 없도록 컨테이너로 묶는다
    this.rigRoot = new PIXI.Container();
    this.view.addChild(this.rigRoot);

    // 컷아웃이 있으면 팔을 도려낸 몸통을 쓴다. 원본을 쓰면 팔이 두 개로 보인다.
    this.mesh = new PIXI.MeshPlane({
      texture: opt.arm?.bodyTexture || texture, verticesX: gx, verticesY: gy,
    });
    this.rigRoot.addChild(this.mesh);

    const w = texture.width, h = texture.height;
    // 원화 여백이 제각각이라 캔버스 크기로 맞추면 그림마다 보이는 크기가 다르다.
    // trim(불투명 영역)이 있으면 그걸 기준으로 잡는다. assets/trim.json
    const tr = opt.trim && opt.trim.h ? opt.trim : { x: 0, y: 0, w, h };
    this.trim = tr;
    this.originX = tr.x + tr.w / 2;   // 가로 중심
    this.originY = tr.y + tr.h;       // 발밑
    this.texW = w; this.texH = h;
    this.scale0 = (opt.size ?? 160) / tr.h;
    this.w = tr.w * this.scale0;
    this.h = tr.h * this.scale0;
    this.facing = opt.facing ?? 1;
    // 스프라이트 좌우 반전은 이동 방향과 별개다.
    // 적은 왼쪽으로 돌진하지만(facing -1), 원화가 이미 왼쪽을 향해(오른손잡이로)
    // 그려져 있으면 뒤집으면 안 된다. 뒤집으면 비대칭 디자인까지 같이 뒤집힌다.
    this.flip = opt.flip ?? (this.facing < 0);
    this.motion = opt.motion ?? 'slash';

    // 기준점은 발밑 중앙. 스쿼시가 바닥에 붙어 보이려면 여기여야 한다.
    this.mesh.pivot.set(this.originX, this.originY);

    this.buf = this.mesh.geometry.getBuffer('aPosition');
    this.rest = Float32Array.from(this.buf.data);
    this.gx = gx; this.gy = gy;

    // --- 팔 파트 (선택) ---
    this.arm = null;
    if (opt.arm?.texture) this.attachArm(opt.arm);

    this.t = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.base = { x: 0, y: 0 };

    this.act = null;
    this.bend = 0; this.bendVel = 0;
    this.squash = 0;
    this.lift = 0;
    this.armRot = 0; this.armVel = 0;
    this.shockT = -1; this.shockDir = -1;
    this.dead = false;

    this.opts = {
      breathe: true, deform: true, principles: true, shadow: true, arm: true,
      ...opt.features,
    };
  }

  /**
   * 무기 팔을 붙인다.
   * pivot 은 어깨 관절(원본 텍스처 픽셀 좌표). 여기를 중심으로 회전한다.
   * 몸통에서 팔을 도려낼 때 관절 주변을 넉넉히 원형으로 자르면
   * 회전해도 구멍이 팔에 가려진다 — 인페인팅이 필요 없다.
   */
  attachArm({ texture, pivot, tip, mirror }) {
    const PIXI = this.PIXI;
    this.arm = new PIXI.Sprite(texture);
    // 팔 텍스처는 원본과 같은 크기다. 회전축만 어깨로 옮기고
    // 몸통 메시와 같은 좌표계(발밑 중앙 기준)에 맞춘다.
    this.arm.pivot.set(pivot.x, pivot.y);
    this.arm.x = pivot.x - this.originX;
    this.arm.y = pivot.y - this.originY;
    this.armPivot = pivot;
    this.armTip = tip ?? { x: pivot.x, y: pivot.y - this.texH * 0.35 };
    // 무기가 **쉬는 각도**. 캐릭터마다 다르다 — 단장은 검이 왼쪽 위를 향한 채 쉰다.
    // 모션이 고정 각도를 주면 이 차이 때문에 검이 엉뚱한 데로 간다.
    let rest = Math.atan2(this.armTip.y - pivot.y, this.armTip.x - pivot.x);

    // 무기가 적 반대쪽(왼쪽)을 향해 있으면 관절 기준으로 좌우를 뒤집는다.
    // 원화가 왼손잡이로 그려져도 적을 향해 휘두르게 하기 위함이다.
    this.armMirror = mirror ?? (this.armTip.x < pivot.x);
    if (this.armMirror) {
      this.arm.scale.x = -1;
      rest = Math.PI - rest;                       // 세로축 대칭
      this.armTip = { x: 2 * pivot.x - this.armTip.x, y: this.armTip.y };
    }
    this.armRest = rest;
    this.rigRoot.addChild(this.arm);
  }

  /**
   * 정규 스윙값(-1~+1) → 실제 회전량.
   * armSpan 은 모션별 진폭 배율이다 (검격 1.0, 활 당기기 0.22 등).
   */
  /**
   * 정규 스윙값(-1~+1) -> 실제 회전량.
   *
   * 대기 자세는 **원화 그대로**다. 예전엔 모든 무기를 ARM_IDLE(-22°)로 정규화했는데,
   * 그러면 세워 든 지팡이는 처지고 이미 조준 자세인 활은 위로 들려 어색해진다
   * (SR-03 펭귄 궁수에서 드러났다). 원화가 이미 "오른쪽을 향한다"는 규칙을 지키므로
   * 대기각을 건드릴 이유가 없다. 스윙만 대기각 기준 오프셋으로 얹는다.
   */
  armTarget(pose) {
    if (this.armRest == null) return pose.arm;
    const span = pose.armSpan ?? 1;
    const t = Math.max(-1.4, Math.min(1.4, pose.arm));
    const base = pose.armIdle != null ? pose.armIdle - this.armRest : 0;
    return base + (t < 0 ? ARM_UP_OFF * -t : ARM_DOWN_OFF * t) * span;
  }

  setBase(x, y) { this.base.x = x; this.base.y = y; }

  /** 무기 끝의 현재 화면 좌표 — 트레일·이펙트 부착점 */
  weaponTip() {
    const s = this.scale0;
    if (!this.arm) {
      const dir = this.flip ? -1 : 1;
      return { x: this.view.x + dir * this.w * 0.42, y: this.view.y - this.h * 0.62 };
    }
    const dx = this.armTip.x - this.armPivot.x;
    const dy = this.armTip.y - this.armPivot.y;
    const a = this.arm.rotation;
    const rx = dx * Math.cos(a) - dy * Math.sin(a);
    const ry = dx * Math.sin(a) + dy * Math.cos(a);
    return {
      x: this.view.x + (this.flip ? -1 : 1) * ((this.armPivot.x - this.originX) + rx) * s,
      y: this.view.y + ((this.armPivot.y - this.originY) + ry) * s,
    };
  }

  // --- 동작 ---

  /** @param name 모션 이름. 생략하면 이 유닛의 기본 모션 */
  attack(onImpact, name) {
    if (this.dead) return;
    const key = name ?? this.motion;
    const m = MOTIONS[key] ?? MOTIONS.slash;
    this.act = { m, t: 0, fired: false, onImpact, kind: 'attack' };
  }

  hit(dir = -1) {
    if (this.dead) return;
    this.shockT = 0;
    this.shockDir = dir;
    this.bendVel += dir * 5.2;
    this.armVel += dir * 5.5;
    this.squash += 0.16;
  }

  /**
   * 사망 — 그냥 사라진다.
   * 넘어지거나 납작해지는 연출은 넣지 않는다. 방치형은 몹이 세션당 수백 번 죽는데
   * 동작이 크면 화면이 계속 시끄럽고, 다음 웨이브 진입도 늦어진다.
   *
   * @param scale 길이 배율. 보스는 1.6
   */
  die(scale = 1) {
    this.dead = true;
    this.act = { kind: 'die', t: 0, dur: 420 * scale };
  }

  /**
   * 전투불능. 아군용 — 죽지 않고 흐려진다.
   * 파티 5인은 고정이라 사라지면 왜 딜이 줄었는지 안 읽힌다.
   */
  down() {
    if (this.downed) return;
    this.downed = true;
    this.act = { kind: 'down', t: 0, dur: 320 };
  }

  rise() {
    this.downed = false;
    this.act = { kind: 'rise', t: 0, dur: 280 };
  }

  revive() {
    this.dead = false; this.downed = false; this.finished = false;
    this.act = null; this.downAmt = 0;
    this.view.visible = true;
    this.mesh.alpha = 1; this.mesh.tint = 0xffffff;
    this.rigRoot.rotation = 0;
    if (this.arm) { this.arm.alpha = 1; this.arm.tint = 0xffffff; }
  }

  // --- 프레임 ---

  update(dtMs) {
    const dt = dtMs / 1000;
    this.t += dt;

    let pose = { fwd: 0, up: 0, rot: 0, squash: 0, bend: 0, arm: 0 };
    let alpha = 1;
    if (this.finished) { this.view.visible = false; return; }
    if (this.downed && !this.act) this.downAmt = 1;

    if (this.act) {
      const a = this.act;
      a.t += dtMs;

      if (a.kind === 'attack') {
        const p = Math.min(1, a.t / a.m.dur);
        pose = a.m.pose(p);
        if (!a.fired && p >= a.m.impactAt) { a.fired = true; a.onImpact?.(this); }
        if (p >= 1) this.act = null;
      } else if (a.kind === 'die') {
        // 사라지기만 한다. 살짝 떠오르며 줄어드는 정도만 붙인다.
        const p = Math.min(1, a.t / a.dur);
        alpha = 1 - ease.inQuad(p);
        pose = { fwd: 0, up: 0.07 * p, rot: 0, squash: -0.06 * p, bend: 0, arm: 0 };
        this.dieShrink = 1 - 0.14 * p;
        if (p >= 1) { this.act = null; this.finished = true; }
      } else if (a.kind === 'down') {
        this.downAmt = ease.outQuad(Math.min(1, a.t / a.dur));
        if (a.t >= a.dur) this.act = null;
      } else if (a.kind === 'rise') {
        this.downAmt = 1 - ease.outQuad(Math.min(1, a.t / a.dur));
        if (a.t >= a.dur) { this.act = null; this.downAmt = 0; }
      }
    }

    let ox = pose.fwd * this.w * this.facing;
    let oy = -pose.up * this.h;
    this.lift = pose.up * this.h;

    // 피격 진동 — 감쇠하며 멎는다
    if (this.shockT >= 0) {
      this.shockT += dt;
      ox += this.shockDir * damped(this.shockT, 34, 11) * this.w * 0.09;
      if (this.shockT > 0.55) this.shockT = -1;
    }

    // 휘어짐·팔은 스프링으로 따라간다 — 관성과 여운.
    //
    // 명시적 오일러라 dt 가 크면 발산한다. 팔 강성 150 은 30fps(dt=33ms) 에서
    // vel += error×4.95 가 되어 터진다. 그래서 프레임 길이와 무관하게
    // 고정 스텝(1/120초)으로 쪼개서 적분한다. 60fps 든 30fps 든 결과가 같다.
    this.springAcc = Math.min((this.springAcc ?? 0) + dt, 0.25);   // 탭 복귀 시 폭주 방지
    const H = 1 / 120;
    while (this.springAcc >= H) {
      this.springAcc -= H;
      this.bendVel += (pose.bend - this.bend) * 26 * H - this.bendVel * 7.5 * H;
      this.bend += this.bendVel * H;
      // 강성 150 이면 팔이 목표를 못 따라가 와이퍼처럼 흔들린다.
      // 여운(오버슛·정착)은 motions.js 의 커브에 이미 authored 돼 있으므로
      // 스프링은 그걸 뭉개지 않을 만큼만 부드럽게 잡아주면 된다.
      this.armVel += (this.armTarget(pose) - this.armRot) * 900 * H - this.armVel * 58 * H;
      this.armRot += this.armVel * H;
      this.squash += (pose.squash - this.squash) * Math.min(1, H * 16);
    }

    if (!this.opts.principles) { ox = 0; this.squash = 0; }

    const breathe = this.opts.breathe ? Math.sin(this.t * 2.1 + this.phase) : 0;
    oy += breathe * this.h * 0.012;

    // 스쿼시는 부피 보존 — 가로와 세로가 반대로 간다
    const s = 1 + this.squash;
    const shrink = this.dieShrink ?? 1;
    this.rigRoot.scale.set(this.scale0 * (this.flip ? -1 : 1) / s * shrink,
                           this.scale0 * s * shrink);
    this.rigRoot.rotation = pose.rot * this.facing;
    // 쓰러진 아군은 회색으로 죽어 있다 — 사라지지는 않는다
    if (this.downAmt) {
      const g = 1 - 0.55 * this.downAmt;
      const t = (Math.round(0xff * g) << 16) | (Math.round(0xff * g) << 8) | Math.round(0xff * g);
      this.mesh.tint = t;
      alpha *= 1 - 0.42 * this.downAmt;
      if (this.arm) this.arm.tint = t;
    } else if (this.mesh.tint !== 0xffffff) {
      this.mesh.tint = 0xffffff;
      if (this.arm) this.arm.tint = 0xffffff;
    }

    this.mesh.alpha = alpha;
    if (this.arm) {
      this.arm.alpha = alpha;
      this.arm.visible = this.opts.arm;
      this.arm.rotation = this.opts.arm ? this.armRot : 0;
      this.arm.scale.x = this.armMirror ? -1 : 1;
    }

    this.view.x = this.base.x + ox;
    this.view.y = this.base.y + oy;

    if (this.opts.deform) this.deform(breathe);
    else if (this.deformed) { this.buf.data.set(this.rest); this.buf.update(); this.deformed = false; }

    if (this.opts.shadow) this.drawShadow(alpha);
    else this.shadow.clear();
  }

  /**
   * 격자 정점을 흔든다.
   * v=0 이 머리, v=1 이 발. 가중치 (1-v)^1.6 이라 발은 고정, 머리로 갈수록 크게.
   */
  deform(breathe) {
    const d = this.buf.data, r = this.rest;
    const gx = this.gx, gy = this.gy;
    const bend = this.bend;
    const shock = this.shockT >= 0 ? damped(this.shockT, 46, 13) : 0;

    for (let iy = 0; iy < gy; iy++) {
      const v = iy / (gy - 1);
      const wgt = (1 - v) ** 1.6;
      for (let ix = 0; ix < gx; ix++) {
        const i = (iy * gx + ix) * 2;
        const u = ix / (gx - 1);
        let dx = bend * wgt * this.texW * 0.09;
        let dy = -breathe * wgt * this.texH * 0.012;
        dx += breathe * (u - 0.5) * wgt * this.texW * 0.012;
        dx += shock * Math.sin(v * 9.0) * wgt * this.texW * 0.05;
        d[i] = r[i] + dx;
        d[i + 1] = r[i + 1] + dy;
      }
    }
    this.buf.update();
    this.deformed = true;
  }

  /** 바닥 그림자. 뜬 높이에 반비례해 작아지고 흐려져야 무게가 생긴다. */
  drawShadow(alpha) {
    const k = 1 - Math.min(1, this.lift / (this.h * 0.5)) * 0.55;
    this.shadow.clear();
    this.shadow.ellipse(0, 0, this.w * 0.30 * k, this.h * 0.055 * k)
      .fill({ color: 0x000000, alpha: 0.30 * k * alpha });
  }
}

export { ease, damped };
