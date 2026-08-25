// 퀘스트 — 메인 화면에 상시 노출되고, 누르면 목적지로 이동하거나 수령한다.
//
// quests.json > ui.showNextRewardNote:
//   "'다음 보상: 용병 소환권 40' 이 화면에 떠 있으면 유저가 지금 뭘 해야 할지 자동으로 안다."
//
// 7칸 순환 구조 (cycle.slots) — 스테이지 → 용병소환 → 스킬소환 → 제작대 → 던전 →
// 훈련소 → 전투력. 훈련소는 2026-08-24 에 넣었다 (전직 게이트인데 사이클에 없었다).
// 각 칸은 다음 칸에 필요한 재화를 보상으로 준다 (supplyRate). 그래서 퀘스트를 따라가면
// 시스템 전체를 한 바퀴 돌게 된다.

import { num } from '../core/fmt.js';
import { t } from '../core/i18n.js';
const CUR_ICON = {
  diamond: 'CU-01', gold: 'CU-04', speedup_5m: 'CU-10',
  merc_ticket: 'CU-05', skill_ticket: 'CU-06', equip_ticket: 'CU-07',
 arena_medal: 'CU-11',
};
const CUR_NAME = {
  diamond: '다이아', gold: '골드', speedup_5m: '모래시계',
  merc_ticket: '용병 소환권', skill_ticket: '스킬 소환권', equip_ticket: '장비 소환권',
 arena_medal: '투기장 훈장',
};

/** 퀘스트 유형 → 화면에 보일 문구와 이동할 곳 */
/**
 * 퀘스트 유형 → 문구와 이동할 곳.
 *   goto  화면 키. track 이 있으면 그 화면 안에서 해당 트랙까지 연다.
 */
/**
 * 사이클별 던전 목표. 9칸 사이클의 7번째 칸이라 퀘스트 번호는 (k-1)*9 + 7 이다 —
 * k1→Q7(명시), k2→Q16, k3→Q25, k4→Q34, k5→Q43, k6→Q52, k8→Q70, k10→Q88.
 *
 * **던전 해금(dungeons.json > unlockQuest)보다 뒤에 와야 한다.** 예전에는
 * Q5 가 황금 광산을 요구하는데 해금이 Q8 이라 잠긴 던전을 깨라는 퀘스트가
 * 걸렸다. 지금은 해금 값을 각 퀘스트 직전으로 내려 맞춰 뒀다.
 *
 * 'tower' 는 무한의 탑이다. 입장권이 없어 하루에 여러 층을 오를 수 있으니,
 * 열쇠를 기다려야 하는 던전 사이에 끼워 진행이 멈추지 않게 한다.
 */
// 자동 사이클의 던전 칸은 N ≡ 7 (mod 9) 이다: k2→Q16 부터 (Q1~9 는 explicitQuests).
// k1 칸은 명시 퀘스트 Q7 이 대신 서 있고, 이 표의 첫 줄은 dungeonNth(재방문
// 횟수) 계산에만 쓰인다.
// 해금(dungeons.json > unlockQuest)은 각 칸보다 앞서야 한다: furnace Q39 → 칸 Q52,
// crystal_cave Q53 → Q70, trial_tower Q67 → Q88 — tools/validate.mjs 가 검사한다.
export const DUNGEON_BY_CYCLE = [
  'gold_mine',       // k1  Q7  (explicit)
  'gold_mine',       // k2  Q16
  'treasure_vault',  // k3  Q25  해금 Q16
  'gold_mine',       // k4  Q34
  'tower',           // k5  Q43
  'furnace',         // k6  Q52  해금 Q39
  'tower',           // k7  Q61
  'crystal_cave',    // k8  Q70  해금 Q53
  'tower',           // k9  Q79
  'trial_tower',     // k10 Q88  해금 Q67
];

/** 이 사이클이 그 던전(또는 탑)을 몇 번째로 요구하는가 (1부터) */
export function dungeonNth(k) {
  const i = Math.min(k, DUNGEON_BY_CYCLE.length) - 1;
  const id = DUNGEON_BY_CYCLE[i];
  let n = 0;
  for (let j = 0; j <= i; j++) if (DUNGEON_BY_CYCLE[j] === id) n++;
  // 표를 넘어선 사이클은 마지막 것을 계속 요구한다 — 그만큼 더 깊이
  return n + Math.max(0, k - DUNGEON_BY_CYCLE.length);
}
/** 이 사이클의 목표가 무한의 탑인가 */
export const isTowerCycle = k =>
  DUNGEON_BY_CYCLE[Math.min(k, DUNGEON_BY_CYCLE.length) - 1] === 'tower';

