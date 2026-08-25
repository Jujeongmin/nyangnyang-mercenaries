import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { bgeditPlugin } from './tools/bgedit-plugin.js';

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
  },
});
