# 스토리(웹툰) · 클릭형 튜토리얼 기획

작성 2026-08-28 · 대상 버전 v1.0.4 이후

---

## 0. 먼저 짚을 것 — 기존 원칙과의 충돌

`tutorial.json > antiPatterns` 첫 줄이 이렇다.

> 시네마틱 오프닝 — 방치형 유저는 스토리를 보지 않는다. 스킵 버튼만 찾는다.

스토리를 넣는 이 기획은 그 문장과 정면으로 부딪힌다. 지우고 시작하면 안 된다. 그 문장이 막으려던 것은 **스토리 자체가 아니라 "진입을 막는 스토리"** 다. 그래서 이 기획은 다음 세 줄을 규칙으로 삼는다.

1. **스토리는 첫 90초를 건드리지 않는다.** 프롤로그 3컷만 직업 선택 직후에 두고, 나머지는 전부 마일스톤 뒤에 붙는다. 첫 소환까지 도달하는 시간은 지금과 같아야 한다.
2. **스토리는 언제나 건너뛸 수 있다.** 프롤로그 포함. 대신 건너뛰어도 지급 보상은 그대로 준다.
3. **스토리는 보상 자리에 선다.** 벽을 넘었을 때, 승급했을 때 — 이미 기분이 좋은 순간에 한 장 나온다. 무언가를 하기 **전에** 나오지 않는다.

이 세 줄을 지키면 `antiPatterns` 는 유효한 채로 남는다. 어기는 순간 그 문장이 옳았다는 것이 지표로 증명될 것이다.

한 가지 더. `tutorial.json > assetImpact.newAssets` 는 지금 `0` 이고 "튜토리얼 전용 에셋을 만들지 않는다"고 적혀 있다. 스토리는 튜토리얼이 아니라 **콘텐츠**이므로 이 항목의 적용 대상이 아니다. 다만 정신은 이어받아, 캐릭터 그림은 **한 장도 새로 그리지 않는다** (§3.2).

---

## 1. 무엇을 만드는가

두 덩어리다. 서로 독립적으로 만들 수 있고, 순서는 튜토리얼이 먼저다.

| | 이름 | 신규 에셋 | 의존 |
|---|---|---|---|
| A | **코치마크 튜토리얼** — 어두운 막 + 구멍 + 말풍선 + 손가락 | 0 | 없음 |
| B | **웹툰 스토리** — 8화 44컷, 합성 컷 방식 | 배경 8 + UI 2 | A 의 말풍선 스타일을 공유 |

A 를 먼저 하는 이유: 에셋이 0이라 지금 당장 만들 수 있고, `tutorial.json` 이 이미 약속해 놓고 구현이 안 된 부분(`uiTechniques.highlight`, `textBubble`, `forceTouch`)을 메우는 일이다. B 없이도 온전히 값어치가 있다.

---

## 2. 스토리 — 세계관과 축

### 2.1 전제

**별이 떨어진 날(별락).** 하늘에서 별이 쪼개져 땅에 박혔다. 조각이 스민 짐승과 사물은 몬스터가 되었다. 사람의 나라는 성벽 안으로 물러났고, 성 밖의 일은 용병단이 맡는다.

**주인공.** 별락 때 마을을 잃은 떠돌이 고양이. 제 이름은 잃었고, 사람들은 직함으로만 **"단장"** 이라고 부른다.

> 게임 안의 호칭과 맞물린다. UI 문구는 유저를 처음부터 끝까지 "단장"이라고 부르는데, 그것과 **용병단의 이름**(= 닉네임)은 별개다. 닉네임은 첫 부팅에 `autoNickname()` 이 자동으로 붙여 주고(main.js), 유저는 프로필에서 바꾼다. 그러니까 EP7 은 "이름이 없다가 생긴다"가 아니라 **저절로 붙어 있던 단 이름을 처음으로 제 손으로 게시판에 적는 장면**이다. 있던 것을 자기 것으로 만드는 이야기다.

