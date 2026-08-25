// 효과음 재생기.
//
// 규칙의 단일 소스는 `data/sound.json > playbackRules` 다. 이 파일은 그것을
// 코드로 옮긴 것뿐이고, 숫자를 바꾸고 싶으면 데이터를 고친다.
//
// **소리는 게임을 막지 않는다.** 파일이 없든 형식을 못 읽든 브라우저가 막든,
// 전부 조용히 넘어간다 — 소리 하나 때문에 전투가 멈추면 그게 더 큰 사고다.

const BASE = '/assets/sfx/';

/** 큐 → { 파일명, 들리는 길이(ms) }. data/sfx-manifest.json 이 준다 */
let manifest = new Map();      // id → [{url, ms}, ...]  (변주가 있으면 여럿)
let alias = new Map();         // id → 대상 id
let folded = new Set();        // sfx_tap 으로 통일된 id
let rules = {
  maxConcurrentSfx: 8,
  minIntervalPerCueMs: 60,
};

let volume = 0.9;              // 0~1. 설정 화면의 효과음 슬라이더
let enabled = true;            // 백그라운드면 false
let unlocked = false;          // 첫 사용자 입력 전에는 브라우저가 막는다

const lastAt = new Map();      // id → 마지막 재생 시각(ms)
const playing = new Set();     // 지금 울리고 있는 Audio
const varIdx = new Map();      // id → 다음에 쓸 변주 번호
const cache = new Map();       // url → Audio (원본. 재생은 복제본으로 한다)

/**
 * sound.json 을 읽어 재생기를 세운다. 실패해도 게임은 그대로 돈다.
 * @param D  로드된 데이터 묶음 (D.sound 를 쓴다)
 * @param opt.volume 0~1
 */
export function initSfx(D, opt = {}) {
  const S = D?.sound;
  if (!S) return;
  rules = { ...rules, ...(S.playbackRules || {}) };
  if (typeof opt.volume === 'number') volume = opt.volume;

  const man = D?.sfxManifest?.cues || {};
  for (const arr of Object.values(S.sfx || {})) {
    for (const c of arr) {
      if (c.aliasOf) { alias.set(c.id, c.aliasOf); continue; }
      // 변주가 있으면 sfx_hit_melee · sfx_hit_melee2 …
      const n = c.variations || 1;
      const list = [];
      for (let i = 1; i <= n; i++) {
        const id = c.id + (i > 1 ? i : '');
        const m = man[id];
        if (!m) continue;                    // 매니페스트에 없으면 그 큐는 조용하다
        list.push({ url: BASE + m.f, ms: m.ms || 0 });
      }
      if (list.length) manifest.set(c.id, list);
    }
  }
  for (const id of S.foldedIntoTap?.cues || []) folded.add(id);

  // **첫 입력에서 언락한다.** 그전에 부른 소리는 조용히 버린다 — 큐에 쌓아 뒀다가
  // 한꺼번에 터뜨리면 첫 탭에 소리 열 개가 동시에 난다
  const unlock = () => {
    unlocked = true;
    removeEventListener('pointerdown', unlock);
    removeEventListener('keydown', unlock);
  };
  addEventListener('pointerdown', unlock, { once: true, passive: true });
  addEventListener('keydown', unlock, { once: true });

  // 탭이 뒤로 가면 즉시 음소거 — 방치형은 다른 탭을 켜둔 채 돌린다
  document.addEventListener('visibilitychange', () => {
    enabled = !document.hidden;
    if (!enabled) stopAll();
  });
}

/** 설정 화면의 효과음 슬라이더가 부른다 (0~1) */
export function setSfxVolume(v) {
  volume = Math.max(0, Math.min(1, v || 0));
}

function stopAll() {
  for (const a of playing) { try { a.pause(); } catch { /* noop */ } }
  playing.clear();
}

/** 파일명은 매니페스트가 정확히 알려 준다 — 확장자를 추측하지 않는다 */
function load(url) {
  if (cache.has(url)) return cache.get(url);
  const a = new Audio(url);
  a.preload = 'auto';
  cache.set(url, a);
  return a;
}

/**
 * 큐 하나를 재생한다. **어떤 이유로든 실패하면 조용히 넘어간다.**
 * @param id     큐 id (sound.json > sfx[].id)
 * @param opt.gain 이 재생만 볼륨 배수 (배치 축약이 쓴다)
 */
export function sfx(id, opt = {}) {
  if (!enabled || !unlocked || volume <= 0) return;
  // 통일된 큐는 탭 소리로 — 호출부는 원래 이름을 그대로 부르면 된다
  if (folded.has(id)) id = 'sfx_tap';
  // 별칭은 따라간다 (다이아→골드, 분해→수령)
  const seen = new Set();
  while (alias.has(id) && !seen.has(id)) { seen.add(id); id = alias.get(id); }

  const urls = manifest.get(id);
  if (!urls) return;

  const now = performance.now();
  // **같은 큐를 60ms 안에 다시 내지 않는다.** 안 하면 타격음이 뭉개져 노이즈가 된다
  if (now - (lastAt.get(id) || -1e9) < rules.minIntervalPerCueMs) return;
  // 동시 상한. 넘으면 새 소리를 버린다 — 오래된 것을 끊으면 타격음이 잘려 더 이상하다
  if (playing.size >= rules.maxConcurrentSfx) return;
  lastAt.set(id, now);

  // 변주는 번갈아 쓴다. 같은 소리가 초당 여러 번 나면 기계처럼 들린다
  let cue = urls[0];
  if (urls.length > 1) {
    const i = (varIdx.get(id) || 0) % urls.length;
    varIdx.set(id, i + 1);
    cue = urls[i];
  }

  const src = load(cue.url);
  // **원본을 재생하지 않는다.** 같은 Audio 를 다시 play() 하면 앞의 재생이 끊긴다 —
  // 타격음처럼 겹쳐야 하는 소리가 하나씩만 들린다
  const a = src.cloneNode();
  a.volume = Math.max(0, Math.min(1, volume * (opt.gain ?? 1)));
  playing.add(a);
  let timer = 0;
  const done = () => { clearTimeout(timer); playing.delete(a); };
  a.addEventListener('ended', done, { once: true });
  a.addEventListener('error', done, { once: true });
  a.play().catch(done);        // 자동재생 거부 등 — 조용히 버린다
  // **들리는 데까지만 재생하고 끊는다.** 파일 뒤쪽이 무음인데(ElevenLabs 가
  // 요청보다 길게 뽑는다) 끝까지 기다리면 그동안 동시 재생 칸을 물고 있어서,
  // 타격이 몰릴 때 새 소리가 상한에 막혀 안 난다. 무음을 자르는 것이라
  // 들리는 결과는 그대로다 (data/sfx-manifest.json > whyMs)
  if (cue.ms > 0) timer = setTimeout(() => { try { a.pause(); } catch { /* noop */ } done(); }, cue.ms);
}

/**
 * 한 번에 N개가 터질 때 쓴다 — **1회만 내고 볼륨만 조금 올린다.**
 *
 * 자동 소환은 배치당 최대 700개를 굴린다 (sound.json > playbackRules.criticalNote).
 * 개당 재생하면 오디오가 즉시 붕괴한다. 볼륨을 올리는 것은 "많이 나왔다" 를
 * 소리로 전하려는 것이고, 상한을 두는 이유는 700개에서 귀가 아프면 안 되기 때문이다.
 */
export function sfxBatch(id, count = 1) {
  if (count <= 0) return;
  const gain = Math.min(1.6, 1 + Math.log10(Math.max(1, count)) * 0.25);
  sfx(id, { gain });
}
