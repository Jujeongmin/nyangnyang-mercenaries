// 숫자·시간 표기. 방치형은 자릿수가 커서 표기를 한 곳에 모아야 한다.

// 만/억 이 한국 관행이지만 이 게임은 전투력을 k/m 으로 쓴다.
// 재화만 만/억이면 같은 화면에 두 체계가 섞여 읽는 속도가 떨어진다.
const UNITS = [
  [1e12, 't'], [1e9, 'b'], [1e6, 'm'], [1e3, 'k'],
];

/** 소수점 뒤의 잉여 0 만 턴다. "20.0"→"20", "1.50"→"1.5", "300"→"300" */
const trimZero = s => s.includes('.')
  ? s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  : s;

// 1,834,000 → "183.4만"
export function num(n) {
  if (n == null || !isFinite(n)) return '0';
  const neg = n < 0; n = Math.abs(n);
  for (const [v, u] of UNITS) {
    if (n >= v) {
      const x = n / v;
      const s = x >= 100 ? Math.round(x) : x.toFixed(x >= 10 ? 1 : 2);
      // 소수점 **뒤**의 0 만 턴다. `/\.?0+$/` 로 하면 정수의 0 까지 먹어서
      // 300000 이 "3k", 150000000 이 "15m" 으로 나온다. 실제로 그랬다.
      return (neg ? '-' : '') + trimZero(String(s)) + u;
    }
  }
  return (neg ? '-' : '') + Math.floor(n).toString();
}


// 전투력 전용. 재화는 만/억 이 한국 관행이지만 CP 는 자릿수가 훨씬 커서
// k/m/b 가 한눈에 읽힌다 (8317 -> 8.32k, 65500000 -> 65.5m).
// 전투력과 재화가 같은 표기를 쓴다. 별칭으로 두어 두 구현이 어긋날 여지를 없앤다.
export const cpNum = num;

// 재화 HUD 처럼 자리가 좁을 때
export const numShort = n => num(n);

// 정확한 값이 필요한 곳 (확률 공시, 상세 툴팁)
export const numExact = n => Math.floor(n ?? 0).toLocaleString('ko-KR');

export function pct(x, digits = 2) {
  return trimZero((x * 100).toFixed(digits)) + '%';
}

// 344 → "5:44",  9000 → "2:30:00"
export function dur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const p = v => String(v).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

// 방치 보상처럼 길이가 큰 것
export function durLong(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  if (h >= 1) return m ? `${h}시간 ${m}분` : `${h}시간`;
  if (m >= 1) return `${m}분`;
  return `${sec}초`;
}

export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

/**
 * 데이터 파일의 설명문을 화면에 그대로 띄울 때 쓴다.
 * JSON 주석은 사람이 읽으라고 쓴 글이라 `**강조**` 가 섞여 있다. 그대로 innerHTML 에
 * 넣으면 별표가 노출된다 — 무한의 탑 보상 설명에서 실제로 났다.
 */
export function mdb(s) {
  return String(s == null ? '' : s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}
