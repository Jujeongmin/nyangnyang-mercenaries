import * as G from './state.js';
import { Battle } from './battle.js';

const { S, D } = G;
const $ = (s) => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

const GC = { N: '#9aa4b5', R: '#4CAF50', SR: '#2196F3', SSR: '#9C27B0', UR: '#FF9800', LR: '#E91E63' };
let battle, lastCp = 0;

// ---------- 부트 ----------
(async function boot() {
  await G.loadData();
  G.initNew();
  $('#cap').src = '../assets/captain/captain_warrior.png';
  battle = new Battle($('#cv'), onStageClear);
  await battle.init();
  bindUI();
  render();
  setInterval(loop, 250);
})();

function loop() {
  if (G.tickForge()) toast(`대장간 Lv${S.lv.equip} 달성`);
  if (S.autoSummon && S.key > 0) {
    const n = Math.min(S.key, batchSize());
    S.key -= n;
    const r = G.summonGear(n);
    flashInv();
    if (r.kept) markBadges();
  }
  render();
}

const batchSize = () => {
  const p = D.equipment.summon.progression.filter(x => x.summonLv <= S.lv.equip && x.pullsPerBatch);
  return p.length ? p[p.length - 1].pullsPerBatch : 1;
};

function onStageClear(ok) {
  if (ok) {
    S.gold += G.stageGold(S.stage);
    S.key += 1 + Math.floor(S.stage / 10);
    S.ore += 200 + S.stage * 12;
    if (S.stage === S.maxStage) { S.diamond += 30 * (1 + Math.floor(S.stage / 20)); S.maxStage++; }
    S.stage = Math.min(S.maxStage, S.stage + 1);
  }
  render();
}

// ---------- 렌더 ----------
function render() {
  const cp = G.totalCp();
  if (cp !== lastCp) {
    const d = cp - lastCp;
    if (lastCp && d > 0) {
      const e = $('#cpdelta'); e.textContent = `+${G.fmt(d)} ↑`; e.style.opacity = 1;
      clearTimeout(e._t); e._t = setTimeout(() => e.style.opacity = 0, 1200);
    }
    lastCp = cp;
  }
  $('#cpbox').textContent = G.fmt(cp);
  $('#c_dia').textContent = G.fmt(S.diamond);
  $('#c_gold').textContent = G.fmt(S.gold);
  $('#c_key').textContent = G.fmt(S.key);
  $('#stg').textContent = S.stage;
  $('#stgname').textContent = `스테이지 ${S.stage}  (요구 ${G.fmt(G.requiredCp(S.stage))})`;
  $('#capform').textContent = captainForm();

  // 조우 표시
  const enc = $('#enc'); enc.innerHTML = '';
  for (let i = 0; i < 3; i++) enc.appendChild(el('span', 'encdot' + (battle && battle.enc > i ? ' on' : '')));
  enc.appendChild(el('span', 'encdot boss' + (battle && battle.phase.startsWith('boss') ? ' on' : '')));

  renderGear();
  renderForge();
  markBadges();
}

function captainForm() {
  const cnt = { warrior: 0, archer: 0, mage: 0 };
  S.equipped.mercenary.forEach(id => cnt[G.mercOf(id).class]++);
  const top = ['warrior', 'archer', 'mage'].sort((a, b) => cnt[b] - cnt[a])[0];
  return { warrior: '검사', archer: '사수', mage: '술사' }[top];
}

function renderGear() {
  const row = $('#eqrow'); row.innerHTML = '';
  for (const s of D.equipment.slots) {
    const g = S.gear[s.id];
    const up = G.gearUpgrades().some(u => u.slot === s.id);
    const d = el('div', 'slot' + (up ? ' up' : ''));
    if (g) {
      const gd = D.equipment.grades.find(x => x.tier === g.tier);
      d.innerHTML = `<span class="t" style="color:${gd.color}">T${g.tier}</span><span class="e">+${g.enhance}</span>`;
      d.style.borderColor = gd.color;
    } else d.innerHTML = `<span style="opacity:.4">${s.nameKo}</span>`;
    row.appendChild(d);
  }
  const inv = $('#inv'); inv.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const it = S.gearInv[i];
    const d = el('div', 'slot');
    if (it) {
      const gd = D.equipment.grades.find(x => x.tier === it.tier);
      d.innerHTML = `<span class="t" style="color:${gd.color}">T${it.tier}</span>`;
      d.style.borderColor = gd.color;
    }
    inv.appendChild(d);
  }
  $('#invinfo').textContent = `${S.gearInv.length}/12`;
}

