// 배경 제거 — 모서리에서 flood fill.
// 이 아트 스타일은 캐릭터가 두꺼운 어두운 외곽선으로 닫혀 있어서
// 내부의 흰색(고양이 가슴털, 병아리 몸통)은 채우기가 도달하지 못한다.
'use strict';
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const LIGHT = 208;   // 이 밝기 이상이면 배경 후보
const SAT = 26;      // 채도가 이보다 크면 배경 아님 (유채색 보호)
const FEATHER = 2;   // 경계 부드럽게 할 픽셀 폭

function cutFile(file, outFile) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width: W, height: H, data } = png;
  const idx = (x, y) => (y * W + x) * 4;
  const N = W * H;
  const bg = new Uint8Array(N);

  const isLight = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mn >= LIGHT && (mx - mn) <= SAT;
  };

  // 4변 전체를 시드로
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x;
    if (bg[p]) return;
    if (!isLight(p * 4)) return;
    bg[p] = 1; stack.push(p);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }

  while (stack.length) {
    const p = stack.pop();
    const x = p % W, y = (p / W) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // 알파 0
  let cut = 0;
  for (let p = 0; p < N; p++) if (bg[p]) { data[p * 4 + 3] = 0; cut++; }

  // 경계 페더 — 배경에 인접한 밝은 잔여 픽셀의 알파를 낮춰 흰 테두리 제거
  for (let f = 0; f < FEATHER; f++) {
    const edge = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (bg[p]) continue;
      const i = p * 4;
      if (data[i + 3] === 0) continue;
      const near = bg[p - 1] || bg[p + 1] || bg[p - W] || bg[p + W];
      if (!near) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r * 0.299 + g * 0.587 + b * 0.114);
      if (lum > 200) edge.push(p);
    }
    for (const p of edge) { data[p * 4 + 3] = 0; bg[p] = 1; cut++; }
  }

  fs.writeFileSync(outFile, PNG.sync.write(png));
  return { cut, pct: (cut / N * 100).toFixed(1) };
}

// ---- 실행 ----
const dirs = process.argv.slice(2);
if (!dirs.length) { console.log('usage: node cutbg.js <dir> [dir...]'); process.exit(1); }

for (const d of dirs) {
  const abs = path.resolve(d);
  const files = fs.readdirSync(abs).filter(f => f.toLowerCase().endsWith('.png'));
  let done = 0, skipped = 0;
  for (const f of files) {
    const p = path.join(abs, f);
    const png = PNG.sync.read(fs.readFileSync(p));
    const a = png.data[3];                    // 좌상단 알파
    if (a === 0) { skipped++; continue; }     // 이미 투명이면 건너뜀
    const r = cutFile(p, p);
    done++;
    console.log(`  ${f.padEnd(16)} 배경 ${r.pct}% 제거`);
  }
  console.log(`${d}: ${done}장 처리, ${skipped}장 이미 투명\n`);
}