**힘의 원리.** 조각을 먹은 짐승은 몬스터가 되지만, **견뎌낸** 짐승은 힘을 얻는다. 그게 용병이다. 조각은 부른다 — 그래서 소환하면 동료가 찾아온다.

이 한 줄이 시스템 전부를 설명한다.

| 시스템 | 이야기에서 |
|---|---|
| 용병 소환 | 조각이 울리면 견뎌낸 짐승이 찾아온다 |
| 스킬 소환 | 조각을 제 몸에 박는다 — 아프지만 강해진다 |
| 장비 제작 | 조각을 쇠에 박는다. 장비는 두 번째 몸 |
| 전직 | 냥이가 조각을 어떤 그릇에 담느냐 (검 · 활 · 지팡이) |
| 승급(2·3차) | 더 큰 조각을 견뎌냈다 |
| 던전 | 별이 박힌 구덩이. 아래로 갈수록 원본에 가깝다 |
| 아레나 | 다른 용병단도 같은 조각을 쫓는다 |

**두 축.** 로스터의 LR 두 마리를 그대로 쓴다. 새 캐릭터를 만들지 않는다.

- **성좌룡** (LR-01, mage/light) — 떨어진 별 그 자체. 조각들의 어머니.
- **종말의 흑기린** (LR-02, warrior/dark) — 별을 떨어뜨린 것. 조각을 도로 거둬들이려 한다.

둘은 1부(스테이지 1~100 구간) 동안 **실루엣과 암시로만** 등장한다. 얼굴을 보여 주는 것은 2부의 몫으로 남긴다. 뽑기로 실제 손에 넣은 유저에게는 그 등장이 곧 스포일러가 되므로, 도감 설명과 웹툰 대사를 서로 어긋나지 않게 맞춰야 한다(§9 열린 질문).

### 2.2 8화 구성

각 화는 3~7컷. 총 44컷. **트리거는 전부 기존 마일스톤**이라 새 진행 조건을 만들지 않는다.

| 화 | 제목 | 컷 | 트리거 | 이 화가 하는 일 |
|---|---|---|---|---|
| EP0 | 별이 떨어진 날 | 3 | 직업 선택 직후 | 방금 고른 직업에 이유를 준다 |
| EP1 | 첫 동료 | 5 | Q2(용병 10연) 장착 완료 | 뽑은 용병이 "찾아온 것"이 된다 |
| EP2 | 힘의 값 | 5 | Q3(스킬 10연) 장착 완료 | 스킬이 공짜가 아니라는 감각 |
| EP3 | 첫 벽 | 6 | 첫 보스 패배 | 벽 안내(`showWallHint`)에 감정을 얹는다 |
| EP4 | 산 아래 대장간 | 5 | Q6(제작대 Lv2) | 장비를 왜 올리는가 |
| EP5 | 지하의 소리 | 6 | Q7(던전 첫 돌파) | 던전이 왜 있는가 · 별의 정체 암시 |
| EP6 | 같은 아침 | 5 | Q8(훈련소 Lv2) | 훈련소가 왜 있는가 |
| EP7 | 남들의 이름 | 6 | 아레나 해금 | **유저 닉네임이 컷 안에 그려진다** |
| EP8 | 승급 | 7 | 2차 전직 | 단장 외형 변화를 사건으로 만든다 |

### 2.3 컷 대본

말풍선은 2줄 이내. 나레이션은 1줄. `uiTechniques.textBubble` 규칙을 스토리에도 그대로 적용한다.

**EP0 — 별이 떨어진 날** (3컷)

1. `CUT-01` 밤하늘, 별이 쪼개져 떨어진다. — *나레이션* "별이 떨어진 날, 세상은 조용해졌다."
2. `CUT-02` 폐허 위 작은 실루엣. — *나레이션* "남은 것은 나뿐이었다. 이름도 없이."
3. `CUT-02` + **선택한 직업의 단장 스탠딩**. 손에 무기. — *단장* "그래서 이걸 들었다."

