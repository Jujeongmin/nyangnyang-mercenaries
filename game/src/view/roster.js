// 편성 시트 — 하단 네비의 용병 / 스킬 탭.
//
// 가운데 오버레이(#ov)가 아니라 아래에서 올라오는 바텀시트다. 화면 60%.
// 위에서부터 [장착한 것] → [전체 목록] → [자동강화 · 자동장착] 순서다.
//
// 목록은 **보유분이 아니라 전체**를 뿌린다 (characters.json 32종 · skills.json 전체).
// 미보유는 도감과 같은 `???` + 회색이다 — 보유분만 뿌리면 "뭐가 남았나"를 알 수 없어
// 소환을 계속할 이유가 안 보인다. 도감의 .cx-grid/.cx-cell 을 그대로 재사용하므로
// 같은 용병이 두 화면에서 다르게 보이지 않는다.
//
// 버튼은 **즉시 실행**이다. 뽑기 결과는 보유함(S.own)·강화 대기열(S.pend)에 쌓이기만
// 하고, 여기서 눌러야 편성과 레벨에 반영된다.


const $ = s => document.querySelector(s);
const GRADES = ['N', 'R', 'SR', 'SSR', 'UR', 'LR'];

export class RosterSheet {
  /**
   * @param api {state, data, cpOf, skillCp, enhance(track), equip(track), canEquip(track)}
   *   enhance/equip 는 main.js 가 준다 — cascade·scene·save 를 건드려야 하기 때문이다.
   */
  constructor(api) {
    this.api = api;
    this.track = 'mercenary';

    $('#shX').addEventListener('click', () => this.close());
    $('#sheetBg').addEventListener('click', () => this.close());

    $('#shUp').addEventListener('click', () => {
      const log = this.api.enhance(this.track);
      this.render();
      if (!log.length) return;
      const head = log.slice(0, 2).map(x => `${x.name} Lv${x.from}→${x.to}`).join(' · ');
      this.api.toast(`강화 ${head}${log.length > 2 ? ` 외 ${log.length - 2}` : ''}`);
    });
    $('#shEqBtn').addEventListener('click', () => {
      this.api.equip(this.track);
      this.render();
      this.api.toast(this.track === 'skill' ? '스킬 갱신' : '편성 갱신');
    });
  }

  open(track = 'mercenary') {
    this.track = track;
    // 네비 실측 높이를 --navh 로 넘긴다. 시트가 네비 바로 위에 딱 붙어야 한다
    const nav = $('#nav');
    if (nav) document.documentElement.style
      .setProperty('--navh', `${Math.round(nav.getBoundingClientRect().height)}px`);
    $('#sheetBg').classList.add('show');
    $('#sheet').classList.add('show');
    this.render();
  }

  close() {
    $('#sheetBg').classList.remove('show');
    $('#sheet').classList.remove('show');
  }

  get isOpen() { return $('#sheet').classList.contains('show'); }

  /**
   * 장착 줄에 그릴 칸들. 최종 칸 수(용병 5 · 스킬 4+4)만큼 자리를 만들고
   * **아직 안 열린 칸은 잠금**으로 표시한다. 칸이 몇 개 더 남았는지가 보여야
   * 퀘스트를 미는 이유가 된다 (quests.json > slotUnlockQuests).
   */
  equipped() {
    const S = this.api.state;
    const box = (arr, open, max) => Array.from({ length: max }, (_, i) =>
      i < open ? (arr[i] || null) : 'lock');
    if (this.track === 'skill') {
      return [
        ...box(S.skills.active, this.api.slotsOf('skillActive'), 4),
        ...box(S.skills.passive, this.api.slotsOf('skillPassive'), 4),
      ];
    }
    return box(S.party, this.api.slotsOf('mercenary'), 5);
  }

