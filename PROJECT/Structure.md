# Structure — 냥냥 용병단

```
vite.config.js      root:'game', outDir:'../dist'. 빌드 표식(__BUILD__)도 여기서 만든다
server.js           Verse8 게임서버 함수 (class Server). **루트에 있어야 한다**
game/
  index.html        진입점. CSS 전량이 <head> 안 <style> 한 덩어리다
  src/
    main.js         화면 대부분·상태·부팅. 가장 크다
    core/           data(JSON 로드) · store · bus · fmt · i18n · passives · cloudsave
    net/            live(서버 읽기) · verse8 · ads
    view/           shop · rank(랭킹+설정) · roster · quest · codex · profile ·
                    alliance · summon · tower
    view/battle/    scene(장면) · rig(스프라이트 변형) · cutout(무기팔 분리) ·
                    fx · impact · numbers · motions
  public/
    data/*.json     게임 규칙 단일 소스
    i18n/*.json     ko 제외 4개 언어 사전 (원문이 곧 키다)
    assets/         그림. trim.json 은 원화별 불투명 영역 좌표
tools/              검사·변환 도구 (node 로 직접 실행)
sim/                밸런스 시뮬레이터. 게임과 같은 공식을 쓴다
```

## 자주 쓰는 명령

```
npm run dev       개발 서버 (5180)
npm run check     불변식 + 감사 + 에셋 참조 검사. **고치고 나면 이걸 돌린다**
node tools/check-assets.mjs   코드가 부르는 그림이 실제로 있는지
```

## 손대기 전에 알아야 할 것

- **i18n**: UI 문구는 한국어 원문이 곧 키다. `t('원문')` 으로 감싸고 4개 사전에
  같은 키를 넣는다. 숫자가 낀 문장은 `{0}` 자리표.
- **좌표 데이터**: `rig.js` 와 `cutout.js` 는 그림 크기에 맞춰 좌표를 그 자리에서
  환산한다. 그림과 좌표의 세대가 달라도 깨지지 않는다.
- **빈 칸**: 편성(`S.party`)·스킬 칸은 `null` 이 정상이다. 훑는 코드는 반드시
  걸러야 한다 — 안 걸러서 부팅이 죽은 적이 두 번 있다.
- **화면 폭**: `#app` 은 `min(100%, 56vh, 720px)`. 로딩 화면(`#boot`)도 같은 식이라
  한쪽만 바꾸면 시작할 때 폭이 튄다.
