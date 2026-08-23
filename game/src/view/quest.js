// 퀘스트 — 메인 화면에 상시 노출되고, 누르면 목적지로 이동하거나 수령한다.
//
// quests.json > ui.showNextRewardNote:
//   "'다음 보상: 용병 소환권 40' 이 화면에 떠 있으면 유저가 지금 뭘 해야 할지 자동으로 안다."
//
// 6칸 순환 구조 (cycle.slots) — 스테이지 → 용병소환 → 스킬소환 → 제작대 → 던전 → 전투력.
// 각 칸은 다음 칸에 필요한 재화를 보상으로 준다 (supplyRate). 그래서 퀘스트를 따라가면
// 시스템 전체를 한 바퀴 돌게 된다.

import { num } from '../core/fmt.js';
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
export const QUEST_TYPE = {
  stage_clear: { label: '스테이지 돌파', goto: null, verb: '' },
  mercenary_summon: { label: '용병 소환', goto: 'shop', track: 'mercenary', verb: '용병 소환으로' },
  skill_summon: { label: '스킬 소환', goto: 'shop', track: 'skill', verb: '스킬 소환으로' },
  equip_summon_level: { label: '제작대 레벨', goto: 'forge', verb: '제작대로' },
  dungeon_floor: { label: '던전 돌파', goto: 'dungeon', verb: '던전으로' },
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
  const slot = D.quests.cycle.slots[((n - 1) % D.quests.cycle.length)];
  const target = {
    stage_clear: () => 5 * k,
    mercenary_summon: () => Math.round(10 * Math.pow(k, 1.6)),
    skill_summon: () => Math.round(8 * Math.pow(k, 1.6)),
    equip_summon_level: () => Math.min(2 * k, 60),
    dungeon_floor: () => 3 * k,
    power_reach: () => Math.round(3000 * Math.pow(1.9, k - 1)),
  }[slot.type]();

  // 보상은 다음 퀘스트가 요구하는 자원 × supplyRate 로 역산된다.
  const supply = k <= 1 ? 1.0 : k <= 2 ? 0.9 : k <= 3 ? 0.8 : k <= 4 ? 0.7 : 0.6;
  const base = Math.round(2000 * Math.pow(1.55, k));
  const rewards = { gold: Math.round(base * 12 * supply), diamond: Math.round(60 * k * supply) };
  if (n % 10 === 0) { rewards.diamond *= 4; rewards.merc_ticket = 10 * k; }
  return { q: n, cycle: k, type: slot.type, target, rewards, auto: true };
}

/** 현재 진행도. 상태에서 직접 읽는다 — 별도 카운터를 두면 어긋난다. */
export function questProgress(S, def) {
  switch (def.type) {
    case 'stage_clear': return S.maxStage;
    case 'mercenary_summon': return S.summonExp.mercenary;
    case 'skill_summon': return S.summonExp.skill;
    case 'equip_summon_level': return S.forgeLv;
    case 'dungeon_floor':
      return Object.values(S.dg || {}).reduce((a, d) => Math.max(a, d.floor - 1), 0);
    case 'monster_kill': return S.kills || 0;
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
    const t = QUEST_TYPE[def.type];
    const nextDef = questAt(D, n + 1);
    const nextT = QUEST_TYPE[nextDef.type];

    this.el.querySelector('#qsBody').innerHTML = `
      <div class="q-hero">
        <div class="q-no">Q${n}</div>
        <div class="q-name">${t.label}</div>
        <div class="q-prog">${fmt(cur)} <span>/ ${fmt(def.target)}</span></div>
        <div class="q-bar"><i style="width:${Math.min(100, cur / def.target * 100)}%"></i></div>
        <div class="q-rewards">${rewardHtml(def.rewards)}</div>
        <button class="q-go ${done ? 'done' : ''}" id="qsGo">
          ${done ? '보상 수령' : t.verb + ' 이동'}</button>
      </div>

      <div class="sh-h2">다음 퀘스트</div>
      <div class="frow">
        <span class="k">Q${n + 1} · ${nextT.label} ${fmt(nextDef.target)}</span>
        <span class="v" style="gap:6px">${rewardHtml(nextDef.rewards)}</span>
      </div>
      <div class="sh-note">
        퀘스트는 6칸이 순환한다 — 스테이지 → 용병 소환 → 스킬 소환 → 제작대 → 던전 → 전투력.<br>
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
