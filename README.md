# 냥냥 용병단

방치형 가챠 RPG 프로토타입. PixiJS v8 · 모바일 세로형 · Verse8 탑재 예정.

## 실행

서버 없이 정적 파일이다. 아무 정적 서버로 루트를 띄우고 `/app/` 을 연다.

```bash
npx http-server . -p 5180 -c-1
# → http://localhost:5180/app/
```

## 구조

| 경로 | 내용 |
|---|---|
| `app/` | 게임 본체. `index.html`(전체 CSS) + `src/main.js`(부트·상태·화면 배선) + `src/view/`(화면들) + `src/view/battle/`(PixiJS 전투) |
| `data/` | **게임 규칙의 단일 소스.** 밸런스·확률·보상 전부 JSON. `data/README.md` 에 불변식 목록 |
| `assets/` | 생성 에셋 210종. `ui/9s/` 는 9-slice 가공본 |
| `tools/` | 검증·가공 도구 (아래) |
| `sim/` | 밸런스 시뮬레이터 |
| `에셋_생성_프롬프트.md` | 전 에셋의 생성 프롬프트 원본 |
| `작업정리.md` | 최근 작업 로그 + 미결 사항 |

## 도구 (수정했으면 반드시 돌린다)

```bash
node tools/validate.mjs   # data/ 불변식 23파일 — 밸런스 깨지면 여기서 터진다
node tools/audit.mjs      # 죽은 재화 참조·없는 에셋 검사
node tools/prompts.js     # 에셋_생성_프롬프트.md → prompts/ 재생성
python tools/nineslice.py # UI 킷 9-slice 재가공 (assets/ui/9s/)
python tools/fosheet.py   # 제작대 타격 시트 → 스트립 (정렬 보정 포함)
python tools/trim.py      # 캐릭터 불투명 bbox → assets/trim.json
```

브라우저 검사 (전 화면 겹침·정렬):

```js
const s = await import('/tools/screens.js');
console.log(await s.run());        // 빈 배열이면 통과. 새 화면을 만들면 SCREENS 에 한 줄 추가
```

## 규칙 요약

- 수치를 코드에 하드코딩하지 않는다 — `data/*.json` 이 단일 소스
- 뽑기 재화 배출을 늘리면 반드시 다른 배출을 줄여 상쇄한다 (README 불변식 5)
- UI 를 만지면 `tools/screens.js` 를 돌려 겹침을 확인한다
- 세이브는 아직 localStorage (`nyang:proto:v1`). 서버 연동은 `app/src/net/` 참고

## 미결 (작업정리.md 상세)

- Verse8 서버 연동 — `main.js` 를 `app/src/net/` 계층 위로 올리는 리팩터링 필요
- 연합 보스 HP 계수 0.55 sim 검증 · 탈퇴 시 코인 처리
- 사운드 엔진 (sound.json 은 정의만 있음)
