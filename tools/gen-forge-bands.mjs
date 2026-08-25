// 제작대 등급 확률표(gacha.json > equipmentRateBands.bands)를 다시 만든다.
//
// **손으로 고치지 않는다.** 레벨당 한 행이라 30~60행이고, 등급이 열리고 닫히는
// 규칙이 섞여 있어 손편집은 반드시 어긋난다. 규칙을 여기 적고 표를 굽는다.
//
//   node tools/gen-forge-bands.mjs        # 미리보기만
//   node tools/gen-forge-bands.mjs --write  # gacha.json 에 반영
//
// 규칙 (2026-08-25 · 제작대 레벨 60 → 30 축소):
//   · 레벨당 한 행. 그 레벨에서 나올 수 있는 등급과 확률을 적는다.
//   · gradeUnlock  등급이 처음 열리는 레벨
//   · gradeRemoval 등급이 풀에서 영구히 빠지는 레벨 (최하위부터 걷힌다)
//   · 열려 있는 등급 안에서는 **위로 갈수록 확률이 낮은 기하 분포**를 쓰고,
//     레벨이 오를수록 그 기울기가 완만해져 상위 등급 비중이 커진다.

import { readFileSync, writeFileSync } from 'node:fs';

const MAX_LEVEL = 30;

// 등급이 열리는 레벨 — 60레벨 시절(7·12·18·25·32·39·47·55)을 절반으로 당겼다
const UNLOCK = { 1: 1, 2: 1, 3: 4, 4: 7, 5: 10, 6: 13, 7: 16, 8: 19, 9: 23, 10: 27 };
// 최하위 등급이 걷히는 레벨 — 올라갈수록 바닥이 올라간다
const REMOVE = { 1: 10, 2: 12, 3: 15, 4: 18, 5: 21, 6: 24, 7: 27 };

/** 그 레벨에서 열려 있는 등급들 */
function openTiers(lv) {
  const out = [];
  for (let t = 1; t <= 10; t++) {
    if (UNLOCK[t] > lv) continue;          // 아직 안 열렸다
    if (REMOVE[t] && REMOVE[t] <= lv) continue;  // 이미 걷혔다
    out.push(t);
  }
  return out;
}

/**
 * 확률 분포. 낮은 등급이 흔하고 높은 등급이 귀하다.
 * 레벨이 오를수록 비율(ratio)이 1 에 가까워져 상위 등급 비중이 커진다.
 */
function rates(lv) {
  const ts = openTiers(lv);
  if (!ts.length) return { 1: 100 };
  // 0.30 (초반, 위로 갈수록 급감) → 0.72 (후반, 완만)
  const ratio = 0.30 + 0.42 * ((lv - 1) / (MAX_LEVEL - 1));
  // **낮은 등급이 흔하다.** i=0 이 열려 있는 것 중 최하위라 가중치 1 이고,
  // 위로 갈수록 ratio 를 곱해 줄어든다 (거꾸로 두면 최상위가 제일 흔해진다)
  const w = ts.map((_, i) => Math.pow(ratio, i));
  const sum = w.reduce((a, b) => a + b, 0);
  const out = {};
  let acc = 0;
  ts.forEach((t, i) => {
    // 마지막 항은 잔액으로 채운다 — 합이 정확히 100 이어야 공시가 맞는다
    const v = i === ts.length - 1 ? +(100 - acc).toFixed(4)
      : +((w[i] / sum) * 100).toFixed(4);
    acc = +(acc + v).toFixed(4);
    out[t] = v;
  });
  return out;
}

const bands = [];
for (let lv = 1; lv <= MAX_LEVEL; lv++) {
  const unlocks = Object.entries(UNLOCK).find(([t, l]) => l === lv && +t > 2);
  const removes = Object.entries(REMOVE).find(([, l]) => l === lv);
  bands.push({
    minLevel: lv, maxLevel: lv,
    unlocks: unlocks ? +unlocks[0] : null,
    removes: removes ? +removes[0] : null,
    rates: rates(lv),
  });
}

// 눈으로 확인할 표
for (const b of bands) {
  const s = Object.entries(b.rates).map(([t, v]) => `T${t} ${v}%`).join(' · ');
  console.log(`Lv${String(b.minLevel).padStart(2)}${b.unlocks ? ` [T${b.unlocks} 해금]` : ''}`
    + `${b.removes ? ` [T${b.removes} 제거]` : ''}  ${s}`);
}
for (const b of bands) {
  const sum = Object.values(b.rates).reduce((a, x) => a + x, 0);
  if (Math.abs(sum - 100) > 0.001) throw new Error(`Lv${b.minLevel} 합이 ${sum}`);
}
console.log(`\n${bands.length}행 · 합계 전부 100 · 최대 레벨 ${MAX_LEVEL}`);

if (process.argv.includes('--write')) {
  const p = 'game/public/data/gacha.json';
  const j = JSON.parse(readFileSync(p, 'utf8'));
  j.equipmentRateBands.bands = bands;
  j.equipmentRateBands.gradeUnlock = UNLOCK;
  j.equipmentRateBands.gradeRemoval = REMOVE;
  j.equipmentRateBands.modelNote =
    'v4 (2026-08-25). 레벨당 1행. 제작대 최대 레벨을 60 → 30 으로 줄이고 등급 해금도 '
    + '같은 비율로 당겼다 — 60레벨은 끝이 안 보여 "올려도 티가 안 난다"가 됐다. '
    + '표는 tools/gen-forge-bands.mjs 가 굽는다. 손으로 고치지 말 것.';
  writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log('gacha.json 반영 완료');
}
