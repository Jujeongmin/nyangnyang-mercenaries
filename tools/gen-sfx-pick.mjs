// 아직 음원이 없는 큐의 후보 검토 페이지를 굽는다 — `node tools/gen-sfx-pick.mjs`
//   → game/public/sfx-pick.html  (http://localhost:5180/sfx-pick.html)
//
// **이미 assets/sfx/ 에 파일이 있는 큐는 건너뛴다.** 승인된 것을 다시 고르게 하면
// 목록만 길어지고 실수로 덮어쓸 여지가 생긴다.
//
// 음원은 Kenney 팩(전부 CC0). 저장소에 통째로 넣지 않는다 — game/public/_pick/ 은
// .gitignore 에 있고, 고른 것만 assets/sfx/ 로 간다.
//
// **팩 선택 규칙 (2026-08-26 개정)**: digital-audio 와 music-jingles 는 안 쓴다.
// 8비트·피치카토·전자음이라 "카툰스럽다" 는 지적을 받은 바로 그 소리들이다.
// 실제로 녹음한 폴리만 쓴다 — impact-sounds(충격), rpg-audio(천·동전·문·금속),
// interface-sounds(딸깍·종이). 마법 계열은 현실 사물 소리로 대신한다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOUND = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/data/sound.json'), 'utf8'));
const HAVE_DIR = path.join(ROOT, 'game/public/assets/sfx');

const P = { rpg: 'rpg-audio', ui: 'ui-audio', ifc: 'interface-sounds', imp: 'impact-sounds' };
const f = (pack, name) => `_pick/${P[pack]}/${name}.ogg`;

// ── 2차 후보 — 1차 반려분만 ──────────────────────────────────
// **재검토 목록** — 파일이 이미 있어도 다시 내민다. "확보한 큐는 건너뛴다" 규칙의
// 명시적 예외다: 승인했다가 마음이 바뀐 큐가 여기 온다. 고르면 기존 파일을 덮는다.
const RETRY = new Set();   // 비어 있는 게 정상 — 재검토할 큐가 생기면 넣는다

const PICK = {
  // 근접 타격 2차 — ElevenLabs 산(가죽 백 퍽)이 **너무 둔탁하다** (단장 지적
  // 2026-08-26). 반대 방향(마르고 또렷한 쪽)으로 셋을 튼다. 나무·금속 가벼운
  // 타격 계열 — 1차 Kenney 후보(주먹·부드러운 충격·도끼)와도 겹치지 않는다
  sfx_hit_melee: [f('imp','impactPlank_medium_001'), f('imp','impactMetal_light_001'), f('imp','impactWood_light_002')],

  // 2차 후보 — 1차가 전부 반려된 7종만 남았다. **반려된 파일은 다시 안 내민다.**
  // 성격을 아예 다른 쪽으로 튼다: 1차가 유리·금속 계열이었으면 2차는 나무·천·
  // 종이·물 쪽으로. 같은 계열에서 번호만 바꿔 내밀면 또 반려될 뿐이다.
  sfx_sk_lightning: [f('imp','impactTin_medium_004'),  f('ifc','scratch_001'),          f('rpg','metalClick')],
  sfx_sk_pierce:    [f('rpg','drawKnife2'),            f('imp','impactWood_light_000'), f('rpg','cloth2')],
  sfx_sk_buff:      [f('rpg','handleSmallLeather'),    f('ifc','select_006'),           f('rpg','clothBelt')],
  sfx_sk_heal:      [f('rpg','bookPlace3'),            f('ifc','scroll_004'),           f('rpg','cloth1')],
  sfx_sk_shield:    [f('rpg','beltHandle1'),           f('imp','impactWood_medium_001'),f('rpg','handleSmallLeather2')],
  sfx_diamond:      [f('rpg','metalClick'),            f('ifc','select_002'),           f('imp','impactBell_heavy_003')],
  sfx_arena_lose:   [f('rpg','doorClose_1'),           f('imp','impactPlank_medium_003'),f('rpg','creak3')],
};

// 확장자는 mp3(직접 만든 것)와 ogg(Kenney)가 섞인다 — 둘 다 "확보" 로 센다.
// mp3 만 보면 방금 넣은 ogg 를 못 알아보고 다시 고르라고 내민다 (실제로 그랬다)
const have = fs.existsSync(HAVE_DIR)
  ? new Set(fs.readdirSync(HAVE_DIR)
      .filter(x => /\.(mp3|ogg)$/.test(x))
      .map(x => x.replace(/\.(mp3|ogg)$/, '')))
  : new Set();