> 컷3이 직업에 따라 갈린다. 유저가 방금 누른 선택이 3초 뒤 그림으로 돌아온다 — 이 기획에서 가장 값싸고 가장 강한 개인화다.

**EP1 — 첫 동료** (5컷)

1. `BG-01` 몬스터 무리 앞에 단장 혼자.
2. 클로즈업 — 품 안의 조각이 빛난다.
3. `CUT-03` 수풀에 눈이 하나씩 켜진다.
4. **뽑은 용병 중 최고 등급 1명**이 걸어 나온다. — *단장* "너도, 견뎠구나."
5. **현재 편성 전원**이 나란히 선다. — *나레이션* "그날부터 혼자가 아니었다."

**EP2 — 힘의 값** (5컷)

1. `BG-02` 손바닥 위의 조각.
2. 조각이 손에 파고든다. 빛이 샌다.
3. 동료들이 놀라 본다. (**편성 2명**)
4. **장착한 액티브 스킬 아이콘**이 등 뒤에 문양처럼 떠오른다.
5. — *단장* "힘은 공짜가 아니다. 다만 나는 낼 것이 있었다."

**EP3 — 첫 벽** (6컷)

1. `BG-03` **방금 진 보스** 그림자가 화면을 덮는다.
2. **편성 전원**이 밀린다.
3. 단장이 무릎을 꿇는다.
4. 하늘에 뿔의 윤곽이 겹친다 — 짧게, 흑기린 암시.
5. 단장이 일어선다.
6. — *단장* "모자란 건 각오가 아니었다."

> 이 화는 `showWallHint` 직후에 나온다. 안내 카드가 "무엇을 하면 뚫린다"를 말하고, 웹툰이 "왜 그래야 하는지"를 말한다. 순서를 지켜야 한다 — 동시에 뜨면 서로 가린다.

**EP4 — 산 아래 대장간** (5컷)

1. `CUT-04` 낡은 대장간. 안쪽은 어둡다.
2. 실루엣만 보이는 주인. — *주인* "별 조각은, 쇠에도 박힌다."
3. 무기가 화덕에서 달궈진다.
4. **선택한 직업의 단장**이 그것을 받는다.
5. — *주인* "장비는 네 두 번째 몸이다."

> 대장간 주인은 **끝까지 실루엣**이다. 로스터에서 캐릭터를 빌리면 그 용병을 안 뽑은 유저에게는 낯선 얼굴이 되고, 새로 그리면 에셋이 는다. 실루엣이 두 문제를 다 피한다.

**EP5 — 지하의 소리** (6컷)

1. `CUT-05` 갈라진 땅.
2. 아래에서 빛이 새어 나온다.
3. **편성 전원**이 내려간다.
4. **돌파한 던전의 보스** 실루엣.
5. 벽에 새겨진 옛 문양 — 용의 형상.
6. — *나레이션* "별은 하늘에만 있는 것이 아니었다."

**EP6 — 같은 아침** (5컷)

1. `CUT-07` 텅 빈 마당, 이른 아침.
2. 동료들이 하나씩 나온다. (**편성 전원**)
3. 3분할 컷 — 같은 동작을 반복한다.
4. 숨을 고르는 단장.
5. — *단장* "재능은 나눠 받지만, 아침은 똑같이 온다."

**EP7 — 남들의 이름** (6컷)

1. `CUT-06` 성벽 앞 게시판. 용병단 이름이 빼곡하다.
2. 우리 줄은 남이 대신 적어 둔 글씨다 — 삐뚤빼뚤하고 빛이 바랬다.
3. 다른 단장들의 실루엣이 지나간다.
4. 단장이 붓을 든다.
5. 그 위에 다시 적는다 — **게시판에 유저 닉네임이 실제로 그려진다.**
6. — *나레이션* "남이 붙여 준 이름이었다. 오늘부터는 우리가 쓴다."

> 컷5의 닉네임은 텍스트 레이어로 얹는다. 이 화만을 위해 `nickname` 을 컷 안에 렌더하는 레이어 타입이 필요하다(§4.2 `text` 레이어).

