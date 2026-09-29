# v1.4.0 천둥 업데이트 — 설계

결제 유저가 생긴 것을 계기로 한 감사 업데이트. 2026-09-29 단장과 확정.

## 1. 신규 LR 용병 3종 (LR 총 5종)

| id | 이름 | class | element | 외형 요점 |
|---|---|---|---|---|
| LR-03 | 천둥 그리핀 궁신 | archer | light | 금빛 날개 그리핀, 번개가 흐르는 장궁 |
| LR-04 | 대지 코뿔소 전쟁군주 | warrior | nature | 이끼 낀 바위 갑옷, 거대 망치, 초록·호박색 |
| LR-05 | 심해 고래 대현자 | mage | water | 향유고래 현자, 산호·진주 지팡이, 심해 발광 |

- 해태 수호기사(UR-02, 황금 사자 검방패)와 실루엣·색이 겹치지 않게 태양 사자왕안은 폐기.
- 획득은 가챠만. 등급 풀이 동적이라 데이터 추가만으로 합류한다.
- 스탯은 등급×클래스 공식이라 밸런스 코드 변경 없음.
- 도감 예산 0.32 유지: `characters.codex.bonusPerRegistered = 0.32/35`, `codex.json` LR 항목·totalEntries 갱신.
- 에셋: `char/<ID>.webp` 512×512, `art/<ID>-ART.png` 512×768, `trim.json`, `cutout/<ID>.json`. ChatGPT(크롬)로 생성 → 기존 후처리 툴.
- i18n 4개 언어 `data.<ID>`.

## 2. 신규 패스 "천둥 원정" (기존 스테이지 패스와 병행)

- 데이터: `data/pass2.json` (pass.json 과 같은 모양 + `progress.metric = "mercSummons"`).
- 진행: 패스 오픈 이후 용병 소환 횟수. 10회 = 1티어, 최대 30티어.
  - 기준점 `S.pass2.base` = 처음 이 패스를 만난 순간의 `S.summonExp.mercenary`. 신규 유저는 0.
- 무료/프리미엄 2트랙. 프리미엄 500 VX, 소급 지급, SKU `pass_thunder_s1` (once).
- 최종 보상: `pf_thunder`(무료) / `pf_thunder_gold`(유료) 프로필 테두리, 에셋 `PF-T1`, `PF-T1G`.
- UI: 기존 패스 화면에 탭 [스테이지 패스 | 천둥 원정]. 사이드 빨간 점은 두 패스 합산.
- 코드: pass 함수들을 패스 정의(데이터·상태 키·진행 함수)를 받게 일반화.
- 서버: `PRODUCTS.pass_thunder_s1 = { unlock: 'pass2', once: true }`, SERVER_REV 37.
- 운영: VX 대시보드에 `pass_thunder_s1` 등록(Lifetime Limit 1)은 단장이 직접.

## 3. 우편 감사 선물

- `mail.json` 항목 `thanks-2026-09`, 다이아 1500, `expiresAt` 2026-10-31 23:59 KST.

## 4. 업데이트 패널

- `data/patchnotes.json` `{ version, date, title, items[] }`.
- 부팅 후 `S.patchSeen !== version` 이면 1회 팝업, 닫으면 기록.
- 완전 신규 세이브는 띄우지 않고 바로 본 것으로 기록.

## 5. 버전·배포

- `ui.json` version 1.4.0, `SERVER_REV` 37.
- 검증: `npm run check`, `node tools/test-server.mjs`, 브라우저 화면 확인.
- 푸시: `origin develop`(GitLab) + `github develop:master`.