function flashInv() {
  [...$('#inv').children].forEach(c => { c.classList.remove('new'); void c.offsetWidth; c.classList.add('new'); });
}

function renderForge() {
  const p = G.forgeProgress(), c = G.forgeCost();
  $('#fglv').textContent = `Lv${S.lv.equip}`;
  $('#fgnext').textContent = `Lv${S.lv.equip + 1}`;
  $('#fgfill').style.width = (p * 100) + '%';
  const left = Math.max(0, S.forgeMs - (Date.now() - S.forgeStart));
  const m = Math.floor(left / 60000), sec = Math.floor(left % 60000 / 1000);
  $('#fgtime').textContent = p >= 1 ? (S.ore >= c.ore ? '완료' : `제련석 ${G.fmt(c.ore)} 부족`) : `${m}:${String(sec).padStart(2, '0')}`;
  $('#fghint').textContent = `${G.gearTierUnlockHint()}   ·   제련석 ${G.fmt(S.ore)} / ${G.fmt(c.ore)}   ·   배치 ${batchSize()}개`;
  $('#b_speedup').textContent = `즉시 ${G.speedupCost()}💎`;
}

function markBadges() {
  const pend = G.pendCount();
  const eq = G.equipUpgradeAvailable();
  const gu = G.gearUpgrades().length;
  set('#nb_merc', pend || eq ? (pend ? pend : '↑') : 0);
  set('#nb_skill', pend || eq ? (pend ? pend : '↑') : 0);
  set('#nb_equip', gu);
  function set(sel, v) {
    const e = $(sel);
    if (!v) { e.style.display = 'none'; return; }
    e.style.display = 'block'; e.textContent = v;
  }
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1400);
}

// ---------- 입력 ----------
function bindUI() {
  document.querySelectorAll('#speed .sbtn').forEach(b => b.onclick = () => {
    S.speed = +b.dataset.sp;
    document.querySelectorAll('#speed .sbtn').forEach(x => x.classList.toggle('on', x === b));
  });

  $('#b_sum1').onclick = () => doGear(1);
  $('#b_sum10').onclick = () => doGear(10);
  $('#b_auto').onclick = () => {
    S.autoSummon = !S.autoSummon;
    $('#b_auto').textContent = S.autoSummon ? '자동 ON' : '자동 OFF';
    $('#b_auto').classList.toggle('primary', S.autoSummon);
  };
  $('#b_speedup').onclick = () => {
    const c = G.speedupCost();
    if (S.diamond < c) return toast('다이아 부족');
    S.diamond -= c; S.forgeStart = Date.now() - S.forgeMs;
    render();
  };

  document.querySelectorAll('.nv').forEach(n => n.onclick = () => openOv(n.dataset.ov));
  $('#ovclose').onclick = () => $('#ov').classList.remove('show');
}

function doGear(n) {
  if (S.key < n) return toast('황금 열쇠 부족');
  S.key -= n;
  const r = G.summonGear(n);
  flashInv(); render();
  toast(`${r.total}회 · 보관 ${r.kept} · 분해 ${r.dismantled} · +${G.fmt(r.gold)}골드`);
}

// ---------- 오버레이 ----------
function openOv(kind) {
  const ov = $('#ov'), body = $('#ovbody');
  ov.classList.add('show'); body.innerHTML = '';
  if (kind === 'merc') return ovMerc(body);
  if (kind === 'skill') return ovSkill(body);
  if (kind === 'equip') return ovEquip(body);
  if (kind === 'shop') return ovShop(body);
  ovInfo(body);
}

