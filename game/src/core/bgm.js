// 배경음 재생기.
//
// 곡은 셋이다 (data/sound.json > bgm): main(메인/전투/보스) · shop(상점/소환) ·
// arena(아레나). **어느 곡을 틀지는 여기서 정하지 않는다** — main.js 가 화면
// 상태를 보고 want() 를 부른다. 여기는 "지금 곡 → 원하는 곡" 전환만 안다.
//
// 효과음(sfx.js)과 같은 원칙: **소리는 게임을 막지 않는다.** 파일이 없으면
// 그 곡은 조용하고, 자동재생이 막히면 첫 입력 뒤에 시작한다.

const BASE = '/assets/bgm/';
const FADE_MS = 450;           // 전환 페이드. 뚝 끊기면 화면 전환마다 귀에 걸린다
const gainOf = id => gains[id] ?? 1;

let volume = 0.7;              // 설정의 배경음 슬라이더 (0~1)
let enabled = true;            // 백그라운드면 false
let unlocked = false;

let gains = {};                // 곡별 음량 배수 (sound.json > bgm[].gain). 슬라이더와 곱해진다
let cur = null;                // { id, audio }
let wantId = null;             // 마지막으로 요청된 곡
let fading = 0;                // 페이드 타이머 id

const cache = new Map();       // id → Audio (lazy — 곡은 무거워서 미리 안 받는다)

export function initBgm(opt = {}) {
  if (typeof opt.volume === 'number') volume = opt.volume;
  // 곡별 밸런스는 데이터가 정한다 — 소스 음량이 제각각이라 코드에 박으면
  // 곡을 갈 때마다 코드를 열게 된다
  for (const b of opt.tracks || []) if (typeof b.gain === 'number') gains[b.id] = b.gain;
  // 첫 입력에서 언락 + 그 시점에 원하는 곡을 시작한다. 브라우저 자동재생
  // 정책상 그전의 play() 는 어차피 거부된다
  const unlock = () => {
    unlocked = true;
    if (wantId) want(wantId);
    removeEventListener('pointerdown', unlock);
    removeEventListener('keydown', unlock);
  };
  addEventListener('pointerdown', unlock, { once: true, passive: true });
  addEventListener('keydown', unlock, { once: true });

  // 탭이 뒤로 가면 멈추고, 돌아오면 이어 튼다 — 방치형은 다른 탭을 켜 둔다
  document.addEventListener('visibilitychange', () => {
    enabled = !document.hidden;
    if (!enabled) cur?.audio.pause();
    else if (cur && volume > 0) cur.audio.play().catch(() => { /* noop */ });
  });
}

export function setBgmVolume(v) {
  volume = Math.max(0, Math.min(1, v || 0));
  if (cur) {
    cur.audio.volume = volume * gainOf(cur.id);
    // 0 에서 다시 올렸을 때 이어 나오게
    if (volume > 0 && enabled && unlocked) cur.audio.play().catch(() => { /* noop */ });
    if (volume <= 0) cur.audio.pause();
  }
}

function load(id) {
  if (cache.has(id)) return cache.get(id);
  const a = new Audio(BASE + id + '.mp3');
  a.loop = true;
  a.preload = 'none';          // 곡당 2~3MB — 틀 때가 되어야 받는다
  cache.set(id, a);
  return a;
}

/**
 * 이 곡이 나오게 해 달라. 이미 그 곡이면 아무것도 안 한다.
 * 다른 곡이면 지금 곡을 페이드아웃하고 새 곡을 페이드인한다.
 */
export function want(id) {
  wantId = id;
  if (!unlocked || !id) return;
  if (cur?.id === id) return;

  clearInterval(fading);
  const prev = cur;
  const next = { id, audio: load(id) };
  cur = next;
  next.audio.volume = 0;
  if (enabled && volume > 0) next.audio.play().catch(() => { /* noop */ });

  const t0 = performance.now();
  fading = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    next.audio.volume = volume * gainOf(next.id) * k;
    if (prev) prev.audio.volume = volume * gainOf(prev.id) * (1 - k);
    if (k >= 1) {
      clearInterval(fading);
      if (prev) { prev.audio.pause(); prev.audio.currentTime = 0; }
    }
  }, 50);
}
