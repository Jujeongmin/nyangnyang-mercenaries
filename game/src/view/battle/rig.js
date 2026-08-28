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
    // 등급 링 — 그림자와 몸통 사이. 색이 있으면 발밑에 등급색 타원을 돌린다.
    // 수집형에서 "좋은 걸 편성했다"가 전투 화면에 안 보이면 뽑는 보람이 죽는다.
    this.gradeRing = new PIXI.Graphics();
    this.view.addChild(this.gradeRing);
    this.ringColor = opt.ringColor ?? null;
    this.ringT = Math.random() * Math.PI * 2;
    // 궤도 입자 — UR·LR 전용. 32종 중 5종에만 붙어 상한이 잡힌다.
    // 몸 주위를 도는 점 3개라 파티클 시스템 없이 Graphics 로 그린다
    this.orbs = !!opt.orbs;
    // 몸 주변 오라 — SSR+ 전용. 비용 통제:
    //   · 글로우는 **공유 방사형 텍스처 1장**을 등급색 tint 로 쓴다 (유닛당 스프라이트 1)
    //   · 프레임 작업은 알파/스케일 값 대입뿐, 생성·파괴 없음
    //   · 상승 불씨는 이미 매 프레임 그리는 gradeRing Graphics 에 원 3개 얹는다
    this.aura = null;
    if (opt.aura && this.ringColor) {
      const tex = UnitRig.glowTexture(PIXI);
      this.aura = new PIXI.Sprite(tex);
      this.aura.anchor.set(0.5);
      this.aura.tint = this.ringColor;
      this.aura.blendMode = 'add';
      // 여기서 addChild 하면 순서가 shadow → ring → **aura** → rigRoot(아래에서 추가)
      // 가 되어 자연히 몸 뒤에 깔린다. rigRoot 는 아직 안 만들어졌으므로
      // 인덱스 조회는 불가능하고, 필요도 없다
      this.view.addChild(this.aura);
    }

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
    //
    // **trim 은 잰 당시의 원화 크기(cw/ch)에 매인 값이다.** 그림을 나중에 줄이면
    // (2026-08-25 해상도 축소) 두 값의 세대가 어긋날 수 있고, 그러면 크기가
    // texH/eh 비율만큼 통째로 틀어진다 — 1024 그림에 512 기준 trim 이 붙으면
    // 1.87배로 커지고, 반대면 절반으로 쪼그라든다. 실제로 배포본에서 그림만
    // 옛것이 남아 잡몹·보스가 커져 보였다.
    // 그래서 **실제 텍스처 크기에 맞춰 그 자리에서 환산한다** — 이제 그림과
    // 좌표의 세대가 달라도 스스로 맞춘다.
    const raw = opt.trim && opt.trim.h ? opt.trim : { x: 0, y: 0, w, h };
    const k = raw.cw ? w / raw.cw : 1;
    const tr = k === 1 ? raw : {
      x: raw.x * k, y: raw.y * k, w: raw.w * k, h: raw.h * k,
      cw: w, ch: h, eh: (raw.eh || 0) * k,
    };
    this.trim = tr;
    this.originX = tr.x + tr.w / 2;   // 가로 중심
    this.originY = tr.y + tr.h;       // 발밑
    this.texW = w; this.texH = h;
    // 스케일 기준은 eh(면적 등가 높이, tools/trim.py)가 있으면 그걸 쓴다.
    // 세로 bbox 로 맞추면 귀·활이 길수록 몸이 작아진다 — 시각 질량은 면적이다.
    this.scale0 = (opt.size ?? 160) / (tr.eh || tr.h);
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
    // 단장 전용 공격 스프라이트 시트(선택). 로드 실패 시 기존 리그 모션을 쓴다.
    this.attackSprite = null;
    this.attackFrames = [];
    if (opt.attackSheet && opt.attackFrameCount) {
      const count = opt.attackFrameCount;
      const fw = opt.attackSheet.width / count;
      for (let i = 0; i < count; i++) {
        this.attackFrames.push(new PIXI.Texture({
          source: opt.attackSheet.source,
          frame: new PIXI.Rectangle(i * fw, 0, fw, opt.attackSheet.height),
        }));
      }
      this.attackSprite = new PIXI.Sprite(this.attackFrames[0]);

      // 시트 칸은 캐릭터보다 크다 — 위아래에 여백이 있다. 그걸 모르고
      // **칸**을 this.h 에 맞추면 두 가지가 어긋난다 (단장 지적 2026-08-26):
      //   · 크기 — 여백만큼 캐릭터가 작아진다 (여백 15%면 15% 작다)
      //   · 위치 — 앵커가 칸 바닥이라 발이 여백만큼 떠 보인다
      // 그래서 **칸이 아니라 캐릭터**를 기준으로 잡는다. 기본 리그가 trim 으로
      // 하는 것과 같은 계산이다.
      const ch = opt.attackSheet.height;
      const t = opt.attackTrim;                       // { h, footY, ch } — 칸 안 캐릭터 영역
      // **h·foot 은 원본 픽셀 좌표다.** 배포 CDN 이나 iOS 가 큰 시트를 몰래
      // 줄여 서빙하면 텍스처가 원본보다 작아지는데, 그때 원본 좌표로 나누면
      // 캐릭터가 그 비율만큼 작아진다 — 모바일에서 걷기·공격만 절반이 되던
      // 원인 (단장 확인 2026-08-27, iPhone 12 Pro). UnitRig 가 trim.cw 로
      // 하는 것과 같은 자가 환산: 표의 원본 칸높이(ch)와 실제 텍스처를 비교한다
      const ak = t?.ch ? ch / t.ch : 1;
      const charH = t?.h ? t.h * ak : ch;             // 없으면 칸 전체가 캐릭터라고 본다
      const footY = t?.footY != null ? t.footY * ak : ch;   // 칸 안에서 발이 닿는 y
      this.attackSprite.anchor.set(0.5, footY / ch);  // 발을 기준점으로
      this.attackSprite.height = this.h * (ch / charH);
      this.attackSprite.width = this.attackSprite.height * (fw / ch);
      // **시트도 flip 을 따른다.** flip 은 rigRoot(대기 자세)에만 걸려 있어서,
      // 적 자리에 세운 단장이 공격·걷기 순간에만 등을 돌렸다 (단장 지적
      // 2026-08-27). width 에 음수를 넣으면 구현에 따라 절댓값으로 삼키므로
      // scale.x 의 부호를 직접 준다 — 앵커(0.5) 기준으로 좌우가 뒤집힌다
      this.attackSprite.scale.x = Math.abs(this.attackSprite.scale.x) * (this.flip ? -1 : 1);
      this.attackSprite.visible = false;
      this.view.addChild(this.attackSprite);
    }

    // 걷기 시트(선택). 공격과 같은 구조지만 쓰임새가 다르다 —
    // 공격은 때리는 순간 한 번 훑고 끝나므로 리그가 스스로 재생하지만,
    // 걷기는 이동 구간 내내 도는 루프라 **켜고 끄는 것을 scene 이 쥔다**
    // (scene.js 의 phase === 'walk').
    this.walkSprite = null;
    this.walkFrames = [];
    if (opt.walkSheet && opt.walkFrameCount) {
      const n = opt.walkFrameCount;
      const wfw = opt.walkSheet.width / n;
      for (let i = 0; i < n; i++) {
        this.walkFrames.push(new PIXI.Texture({
          source: opt.walkSheet.source,
          frame: new PIXI.Rectangle(i * wfw, 0, wfw, opt.walkSheet.height),
        }));
      }
      const wch = opt.walkSheet.height;
      const wt = opt.walkTrim;
      const wk = wt?.ch ? wch / wt.ch : 1;            // 공격 시트와 같은 자가 환산
      const wCharH = wt?.h ? wt.h * wk : wch;
      const wFootY = wt?.footY != null ? wt.footY * wk : wch;
      this.walkSprite = new PIXI.Sprite(this.walkFrames[0]);
      this.walkSprite.anchor.set(0.5, wFootY / wch);
      this.walkSprite.height = this.h * (wch / wCharH);
      this.walkSprite.width = this.walkSprite.height * (wfw / wch);
      this.walkSprite.scale.x = Math.abs(this.walkSprite.scale.x) * (this.flip ? -1 : 1);
      this.walkSprite.visible = false;
      this.view.addChild(this.walkSprite);
    }

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

  setAttackSpriteVisible(visible) {
    if (!this.attackSprite) return;
    this.attackSprite.visible = visible;
    this.rigRoot.visible = !visible;
  }

  /**
   * 걷기 시트 재생. 이동 구간 동안 scene 이 매 프레임 부른다.
   * @param on 켤지 끌지
   * @param t  이동 구간 경과 초 — 이걸로 프레임을 고른다
   * @param fps 초당 프레임. 8프레임 12fps = 한 걸음 주기 약 0.67초
   * @returns 실제로 시트가 재생 중인가 (시트가 없으면 false — 부르는 쪽이 예전
   *          위아래 튀기로 떨어진다)
   */
  playWalk(on, t = 0, fps = 12) {
    if (!this.walkSprite) return false;
    if (on) {
      const i = Math.floor(t * fps) % this.walkFrames.length;
      this.walkSprite.texture = this.walkFrames[i];
      this.walkSprite.visible = true;
      this.rigRoot.visible = false;
      return true;
    }
    this.walkSprite.visible = false;
    // 공격 시트가 떠 있는 중이면 리그를 도로 켜면 안 된다 — 둘이 겹쳐 보인다
    if (!this.attackSprite?.visible) this.rigRoot.visible = true;
    return false;
  }

  // --- 동작 ---

  /** @param name 모션 이름. 생략하면 이 유닛의 기본 모션 */
  attack(onImpact, name) {
    if (this.dead) return;
    this.setAttackSpriteVisible(false);
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
    this.setAttackSpriteVisible(false);
    this.dead = true;
    this.act = { kind: 'die', t: 0, dur: 420 * scale };
  }

  /**
   * 전투불능. 아군용 — 죽지 않고 흐려진다.
   * 파티 5인은 고정이라 사라지면 왜 딜이 줄었는지 안 읽힌다.
   */
  down() {
    if (this.downed) return;
    this.setAttackSpriteVisible(false);
    this.downed = true;
    this.act = { kind: 'down', t: 0, dur: 320 };
  }

  rise() {
    this.setAttackSpriteVisible(false);
    this.downed = false;
    this.act = { kind: 'rise', t: 0, dur: 280 };
  }

  revive() {
    this.setAttackSpriteVisible(false);
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
        if (this.attackSprite) {
          const frame = Math.min(this.attackFrames.length - 1,
            Math.floor(p * this.attackFrames.length));
          this.attackSprite.texture = this.attackFrames[frame];
          this.setAttackSpriteVisible(true);
        } else pose = a.m.pose(p);
        if (!a.fired && p >= a.m.impactAt) { a.fired = true; a.onImpact?.(this); }
        if (p >= 1) {
          this.act = null;
          this.setAttackSpriteVisible(false);
        }
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
    this.drawGradeRing(alpha);
    if (this.aura) {
      // 숨쉬는 글로우. 링과 같은 위상이라 한 생명체로 읽힌다
      const pulse = 0.16 + (Math.sin(this.ringT) + 1) * 0.05;
      this.aura.alpha = pulse * alpha;
      const w = this.w * 1.5;
      this.aura.width = w; this.aura.height = this.h * 1.25;
      this.aura.position.set(0, -this.h * 0.5);
    }
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

  /** 공유 글로우 텍스처 — 흰 방사형 원 1장. tint 로 등급색을 입힌다 */
  static glowTexture(PIXI) {
    if (UnitRig._glowTex) return UnitRig._glowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    rg.addColorStop(0, 'rgba(255,255,255,.9)');
    rg.addColorStop(0.55, 'rgba(255,255,255,.28)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 128, 128);
    UnitRig._glowTex = PIXI.Texture.from(c);
    return UnitRig._glowTex;
  }

  /**
   * 발밑 등급 링. 정지 그림에 회전하는 이중 타원 — 파티클 없이 도는 느낌을 낸다.
   * 프레임마다 정점 몇 개짜리 타원 두 개라 부하가 사실상 없다. 방치형은 화면을
   * 몇 시간씩 켜 두므로 상시 이펙트는 이 정도가 상한이다 (combat.json 의
   * screenShake 를 끈 것과 같은 이유).
   */
  drawGradeRing(alpha) {
    const g = this.gradeRing;
    if (!this.ringColor) { g.clear(); return; }
    this.ringT += 0.03;
    const k = 1 - Math.min(1, this.lift / (this.h * 0.5)) * 0.4;
    const rx = this.w * 0.34 * k, ry = this.h * 0.062 * k;
    // 회전 위상에 따라 밝기가 숨쉰다
    const pulse = 0.55 + Math.sin(this.ringT) * 0.18;
    g.clear();
    g.ellipse(0, 0, rx, ry).stroke({ color: this.ringColor, width: 2, alpha: 0.75 * pulse * alpha });
    g.ellipse(0, 0, rx * 0.8, ry * 0.8)
      .stroke({ color: this.ringColor, width: 1, alpha: 0.4 * pulse * alpha });
    // 상승 불씨 — 오라 유닛(SSR+)만. 몸 옆에서 피어올라 사라지는 원 3개.
    // 위상만 다른 같은 수식이라 상태 저장이 없다
    if (this.aura) {
      for (let i = 0; i < 3; i++) {
        const ph = (this.ringT * 0.55 + i / 3) % 1;
        const ex = Math.sin((this.ringT + i * 2.1) * 1.7) * this.w * 0.34;
        const ey = -this.h * (0.15 + ph * 0.85);
        g.circle(ex, ey, 1.6 + (1 - ph) * 1.2)
          .fill({ color: this.ringColor, alpha: (1 - ph) * 0.5 * alpha });
      }
    }
    if (!this.orbs) return;
    // 입자 3개가 몸 높이 중간쯤의 타원 궤도를 돈다. 뒤로 돌 때(sin<0) 는
    // 몸에 가려야 하지만 z 분리 비용이 커서 알파를 낮추는 것으로 눈속임한다
    for (let i = 0; i < 3; i++) {
      const a = this.ringT * 1.6 + i * (Math.PI * 2 / 3);
      const ox = Math.cos(a) * rx * 1.05;
      const oy = -this.h * 0.42 + Math.sin(a) * ry * 2.2;
      const front = Math.sin(a) >= 0;
      g.circle(ox, oy, 2.4).fill({ color: this.ringColor,
        alpha: (front ? 0.9 : 0.35) * alpha });
    }
  }
}

export { ease, damped };
