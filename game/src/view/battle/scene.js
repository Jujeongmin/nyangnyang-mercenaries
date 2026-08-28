// 스테이지 전투 씬.
//
// combat.json > stageRules 를 그대로 따른다:
//   · 아군은 죽지 않는다 (allyInvulnerable). 잡몹은 때리는 연출만 한다
//   · DEF 감산 없음 — 순수 DPS 레이스
//   · 실패 조건은 제한 시간 초과 하나뿐
//
// 진행 구조는 stages.json > enemyDerivation:
//   조우 3회 × 잡몹 4 → 보스 1

import { UnitRig } from './rig.js';
import { Impact } from './impact.js';
import { DamageNumbers } from './numbers.js';
import { motionForClass } from './motions.js';
import { loadCutout } from './cutout.js';
// **playSfx 로 받는다.** 이 파일에는 이미 `const sfx` 가 있다 — 스킬 이펙트
// 그림 이름을 담는 지역 변수다(taunt 아래). 같은 이름으로 import 하면 그 블록
// 안에서 가려져서 문자열을 함수로 부르게 되고 `sfx is not a function` 이 난다
// (단장 보고 2026-08-26, 에디터에서 터졌다)
import { sfx as playSfx } from '../../core/sfx.js';

/**
 * 액티브 스킬 → 효과음. skills.json 의 SK-A01~A16 을 그대로 짚는다.
 *
 * 없는 스킬은 **조용히 둔다.** 성격이 가까운 소리로 때우면 얼음 스킬에서
 * 불 소리가 나는 식이 되는데, 그건 무음보다 나쁘다.
 * (연쇄 번개·약점 노출·시간 정지·천공 붕괴는 전용 소리가 아직 없다)
 */
const SKILL_SFX = {
  'SK-A01': 'sfx_sk_lightning',   // 낙뢰
  'SK-A02': 'sfx_sk_fire',        // 화염구
  'SK-A03': 'sfx_sk_pierce',      // 관통 화살
  'SK-A04': 'sfx_sk_ice',         // 얼음 창
  'SK-A05': 'sfx_sk_slash',       // 참격
  'SK-A06': 'sfx_sk_buff',        // 공격 태세
  'SK-A07': 'sfx_sk_buff',        // 광폭화
  'SK-A08': 'sfx_sk_buff',        // 시간 가속
  'SK-A11': 'sfx_sk_summon',      // 새끼 냥이 소환
  'SK-A12': 'sfx_sk_summon',      // 유령 용병
  'SK-A13': 'sfx_sk_lightning',   // 연쇄 번개
  'SK-A16': 'sfx_sk_fire',        // 천공 붕괴 — 화염 계열이다
};
import { FxLayer, HIT_BY_MOTION, skillFx, SKILL_FX, PASSIVE_FX } from './fx.js';
import { passiveAgg, EMPTY_PASSIVES, passiveTakenMult } from '../../core/passives.js';

const PIXI = () => window.PIXI;
const rnd = (a, b) => a + Math.random() * (b - a);

// 단장 공격 시트의 프레임 수. **시트마다 다르다** — 칸 폭이 시트 폭÷프레임 수라
// 이 숫자가 틀리면 프레임이 어긋나게 잘려 캐릭터가 반씩 잘린 채 재생된다.
//   warrior  1732x329, 433px 칸 4장
//   archer   2048x512, 512px 칸 4장
//   mage     2048x512, 512px 칸 4장
// (archer·mage 는 512 정사각 칸, warrior 만 433x329 다. 칸이 다른 것은 원화
//  비율이 달라서다 — 그래서 프레임 수와 트림을 시트마다 따로 잰다)
// 시트를 갈면 이 표를 같이 고친다.
//
// warrior 는 원래 9장(IDLE·WINDUP·DASH·LEAP·SLASH1~3·IMPACT·RECOVERY)이었는데
// 제자리 공격에 DASH·LEAP·IMPACT·RECOVERY 는 안 맞아서 네 장만 남겼다:
// IDLE -> WINDUP -> SLASH1 -> SLASH2 (단장 확정 2026-08-26).
// 단장 시트 표. **에셋 이름 하나가 열쇠다** — 직군과 전직 단계를 합친 이름이다.
//   1단계   captain_warrior / captain_archer / captain_mage
//   2·3단계 PR-<직군>-<단계>            (전직 UI 가 쓰던 이름 그대로)
//
// atk / walk 는 { n: 프레임 수, h: 칸 안 캐릭터 높이, foot: 발이 닿는 y }.
//
// **n 이 틀리면** 프레임이 어긋나게 잘려 캐릭터가 반씩 잘린 채 재생된다.
// **foot 이 틀리면** 발이 뜨거나 파묻힌다.
// **h 가 틀리면** 크기가 어긋난다 — 스프라이트 높이가 (칸높이 ÷ h) 배수라
// h 를 크게 잡으면 캐릭터가 그만큼 작아진다.
//
// **h 는 0번 프레임의 "고양이" 높이다 — 모자까지 포함하고 무기는 뺀다**
// (단장 확정 2026-08-27). 두 가지를 같이 막는 값이다.
//
//   · 전 프레임 합집합으로 재면 무기를 높이 드는 프레임 하나가 표를 통째로
//     부풀려 그 시트만 고양이가 작아진다. PR-mage-3 attack 이 378 인데 464 가
//     들어가 20% 작게 나왔고, 전사 1단계만 두 값이 같아서 혼자 정상이었다.
//   · 그림 전체(bbox)로 재도 지팡이가 모자 위로 솟는 시트가 작아진다.
//     PR-mage-3 walk 은 bbox 457 이지만 고양이는 414 다 — 그래서 법사 3단계가
//     **걸어갈 때만** 작아졌다 (단장 지적 2026-08-27).
//
// 아홉 종 중 일곱은 무기가 머리 위로 안 솟아 두 값이 같다. 어긋나는 것은
// PR-mage-3 의 attack·walk 과 PR-mage-2 의 walk 셋뿐이다.
//
// 0번 프레임이 기준인 데는 이유가 하나 더 있다. assets/trim.json 의
// <id>_idle 이 바로 이 프레임을 떼어낸 것이고 칸 크기도 같아서, 여기를 h 로
// 잡으면 **대기에서 공격으로 넘어갈 때 크기 점프가 0** 이다. 실제로 9종 모두
// trim.json 의 _idle.h 와 아래 atk.h 가 정확히 같다 — 어긋나면 둘 중 하나가
// 낡은 것이니 다시 재라.
//
// 값은 전부 정리 스크립트가 시트를 재서 뱉은 것이다. 눈대중 금지.
// ch 는 **원본 칸높이**다. 배포 CDN 이나 iOS 가 큰 시트를 몰래 줄여 서빙하면
// h·foot(원본 픽셀 좌표)이 실제 텍스처와 어긋난다 — rig 가 ch 와 텍스처를
// 비교해 그 자리에서 환산한다 (trim.cw 와 같은 자가 보정).
/** 단장 크기 배수 (용병 기준). 1.5 = 단장 지시 2026-08-27 */
const CAPTAIN_SCALE = 1.5;

const SHEET = {
  captain_warrior: { atk: { n: 4, h: 266, foot: 294, ch: 314 }, walk: { n: 8, h: 357, foot: 377, ch: 397 } },
  captain_archer:  { atk: { n: 4, h: 417, foot: 440, ch: 460 }, walk: { n: 8, h: 463, foot: 484, ch: 504 } },
  captain_mage:    { atk: { n: 4, h: 418, foot: 471, ch: 491 }, walk: { n: 8, h: 454, foot: 484, ch: 504 } },

  'PR-warrior-2': { atk: { n: 4, h: 443, foot: 478, ch: 498 }, walk: { n: 8, h: 460, foot: 484, ch: 504 } },
  'PR-warrior-3': { atk: { n: 4, h: 449, foot: 469, ch: 489 }, walk: { n: 8, h: 349, foot: 372, ch: 392 } },
  'PR-archer-2':  { atk: { n: 4, h: 340, foot: 360, ch: 380 }, walk: { n: 8, h: 459, foot: 481, ch: 501 } },
  'PR-archer-3':  { atk: { n: 4, h: 338, foot: 353, ch: 373 }, walk: { n: 8, h: 394, foot: 419, ch: 439 } },
  'PR-mage-2':    { atk: { n: 4, h: 414, foot: 484, ch: 504 }, walk: { n: 8, h: 448, foot: 484, ch: 504 } },
  'PR-mage-3':    { atk: { n: 4, h: 427, foot: 524, ch: 544 }, walk: { n: 8, h: 414, foot: 484, ch: 504 } },
};


/**
 * 이 직군·단계가 쓸 에셋 이름. 단계 시트가 없으면 직군 기본으로 내려온다 —
 * 승급했는데 시트를 아직 안 그린 단계에서 화면이 비면 안 된다.
 */
function captainAsset(cls, tier) {
  const pr = `PR-${cls}-${tier}`;
  return tier > 1 && SHEET[pr] ? pr : `captain_${cls}`;
}

/**
 * 시트 파일 경로. **구분자가 두 벌이라 여기서 흡수한다.**
 *   captain_warrior_idle.png   1단계는 밑줄  (captain_<직군>_<종류>)
 *   PR-warrior-2-idle.png      2·3단계는 붙임표 (PR-<직군>-<단계>-<종류>)
 * 전직 UI 가 쓰던 PR- 이름을 그대로 물려받아서 이렇게 됐다.
 *
 * 이걸 몰라서 2단계로 승급하면 `PR-warrior-2_idle` 을 찾다 전부 실패했고,
 * 그림이 하나도 없어 단장이 아예 안 만들어졌다 — **전직하면 게임이 멈췄다**
 * (단장 지적 2026-08-26).
 */
const capFile = (id, kind) =>
  `/assets/captain/${id}${id.startsWith('PR-') ? '-' : '_'}${kind}`;

const WALK_FPS = 12;              // 8프레임이면 한 걸음 주기 약 0.67초

// 아군 5인 "(" 대형 — 앞(아래)일수록 크고 늦게 그린다
// 용병 5명 — 단장 뒤로 '(' 호. 양 끝이 앞(오른쪽)으로 나오고 가운데가 뒤로 부푼다.
// dy 가 위로 갈수록 멀리 선 것이므로 sc 를 줄이고 z 를 낮춘다 — 겹쳐도 앞뒤가 읽힌다.
const ALLY_LANE = [
  { dx: 0.34, dy: 0.36, sc: 1.04, z: 16 },
  { dx: -0.22, dy: 0.00, sc: 0.99, z: 15 },
  { dx: -0.46, dy: -0.38, sc: 0.94, z: 14 },
  { dx: -0.22, dy: -0.76, sc: 0.90, z: 13 },
  { dx: 0.34, dy: -1.12, sc: 0.86, z: 12 },
];
// 적 공격 유형 -> 모션. 컷아웃을 안 하므로 몸 전체로 표현한다.
const MOB_MOTION = { charge: 'pounce', thrust: 'thrust', projectile: 'cast' };

/**
 * 단장이 가져가는 파티 DPS 몫 (2026-08-24).
 *
 * **얹는 것이 아니라 떼어 오는 것이다.** 용병들의 평타가 (1 - 이 값) 으로 줄고
 * 그만큼을 단장이 때린다 — 파티 총 화력은 그대로다. 그래서 스테이지 벽·보스
 * 20초·던전 권장 전투력을 다시 잴 필요가 없고, characters.json 의
 * `captain.statEffect: "none"`(CP 에 안 들어간다) 도 그대로 유지된다.
 *
 * 0.15 인 이유: 화면 한가운데 서 있는 주인공이 아무것도 안 하는 것은 이상하지만,
 * 이 값이 커지면 "누구를 뽑았는가" 보다 "단장" 이 세지는 게임이 된다.
 */
const CAPTAIN_SHARE = 0.15;

// 치명타 바탕값. 패시브(SK-P04 치명타율 / SK-P12 치명타 피해)가 여기에 얹힌다 —
// 툴팁이 "+9%" 라고 적으므로 바탕이 어딘가에 이름을 갖고 있어야 한다
const CRIT_BASE = 0.15;
const CRIT_MULT = 2;

const FOE_LANE = [
  { dx: -0.10, dy: 0.20, sc: 1.05, z: 16 },
  { dx: 0.62, dy: -0.12, sc: 0.97, z: 15 },
  { dx: 0.20, dy: -0.72, sc: 0.88, z: 14 },
  { dx: 0.86, dy: -0.86, sc: 0.80, z: 13 },
];

export class BattleScene {
  /**
   * @param opt.data      data/*.json (core/data.js 의 D)
   * @param opt.onEvent   전투 이벤트 콜백 (stage/wave/win/lose/dps)
   */
  constructor(canvas, opt) {
    this.canvas = canvas;
    this.D = opt.data;
    this.onEvent = opt.onEvent || (() => {});
    this.speed = 1;
    this.paused = false;
    this.units = [];
    this.foes = [];
    this.tex = new Map();
    this.activeSkills = [];        // main 이 채운다. 스킬 이펙트 선택에 쓴다
    // 스킬 쿨타임은 **스킬마다** 센다 (skills.json > effect.cooldownSec).
    // 예전에는 유닛마다 rnd(6,11) 을 돌렸다 — 스킬바는 데이터 초로 와이프를
    // 그리는데 실제 발동은 딴 시계를 봐서, 바가 다 찼는데 안 나가는 일이 생겼다.
    this.skCd = new Map();         // skillId -> 남은 초 (시뮬 초, 배속 적용분)
  }

