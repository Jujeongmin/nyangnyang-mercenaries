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
  if (!m) return null;
  return SKILL_FX[id]?.asset ?? `SFX-${m[1]}`;
};

/**
 * 액티브 스킬 16종의 연출 표. **없으면 아무것도 안 뜬다** — SFX 는 01~12 뿐인데
 * 스킬은 A16 까지라 연쇄 번개·약점 노출·시간 정지·천공 붕괴가 무음이었다.
 *
 *   asset  터뜨릴 그림. 전용 SFX 가 생기기 전까지는 성격이 가까운 것을 빌린다
 *          (에셋_생성_프롬프트.md 14절 — SFX-13~16 생성 대기)
 *   at     어디서 터지나. 'foe' 적 · 'party' 아군 대열 · 'captain' 단장
 *   tint   빌려 쓴 그림을 구분하는 색. 전용 에셋이 오면 지운다
 *   scale  기본 크기 배수
 *
 * 피해가 없는 스킬(버프·회복·보호막·쿨감)을 적한테 터뜨리면 무슨 일이 난 건지
 * 안 읽힌다 — 아군 쪽에서 터져야 "우리가 강해졌다"가 보인다.
 */
export const SKILL_FX = {
  'SK-A01': { at: 'foe' },                                   // 낙뢰
  'SK-A02': { at: 'foe' },                                   // 화염구
  'SK-A03': { at: 'foe' },                                   // 관통 화살
  'SK-A04': { at: 'foe' },                                   // 얼음 창
  'SK-A05': { at: 'foe' },                                   // 참격
  'SK-A06': { at: 'party', scale: 0.9 },                     // 공격 태세
  'SK-A07': { at: 'party', scale: 1.0 },                     // 광폭화
  'SK-A08': { at: 'party', scale: 0.9 },                     // 시간 가속
  'SK-A09': { at: 'party', scale: 1.0 },                     // 전체 회복
  'SK-A10': { at: 'party', scale: 1.05 },                    // 보호막
  'SK-A11': { at: 'captain', scale: 0.9 },                   // 새끼 냥이 소환
  'SK-A12': { at: 'captain', scale: 1.0 },                   // 유령 용병
  'SK-A13': { at: 'foe', scale: 1.15 },  // 연쇄 번개
  'SK-A14': { at: 'foe', scale: 1.0 },   // 약점 노출
  'SK-A15': { at: 'foe', scale: 1.2 },   // 시간 정지
  'SK-A16': { at: 'foe', scale: 1.5 },   // 천공 붕괴
};

/**
 * 패시브 스킬 연출표. **효과가 아니라 표시**다 — 수치는 전투력에 이미 곱해져
 * 있고(skills.json > combatOnlyRule), 여기서는 "그 패시브가 지금 일했다"를
 * 눈에 보여 줄 뿐이다. 판정을 만들면 밸런스를 다시 재야 해서 범위를 나눴다.
 *
 *   at     'hit' 타격 순간 · 'kill' 처치 순간 · 'aura' 상시(대열에 은은히)
 *   chance 그 순간에 연출이 뜰 확률. 데이터의 발동률과 **비슷하게** 맞췄다
 *   asset  띄울 그림 · tint 색 · at 이 aura 면 유닛 뒤에 깔리는 고리
 */
export const PASSIVE_FX = {
  'SK-P04': { at: 'hit',  chance: 0.20, asset: 'HIT-06', tint: 0xffd76a, scale: 0.7 }, // 치명타율
  'SK-P06': { at: 'open', asset: 'SFX-06', tint: 0xffe08a, scale: 1.0 },              // 선제
  'SK-P07': { at: 'hit',  chance: 0.30, asset: 'SFX-09', tint: 0x7fe08a, scale: 0.55 }, // 흡혈
  'SK-P08': { at: 'hit',  chance: 0.22, asset: 'SFX-10', tint: 0xc06bff, scale: 0.6 }, // 가시 오라
  'SK-P09': { at: 'kill', chance: 0.45, asset: 'HIT-08', tint: 0xff6b6b, scale: 1.0 }, // 즉사
  'SK-P10': { at: 'hit',  chance: 0.22, asset: 'HIT-03', tint: 0xffffff, scale: 0.7 }, // 이중 공격
  'SK-P11': { at: 'hit',  chance: 0.16, asset: 'HIT-04', tint: 0xffc94a, scale: 0.65 }, // 관통력
  'SK-P12': { at: 'hit',  chance: 0.14, asset: 'HIT-06', tint: 0xff8a4a, scale: 0.85 }, // 치명타 피해
  'SK-P13': { at: 'aura', tint: 0x7fe08a },                                            // 활력
  'SK-P14': { at: 'aura', tint: 0xff8a4a },                                            // 투지
  'SK-P15': { at: 'kill', chance: 0.60, asset: 'SFX-07', tint: 0xff9a4a, scale: 0.8 }, // 응징의 오라
  'SK-P16': { at: 'kill', chance: 0.50, asset: 'SFX-16', tint: 0xffe08a, scale: 0.9 }, // 심판
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

  /** 확장자는 **webp 먼저, 없으면 png**. 원화 축소분이 webp 로만 남아 있다 */
  async preload(ids, base = '/assets/fx') {
    await Promise.all(ids.map(async id => {
      if (this.tex.has(id)) return;
      for (const ext of ['.webp', '.png']) {
        try {
          const t = await this.PIXI.Assets.load(`${base}/${id}${ext}`);
          if (t) { this.tex.set(id, t); return; }
        } catch { /* 다음 확장자 */ }
      }
      this.tex.set(id, null);
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