**EP8 — 승급** (7컷)

1. 조각이 전보다 크게 빛난다.
2. 단장이 버틴다. (**1차 단장 스탠딩**)
3. 빛이 터진다 — 화이트아웃.
4. **2차 단장 스탠딩**으로 교체.
5. 동료들이 올려다본다. (**편성 전원**)
6. `CUT-08` 하늘에 용의 윤곽. 그 너머 검은 눈 하나.
7. — *단장* "아직 멀었다."

---

## 3. 컷을 어떻게 그리는가

### 3.1 핵심 결정 — 통짜 삽화를 그리지 않는다

44컷을 전부 그리면 44장이다. 게다가 "내 캐릭터가 나온다"는 요구는 통짜 삽화로는 **원리적으로 불가능하다** — 유저마다 편성이 다르다.

그래서 컷은 **레이어 합성**이다.

```
컷 = 배경 플레이트 1장
   + 캐릭터 레이어 N개 (기존 에셋을 좌표·크기·반전만 지정해 얹는다)
   + 말풍선/나레이션
   + (선택) 오버레이 — 집중선, 화이트아웃, 어둠
```

### 3.2 캐릭터 그림은 한 장도 새로 안 그린다

이미 다 있다.

| 쓸 것 | 경로 | 규격 | 비고 |
|---|---|---|---|
| 단장 1차 | `assets/captain/captain_{warrior,archer,mage}.png` | 1024² 투명 | 직업별 3종 |
| 단장 2·3차 | `assets/captain/PR-{class}-{2,3}.png` | 동일 | 승급 컷에 |
| 용병 스탠딩 | `assets/art/{GRADE}-{NN}-ART.png` | 512×768 | 32종 전부 있다 |
| 보스 | `assets/boss/B-0N.webp`, `DGB-0N.webp` | — | EP3 · EP5 |
| 스킬 아이콘 | `assets/skill/…` | — | EP2 컷4 |

`-ART.png` 는 배경이 딸린 그림이라 그대로 얹으면 네모가 보인다. 두 가지 길이 있다.

- **(권장) 원형/부채꼴 마스크로 잘라 쓴다.** CSS `mask-image` 로 가장자리를 흐리면 웹툰의 "인물 오려 붙이기" 연출이 된다. 에셋 작업 0.
- 전부 배경 제거해 투명 PNG 를 새로 만든다. 32장 재가공. 품질은 낫지만 비용이 든다.

1차로는 마스크로 간다. 반응이 좋으면 그때 배경 제거를 검토한다.

### 3.3 편성이 비었거나 모자랄 때

EP1 컷5, EP3 컷2, EP6 컷2 는 "편성 전원"을 요구한다. 편성이 1~2명일 수 있다.

**규칙:** 슬롯이 모자라면 **그 자리를 비운다.** 대체 캐릭터를 세우지 않는다. 세 마리가 설 자리에 한 마리만 서 있는 그림이 오히려 "아직 모으는 중"이라는 상태를 정확히 말해 준다. 레이어 정의에 `optional: true` 를 두고, 해당 파티 인덱스가 없으면 그 레이어를 건너뛴다.

---

## 4. 데이터 스키마

### 4.1 `data/story.json` (신규)

```jsonc
{
  "meta": { "version": "1.0", "episodes": 8, "cuts": 44 },

  "readerRule": {
    "advance": "탭하면 다음 컷이 아래에서 밀려 올라온다 (세로 스크롤 웹툰의 읽기 방향)",
    "skip": "우상단 [건너뛰기]. 프롤로그 포함 언제나 노출한다",
    "replay": "설정 > 기록 에서 본 화를 다시 읽는다",
    "blocking": "전투는 뒤에서 계속 돈다. 스토리는 전투를 멈추지 않는다"
  },

  "episodes": [
    {
      "id": "EP0",
      "titleKo": "별이 떨어진 날",
      "trigger": { "type": "classSelected" },
      "cuts": [
        {
          "bg": "CUT-01",
          "narr": "별이 떨어진 날, 세상은 조용해졌다."
        },
        {
          "bg": "CUT-02",
          "narr": "남은 것은 나뿐이었다. 이름도 없이."
        },
        {
          "bg": "CUT-02",
          "layers": [
            { "type": "captain", "tier": 1, "x": 0.5, "y": 0.92, "h": 0.62 }
          ],
          "say": { "who": "captain", "ko": "그래서 이걸 들었다." }
        }
      ]
    }
  ]
}
```