  async init() {
    const P = PIXI();
    const app = new P.Application();
    await app.init({
      canvas: this.canvas, background: '#16202f',
      antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true,
    });
    this.app = app;

    this.world = new P.Container(); app.stage.addChild(this.world);
    this.bg = new P.Container(); this.world.addChild(this.bg);
    this.field = new P.Container(); this.field.sortableChildren = true; this.world.addChild(this.field);
    // 이펙트는 유닛 위, 데미지 숫자 아래에 깔린다
    this.fxLayer = new P.Container(); this.world.addChild(this.fxLayer);
    this.ui = new P.Container(); this.world.addChild(this.ui);

    this.impact = new Impact(P, this.world);
    this.fx = new FxLayer(P, this.fxLayer);
    this.numbers = new DamageNumbers(P, this.ui);

    // 전투에 쓰는 이펙트만 미리 받는다 (소환 연출 FX-* 는 소환 화면에서)
    await this.fx.preload([
      'HIT-01', 'HIT-02', 'HIT-03', 'HIT-04', 'HIT-05', 'HIT-06', 'HIT-07', 'HIT-08',
      'PX-01', 'PX-02', 'PX-03',
      ...Array.from({ length: 9 }, (_, i) => `PJ-0${i + 1}`),
      // 액티브 스킬 수(SK-A01~A16)와 같아야 한다 — 12 로 굳어 있어서 뒤 4종은
      // 그림이 있어도 텍스처가 없어 안 떴다
      ...Array.from({ length: 16 }, (_, i) => `SFX-${String(i + 1).padStart(2, '0')}`),
    ]);

    app.ticker.add(t => this.tick(t.deltaMS));
    app.renderer.on('resize', () => this.layout());

    // 창 resize 이벤트만 믿으면 안 된다. 탭이 숨어 있거나 모바일 주소창이
    // 접혔다 펴질 때 이벤트가 안 오거나 CSS 반영 전에 와서 백버퍼가 어긋난다.
    // 그러면 캔버스가 실제 박스보다 커진 채 남아 화면이 잘려 보인다.
    const host = this.canvas.parentElement;
    const fit = () => {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      if (app.renderer.width === w && app.renderer.height === h) return;
      app.renderer.resize(w, h);
      this.layout();
    };
    this._ro = new ResizeObserver(fit);
    this._ro.observe(host);
    fit();
  }

  /** assets/trim.json — 원화별 불투명 영역. 크기·발밑 기준이 된다. */
  async loadTrim() {
    if (this._trim) return this._trim;
    try {
      const r = await fetch('/assets/trim.json');
      this._trim = r.ok ? await r.json() : {};
    } catch { this._trim = {}; }
    return this._trim;
  }

  async load(path) {
    if (!this.tex.has(path)) {
      try { this.tex.set(path, await PIXI().Assets.load(path)); }
      catch { this.tex.set(path, null); }
    }
    return this.tex.get(path);
  }

  /**
   * 확장자 없이 부른다 — **.webp 가 있으면 그것, 없으면 .png**.
   *
   * 에셋 382장이 전부 PNG 인데 문서(8절)는 "배포 전 WebP 변환 필수" 라고 적어
   * 두었다. 한 장씩 굽는 동안 코드가 그대로여야 그 작업을 나눠서 할 수 있다.
   * (실제로 던전 수문장 6장이 PNG 로 12MB 였다 — 기존 보스 한 장이 200KB 다)
   *
   * @returns {{ tex, src }} 텍스처와 **실제로 쓰인 경로**. cutout 이 같은 파일을
   *   다시 읽어야 해서 경로를 같이 돌려준다
   */
  async loadSprite(base) {
    for (const ext of ['.webp', '.png']) {
      const t = await this.load(base + ext);
      if (t) return { tex: t, src: base + ext };
    }
    return { tex: null, src: null };
  }

  /**
   * 배경 교체. 잘라 붙이면 다음 스테이지로 넘어갈 때 화면이 툭 끊긴다.
   * 새 배경을 같은 스크롤 위상으로 겹쳐 띄우고 교차 페이드한다.
   */
  async setBackground(id) {
    if (this.bgId === id) return;
    const P = PIXI();
    // webp 우선 — 배경은 사진풍이라 webp 절감이 가장 큰 폴더다 (png 는 배포에서 뺐다)
    const { tex: t } = await this.loadSprite(`/assets/bg/${id}`);
    if (!t) return;
    this.bgId = id;

    // 배경 2장을 이어 붙여 무한 스크롤
    // 한 장 걸러 좌우 반전이라 주기가 2*bgW 다. 화면을 덮으려면 4장.
    const layer = new P.Container();
    for (let i = 0; i < 4; i++) layer.addChild(new P.Sprite(t));
    layer.bgTex = t;
    this.bg.addChild(layer);

    const old = this.bgLayer;
    layer.alpha = old ? 0 : 1;
    this.bgLayer = layer;
    if (old) this.bgFade = { old, next: layer, t: 0, dur: 0.8 };
    this.layout();
  }

  /** 스크롤 위상(bgOff)을 모든 레이어에 반영한다. 레이어가 둘이어도 어긋나지 않는다. */
  placeBg() {
    const W = this.bgW;
    if (!W) return;
    const s = this.bgScale;
    const off = ((this.bgOff ?? 0) % (W * 2) + W * 2) % (W * 2);
    for (const layer of this.bg.children) {
      layer.children.forEach((sp, i) => {
        sp.anchor.set(0.5, 0);
        sp.scale.set(i % 2 ? -s : s, s);
        sp.x = i * W - off + W / 2;
        sp.y = 0;
      });
    }
  }

  /** assets/cutout/<ID>.json 이 있으면 무기 팔을 분리해 돌린다. */
  async cutoutFor(id, src) {
    if (!this._cut) this._cut = new Map();
    if (this._cut.has(id)) return this._cut.get(id);
    // 적(E-)·보스(B-·DGB-)는 컷아웃을 안 만든다 — 무기 팔 분리는 용병·단장
    // 전용이다. 그런데도 fetch 를 던지면 스폰마다 404 가 콘솔에 쌓여서, 배포
    // 콘솔이 진짜 오류를 덮는 소음으로 가득했다 (단장 보고 2026-08-26).
    // 없는 걸 아는 부류는 묻지 않는다
    if (/^(E|B|DGB)-/.test(id)) { this._cut.set(id, null); return null; }
    let out = null;
    try {
      const r = await fetch(`/assets/cutout/${id}.json`);
      if (r.ok) out = await loadCutout(PIXI(), src, await r.json());
    } catch { /* 없으면 몸통만 */ }
    this._cut.set(id, out);
    return out;
  }

  /**
   * @param party [{id, class, grade, level}]
   * 단장은 파티와 별개다 — characters.json > captain.combatParticipation: false.
   * 전투에 참여하지 않고 좌측 맨 앞에 지휘 포즈로 선다.
   */
  /**
   * 등급 링 색. SR 부터 보인다 — N·R 까지 칠하면 전원이 빛나서 아무도 안 빛난다.
   * UR·LR 은 진하게. 도감·목록의 GC 팔레트와 같은 색이라 화면 간 신호가 일치한다.
   */
  ringColorOf(grade) {
    return { SR: 0x2196F3, SSR: 0x9C27B0, UR: 0xFF9800, LR: 0xE91E63 }[grade] ?? null;
  }

  /**
   * 등급별 타격 연출 계수. 좋은 유닛일수록 화면이 화려해야 뽑는 보람이
   * 전투에서 회수된다. 다만 방치형은 화면을 몇 시간씩 켜 두므로 추가 비용은
   * 스프라이트 1~2장 + 짧은 입자까지만 — 상시 파티클은 안 쓴다.
   *   size  타격 이펙트 크기 배수
   *   echo  등급색 잔상(같은 이펙트를 등급색으로 한 번 더) 여부
   *   motes 명중 시 등급색 입자 수 (0 = 없음)
   */
  gradeFx(grade) {
    return {
      N: { size: 0.88, echo: false, motes: 0 },
      R: { size: 0.96, echo: false, motes: 0 },
      SR: { size: 1.04, echo: false, motes: 0 },
      SSR: { size: 1.14, echo: true, motes: 0 },
      UR: { size: 1.28, echo: true, motes: 5 },
      LR: { size: 1.42, echo: true, motes: 8 },
    }[grade] || { size: 1, echo: false, motes: 0 };
  }

  /**
   * 편성을 다시 세운다.
   *
   * **겹쳐 부르는 것을 막는다.** 이 함수는 그림을 기다리는 await 가 여럿인데,
   * 호출부 두 곳이 await 없이 부른다(renderAll · applyCaptainClass). 둘이
   * 겹치면 늦게 끝난 쪽이 layout() **뒤에** 유닛을 밀어 넣어, 그 유닛들이
   * 기본 좌표(0,0)에 그대로 남는다 — 화면 왼쪽 위에 전원이 겹쳐 서 있었다
   * (단장 지적 2026-08-25). 표를 하나 들고 있다가 낡은 호출은 스스로 물러난다.
   */
  async setParty(party) {
    // **무대가 아직 없으면 아무것도 안 한다.** init() 이 끝나기 전에 편성이
    // 들어오면 field 가 undefined 라 그 자리에서 예외가 나고, 그 예외가
    // 부팅을 통째로 멈춘다 (전직·초기화가 이른 시점에 겹칠 때 실제로 났다)
    if (!this.field || !this.ui) return;
    const token = (this._partyToken = (this._partyToken || 0) + 1);
    const stale = () => token !== this._partyToken;
    for (const u of this.units) u.rig.view.destroy({ children: true });
    this.units = [];
    if (this.captain) { this.captain.view.destroy({ children: true }); this.captain = null; }
    this.capWing = null;
    if (this.capBar) { this.capBar.destroy(); this.capBar = null; }

    const TR = await this.loadTrim();
    if (stale()) return;
    // 단장 모습은 전직 직업을 따른다 (main 이 setCaptainClass 로 준다).
    // 공격 모션도 직업 모션이다 — 궁수 단장이 검을 휘두르면 전직이 안 읽힌다
    const capCls = this.captainClass || 'warrior';
    // **전직 단계도 외형에 반영한다** (단장 확정 2026-08-26). 예전에는 직군만
    // 봐서, 정예로 승급해도 전투에서는 1단계 모습 그대로였다. 단계 시트가 아직
    // 없는 조합은 captainAsset 이 직군 기본으로 내려 준다.
    const capId = captainAsset(capCls, this.captainTier || 1);
    // 대기 자세는 **공격 시트와 같은 세대의 그림**을 쓴다.
    // 예전 원화(captain_warrior.png)와 시트는 다른 모델이 그린 것이라 선 굵기와
    // 음영이 달랐고, 공격이 시작되는 순간 질감이 확 바뀌어 부자연스러웠다
    // (단장 지적 2026-08-26). _idle 은 시트의 1번 프레임을 그대로 떼어낸 것이다.
    //
    // 원본 captain_warrior.png 는 **그대로 둔다** — UI 초상(명부·프로필)이 정사각
    // 1024² 를 전제로 배치돼 있고, 무기 팔 컷아웃도 그 좌표계다.
    const idle = await this.loadSprite(capFile(capId, 'idle'));
    const base = idle.tex ? idle : await this.loadSprite(`/assets/captain/${capId}`);
    const { tex: capTex, src: capSrc } = base;
    const idleId = capId + (capId.startsWith('PR-') ? '-' : '_') + 'idle';
    const baseId = idle.tex ? idleId : capId;
    const { tex: capAttackTex } = await this.loadSprite(capFile(capId, 'attack'));
    const { tex: capWalkTex } = await this.loadSprite(capFile(capId, 'walk'));
    // **여기서 다시 본다.** 위의 stale 검사는 loadTrim 직후 한 번뿐이었는데,
    // 그 뒤로 시트 넉 장을 기다리는 사이에 두 번째 setParty 가 끼면 낡은
    // 호출도 그대로 내려와 단장을 하나 더 만들어 field 에 넣었다 — 단장이
    // 둘로 겹쳐 보이던 원인이고, 그 유령이 tick 에서 참조되며 화면이
    // 멈추기도 했다 (단장 지적 2026-08-27: 전직 초기화 후 선택 시 멈춤)
    if (stale()) return;
    if (capTex) {
      // 팔 컷아웃은 1024² 원화 좌표라 _idle 그림에는 안 맞는다 — 엉뚱한 데를
      // 떼어 낸다. _idle 을 쓰는 동안에는 몸통 리그만 쓴다.
      const arm = idle.tex ? null : await this.cutoutFor(capId, capSrc);
      if (stale()) return;                     // 컷아웃도 await 다
      const sh = SHEET[capId] || SHEET[`captain_${capCls}`] || {};
      this.captain = new UnitRig(PIXI(), capTex, {
        // 단장은 용병보다 크다 (단장 지시 2026-08-27: 1.5배). 아레나·스테이지
        // 모두 이 값 하나를 본다 — 두 곳에 나누면 화면마다 크기가 갈린다
        size: this.allySize() * CAPTAIN_SCALE, facing: 1, grid: [5, 9],
        motion: motionForClass(capCls), arm,
        trim: TR[baseId] || TR[capId] || TR.captain_warrior,
        attackSheet: capAttackTex,
        attackFrameCount: sh.atk?.n,
        attackTrim: sh.atk && { h: sh.atk.h, footY: sh.atk.foot, ch: sh.atk.ch },
        walkSheet: capWalkTex,
        walkFrameCount: sh.walk?.n,
        walkTrim: sh.walk && { h: sh.walk.h, footY: sh.walk.foot, ch: sh.walk.ch },
      });
      this.captain.capCls = capCls;
      // 자리를 잡기 전에는 숨긴다 — 아래 편성 루프가 그림을 기다리는 동안
      // 단장이 기본 좌표(0,0)에 그려져 화면 왼쪽 위에서 번쩍인다
      this.captain.view.visible = false;
      this.field.addChild(this.captain.view);
      // 이벤트 한정 날개 — 단장 뒤에 붙는 코스메틱. 에셋이 없으면 조용히 넘어간다
      if (this.captainWing) {
        const wingAsset = this.captainWing === 'wing_launch'
          ? 'EV-WING1'
          : `EV-${this.captainWing.toUpperCase()}`;
        const wtex = await this.load(`/assets/captain/${wingAsset}.png`)
          .catch(() => null);
        if (wtex) {
          const w = new (PIXI().Sprite)(wtex);
          // 어깨에서 나오는 크기·높이. 1.25배는 몸을 삼켜서 "따로 붙인" 느낌이었다
          w.anchor.set(0.5, 0.56);
          const h = this.captain.h * 1.12;
          w.height = h; w.width = h * (wtex.width / wtex.height);
          w.position.set(0, -this.captain.h * 0.58);
          w.alpha = 0.96;
          this.captain.view.addChildAt(w, 0);   // 몸 뒤
          // 몸은 숨쉬는데 날개가 정지면 스티커처럼 붙는다 — tick 이 흔든다
          this.capWing = w;
          this.capWingT = 0;
        }
      }
      // 파티 체력바. 단장이 파티를 대표한다 — 용병마다 띄우면 막대밭이 된다.
      this.capBar = new (PIXI().Graphics)();
      this.ui.addChild(this.capBar);
    }
    for (const m of party) {
      // **빈 칸을 거른다.** 편성 5칸을 다 채우는 것이 정상 상태가 아닌데,
      // 여기서 m.id 를 읽다 예외가 나면 **아래 layout() 이 통째로 안 돌아**
      // 이미 만든 유닛들이 기본 좌표(0,0)에 겹쳐 선다 — 화면 왼쪽 위에
      // 전원이 포개져 보이던 원인이다 (단장 지적 2026-08-25)
      if (!m) continue;
      const { tex: t, src } = await this.loadSprite(m.id === 'CAPTAIN'
        ? '/assets/captain/captain_warrior'
        : `/assets/char/${m.id}`);
      // **낡은 호출은 continue 가 아니라 return 이다.** continue 면 뒤 칸을
      // 계속 만들고 루프 끝의 layout() 까지 돌아 새 호출의 배치를 덮어쓴다
      if (stale()) return;
      if (!t) continue;
      const arm = await this.cutoutFor(m.id === 'CAPTAIN' ? 'captain_warrior' : m.id, src);
      if (stale()) return;
      const rig = new UnitRig(PIXI(), t, {
        size: this.allySize(), facing: 1, grid: [5, 9],
        motion: motionForClass(m.class), arm, trim: TR[m.id],
        ringColor: this.ringColorOf(m.grade),
        orbs: m.grade === 'UR' || m.grade === 'LR',
        aura: ['SSR', 'UR', 'LR'].includes(m.grade),
      });
      // 적과 같은 이유로 배치 전에는 숨긴다 (아래 spawnWave 의 주석 참고)
      rig.view.visible = false;
      this.field.addChild(rig.view);
      this.units.push({ ...m, rig, cd: rnd(0.2, 1.2), cdMax: rnd(1.0, 1.5) });
    }
    if (stale()) return;
    this.layout();
    for (const u of this.units) u.rig.view.visible = true;
    if (this.captain) this.captain.view.visible = true;
  }

