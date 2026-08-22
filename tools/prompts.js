// 에셋_생성_프롬프트.md 의 ID 표를 읽어 GPT 프롬프트를 조립한다.
//   node tools/prompts.js
// 출력: prompts/<분류>/<ID>.txt · prompts/전체.md · prompts/남은작업.md
//
// ⚠️ 방향 규칙이 v2 에서 바뀌었다.
//    구 프롬프트는 "front-facing 3/4 view" 라 캐릭터가 정면을 봤다. 그러면 무기가
//    몸 왼쪽에 그려지고, 전투는 오른쪽으로 진행하므로 무기 팔을 반전시켜야 한다.
//    반전하면 몸통에 남은 팔뚝은 왼쪽, 무기는 오른쪽으로 갈라져 어색해진다.
//    그래서 **전부 오른쪽을 보게** 뽑는다. 적은 게임이 facing:-1 로 뒤집으므로
//    적도 오른쪽 기준이다. 왼쪽으로 뽑으면 두 번 뒤집힌다.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, '에셋_생성_프롬프트.md'), 'utf8').replace(/\r/g, '');

// --- 마크다운 표 파서 ---
function rows(headerRe, cols) {
  const out = [];
  let on = false;
  for (const ln of SRC.split('\n')) {
    if (headerRe.test(ln)) { on = true; continue; }
    if (!on) continue;
    if (!ln.startsWith('|')) { if (ln.trim() === '') continue; on = false; continue; }
    const c = ln.split('|').slice(1, -1).map(s => s.trim());
    if (!c.length || c[0] === 'ID' || /^:?-+:?$/.test(c[0])) continue;
    const o = {};
    cols.forEach((k, i) => { o[k] = (c[i] || '').replace(/`/g, '').replace(/🆕/g, '').trim(); });
    if (o.id) out.push(o);
  }
  return out;
}
const pick = (list, re) => list.filter(r => re.test(r.id));

// ─────────────────────────────────────────────
// 캐릭터 계열
// ─────────────────────────────────────────────

// 4절 스타일 앵커
const STYLE = `Cute chibi mascot character for a mobile gacha RPG. Super-deformed proportions
(2 heads tall), big expressive eyes, tiny body, rounded soft shapes. Thick clean
dark outlines, flat cel shading with a soft rim light from the upper left,
vibrant saturated color palette. Clean vector-like finish, mobile game asset quality.
No text, no watermark, no signature, no border, no ground shadow.
Transparent background.`;

// ⭐ v2 방향 규칙.
//    바꾸는 건 **무기가 놓이는 쪽뿐**이다. 몸을 옆으로 돌리면 안 된다 —
//    정면 3/4 를 잃으면 얼굴이 안 보여 수집 매력이 죽는다.
//    좌우는 "이미지 기준"으로만 말한다. "캐릭터의 오른손" 은 GPT 가 반대로 해석한다.
const FACING = `IMPORTANT - weapon side:
Keep the standard front-facing 3/4 view. The body, head and face stay turned toward
the VIEWER. Do NOT draw a side profile. Do NOT turn the character away from the viewer.

The ONLY change is where the weapon goes:
- The weapon must be on the RIGHT SIDE OF THE IMAGE, held by the arm on the right,
  extended out to the right with a clear visible gap between that arm and the torso.
- The shield, off-hand or free hand goes on the LEFT SIDE OF THE IMAGE.
- The weapon must not cross in front of the body or overlap the torso.

Full body, feet visible, centered with even margins.`;

const GRADE = {
  N: 'Very simple plain outfit, cloth and wood gear, muted earthy colors, no glow.',
  R: 'Simple leather gear with small metal accents, one accent color, faint soft glow.',
  SR: 'Polished steel armor pieces, a small cape or scarf, blue-cyan magical glow around the hands.',
  SSR: 'Ornate gold-trimmed armor, flowing cape, floating magical runes, purple-violet aura, small glowing particles.',
  UR: 'Divine ornate armor with intricate filigree, large flowing cape, radiant golden aura, orbiting light orbs, dramatic energy wisps, glowing eyes.',
  LR: 'Legendary cosmic armor made of starlight and crystal, enormous flowing ethereal cape, rainbow prismatic aura, orbiting constellations and galaxy particles, blazing glowing eyes, overwhelming divine presence.',
};

const ELEM = {
  '불': 'Fire element: dominant red-orange color scheme, small flame accents.',
  '물': 'Water element: dominant blue-cyan color scheme, water droplet accents.',
  '풀': 'Nature element: dominant green color scheme, leaf and vine accents.',
  '빛': 'Light element: dominant white-gold color scheme, holy halo accents.',
  '암': 'Dark element: dominant purple-black color scheme, shadow wisp accents.',
};

// 무기를 드는 손을 v2 방향 규칙에 맞춰 못 박는다
const CLASS = {
  '전사': 'Warrior class: sword on the RIGHT SIDE OF THE IMAGE, blade angled up and to the right, clearly away from the body. Small round shield on the LEFT SIDE OF THE IMAGE. Sturdy grounded stance, heavier armor.',
  '궁수': 'Archer class: bow on the RIGHT SIDE OF THE IMAGE, arm extended to the right, bowstring drawn back toward the chest. Quiver on the back standing clear of the body. Light agile stance.',
  '마법사': 'Mage class: magic staff held upright on the RIGHT SIDE OF THE IMAGE, arm extended right with a clear gap from the body. Pointed wizard hat and a robe that does not wrap the arms. Free hand on the LEFT SIDE OF THE IMAGE.',
};

const MONSTER = `Cute but slightly menacing monster for a mobile gacha RPG. Chibi proportions,
thick clean dark outlines, flat cel shading, vibrant colors.
Full body, centered, transparent background. No text, no watermark, no ground shadow.

IMPORTANT - weapon side:
Keep the standard front-facing 3/4 view. The body and face stay turned toward the VIEWER.
Do NOT draw a side profile.
If it holds a weapon or has a dominant limb, that weapon or limb must be on the
LEFT SIDE OF THE IMAGE, extended to the left with a clear gap from the body.
(Monsters stand on the right side of the battle and attack toward the left,
so their weapon side is the mirror of the heroes'.)`;

const BOSS = MONSTER.replace(
  'Cute but slightly menacing monster for a mobile gacha RPG. Chibi proportions,',
  'Boss monster for a mobile gacha RPG. Imposing, large, bulky and intimidating but still chibi-stylized. Glowing eyes, dramatic aura.'
);

// ─────────────────────────────────────────────
// UI · 아이콘 계열 (방향 무관)
// ─────────────────────────────────────────────
const T = {
  skill: `Mobile game skill icon. Single centered symbol, cute stylized cartoon style,
thick clean dark outlines, flat cel shading, vibrant saturated colors,
strong glow effect. Square 1:1 composition, symbol fills the frame with a
small even margin. Simple dark radial-gradient circular backdrop behind the symbol.
The circular backdrop must be a CLIPPED DISC on a fully transparent background —
the four corners outside the circle must be 100% transparent alpha, not black.
PNG with alpha channel. No square background plate.
No text, no border frame, no watermark.`,
  equip: `Mobile game equipment item icon. Single object, cute stylized cartoon style,
thick clean dark outlines, flat cel shading, vibrant colors, subtle glow.
Centered, 3/4 angled view, square 1:1 composition.
Transparent background. No text, no frame, no background, no shadow.`,
  frame: `Mobile game rarity frame border. Square ornate frame with a completely empty
transparent center. Cute stylized cartoon style, thick clean outlines, glowing edges.
Transparent background. No text, nothing inside the frame.`,
  frameEquip: `Mobile game rarity frame border. Square ornate frame, empty transparent center.
Cute stylized cartoon style, thick clean outlines.
COMPLETELY DESATURATED - pure greyscale/white only, no color hue whatsoever
(the game applies color at runtime). Glow rendered as white.
Transparent background. No text, nothing inside the frame.`,
  currency: `Mobile game currency icon. Single object, cute stylized cartoon style,
thick outlines, flat shading, vibrant colors, strong glow. Centered,
square 1:1 composition. Transparent background. No text.`,
  altar: `Mobile game gacha summoning altar background. Vertical 2:3 composition,
cute stylized cartoon fantasy style, dramatic magical lighting.
A glowing magic circle on the floor in the center, with an empty middle area
where the summoned character will appear. No characters, no text.`,
  forge: `Mobile game blacksmith forge scene. Cute stylized cartoon style, side view,
centered composition, warm firelight. No characters, no text.`,
  summonFx: `Vertical 2:3 mobile game gacha reveal background effect. A radiating burst of
light from the center with a completely empty center area where the character
will be composited. Dramatic and celebratory.
Transparent background. No characters, no text.`,
  passiveFx: `Mobile game combat hit effect. Cute stylized cartoon style, bold shapes,
strong glow, high contrast. Square 1:1 composition, centered.
Transparent background. No characters, no text.`,
  sideIcon: `Mobile game UI button icon. Single centered object, cute stylized cartoon style,
thick clean dark outlines, flat cel shading, vibrant colors, subtle glow.
Square 1:1 composition, object fills the frame with a small even margin.
Transparent background. No text, no frame, no background, no shadow.`,

  projectile: `Mobile game projectile sprite, side view, travelling to the RIGHT.
Head of the projectile points right, motion trail streaming left behind it.
Cute stylized cartoon style, thick clean dark outlines, bright saturated core
with a soft outer glow. Horizontal 2:1 composition, object fills the frame.
Transparent background. No text, no frame, no background, no shadow.`,

  uiKit: `Mobile game UI asset, cute stylized cartoon fantasy style matching an orange tabby cat
mercenary RPG. Warm dark navy base with aged brass and gold trim, subtle wood grain,
thick clean dark outlines, flat cel shading with one soft inner highlight.
Straight-on flat view, no perspective. Transparent background. No text, no letters,
no numbers, no icons, no characters, no drop shadow outside the shape.`,

  forgeObj: `Mobile game interactive object, three-quarter front view, cute stylized cartoon fantasy style,
thick clean dark outlines, flat cel shading, vibrant colors, warm rim light.
Single object centered, standing on nothing. 4:3 composition, object fills the frame.
Transparent background. No text, no frame, no ground, no background, no shadow.`,

  chest: `Mobile game UI icon. Single centered object, cute stylized cartoon style,
thick clean dark outlines, flat cel shading, vibrant colors.
Square 1:1 composition, object fills the frame with a small even margin.
Transparent background. No text, no frame, no background, no shadow.`,

  dungeonKey: `Mobile game currency icon. A single ornate antique key, cute stylized cartoon style,
thick clean dark outlines, flat cel shading, vibrant colors, soft inner glow.
Square 1:1 composition, key placed diagonally filling the frame.
Transparent background. No text, no frame, no background, no shadow.`,
  battleFx: `Mobile game combat VFX, single peak frame of the effect at its most intense moment.
Bold graphic shapes, strong outer glow, high contrast, vibrant saturated colors,
semi-transparent energy with bright white-hot core.
Square 1:1 composition, radiating outward from center.
Transparent background. No characters, no weapons, no text, no background.
Designed to be scaled up and faded out by code - draw only the climax frame.`,
};

// ─────────────────────────────────────────────
// 표 수집
// ─────────────────────────────────────────────
const chars = [];
for (const g of ['N', 'R', 'SR', 'SSR', 'UR', 'LR']) {
  rows(new RegExp('^### ' + g + ' 등급'), ['id', 'name', 'cls', 'elem', 'subject'])
    .forEach(r => chars.push({ ...r, grade: g }));
}
const nameSub = rows(/^\| ID \| 이름 \| Subject \|$/, ['id', 'name', 'subject']);
const enemies = pick(nameSub, /^E-\d\d$/);
const bosses = rows(/^\| ID \| 이름 \| Subject \| 등장 \|$/, ['id', 'name', 'subject', 'stage']);
const idEffect = rows(/^\| ID \| 등급 \| Effect \|$/, ['id', 'name', 'effect']);

// 단장 3형태 — characters.json > captain (구 R-01 을 승격)
const CAP_SAME = `the same orange tabby cat with white chest fur and a confident smirk
as the anchor image - identical face, fur pattern, and proportions.
Only the gear and pose change with the class.`;
const captains = [
  { id: 'captain_warrior', name: '검사 단장', cls: '전사',
    subject: `an orange tabby cat warrior commander with white chest fur, wearing a brown leather vest with steel shoulder and knee plates and a red neck scarf. ${CAP_SAME}` },
  { id: 'captain_archer', name: '사수 단장', cls: '궁수', subject: CAP_SAME },
  { id: 'captain_mage', name: '술사 단장', cls: '마법사', subject: CAP_SAME },
];

const charBody = c => [
  STYLE, '', FACING, '',
  GRADE[c.grade], '',
  ELEM[c.elem] || '', '',
  CLASS[c.cls] || '', '',
  'Subject: ' + c.subject,
].join('\n');

const SETS = [
  ['captain', captains, c => [STYLE, '', FACING, '', GRADE.R, '', ELEM['불'], '',
    CLASS[c.cls], '', 'Subject: ' + c.subject].join('\n')],
  ['char', chars, charBody],
  ['enemy', enemies, e => `${MONSTER}\n\nSubject: ${e.subject}`],
  ['boss', bosses, b => `${BOSS}\n\nSubject: ${b.subject}`],

  ['skill', pick(nameSub, /^SK-[AP]\d\d$/), r => `${T.skill}\n\nSubject: ${r.subject}`],
  ['equip', rows(/^\| ID \| 부위 \| 밴드 \| Subject \|$/, ['id', 'name', 'band', 'subject']),
    r => `${T.equip}\n\nSubject: ${r.subject}`],
  ['frame', [
    ...rows(/^\| ID \| 등급 \| Style \|$/, ['id', 'name', 'style'])
      .map(r => ({ ...r, body: `${T.frame}\n\nStyle: ${r.style}` })),
    ...rows(/^\| ID \| 장식 단계 \| 적용 등급 \| Ornamentation \|$/, ['id', 'name', 'tiers', 'orn'])
      .map(r => ({ ...r, body: `${T.frameEquip}\n\nOrnamentation: ${r.orn}` })),
  ], r => r.body],
  ['currency', rows(/^\| ID \| 재화 \| 용도 \| Subject \|$/, ['id', 'name', 'use', 'subject']),
    r => `${T.currency}\n\nSubject: ${r.subject}`],
  ['altar', rows(/^\| ID \| 트랙 \| Subject \|$/, ['id', 'name', 'subject']),
    r => `${T.altar}\n\nSubject: ${r.subject}`],
  ['forge', rows(/^\| ID \| 단계 \| Subject \| 구간 \|$/, ['id', 'name', 'subject', 'range']),
    r => `${T.forge}\n\nSubject: ${r.subject}`],
  ['summonfx', pick(idEffect, /^FX-/), r => `${T.summonFx}\n\nEffect: ${r.effect}`],
  ['passivefx', rows(/^\| ID \| 직군 \| Effect \|$/, ['id', 'name', 'effect']),
    r => `${T.passiveFx}\n\nEffect: ${r.effect}`],
  ['sideicon', rows(/^\| ID \| 기능 \| Subject \|$/, ['id', 'name', 'subject']),
    r => `${T.sideIcon}\n\nSubject: ${r.subject}`],
  ['projectile', rows(/^\| ID \| 쏘는 적 \| Subject \|$/, ['id', 'name', 'subject']),
    r => `${T.projectile}

Subject: ${r.subject}`],
  ['uikit', rows(/^\| ID \| 용도 \| 9-slice \| Subject \|$/, ['id', 'name', 'nine', 'subject']),
    r => `${T.uiKit}\n\nSubject: ${r.subject}${r.nine === 'O' ? '\n\nMust tile as a 9-slice: the center area is a flat plain field, all ornament stays in the corners and edges.' : ''}`],
  ['forgeobj', rows(/^\| ID \| 단계 \| 구간 \| Subject \|$/, ['id', 'name', 'range', 'subject']),
    r => `${T.forgeObj}

Subject: ${r.subject}`],
  ['chest', rows(/^\| ID \| 단계 \| 조건 \| Subject \|$/, ['id', 'name', 'cond', 'subject']),
    r => `${T.chest}\n\nSubject: ${r.subject}`],
  ['dungeonkey', rows(/^\| ID \| 던전 \| Subject \|$/, ['id', 'name', 'subject']),
    r => `${T.dungeonKey}\n\nSubject: ${r.subject}`],
  ['battlefx', [
    ...rows(/^\| ID \| 용도 \| Effect \|$/, ['id', 'name', 'effect']),
    ...rows(/^\| ID \| 스킬 \| Effect \|$/, ['id', 'name', 'effect']),
  ], r => `${T.battleFx}\n\nEffect: ${r.effect}`],
];

const ASSET_DIR = {
  captain: 'captain', char: 'char', enemy: 'enemy', boss: 'boss',
  skill: 'skill', equip: 'equip', frame: 'ui', currency: 'ui', altar: 'ui',
  forge: 'ui', sideicon: 'ui', chest: 'ui', forgeobj: 'ui', uikit: 'ui', projectile: 'fx', dungeonkey: 'ui', summonfx: 'fx', passivefx: 'fx', battlefx: 'fx',
};
const has = (cat, id) => fs.existsSync(path.join(ROOT, 'game/public/assets', ASSET_DIR[cat], id + '.png'));

// 방향 규칙이 바뀌어 다시 뽑아야 하는 분류
// 몹·보스는 원화가 이미 오른손잡이(무기가 이미지 왼쪽)라 다시 뽑을 이유가 없다.
// 유지 확정. 용병·단장만 v2 규칙 대상이었다.
const REDO = new Set(['captain', 'char']);

let md = '# GPT 프롬프트 (자동 생성)\n\n'
  + '> `node tools/prompts.js` 로 재생성한다. 이 파일이 아니라 `tools/prompts.js` 를 고쳐라.\n'
  + '> 개별 항목은 `prompts/<분류>/<ID>.txt` 에 있다.\n\n'
  + '## ⚠️ v2 방향 규칙\n\n'
  + '캐릭터·몹·보스는 **전부 오른쪽을 보게** 뽑는다. 무기는 **화면 오른쪽, 가까운 손**에.\n\n'
  + '- 정면 3/4 로 뽑으면 무기가 몸 왼쪽에 그려진다. 전투는 오른쪽으로 진행하므로 무기 팔을\n'
  + '  반전해야 하고, 반전하면 몸통에 남은 팔뚝은 왼쪽·무기는 오른쪽으로 갈라져 어색해진다.\n'
  + '- 적도 오른쪽 기준이다. 게임이 `facing:-1` 로 뒤집으므로 왼쪽으로 뽑으면 두 번 뒤집힌다.\n'
  + '- 팔과 몸통 사이에 **배경이 보이는 틈**이 있어야 컷아웃(무기 팔 분리)이 된다.\n\n'
  + '**재생성 대상: captain / char / enemy / boss** — 나머지(아이콘·프레임·이펙트)는 방향과 무관하다.\n';

let todo = '# 남은 에셋\n\n'
  + '> `node tools/prompts.js` 가 `assets/` 를 훑어 자동 생성한다.\n'
  + '> ♻️ 는 파일은 있지만 **v2 방향 규칙으로 다시 뽑아야 하는 것**이다.\n';
// v2 방향 규칙(용병=왼손잡이/몹=오른손잡이)이 확정된 시각.
// 이보다 오래된 파일만 재생성 대상이다. 카테고리 통째로 표시하면
// 이미 다시 뽑은 것까지 남은 일로 세어 진행 상황을 못 본다.
const V2_AT = Date.parse('2026-08-20T15:00:00+09:00');
const isOld = (cat, id) => {
  const f = path.join(ROOT, 'game/public/assets', ASSET_DIR[cat], id + '.png');
  try { return fs.statSync(f).mtimeMs < V2_AT; } catch { return false; }
};

let total = 0, missing = 0, redo = 0;

for (const [cat, list, fn] of SETS) {
  const dir = path.join(ROOT, 'prompts', cat);
  fs.mkdirSync(dir, { recursive: true });
  md += `\n---\n\n# ${cat} (${list.length})\n`;
  const left = [];
  for (const it of list) {
    const body = fn(it);
    fs.writeFileSync(path.join(dir, it.id + '.txt'), body + '\n');
    const done = has(cat, it.id);
    const needRedo = done && REDO.has(cat) && isOld(cat, it.id);
    md += `\n## ${it.id} — ${it.name}${needRedo ? ' ♻️' : done ? ' ✅' : ''}\n\n\`\`\`\n${body}\n\`\`\`\n`;
    if (!done) { left.push(['[ ]', it]); missing++; }
    else if (needRedo) { left.push(['♻️', it]); redo++; }
    total++;
  }
  todo += `\n## ${cat} — ${left.length} / ${list.length}\n\n`;
  for (const [mark, it] of left) {
    todo += `- ${mark} \`${it.id}\` ${it.name} → \`game/public/assets/${ASSET_DIR[cat]}/${it.id}.png\`\n`;
  }
}

fs.writeFileSync(path.join(ROOT, 'prompts', '전체.md'), md);
fs.writeFileSync(path.join(ROOT, 'prompts', '남은작업.md'), todo);

console.log(`프롬프트 ${total}개  →  prompts/`);
console.log(`  없음 ${missing}개 / 방향 재생성 ${redo}개  →  prompts/남은작업.md`);
for (const [cat, list] of SETS) {
  const n = list.filter(it => !has(cat, it.id)).length;
  // 파일 시각까지 봐야 실제 남은 개수가 나온다
  const r = REDO.has(cat) ? list.filter(it => has(cat, it.id) && isOld(cat, it.id)).length : 0;
  console.log(`  ${cat.padEnd(10)} ${String(list.length).padStart(2)}개`
    + (n ? `  없음 ${n}` : '') + (r ? `  ♻️ ${r}` : ''));
}