### 4.2 레이어 타입

좌표는 전부 **컷 크기에 대한 비율**이다. 픽셀을 박으면 화면 폭이 바뀔 때 어긋난다.
`x` 는 가로 중심, `y` 는 **발끝** 위치, `h` 는 컷 높이 대비 인물 높이.

| type | 무엇을 그리나 | 필드 |
|---|---|---|
| `captain` | 선택한 직업의 단장. `tier` 로 1·2·3차 | `tier`, `flip` |
| `party` | 편성 N번째 용병 (`-ART.png` + 마스크) | `slot`(0~4), `optional` |
| `partyBest` | 편성 중 최고 등급 1명 | — |
| `partyAll` | 편성 전원을 가로로 배치 | `gap`, `max` |
| `boss` | 최근 만난 보스 / 돌파한 던전 보스 | `from`: `lastBoss` \| `lastDungeon` |
| `skill` | 장착한 액티브 스킬 아이콘 | `slot` |
| `text` | 컷 안에 그리는 글자 (EP7 닉네임) | `bind`: `nickname`, `font`, `size` |
| `fx` | 오버레이 — `whiteout` \| `speedline` \| `dark` | `amount` |

공통: `x`, `y`, `h`, `flip`, `optional`, `delayMs`(등장 지연)

### 4.3 세이브 (`save-schema.json` 확장)

```jsonc
"story": {
  "seen": ["EP0", "EP1"],      // 완독한 화
  "skipped": ["EP2"],          // 건너뛴 화 — 기록에서 다시 읽을 수 있다
  "pending": null              // 트리거는 걸렸는데 아직 못 띄운 화
}
```

`pending` 이 필요한 이유: 트리거 순간에 다른 판(보스 결과, 소환 연출)이 떠 있을 수 있다. 그때 바로 띄우면 겹친다. **판이 닫힌 뒤 다음 유휴 프레임에** 띄운다. `showWallHint` 가 이미 같은 문제를 `setTimeout` 으로 피하고 있는데(main.js), 스토리는 더 길게 뜨므로 상태로 들고 있어야 한다.

---

## 5. 읽기 UX

- **진행:** 화면 아무 데나 탭 → 다음 컷이 아래에서 올라온다. 마지막 컷에서 한 번 더 탭하면 닫힌다.
- **자동 진행 없음.** 방치형이라고 스토리까지 자동으로 넘기면 읽는 사람이 놓친다.
- **건너뛰기:** 우상단 고정. 첫 컷부터 보인다. 누르면 즉시 닫고 `skipped` 에 기록.
- **되돌아가기 없음.** 잘못 탭해 넘겼으면 기록에서 처음부터 다시 읽는다. 한 컷 뒤로 가는 버튼은 탭 진행과 충돌한다.
- **전투는 안 멈춘다.** 스토리는 `#ov` 위(z 250)에 뜨고 뒤에서 전투가 계속 돈다. 방치형에서 진행이 멈추는 화면은 그 자체로 손해다.
- **기록 보관함:** 설정 > 정보에 [지난 이야기] 줄. 본 화 목록 + 다시 읽기. 건너뛴 화도 여기서 읽는다.

---

## 6. 코치마크 튜토리얼 (A)

### 6.1 지금 상태

`main.js` 의 `showTapHint(selector)` / `maybeOnboardHint()` 가 전부다.

- 있는 것: 펄스 손가락, 퀘스트 타입 → 선택자 매핑, 덮개 판정(`coverOpen`), Q1~Q8 한정(`ONBOARDING_UNTIL = 8`)
- **없는 것:** 말풍선, 어두운 막, 구멍, 강제 터치

