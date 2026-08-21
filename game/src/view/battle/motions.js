// 공격 모션 사전. 무기 종류마다 다른 동작을 준다.
//
//   slash   전사 — 칼을 휘두른다. 돌진 + 팔 스윙
//   draw    궁수 — 활을 당겼다 놓는다. 돌진하지 않고 제자리에서 반동
//   cast    마법사 — 지팡이를 들었다 내리친다. 살짝 떠오른다
//   pounce  무기 없음 — 웅크렸다 뛰어올라 덮친다 (E-01 슬라임 등)
//
// 각 모션은 진행도 p(0~1) 를 받아 포즈를 돌려준다.
//   fwd    앞뒤 이동 (스프라이트 폭 배수, 양수 = 전진)
//   up     위로 뜬 높이 (스프라이트 높이 배수)
//   rot    몸 기울기 (rad)
//   squash 양수 = 납작, 음수 = 길쭉
//   bend   메시 휘어짐 (양수 = 진행 방향)
//   arm    스윙 정규값. -1 = 치켜든 끝, 0 = 쉬는 자세, +1 = 내리친 끝.
//          실제 회전량은 rig 가 무기의 쉬는 각도(armRest)를 보고 계산한다 —
//          무기를 어느 방향으로 들고 있든 같은 모션이 통하게 하기 위함이다.
//   armSpan 진폭 배율. 검격 1.0, 활 당기기처럼 작은 동작은 0.2 대
//
// impactAt 은 타격이 일어나는 지점. 여기서 히트스톱·이펙트가 터진다.

import { ease, seg, damped, deg } from './ease.js';

const Z = { fwd: 0, up: 0, rot: 0, squash: 0, bend: 0, arm: 0 };
const BOW = 0.48;   // 활은 팔이 크게 안 돈다. 시위만 당긴다