  /** combat.json > enemyAttack.byId. 없으면 몸통박치기로 본다. */
  enemyKind(id) {
    const t = this.D.combat.enemyAttack;
    return (t && t.byId && t.byId[id]) || 'charge';
  }

  /**
   * @param opt.fallback  그림이 없을 때 대신 쓸 보스 id. 던전 전용 수문장처럼
   *   **아직 안 그려진 에셋**을 가리킬 수 있는 자리에서 쓴다. 이게 없으면
   *   load 실패가 `continue` 로 조용히 넘어가 **적이 0마리인 전투**가 된다 —
   *   보스가 없으니 즉시 승리로 끝난다. 조용한 실패 중 가장 나쁜 쪽이다.
   */
  async spawnWave(kind, ids, hpEach, opt = {}) {
    const TR = await this.loadTrim();
    const P = PIXI();
    this.fx?.clear();
    this.clearFoes();
    for (const id of ids) {
      const dir = kind === 'boss' ? 'boss' : 'enemy';
      let { tex: t, src } = await this.loadSprite(`/assets/${dir}/${id}`);
      if (!t && opt.fallback) ({ tex: t, src } = await this.loadSprite(`/assets/boss/${opt.fallback}`));
      if (!t) continue;
      const arm = await this.cutoutFor(id, src);
      const rig = new UnitRig(P, t, {
        arm,
        // 보스는 확실히 커야 한다. 잡몹과 급이 같으면 "좀 센 잡몹"으로 읽힌다.
        // 잡몹은 아군보다 작아야 하지만 0.68 은 너무 작았다(단장 지적 2026-08-25).
        // 0.88 은 반대로 용병과 거의 같아 잡몹 셋이 서면 오른쪽이 아군 진영만큼
        // 무거워 보인다 — 그 사이 값이다. **크기를 바꾸려면 이 숫자만 만진다.**
        size: kind === 'boss' ? this.allySize() * 1.85 : this.allySize() * 0.85,
        trim: TR[id],
        // facing 은 이동 방향(왼쪽으로 돌진), flip 은 스프라이트 반전.
        // 적 원화는 오른손잡이(무기가 이미지 왼쪽)로 뽑으므로 뒤집지 않는다.
        facing: -1, flip: false, grid: [5, 9],
        // 공격 유형에 따라 모션이 갈린다 (combat.json > enemyAttack)
        motion: MOB_MOTION[this.enemyKind(id)],
      });
      // **자리를 잡기 전에는 숨긴다.** 배치는 루프가 다 끝난 뒤 layout() 이
      // 하는데, 그 사이 다음 그림을 기다리는 동안(await) 이 스프라이트가
      // 기본 좌표(0,0)에 그려져 화면 왼쪽 위에서 잡몹이 번쩍인다
      rig.view.visible = false;
      this.field.addChild(rig.view);
      const bar = new P.Graphics();
      this.ui.addChild(bar);
      const label = null;   // 보스 이름표는 안 쓴다. 체력바만으로 충분하다.
      this.foes.push({ id, rig, bar, label, boss: kind === 'boss',
        atk: this.enemyKind(id),
        hp: hpEach, maxHp: hpEach, cd: rnd(0.5, 1.6), cdMax: rnd(1.3, 2.0) });
    }
    this.layout();
    for (const f of this.foes) f.rig.view.visible = true;
    // **걷기 시계를 여기서 다시 잰다.** phase 는 이 함수를 부르기 전에 'walk'
    // 로 바뀌는데, 그림을 기다리는 동안(await) 시계가 이미 흘러 버린다.
    // 로딩이 걸리면 적이 나타나는 순간 걷기가 끝나 있어, 도착도 하기 전에
    // 제자리에서 두들겨 맞고 죽어 있었다 (단장 지적 2026-08-25)
    if (this.phase === 'walk') this.phaseT = 0;
  }

  /** 아군 5 + 적 4 = 9유닛이 좁은 모바일 화면에 들어가야 한다. 전투 영역 높이 기준. */
  allySize() {
    if (!this.app) return 110;
    const H = this.app.screen.height, W = this.app.screen.width;
    // 아군 5 + 단장 1 + 적 4 = 10유닛. 크게 잡으면 서로 가려 아무것도 안 읽힌다.
    // **이 함수 하나가 전투의 모든 크기 기준이다** — 단장·아군·잡몹·보스·
    // 아레나 상대와 배치 간격까지 전부 여기서 파생된다. 그래서 전체를 줄일 때는
    // 여기만 곱한다 (단장 지시로 0.7배, 2026-08-26).
    return Math.min(H * 0.245, W * 0.19) * 0.7;
  }

  layout() {
    if (!this.app) return;
    const W = this.app.screen.width, H = this.app.screen.height;
    if (this.bgLayer) {
      this.bgScale = H / this.bgLayer.bgTex.height;
      this.bgW = this.bgLayer.bgTex.width * this.bgScale;
      this.placeBg();
    }
    // combat.json > stagePresentation.camera.partyScreenX
    // 오프셋은 화면폭이 아니라 스프라이트 크기 기준이어야 한다.
    // 화면폭 기준으로 잡으면 375px 모바일에서 간격이 16px 로 붕괴해 전부 겹친다.
    const unit = this.allySize() * 0.90;
    // gy 는 발밑 기준선. 0.80 이면 맨 앞 용병이 퀘스트 바에 걸린다.
    const px = W * 0.20, ex = W * 0.69, gy = H * 0.72;
    // 뒤(위)에 선 유닛은 작게 — 원근이 있어야 겹쳐도 읽힌다
    if (this.captain) {
      // 단장은 호의 초점 — 세로 한가운데이면서 가장 앞(오른쪽)
      this.capBy = gy - unit * 0.38;
      this.captain.setBase(px + unit * 0.98, this.capBy);
      this.captain.view.zIndex = 20;
      this.captain.view.scale.set(1.05);
    }
    this.units.forEach((u, i) => {
      const L1 = ALLY_LANE[i % ALLY_LANE.length];
      u.by = gy + L1.dy * unit;
      u.rig.setBase(px + L1.dx * unit, u.by);
      u.rig.view.zIndex = L1.z;
      u.rig.view.scale.set(L1.sc);
    });
    // 상대 단장 — 내 단장의 거울 자리 (ex 쪽 맨 앞). 목표 좌표를 기억해
    // 두면 걷기 구간이 이 자리로 걸어온다
    if (this.foeCap) {
      this.foeCapBx = ex - unit * 0.98;
      this.foeCapBy = gy - unit * 0.38;
      this.foeCap.setBase(this.foeCapBx, this.foeCapBy);
      this.foeCap.view.zIndex = 20;
      this.foeCap.view.scale.set(1.05);
    }
    this.foes.forEach((f, i) => {
      const L2 = FOE_LANE[i % FOE_LANE.length];
      // 목표 자리를 기억해 둔다. walk 구간에는 이 자리로 걸어온다.
      f.bx = ex + L2.dx * unit;
      f.by = gy + L2.dy * unit;
      f.rig.setBase(f.bx, f.by);
      f.rig.view.zIndex = L2.z;
      f.rig.view.scale.set(L2.sc);
    });
  }

  /** 스테이지 시작. requiredCp 로 적 HP 를 역산한다. */
  async startStage(stage, requiredCp, partyDps) {
    // 판 번호. 이전 판이 예약해 둔 지연 콜백을 무효로 만든다
    this.runId = (this.runId || 0) + 1;
    this.stage = stage;
    this.requiredCp = requiredCp;
    this.partyDps = partyDps;
    this.encounter = 0;
    this.mode = 'stage';
    this.bossFight = false;
    this.bossPending = false;
    this.phase = 'walk';
    this.phaseT = 0;
    // 잡몹 웨이브는 제한이 없다. null 이면 타이머를 돌리지도 띄우지도 않는다.
    this.timeLeft = null;
    // 파티 체력. 요구 CP 에 비례해 잡는다 — 스테이지가 오르면 같이 오른다.
    this.partyMaxHp = Math.max(1, this.requiredCp * 1.6);
    this.killStacks = 0;          // 처치 중첩은 전투마다 새로 센다
    this.partyHp = this.partyMaxHp;
    this.onEvent({ type: 'stage', stage, encounter: 0 });
    await this.nextEncounter();
  }

  async nextEncounter() {
    const S = this.D.stages.enemyDerivation;
    const scale = this.D.combat.stageRules.enemyHpScale || 1;
    const hpRatio = 30 / 100;      // 잡몹 ATK40/DEF30/HP30
    const bossHpRatio = S.bossStatRatio.hp / 100;
    const W = this.D.characters.cpWeights;
    const div = r => (W.atk * r.atk + W.def * r.def + W.hp * r.hp) / 100;

    if (this.encounter < S.encountersPerStage) {
      const cpEach = this.requiredCp * 0.85 / S.waveEnemyCount;
      const hp = (cpEach / div({ atk: 40, def: 30, hp: 30 })) * hpRatio * scale;
      const ids = Array.from({ length: S.waveEnemyCount }, (_, i) =>
        `E-${String(1 + ((this.stage * 3 + this.encounter * 2 + i) % 12)).padStart(2, '0')}`);
      await this.spawnWave('mob', ids, hp);
      this.onEvent({ type: 'wave', encounter: this.encounter, boss: false });
    } else if (this.bossPending) {
      // [보스 도전] 을 눌렀을 때만 들어온다
      this.bossPending = false;
      const hp = (this.requiredCp * 2.4 / div(S.bossStatRatio)) * bossHpRatio * scale;
      const b = this.bossAssetId();
      await this.spawnWave('boss', [b], hp);
      this.onEvent({ type: 'wave', encounter: this.encounter, boss: true });
      // 보스 전용 타이머. 잡몹 웨이브를 오래 끌어도 보스에게는 항상 같은 시간을 준다 —
      // bossDamageScale 1.0 이라 체력·방어력이 실제로 물리는 유일한 구간이기 때문이다.
      const bt = this.D.combat.stageRules.bossTimeSeconds;
      this.timeLeft = bt ?? null;
      this.onEvent({ type: 'tick', timeLeft: this.timeLeft });
    }
    this.phase = 'walk';
    this.phaseT = 0;
  }

  /**
   * 절전 — 렌더만 6fps 로 줄인다. combat.json > clientRendering.skipBattle
   * ("렌더를 멈추고 결과만 반영. 배터리·발열 대응").
   * 시뮬은 deltaMS 로 흐르므로 프레임이 줄어도 전투 결과·보상은 동일하다.
   * 완전 정지(0fps)로 안 하는 이유 — 시뮬이 같은 ticker 에 있어 같이 멈춘다.
   */
  setPowerSave(on) {
    if (!this.app) return;
    this.powerSave = !!on;
    // maxFPS 는 minFPS(기본 10) 아래로 안 내려간다 — 10 이 실효 하한이다
    this.app.ticker.maxFPS = on ? 10 : 0;  // 0 = 제한 없음 (모니터 주사율)
    // 화면 자체를 안 그린다. 덮개가 어차피 캔버스를 가리므로 GPU 는 클리어만
    // 하게 두는 것이 배터리에 최선이다. 시뮬(tick)은 stage 가림과 무관하게 돈다
    this.app.stage.visible = !on;
  }