const cues = [];
const skipped = [], aliased = [], noCand = [], missing = [];
for (const [group, arr] of Object.entries(SOUND.sfx)) {
  for (const c of arr) {
    if (have.has(c.id) && !RETRY.has(c.id)) { skipped.push(c.id); continue; }   // 이미 승인·확보
    if (c.aliasOf) { aliased.push(`${c.id} → ${c.aliasOf}`); continue; }
    const picks = PICK[c.id];
    if (!picks) { noCand.push(c.id); continue; }
    const cands = picks.map(rel => {
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
<title>남은 효과음 후보 — 냥냥 용병단</title>
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
  .cue{display:grid;grid-template-columns:210px 1fr;gap:12px;align-items:start;
    background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin-bottom:6px}
  .cue.hide{display:none}
  .meta b{display:block;font-size:14px}
  .meta code{font-size:11px;color:var(--dim)}
  .meta .p{display:inline-block;font-size:10px;font-weight:800;border-radius:5px;padding:1px 6px;margin-top:3px}
  .p0{background:#7a2b2b;color:#ffd9d9}.p1{background:#3a4a7a;color:#dce6ff}.p2{background:#3a3a3a;color:#ccc}
  .note{font-size:11px;color:var(--dim);margin-top:4px;line-height:1.5}
  .cands{display:flex;gap:7px;flex-wrap:wrap}
  .cand{display:flex;flex-direction:column;gap:3px;min-width:168px}
  .cand button{width:100%;text-align:left}
  .cand button.sel{background:#2f4a2f;border-color:#5ad86a;color:#d8ffd8}
  .fn{font-size:10px;color:#8a7563;padding-left:2px;word-break:break-all}
  footer{position:fixed;left:0;right:0;bottom:0;background:#1d150ff2;border-top:1px solid var(--line);
    padding:9px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  #out{flex:1;min-width:180px;font-size:12px;color:var(--dim)}
  textarea{width:100%;height:220px;background:#0f0b08;color:var(--txt);border:1px solid var(--line);
    border-radius:8px;padding:10px;font-family:monospace;font-size:11px;margin-top:10px}
  .done{background:#1c2a1c;border:1px solid #3f5f3f;border-radius:9px;padding:9px 12px;
    font-size:12px;color:#bcd8bc;margin-bottom:10px;line-height:1.7}
</style></head><body>
<header>
  <h1>남은 효과음 후보 — Kenney 실사 폴리 (CC0)</h1>
  <div class="sub">
    <b>digital-audio · music-jingles 는 뺐다</b> — 8비트·전자음이라 카툰스럽다고 반려된 바로 그 소리들이다.
    실제로 녹음한 것만 쓴다: 충격(impact) · 천/동전/문/금속(rpg) · 딸깍/종이(interface).<br>
    마법 계열은 현실 사물로 대신한다 — 번개=유리 튕김·글리치, 화염=천 스침, 얼음=유리 깨짐.
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
<main id="list">
  <div class="done">
    <b>이미 확보 — 여기 안 나온다</b><br>
    승인된 파일 ${skipped.length}종: ${skipped.join(' · ') || '없음'}<br>
    별칭 ${aliased.length}종: ${aliased.join(' · ') || '없음'}
  </div>
</main>
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
function play(src){ if(playing){playing.pause()} playing=new Audio(src);playing.volume=vol;playing.play().catch(()=>{}); }
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
    b.onclick=()=>{if(!cand.ok)return;play(cand.rel);sel[c.id]=i;delete bad[c.id];
      box.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');count()};
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
function count(){const n=Object.keys(sel).length,b=Object.keys(bad).length;
  document.getElementById('out').textContent='고름 '+n+' · 전부 별로 '+b+' · 남음 '+(CUES.length-n-b)+' / '+CUES.length}
document.getElementById('vol').oninput=e=>{vol=e.target.value/100;if(playing)playing.volume=vol};
document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  const f=b.dataset.f;
  document.querySelectorAll('.cue').forEach(r=>{const id=r.dataset.id;
    const ok=f==='all'||(f==='todo'?(sel[id]==null&&!bad[id]):r.dataset.p===f);
    r.classList.toggle('hide',!ok)});
});
document.getElementById('exp').onclick=()=>{
  const out={note:'남은 큐 후보에서 고른 결과. 고른 것만 assets/sfx/ 로 간다.',picked:{},rejected:Object.keys(bad)};
  for(const c of CUES){const i=sel[c.id];if(i==null)continue;out.picked[c.id]=c.cands[i].rel.replace('_pick/','')}
  let ta=document.querySelector('main textarea');
  if(!ta){ta=document.createElement('textarea');document.querySelector('main').prepend(ta)}
  ta.value=JSON.stringify(out,null,2);ta.scrollIntoView();ta.select();
};
count();
</script></body></html>
`;

fs.writeFileSync(path.join(ROOT, 'game/public/sfx-pick.html'), html);
console.log('구움: game/public/sfx-pick.html  →  http://localhost:5180/sfx-pick.html');
console.log(`  이미 확보 ${skipped.length}종: ${skipped.join(' ')}`);
console.log(`  별칭 ${aliased.length}종: ${aliased.join(' ')}`);
console.log(`  고를 것 ${cues.length}종 · 후보 ${cues.reduce((a, c) => a + c.cands.length, 0)}개`);
if (noCand.length) console.log(`  ! 후보 미작성 ${noCand.length}종: ${noCand.join(' ')}`);
if (missing.length) { console.log(`  ! 파일 없음 ${missing.length}건:`); for (const m of missing) console.log('    ' + m); }
else console.log('  후보 파일 전부 존재');