export const QUEST_TYPE = {
  stage_clear: { label: '스테이지 돌파', goto: null, verb: '' },
  mercenary_summon: { label: '용병 소환', goto: 'shop', track: 'mercenary', verb: '용병 소환으로' },
  skill_summon: { label: '스킬 소환', goto: 'shop', track: 'skill', verb: '스킬 소환으로' },
  equip_summon_level: { label: '제작대 레벨', goto: 'forge', verb: '제작대로' },
  // 제작대 **소환 횟수**. 레벨과 다른 축이다 — 첫 퀘스트가 "제작대를 한 번
  // 돌려 봐라" 여야 해서, 레벨(강화로도 오른다)이 아니라 뽑은 횟수를 센다
  // goto 가 'forgeDock' 인 이유 — 강화 패널(openForge)이 아니라 **하단 도크의
  // 모루** 를 눌러야 제작이 된다. 패널을 열면 정작 눌러야 할 모루를 덮는다
  equip_summon_count: { label: '무기 제작', goto: 'forgeDock', verb: '제작대로' },
  // 훈련소 — 골드를 태워 전 용병을 올리는 곳이고 전직의 게이트다
  // (goldsinks > training_camp.promotion). 온보딩에서 한 번은 열어 보게 한다
  training_level: { label: '훈련소 레벨', goto: 'training', verb: '훈련소로' },
  dungeon_floor: { label: '던전 도달', goto: 'dungeon', verb: '던전으로' },
  // 무한의 탑 — 입장권이 없어 전투력만 되면 바로 오른다. 던전이 열쇠를
  // 기다리는 동안 진행이 멈추지 않게 사이사이에 넣는다
  tower_floor: { label: '무한의 탑', goto: 'tower', verb: '무한의 탑으로' },
  // 처치 수는 방치 중에도 저절로 오른다 — "가서 뭘 해라"가 아니라
  // "계속 돌리면 찬다". 그래서 옮길 데가 없다 (goto: null)
  monster_kill: { label: '몬스터 처치', goto: null, verb: '' },
  // 스테이지·전투력은 이미 하고 있는 일이다. 옮길 데가 없으므로 아무 반응도 안 한다.
  power_reach: { label: '전투력 달성', goto: null, verb: '' },
};

/**
 * N번 퀘스트 정의. Q1~Q24 는 explicitQuests, 그 이후는 generationRule 로 자동 생성.
 */
