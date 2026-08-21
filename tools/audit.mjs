// 죽은 참조 검사기.
//
// 재화를 몇 번 갈아엎으면서 "보상 표에는 있는데 담을 자리가 없어 조용히 사라지는" 항목이
// 반복해서 나왔다 (혼, 가속권 3종, 제련석, 황금 열쇠, SSR 선택권 — 다 합쳐 62곳).
// 눈으로는 못 잡는다. 지급 코드가 아무 소리 없이 무시하기 때문이다.
//
//   node tools/audit.mjs
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const txt = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// 클라이언트가 실제로 담을 수 있는 재화. main.js 의 MAIL_CUR 이 단일 소스다.
const main = txt('game/src/main.js');
const i0 = main.indexOf('const MAIL_CUR');
const BAGS = new Set([...main.slice(i0, i0 + 400).matchAll(/(\w+):\s*'(\w+)'/g)].map(m => m[1]));
for (const k of ['gold', 'diamond']) BAGS.add(k);   // 소모·표시만 하는 것도 살아 있다

const NOT_CURRENCY = new Set([
  'note', 'nameKo', 'id', 'type', 'source', 'purpose', 'formula', 'description',
]);

// 아직 안 정한 것. 지우면 결정을 잊고, 놔두면 매번 경고가 떠서 다른 걸 못 본다.
// 지금은 비어 있다 — 확정 획득 경로는 "전부 삭제"로 정해졌다 (gacha.json > noPity).
const UNDECIDED = new Set([]);

// 서버가 붙어야 담을 수 있는 재화. 클라 혼자서는 상태를 가질 수 없다
// (연합 상태는 개인 세이브가 아니라 컬렉션이다 — alliance.json > verse8).
const SERVER_ONLY = new Set(['alliance_coin']);

// 아직 안 그린 에셋. 프롬프트는 이미 나갔고 그리기만 남았다 — 코드 오류가 아니다.
const TODO_ART = ['ui/IC-SHOP.png', 'ui/CU-11.png', 'ui/CU-12.png'];

const dead = [], pending = [], server = [];

function scanGrants(o, file, at) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) return o.forEach((v, i) => scanGrants(v, file, `${at}[${i}]`));
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (['grant', 'grants', 'rewards', 'bonus', 'perFloor', 'participation', 'clearBonus']
        .includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const c of Object.keys(v)) {
        if (typeof v[c] !== 'number' || NOT_CURRENCY.has(c)) continue;
        if (UNDECIDED.has(c)) { pending.push(`${file} ${at}.${k}.${c}`); continue; }
        if (SERVER_ONLY.has(c)) { server.push(c); continue; }
        if (!BAGS.has(c)) dead.push(`${file} ${at}.${k}.${c}`);
      }
    }
    scanGrants(v, file, `${at}.${k}`);
  }
}

for (const f of fs.readdirSync(path.join(ROOT, 'game/public/data'))
  .filter(f => f.endsWith('.json') && !f.endsWith('.bak'))) {
  scanGrants(rd('game/public/data/' + f), f, '');
}

// 코드가 참조하는 에셋이 실제로 있는지
const missing = [];
const SRC = ['game/index.html', 'game/src/main.js',
  ...fs.readdirSync(path.join(ROOT, 'game/src/view')).filter(f => f.endsWith('.js'))
    .map(f => 'game/src/view/' + f)];
for (const f of SRC) {
  const re = /assets\/(ui|fx|char|skill|equip|captain|enemy|boss)\/([A-Za-z0-9_-]+)\.png/g;
  for (const m of txt(f).matchAll(re)) {
    if (!fs.existsSync(path.join(ROOT, 'game/public/assets', m[1], m[2] + '.png'))) {
      missing.push(`${f}  ${m[1]}/${m[2]}.png`);
    }
  }
}
const realMissing = [...new Set(missing)].filter(x => !TODO_ART.some(t => x.endsWith(t)));

const list = a => (a.length ? [...new Set(a)].map(x => '  ' + x).join('\n') : '  없음');
console.log('담을 자리 있는 재화:', [...BAGS].join(', '));
console.log('\n[1] 지급하는데 담을 곳이 없는 재화\n' + list(dead));
console.log('\n[2] 아직 안 정한 것\n' + list(pending));
console.log('\n[3] 서버 연동 대기 (클라가 담을 수 없다)\n' + list(server));
console.log('\n[4] 코드가 부르는데 파일이 없는 에셋\n' + list(missing));
if (missing.length && !realMissing.length) console.log('  ↑ 전부 제작 대기분 — 프롬프트 발행됨');

process.exit(dead.length || realMissing.length ? 1 : 0);
