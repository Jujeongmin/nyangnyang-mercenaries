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

## 배포 verse 고정

새로 클론했으면 **`npm install` 만 하면 된다** — `prepare` 가 `tools/setup-hooks.mjs`
를 돌려 훅 경로를 잡는다 (`core.hooksPath` 는 저장소마다의 로컬 설정이라 클론에
딸려오지 않는다). git 이 없는 자리(에디터 컨테이너)에서는 건너뛰고 설치를 계속한다.
손으로 잡으려면:

```bash
git config core.hooksPath tools/githooks
```

배포 주소는 `VITE_AGENT8_VERSE` 로 갈린다. 그 값은 `.env` 와 `.agent8.lock` 두 곳에
있고 둘 다 저장소에 들어간다. Verse8 에디터 컨테이너가 이따금 새 값을 찍어 커밋하는
탓에(2026-08-25~26 사이만 네 번), 옛 값이 든 판을 밀면 **배포가 딴 주소로 나간다.**

그래서 못박은 값을 `tools/verse.pin` 에 두고, `tools/githooks/pre-push` 가 밀기 직전에
**미는 커밋 안의 값**과 대조해 다르면 막는다. 작업본이 아니라 커밋을 보는 이유는 실제로
나가는 것이 커밋이라서다.

verse 를 일부러 바꿔야 하면 `.env` · `.agent8.lock` · `tools/verse.pin` 셋을 같은 값으로
고쳐 함께 커밋한다.

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
- 세이브는 아직 localStorage (`nyang:proto:v1`). 서버 연동은 `game/src/net/` 참고
- 보상형 광고는 `game/src/net/ads.js` 창구로만 부른다. `showRewarded` 에 **`timeoutMs` 를
  넘기지 않는다** — 클라가 끊으면 광고를 끝까지 본 유저가 보상을 못 받고, 그 판정을
  클라가 쥐어 조작 창구가 된다. 지면 id 는 `idle_double` · `instant_claim` 2개

## 규칙 추가분

- **배속은 성장축이다.** 1x 기본 · 2x 퀘스트 Q5 · 3x 상점 일회성 패키지
  (`combat.json > clientRendering.speedUp`, 단일 소스 `quests.json > speedUnlockQuests`).
  방치 수익은 **해금 최고 배속**을 곱한다 (`stages.json > idleReward.speedBasis`) —
  이걸 빼면 온라인 파밍이 방치의 8.6배가 되어 장르가 무너진다
- 스킬 등급은 **종류에 고정**이다 (`skills.json > meta.gradeIsFixed`). 32종, 분포는 용병과 동수
- 전투 화면 등급 표시: SR+ 발밑 링, UR/LR 궤도 입자 (`view/battle/rig.js > drawGradeRing`)

## 미결 (작업정리.md 상세 — 2026-08-23 심야분 포함)

- Verse8 서버 연동 — `main.js` 를 `game/src/net/` 계층 위로 올리는 리팩터링 필요
- 보상형 광고 — SDK 연결 완료. 남은 것은 **Verse8 대시보드 지면 2개 등록**과 실호스트 검증
- 3배속 실결제 — VXShop 등록 후. 지금은 dev 빌드만 즉시 해금 (프로덕션에 분기 없음)
- 연합 보스 HP 계수 0.55 sim 검증 · 탈퇴 시 코인 처리
- 사운드 엔진 (sound.json 은 정의만 있음)
- 스킬 아이콘 신규 7장(SK-A16·P11~P16) · 도감 일러 20장 — `prompts/남은작업.md`
- 보류 질문 6건 — `작업정리.md > 2026-08-23 > 보류` (스킬 이름 충돌 · 출석 day3 빈 보상 ·
  캐릭터 렌더 크기 이상치 · f2p 수익 재계산 등)
