# app/ — proto 재작성 설계

기존 `proto/` 는 프로토타입으로는 제 역할을 했지만 본편으로 못 키운다. 이유 셋:

1. **서버 경계가 없다.** `state.js` 가 재화를 직접 깎는다. Verse8 는 클라 읽기 전용 + 쓰기는 전부 서버 함수다
   (`data/README.md > 서버 권한`). 지금 구조로 서버를 붙이면 전 함수를 갈라야 한다.
2. **UI 가 문자열 조립이다.** 오버레이 12종·상점 5탭·도감·아레나·랭킹을 `innerHTML` 로 못 버틴다.
3. **전투가 렌더러와 붙어 있다.** `battle.js` 안에 시뮬과 PixiJS 가 섞여 있어서 `sim/engine.js` 와
   규칙이 두 벌로 갈라진다. 이미 갈라져 있다.

`data/*.json` 과 `sim/` 은 그대로 둔다. 검증된 밸런스라 손댈 이유가 없다.

---

## 레이어

```
app/src/
  core/        플랫폼·유틸. 게임 규칙 모름
    data.js      data/*.json 로드 + 무결성 검증
    bus.js       이벤트 (상태 변경 → 뷰 갱신)
    fmt.js       숫자·시간 포맷
    store.js     save-schema.json 형태의 클라 상태 (읽기 전용 취급)

  net/         서버 경계. 여기 아래로는 쓰기가 없다
    backend.js   인터페이스 정의 + 구현 선택
    local.js     로컬 구현. 서버 시각·권한·호출제한을 흉내낸다
    verse8.js    실제 구현 (나중)

  game/        순수 규칙. DOM·PixiJS 모름. sim/ 과 같은 공식을 쓴다
    cp.js        CP 계산 (README 공식)
    combat.js    전투 틱 시뮬 — sim/engine.js 와 동일 규칙
    gacha.js     확률표 해석 (판정은 서버)
    equip.js     자동장착·강화·필터
    stage.js     스테이지 진행·보상
    idle.js      방치 보상

  view/
    battle/      PixiJS 씬. game/combat.js 결과를 재생만 한다
    ui/          화면. 컴포넌트 단위
```

**의존 방향은 한 방향이다.**

```
view  →  net  →  game  →  core
  └──────────────┘
```

`game/` 은 순수 규칙이라 `net/` 을 **절대 import 하지 않는다.** 그래야 서버(=`net/local.js`,
나중엔 Verse8 remoteFunction)와 클라가 같은 규칙 코드를 공유해도 순환이 안 생긴다.
뷰는 표시용으로 `game/cp.js` 를 직접 부를 수 있다. 쓰기만 `net/` 을 통과한다.

---

## 핵심 결정

### 1. 전투는 "계산"과 "재생"을 분리한다
`game/combat.js` 가 전투 전체를 먼저 돌려 **이벤트 로그**를 만든다.
`view/battle/` 은 그 로그를 시간축에 뿌려 재생만 한다.

이렇게 하면:
- 배속(1x/2x/3x)이 재생 속도만 바꾼다. 시뮬 결과가 안 변한다
- 서버가 같은 코드로 검증 가능
- `sim/` 과 규칙이 갈라지지 않는다
- 110% 이상 자동승리(서버 호출 0) 를 로그 생성 없이 건너뛸 수 있다

### 2. 모든 쓰기는 `net/backend.js` 를 통과한다
```js
await backend.summon('merc', 10)     // 가챠 판정
await backend.upgradeStart(slot)     // 타이머 시작 — 시각은 서버가 찍는다
await backend.claimIdle()            // 방치 보상
```
`local.js` 도 **똑같은 제약을 흉내낸다** — 서버 시각 사용, 호출 10회/초 제한,
결과만 반환. 로컬에서 통과하면 Verse8 에서도 통과한다.

`data/README.md > 치명 필드 6개` 는 클라가 절대 못 쓴다.

### 3. 상태는 서버 응답으로만 갱신된다
클라는 `store` 를 직접 안 고친다. `backend` 응답을 `store.apply()` 로 반영하고
`bus` 가 뷰에 알린다. 낙관적 갱신은 연출용 임시값으로만 쓰고 응답이 오면 덮는다.

### 4. 파생값은 저장하지 않는다
CP·스탯은 매번 `game/cp.js` 가 계산한다. (`data/README.md` 세이브 스키마 규칙)

---

## 이관 순서

| # | 단계 | 내용 |
|---|---|---|
| 1 | core | data.js / bus.js / fmt.js / store.js |
| 2 | net | backend.js 인터페이스 + local.js |
| 3 | game/cp | CP 공식. `sim/` 결과와 대조 검증 |
| 4 | game/combat | `sim/engine.js` 이관. 이벤트 로그 출력 |
| 5 | view/battle | 로그 재생기. 3D 프리렌더 스프라이트 사용 |
| 6 | game 나머지 | gacha / equip / stage / idle |
| 7 | view/ui | 오버레이 12종 |
| 8 | net/verse8 | 실서버 |

`proto/` 는 2026-08-23 에 지웠다 — 본편(game/)이 전 시스템을 덮었고, 참조가 필요하면 git 역사(43e57e1)에 있다.
