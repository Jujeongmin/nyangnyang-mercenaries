# Context — 냥냥 용병단

고양이 용병단을 꾸리는 **방치형 키우기**. 전투는 자동으로 돌고, 플레이어는
누구를 편성하고 무엇을 벼릴지를 정한다.

## 이 문서 묶음에 대하여

`PROJECT/*.md` 는 에디터가 읽는 프로젝트 메모다. **처음에 들어 있던 것은
`2d-phaser-basic` 템플릿(React + Phaser) 설명서였고, 이 프로젝트와 무관하다** —
그대로 두면 에디터가 없는 구조(`src/main.tsx` 등)를 전제로 고치려 든다.
그래서 실제 구조로 바꿔 두었다. 구조는 `Structure.md`, 자세한 설계는
저장소 루트의 `game/ARCHITECTURE.md` 와 `작업정리.md` 에 있다.

## 기술 전제

- **Vite + vanilla JS.** React 를 쓰지 않는다. TypeScript 도 아니다.
- **PixiJS 8** 로 전투 장면만 그린다 (CDN script 태그). 나머지 화면은 전부 DOM.
- vite root 는 **`game/`** 이다 (`vite.config.js`). 저장소 루트에는 빌드에 안
  들어가는 것들(tools/, sim/, docs/)만 둔다.
- 게임 규칙·수치는 `game/public/data/*.json` 이 단일 소스다. 런타임에 fetch 로
  읽으므로 JSON 만 고쳐도 반영된다 — import 로 바꾸지 말 것.
- 서버 함수는 저장소 **루트 `server.js`** 다 (Verse8 배포 우선순위 1위 경로).
  `server/` 폴더를 만들면 빌더가 구조화 서버 프로젝트로 오인해 빌드가 죽는다.

## 하지 말 것

- React/TSX 로 옮기지 말 것. 화면 수십 개가 vanilla DOM 으로 이미 서 있다.
- `game/public/assets` 의 그림을 임의로 다시 굽지 말 것 — `trim.json` 과
  `cutout/*.json` 이 원화 픽셀 좌표를 들고 있어 크기를 바꾸면 같이 환산해야
  한다 (`tools/rescale-coords.mjs`).