  render() {
    if (!this.isOpen) return;
    // 던전은 장착 줄·이월·액션바가 없다. 껍데기만 같이 쓴다
    $('#sheet').classList.toggle('mode-dg', this.track === 'dungeon');
    if (this.track === 'dungeon') return this.renderDungeon();

    const S = this.api.state, D = this.api.data;
    const isSkill = this.track === 'skill';

    // ── 프리셋 바 ────────────────────────────────────────────
    // 던전 모드가 아닐 때만. 탭 = 불러오기, [저장] = 현재 편성을 선택 칸에 기록
    const pre = $('#shPre');
    const cur = S.presetSel ?? 0;
    pre.innerHTML = [0, 1, 2].map(i =>
      `<button class="pr${S.presets?.[i] ? ' has' : ''}${i === cur ? ' on' : ''}"
         data-pre="${i}">${i + 1}</button>`).join('')
      + '<button class="pr-save" data-presave>현재 편성 저장</button>';
    pre.querySelectorAll('[data-pre]').forEach(b => b.addEventListener('click', () => {
      S.presetSel = +b.dataset.pre;
      this.api.loadPreset(+b.dataset.pre);
    }));
    pre.querySelector('[data-presave]').addEventListener('click', () =>
      this.api.savePreset(S.presetSel ?? 0));

    // ── 장착 줄 ──────────────────────────────────────────────
    const eq = this.equipped();                       // null = 빈 칸, 'lock' = 미해금
    // 제목만 둔다. '장착 N · 보유 M' 은 바로 아래 장착 줄과 목록이 이미 보여 준다
    $('#shT').textContent = isSkill ? '스킬' : '용병';
    const dir = isSkill ? 'skill' : 'char';
    const slot = (x) => x === 'lock'
      ? `<div class="rt-slot locked"><img class="lockIc" src="/assets/ui/UI-LOCK.png" alt="잠김"></div>`
      : x
      ? `<div class="rt-slot g-${x.grade}" data-info="${x.id}">
           <img src="/assets/${dir}/${x.id}.png" alt="">
           <b>Lv ${x.level || 0}</b></div>`
      : '<div class="rt-slot empty"></div>';
    // 스킬은 액티브 4 / 패시브 4 사이를 벌린다. 안 벌리면 8칸이 한 덩어리로 보인다
    $('#shEq').innerHTML = isSkill
      ? eq.slice(0, 4).map(slot).join('') + '<span class="rt-gap"></span>'
        + eq.slice(4).map(slot).join('')
      : eq.map(slot).join('');

    // 요약 줄은 뺐다. '강화 대기 N개' 는 자동강화 버튼 라벨이 그대로 들고 있고,
    // '강화할 중복이 없다' 같은 안내는 매번 같은 자리에서 같은 말을 해 자리만 먹었다
    const pend = (S.pend && S.pend[this.track]) || [];
    $('#shSum').textContent = '';

    // ── 전체 목록 ────────────────────────────────────────────
    $('#shBody').innerHTML = isSkill ? this.skillList() : this.mercList();
    // 보유한 칸을 누르면 상세. 미보유(???)는 누를 것이 없다
    const kind = isSkill ? 'skill' : 'merc';
    $('#shBody').querySelectorAll('.cx-cell[data-info]').forEach(el =>
      el.addEventListener('click', () => this.api.openUnitInfo(kind, el.dataset.info)));
    // 장착 줄도 같은 상세를 연다
    $('#shEq').querySelectorAll('.rt-slot[data-info]').forEach(el =>
      el.addEventListener('click', () => this.api.openUnitInfo(kind, el.dataset.info)));

    // ── 액션바 ───────────────────────────────────────────────
    $('#shUp').textContent = pend.length ? `자동강화 (${pend.length})` : '자동강화';
    $('#shUp').disabled = !pend.length;
    $('#shEqBtn').disabled = !this.api.canEquip(this.track);
  }

  /** 던전 — 목록 HTML 과 클릭 배선을 main.js 가 준다 (열쇠·CP·runDungeon 을 쥐고 있다) */
  renderDungeon() {
    $('#shT').textContent = '던전';
    $('#shBody').innerHTML = this.api.dungeonHtml();
    this.api.bindDungeons($('#shBody'));
  }

