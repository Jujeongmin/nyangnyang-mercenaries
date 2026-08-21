'use strict';
// 검증 3종: 직군 동등성 / CP-실전 상관계수 / 타임아웃

const E = require('./engine');
const { runStage, buildCp, requiredCp, SKILLS, CHARS, makeRng } = E;

const GRADES = ['N', 'R', 'SR', 'SSR', 'UR'];
const ACTIVE_IDS  = SKILLS.skills.filter(s => s.type === 'active').map(s => s.id);
const PASSIVE_IDS = SKILLS.skills.filter(s => s.type === 'passive').map(s => s.id);

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

const SEEDS = [1000, 8919, 20771];
function beats(build, stage) {
  let w = 0;
  for (const s of SEEDS) if (runStage(build, requiredCp(stage), s).win) w++;
  return w >= 2;
}

// 고정 스테이지를 깨는 데 필요한 최소 배율 (연속값, 낮을수록 강함)
function multNeeded(build, stage, lo = 0.02, hi = 60) {
  const t = (m) => beats({ ...build, mult: m }, stage);
  if (!t(hi)) return Infinity;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (t(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

// 최대 클리어 스테이지
function maxStage(build, lo = 1, hi = 200) {
  if (!beats(build, lo)) return 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (beats(build, mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function randSkills(rng, ids, n) {
  return Array.from({ length: n }, () => ({
    id: pick(rng, ids), grade: pick(rng, GRADES), level: Math.floor(rng() * 15),
  }));
}

// ---------- 1. 직군 동등성 ----------
function classTest(withKit, stage) {
  console.log(`\n=== 1. 직군 동등성 ${withKit ? '(스킬 8칸 장착)' : '(순수 스탯만)'} · St${stage} 기준 ===`);
  const rng = makeRng(42);
  const kitA = withKit ? ACTIVE_IDS.slice(0, 4).map(id => ({ id, grade: 'SSR', level: 5 })) : [];
  const kitP = withKit ? PASSIVE_IDS.slice(0, 4).map(id => ({ id, grade: 'SSR', level: 5 })) : [];
  const rows = [];
  for (const c of ['warrior', 'archer', 'mage']) {
    const b = {
      mercs: Array.from({ length: 5 }, () => ({ classId: c, grade: 'SSR', level: 10 })),
      actives: kitA, passives: kitP, mult: 1,
    };
    const m = multNeeded(b, stage);
    rows.push({ cls: CHARS.classes[c].nameKo, cp: Math.round(buildCp({ ...b, mult: m })), m });
  }
  const ms = rows.map(r => r.m);
  const spread = Math.max(...ms) / Math.min(...ms) - 1;
  console.log('  직군    필요 배율    그때 빌드CP');
  rows.forEach(r => console.log(`  ${r.cls.padEnd(4)}  ${r.m.toFixed(4).padStart(9)}   ${r.cp.toLocaleString().padStart(10)}`));
  console.log(`  => 실전 편차 ${(spread * 100).toFixed(2)}%  (목표 ±5%)  ${spread <= 0.05 ? 'PASS' : 'FAIL'}`);
  return { spread, rows };
}

// ---------- 2. CP-실전 상관계수 ----------
function spearman(a, b) {
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(arr.length);
    for (let i = 0; i < idx.length;) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma, y = rb[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / Math.sqrt(da * db);
}

function randomBuild(rng) {
  return {
    mercs: Array.from({ length: 5 }, () => ({
      classId: pick(rng, ['warrior', 'archer', 'mage']),
      grade: pick(rng, GRADES),
      level: Math.floor(rng() * 20),
    })),
    actives: randSkills(rng, ACTIVE_IDS, 4),
    passives: randSkills(rng, PASSIVE_IDS, 4),
    mult: 1 + rng() * 6,
  };
}

// 이길 수 있는 최대 '요구 CP' (연속값). 스테이지 이산화로 인한 동점 제거.
function beatableCp(build, lo = 100, hi = 5e7) {
  const win = (rc) => {
    let w = 0;
    for (const s of SEEDS) if (runStage(build, rc, s).win) w++;
    return w >= 2;
  };
  if (!win(lo)) return 0;
  if (win(hi)) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = Math.sqrt(lo * hi);      // 로그 스케일 이분탐색
    if (win(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

function correlationTest(N) {
  console.log(`\n=== 2. CP-실전 상관계수 (무작위 빌드 ${N}개, 연속 측정) ===`);
  const rng = makeRng(7);
  const cps = [], pow = [];
  for (let i = 0; i < N; i++) {
    const b = randomBuild(rng);
    const cp = buildCp(b);
    if (!isFinite(cp)) { console.log('  !! CP NaN 발생'); return 0; }
    cps.push(cp); pow.push(beatableCp(b));
  }
  const rho = spearman(cps, pow);
  // 피어슨(로그) 도 함께 - 단조성뿐 아니라 비례성 확인
  const la = cps.map(Math.log), lb = pow.map(v => Math.log(Math.max(v, 1)));
  const ma = la.reduce((s, v) => s + v, 0) / N, mb = lb.reduce((s, v) => s + v, 0) / N;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < N; i++) { const x = la[i] - ma, y = lb[i] - mb; num += x * y; da += x * x; db += y * y; }
  const pear = num / Math.sqrt(da * db);
  console.log(`  CP 범위     ${Math.round(Math.min(...cps)).toLocaleString()} ~ ${Math.round(Math.max(...cps)).toLocaleString()}`);
  console.log(`  실전력 범위 ${Math.round(Math.min(...pow)).toLocaleString()} ~ ${Math.round(Math.max(...pow)).toLocaleString()}`);
  console.log(`  Spearman rho = ${rho.toFixed(4)}   (목표 >= 0.9)  ${rho >= 0.9 ? 'PASS' : 'FAIL'}`);
  console.log(`  log-Pearson  = ${pear.toFixed(4)}`);
  return rho;
}

// ---------- 3. 타임아웃 ----------
function timeoutTest() {
  console.log('\n=== 3. 60초 타임아웃 발생 검사 ===');
  const rng = makeRng(99);
  let total = 0, to = 0;
  for (let i = 0; i < 300; i++) {
    const b = randomBuild(rng);
    const n = 1 + Math.floor(rng() * 200);
    const r = runStage(b, requiredCp(n), 555 + i);
    total++; if (r.state.timeouts > 0) to++;
  }
  console.log(`  타임아웃 전투: ${to}/${total} (${(to / total * 100).toFixed(1)}%)`);
  return to / total;
}

const t0 = Date.now();
classTest(false, 60);
classTest(true, 60);
classTest(true, 150);
correlationTest(Number(process.argv[2]) || 150);
timeoutTest();
console.log(`\n소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
