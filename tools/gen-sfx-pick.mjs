// 효과음 후보 검토 페이지를 굽는다 — `node tools/gen-sfx-pick.mjs`
//   → game/public/sfx-pick.html  (dev 서버로 http://localhost:5180/sfx-pick.html)
//
// 음원은 Kenney 6팩(전부 CC0). 저장소에 통째로 넣지 않는다 — game/public/_pick/ 은
// .gitignore 에 있고, **단장이 고른 것만** mp3 로 변환해 assets/sfx/ 로 간다.
//
// 큐 목록의 단일 소스는 data/sound.json 이다. 후보(PICK)는 파일 이름과 팩 성격을
// 보고 고른 **제안**이지 확정이 아니다 — 확정은 이 페이지에서 귀로 한다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOUND = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/data/sound.json'), 'utf8'));
const PICK_DIR = path.join(ROOT, 'game/public/_pick');

// 팩 약칭 → 폴더
const P = {
  rpg: 'rpg-audio', ui: 'ui-audio', ifc: 'interface-sounds',
  imp: 'impact-sounds', dig: 'digital-audio', jin: 'music-jingles',
};
const f = (pack, name) => `_pick/${P[pack]}/${name}.ogg`;

// ── 큐별 후보 3안 ──────────────────────────────────────────────
// 성격이 **서로 다르게** 잡는다. 비슷한 셋이면 고를 이유가 없어 비교가 안 된다.
const PICK = {
  // UI — 짧고 마른 소리. 길면 연타할 때 밀린다
  sfx_tap:          [f('ui','click1'),          f('ifc','click_001'),        f('ifc','select_001')],
  sfx_tab:          [f('ifc','switch_001'),     f('ui','switch3'),           f('ifc','select_004')],
  sfx_popup_open:   [f('ifc','open_001'),       f('ifc','maximize_002'),     f('rpg','bookOpen')],
  sfx_popup_close:  [f('ifc','close_001'),      f('ifc','minimize_002'),     f('rpg','bookClose')],
  sfx_denied:       [f('ifc','error_001'),      f('ifc','error_004'),        f('ifc','question_002')],
  sfx_toggle:       [f('ifc','toggle_001'),     f('ui','switch10'),          f('ifc','tick_001')],
  // 전투 — 타격은 **짧고 저역**. 길면 초당 여러 번 날 때 뭉갠다
  sfx_hit_melee:    [f('imp','impactPunch_medium_000'), f('imp','impactSoft_medium_000'), f('rpg','chop')],
  sfx_hit_range:    [f('imp','impactPlank_medium_000'), f('rpg','knifeSlice'),            f('dig','laser4')],
  sfx_hit_magic:    [f('dig','zap1'),           f('dig','phaserUp2'),        f('dig','laser8')],
  sfx_crit:         [f('imp','impactBell_heavy_000'),   f('imp','impactMetal_heavy_000'), f('dig','zapThreeToneUp')],
  sfx_evade:        [f('rpg','cloth1'),         f('rpg','cloth3'),           f('imp','footstep_grass_002')],
  sfx_counter:      [f('imp','impactMetal_medium_000'), f('rpg','metalClick'),            f('dig','twoTone1')],
  sfx_damaged:      [f('imp','impactSoft_heavy_000'),   f('imp','impactGeneric_light_000'), f('rpg','dropLeather')],
  sfx_unit_death:   [f('dig','lowDown'),        f('imp','impactSoft_heavy_003'), f('dig','phaserDown2')],
  sfx_boss_appear:  [f('imp','impactBell_heavy_002'),   f('dig','lowThreeTone'),  f('imp','impactMining_000')],
  sfx_stage_win:    [f('jin','jingles_NES00'), f('jin','jingles_PIZZI00'), f('dig','powerUp3')],
  sfx_stage_lose:   [f('dig','lowDown'),        f('jin','jingles_NES09'), f('ifc','error_006')],
  // 스킬 — 전투음과 겹치지 않게 고역·전자음 쪽으로
  sfx_sk_lightning: [f('dig','zap2'),           f('dig','laser1'),           f('dig','zapTwoTone')],
  sfx_sk_fire:      [f('imp','impactSoft_heavy_001'), f('dig','lowRandom'),   f('dig','spaceTrash2')],
  sfx_sk_pierce:    [f('rpg','knifeSlice2'),    f('dig','laser6'),           f('rpg','drawKnife1')],
  sfx_sk_ice:       [f('imp','impactGlass_light_000'), f('imp','impactGlass_medium_001'), f('dig','highDown')],
  sfx_sk_slash:     [f('rpg','chop'),           f('rpg','knifeSlice'),       f('imp','impactPlank_medium_002')],
  sfx_sk_buff:      [f('dig','powerUp5'),       f('dig','phaserUp5'),        f('dig','pepSound1')],
  sfx_sk_heal:      [f('dig','powerUp9'),       f('dig','highUp'),           f('dig','pepSound4')],
  sfx_sk_shield:    [f('imp','impactPlate_medium_000'), f('dig','phaseJump1'), f('dig','threeTone1')],
  sfx_sk_summon:    [f('dig','phaseJump3'),     f('dig','powerUp11'),        f('dig','spaceTrash4')],
  // 소환 — 등급이 올라갈수록 **길고 화려하게**. 여기가 뽑기의 심장이다
  sfx_summon_cast:  [f('dig','phaserUp1'),      f('rpg','clothBelt'),        f('dig','phaseJump5')],
  sfx_drumroll:     [f('dig','lowRandom'),      f('imp','impactMining_002'), f('dig','spaceTrash1')],
  sfx_grade_n:      [f('ifc','drop_001'),       f('ui','click3'),            f('ifc','pluck_001')],
  sfx_grade_r:      [f('ifc','confirmation_001'), f('dig','pepSound2'),      f('ifc','pluck_002')],
  sfx_grade_sr:     [f('dig','powerUp1'),       f('jin','jingles_PIZZI04'), f('ifc','confirmation_003')],
  sfx_grade_ssr:    [f('jin','jingles_STEEL02'), f('dig','powerUp7'), f('jin','jingles_NES03')],
  sfx_grade_ur:     [f('jin','jingles_SAX01'), f('jin','jingles_STEEL05'), f('dig','powerUp12')],
  sfx_grade_lr:     [f('jin','jingles_SAX04'), f('jin','jingles_HIT03'), f('jin','jingles_STEEL08')],
  // 성장
  sfx_levelup:      [f('jin','jingles_NES01'), f('dig','powerUp4'), f('jin','jingles_PIZZI02')],
  sfx_auto_enhance: [f('dig','pepSound3'),      f('rpg','handleCoins'),      f('dig','powerUp6')],
  sfx_equip_swap:   [f('rpg','clothBelt2'),     f('rpg','beltHandle1'),      f('imp','impactMetal_light_000')],
  sfx_enhance:      [f('imp','impactMetal_medium_002'), f('rpg','metalLatch'), f('dig','powerUp2')],
  sfx_summon_levelup: [f('jin','jingles_PIZZI06'), f('dig','powerUp8'), f('ifc','confirmation_004')],
  sfx_grade_unlock: [f('jin','jingles_STEEL00'), f('jin','jingles_NES05'), f('dig','powerUp10')],
  sfx_codex_new:    [f('ifc','pluck_001'),      f('rpg','bookFlip1'),        f('dig','pepSound5')],
  // 재화 — 동전·반짝. 자주 나므로 짧아야 한다
  sfx_gold:         [f('rpg','handleCoins'),    f('rpg','handleCoins2'),     f('ifc','drop_003')],
  sfx_diamond:      [f('imp','impactGlass_light_002'), f('ifc','glass_002'), f('dig','highUp')],
  sfx_dismantle:    [f('imp','impactWood_medium_000'), f('rpg','metalPot1'), f('imp','impactTin_medium_000')],
  sfx_claim:        [f('ifc','confirmation_002'), f('rpg','handleCoins2'),   f('dig','pepSound1')],
  sfx_purchase:     [f('ifc','confirmation_001'), f('jin','jingles_PIZZI08'), f('rpg','handleCoins')],
  // 알림
  sfx_badge:        [f('ifc','bong_001'),       f('ifc','tick_002'),         f('dig','twoTone2')],
  sfx_quest_done:   [f('jin','jingles_NES02'), f('jin','jingles_STEEL03'), f('dig','powerUp5')],
  sfx_timer_done:   [f('ifc','bong_001'),       f('ifc','question_001'),     f('dig','threeTone2')],
  sfx_mail:         [f('ifc','drop_002'),       f('rpg','bookPlace1'),       f('ifc','scroll_002')],
  // 던전·아레나
  sfx_dungeon_enter:[f('rpg','doorOpen_1'),     f('rpg','creak1'),           f('imp','impactWood_heavy_000')],
  sfx_floor_clear:  [f('dig','powerUp3'),       f('jin','jingles_PIZZI10'), f('ifc','confirmation_003')],
  sfx_arena_match:  [f('dig','lowThreeTone'),   f('imp','impactBell_heavy_004'), f('dig','phaseJump2')],
  sfx_arena_win:    [f('jin','jingles_SAX02'), f('jin','jingles_NES04'), f('dig','powerUp12')],
  sfx_arena_lose:   [f('dig','phaserDown3'),    f('jin','jingles_NES11'), f('ifc','error_007')],
};

