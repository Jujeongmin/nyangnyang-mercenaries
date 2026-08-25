// 효과음 청취 랩을 굽는다 — `node tools/gen-sfx-lab.mjs` → tools/sfx-lab.html
//
// 왜 생성기인가: 큐 목록의 단일 소스는 data/sound.json 이다 (사운드_계획.md).
// 랩에 큐를 손으로 베껴 두면 큐가 늘 때마다 두 곳이 어긋난다. 여기서 굽는다.
//
// 왜 파일이 아니라 합성(ZzFX)인가: 효과음 55종을 파일로 사면 라이선스 관리가
// 따라오고, AI 생성음은 품질 편차가 크다. ZzFX 는 **파라미터가 곧 소리**라
// 후보를 나열해 즉석 비교하고, 마음에 안 들면 숫자만 바꾸면 된다.
//
// 결과물은 **의존성 없는 HTML 한 장**이다. 더블클릭으로 열린다 — 서버가 필요하면
// 단장이 소리를 들어보는 문턱이 그만큼 높아진다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOUND = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/data/sound.json'), 'utf8'));

// ── 원형(archetype) ────────────────────────────────────────────
// ZzFX 파라미터 20개를 매번 손으로 쓰면 후보 165개를 못 만든다. 성격별 원형을
// 두고 음높이·길이만 큐에 맞춰 바꾼다. **여기 숫자는 출발점이지 정답이 아니다** —
// 고르는 건 랩에서 귀로 한다.
//
// 인자 순서(ZzFX): volume, randomness, frequency, attack, sustain, release,
//   shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime,
//   repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo
const A = {
  // 마른 톡 — 짧은 사인. UI 기본
  tick: (f, v = .5) => [v, .05, f, 0, 0, .04, 1, 1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6, .01],
  // 둔탁한 퍽 — 저역 노이즈. 근접 타격
  thud: (f, v = .6) => [v, .1, f, .01, .03, .09, 4, 1.2, -8, 0, 0, 0, 0, .6, 0, 0, .02, .5, .03],
  // 금속 챙 — 배음 많은 톱니
  clang: (f, v = .5) => [v, .08, f, 0, .02, .12, 2, 2.4, 0, 0, 0, 0, .04, .2, 0, .1, 0, .7, .02],
  // 상승 삑 — 피치 슬라이드. 크리티컬·성공
  zapUp: (f, v = .5) => [v, .04, f, .01, .05, .13, 1, 1.8, 9, 0, 0, 0, 0, 0, 0, 0, 0, .8, .04],
  // 하강 붕 — 실패·불가
  zapDn: (f, v = .5) => [v, .04, f, .01, .04, .16, 3, 1.6, -6, -.1, 0, 0, 0, .1, 0, 0, 0, .8, .05],
  // 바람 소리 — 회피·이동
  whoosh: (f, v = .45) => [v, .3, f, .05, .08, .12, 4, .8, -3, 0, 0, 0, 0, 1, 0, 0, .04, .5, .06],
  // 반짝 — 고역 짧은 반복. 획득·도감
  spark: (f, v = .45) => [v, .05, f, 0, .03, .1, 1, 2, 0, 0, 6, .02, .03, 0, 0, 0, 0, .7, .02],
  // 팡파레 — 피치 점프 두 번. 결과·레벨업
  fanfare: (f, v = .55) => [v, .03, f, .02, .12, .24, 1, 1.4, 0, 0, 7, .08, .1, 0, 0, 0, .05, .9, .1],
  // 묵직한 쾅 — 보스·최고 등급
  boom: (f, v = .65) => [v, .12, f, .02, .1, .3, 4, 1.1, -4, -.05, 0, 0, 0, .8, 0, 0, .08, .6, .12],
  // 낮은 붕 — 거부. 음이 안 오르는 게 중요하다
  buzz: (f, v = .45) => [v, .02, f, .01, .06, .1, 3, 1.2, 0, 0, 0, 0, .02, .3, 0, .2, 0, .6, .03],
  // 물방울 — 부드러운 UI
  drop: (f, v = .4) => [v, .05, f, 0, .02, .12, 1, 2.6, 5, 0, 0, 0, 0, 0, 0, 0, 0, .5, .02],
  // 종이 넘김 — 팝업·탭
  paper: (f, v = .35) => [v, .4, f, .01, .02, .06, 4, .6, 0, 0, 0, 0, 0, 1, 0, 0, 0, .4, .02],
  // 차오름 — 드럼롤·타이머
  roll: (f, v = .4) => [v, .2, f, .1, .5, .2, 4, .5, 2, .02, 0, 0, .02, .7, 0, 0, 0, .8, .3],
  // 동전 — 재화
  coin: (f, v = .45) => [v, .04, f, 0, .04, .12, 1, 1.6, 0, 0, 9, .04, .05, 0, 0, 0, 0, .8, .03],
};