export function questAt(D, n) {
  const ex = D.quests.explicitQuests.find(q => q.q === n);
  if (ex) return { ...ex, auto: false };

  const k = Math.ceil(n / D.quests.cycle.length);
  const slot0 = D.quests.cycle.slots[((n - 1) % D.quests.cycle.length)];
  // 던전 칸이 탑 차례면 유형을 바꿔 끼운다 (DUNGEON_BY_CYCLE)
  const slot = slot0.type === 'dungeon_floor' && isTowerCycle(k)
    ? { ...slot0, type: 'tower_floor' } : slot0;
  const target = {
    stage_clear: () => 5 * k,
    // **소환은 항상 10회다.** 바로 앞 퀘스트가 소환권 10장을 주므로
    // "받은 만큼 그대로 쓰면 끝난다" 가 성립한다 — 사이클마다 목표를 늘리면
    // 그 성립이 깨지고, 유저는 자기가 얼마나 모아야 하는지 매번 다시 센다
    mercenary_summon: () => 10,
    skill_summon: () => 10,
    // 제작대 **도크**를 누르는 칸 (레벨과 다른 축이다). 소환권 1장 = 1회라
    // 앞 퀘스트가 그만큼 주면 그대로 끝난다. Q1 이 5회이므로 k1 에서 5 다
    equip_summon_count: () => 5 * k,
    // 처치는 방치로 저절로 찬다 — "가서 뭘 해라"가 아닌 칸을 사이클마다
    // 하나 끼운다. Q4 가 10 이므로 k1 에서 10 이다
    monster_kill: () => 10 * k,
    equip_summon_level: () => Math.min(2 * k, 60),
    // 열쇠가 던전마다 하루 3개(리필)다. 3*k 로 두면 사이클 7 에 21층을 요구해
    // 며칠이 걸린다 — **새 던전이면 2층**, 같은 던전을 또 요구할 때만 2층씩 깊게
    dungeon_floor: () => 2 * dungeonNth(k),
    // 탑은 열쇠를 안 쓴다 — 다섯 층씩 끊어 올린다 (요구 CP 는 1.135^층)
    tower_floor: () => 5 * dungeonNth(k),
    // CP 를 400 으로 나눈 뒤의 값이다 (2026-08-24). 3000×1.9^(k-1) 이던 시절엔
    // 사이클 5 에서 39,096 을 요구했는데 그건 새 스케일로 LR 한 장 값이다
    // 훈련소 — 골드를 태우는 칸. 4k 면 사이클 4 에 Lv16(누적 약 2만골드) 이다
    training_level: () => 4 * k,
    power_reach: () => Math.round(2000 * Math.pow(1.9, k - 2)),
  }[slot.type]();

  // 보상은 다음 퀘스트가 요구하는 자원 × supplyRate 로 역산된다.
  const supply = k <= 1 ? 1.0 : k <= 2 ? 0.9 : k <= 3 ? 0.8 : k <= 4 ? 0.7 : 0.6;
  const base = Math.round(2000 * Math.pow(1.55, k));
  // 골드는 **1/10** 이다 (×12 → ×1.2). 초반 비용을 낮추면서 명시 퀘스트 보상도
  // 같이 내렸는데 자동 구간만 옛 배수로 두면 Q25 부터 갑자기 12만이 쏟아진다
  const rewards = { gold: Math.round(base * 1.2 * supply), diamond: Math.round(60 * k * supply) };
  // **다음 퀘스트가 소환이면 그 소환권 10장을 여기서 준다.** 소환 목표가 항상
  // 10 회라, 앞 퀘스트 보상이 곧 그 퀘스트의 밑천이 된다 (quests.json > chainInvariant)
  const nextType = D.quests.cycle.slots[(n % D.quests.cycle.length)].type;
  if (nextType === 'mercenary_summon') rewards.merc_ticket = 10;
  if (nextType === 'skill_summon') rewards.skill_ticket = 10;
  // 무기 제작 칸도 같은 규칙이다 — 소환권 1장 = 1회 (main.js > summonEquip)라
  // 다음 칸의 목표(5 * 그 사이클)만큼 여기서 준다. 안 주면 자동 구간에서
  // 장비 소환권이 아예 안 나와 그 칸이 며칠씩 막힌다
  if (nextType === 'equip_summon_count') rewards.equip_ticket = 5 * Math.ceil((n + 1) / D.quests.cycle.length);
  if (n % 10 === 0) rewards.diamond *= 4;
  const out = { q: n, cycle: k, type: slot.type, target, rewards, auto: true };
  // 던전 퀘스트는 **어느 던전인지**가 붙어야 한다. 안 붙이면 "아무 던전이나
  // 최고층" 이 되어, 이미 깊이 판 던전 덕에 새 퀘스트가 시작하자마자 완료된다
  if (slot.type === 'dungeon_floor') out.dungeon = DUNGEON_BY_CYCLE[Math.min(k, DUNGEON_BY_CYCLE.length) - 1];
  return out;
}