  tick(rawMs) {
    if (this.paused || !this.app) return;
    const scaled = rawMs * this.speed;
    const dt = this.impact.update(scaled);
    const s = dt / 1000;

    // 배경 스크롤 — 걷는 구간에만
    if (this.bgLayer && this.phase === 'walk') {
      this.bgOff = (this.bgOff ?? 0) + 150 * s;
      this.placeBg();
    }
    // 배경 교차 페이드 — 스크롤은 계속 돌면서 그림만 갈린다
    if (this.bgFade) {
      const f = this.bgFade;
      f.t += s;
      const k = Math.min(1, f.t / f.dur);
      f.next.alpha = k;
      f.old.alpha = 1 - k;
      if (k >= 1) { this.bg.removeChild(f.old); f.old.destroy({ children: true }); this.bgFade = null; }
    }

    // 스킬 쿨타임은 **걷는 동안에도** 돈다. 전투 중에만 돌리면 스킬바(실시간 와이프)와
    // 엔진 시계가 갈라져, 바가 다 찼는데 발동이 안 되는 상태가 길게 남는다.
    // 한 조우가 2초쯤이라 쿨 20초짜리는 실제로 40초 넘게 안 나갔다.
    this.tickSkillCd(s);
    this.stepSkillState(s);   // 소환수 수명 · 보호막 지속시간
    // 전투 경과 시간 — 선제·투지가 읽는다. 웨이브가 바뀌면 startWave 가 0 으로
    this.fightT = (this.fightT || 0) + s;
    if (this.pas?.regenPS && this.partyHp != null && this.partyHp < this.partyMaxHp) {
      this.partyHp = Math.min(this.partyMaxHp,
        this.partyHp + this.partyMaxHp * this.pas.regenPS * s);
    }

    if (this.phase === 'walk') {
      this.phaseT += s;
      const W = this.app.screen.width;
      // 보스는 더 멀리서 더 느리게 온다 — 등장 자체가 연출이다
      const dur = this.bossFight ? 1.9 : 1.2;
      const p = Math.min(1, this.phaseT / dur);
      const k = 1 - (1 - p) * (1 - p);            // outQuad
      for (const f of this.foes) {
        if (f.bx == null) continue;
        const from = W + f.rig.w * (f.boss ? 1.1 : 0.7);
        f.rig.setBase(from + (f.bx - from) * k, f.by);
        // 걷는 동안 위아래로 튄다. 정지 이미지 1장이라 이게 없으면 미끄러진다.
        f.rig.base.y = f.by - Math.abs(Math.sin(this.phaseT * 11)) * f.rig.h * 0.045 * (1 - p * 0.5);
        f.rig.view.alpha = Math.min(1, p * 3);
      }
      // 아군은 제자리에서 걷는 척한다 (배경이 흐르므로 전진으로 읽힌다)
      for (let i = 0; i < this.units.length; i++) {
        const u = this.units[i];
        if (u.by == null) continue;
        u.rig.base.y = u.by - Math.abs(Math.sin(this.phaseT * 10 + i * 0.7)) * u.rig.h * 0.04;
      }
      if (this.captain && this.capBy != null) {
        // 걷기 시트가 있으면 그걸 돌린다. 시트가 진짜 걸음을 그리므로 위아래
        // 튀기는 빼야 한다 — 둘을 겹치면 캐릭터가 통통 튄다.
        const sheet = this.captain.playWalk(true, this.phaseT, WALK_FPS);
        this.captain.base.y = sheet ? this.capBy
          : this.capBy - Math.abs(Math.sin(this.phaseT * 10 + 2.2)) * this.captain.h * 0.04;
      }
      // 상대 단장도 걸어온다 — 적 용병들과 같이 오른쪽에서 들어온다.
      // 시트는 좌우가 뒤집혀 있어 그대로 걸으면 이쪽을 향해 온다
      if (this.foeCap && this.foeCapBy != null) {
        const from = W + this.foeCap.w * 0.7;
        this.foeCap.setBase(from + (this.foeCapBx - from) * k, this.foeCapBy);
        const sheet = this.foeCap.playWalk(true, this.phaseT, WALK_FPS);
        if (!sheet) this.foeCap.base.y = this.foeCapBy
          - Math.abs(Math.sin(this.phaseT * 10 + 1.1)) * this.foeCap.h * 0.04;
        this.foeCap.view.alpha = Math.min(1, p * 3);
      }
      if (this.phaseT >= dur) {
        this.phase = 'fight';
        this.fightT = 0;              // 선제(전투 시작 N초)·투지(길수록)의 기준점
        for (const f of this.foes) { f.rig.setBase(f.bx, f.by); f.rig.view.alpha = 1; }
        for (const u of this.units) if (u.by != null) u.rig.base.y = u.by;
        if (this.captain && this.capBy != null) {
          this.captain.playWalk(false);      // 걷기 끄고 리그로 돌아간다
          this.captain.base.y = this.capBy;
        }
        if (this.foeCap && this.foeCapBy != null) {
          this.foeCap.playWalk(false);
          this.foeCap.setBase(this.foeCapBx, this.foeCapBy);
          this.foeCap.view.alpha = 1;
        }
      }
    } else if (this.phase === 'fight') {
      // 아레나는 **판정을 하지 않는다** — 정해진 결과로 HP 를 끌고 갈 뿐이다.
      // combatStep 을 같이 돌리면 진짜 피해가 섞여 들어가 화면과 결과가 어긋난다.
      //
      // **여기서 return 하지 않는다.** 예전에는 곧바로 빠져나갔는데, 그러면
      // 이 함수 아래의 rig.update() 가 통째로 안 돌아 공격을 걸어도 프레임이
      // 한 장에서 멈춘다 — 아레나에서 양쪽 다 모션이 없던 원인이다
      // (단장 지적 2026-08-27)
      if (this.mode === 'arena') this.arenaStep(s);
      else {
      this.combatStep(s);
      // 제한이 걸린 구간(보스)에서만 시간이 준다
      if (this.timeLeft != null) {
        this.timeLeft -= s;
        if (this.timeLeft <= 0) {
          if (this.mode === 'tower' || this.mode === 'dungeon') {
            this.bossFight = false; this.timeLeft = null;
            this.phase = 'done';
            this.onEvent(this.mode === 'tower'
              ? { type: 'towerLose', floor: this.stage }
              : { type: 'dungeonLose', floor: this.stage, reason: 'timeout' });
            return;
          }
          // 보스 실패. 여기서 잡몹을 직접 재개하지 않는다 — 재시작의 주인은
          // main(onEvent lose → runStage) 하나다. 양쪽이 각자 재개하면
          // nextEncounter 체인이 둘 돌면서 서로의 웨이브를 밟아 멈춘다. 실제로 그랬다.
          this.onEvent({ type: 'lose', reason: 'timeout' });
          this.bossFight = false;
          this.timeLeft = null;
          this.phase = 'done';
          this.clearFoes();
        }
      }
      }
    }

    this.fx.update(dt);
    if (this.captain) this.captain.update(dt);
    if (this.foeCap) this.foeCap.update(dt);   // 상대 단장도 살아 움직인다
    // 날개 퍼덕임 — 몸의 숨쉬기와 같은 주기대로 살짝 벌어졌다 오므라든다
    if (this.capWing && !this.capWing.destroyed) {
      this.capWingT = (this.capWingT || 0) + dt / 1000;
      const k = Math.sin(this.capWingT * 2.4);
      this.capWing.scale.x = Math.abs(this.capWing.scale.y) * (1 + k * 0.045)
        * Math.sign(this.capWing.scale.x || 1);
      this.capWing.rotation = k * 0.02;
    }
    this.syncReadyBadge();
    this.drawPartyBar();
    for (const u of this.units) u.rig.update(dt);
    for (const f of this.foes) { f.rig.update(dt); this.drawHpBar(f); }
    this.numbers.update(dt);
    this.onEvent({ type: 'tick', timeLeft: this.timeLeft });
  }

  /**
   * 한 번의 타격을 낸다. 원거리 직군은 무기 끝에서 투사체가 나간다 —
   * 즉발이면 거리가 안 읽힌다.
   */
  launchAttack(u, target, useSkill) {
    if (!target) return;
    const A = this.D.combat.allyAttack;
    const kind = (A?.byClass || {})[u.class] || 'melee';
    if (kind === 'projectile') {
      u.rig.attack(() => {
        if (!target.rig?.view || target.rig.view.destroyed || target.hp <= 0) return;
        const tip = u.rig.weaponTip();
        let id = (A.projectileFx || {})[u.class] || A.projectileFx.fallback;
        if (!this.fx.tex.get(id)) id = (A.projectileFallback || {})[id] || 'HIT-04';
        const tx = target.rig.view.x, ty = target.rig.view.y - target.rig.h * 0.5;
        this.fx.projectile(id, tip.x, tip.y, tx, ty, {
          size: this.fxSize(u.rig.h * 0.34, 0.12),
          dur: 260, arc: -0.1,
          onHit: () => this.hitFoe(u, target, useSkill),
        });
      });
    } else {
      u.rig.attack(() => this.hitFoe(u, target, useSkill));
    }
  }

  /**
   * **적이 이쪽으로 쏘는 그림.** 아레나 전용이고 판정은 없다 — 맞은 자리에
   * 타격 이펙트만 튄다. 한쪽만 투사체를 날리면 남의 궁수·법사가 맨손으로
   * 서 있는 것처럼 보인다 (단장 지적 2026-08-27).
   */
  launchFoeAttack(f, target) {
    if (!f?.rig || !target?.rig?.view || target.rig.view.destroyed) return;
    const A = this.D.combat.allyAttack;
    const kind = (A?.byClass || {})[f.class] || 'melee';
    f.rig.attack(() => {
      if (kind !== 'projectile') return;
      if (!target.rig?.view || target.rig.view.destroyed) return;
      const tip = f.rig.weaponTip();
      let id = (A.projectileFx || {})[f.class] || A.projectileFx.fallback;
      if (!this.fx.tex.get(id)) id = (A.projectileFallback || {})[id] || 'HIT-04';
      const tx = target.rig.view.x, ty = target.rig.view.y - target.rig.h * 0.5;
      this.fx.projectile(id, tip.x, tip.y, tx, ty, {
        size: this.fxSize(f.rig.h * 0.34, 0.12),
        dur: 260, arc: -0.1,
        onHit: () => this.fx.play('HIT-05', tx, ty,
          { size: this.fxSize(target.rig.h * 0.3, 0.1) }),
      });
    });
  }

  combatStep(s) {
    const alive = this.foes.filter(f => f.hp > 0);
    if (!alive.length) return;

    // 단장도 **실제로 때린다** (2026-08-24). 예전에는 모션만 있고 피해가 0이었다.
    //
    // 다만 피해를 새로 얹지는 않는다 — 파티 총 DPS 를 그대로 두고 그 중
    // CAPTAIN_SHARE 만큼을 단장 몫으로 떼어 온다 (아래 hitFoe 참조). 그래서
    // 스테이지 벽·보스 시간제한·던전 권장 전투력이 하나도 안 바뀐다.
    // characters.json 의 statEffect:none(= CP 에 안 들어간다)도 그대로다.
    if (this.captain) {
      this.capCd = (this.capCd ?? 1.2) - s;
      if (this.capCd <= 0 && !this.captain.act) {
        // 이번 휘두르기의 간격이 곧 이 한 방의 몫이다 (피해 = 초당피해 × 간격)
        const cd = rnd(1.5, 2.7);
        this.capCd = cd;
        const cls = this.captain.capCls || 'warrior';
        // 유닛과 **같은 경로**로 보낸다 — 직업별 근접·투사체 분기와 타격 판정이
        // launchAttack 안에 이미 있다. 여기서 따로 그리면 둘이 갈라진다
        this.capUnit = this.capUnit || {};
        this.capUnit.rig = this.captain;
        this.capUnit.class = cls;
        this.capUnit.cdMax = cd;
        this.capUnit.captain = true;
        this.capUnit.usingSkill = null;
        this.launchAttack(this.capUnit, alive[0], false);
      }
    }

    // 스킬은 **평타 차례를 안 기다린다.** 한 조우가 한두 프레임 만에 끝나는 구간이
    // 많아서, 평타 쿨(u.cd)까지 맞아떨어지길 기다리면 발동 창이 사실상 안 열린다.
    // 준비된 스킬이 있으면 그 프레임에 바로 쏘고, 그 유닛의 평타 차례만 뒤로 민다.
    const cast = this.pickSkillCast();
    if (cast) {
      const u = cast.unit;
      u.usingSkill = cast.skill;
      u.cd = u.cdMax;
      this.fireSkill(cast.skill);
      this.launchAttack(u, alive[0], true);
      u.skillFired = true;
    }

    for (const u of this.units) {
      if (u.skillFired) { u.skillFired = false; continue; }
      u.cd -= s;
      if (u.cd > 0 || u.rig.act) continue;
      u.cd = u.cdMax;
      u.usingSkill = u.pendingSkill || null;   // 수동 발동분
      u.pendingSkill = null;
      if (u.usingSkill) this.fireSkill(u.usingSkill);
      this.launchAttack(u, alive[0], !!u.usingSkill);
    }

    // 적 공격. 컷아웃이 없으므로 몸 전체 연출 + 투사체로 표현한다.
    for (const f of alive) {
      f.cd -= s;
      if (f.cd > 0 || f.rig.act) continue;
      f.cd = f.cdMax;
      // **적은 단장만 노린다.** 체력바가 단장 머리 위 하나뿐이라(파티 대표),
      // 용병을 때리면 맞는 대상과 닳는 바가 서로 달라 무엇이 위험한지 안 읽힌다.
      // 단장이 없을 때만(부팅 전) 용병으로 떨어진다
      const t = this.captain
        ? { rig: this.captain }
        : this.units[(Math.random() * this.units.length) | 0];
      if (!t || !t.rig) continue;
      const hit = () => {
        if (!f.rig?.view || f.rig.view.destroyed || !t.rig?.view || t.rig.view.destroyed) return;
        this.damageParty(f);
        t.rig.hit(-1);
        this.impact.flash(t.rig);
        // 보스 타격은 커야 한다 — 위협은 화면 언어로도 전달된다.
        // 붉은 기운 + 흔들림. 잡몹은 기존 그대로 가볍게
        const boss = !!f.boss;
        this.fx.play('HIT-07', t.rig.view.x, t.rig.view.y - t.rig.h * 0.5,
          { size: this.fxSize(t.rig.h * (boss ? 1.05 : 0.6), boss ? 0.26 : 0.16),
            dur: boss ? 380 : 260, to: boss ? 1.35 : 1.1,
            tint: boss ? 0xff7a6a : 0xffffff });
        if (boss) {
          this.impact.shake(9, 1);
          this.fx.motes(t.rig.view.x, t.rig.view.y - t.rig.h * 0.4, 4,
            { color: 0xff6a5a, spread: t.rig.w * 0.35 });
        }
      };

      if (f.atk === 'projectile') {
        // 제자리에서 기를 모으고, 투사체가 날아가 명중에서 터진다
        f.rig.attack(() => {
          if (!f.rig?.view || f.rig.view.destroyed || !t.rig?.view || t.rig.view.destroyed) return;
          const E = this.D.combat.enemyAttack;
          let id = (E.projectileFx || {})[f.id] || E.projectileFx.fallback;
          // 전용 투사체가 아직 없으면 기존 타격 이펙트로 떨어진다
          if (!this.fx.tex.get(id)) id = (E.projectileFallback || {})[id] || 'HIT-04';
          const x0 = f.rig.view.x - f.rig.w * 0.35;
          const y0 = f.rig.view.y - f.rig.h * 0.55;
          const x1 = t.rig.view.x, y1 = t.rig.view.y - t.rig.h * 0.5;
          this.fx.projectile(id, x0, y0, x1, y1, {
            size: this.fxSize(f.rig.h * 0.34, 0.12),
            dur: 300, arc: -0.12, onHit: hit,
          });
        });
      } else {
        f.rig.attack(hit);
      }
    }
  }

