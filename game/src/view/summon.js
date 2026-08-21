// 소환 연출.
//
// 에셋_생성_프롬프트.md STEP 10: "FX-UR 과 FX-LR 에 가장 많은 시간을 써라.
// 유저가 스크린샷 찍어 자랑하는 장면 = 무료 마케팅."
//
// 쓰는 에셋
//   ALT-01/02/03  소환진 배경 (용병 / 스킬 / 장비)
//   FX-N ~ FX-LR  등급별 폭발
//   char/*.png    등장 캐릭터
//
// PixiJS 를 안 쓴다. 전체 화면 이미지 합성이라 DOM 이 단순하고,
// 전투 캔버스를 건드리지 않아 씬 상태가 꼬이지 않는다.

const GRADES = ['N', 'R', 'SR', 'SSR', 'UR', 'LR'];
const GC = { N: '#9aa4b5', R: '#4CAF50', SR: '#2196F3', SSR: '#9C27B0', UR: '#FF9800', LR: '#E91E63' };

/** 장비 10등급 → 연출용 6등급. FX 는 6장뿐이다. */
export const tierToGrade = t =>
  t >= 10 ? 'LR' : t >= 9 ? 'UR' : t >= 7 ? 'SSR' : t >= 5 ? 'SR' : t >= 3 ? 'R' : 'N';

const ALT = { mercenary: 'ALT-01', skill: 'ALT-02', equipment: 'ALT-03' };

export class SummonReveal {
  constructor(root = document.body) {
    this.el = document.createElement('div');
    this.el.id = 'reveal';
    this.el.innerHTML = `
      <div class="rv-alt"></div>
      <div class="rv-veil"></div>
      <div class="rv-stage">
        <img class="rv-burst" alt="">
        <img class="rv-char" alt="">
      </div>
      <div class="rv-info"><span class="rv-grade"></span><span class="rv-name"></span></div>
      <div class="rv-grid"></div>
      <div class="rv-hint">화면을 탭하면 넘어갑니다</div>`;
    root.appendChild(this.el);
    this.el.addEventListener('click', () => this.next());
    this.queue = [];
    this.busy = false;
  }

  /**
   * @param track   'mercenary' | 'skill' | 'equipment'
   * @param items   [{ grade, name, img }] — img 는 없으면 실루엣만
   * @param onDone  전부 넘긴 뒤 콜백
   */
  play(track, items, onDone) {
    if (!items.length) return onDone?.();
    this.track = track;
    this.queue = items.slice();
    this.onDone = onDone;
    this.el.querySelector('.rv-alt').style.backgroundImage =
      `url(/assets/ui/${ALT[track] || ALT.mercenary}.png)`;
    this.el.classList.add('show');
    this.busy = true;
    // 10연은 하나씩 다 보여주면 지친다. 최고 등급만 연출하고 나머지는 격자로.
    this.solo = items.length === 1;
    this.step();
  }

  step() {
    const grid = this.el.querySelector('.rv-grid');
    if (!this.queue.length) return this.close();

    // 여러 개면 가장 높은 등급을 먼저 보여준다
    let idx = 0;
    if (!this.solo) {
      let best = -1;
      this.queue.forEach((it, i) => {
        const g = GRADES.indexOf(it.grade);
        if (g > best) { best = g; idx = i; }
      });
    }
    const it = this.queue.splice(idx, 1)[0];
    if (!it) return this.close();   // 연타·경합으로 큐가 비어 있으면 조용히 닫는다
    this.rest = this.solo ? [] : this.queue.splice(0);

    const burst = this.el.querySelector('.rv-burst');
    const char = this.el.querySelector('.rv-char');
    const info = this.el.querySelector('.rv-info');

    burst.src = `/assets/fx/FX-${it.grade}.png`;
    char.src = it.img || '';
    char.style.display = it.img ? '' : 'none';
    this.el.querySelector('.rv-grade').textContent = it.grade;
    this.el.querySelector('.rv-grade').style.background = GC[it.grade];
    this.el.querySelector('.rv-name').textContent = it.name || '';

    // 애니메이션 재시작 — 클래스를 뗐다 붙인다
    for (const n of [burst, char, info]) { n.classList.remove('go'); void n.offsetWidth; }
    burst.classList.add('go');
    setTimeout(() => char.classList.add('go'), 180);
    setTimeout(() => info.classList.add('go'), 420);

    // 나머지는 아래에 격자로 순차 등장
    grid.innerHTML = '';
    this.rest.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'rv-cell';
      d.style.borderColor = GC[r.grade];
      d.style.animationDelay = (0.55 + i * 0.07) + 's';
      d.innerHTML = r.img
        ? `<img src="${r.img}" alt=""><span style="color:${GC[r.grade]}">${r.grade}</span>`
        : `<span style="color:${GC[r.grade]}">${r.grade}</span>`;
      grid.appendChild(d);
    });
  }

  next() {
    if (!this.busy) return;
    if (this.queue.length) this.step();
    else this.close();
  }

  close() {
    this.busy = false;
    this.el.classList.remove('show');
    this.el.querySelector('.rv-grid').innerHTML = '';
    this.onDone?.();
  }
}