`tutorial.json > uiTechniques` 는 이 넷을 전부 약속해 놓았다. 손가락만 떠 있으니 유저는 **어디를 누를지는 알지만 왜 누르는지는 모른다.**

### 6.2 설계

`#coach` 오버레이 하나를 새로 만든다 (z 200 — `#ov`(100)보다 위, 스토리(250)보다 아래).

```
#coach
 ├ .cc-dim × 4      대상 사각형의 위/아래/좌/우를 각각 덮는 판
 ├ .cc-ring         대상 테두리에 붙는 펄스 링
 ├ .cc-say          말풍선. 대상이 화면 위쪽이면 아래에, 아래쪽이면 위에 붙는다
 └ (손가락은 기존 showTapHint 를 그대로 재사용)
```

**구멍을 SVG mask 가 아니라 판 4장으로 뚫는 이유:** 마스크는 클릭을 안 막는다. 판 4장은 그 자체가 클릭을 먹으므로 `forceTouch` 가 CSS 만으로 성립한다 — 구멍만 통과한다. 별도의 이벤트 가로채기가 필요 없다.

**재배치:** 대상의 `getBoundingClientRect()` 는 스크롤·리사이즈·시트 애니메이션으로 계속 움직인다. `requestAnimationFrame` 루프로 매 프레임 다시 재는 대신, `ResizeObserver` + `scroll`(capture) + 트랜지션 종료(`transitionend`) 세 신호에만 다시 잰다. 손가락이 이미 같은 문제를 겪었으니 그 코드와 한 함수로 합친다.

**말풍선 규칙:** 2줄 이내. 3줄이 되면 그건 툴팁이지 코치마크가 아니다.

### 6.3 단계 정의 — 코드가 아니라 데이터로

지금은 `TAP_TARGET` 매핑이 코드에 박혀 있다. 말풍선 문구까지 코드에 박으면 번역(`t()`)과 밸런스 조정이 서로 발목을 잡는다. `tutorial.json` 에 옮긴다.

```jsonc
"coachSteps": [
  {
    "id": "c1_forge",
    "when": { "quest": 1 },
    "target": "#fgPayBtn",
    "sayKo": "여기서 장비를 만든다.\n다섯 번만 두드려 보자.",
    "force": true
  },
  {
    "id": "c2_merc_tab",
    "when": { "quest": 2, "phase": "afterSummon" },
    "target": ".nv[data-tab=\"merc\"]",
    "sayKo": "뽑은 용병은 아직 대기 중이다.",
    "force": true
  },
  {
    "id": "c2_autoequip",
    "when": { "quest": 2, "phase": "sheetOpen" },
    "target": "#shEqBtn",
    "sayKo": "[자동장착] 을 누르면\n제일 센 다섯이 앞에 선다.",
    "force": true
  }
]
```

`when` 은 **함수가 아니라 선언**이다. `main.js` 가 해석한다.

| 키 | 뜻 |
|---|---|
| `quest` | 이 퀘스트 번호일 때 |
| `phase` | `afterSummon`(목표 달성) · `sheetOpen`(편성 시트 열림) · `always` |
| `unlock` | 이 시스템이 막 해금됐을 때 |

`force` 는 **화이트리스트로만** 켠다. 전부 강제하면 유저가 화면을 못 만진다. Q1~Q3 의 핵심 조작(제작 · 자동장착)만 `true`, 나머지는 `false` 로 두어 딴 데를 눌러도 막지 않는다.

### 6.4 단계 표