  /**
   * 아군 피해. combat.json > stageRules
   *   잡몹 0.05 배  — 사실상 안 죽는다
   *   보스 1.0 배   — 여기서만 체력·방어력이 실제로 물린다
   */
  damageParty(foe) {
    if (this.partyHp == null) return;
    const R = this.D.combat.stageRules;
    const scale = foe.boss ? (R.bossDamageScale ?? 1) : (R.mobDamageScale ?? 0.05);
    // 가시 오라 — 맞는 순간 적에게 되돌린다. 잡몹도 때리므로 스테이지에서
    // 실제 딜이 된다 (예전 '반사' 는 받은 피해 비례라 0.05 배 앞에서 무력했다)
    if (this.pas?.thorns && foe.hp > 0) {
      foe.hp -= this.partyDps * this.pas.thorns;
      if (foe.hp <= 0) this.killFoe?.(foe);
    }
    // 방어력·체력 강화 패시브. 파티 최대 체력은 요구 CP 로 정해져 있어(난이도 기준선)
    // 늘릴 수 없다 — 대신 **받는 피해**를 줄여 같은 뜻으로 만든다
    let raw = this.partyMaxHp * 0.035 * scale * rnd(0.85, 1.15)
      * passiveTakenMult(this.pas || EMPTY_PASSIVES);
    // 보호막이 있으면 **먼저** 깎인다 — 이게 없으면 party_shield 는 시전 모션뿐인
    // 장식이 된다 (실제로 그랬다)
    if (this.shield > 0) {
      const absorb = Math.min(this.shield, raw);
      this.shield -= absorb;
      raw -= absorb;
      if (this.shield <= 0) this.shieldLeft = 0;
    }
    this.partyHp = Math.max(0, this.partyHp - raw);
    if (this.partyHp <= 0 && this.phase === 'fight') {
      this.phase = 'done';
      this.bossFight = false;
      this.timeLeft = null;
      // 전멸. 모드마다 뒤처리가 다르므로(스테이지는 잡몹 재개, 탑·던전은 목록으로)
      // 이벤트를 갈라 보낸다. 재시작의 주인은 어느 쪽이든 main 하나다
      const e = { tower: 'towerLose', dungeon: 'dungeonLose' }[this.mode] || 'lose';
      this.onEvent({ type: e, floor: this.stage, reason: 'wipe' });
    }
  }

  /**
   * 유닛의 **실제 렌더 경계** 위쪽. 체력바는 여기에 얹는다.
   *
   * rig.h 로 계산하면 안 된다 — view.scale 과 rigRoot 안의 shrink·스쿼시가 더 곱해져
   * 배율이 1 을 넘는 유닛(단장 1.05 등)에서 바가 머리 안으로 파고든다.
   * 경계는 매 프레임 바뀌므로 매번 읽는다. 유닛 10개 안팎이라 비용은 무시할 만하다.
   */
  headTop(rig) {
    // **리그 자체 치수로 잰다. getBounds() 를 쓰면 안 된다.**
    // getBounds() 는 지금 켜져 있는 것의 경계다 — 단장이 공격 시트로 바뀌면
    // 그 칸이 리그보다 넓고(불꽃 호까지 뻗는다) 경계가 확 커진다. 그러면
    // 머리 폭에 매달린 체력바가 공격할 때마다 쭉 늘어난다 (단장 지적 2026-08-26).
    // view.x/y 는 발 위치, w/h 는 캐릭터 치수라 무엇이 보이든 변하지 않는다.
    const w = rig.w || rig.view.getBounds().width;
    const h = rig.h ?? 0;
    const p = this.ui.toLocal({ x: rig.view.x, y: rig.view.y - h });
    return { cx: p.x, top: p.y, w };
  }

  /**
   * 수동 스킬 발동 (#skills 의 i 번째 액티브를 탭). AUTO OFF 일 때만 부른다.
   * 준비된 유닛 아무나 하나가 그 스킬을 쓴다 — 유닛-스킬 매핑이 없는 구조라
   * "어떤 스킬을 쏠지"만 유저가 고르는 셈이다.
   */
  castSkillManual(i) {
    const sk = this.activeSkills[i];
    if (!sk || !this.skillReady(sk)) return false;
    const u = this.units.find(x => x.rig && !x.rig.act) || this.units[0];
    if (!u) return false;
    u.pendingSkill = sk;          // update 루프의 발동 경로가 이걸 집어 쓴다
    this.fireSkill(sk);
    this.anyReady = false;
    return true;
  }

  /** skills.json 의 쿨타임(초). 없으면 8 */
  cooldownOf(sk) {
    const base = this.D.skills.skills.find(k => k.id === sk.id)?.effect?.cooldownSec || 8;
    // 마나 해일(3차 마법사) — 쿨타임 곱연산 감소. main 이 skillCdMult 로 준다
    return base * (this.skillCdMult || 1);
  }

  skillReady(sk) { return (this.skCd.get(sk.id) ?? 0) <= 0; }

  /** 프레임마다 전 스킬 쿨을 깎는다. 새로 장착된 스킬은 조금씩 어긋나게 시작한다 */
  tickSkillCd(s) {
    this.activeSkills.forEach((sk, i) => {
      if (!this.skCd.has(sk.id)) { this.skCd.set(sk.id, i * 0.7); return; }
      this.skCd.set(sk.id, this.skCd.get(sk.id) - s);
    });
  }

  /**
   * 이번 스텝에 나갈 스킬 하나와 시전자. 준비된 것 중 **가장 오래 기다린 것**을
   * 고른다 — 예전엔 무작위라 쿨이 끝난 스킬을 두고 다른 걸 또 뽑는 일이 있었다.
   * 한 스텝에 하나만 내보내 여러 개가 한 프레임에 겹치는 것을 막는다.
   */
  pickSkillCast() {
    if (this.skillAuto === false) {
      this.anyReady = this.activeSkills.some(sk => this.skillReady(sk));
      return null;
    }
    const ready = this.activeSkills.filter(sk => this.skillReady(sk));
    if (!ready.length) return null;
    // 더 많이 밀린 것(음수로 더 내려간 것)부터
    ready.sort((a, b) => (this.skCd.get(a.id) ?? 0) - (this.skCd.get(b.id) ?? 0));
    // 시전자는 **평타가 가장 빨리 도는 유닛**이다. 아무나 집으면 그 유닛의
    // 평타 차례를 기다리느라 준비된 스킬이 또 밀린다
    const unit = this.units.filter(u => u.rig && !u.rig.act)
      .sort((a, b) => a.cd - b.cd)[0];
    return unit ? { skill: ready[0], unit } : null;
  }

  /** 쿨타임을 걸고 스킬바에 와이프를 알린다. 실시간 = 데이터 초 / 배속 */
  fireSkill(sk) {
    // 스킬 소리. **효과 종류(effect.kind)가 아니라 스킬 id 로 고른다** — 같은
    // 종류라도 화염과 얼음은 다른 소리여야 하고, 표를 하나 더 두면 스킬이
    // 늘 때 두 곳을 고쳐야 한다. 표에 없는 스킬은 조용하다(참격으로 때우면
    // 엉뚱한 소리가 난다)
    playSfx(SKILL_SFX[sk.id]);
    const cd = this.cooldownOf(sk);
    this.skCd.set(sk.id, cd);
    this.applySkillEffect(sk);
    this.onEvent({ type: 'skillCast', id: sk.id, sec: cd / (this.speed || 1) });
  }

  /**
   * 피해 말고 **상태**를 만드는 스킬. skillDmg 는 atkRatio 가 있는 것만 보므로
   * 보호막·소환처럼 화면에 뭔가 나와야 하는 종류는 여기서 처리한다.
   */
  applySkillEffect(sk) {
    const e = this.D.skills.skills.find(k => k.id === sk.id)?.effect;
    if (!e) return;
    if (e.kind === 'party_shield') this.grantShield(sk, e);
    if (e.kind === 'summon') this.spawnSummons(sk, e);
    this.playAllyFx(sk);
  }

  /**
   * 장착한 패시브의 수치를 모은다. 매 타격마다 배열을 훑으면 프레임마다
   * 같은 계산을 반복한다 — 편성이 바뀔 때(syncPassiveAura) 한 번만 잰다.
   * 합산식은 core/passives.js 하나뿐이다. main 의 파티 DPS 도 같은 것을 읽는다 —
   * 두 곳이 각자 재면 툴팁·DPS·전투가 서로 다른 수치로 굴러간다.
   */
  calcPassives() {
    this.pas = passiveAgg(this.passiveSkills || [], this.D.skills);
    this.killStacks = 0;      // 처치 중첩(응징의 오라)은 편성이 바뀌면 리셋
  }

  /**
   * 장착한 패시브 중 이 순간(at)에 걸린 것 하나를 뽑아 연출한다.
   * 여러 개가 한 프레임에 겹치면 무엇이 터진 건지 안 읽히므로 **하나만** 낸다.
   */
  passiveFxAt(at, x, y, size) {
    const list = this.passiveSkills || [];
    if (!list.length || !this.fx) return;
    for (const sk of list) {
      const cfg = PASSIVE_FX[sk.id];
      if (!cfg || cfg.at !== at) continue;
      if (Math.random() >= (cfg.chance ?? 0)) continue;
      this.fx.play(cfg.asset, x, y, {
        size: this.fxSize(size * (cfg.scale || 0.7), 0.22),
        dur: 380, from: 0.5, to: 1.15, tint: cfg.tint,
      });
      return;                    // 한 순간에 하나만
    }
  }

  /**
   * 상시 패시브(재생·불굴)의 고리. 대열 유닛 발밑에 은은히 깔린다.
   * 매 프레임 그리지 않고, 장착이 바뀔 때 한 번만 세운다.
   */
  syncPassiveAura() {
    this.calcPassives();
    const list = this.passiveSkills || [];
    const auras = list.map(sk => PASSIVE_FX[sk.id]).filter(c => c && c.at === 'aura');
    for (const u of [...(this.captain ? [{ rig: this.captain }] : []), ...this.units]) {
      const r = u.rig;
      if (!r?.view || r.view.destroyed) continue;
      if (r.passiveRing) { r.passiveRing.destroy(); r.passiveRing = null; }
      if (!auras.length) continue;
      const P = PIXI();
      const g = new P.Graphics()
        .ellipse(0, 0, r.w * 0.34, r.w * 0.12)
        .stroke({ color: auras[0].tint, width: 2, alpha: 0.5 });
      g.y = 1;
      r.view.addChildAt(g, 0);     // 몸 뒤
      r.passiveRing = g;
    }
  }

  /**
   * 아군 쪽에서 터지는 스킬 연출. 적을 때리는 스킬은 hitFoe 가 타격 지점에
   * 그리지만, 버프·회복·보호막·소환은 때리는 대상이 없어 **아무 데서도 안 떴다**.
   * SKILL_FX.at 이 'party' 면 대열 전체에, 'captain' 이면 단장에게 그린다.
   */
  playAllyFx(sk) {
    const cfg = SKILL_FX[sk.id];
    if (!cfg || cfg.at === 'foe') return;
    const asset = skillFx(sk.id);
    if (!asset) return;
    const opt = { dur: 520, from: 0.4, to: 1.25, hold: 0.25 };
    if (cfg.tint) opt.tint = cfg.tint;
    const sc = cfg.scale || 1;

    if (cfg.at === 'captain' && this.captain) {
      this.fx.play(asset, this.captain.view.x, this.captain.view.y - this.captain.h * 0.45,
        { ...opt, size: this.fxSize(this.captain.h * 1.3 * sc, 0.34) });
      return;
    }
    // 파티 전체 — 단장까지 포함해 한 명씩. 한 덩어리로 크게 터뜨리면
    // 누구에게 걸린 건지 안 보인다
    const all = [...(this.captain ? [{ rig: this.captain }] : []), ...this.units];
    all.forEach((u, i) => {
      const r = u.rig;
      if (!r?.view || r.view.destroyed) return;
      // 살짝씩 어긋나게 터져야 "쭉 퍼진다"로 읽힌다
      setTimeout(() => {
        if (!r.view || r.view.destroyed) return;
        this.fx.play(asset, r.view.x, r.view.y - r.h * 0.42,
          { ...opt, size: this.fxSize(r.h * 1.0 * sc, 0.3) });
      }, i * 55);
    });
  }

  /**
   * 보호막 — 파티 최대 체력의 일정 비율을 **따로 쌓아** 먼저 깎는다.
   * 잡몹 피해는 0.05 배라 사실상 안 죽으므로 이 스킬이 값을 하는 곳은 보스전이다.
   * 체력바 위에 하늘색 덧바로 보인다 (drawPartyBar).
   */
  grantShield(sk, e) {
    if (this.partyMaxHp == null) return;
    const lvMul = 1 + (sk.level || 0) * 0.06;         // 스킬 레벨 성장은 피해와 같은 식
    const amt = this.partyMaxHp * (e.maxHpRatio || 0) * lvMul;
    this.shield = Math.max(this.shield || 0, amt);     // 겹쳐도 더 큰 쪽 하나
    this.shieldMax = this.shield;
    this.shieldLeft = e.durationSec || 8;
    if (this.captain) {
      this.fx.play('HIT-05', this.captain.view.x, this.captain.view.y - this.captain.h * 0.5,
        { size: this.fxSize(this.captain.h * 1.1, 0.3), dur: 460, to: 1.25 });
    }
  }

  /**
   * 소환수 — 지속시간 동안 단장 옆에 실제로 서서 같이 때리는 척한다.
   * 피해는 이미 skillDmg 가 burst 로 한 번에 넣으므로(= count x durationSec)
   * 여기서 또 때리면 두 번 들어간다. **연출만** 한다.
   */
  async spawnSummons(sk, e) {
    if (!this.captain || !this.field) return;
    const P = PIXI();
    // 소환수 몸은 **실제 냥이 원화**다. 타격 이펙트를 파랗게 물들여 놓으면
    // 무엇이 나온 건지 안 읽힌다 (처음에 그렇게 했다가 "아무것도 안 보인다"는
    // 보고를 받았다). N-01 = 가장 작은 잡냥이 원화.
    const tex = await this.load('/assets/char/N-01.webp');
    if (!tex || !this.captain) return;
    const n = e.count || 1;
    this.summons = this.summons || [];
    for (let i = 0; i < n; i++) {
      const g = new P.Container();
      // 대열 **앞**(적 쪽)에 선다. 뒤에 두면 본대 스프라이트에 완전히 가린다.
      const side = i % 2 ? -1 : 1;
      const bx = this.captain.view.x + 34 + 16 * Math.floor(i / 2);
      const by = this.captain.view.y + side * (16 + 7 * Math.floor(i / 2));
      const body = new P.Sprite(tex);
      body.anchor.set(0.5, 0.94);
      body.height = this.captain.h * 0.62;
      body.width = body.height * (tex.width / tex.height);
      body.tint = 0xcdeeff;          // 소환수는 반투명 하늘빛 — 본대와 구분된다
      body.alpha = 0;
      // 발밑 그림자가 없으면 공중에 뜬 것처럼 보인다
      const sh = new P.Graphics()
        .ellipse(0, 0, body.width * 0.3, body.width * 0.11)
        .fill({ color: 0x000000, alpha: 0.35 });
      g.addChild(sh, body);
      g.x = bx; g.y = by;
      this.field.addChild(g);
      this.summons.push({ g, body, sh, t: 0, life: e.durationSec || 12, phase: i * 0.5,
        y0: by });
    }
  }