function ovShop(body) {
  $('#ovtitle').textContent = '상점';
  const sec = (t) => { const d = el('div', null, t); d.style.cssText = 'font-size:11px;color:var(--dim);margin:10px 0 5px'; body.appendChild(d); };

  sec(`용병 소환   ·   소환 Lv${S.lv.merc}   ·   누적 ${S.exp.merc}뽑`);
  actionBar(body, [
    ['x1  (150💎)', () => buyMerc(1), true],
    ['x10 (1350💎)', () => buyMerc(10), true],
  ]);

  sec(`스킬 소환   ·   소환 Lv${S.lv.skill}   ·   누적 ${S.exp.skill}뽑`);
  actionBar(body, [
    ['x1  (150💎)', () => buySkill(1), true],
    ['x10 (1350💎)', () => buySkill(10), true],
  ]);

  sec('현재 확률 (소환 레벨 기준)');
  const b = D.gacha.rateBands.find(x => S.lv.merc >= x.minLevel && S.lv.merc <= x.maxLevel);
  const c = el('div', 'card');
  c.innerHTML = Object.entries(b.rates).filter(([, v]) => v > 0)
    .map(([g, v]) => `<span style="margin-right:9px"><span class="gd" style="background:${GC[g]}">${g}</span> ${v}%</span>`).join('');
  c.style.display = 'block';
  body.appendChild(c);

  sec('개발용');
  const cheat = el('button', 'act', '재화 지급 (다이아 10만 / 골드 10억 / 열쇠 5000 / 제련석 100만)');
  cheat.style.cssText = 'width:100%;padding:10px';
  cheat.onclick = () => { S.diamond += 100000; S.gold += 1e9; S.key += 5000; S.ore += 1e6; render(); toast('지급'); };
  body.appendChild(cheat);
}

function buyMerc(n) {
  const cost = n === 10 ? 1350 : 150;
  if (S.diamond < cost) return toast('다이아 부족');
  S.diamond -= cost;
  const got = G.summonMerc(n);
  const best = got.slice().sort((a, b) => D.characters.gradeCoef[b.grade] - D.characters.gradeCoef[a.grade])[0];
  toast(`최고 ${best.grade} ${best.nameKo}`);
  openOv('shop'); render();
}
function buySkill(n) {
  const cost = n === 10 ? 1350 : 150;
  if (S.diamond < cost) return toast('다이아 부족');
  S.diamond -= cost;
  const got = G.summonSkill(n);
  const best = got.slice().sort((a, b) => D.skills.gradeCoef[b.grade] - D.skills.gradeCoef[a.grade])[0];
  toast(`최고 ${best.grade} ${best.nameKo}`);
  openOv('shop'); render();
}

function actionBar(body, items) {
  const bar = el('div', null, '');
  bar.style.cssText = 'display:grid;grid-template-columns:repeat(' + items.length + ',1fr);gap:6px;margin-bottom:8px';
  items.forEach(([label, fn, primary]) => {
    const b = el('button', 'act' + (primary ? ' primary' : ''), label);
    b.style.padding = '9px 0';
    b.onclick = () => { fn(); };
    bar.appendChild(b);
  });
  body.appendChild(bar);
}

function ovMerc(body) {
  $('#ovtitle').textContent = `용병  (소환 Lv${S.lv.merc} · 누적 ${S.exp.merc}뽑)`;
  actionBar(body, [
    [`자동강화 (${G.pendCount()})`, () => {
      const r = G.autoEnhance();
      toast(`레벨업 ${r.lvUps}회 · 혼 +${G.fmt(r.souls)}`);
      openOv('merc'); render();
    }, true],
    ['자동장착', () => { G.applyAutoEquip(); battle.reset(); toast('편성 갱신'); openOv('merc'); render(); }],
  ]);
  const ids = Object.keys(S.mercs).sort((a, b) => G.mercCp(b, S.mercs[b]) - G.mercCp(a, S.mercs[a]));
  for (const id of ids) {
    const m = G.mercOf(id), eq = S.equipped.mercenary.includes(id);
    const cap = D.characters.levelCap[m.grade];
    const c = el('div', 'card' + (eq ? ' eq' : ''));
    c.innerHTML = `<span><span class="gd" style="background:${GC[m.grade]}">${m.grade}</span> ${m.nameKo}
      <span style="color:var(--dim)"> Lv${S.mercs[id]}/${cap}</span></span>
      <span>${G.fmt(G.mercCp(id, S.mercs[id]))}${eq ? ' <b style="color:var(--gold)">장착</b>' : ''}</span>`;
    body.appendChild(c);
  }
}

