# 냥냥 용병단

방치형 가챠 RPG 프로토타입. PixiJS v8 · 모바일 세로형 · Verse8 탑재 예정.

## 실행

**Vite 프로젝트다** — Verse8 이 Vite 구조를 전제로 한다.

```bash
npm install
npm run dev      # → http://localhost:5180
npm run build    # → dist/
```

## 구조

Vite `root` 가 `game/` 이다 (`vite.config.js`). **게임에 들어갈 것은 전부 `game/` 안**,
저장소 루트에는 빌드에 안 들어가는 것만 둔다.

| 경로 | 내용 |
|---|---|
| `game/index.html` | 진입점. 전체 CSS 가 여기 있다 |
| `game/src/` | `main.js`(부트·상태·화면 배선) + `view/`(화면들) + `view/battle/`(PixiJS 전투) + `net/`(백엔드 추상화) |
| `game/public/data/` | **게임 규칙의 단일 소스.** 밸런스·확률·보상 전부 JSON. `data/README.md` 에 불변식 목록 |
| `game/public/assets/` | 생성 에셋. `ui/9s/` 는 9-slice 가공본 |
| `game/tools/` | 브라우저에서 돌리는 검사기 (`screens.js` · `uicheck.js`) |
| `tools/` | node·python 검증·가공 도구 (아래) |
| `sim/` | 밸런스 시뮬레이터 |
| `dist/` | 빌드 산출물. 커밋하지 않는다 |
| `에셋_생성_프롬프트.md` | 전 에셋의 생성 프롬프트 원본 |
| `작업정리.md` | 최근 작업 로그 + 미결 사항 |

`public/` 안은 **가공 없이 그대로 복사**된다. `data/` 를 여기 두는 이유가 핵심이다 —
런타임에 `fetch` 로 읽으므로 JSON 만 고쳐 배포할 수 있다. `import` 로 바꾸면 번들에
박혀서 그 길이 막힌다. 코드에서는 절대경로(`/assets/...` · `/data/...`)로 참조한다.

## 도구 (수정했으면 반드시 돌린다)

```bash
npm run check             # validate + audit 한 번에
node tools/validate.mjs   # data/ 불변식 23파일 — 밸런스 깨지면 여기서 터진다
node tools/audit.mjs      # 죽은 재화 참조·없는 에셋 검사
node tools/prompts.js     # 에셋_생성_프롬프트.md → prompts/ 재생성
python tools/nineslice.py # UI 킷 9-slice 재가공 (game/public/assets/ui/9s/)
python tools/fosheet.py   # 제작대 타격 시트 → 스트립 (정렬 보정 포함)
python tools/trim.py      # 캐릭터 불투명 bbox → game/public/assets/trim.json
```

> python 도구들은 아직 옛 경로(`assets/`)를 볼 수 있다. 돌리기 전에 확인할 것.

브라우저 검사 (전 화면 겹침·정렬):

```js
const s = await import('/tools/screens.js');
console.log(await s.run());        // 빈 배열이면 통과. 새 화면을 만들면 SCREENS 에 한 줄 추가
```

## 규칙 요약

- 수치를 코드에 하드코딩하지 않는다 — `data/*.json` 이 단일 소스
- 뽑기 재화 배출을 늘리면 반드시 다른 배출을 줄여 상쇄한다 (README 불변식 5)
- UI 를 만지면 `tools/screens.js` 를 돌려 겹침을 확인한다
- **스크롤바는 전역으로 감춰져 있다** (`index.html` 상단). OS 기본 막대가 UI 킷과
  안 맞아서다. 새 스크롤 영역에서 다시 노출시키지 않는다
- 뽑기는 **보유함(`S.own`)·강화 대기열(`S.pend`)에 쌓기만** 한다. 편성·레벨 반영은
  용병/스킬 시트의 `자동장착`·`자동강화` 를 눌러야 일어난다
- 중복은 **그 대상 본인의 레벨**을 올린다. 만렙일 때만 가치로 환산해 이관한다
  (`economy.json > cascade.twoStepRule`)
- **해금 기준은 전투력이 아니라 퀘스트다.** 던전·장착 칸 전부.
  `quests.json > slotUnlockQuests` 가 단일 소스(`canonicalSource: true`).
  CP 로 열면 뽑기 운으로 순서가 깨져 `dungeons.json > unlockOrder` 가 무너진다
- 세이브는 아직 localStorage (`nyang:proto:v1`). 서버 연동은 `app/src/net/` 참고

## 미결 (작업정리.md 상세)

- Verse8 서버 연동 — `main.js` 를 `app/src/net/` 계층 위로 올리는 리팩터링 필요
- 보상형 광고 `@verse8/ads ^0.5.0` — 호출 자리(`app/src/net/ads.js`)만 있고 SDK 미연결.
  붙이려면 루트 `package.json` + 번들러 도입이 먼저다 (지금은 빌드 없는 정적 파일).
  `showRewarded` 는 **timeout 인자 없이** 부른다
- 연합 보스 HP 계수 0.55 sim 검증 · 탈퇴 시 코인 처리
- 사운드 엔진 (sound.json 은 정의만 있음)