  /** 소환수·보호막 수명. tick 이 매 프레임 부른다 (dt 는 시뮬 초) */
  stepSkillState(dt) {
    if (this.shieldLeft > 0) {
      this.shieldLeft -= dt;
      if (this.shieldLeft <= 0) { this.shield = 0; this.shieldLeft = 0; }
    }
    if (!this.summons?.length) return;
    for (const s of this.summons) {
      s.t += dt;
      const k = s.t / s.life;
      // 등장 0.2초 페이드인 · 퇴장 0.4초 페이드아웃 · 그 사이 둥실
      const a = k > 0.94 ? Math.max(0, (1 - k) / 0.06) : Math.min(1, s.t / 0.2);
      s.body.alpha = a * 0.9;
      s.sh.alpha = a * 0.35;
      // 제자리 통통 — 절대 좌표로 잡는다. 매 프레임 더하면 화면 밖으로 샌다
      s.g.y = s.y0 + Math.sin((s.t + s.phase) * 5) * 3;
      s.body.y = -Math.abs(Math.sin((s.t + s.phase) * 5)) * 4;
    }
    this.summons = this.summons.filter(s => {
      if (s.t < s.life) return true;
      s.g.destroy({ children: true });
      return false;
    });
  }

  /** 수동 모드에서 준비 상태를 #skills 아이콘에 반영한다. 프레임마다 부른다. */
  syncReadyBadge() {
    if (this.skillAuto !== false) return;
    this.activeSkills.forEach((sk, i) => {
      const el = document.querySelectorAll('#skills .sk')[i];
      if (el && !el.classList.contains('lock')) {
        el.classList.toggle('ready', this.skillReady(sk));
      }
    });
  }

  /** 단장 머리 위 파티 체력바. 보스 바와 같은 문법을 쓰되 색만 다르다. */
  drawPartyBar() {
    const g = this.capBar;
    if (!g || !this.captain || this.partyHp == null) return;
    g.clear();
    const c = this.captain;
    const p = Math.max(0, this.partyHp / this.partyMaxHp);
    const hb = this.headTop(c);
    // 폭은 **머리 폭 기준**이다. 1.05 는 머리보다 넓다는 뜻이라 유닛이 커지면
    // 막대가 몸보다 길어 보인다 — 0.8 로 머리 안쪽에 앉힌다 (단장 지적 2026-08-25)
    const h = 7;
    const w = hb.w * 0.8;
    const x = hb.cx - w / 2;
    // 머리 바로 위. 8px 은 바 자체 높이, 6px 은 머리와의 간격이다.
    const y = hb.top - h - 6;
    g.roundRect(x - 2, y - 2, w + 4, h + 4, 6)
      .fill({ color: 0x0a1020, alpha: 0.9 })
      .stroke({ color: 0x7ad8ff, width: 1.5, alpha: 0.9 });
    // 보호막은 체력바 위에 하늘색으로 덧그린다 — 남은 양이 눈에 보여야
    // "보호막이 걸렸다"가 읽힌다
    if (this.shield > 0) {
      const sp = Math.min(1, this.shield / this.partyMaxHp);
      g.roundRect(x, y - 4, w * sp, 3, 1.5)
        .fill({ color: 0x9ad8ff, alpha: 0.95 });
    }
    g.roundRect(x, y, w * p, h, 3)
      .fill({ color: p > 0.3 ? 0x4bd86a : 0xffa63a });
    g.roundRect(x, y, w * p, h * 0.4, 3).fill({ color: 0xffffff, alpha: 0.25 });
  }

  /**
   * 이펙트 크기 상한. 배수만 쓰면 보스가 커질 때 화면을 통째로 덮는다.
   * 화면 짧은 변의 일정 비율을 넘지 않게 자른다.
   */
  fxSize(want, cap = 0.42) {
    const s = Math.min(this.app.screen.width, this.app.screen.height);
    return Math.min(want, s * cap);
  }

  /**
   * 스킬 한 방의 평타 대비 배율과 대상 수.
   * 배율 = atkRatio x (등급계수 / 기준등급계수) x (1 + 레벨*0.06)
   * — skills.json > effectScaling 과 같은 식이고 UI 툴팁도 이 값을 쓴다.
   * 피해가 없는 스킬(버프·회복)은 평타로 친다. 시전 연출만 하고 수치는 안 만든다.
   */
  skillDmg(active) {
    const sk = this.D.skills.skills.find(k => k.id === active.id);
    const e = sk?.effect;
    if (!e?.atkRatio) return null;
    const gc = this.D.skills.gradeCoef;
    const base = gc[this.D.skills.effectScaling.baselineGrade] || 600000;
    const scale = (gc[active.grade] || base) / base * (1 + (active.level || 0) * 0.06);
    // 소환수는 지속시간 동안 때린 총량을 한 번에 넣는다 (sim/engine.js 와 같은 근사).
    // 한 대 분량만 넣으면 "12초간 2기"라는 설명이 31% 짜리 한 방이 돼 버린다
    const burst = e.kind === 'summon'
      ? (e.count || 1) * Math.round(e.durationSec || 1) : 1;
    // 전직 스킬(마법사 '원소 증폭')이 스킬 피해에 곱연산으로 얹힌다 — main 이 준다
    const cs = this.skillDmgMult || 1;
    return { mult: e.atkRatio * scale * burst * cs, targets: e.targets || 1 };
  }

  hitFoe(from, foe, skill) {
    // 패배·웨이브 전환의 clearFoes 뒤에 늦게 도착한 공격 콜백이 파괴된 rig 를
    // 만지면 null.x 로 터지고, 그 예외가 틱 루프를 세운다 — 실제로 그랬다.
    if (!foe || foe.hp <= 0 || !foe.rig?.view || foe.rig.view.destroyed) return;
    // 패시브는 **여기서 실제로 판정된다**. 예전에는 치명타율이 0.15 고정이라
    // "치명타 확률 +9%" 툴팁이 전투와 아무 관계가 없었다
    const P = this.pas || EMPTY_PASSIVES;
    const crit = Math.random() < CRIT_BASE + (P.critAdd || 0);
    // 파티 총 DPS 를 공격 1회분으로 환산 — 실제 판정은 서버가 한다
    const perFull = this.partyDps / Math.max(1, this.units.length) * from.cdMax;
    // 단장 몫. **총량은 그대로다** — 단장이 가져가는 만큼 용병들의 평타가 줄고,
    // 단장이 없으면(연합 마을 등) 몫이 0 이라 예전과 완전히 같다.
    // 이 값을 올리면 화면 한가운데 주인공이 세지지만, 그만큼 용병 편성의 비중이
    // 줄어든다 — 뽑기 게임의 축을 흐리지 않도록 낮게 잡는다
    const share = this.captain ? CAPTAIN_SHARE : 0;
    // 단장은 **몫과 고정치 중 큰 쪽**으로 때린다.
    // 몫만 두면 용병이 하나도 없는 신규 계정(파티 DPS 0)에서 단장도 0 이 되어
    // 첫 전투가 영영 안 끝난다 — 시작 편성이 비어 있는 것이 정상인 게임이라
    // (용병은 Q1 보상으로 뽑는다) 단장 혼자서도 초반 스테이지는 넘겨야 한다.
    // capFlatDps 는 1스테이지 요구 전투력에 묶여 있어 후반에는 저절로 무의미해진다
    const per = from.captain
      ? Math.max(this.partyDps * share, this.capFlatDps || 0) * from.cdMax
      : perFull * (1 - share);
    // 스킬 배율은 **데이터에서** 온다 (skills.json > effect.atkRatio x 등급·레벨 배율).
    // 예전엔 등급·레벨과 무관하게 무조건 x6 이라, 툴팁의 "공격력의 240%"와
    // 실제 타격이 아무 관계가 없었다. sim/engine.js 와 같은 식이다.
    const sd = skill && from.usingSkill ? this.skillDmg(from.usingSkill) : null;
    // 수호자의 진군(3차 전사) — 보스에게만 곱연산
    const bossMul = foe.boss ? (this.bossDmgMult || 1) : 1;
    // **평타에 얹는다.** 스킬이 평타를 대체하면 배율이 100% 아래인 스킬
    // (화염구 64%, 유령 용병 95%)은 쓸수록 손해가 된다 — 그냥 때리는 게 낫다.
    // sim/engine.js 도 스킬을 평타 루프와 따로 굴려 같은 시간에 둘 다 넣는다.
    // 패시브 곱 — 선제(전투 시작 몇 초) · 투지(전투가 길수록) · 활력(만피) ·
    // 흡혈(고정 공격력). 넷 다 **스테이지 진행에 기여**해야 해서 CP 가 아니라
    // 여기서 실제로 곱해진다 (skills.json > survivalRedesignNote)
    let pasMul = 1;
    if (P.openPct && this.fightT < (P.openSec || 0)) pasMul += P.openPct;
    if (P.ragePS) pasMul += Math.min(P.rageMax, P.ragePS * (this.fightT || 0));
    if (P.vigorAtk && this.partyHp != null && this.partyHp >= this.partyMaxHp * 0.999) {
      pasMul += P.vigorAtk;
    }
    if (P.lifeAtk) pasMul += P.lifeAtk;
    // 관통력 — 전투 모델에 적 DEF 가 없다(스테이지는 DPS 체크다).
    // "방어력 N% 무시" 를 같은 뜻의 피해 증가로 환산한다
    if (P.pierce) pasMul += P.pierce;
    // 응징의 오라 — 이 전투에서 처치한 수만큼 (killFoe 가 쌓는다)
    if (P.killAtk) pasMul += Math.min(this.killStacks || 0, P.killMax) * P.killAtk;
    // 스킬 몫은 **단장 배분 전 값(perFull)** 으로 잰다. 스킬은 용병이 쓰는
    // 것이고 단장 몫과 무관한데, per 에 얹으면 단장이 가져간 만큼 스킬까지
    // 같이 줄어든다 — 툴팁의 "공격력의 240%" 와 실제가 또 어긋난다
    // 심판(damage_amplify) — 확률로 피해를 통째로 곱한다. 크리티컬과 곱해진다:
    // 둘은 별개 판정이라 겹치는 순간이 있어야 "터졌다" 는 맛이 난다
    const amp = P.ampChance && Math.random() < P.ampChance ? P.ampMult : 1;
    const critMul = crit ? CRIT_MULT + (P.critDmgAdd || 0) : 1;
    const dmg = (per + (sd ? perFull * sd.mult : 0)) * critMul * rnd(0.9, 1.1)
      * bossMul * pasMul * amp;
    // 아레나는 **체력을 여기서 안 깎는다.** 승패와 HP 곡선은 arenaStep 이 쥐고
    // 있고 여기 타격은 그림일 뿐이다. 깎게 두면 arenaStep 이 매 프레임 되돌려
    // 놓는 줄다리기가 되고, 운 나쁘면 그 사이 killFoe 가 먼저 터진다
    if (this.mode !== 'arena') foe.hp -= dmg;
    // 즉사 — 체력이 문턱 아래로 떨어진 적을 확률로 끝낸다. 남은 피가 적을수록
    // 판정이 자주 열리므로 **피해를 넣은 뒤에** 본다
    if (this.mode !== 'arena' && P.execChance && foe.hp > 0
        && foe.hp < foe.maxHp * P.execHp && Math.random() < P.execChance) {
      foe.hp = 0;
      this.passiveFxAt('hit', foe.rig.view.x, foe.rig.view.y - foe.rig.h * 0.5, foe.rig.h);
    }
    // 흡혈 — 넣은 피해의 일부를 파티 체력으로. 보스전에서 실제로 버틴다
    if (this.pas?.lifePct && this.partyHp != null && this.partyHp < this.partyMaxHp) {
      this.partyHp = Math.min(this.partyMaxHp,
        this.partyHp + this.partyMaxHp * 0.004 * this.pas.lifePct);
    }
    // 패시브 연출 — 때리는 순간. 효과가 아니라 "그게 붙어 있다"는 표시다
    this.passiveFxAt('hit', foe.rig.view.x, foe.rig.view.y - foe.rig.h * 0.45, foe.rig.h);
    // 폭풍 연사(3차 궁수) — 평타가 한 번 더 때린다. 확률은 main 이 준다.
    // 스킬 타격에는 안 걸린다 — 평타의 스킬이니까
    // 전직(폭풍 연사)과 패시브(이중 공격)가 같은 판정을 쓴다. 따로 굴리면
    // 둘 다 낀 편성에서 한 프레임에 추가 타격이 두 번 떠 숫자가 겹쳐 안 읽힌다.
    const dblChance = (this.doubleHitChance || 0) + (P.dblChance || 0);
    const dblRatio = dblChance > 0
      ? ((this.doubleHitChance || 0) * 1 + (P.dblChance || 0) * (P.dblRatio || 0)) / dblChance
      : 0;
    if (!skill && dblChance && Math.random() < dblChance && foe.hp > 0) {
      const d2 = per * dblRatio * rnd(0.9, 1.1) * bossMul;
      if (this.mode !== 'arena') foe.hp -= d2;
      setTimeout(() => {
        if (foe.rig?.view && !foe.rig.view.destroyed) {
          this.numbers.spawn(foe.rig.view.x + foe.rig.w * 0.1,
            foe.rig.view.y - foe.rig.h * 0.8, d2, 'normal');
          this.impact.flash(foe.rig);
        }
      }, 110);
    }
    // 광역·관통은 남은 적에게도 같은 값이 들어간다. 연출은 주 대상만 크게 하고
    // 곁불은 숫자만 띄운다 — 다섯 군데서 같은 이펙트가 터지면 화면이 뭉갠다
    if (sd && sd.targets > 1) {
      const rest = this.foes.filter(f => f !== foe && f.hp > 0).slice(0, sd.targets - 1);
      for (const t of rest) {
        const d2 = per * sd.mult * rnd(0.9, 1.1);
        if (this.mode !== 'arena') t.hp -= d2;
        if (t.rig?.view && !t.rig.view.destroyed) {
          this.numbers.spawn(t.rig.view.x, t.rig.view.y - t.rig.h * 0.9, d2, 'normal');
          this.impact.flash(t.rig);
          if (t.hp <= 0) this.killFoe(t);
        }
      }
    }

    // 타격 지점 — 몸통 중앙보다 조금 위가 잘 읽힌다
    const hx = foe.rig.view.x, hy = foe.rig.view.y - foe.rig.h * 0.52;
    // 화려함은 등급에서 온다. 스킬이면 **스킬의 등급**, 평타면 용병 등급
    const gfx = this.gradeFx(skill && from.usingSkill ? from.usingSkill.grade : from.grade);
    const gcol = this.ringColorOf(skill && from.usingSkill ? from.usingSkill.grade : from.grade);
    const size = this.fxSize(foe.rig.h * (skill ? 1.15 : 0.95) * gfx.size, 0.30);

    // 스킬이면 스킬 전용 이펙트가 우선한다. 평타 이펙트와 겹치면 뭉개진다.
    const sfx = skill && from.usingSkill ? skillFx(from.usingSkill.id) : null;
    if (sfx) {
      // 스킬은 대상 전체를 덮을 만큼 크게. 이게 스킬을 특별하게 만든다
      this.fx.play(sfx, hx, hy - foe.rig.h * 0.05, {
        size: this.fxSize(foe.rig.h * 1.45 * gfx.size, 0.40), dur: 520, from: 0.45, to: 1.2, hold: 0.3,
      });
      // 상위 등급 스킬은 등급색 잔상이 반 박자 늦게 한 번 더 퍼진다
      if (gfx.echo && gcol) this.fx.play(sfx, hx, hy - foe.rig.h * 0.05, {
        size: this.fxSize(foe.rig.h * 1.7 * gfx.size, 0.44), dur: 620, from: 0.6, to: 1.5,
        hold: 0.15, tint: gcol, spin: rnd(-0.6, 0.6),
      });
      // 시전자 발밑에도 작게 — 누가 썼는지 읽히게
      this.fx.play(sfx, from.rig.view.x, from.rig.view.y - from.rig.h * 0.25, {
        size: this.fxSize(from.rig.h * 0.62, 0.18), dur: 380, from: 0.3, to: 0.9, additive: true,
      });
    } else {
      // 모션별 타격 이펙트. 에셋_생성_프롬프트.md STEP 13 매핑 그대로.
      const pool = HIT_BY_MOTION[from.rig.motion] || HIT_BY_MOTION.slash;
      const id = pool[(Math.random() * pool.length) | 0];
      this.fx.play(id, hx, hy, {
        size, dur: 300, rot: rnd(-0.22, 0.22),
        flip: from.rig.facing < 0, to: 1.35,
      });
      // SSR+ 평타는 등급색 잔상. 같은 그림이 색만 바뀌어 늦게 퍼지므로
      // 추가 에셋 없이 "이 유닛은 다르다"가 읽힌다
      if (gfx.echo && gcol) this.fx.play(id, hx, hy, {
        size: size * 1.25, dur: 380, rot: rnd(-0.3, 0.3),
        flip: from.rig.facing < 0, from: 0.7, to: 1.6, tint: gcol,
      });
    }
    if (gfx.motes && gcol) this.fx.motes(hx, hy, gfx.motes, { color: gcol, spread: foe.rig.w * 0.3 });
    if (crit) {
      this.fx.play('HIT-06', hx, hy, { size: this.fxSize(size * 1.2, 0.34), dur: 420, to: 1.3, spin: rnd(-1, 1) });
    }
    // 직군 패시브 발동 표시 — 때린 쪽에 뜬다
    if (from.class && Math.random() < 0.35) {
      const px = { warrior: 'PX-01', archer: 'PX-02', mage: 'PX-03' }[from.class];
      if (px) this.fx.play(px, from.rig.view.x, from.rig.view.y - from.rig.h * 0.7,
        { size: this.fxSize(from.rig.h * 0.5, 0.16), dur: 340, to: 1.1 });
    }

    // 타격음. 직군에 따라 다른 큐를 쓴다 — 재생기가 60ms 간격과 동시 8개
    // 상한을 지키므로 여기서 따로 아낄 필요가 없다 (core/sfx.js)
    // 크리티컬은 **소리를 따로 안 낸다** (단장 확정 2026-08-26). 화면이 이미
    // 크게 말하고 있다 — 전용 이펙트(HIT-06)·화면 흔들림·빨간 큰 숫자 셋이
    // 동시에 터진다. 거기에 다른 소리까지 얹으면 평타와 섞여 소음이 된다
    playSfx({ warrior: 'sfx_hit_melee', archer: 'sfx_hit_range', mage: 'sfx_hit_magic' }[from.class] || 'sfx_hit_melee');

    foe.rig.hit(-1);
    this.impact.hitStop(skill ? 110 : 70);
    if (skill) this.impact.shake(crit ? 16 : 11, 1);
    this.impact.flash(foe.rig);
    this.impact.puff(foe.rig.view.x + foe.rig.w * 0.12, foe.rig.view.y, -1, skill ? 12 : 5);
    this.numbers.spawn(foe.rig.view.x, foe.rig.view.y - foe.rig.h * 0.95, dmg, crit ? 'crit' : 'normal');

    // 아레나의 사망은 arenaStep 이 정한다 (앞에서부터 순서대로 쓰러진다)
    if (foe.hp <= 0 && this.mode !== 'arena') this.killFoe(foe);
  }