function ovSkill(body) {
  $('#ovtitle').textContent = `스킬  (소환 Lv${S.lv.skill} · 누적 ${S.exp.skill}뽑)`;
  actionBar(body, [
    [`자동강화 (${G.pendCount()})`, () => { const r = G.autoEnhance(); toast(`레벨업 ${r.lvUps}회`); openOv('skill'); render(); }, true],
    ['자동장착', () => { G.applyAutoEquip(); toast('스킬 갱신'); openOv('skill'); render(); }],
  ]);
  const ids = Object.keys(S.skills).sort((a, b) =>
    G.skillCp(S.skills[b].grade, S.skills[b].level) - G.skillCp(S.skills[a].grade, S.skills[a].level));
  for (const id of ids) {
    const s = G.skillOf(id), st = S.skills[id];
    const eq = S.equipped.skillActive.includes(id) || S.equipped.skillPassive.includes(id);
    const c = el('div', 'card' + (eq ? ' eq' : ''));
    c.innerHTML = `<span><span class="gd" style="background:${GC[st.grade]}">${st.grade}</span> ${s.nameKo}
      <span style="color:var(--dim)"> ${s.type === 'active' ? '액티브' : '패시브'} Lv${st.level}</span></span>
      <span>${G.fmt(G.skillCp(st.grade, st.level))}${eq ? ' <b style="color:var(--gold)">장착</b>' : ''}</span>`;
    body.appendChild(c);
  }
}

function ovEquip(body) {
  const ups = G.gearUpgrades();
  $('#ovtitle').textContent = `장비  (교체 가능 ${ups.length})`;
  actionBar(body, [
    ['전체 교체', () => {
      const list = G.gearUpgrades();
      if (!list.length) return toast('교체할 장비 없음');
      const gold = G.applyGear(list);
      toast(`${list.length}부위 교체 · +${G.fmt(gold)}골드`); openOv('equip'); render();
    }, true],
    ['강화 x1 (전 부위)', () => {
      let cost = 0;
      for (const s of D.equipment.slots) {
        const g = S.gear[s.id]; if (!g || g.enhance >= 15) continue;
        const base = D.equipment.enhancement.baseCostByTier[g.tier];
        cost += Math.floor(base * Math.pow(1.55, g.enhance));
      }
      if (S.gold < cost) return toast(`골드 부족 (${G.fmt(cost)} 필요)`);
      S.gold -= cost;
      for (const s of D.equipment.slots) { const g = S.gear[s.id]; if (g && g.enhance < 15) g.enhance++; }
      toast(`전 부위 +1 강화 · -${G.fmt(cost)}골드`); openOv('equip'); render();
    }],
  ]);
  for (const s of D.equipment.slots) {
    const cur = S.gear[s.id];
    const u = ups.find(x => x.slot === s.id);
    const c = el('div', 'card' + (u ? ' eq' : ''));
    const txt = (g) => g ? `T${g.tier} +${g.enhance}` : '없음';
    c.innerHTML = `<span>${s.nameKo}</span>
      <span>${txt(cur)} ${u ? `<b style="color:var(--up)">→ T${u.item.tier}</b>` : ''}</span>`;
    body.appendChild(c);
  }
}

function ovInfo(body) {
  $('#ovtitle').textContent = '정보';
  const rows = [
    ['전투력', G.fmt(G.totalCp())],
    ['요구 CP', G.fmt(G.requiredCp(S.stage))],
    ['최고 스테이지', S.maxStage],
    ['용병 소환 Lv', `${S.lv.merc} (누적 ${S.exp.merc})`],
    ['스킬 소환 Lv', `${S.lv.skill} (누적 ${S.exp.skill})`],
    ['장비 소환 Lv', S.lv.equip],
    ['장비 보너스', `+${(G.gearBonus() * 100).toFixed(1)}%`],
    ['용병혼 / 스킬혼', `${G.fmt(S.mercSoul)} / ${G.fmt(S.skillSoul)}`],
    ['보유 용병', Object.keys(S.mercs).length + '종'],
    ['보유 스킬', Object.keys(S.skills).length + '종'],
  ];
  for (const [k, v] of rows) {
    body.appendChild(el('div', 'card', `<span style="color:var(--dim)">${k}</span><span>${v}</span>`));
  }
  const b = el('button', 'act primary', '재화 치트 (+다이아 10만 / 골드 10억 / 열쇠 5000 / 제련석 100만)');
  b.style.cssText = 'width:100%;padding:10px;margin-top:6px';
  b.onclick = () => { S.diamond += 100000; S.gold += 1e9; S.key += 5000; S.ore += 1e6; render(); toast('지급'); };
  body.appendChild(b);
}