| # | 시점 | 가리킬 곳 | 말풍선 | 강제 |
|---|---|---|---|---|
| 1 | Q1 시작 | 제작대 [제작] | 여기서 장비를 만든다 / 다섯 번만 두드려 보자 | O |
| 2 | Q1 달성 | 퀘스트 배너 | 다 했다. 보상을 받자 | O |
| 3 | Q2 시작 | 상점 > 용병 소환 | 소환권 10장이 들어왔다 | O |
| 4 | Q2 달성 | 용병 탭 | 뽑은 용병은 아직 대기 중이다 | O |
| 5 | Q2 시트 | [자동장착] | 누르면 제일 센 다섯이 앞에 선다 | O |
| 6 | Q3 시작 | 상점 > 스킬 소환 | 스킬은 용병단 전체에 걸린다 | X |
| 7 | Q3 달성 | 스킬 탭 → [자동장착] | 스킬도 장착해야 붙는다 | O |
| 8 | Q4 | 전투 화면 | 눌러 둘 것 없다. 알아서 싸운다 | X |
| 9 | Q6 | 제작대 레벨 | 레벨을 올리면 더 좋은 등급이 열린다 | X |
| 10 | Q7 | 던전 탭 | 층을 뚫을수록 매일 받는 양이 는다 | X |
| 11 | Q8 | 훈련소 | 골드는 여기서 전투력이 된다 | X |

8번이 이 표에서 제일 중요하다. **아무것도 누르지 않아도 된다는 것을 명시적으로 알려주는 단계**다. 방치형에서 이걸 말 안 하면 유저는 계속 뭘 눌러야 하는 줄 안다.

---

## 7. 구현 순서

| 단계 | 내용 | 에셋 | 건드릴 파일 |
|---|---|---|---|
| 1 | 코치마크 오버레이 + `coachSteps` 해석 | 0 | `index.html`, `main.js`, `tutorial.json` |
| 2 | 스토리 뷰어 골격 — 컷 렌더러, 탭 진행, 건너뛰기 | 0 | `view/story.js`(신규), `story.json`(신규) |
| 3 | EP0 (배경 2장) | `CUT-01`, `CUT-02` | `story.json` |
| 4 | EP1 · EP2 (배경 1장) | `CUT-03` | `story.json` |
| 5 | 기록 보관함 | 0 | `view/rank.js` 설정 화면 |
| 6 | EP3~EP8 (배경 5장) | `CUT-04`~`CUT-08` | `story.json` |

1·2단계는 에셋 없이 끝난다. **3단계에서 EP0 만 붙여 반응을 보고** 4단계 이후를 결정하는 것이 맞다. 44컷을 다 만들고 나서 "안 읽더라"를 확인하면 늦다.

측정할 것: EP0 완독률(건너뛰기 대비), EP0 을 본 유저와 건너뛴 유저의 Q4 도달률 차이. 차이가 없으면 EP3 이후는 만들지 않는다.

---

## 8. 에셋 프롬프트

### 8.1 공통 스타일 앵커

기존 `-ART.png` · `captain_*.png` 와 같은 결이어야 한다. 모든 프롬프트 앞에 붙인다.

```
Style: 2D game illustration, chibi anthropomorphic-animal fantasy world,
thick clean black outlines, saturated warm palette, soft cel shading with
painterly rim light, high contrast, mobile gacha art quality, storybook mood.
```

배경 플레이트에는 반드시 뒤에 붙인다.

```
No characters, no people, no animals, no text, no letters, no watermark,
no UI, no border, no frame.
```

**규격:** 배경 플레이트 `1024 x 768` (4:3), webp. 인물이 얹힐 자리를 비워 두어야 하므로 **중앙 하단 40% 는 단순하게** 그린다.

### 8.2 배경 플레이트 8장

**CUT-01 — 별락의 밤하늘** (EP0-1, EP8-6)
```
Night sky over a sleeping fantasy valley, a single enormous star cracking
apart and falling in several burning shards, long light trails, deep indigo
and violet sky, distant silhouetted mountains along the bottom edge,
the lower-center of the frame kept simple and dark.
```

**CUT-02 — 새벽의 폐허** (EP0-2·3)
```
Ruins of a small fantasy village at dawn, broken timber houses, scattered
stone, thin smoke rising, cold blue-grey light with a warm orange sliver on
the horizon, a wide empty patch of flat ground in the lower center.
```

