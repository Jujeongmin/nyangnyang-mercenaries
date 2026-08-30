// 에셋 목록(`assets/manifest.json`) 을 만든다 — **로딩 화면이 미리 받을 목록.**
//
// 왜 파일로 굽나. 배포본에는 디렉터리 목록을 읽을 방법이 없다 (정적 호스팅이라
// `/assets/` 를 GET 해도 404 다). 그래서 무엇이 있는지는 빌드 때 세어서 파일로
// 남겨야 한다. 이 목록이 없으면 로딩은 조용히 건너뛰고, 예전처럼 화면이 열릴
// 때 그때그때 받는다 — 상점을 처음 열면 상품 그림이 한 장씩 나타나던 그 증상.
//
// 크기를 같이 담는 이유: 진행 막대가 **파일 수**로 차면 3KB 아이콘 200개가
// 지나갈 때 확 찼다가 2MB 짜리 걷는 시트에서 한참 멈춘다. 바이트로 재면 막대가
// 실제 남은 시간에 비례한다.
//
// npm run build · npm run dev 가 이걸 먼저 돌린다 (package.json 의 prebuild·predev).
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PUBLIC = join(ROOT, 'game', 'public');
const ASSETS = join(PUBLIC, 'assets');
const OUT = join(ASSETS, 'manifest.json');

// 목록에 안 넣는 것들. 화면이 절대 안 부르는 파일을 미리 받으면 로딩만 길어진다
const SKIP_DIR = new Set(['_pick']);
const SKIP_FILE = /^(manifest\.json|\.DS_Store|Thumbs\.db)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIR.has(name) || name.startsWith('_')) continue;
      walk(full, out);
    } else if (!SKIP_FILE.test(name)) {
      // 웹 경로다 — 윈도우 구분자를 슬래시로 바꾼다
      out.push({ p: '/' + relative(PUBLIC, full).split(sep).join('/'), s: st.size });
    }
  }
  return out;
}

const files = walk(ASSETS).sort((a, b) => a.p.localeCompare(b.p));
const bytes = files.reduce((n, f) => n + f.s, 0);
writeFileSync(OUT, JSON.stringify({ files, bytes, count: files.length }) + '\n');
console.log(`에셋 목록 ${files.length}개 · ${(bytes / 1048576).toFixed(1)}MB → assets/manifest.json`);