/** 현재 진행도. 상태에서 직접 읽는다 — 별도 카운터를 두면 어긋난다. */
export function questProgress(S, def) {
  switch (def.type) {
    case 'stage_clear': return S.maxStage;
    // 아래 넷은 전부 **이번 퀘스트 동안** 의 값이다 (소환·제작·처치). 기준점은 퀘스트를 넘길 때 다시 찍는다
    // (main.js > markQuestBase). 누적으로 세면 목표가 131 처럼 커지고, 미리
    // 많이 뽑아 둔 사람은 새 퀘스트가 시작하자마자 완료된다.
    // questBase 가 없는 옛 세이브는 누적 그대로 본다 — 갑자기 목표가 늘지 않게
    case 'mercenary_summon':
      return S.summonExp.mercenary - (S.questBase?.merc ?? 0);
    case 'skill_summon':
      return S.summonExp.skill - (S.questBase?.skill ?? 0);
    case 'equip_summon_level': return S.forgeLv;
    case 'equip_summon_count': return (S.eqSummons || 0) - (S.questBase?.eq ?? 0);
    case 'training_level': return S.trainLv || 0;
    case 'dungeon_floor': {
      // **지정된 던전만** 본다. 지정이 없는 옛 저장본은 최고층으로 넘어간다
      const dg = S.dg || {};
      if (def.dungeon) return Math.max(0, (dg[def.dungeon]?.floor || 1) - 1);
      return Object.values(dg).reduce((a, d) => Math.max(a, d.floor - 1), 0);
    }
    case 'tower_floor': return S.tower?.best || 0;
    case 'monster_kill': return (S.kills || 0) - (S.questBase?.kills ?? 0);
    case 'power_reach': return 0;   // main 이 CP 를 넣어준다
    default: return 0;
  }
}

export function rewardHtml(rewards) {
  return Object.entries(rewards).map(([k, v]) =>
    `<span class="q-rw"><img src="/assets/ui/${CUR_ICON[k] || 'CU-04'}.png" alt="">${fmt(v)}</span>`)
    .join('');
}
const fmt = num;

// ─────────────────────────────────────────────

export class QuestScreen {
  constructor(root, api) {
    this.api = api;
    this.el = document.createElement('div');
    this.el.id = 'quest-scr';
    this.el.className = 'fullscr';
    this.el.innerHTML = `
      <div class="sh-head">
        <button class="sh-back">‹</button>
        <span class="sh-title">퀘스트</span>
      </div>
      <div class="sh-body" id="qsBody"></div>`;
    root.appendChild(this.el);
    this.el.querySelector('.sh-back').addEventListener('click', () => this.close());
  }

  open() { this.el.classList.add('show'); this.render(); }
  close() { this.el.classList.remove('show'); }

  render() {
    const D = this.api.data, S = this.api.state;
    const n = S.quest;
    const def = questAt(D, n);
    const cur = this.api.progress(def);
    const done = cur >= def.target;
    // 지역 이름을 t 로 두지 않는다 — i18n 의 t() 를 가려 렌더가 통째로 죽는다
    // (main.js renderQuest 에서 실제로 터진 사고와 같은 패턴)
    const qt = QUEST_TYPE[def.type];
    const nextDef = questAt(D, n + 1);
    const nextT = QUEST_TYPE[nextDef.type];

    this.el.querySelector('#qsBody').innerHTML = `
      <div class="q-hero">
        <div class="q-no">Q${n}</div>
        <div class="q-name">${t(qt.label)}</div>
        <div class="q-prog">${fmt(cur)} <span>/ ${fmt(def.target)}</span></div>
        <div class="q-bar"><i style="width:${Math.min(100, cur / def.target * 100)}%"></i></div>
        <div class="q-rewards">${rewardHtml(def.rewards)}</div>
        <button class="q-go ${done ? 'done' : ''}" id="qsGo">
          ${done ? t('보상 수령') : t(qt.verb) + ' ' + t('이동')}</button>
      </div>

      <div class="sh-h2">다음 퀘스트</div>
      <div class="frow">
        <span class="k">Q${n + 1} · ${t(nextT.label)} ${fmt(nextDef.target)}</span>
        <span class="v" style="gap:6px">${rewardHtml(nextDef.rewards)}</span>
      </div>
      <div class="sh-note">
        퀘스트는 7칸이 순환한다 — 스테이지 → 용병 소환 → 스킬 소환 → 제작대 → 던전 → 훈련소 → 전투력.<br>
        각 칸의 보상이 <b>다음 칸에 필요한 재화</b>다. 그래서 따라가면 시스템 전체를 한 바퀴 돈다.
      </div>
      <div class="sh-note">
        ${D.quests.supplyRate.criticalNote}
      </div>`;

    this.el.querySelector('#qsGo').addEventListener('click', () => {
      if (done) this.api.claim();
      else { this.close(); this.api.goto(t.goto); }
    });
  }
}