**CUT-03 — 밤 수풀** (EP1-3)
```
Dense night forest undergrowth seen from a low angle, tall grass and ferns,
moonlight filtering through leaves, several faint glowing points among the
foliage suggesting watching eyes, deep green and teal palette, an open
clearing across the lower center.
```

**CUT-04 — 산 아래 대장간** (EP4)
```
Interior of an old mountain blacksmith workshop, stone forge with glowing
coals, hanging tools and chains, anvil to one side, thick warm orange light
from the forge against dark brown shadow, the center floor kept clear.
```

**CUT-05 — 갈라진 땅과 지하** (EP5)
```
A jagged fissure splitting rocky ground, pale blue-white light rising from
deep below, broken stone steps descending into the crack, cool light against
warm brown rock, the foreground ledge kept flat and simple.
```

**CUT-06 — 성벽 앞 게시판** (EP7)
```
A large wooden notice board in front of a tall stone fortress wall, many
weathered parchment slips pinned in rows, banners overhead, late afternoon
light, warm brown and cream palette, the board occupying the upper two
thirds and clear ground in the lower third.
```

**CUT-07 — 훈련 마당** (EP6)
```
An empty training yard at early morning, packed earth ground, wooden
practice dummies and a weapon rack along the far edge, low fence, soft
golden mist and long shadows, the whole center of the yard left empty.
```

**CUT-08 — 별이 박힌 심연** (EP5-5, EP8-6)
```
A vast underground cavern with an enormous embedded star fragment glowing
white-gold at its heart, ancient dragon-shaped carvings covering the walls,
floating dust motes, cathedral scale, cold blue shadow against the golden
core, an open stone platform in the lower center.
```

### 8.3 UI 2장

**UI-STORY — 이야기 아이콘** (기록 보관함 진입)
```
Game UI icon, an open storybook with a small glowing star fragment resting
on the page, thick black outline, warm parchment and gold palette,
flat centered composition on transparent background, 256x256, no text.
```

**CUT-BUBBLE — 말풍선 9-slice** (코치마크와 웹툰이 공유)
```
Game UI speech bubble panel, hand-drawn fantasy storybook style, cream
parchment fill with a thick dark brown rounded border and subtle worn
texture, no tail, flat front view, corners and edges designed for 9-slice
stretching, transparent background, no text.
```

> 말풍선은 Kenney UI 킷에 맞는 것이 있으면 그걸 쓰고 이 프롬프트는 버린다. `tutorial.json > assetImpact` 의 정신이 그쪽이다.

### 8.4 선택 — 나중에 필요해지면

- **오버레이 2장** (집중선 `FX-SPEED`, 화이트아웃은 CSS 로 충분)
- **`-ART` 배경 제거본 32장** — §3.2 의 2안. 마스크로 부족하다고 판단될 때만.

---

## 9. 열린 질문

1. **LR 스포일러.** 성좌룡·흑기린을 뽑기로 이미 가진 유저에게 EP5·EP8 의 "정체 암시"가 김빠진 장면이 된다. 도감 설명을 먼저 정하고 웹툰 대사를 거기 맞출지, 반대로 갈지.
2. **`-ART` 마스크 품질.** 512×768 배경 딸린 그림을 원형 마스크로 자르면 무기 끝이 잘린다. EP1 컷4 같은 클로즈업에서 티가 날 수 있다. 3단계 전에 한 컷 시안으로 확인할 것.
3. **EP3 트리거와 벽 안내의 순서.** 보스 패배 → 실패 연출 → 벽 안내 → 웹툰. 이미 세 개가 줄 서 있다. 하나 더 얹는 게 맞는지, 아니면 EP3 만 "두 번째 패배"로 미룰지.
4. **번역.** `story.json` 의 대사를 `t()` 로 태울지, 화별 언어 파일로 뺄지. 지금 `t()` 는 UI 문구용이라 44컷 대사가 섞이면 사전이 지저분해진다.
5. **2부.** 스테이지 100 이후를 EP9~ 로 이어갈지, 1부 8화로 닫을지. 이 기획은 8화까지만 다룬다.