export const MOTIONS = {
  // 전사 — 검을 휘두른다.
  //
  // 몸통을 회전시키지 않는다. 스프라이트 전체가 기우는 순간 가짜로 읽힌다.
  // 대신 몸은 **앞뒤로 움직이고 눌린다** — 무게가 실렸다는 신호는 회전이 아니라
  // 체중 이동과 착지 충격에서 온다.
  //
  // 속도 배분이 핵심이다. 실제 검격은 세 구간의 길이가 극단적으로 다르다:
  //   예비 0.42  →  타격 0.06  →  복귀 0.52
  // 등가속으로 돌리면 와이퍼가 된다.
  slash: {
    dur: 700, impactAt: 0.48,
    pose(p) {
      // 1) 예비동작 — 느리게 뒤로 당기며 무게를 뒤에 싣는다
      if (p < 0.42) {
        const k = ease.outQuad(seg(p, 0, 0.42));
        return { ...Z,
          fwd: -0.20 * k,
          squash: 0.13 * k,            // 웅크린다
          bend: -0.9 * k,              // 상체가 뒤로 젖혀진다
          arm: -1 * k,                 // 검을 앞위로 치켜든다
        };
      }
      // 2) 타격 — 42ms 안에 끝난다. 여기가 전부다
      if (p < 0.48) {
        const k = ease.inCubic(seg(p, 0.42, 0.48));   // 가속하며 내려친다
        return { ...Z,
          fwd: -0.20 + 0.52 * k,       // 체중이 앞으로 쏟아진다
          squash: 0.13 - 0.30 * k,     // 늘어난다
          bend: -0.9 + 2.3 * k,          // 정점 1.4
          arm: -1 + 2 * k,
        };
      }
      // 3) 착지 충격 — 눌리고 검이 조금 더 나간다
      if (p < 0.60) {
        const k = ease.outQuad(seg(p, 0.48, 0.60));
        return { ...Z,
          fwd: 0.32 - 0.06 * k,
          squash: -0.17 + 0.30 * k,    // 스트레치 → 스쿼시
          bend: 1.4 - 0.33 * k,
          arm: 1 + 0.14 * k,           // 관성으로 조금 더
        };
      }
      // 4) 복귀 — 느리게. 빠르게 되돌리면 무게가 사라진다
      const k = ease.inOutQuad(seg(p, 0.60, 1));
      return { ...Z,
        fwd: 0.26 * (1 - k),
        squash: 0.13 * (1 - k),
        bend: 1.07 * (1 - k),
        arm: 1.14 * (1 - k),
      };
    },
  },

  // 궁수 — 시위를 당겼다 놓는다. 돌진하지 않는다.
  // 당기는 동안 몸이 뒤로 눕고, 발사 순간 앞으로 튕긴다.
  draw: {
    dur: 780, impactAt: 0.58,
    pose(p) {
      // 1) 조준 — 자세를 잡는다
      if (p < 0.20) {
        const k = ease.outQuad(seg(p, 0, 0.20));
        return { ...Z, fwd: 0.05 * k, arm: -0.3 * k, armSpan: BOW, bend: 0.2 * k };
      }
      // 2) 당기기 — 느리게. 팽팽해지는 게 보여야 한다
      if (p < 0.58) {
        const k = ease.inOutQuad(seg(p, 0.20, 0.58));
        return { ...Z,
          fwd: 0.05 - 0.20 * k,
          bend: 0.2 - 1.2 * k,         // 상체가 뒤로 눕는다
          squash: 0.08 * k,
          arm: -0.3 - 0.7 * k, armSpan: BOW,   // 시위를 끌어당긴다
        };
      }
      // 3) 발사 — 튕긴다. 30ms
      if (p < 0.64) {
        const k = ease.inCubic(seg(p, 0.58, 0.64));
        return { ...Z,
          fwd: -0.15 + 0.30 * k,
          bend: -1.0 + 2.2 * k,
          squash: 0.08 - 0.20 * k,
          arm: -1 + 1.5 * k, armSpan: BOW,
        };
      }
      // 4) 반동 — 뒤로 밀렸다 자세를 되찾는다
      const k = seg(p, 0.64, 1);
      const back = damped(k * 2.4, 11, 5);
      return { ...Z,
        fwd: 0.15 * (1 - ease.outQuad(k)) - back * 0.06,
        bend: 1.2 * (1 - ease.outQuad(k)) + back * 0.4,
        squash: -0.12 * (1 - k),
        arm: 0.5 * (1 - ease.outQuad(k)), armSpan: BOW,
      };
    },
  },

  // 마법사 — 지팡이를 치켜들며 떠올랐다가 내리찍는다.
  cast: {
    dur: 900, impactAt: 0.56,
    pose(p) {
      // 1) 영창 — 떠오르며 지팡이를 든다
      if (p < 0.50) {
        const k = ease.outQuad(seg(p, 0, 0.50));
        return { ...Z,
          up: 0.13 * k,
          fwd: -0.07 * k,
          squash: -0.11 * k,
          bend: -0.7 * k,
          arm: -1 * k,
        };
      }
      // 2) 정지 — 절정 직전의 멈춤. 이게 있어야 타격이 무거워진다
      if (p < 0.56) {
        const k = seg(p, 0.50, 0.56);
        return { ...Z,
          up: 0.13 + 0.03 * k, fwd: -0.07,
          squash: -0.11, bend: -0.7 - 0.2 * k, arm: -1 - 0.06 * k,
        };
      }
      // 3) 내리찍기 — 급강하. 50ms
      if (p < 0.62) {
        const k = ease.inCubic(seg(p, 0.56, 0.62));
        return { ...Z,
          up: 0.16 * (1 - k),
          fwd: -0.07 + 0.22 * k,
          squash: -0.11 + 0.42 * k,
          bend: -0.9 + 3.2 * k,
          arm: -1.06 + 2.06 * k,
        };
      }
      // 4) 복귀
      const k = ease.inOutQuad(seg(p, 0.62, 1));
      return { ...Z,
        fwd: 0.15 * (1 - k),
        squash: 0.31 * (1 - k),
        bend: 2.3 * (1 - k),
        arm: 1 * (1 - k),
      };
    },
  },

  // 무기 없음 — 웅크렸다 포물선으로 뛰어 덮치고 되돌아온다.
  // 여기는 회전을 남긴다. 도약체는 실제로 몸이 돈다.
  // 무기를 든 적 — 제자리에서 몸을 기울여 내지른다.
  // 컷아웃이 없어 팔이 안 도는 대신 상체 기울기(bend)와 전진(fwd)으로 무게를 만든다.
  thrust: {
    dur: 620, impactAt: 0.46,
    pose(p) {
      // 1) 뒤로 당긴다 — 짧고 확실하게
      if (p < 0.38) {
        const k = ease.outQuad(seg(p, 0, 0.38));
        return { ...Z, fwd: -0.16 * k, bend: -1.1 * k, squash: 0.10 * k };
      }
      // 2) 내지른다 — 90ms. 여기가 전부다
      if (p < 0.46) {
        const k = ease.inCubic(seg(p, 0.38, 0.46));
        return { ...Z, fwd: -0.16 + 0.52 * k, bend: -1.1 + 2.4 * k, squash: 0.10 - 0.22 * k };
      }
      // 3) 충격 흡수
      if (p < 0.60) {
        const k = ease.outQuad(seg(p, 0.46, 0.60));
        return { ...Z, fwd: 0.36 - 0.05 * k, bend: 1.3 - 0.3 * k, squash: -0.12 + 0.22 * k };
      }
      // 4) 복귀
      const k = ease.inOutQuad(seg(p, 0.60, 1));
      return { ...Z, fwd: 0.31 * (1 - k), bend: 1.0 * (1 - k), squash: 0.10 * (1 - k) };
    },
  },

  pounce: {
    dur: 820, impactAt: 0.54,
    pose(p) {
      if (p < 0.26) {
        const k = ease.outQuad(seg(p, 0, 0.26));
        return { ...Z, squash: 0.34 * k, fwd: -0.09 * k, bend: -0.6 * k };
      }
      if (p < 0.54) {
        const k = seg(p, 0.26, 0.54);
        return { ...Z,
          fwd: 0.58 * ease.outQuad(k),
          up: Math.sin(k * Math.PI) * 0.44,
          squash: -0.22 + 0.22 * k,
          bend: 1.7 * k,
          rot: deg(12) * k,
        };
      }
      if (p < 0.68) {
        const k = ease.outQuad(seg(p, 0.54, 0.68));
        return { ...Z, fwd: 0.58 - 0.07 * k, squash: 0.38 * (1 - k) + 0.10, bend: 1.7 * (1 - k) };
      }
      const k = ease.inOutQuad(seg(p, 0.68, 1));
      return { ...Z,
        fwd: 0.51 * (1 - k),
        up: Math.sin(k * Math.PI) * 0.14,
        squash: 0.10 * (1 - k),
        bend: -0.5 * Math.sin(k * Math.PI),
      };
    },
  },
};

/** 무기 종류 → 모션. characters.json 의 class 값을 그대로 받는다. */
export const motionForClass = cls => ({
  warrior: 'slash',
  archer: 'draw',
  mage: 'cast',
})[cls] || 'pounce';

export const MOTION_NAMES = Object.keys(MOTIONS);
