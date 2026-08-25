import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { bgeditPlugin } from './tools/bgedit-plugin.js';

/**
 * 빌드 표식 — **지금 도는 화면이 어느 판인지** 설정 화면과 콘솔에 찍는다.
 * 배포본이 갱신됐는지 눈으로 확인할 길이 없어서, 옛 빌드를 보며 "왜 수정이
 * 안 됐나" 를 여러 번 되풀이했다 (2026-08-25).
 *
 * **Verse8 에디터 컨테이너는 턴 사이에 `.git` 을 지운다.** 그래서 커밋 해시를
 * 못 읽는데, 그때 'dev' 한 마디만 찍으면 서버를 다시 띄워도 값이 안 변해
 * "새로 뜬 판인지" 를 구분할 수 없다. 그 자리에는 **띄운 시각**을 넣는다.
 */
function buildStamp() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `dev-${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
}

// Verse8 은 Vite 프로젝트를 전제로 한다 (docs.verse8.io — "Vite 기반").
//
// root 를 game/ 으로 잡는다. index.html 이 곧 진입점이고 Vite 가 그것을 모듈
// 그래프의 뿌리로 삼는다. 저장소 루트에는 빌드에 안 들어가는 것들(tools/, sim/,
// proto/, docs/)만 남는다 — 게임에 들어갈 것과 아닌 것이 폴더로 갈린다.
//
// assets/ 와 data/ 는 game/public/ 아래다 (publicDir 기본값 = <root>/public).
// 가공 없이 그대로 복사돼야 하는 것들이라 모듈 그래프에 넣지 않는다:
//   · assets  484개 그림·폰트. 번들러가 건드릴 이유가 없다
//   · data    게임 규칙의 단일 소스. **런타임에 fetch 로 읽는다.**
//             import 로 바꾸면 번들에 박혀서 JSON 만 고쳐 배포하는 길이 막힌다
// 그래서 코드에서는 절대경로(`/assets/...`, `/data/...`)로 참조한다.
export default defineConfig({
  // 배경 지우개(`/bgedit.html`)의 저장 API. dev 에서만 붙는다
  plugins: [bgeditPlugin(__dirname)],
  define: { __BUILD__: JSON.stringify(buildStamp()) },
  root: 'game',
  publicDir: 'public',
  build: {
    // 저장소 루트의 dist/ 로 뺀다 (game/ 안에 두면 소스와 산출물이 섞인다)
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // 게임 본체
        main: resolve(__dirname, 'game/index.html'),
        // 개발용 확인 페이지들. 빌드에서 빼려면 이 세 줄을 지운다
        demo: resolve(__dirname, 'game/demo.html'),
        motion: resolve(__dirname, 'game/motion.html'),
        cutout: resolve(__dirname, 'game/cutout.html'),
      },
    },
  },
  server: {
    port: 5180,
    // **브라우저를 자동으로 열지 않는다.** Verse8 프리뷰는 리눅스 컨테이너에서
    // `vite --host` 로 도는데 거기엔 열 브라우저가 없어서 매번 로그에
    // `Error: spawn xdg-open ENOENT` 가 찍힌다 (서버는 정상이지만 실패로 읽힌다).
    // 로컬에서는 주소를 직접 열면 된다
    open: false,
    // **개발 서버 응답을 캐시하지 않는다.** Verse8 프리뷰는 컨테이너의 이
    // 서버를 프록시로 내보내는데, 그 사이 어딘가가 모듈을 붙들면 화면이
    // 옛 코드로 남는다 — index.html(인라인 CSS)만 새로 오고 main.js 는
    // 옛것이 오면 "CSS 는 반영, 동작은 옛것" 같은 반쪽 상태가 된다
    // (실제로 그 증상을 봤다 — 2026-08-25).
    headers: { 'Cache-Control': 'no-store' },
  },
});