  /** 사망 — 페이드아웃 + HIT-08 + 상승 입자 */
  killFoe(foe) {
    // 처치 수는 밖(main)이 센다 — 퀘스트 monster_kill 의 진행도다
    this.onEvent({ type: 'kill', boss: !!foe.boss });
    foe.rig.die(foe.boss ? 1.6 : 1);
    foe.bar.clear();
    const x = foe.rig.view.x, y = foe.rig.view.y - foe.rig.h * 0.5;
    this.fx.play('HIT-08', x, y, { size: this.fxSize(foe.rig.h * 0.95, 0.30), dur: 560, from: 0.5, to: 1.3, hold: 0.3 });
    this.passiveFxAt('kill', x, y, foe.rig.h);
    // 응징의 오라 — 처치마다 공격력이 쌓인다. 상한은 hitFoe 가 건다
    this.killStacks = (this.killStacks || 0) + 1;
    this.fx.motes(x, y, 14, { spread: foe.rig.w * 0.4 });
    if (this.foes.every(f => f.hp <= 0)) this.onWaveClear();
  }

  async onWaveClear() {
    const S = this.D.stages.enemyDerivation;
    if (this.mode === 'tower' || this.mode === 'dungeon') {
      this.bossFight = false;
      this.phase = 'done';
      this.timeLeft = null;
      this.onEvent(this.mode === 'tower'
        ? { type: 'towerWin', floor: this.stage }
        : { type: 'dungeonWin', floor: this.stage });
      return;
    }
    if (this.bossFight) {
      // 보스 격파 = 스테이지 클리어
      this.bossFight = false;
      this.phase = 'done';
      this.onEvent({ type: 'win', stage: this.stage });
      return;
    }
    this.encounter++;
    if (this.encounter >= S.encountersPerStage) {
      // 3웨이브를 정리하면 보스로 바로 들어간다. 진행은 항상 자동이다.
      this.encounter = 0;
      this.onEvent({ type: 'bossReady' });
      return;                       // main 이 VS 연출을 태우고 challengeBoss 를 부른다
    }
    this.phase = 'walk';
    // **어느 판의 예약인지 기억한다.** 이 600ms 사이에 유저가 던전·탑에 들어가면
    // 새 전투가 이미 서 있는데 옛 스테이지의 다음 웨이브가 뒤늦게 날아와
    // spawnWave 의 clearFoes 로 수문장을 지우고 잡몹 5마리를 세운다.
    // (실제로 그랬다 — 던전에 들어갔더니 적이 5마리였다)
    const id = this.runId;
    setTimeout(() => { if (id === this.runId) this.nextEncounter(); }, 600);
  }

  /**
   * 탑 한 층. 잡몹 웨이브 없이 보스 하나만 나온다.
   * tower.json > floors — 요구 CP·제한시간·적 비율이 전부 거기서 온다.
   */
  async startTowerFloor(floor, requiredCp, partyDps) {
    // 판 번호. 이전 판이 예약해 둔 지연 콜백을 무효로 만든다
    this.runId = (this.runId || 0) + 1;
    const F = this.D.tower.floors;
    this.stage = floor;
    this.requiredCp = requiredCp;
    this.partyDps = partyDps;
    this.mode = 'tower';
    this.encounter = 0;
    this.bossFight = true;
    this.bossPending = true;
    this.partyMaxHp = Math.max(1, requiredCp * 1.6);
    this.killStacks = 0;          // 처치 중첩은 전투마다 새로 센다
    this.partyHp = this.partyMaxHp;
    this.clearFoes();

    const W = this.D.characters.cpWeights;
    const r = F.enemy.statRatio;
    const div = (W.atk * r.atk + W.def * r.def + W.hp * r.hp) / 100;
    const hp = (requiredCp * F.enemy.hpMultiplier / div) * (r.hp / 100);
    const b = `B-${String(1 + (floor % 6)).padStart(2, '0')}`;
    await this.spawnWave('boss', [b], hp);
    this.onEvent({ type: 'wave', encounter: 0, boss: true });
    this.timeLeft = F.timeLimitSeconds;
    this.onEvent({ type: 'tick', timeLeft: this.timeLeft });
    this.phase = 'walk';
    this.phaseT = 0;
  }

  /**
   * 던전 한 층. **탑과 같은 구조다** — 수문장 하나, 제한시간, 파티 체력.
   * 다른 것은 배경·수문장 그림·보상뿐이라 전부 인자로 받는다.
   *
   * 적 스탯 비율은 `tower.json > floors.enemy` 를 그대로 쓴다. 던전용 표를
   * 새로 만들면 같은 "요구 CP 짜리 보스" 가 두 콘텐츠에서 다른 체력을 갖게 되고,
   * 밸런스를 고칠 때 두 곳을 고쳐야 한다. 시간 제한도 같은 20초다
   * (tower.json > timeLimitNote — "판정 구간이 두 개면 규칙을 두 번 배운다").
   *
   * @param o.bossId    수문장 에셋 id (10층마다 바뀐다)
   * @param o.fallback  그 그림이 아직 없을 때 대신 쓸 id
   */
  async startDungeonFloor(o) {
    // 판 번호. 이전 판이 예약해 둔 지연 콜백을 무효로 만든다
    this.runId = (this.runId || 0) + 1;
    const F = this.D.tower.floors;
    this.stage = o.floor;
    this.requiredCp = o.requiredCp;
    this.partyDps = o.partyDps;
    this.mode = 'dungeon';
    this.encounter = 0;
    this.bossFight = true;
    this.bossPending = true;
    this.partyMaxHp = Math.max(1, o.requiredCp * 1.6);
    this.killStacks = 0;          // 처치 중첩은 전투마다 새로 센다
    this.partyHp = this.partyMaxHp;
    this.shield = 0;
    this.clearFoes();

    const W = this.D.characters.cpWeights;
    const r = F.enemy.statRatio;
    const div = (W.atk * r.atk + W.def * r.def + W.hp * r.hp) / 100;
    const hp = (o.requiredCp * F.enemy.hpMultiplier / div) * (r.hp / 100);
    await this.spawnWave('boss', [o.bossId], hp, { fallback: o.fallback });
    this.onEvent({ type: 'wave', encounter: 0, boss: true });
    this.timeLeft = o.timeLimit ?? F.timeLimitSeconds;
    this.onEvent({ type: 'tick', timeLeft: this.timeLeft });
    this.phase = 'walk';
    this.phaseT = 0;
  }

  /**
   * 아레나 한 판. **arena.json > battle.presentation 의 hp_drain 그대로다.**
   *
   * 승패는 밖(main)에서 CP 확률로 **먼저** 정해지고, 여기서는 그 결과에 도달하도록
   * 양쪽 HP 를 깎는다. 틱 시뮬로 승패를 내지 않는 이유는 같은 파일
   * `whyNotTickSim` 에 있다 — 위치·사거리가 없어 동일 CP 단판이 결정론적이 되고
   * 직군 승률이 35% 대 100% 로 갈라진 기록이다.
   *
   * 그래서 여기 규칙은 하나다: **지는 쪽 HP 가 반드시 먼저 0 이 된다.**
   *
   * @param o.foeParty  상대 5명 [{id, grade, class}]
   * @param o.win       내가 이기는가 (이미 정해진 결과)
   * @param o.hpRemain  승자의 남은 HP 비율
   * @param o.duration  연출 길이(초)
   */
  async startArenaMatch(o) {
    this.runId = (this.runId || 0) + 1;
    this.mode = 'arena';
    this.bossFight = false;
    this.bossPending = false;
    this.timeLeft = null;
    this.encounter = 0;
    this.clearFoes();

    // 양쪽 체력은 **비율**로만 다룬다. 실제 스탯을 쓰면 연출이 판정을 흉내 내려
    // 들고, 그 순간 화면과 결과가 어긋날 여지가 생긴다
    this.ar = {
      t: 0,
      dur: Math.max(2, o.duration || 8),
      win: !!o.win,
      remain: Math.min(0.95, Math.max(0.03, o.hpRemain ?? 0.2)),
      myHp: 1, foeHp: 1,
      atkCd: 0,
      ended: false,
    };
    this.partyMaxHp = 1; this.partyHp = 1;   // 파티 체력바가 같은 값을 읽는다

    await this.spawnUnitFoes(o.foeParty);
    // **상대 단장을 세운다.** 예전에는 편성 용병만 세워서, 남의 단장이
    // 화면에 아예 없었다 (단장 지적 2026-08-27). 아레나는 "저 사람의
    // 조합에 졌다" 가 남아야 하는 화면인데 정작 그 사람이 없었다
    await this.spawnFoeCaptain(o.foeCls, o.foeTier);
    this.onEvent({ type: 'arenaHp', my: 1, foe: 1 });
    this.phase = 'walk';
    this.phaseT = 0;
  }