// ── 큐별 후보 3안 ──────────────────────────────────────────────
// [원형, 기준 주파수] 세 벌. 성격이 서로 **다르게** 잡는다 — 비슷한 셋을 주면
// 고를 이유가 없어서 비교가 안 된다.
const PICK = {
  // UI
  sfx_tap:          [[A.tick, 900], [A.drop, 700], [A.paper, 1200]],
  sfx_tab:          [[A.tick, 620], [A.paper, 900], [A.drop, 520]],
  sfx_popup_open:   [[A.zapUp, 380], [A.paper, 700], [A.spark, 800]],
  sfx_popup_close:  [[A.zapDn, 420], [A.paper, 520], [A.tick, 380]],
  sfx_denied:       [[A.buzz, 150], [A.zapDn, 220], [A.thud, 110]],
  sfx_toggle:       [[A.tick, 1100], [A.drop, 880], [A.clang, 760]],
  // 전투
  sfx_hit_melee:    [[A.thud, 180], [A.clang, 420], [A.tick, 300]],
  sfx_hit_range:    [[A.whoosh, 500], [A.tick, 760], [A.clang, 640]],
  sfx_hit_magic:    [[A.spark, 640], [A.zapUp, 420], [A.whoosh, 380]],
  sfx_crit:         [[A.zapUp, 520], [A.clang, 880], [A.boom, 200]],
  sfx_evade:        [[A.whoosh, 700], [A.drop, 900], [A.tick, 1000]],
  sfx_counter:      [[A.clang, 560], [A.zapUp, 440], [A.thud, 260]],
  sfx_damaged:      [[A.thud, 130, .35], [A.buzz, 180, .3], [A.whoosh, 260, .3]],
  sfx_unit_death:   [[A.zapDn, 300], [A.thud, 90], [A.whoosh, 200]],
  sfx_boss_appear:  [[A.boom, 90], [A.roll, 120], [A.zapDn, 160]],
  sfx_stage_win:    [[A.fanfare, 520], [A.spark, 780], [A.zapUp, 620]],
  sfx_stage_lose:   [[A.zapDn, 260], [A.buzz, 130], [A.thud, 100]],
  // 스킬
  sfx_sk_lightning: [[A.clang, 1200], [A.zapUp, 900], [A.spark, 1400]],
  sfx_sk_fire:      [[A.whoosh, 300], [A.boom, 150], [A.thud, 220]],
  sfx_sk_pierce:    [[A.whoosh, 820], [A.tick, 1000], [A.zapUp, 700]],
  sfx_sk_ice:       [[A.spark, 1100], [A.drop, 900], [A.clang, 1300]],
  sfx_sk_slash:     [[A.whoosh, 600], [A.clang, 700], [A.tick, 540]],
  sfx_sk_buff:      [[A.zapUp, 340], [A.fanfare, 420], [A.spark, 560]],
  sfx_sk_heal:      [[A.spark, 700], [A.drop, 600], [A.zapUp, 480]],
  sfx_sk_shield:    [[A.drop, 320], [A.zapUp, 260], [A.clang, 380]],
  sfx_sk_summon:    [[A.fanfare, 300], [A.whoosh, 240], [A.spark, 480]],
  // 소환(가챠)
  sfx_summon_cast:  [[A.whoosh, 260], [A.zapUp, 200], [A.roll, 180]],
  sfx_drumroll:     [[A.roll, 100], [A.roll, 160], [A.buzz, 80]],
  sfx_grade_n:      [[A.tick, 500], [A.drop, 460], [A.paper, 600]],
  sfx_grade_r:      [[A.spark, 600], [A.zapUp, 520], [A.tick, 700]],
  sfx_grade_sr:     [[A.fanfare, 480], [A.spark, 820], [A.zapUp, 660]],
  sfx_grade_ssr:    [[A.fanfare, 620], [A.clang, 900], [A.spark, 1000]],
  sfx_grade_ur:     [[A.fanfare, 760], [A.boom, 180], [A.clang, 1100]],
  sfx_grade_lr:     [[A.boom, 140], [A.fanfare, 880], [A.roll, 200]],
  // 성장
  sfx_levelup:      [[A.fanfare, 560], [A.zapUp, 640], [A.spark, 900]],
  sfx_auto_enhance: [[A.spark, 760], [A.coin, 680], [A.zapUp, 580]],
  sfx_equip_swap:   [[A.clang, 480], [A.tick, 620], [A.drop, 540]],
  sfx_enhance:      [[A.clang, 520], [A.zapUp, 600], [A.spark, 840]],
  sfx_summon_levelup: [[A.fanfare, 500], [A.spark, 720], [A.zapUp, 560]],
  sfx_grade_unlock: [[A.fanfare, 700], [A.boom, 200], [A.spark, 1000]],
  sfx_codex_new:    [[A.spark, 880], [A.tick, 760], [A.drop, 640]],
  // 재화
  sfx_gold:         [[A.coin, 720], [A.spark, 840], [A.tick, 900]],
  sfx_diamond:      [[A.spark, 1200], [A.coin, 980], [A.drop, 1100]],
  sfx_dismantle:    [[A.thud, 240], [A.clang, 360], [A.whoosh, 300]],
  sfx_claim:        [[A.coin, 640], [A.fanfare, 520], [A.spark, 780]],
  sfx_purchase:     [[A.coin, 560], [A.fanfare, 440], [A.clang, 620]],
  // 알림
  sfx_badge:        [[A.tick, 1000], [A.drop, 860], [A.spark, 1100]],
  sfx_quest_done:   [[A.fanfare, 600], [A.spark, 820], [A.zapUp, 700]],
  sfx_timer_done:   [[A.spark, 940], [A.tick, 820], [A.drop, 700]],
  sfx_mail:         [[A.drop, 760], [A.tick, 640], [A.paper, 820]],
  // 던전·아레나
  sfx_dungeon_enter:[[A.boom, 110], [A.whoosh, 200], [A.roll, 140]],
  sfx_floor_clear:  [[A.zapUp, 580], [A.spark, 760], [A.fanfare, 500]],
  sfx_arena_match:  [[A.roll, 150], [A.whoosh, 280], [A.clang, 420]],
  sfx_arena_win:    [[A.fanfare, 640], [A.spark, 880], [A.zapUp, 720]],
  sfx_arena_lose:   [[A.zapDn, 240], [A.buzz, 140], [A.thud, 120]],
};