  mercList() {
    const S = this.api.state, D = this.api.data;
    const own = new Set(S.codex.mercenary);
    // 장착·보유분의 레벨을 id 로 찾는다. 목록 칸에 Lv 를 띄우기 위해서다
    const lv = new Map();
    for (const m of [...S.party.filter(Boolean), ...(S.own?.mercenary || [])]) lv.set(m.id, m);
    const inParty = new Set(S.party.filter(Boolean).map(m => m.id));

    // 등급별로 끊지 않는다. 약한 것이 맨 위, 아래로 갈수록 세진다 —
    // 한 줄기로 흐르면 "내가 어디까지 왔나"가 스크롤 위치로 바로 읽힌다.
    const list = D.characters.characters.slice()
      .sort((a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade));
    const got = list.filter(c => own.has(c.id) || lv.has(c.id)).length;

    return `<div class="cx-h"><span>용병</span>
        <span class="cx-cnt">${got}/${list.length}</span>
        </div>
      <div class="cx-grid">`
      + list.map(c => this.cell({
          id: c.id, nameKo: c.nameKo, grade: c.grade, dir: 'char',
          // 도감과 보유함 둘 중 하나라도 있으면 보유다. 도감만 보면 둘이 어긋났을 때
          // `???` 칸에 Lv 배지가 뜬다 — 잠긴 걸 강화한 것처럼 읽힌다.
          has: own.has(c.id) || lv.has(c.id), on: inParty.has(c.id), held: lv.get(c.id),
        })).join('')
      + '</div>';
  }

  skillList() {
    const S = this.api.state, D = this.api.data;
    const held = new Map();
    for (const s of [...S.skills.active, ...S.skills.passive].filter(Boolean)) held.set(s.id, s);
    const onIds = new Set(held.keys());
    for (const s of (S.own?.skill || [])) if (!held.has(s.id)) held.set(s.id, s);

    // 등급은 스킬 종류에 고정이다 (skills.json > meta.gradeIsFixed) — 보유 여부와
    // 무관하게 데이터에서 온다. 그래서 미보유 칸도 제 등급 액자를 쓸 수 있다.
    // 보유 판정은 등급이 아니라 도감 등록 또는 보유분으로 따로 본다
    const hasOf = s => !!S.codex.skill[s.id] || held.has(s.id);
    const list = D.skills.skills.slice()
      .sort((a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade));
    const got = list.filter(hasOf).length;

    return `<div class="cx-h"><span>스킬</span>
        <span class="cx-cnt">${got}/${list.length}</span>
        </div>
      <div class="cx-grid">`
      + list.map(s => this.cell({
          id: s.id, nameKo: s.nameKo, grade: s.grade, dir: 'skill',
          has: hasOf(s), on: onIds.has(s.id), held: held.get(s.id),
          // 액티브/패시브는 줄로 안 가르는 대신 칸에 표시한다. 자동장착이 둘을
          // 따로 채우므로(각 4칸) 어느 쪽인지는 여전히 알아야 한다.
          kind: s.id.startsWith('SK-A') ? '액' : '패',
        })).join('')
      + '</div>';
  }

  /** 목록 한 칸. 도감과 같은 클래스를 쓴다 (.cx-cell / .lock 이 ??? · 회색을 준다) */
  cell({ id, nameKo, grade, dir, has, on, held, kind }) {
    // 등급을 아는 것은 미보유여도 등급 액자를 쓴다 — 액자가 "뽑으면 이 등급"의
    // 예고가 된다. 스킬은 뽑을 때 등급을 굴리므로 미보유면 등급 자체가 없다
    const cls = (grade ? ` g-${grade}` : '') + (has ? '' : ' lock');
    return `<div class="cx-cell${cls}${on ? ' on' : ''}" title="${nameKo}"${
      has ? ` data-info="${id}"` : ''}>
      <img src="/assets/${dir}/${id}.png" alt="" onerror="this.remove()">
      ${kind ? `<i class="rt-kind">${kind}</i>` : ''}
      ${held ? `<i class="rt-lv">Lv ${held.level || 0}</i>` : ''}
      <span>${has ? nameKo : '???'}</span>
    </div>`;
  }
}