  /**
   * 적 자리에 **용병 스프라이트**를 세운다. 잡몹·보스가 아니라 남의 편성이다.
   * 아레나의 값은 남의 조합을 본다는 데 있어서(연출 기획서 3-2) 그림이 실제
   * 용병이어야 "저 조합에 졌구나" 가 남는다.
   */
  async spawnUnitFoes(party) {
    const TR = await this.loadTrim();
    const P = PIXI();
    this.fx?.clear();
    this.clearFoes();
    const list = (party || []).filter(Boolean).slice(0, 5);
    for (const m of list) {
      const { tex: t, src } = await this.loadSprite(`/assets/char/${m.id}`);
      if (!t) continue;
      const arm = await this.cutoutFor(m.id, src);
      const rig = new UnitRig(P, t, {
        size: this.allySize(), grid: [5, 9],
        // 아군 원화를 적 자리에 세우므로 **좌우를 뒤집는다** — 안 뒤집으면
        // 다섯이 등을 보이고 선다
        facing: -1, flip: true,
        motion: motionForClass(m.class), arm, trim: TR[m.id],
        ringColor: this.ringColorOf(m.grade),
        orbs: m.grade === 'UR' || m.grade === 'LR',
        aura: ['SSR', 'UR', 'LR'].includes(m.grade),
      });
      // 배치 전에는 숨긴다 (spawnWave 의 주석 참고)
      rig.view.visible = false;
      this.field.addChild(rig.view);
      const bar = new P.Graphics();
      this.ui.addChild(bar);
      this.foes.push({ id: m.id, rig, bar, label: null, boss: false, unit: true,
        // 직군을 들고 간다 — 궁수·법사면 이쪽으로 투사체가 날아온다
        // (combat.json > allyAttack.byClass)
        class: m.class,
        atk: 'charge', hp: 1 / list.length, maxHp: 1 / list.length,
        cd: rnd(0.3, 1.2), cdMax: rnd(1.0, 1.6) });
    }
    this.layout();
    for (const f of this.foes) f.rig.view.visible = true;
    // **걷기 시계를 여기서 다시 잰다.** phase 는 이 함수를 부르기 전에 'walk'
    // 로 바뀌는데, 그림을 기다리는 동안(await) 시계가 이미 흘러 버린다.
    // 로딩이 걸리면 적이 나타나는 순간 걷기가 끝나 있어, 도착도 하기 전에
    // 제자리에서 두들겨 맞고 죽어 있었다 (단장 지적 2026-08-25)
    if (this.phase === 'walk') this.phaseT = 0;
  }

  /**
   * 상대 단장. 내 단장과 **같은 시트·같은 규칙**을 쓰되 좌우를 뒤집는다 —
   * 두 벌로 갈리면 크기·발 위치가 반드시 어긋난다. 판정에는 안 들어가고
   * (characters.json > combatParticipation:false) 화면에만 선다.
   */
  async spawnFoeCaptain(cls = 'warrior', tier = 1) {
    if (!this.field) return;
    if (this.foeCap) { this.foeCap.view.destroy({ children: true }); this.foeCap = null; }
    const TR = await this.loadTrim();
    const capId = captainAsset(cls, tier || 1);
    const idle = await this.loadSprite(capFile(capId, 'idle'));
    const base = idle.tex ? idle : await this.loadSprite(`/assets/captain/${capId}`);
    if (!base.tex) return;
    const { tex: capAtk } = await this.loadSprite(capFile(capId, 'attack'));
    const { tex: capWalk } = await this.loadSprite(capFile(capId, 'walk'));
    const idleId = capId + (capId.startsWith('PR-') ? '-' : '_') + 'idle';
    const baseId = idle.tex ? idleId : capId;
    const sh = SHEET[capId] || SHEET[`captain_${cls}`] || {};
    this.foeCap = new UnitRig(PIXI(), base.tex, {
      size: this.allySize() * CAPTAIN_SCALE, facing: -1, flip: true, grid: [5, 9],
      motion: motionForClass(cls), arm: null,
      trim: TR[baseId] || TR[capId] || TR.captain_warrior,
      attackSheet: capAtk, attackFrameCount: sh.atk?.n,
      attackTrim: sh.atk && { h: sh.atk.h, footY: sh.atk.foot, ch: sh.atk.ch },
      walkSheet: capWalk, walkFrameCount: sh.walk?.n,
      walkTrim: sh.walk && { h: sh.walk.h, footY: sh.walk.foot, ch: sh.walk.ch },
    });
    this.foeCapCls = cls;          // 투사체 종류를 가른다 (궁수·법사만 쏜다)
    this.foeCap.view.visible = false;
    this.field.addChild(this.foeCap.view);
    this.layout();
    this.foeCap.view.visible = true;
  }

  /**
   * 아레나 진행. 판정이 아니라 **재생**이다 — 시계가 흐른 만큼 양쪽 HP 를
   * 정해진 종착점으로 끌고 간다. 승자는 remain 에서, 패자는 0 에서 멈춘다.
   */
  arenaStep(s) {
    const a = this.ar;
    if (!a || a.ended) return;
    a.t = Math.min(a.dur, a.t + s);
    const k = a.t / a.dur;                       // 0 → 1

    const loserHp = Math.max(0, 1 - k);          // 패자는 선형으로 0 까지
    const winnerHp = 1 - (1 - a.remain) * k;     // 승자는 remain 까지만
    a.myHp = a.win ? winnerHp : loserHp;
    a.foeHp = a.win ? loserHp : winnerHp;
    this.partyHp = a.myHp;
    // 상대 5명의 체력은 **총량을 5등분해 앞에서부터 깎는다** — 그래야 순서대로
    // 쓰러진다. 다섯이 동시에 얇아지면 누가 죽는지가 안 읽힌다
    const share = 1 / Math.max(1, this.foes.length);
    this.foes.forEach((f, i) => {
      const used = Math.max(0, (1 - a.foeHp) - i * share);
      f.hp = Math.max(0, share - used);
      f.maxHp = share;
      if (f.hp <= 0 && !f.dead) { f.dead = true; f.rig.view.alpha = 0.25; }
      this.drawHpBar(f);
    });

    // 타격 연출. 결과와 무관하므로 아무나 때린다 — 화면이 비면 "정지 화면에서
    // 숫자만 준다" 가 되어 hp_drain 의 취지가 사라진다
    a.atkCd -= s;
    if (a.atkCd <= 0) {
      a.atkCd = 0.28 + Math.random() * 0.22;
      const alive = this.foes.filter(f => !f.dead);
      const u = this.units[(Math.random() * this.units.length) | 0];
      if (u && alive.length) this.launchAttack(u, alive[(Math.random() * alive.length) | 0], false);
      // 상대도 때린다. 한쪽만 움직이면 지는 판에서도 내가 일방적으로 패는 그림이 된다.
      // 궁수·법사면 이쪽으로 투사체가 날아온다 (판정 없음 — 그림이다)
      const f = alive[(Math.random() * alive.length) | 0];
      const myTarget = this.units[(Math.random() * this.units.length) | 0] || this.captain
        && { rig: this.captain };
      if (f) this.launchFoeAttack(f, myTarget);
    }

    // **단장은 자기 박자로 휘두른다.**
    // 예전에는 편성이 0명일 때만 공격했다 — 용병이 하나라도 있으면 단장은
    // 가만히 서 있었고, 아레나에서 "공격 모션이 안 나온다" 로 보였다
    // (단장 지적 2026-08-26). 단장은 전투 판정에 안 들어가지만(characters.json >
    // combatParticipation:false) 화면에서는 맨 앞에 서 있어서 제일 눈에 띈다.
    // 용병과 다른 주기로 돌려야 둘이 겹쳐 한 박자로 굳지 않는다.
    a.capCd = (a.capCd ?? 0.6) - s;
    if (a.capCd <= 0) {
      a.capCd = 0.62 + Math.random() * 0.3;
      if (this.captain && this.foes.some(f => !f.dead)) this.captain.attack?.();
    }
    // 상대 단장도 자기 박자로 — 가만히 선 단장은 "공격 모션이 없다" 로 읽힌다
    a.foeCapCd = (a.foeCapCd ?? 0.9) - s;
    if (a.foeCapCd <= 0) {
      a.foeCapCd = 0.7 + Math.random() * 0.35;
      if (this.foeCap && a.foeHp > 0) {
        const tgt = this.units[(Math.random() * this.units.length) | 0]
          || (this.captain && { rig: this.captain });
        this.launchFoeAttack({ rig: this.foeCap, class: this.foeCapCls }, tgt);
      }
    }

    this.onEvent({ type: 'arenaHp', my: a.myHp, foe: a.foeHp });
    if (a.t >= a.dur) {
      a.ended = true;
      this.phase = 'done';
      this.arenaFinish(a.win);
      this.onEvent({ type: 'arenaEnd', win: a.win });
    }
  }

  /**
   * 끝나는 그림. 이긴 쪽이 서 있고 진 쪽이 무너져야 승패가 화면에 남는다 —
   * 배너 글자만 뜨면 방금 본 전투와 결과가 따로 논다 (연출 기획서 3-1).
   */
  arenaFinish(win) {
    if (win) {
      // 상대가 뒤로 날아가 사라진다
      for (const f of this.foes) {
        if (!f.rig?.view || f.rig.view.destroyed) continue;
        f.rig.view.x += 26;
        f.rig.view.alpha = 0.12;
        f.bar?.clear();
      }
    } else {
      // 내 쪽이 주저앉는다. 회색은 main 이 캔버스에 건다
      for (const u of this.units) {
        if (!u.rig?.view || u.rig.view.destroyed) continue;
        u.rig.view.alpha = 0.3;
      }
      if (this.captain?.view) this.captain.view.alpha = 0.3;
    }
  }

  /**
   * 지금 판을 즉시 끝낸다 (던전 포기). 이벤트는 **안 쏜다** — 부른 쪽이
   * 뒤처리를 이미 하고 있으므로, 여기서 lose 를 또 쏘면 main 이 두 번 정리한다.
   * runId 를 올려 예약된 지연 콜백(다음 웨이브 등)도 같이 무효로 만든다.
   */
  abortRun() {
    this.runId = (this.runId || 0) + 1;
    this.phase = 'done';
    this.bossFight = false;
    this.bossPending = false;
    this.timeLeft = null;
    this.ar = null;
    this.clearFoes();
    this.onEvent({ type: 'tick', timeLeft: null });   // 남은 시간 표시를 지운다
  }

  /** 진행도 UI 의 [보스 도전]. 잡몹을 치우고 보스를 부른다. */
  async challengeBoss() {
    if (this.bossFight || this.phase === 'done') return;
    this.bossFight = true;
    this.bossPending = true;
    this.encounter = this.D.stages.enemyDerivation.encountersPerStage;
    this.clearFoes();
    await this.nextEncounter();
  }

  /** 이번 스테이지 보스의 에셋 id — VS 화면이 쓴다 */
  /** stages.json > bosses 에 있으면 고유 이름, 없으면 스테이지 보스 */
  bossName() {
    if (this.mode === 'tower') return `${this.stage}층 수문장`;
    const b = this.D.stages.bosses.find(x => x.stage === this.stage);
    // 전용 이름이 있는 보스만 이름표를 단다. "스테이지 61 보스"는 읽을 값이 아니다.
    return b ? b.nameKo : null;
  }

  /**
   * 이번 스테이지 보스의 그림.
   *
   * 예전에는 `1 + stage % 6` 이었다 — 스테이지 5 에서 **마룡**(B-06, 데이터상
   * 150 스테이지 보스)이 나왔다. 여섯 얼굴이 6스테이지마다 도는 셈이라
   * 진도와 아무 관계가 없었다.
   *
   * stages.json > bosses 의 마일스톤 표를 따른다:
   *   10 왕 슬라임 · 25 고블린 족장 · 50 리치 · 75 화염 거인 · 100 크라켄 · 150 마룡
   * 10 스테이지 전에는 첫 얼굴(왕 슬라임)이다 — 아직 마일스톤이 없다.
   */
  bossAssetId() {
    let id = 'B-01';
    for (const b of this.D.stages.bosses || []) {
      if (this.stage < b.stage) break;
      id = `B-${b.asset.slice(-2)}`;   // asset 은 "boss_B03" 꼴이라 뒤 두 자가 번호다
    }
    return id;
  }

  /**
   * 적을 치운다. rig 만 destroy 하면 체력바 Graphics 가 ui 레이어에 남아
   * 적 없는 화면에 막대만 떠 있게 된다 — 실제로 그 버그가 났다.
   */
  clearFoes() {
    for (const f of this.foes) {
      f.rig.view.destroy({ children: true });
      f.bar.destroy();
      f.label?.destroy();
    }
    this.foes = [];
    // 상대 단장은 아레나에서만 서므로 여기서 같이 치운다 — 안 치우면
    // 스테이지로 돌아갔을 때 남의 단장이 적 자리에 남는다
    if (this.foeCap) { this.foeCap.view.destroy({ children: true }); this.foeCap = null; }
  }

  /**
   * 체력바. 잡몹은 얇게, 보스는 두껍고 넓게 + 이름표.
   * 머리 위에 그리므로 던전·탑 등 어떤 모드에서도 그대로 따라간다.
   */
  drawHpBar(f) {
    const g = f.bar;
    g.clear();
    if (f.hp <= 0) { if (f.label) f.label.visible = false; return; }

    const p = Math.max(0, f.hp / f.maxHp);
    const boss = f.boss;
    const hb = this.headTop(f.rig);
    // 폭은 머리 폭 기준. 유닛이 커지면서 막대가 몸보다 길어 보여 한 단계씩
    // 줄였다 (보스 1.35→1.05, 잡몹 0.78→0.62 — 단장 지적 2026-08-25)
    const w = Math.min(hb.w * (boss ? 1.05 : 0.62), this.app.screen.width - 16);
    const h = boss ? 11 : 5;
    // 체력바는 머리 위에 붙어 따라간다. 화면 끝에서 잡아두면 몸에서 떨어져 보인다 —
    // 대신 화면보다 넓어지지 않게 폭만 제한한다.
    const x = hb.cx - w / 2;
    // 보스는 테두리가 3px 더 나가므로 간격을 그만큼 더 준다.
    const y = hb.top - h - (boss ? 9 : 5);

    if (boss) {
      // 바깥 테두리 — 잡몹 막대와 급이 다르다는 신호
      g.roundRect(x - 3, y - 3, w + 6, h + 6, 8)
        .fill({ color: 0x1a0405, alpha: 0.92 })
        .stroke({ color: 0xff6a5a, width: 2, alpha: 0.95 });
      g.roundRect(x, y, w * p, h, 5).fill({ color: p > 0.25 ? 0xe0231c : 0xff2030 });
      // 상단 광택 — 납작한 사각형이 아니라 덩어리로 보이게
      g.roundRect(x, y, w * p, h * 0.42, 5).fill({ color: 0xffffff, alpha: 0.22 });
      // 10칸 눈금. 남은 양을 숫자 없이 읽게 한다
      for (let i = 1; i < 10; i++) {
        g.rect(x + w * i / 10 - 0.5, y, 1, h).fill({ color: 0x000000, alpha: 0.45 });
      }
      return;
    }

    g.roundRect(x - 1, y - 1, w + 2, h + 2, 3).fill({ color: 0x000000, alpha: 0.55 });
    g.roundRect(x, y, w * p, h, 2).fill({ color: p > 0.3 ? 0xff5a6a : 0xff2030 });
  }
}