// 후보가 안 적힌 큐는 그룹 기본값으로 떨어진다 — 큐가 늘어도 랩이 안 깨진다
const GROUP_FALLBACK = {
  ui: [[A.tick, 800], [A.drop, 640], [A.paper, 1000]],
  combat: [[A.thud, 200], [A.clang, 480], [A.whoosh, 560]],
  skill: [[A.spark, 800], [A.whoosh, 420], [A.zapUp, 620]],
  gacha: [[A.fanfare, 560], [A.spark, 820], [A.roll, 160]],
  growth: [[A.fanfare, 520], [A.spark, 760], [A.zapUp, 600]],
  currency: [[A.coin, 700], [A.spark, 860], [A.tick, 900]],
  notify: [[A.tick, 960], [A.drop, 800], [A.spark, 1080]],
  dungeonArena: [[A.boom, 120], [A.whoosh, 260], [A.fanfare, 620]],
};

const cues = [];
for (const [group, arr] of Object.entries(SOUND.sfx)) {
  for (const c of arr) {
    const picks = PICK[c.id] || GROUP_FALLBACK[group] || GROUP_FALLBACK.ui;
    cues.push({
      group, id: c.id, nameKo: c.nameKo, priority: c.priority,
      note: c.note || '', variations: c.variations || 1,
      tuned: !!PICK[c.id],
      cands: picks.map(([fn, f, v]) => fn(f, v)),
    });
  }
}