const cues = [];
const missing = [];
for (const [group, arr] of Object.entries(SOUND.sfx)) {
  for (const c of arr) {
    const cands = (PICK[c.id] || []).map(rel => {
      const abs = path.join(ROOT, 'game/public', rel);
      const ok = fs.existsSync(abs);
      if (!ok) missing.push(`${c.id} → ${rel}`);
      return { rel, ok, size: ok ? fs.statSync(abs).size : 0 };
    });
    cues.push({ group, id: c.id, nameKo: c.nameKo, priority: c.priority,
      note: c.note || '', variations: c.variations || 1, cands });
  }
}

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>효과음 후보 검토 — 냥냥 용병단</title>
<style>
  :root{--bg:#15100c;--card:#241a12;--line:#3a2c20;--txt:#f2e5db;--dim:#a8907d;--gold:#ffc94a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:"Malgun Gothic",system-ui,sans-serif;font-size:14px}
  header{position:sticky;top:0;z-index:2;background:#1d150fee;border-bottom:1px solid var(--line);padding:12px 18px}
  h1{margin:0 0 4px;font-size:17px;color:var(--gold)}
  .sub{font-size:12px;color:var(--dim);line-height:1.6}
  .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:9px}
  button{font-family:inherit;font-size:13px;cursor:pointer;border-radius:8px;
    border:1px solid var(--line);background:var(--card);color:var(--txt);padding:6px 11px}
  button:hover{border-color:var(--gold)}
  button.on{background:var(--gold);color:#2a1c05;border-color:var(--gold);font-weight:700}
  main{padding:12px 18px 84px;max-width:1180px;margin:0 auto}
  .grp{margin:20px 0 7px;font-size:13px;color:var(--gold);letter-spacing:1px}
  .cue{display:grid;grid-template-columns:220px 1fr;gap:12px;align-items:start;
    background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin-bottom:6px}
  .cue.hide{display:none}
  .meta b{display:block;font-size:14px}
  .meta code{font-size:11px;color:var(--dim)}
  .meta .p{display:inline-block;font-size:10px;font-weight:800;border-radius:5px;padding:1px 6px;margin-top:3px}
  .p0{background:#7a2b2b;color:#ffd9d9}.p1{background:#3a4a7a;color:#dce6ff}.p2{background:#3a3a3a;color:#ccc}
  .note{font-size:11px;color:var(--dim);margin-top:4px;line-height:1.5}
  .cands{display:flex;gap:7px;flex-wrap:wrap}
  .cand{display:flex;flex-direction:column;gap:3px;min-width:170px}
  .cand button{width:100%;text-align:left}
  .cand button.sel{background:#2f4a2f;border-color:#5ad86a;color:#d8ffd8}
  .cand button.bad{opacity:.4;text-decoration:line-through}
  .fn{font-size:10px;color:#8a7563;padding-left:2px;word-break:break-all}
  footer{position:fixed;left:0;right:0;bottom:0;background:#1d150ff2;border-top:1px solid var(--line);
    padding:9px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  #out{flex:1;min-width:180px;font-size:12px;color:var(--dim)}
  textarea{width:100%;height:220px;background:#0f0b08;color:var(--txt);border:1px solid var(--line);
    border-radius:8px;padding:10px;font-family:monospace;font-size:11px;margin-top:10px}
</style></head><body>
<header>
  <h1>효과음 후보 검토 — Kenney 6팩 (전부 CC0)</h1>
  <div class="sub">
    큐 ${cues.length}종 × 후보 3안. <b>들어보고 고른 것만</b> mp3 로 변환해 게임에 들어간다 —
    지금 게임에는 소리가 한 줄도 안 붙어 있다.<br>
    마음에 드는 안이 없으면 <b>[전부 별로]</b> 를 눌러 표시해 두면, 그 큐만 다시 후보를 뽑아 온다.
  </div>
  <div class="bar">
    <span class="sub">보기:</span>
    <button data-f="all" class="on">전체 ${cues.length}</button>
    <button data-f="P0">P0 ${cues.filter(c => c.priority === 'P0').length}</button>
    <button data-f="P1">P1 ${cues.filter(c => c.priority === 'P1').length}</button>
    <button data-f="P2">P2 ${cues.filter(c => c.priority === 'P2').length}</button>
    <button data-f="todo">아직 안 고른 것</button>
    <span class="sub" style="margin-left:auto">볼륨</span>
    <input id="vol" type="range" min="0" max="100" value="70">
  </div>
</header>
<main id="list"></main>
<footer>
  <button id="exp">내보내기</button>
  <span id="out"></span>
</footer>
<script>
const CUES=${JSON.stringify(cues)};
const GROUP_KO={ui:'UI',combat:'전투',skill:'스킬',gacha:'소환',growth:'성장',currency:'재화',notify:'알림',dungeonArena:'던전·아레나'};
const sel={}, bad={};
let vol=.7, cur='', playing=null;
const list=document.getElementById('list');
function play(src){
  if(playing){playing.pause();playing=null}
  playing=new Audio(src);playing.volume=vol;playing.play().catch(()=>{});
}
for(const c of CUES){
  if(c.group!==cur){cur=c.group;const h=document.createElement('div');h.className='grp';
    h.textContent=(GROUP_KO[c.group]||c.group)+' — '+CUES.filter(x=>x.group===c.group).length+'종';list.append(h)}
  const row=document.createElement('div');row.className='cue';row.dataset.p=c.priority;row.dataset.id=c.id;
  row.innerHTML='<div class="meta"><b>'+c.nameKo+'</b><code>'+c.id+'</code>'
    +'<span class="p '+c.priority.toLowerCase()+'">'+c.priority+'</span>'
    +(c.variations>1?' <span class="fn">변주 '+c.variations+'종 필요</span>':'')
    +(c.note?'<div class="note">'+c.note+'</div>':'')
    +'</div><div class="cands"></div>';
  const box=row.querySelector('.cands');
  c.cands.forEach((cand,i)=>{
    const wrap=document.createElement('div');wrap.className='cand';
    const b=document.createElement('button');
    b.textContent=(i+1)+'안 ▶  '+(cand.ok?(cand.size/1024).toFixed(0)+'KB':'파일 없음');
    if(!cand.ok)b.classList.add('bad');
    b.onclick=()=>{if(!cand.ok)return;play(cand.rel);sel[c.id]=i;delete bad[c.id];
      box.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));
      b.classList.add('sel');count()};
    const fn=document.createElement('div');fn.className='fn';fn.textContent=cand.rel.replace('_pick/','');
    wrap.append(b,fn);box.append(wrap);
  });
  const nb=document.createElement('div');nb.className='cand';
  const x=document.createElement('button');x.textContent='✕ 전부 별로';
  x.onclick=()=>{bad[c.id]=1;delete sel[c.id];
    box.querySelectorAll('button').forEach(y=>y.classList.remove('sel'));x.classList.add('sel');count()};
  nb.append(x);box.append(nb);
  list.append(row);
}
function count(){
  const n=Object.keys(sel).length, b=Object.keys(bad).length;
  document.getElementById('out').textContent='고름 '+n+' · 전부 별로 '+b+' · 남음 '+(CUES.length-n-b)+' / '+CUES.length;
}
document.getElementById('vol').oninput=e=>{vol=e.target.value/100;if(playing)playing.volume=vol};
document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  const f=b.dataset.f;
  document.querySelectorAll('.cue').forEach(r=>{
    const id=r.dataset.id;
    const ok=f==='all'||(f==='todo'?(sel[id]==null&&!bad[id]):r.dataset.p===f);
    r.classList.toggle('hide',!ok);
  });
});
document.getElementById('exp').onclick=()=>{
  const out={note:'sfx-pick.html 에서 고른 결과. 고른 것만 mp3 로 변환해 assets/sfx/ 로 간다.',
    picked:{}, rejected:Object.keys(bad)};
  for(const c of CUES){const i=sel[c.id];if(i==null)continue;out.picked[c.id]=c.cands[i].rel.replace('_pick/','')}
  const ta=document.querySelector('main textarea')||document.createElement('textarea');
  ta.value=JSON.stringify(out,null,2);
  if(!ta.parentElement)document.querySelector('main').prepend(ta);
  ta.scrollIntoView();ta.select();
};
count();
</script></body></html>
`;

fs.writeFileSync(path.join(ROOT, 'game/public/sfx-pick.html'), html);
console.log('구움: game/public/sfx-pick.html  →  http://localhost:5180/sfx-pick.html');
console.log(`  큐 ${cues.length}종 · 후보 ${cues.reduce((a, c) => a + c.cands.length, 0)}개`);
if (missing.length) {
  console.log(`  ! 파일 없음 ${missing.length}건:`);
  for (const m of missing) console.log('    ' + m);
} else console.log('  후보 파일 전부 존재');