const RULES = SOUND.playbackRules;
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>냥냥 용병단 — 효과음 청취 랩</title>
<style>
  :root{--bg:#15100c;--card:#241a12;--line:#3a2c20;--txt:#f2e5db;--dim:#a8907d;--gold:#ffc94a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);
    font-family:"Malgun Gothic",system-ui,sans-serif;font-size:14px}
  header{position:sticky;top:0;z-index:2;background:#1d150fee;backdrop-filter:blur(6px);
    border-bottom:1px solid var(--line);padding:14px 18px}
  h1{margin:0 0 4px;font-size:17px;color:var(--gold)}
  .sub{font-size:12px;color:var(--dim);line-height:1.6}
  .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
  button{font-family:inherit;font-size:13px;cursor:pointer;border-radius:8px;
    border:1px solid var(--line);background:var(--card);color:var(--txt);padding:7px 12px}
  button:hover{border-color:var(--gold)}
  button.on{background:var(--gold);color:#2a1c05;border-color:var(--gold);font-weight:700}
  main{padding:14px 18px 80px;max-width:1100px;margin:0 auto}
  .grp{margin:22px 0 8px;font-size:13px;color:var(--gold);letter-spacing:1px}
  .cue{display:grid;grid-template-columns:230px 1fr;gap:12px;align-items:start;
    background:var(--card);border:1px solid var(--line);border-radius:10px;
    padding:10px 12px;margin-bottom:7px}
  .cue.hide{display:none}
  .meta b{display:block;font-size:14px}
  .meta code{font-size:11px;color:var(--dim)}
  .meta .p{display:inline-block;font-size:10px;font-weight:800;border-radius:5px;
    padding:1px 6px;margin-top:4px}
  .p0{background:#7a2b2b;color:#ffd9d9}.p1{background:#3a4a7a;color:#dce6ff}
  .p2{background:#3a3a3a;color:#ccc}
  .note{font-size:11px;color:var(--dim);margin-top:5px;line-height:1.5}
  .gen{font-size:10px;color:#8a7563;margin-top:4px}
  .cands{display:flex;gap:7px;flex-wrap:wrap}
  .cands button{min-width:92px}
  .cands button.sel{background:#2f4a2f;border-color:#5ad86a;color:#d8ffd8}
  footer{position:fixed;left:0;right:0;bottom:0;background:#1d150ff2;
    border-top:1px solid var(--line);padding:10px 18px;display:flex;gap:10px;
    align-items:center;flex-wrap:wrap}
  #out{flex:1;min-width:200px;font-size:11px;color:var(--dim)}
  textarea{width:100%;height:200px;background:#0f0b08;color:var(--txt);
    border:1px solid var(--line);border-radius:8px;padding:10px;font-family:monospace;
    font-size:11px;margin-top:10px}
</style></head><body>
<header>
  <h1>효과음 청취 랩 — 냥냥 용병단</h1>
  <div class="sub">
    큐 ${cues.length}종 × 후보 3안. 버튼을 눌러 듣고, 마음에 드는 것을 고르면 아래 [내보내기]로
    <code>sfx-params.json</code> 을 만든다. 게임은 그 파일을 읽으므로 <b>소리 교체에 코드 수정이 없다</b>.<br>
    동시 ${RULES.maxConcurrentSfx}개 · 같은 큐 ${RULES.minIntervalPerCueMs}ms 간격 규칙은 게임 재생기(core/sfx.js)가 지킨다 — 여기서는 누를 때마다 그냥 난다.
  </div>
  <div class="bar">
    <span class="sub">보기:</span>
    <button data-f="all" class="on">전체</button>
    <button data-f="P0">P0만</button>
    <button data-f="P1">P1만</button>
    <button data-f="P2">P2만</button>
    <button data-f="untuned">그룹 기본값만</button>
    <span class="sub" style="margin-left:auto">볼륨</span>
    <input id="vol" type="range" min="0" max="100" value="60">
  </div>
</header>
<main id="list"></main>
<footer>
  <button id="exp">내보내기 (sfx-params.json)</button>
  <button id="pickAll">고른 것 없으면 1안으로 채우기</button>
  <span id="out">고른 큐 0 / ${cues.length}</span>
</footer>
<script>
// ── ZzFX (MIT, Frank Force) — 파라미터가 곧 소리인 초소형 합성기 ──
let zzfxV=.3, ZC;
function zzfx(...t){return zzfxP(zzfxG(...t))}
function zzfxP(...t){if(!ZC)ZC=new(window.AudioContext||window.webkitAudioContext);
  let e=ZC.createBufferSource(),f=ZC.createBuffer(t.length,t[0].length,44100);
  t.map((d,i)=>f.getChannelData(i).set(d)),e.buffer=f,e.connect(ZC.destination),e.start();return e}
function zzfxG(q=1,k=.05,c=220,e=0,t=0,u=.1,r=0,F=1,v=0,z=0,w=0,A=0,l=0,B=0,x=0,G=0,d=0,y=1,m=0,C=0){
  let b=2*Math.PI,H=v*=500*b/44100**2,I=(0<F?1:-1)*b/4,D=c*=(1+2*k*Math.random()-k)*b/44100,
  Z=[],g=0,E=0,a=0,n=1,J=0,K=0,f=0,p,h;
  e=99+44100*e;m*=44100;t*=44100;u*=44100;d*=44100;z*=500*b/44100**3;G*=b/44100;w*=b/44100;
  A*=44100;l=44100*l|0;
  for(h=e+m+t+u+d|0;a<h;Z[a++]=f)
    ++K%(100*G|0)||(f=r?1<r?2<r?3<r?Math.sin((g%b)**3):Math.max(Math.min(Math.tan(g),1),-1):
      1-(2*g/b%2+2)%2:1-4*Math.abs(Math.round(g/b)-g/b):Math.sin(g),
    f=(l?1-C+C*Math.sin(2*Math.PI*a/l):1)*(0<f?1:-1)*Math.abs(f)**F*q*zzfxV*
      (a<e?a/e:a<e+m?1-((a-e)/m)*(1-y):a<e+m+t?y:a<h-d?(h-a-d)/u*y:0),
    f=d?f/2+(d>a?0:(a<h-d?1:(h-a)/d)*Z[a-d|0]/2):f),
    p=(c+=v+=z)*Math.cos(I*E++),g+=p+p*B*Math.sin(a**5),
    n&&++n>A&&(c+=w,D+=w,n=0),
    !l||++J%l||(c=D,v=H,n=n||1);
  return Z}
// ── 랩 ──
const CUES=${JSON.stringify(cues)};
const RULES=${JSON.stringify(RULES)};
// ── 후보 음량 맞추기 ────────────────────────────────────────────
// 원형마다 진폭이 크게 달랐다. 저역·하강 계열(둔탁한 퍽·낮은 붕·묵직한 쾅)은
// 피크가 0.003 까지 떨어지는데 고역 계열은 0.15 에 붙는다 — **50배 차이라
// 나란히 놓고 들으면 조용한 쪽은 "안 난다" 로 읽힌다.** 성격이 아니라 음량 때문에
// 후보가 탈락하면 비교의 의미가 없으므로, 파형을 미리 재서 첫 인자(volume)로
// 피크를 맞춘다. **고른 값이 그대로 내보내진다** — 게임에서도 같은 크기로 난다.
const TARGET_PEAK=.14;
for(const c of CUES) c.cands=c.cands.map(p=>{
  const pk=Math.max(...zzfxG(...p).map(Math.abs));
  if(!(pk>0)) return p;                       // 무음이면 건드리지 않는다(그대로 드러나야 한다)
  const q=p.slice();
  q[0]=+Math.min(12, q[0]*TARGET_PEAK/pk).toFixed(3);  // 12배 상한. 게인일 뿐이라 클리핑은 안 난다(목표 피크가 0.14)
  return q;
});
const GROUP_KO={ui:'UI',combat:'전투',skill:'스킬',gacha:'소환',growth:'성장',currency:'재화',notify:'알림',dungeonArena:'던전·아레나'};
const sel={};
const list=document.getElementById('list');
let cur='';
for(const c of CUES){
  if(c.group!==cur){cur=c.group;const h=document.createElement('div');h.className='grp';
    h.textContent=(GROUP_KO[c.group]||c.group)+' — '+CUES.filter(x=>x.group===c.group).length+'종';list.append(h)}
  const row=document.createElement('div');row.className='cue';row.dataset.p=c.priority;row.dataset.tuned=c.tuned?'1':'0';
  row.innerHTML='<div class="meta"><b>'+c.nameKo+'</b><code>'+c.id+'</code>'
    +'<span class="p '+c.priority.toLowerCase()+'">'+c.priority+'</span>'
    +(c.variations>1?' <span class="gen">변주 '+c.variations+'종</span>':'')
    +(c.note?'<div class="note">'+c.note+'</div>':'')
    +(c.tuned?'':'<div class="gen">그룹 기본값 — 성격을 따로 안 잡았다</div>')
    +'</div><div class="cands"></div>';
  const box=row.querySelector('.cands');
  c.cands.forEach((p,i)=>{
    const b=document.createElement('button');b.textContent=(i+1)+'안';
    b.onclick=()=>{zzfx(...p);sel[c.id]=i;
      box.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));
      b.classList.add('sel');count()};
    box.append(b);
  });
  list.append(row);
}
function count(){document.getElementById('out').textContent='고른 큐 '+Object.keys(sel).length+' / '+CUES.length}
document.getElementById('vol').oninput=e=>zzfxV=e.target.value/100*.5;
zzfxV=.3;
document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  const f=b.dataset.f;
  document.querySelectorAll('.cue').forEach(r=>{
    const ok=f==='all'||(f==='untuned'?r.dataset.tuned==='0':r.dataset.p===f);
    r.classList.toggle('hide',!ok);
  });
});
document.getElementById('pickAll').onclick=()=>{
  for(const c of CUES) if(sel[c.id]==null) sel[c.id]=0;
  document.querySelectorAll('.cue').forEach(r=>{
    const b=r.querySelector('.cands button');
    if(!r.querySelector('.cands button.sel')) b.classList.add('sel');
  });
  count();
};
document.getElementById('exp').onclick=()=>{
  const out={meta:{note:'tools/gen-sfx-lab.mjs 로 구운 랩에서 고른 결과. game/public/data/ 에 sfx-params.json 으로 저장한다.',
    generated:'수동 저장'},params:{}};
  for(const c of CUES){const i=sel[c.id];if(i==null)continue;out.params[c.id]=c.cands[i]}
  const ta=document.createElement('textarea');ta.value=JSON.stringify(out,null,2);
  document.querySelector('main').prepend(ta);ta.select();
  alert('아래 상자의 내용을 game/public/data/sfx-params.json 으로 저장하세요.\\n고른 큐: '+Object.keys(out.params).length+'개');
};
count();
</script></body></html>
`;

const OUT = path.join(ROOT, 'tools/sfx-lab.html');
fs.writeFileSync(OUT, html);
const tuned = cues.filter(c => c.tuned).length;
console.log(`구움: tools/sfx-lab.html`);
console.log(`  큐 ${cues.length}종 · 후보 ${cues.length * 3}개`);
console.log(`  성격 지정 ${tuned}종 · 그룹 기본값 ${cues.length - tuned}종`);
