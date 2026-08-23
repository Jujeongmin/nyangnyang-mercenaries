// 연합 마을 — 목록 화면이 아니라 **걸어 다니는 마을**이다.
//
// 연합의 정체성은 "남들과 같은 공간에 있다"는 감각인데, 표(frow) 네 탭으로는
// 그게 하나도 안 전달됐다. 그래서:
//   · 바닥을 탭하면 내 단장이 그리로 걸어간다
//   · 건물이 곧 메뉴다 — 보스 소굴 / 기부 창고 / 연합 상점 / 게시판(단원)
//   · 접속 연합원이 마을을 산책한다 (서버 연동 전엔 데모 주민)
//
// 판정·재화는 전부 main.js 가 준 api 로 처리한다. 이 파일은 화면만 안다.

const $ = (el, s) => el.querySelector(s);

/** 데모 주민 — 서버(verse8.presence) 연동 전까지 마을이 비어 보이지 않게 */
const DEMO_CATS = ['N-03', 'R-02', 'SR-03'];

export class AllianceVillage {
  /** @param api {state, data, toast, num, openPanel(tab), donate(kind)} */
  constructor(root, api) {
    this.api = api;
    this.el = document.createElement('div');
    this.el.id = 'alli';
    this.el.className = 'fullscr';
    this.el.innerHTML = `
      <div class="sh-head">
        <button class="sh-back">‹</button>
        <span class="sh-title">연합 마을</span>
        <span id="alCoin"></span>
      </div>
      <div id="alField">
        <!-- 월드 — 뷰포트보다 큰 마을. 카메라(transform)가 단장을 따라간다.
             % 좌표는 전부 월드 기준이라 카메라가 생겨도 배치 코드는 안 바뀐다 -->
        <div id="alWorld">
        <!-- 길·광장·덤불은 **배경(AL-BG)에 이미 그려져 있다.** CSS 로 덧그리면
             두 겹이 어긋나 지저분해진다. 건물은 배경의 빈 터 4곳에 앉힌다:
             상단 좌우 터 / 중단 좌우 터 (중앙 원형 광장이 마을의 중심) -->
        <!-- 좌표는 배경의 빈 터 실측값이다 (AL-BG 1024x1536 기준):
             상단 큰 원형 터 중심 26%/74% x 25%, 중단 작은 터 13%/86% x 50%.
             left 가 건물 중심이 되도록 CSS 가 translateX(-50%) 를 건다 -->
        <div class="al-bd big" data-b="boss" style="left:22%;top:16%">
          <img src="/assets/alliance/AL-01.png" alt="" onerror="this.remove()">
          <b>보스 소굴</b></div>
        <div class="al-bd big" data-b="donate" style="left:78%;top:16%">
          <img src="/assets/alliance/AL-02.png" alt="" onerror="this.remove()">
          <b>기부 창고</b></div>
        <div class="al-bd" data-b="shop" style="left:13%;top:41%">
          <img src="/assets/alliance/AL-03.png" alt="" onerror="this.remove()">
          <b>연합 상점</b></div>
        <div class="al-bd" data-b="member" style="left:86%;top:41%">
          <img src="/assets/alliance/AL-04.png" alt="" onerror="this.remove()">
          <b>게시판</b></div>
        <div id="alCap"><img src="/assets/captain/captain_warrior.png" alt=""></div>
        </div>
        <div id="alDemoNote">주민은 서버 연동 전 데모입니다</div>
        <!-- 조이스틱은 월드 밖 — 화면 좌표에 떠야 카메라와 같이 안 밀린다 -->
        <div id="alJoy"><div id="alJoyKnob"></div></div>
      </div>`;
    root.appendChild(this.el);
    $(this.el, '.sh-back').addEventListener('click', () => this.close());

    this.field = $(this.el, '#alField');
    this.world = $(this.el, '#alWorld');
    this.cap = $(this.el, '#alCap');
    // 중앙 원형 광장에서 시작한다 — 배경의 발바닥 문양 자리(월드 기준 y≈47%).
    // 구석에서 시작하면 첫 화면이 마을의 끝을 보여 준다
    this.capPos = { x: 50, y: 47 };
    this.bots = [];
    this.botTimer = null;

    // 이동은 **가상 조이스틱**이다 — 아무 데나 누르면 그 자리에 스틱이 뜨고,
    // 안쪽 원을 민 방향·거리만큼 단장이 걷는다. 떼면 선다.
    // 짧은 탭(220ms 미만)은 이동이 아니라 건물 열기다.
    this.joy = $(this.el, '#alJoy');
    this.knob = $(this.el, '#alJoyKnob');
    this.stick = null;                         // {cx, cy, dx, dy} px — 스틱 중심·기울기
    this.moveRaf = null;
    const JOY_R = 46;                          // 스틱 반경(px). 이 이상은 최대 속도
    this.field.addEventListener('pointerdown', e => {
      this.holdAt = performance.now();
      this.holdBd = e.target.closest('.al-bd');
      const r = this.field.getBoundingClientRect();
      this.stick = { cx: e.clientX - r.left, cy: e.clientY - r.top, dx: 0, dy: 0 };
      this.joy.style.left = this.stick.cx + 'px';
      this.joy.style.top = this.stick.cy + 'px';
      this.knob.style.transform = 'translate(0,0)';
      try { this.field.setPointerCapture(e.pointerId); } catch { /* noop */ }
      this.startMoveLoop();
    });
    this.field.addEventListener('pointermove', e => {
      if (!this.stick) return;
      const r = this.field.getBoundingClientRect();
      let dx = (e.clientX - r.left) - this.stick.cx;
      let dy = (e.clientY - r.top) - this.stick.cy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
      this.stick.dx = dx / JOY_R;              // -1 ~ 1
      this.stick.dy = dy / JOY_R;
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
      // 조금이라도 밀었으면 이동이다 — 탭 판정을 깬다
      if (Math.hypot(dx, dy) > 9) this.joy.classList.add('show');
    });
    const up = () => {
      if (!this.stick) return;
      const wasTap = performance.now() - this.holdAt < 220
        && Math.hypot(this.stick.dx, this.stick.dy) < 0.2;
      this.stick = null;
      this.joy.classList.remove('show');
      this.cap.classList.remove('walk');
      if (wasTap && this.holdBd) this.api.openPanel(this.holdBd.dataset.b);
      this.holdBd = null;
    };
    this.field.addEventListener('pointerup', up);
    this.field.addEventListener('pointercancel', up);
  }

  /** 조이스틱 이동 루프 — 기울인 방향·세기로 걷는다 */
  startMoveLoop() {
    if (this.moveRaf) return;
    let last = performance.now();
    // 최대 %/초. 월드가 뷰포트의 150%x175% 라 화면 기준 체감은 이보다 느리다.
    // 30 은 마을을 순식간에 가로질러 "돌아다니는" 맛이 없었다
    const SPEED = 18;
    const step = now => {
      this.moveRaf = null;
      if (!this.el.classList.contains('show')) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (this.stick) {
        const { dx, dy } = this.stick;
        const mag = Math.hypot(dx, dy);
        if (mag > 0.12) {                      // 데드존 — 미세 떨림에 안 걷는다
          const c = this.capPos;
          c.x = Math.max(3, Math.min(97, c.x + dx * SPEED * dt));
          // 세로는 원근 때문에 살짝 느리게. 하늘(30%) 위로는 못 간다
          c.y = Math.max(22, Math.min(92, c.y + dy * SPEED * 0.75 * dt));
          this.cap.classList.add('walk');
          if (Math.abs(dx) > 0.08) this.cap.classList.toggle('flip', dx < 0);
          this.cap.style.transition = 'none';
          this.place(this.cap, c.x, c.y);
          this.updateCamera();
        } else this.cap.classList.remove('walk');
        this.moveRaf = requestAnimationFrame(step);
      }
    };
    this.moveRaf = requestAnimationFrame(step);
  }

  open() {
    this.el.classList.add('show');
    this.render();
    this.place(this.cap, this.capPos.x, this.capPos.y);
    this.updateCamera(true);
    this.spawnBots();
  }

  /**
   * 카메라 — 단장이 화면 중앙 근처에 오도록 월드를 transform 으로 민다
   * (컴포지터 처리라 리플로우 없음). 월드 끝에서는 클램프해 바깥이 안 보인다.
   */
  updateCamera(snap) {
    const fw = this.field.clientWidth, fh = this.field.clientHeight;
    const ww = this.world.offsetWidth, wh = this.world.offsetHeight;
    let tx = fw / 2 - this.capPos.x / 100 * ww;
    let ty = fh * 0.55 - this.capPos.y / 100 * wh;
    tx = Math.min(0, Math.max(fw - ww, tx));
    ty = Math.min(0, Math.max(fh - wh, ty));
    this.world.style.transition = snap ? 'none' : 'transform .18s linear';
    this.world.style.transform = `translate(${tx}px, ${ty}px)`;
  }

  close() {
    this.el.classList.remove('show');
    this.stick = null;
    this.joy?.classList.remove('show');
    if (this.moveRaf) { cancelAnimationFrame(this.moveRaf); this.moveRaf = null; }
    clearInterval(this.botTimer); this.botTimer = null;
    for (const b of this.bots) b.el.remove();
    this.bots = [];
  }

  render() {
    $(this.el, '#alCoin').innerHTML =
      `<img src="/assets/ui/CU-12.png" alt=""> ${this.api.num(this.api.state.allyCoin || 0)}`;
  }

  /** % 좌표 배치. y 가 클수록 앞(아래)이므로 z-index 도 y 를 따른다 */
  place(el, x, y) {
    el.style.left = x + '%';
    el.style.top = y + '%';
    el.style.zIndex = 10 + Math.round(y);
  }

  /** 데모 주민 — 몇 초마다 아무 데나 걸어 다닌다 */
  spawnBots() {
    if (this.bots.length) return;
    DEMO_CATS.forEach((id, i) => {
      const el = document.createElement('div');
      el.className = 'al-bot';
      el.innerHTML = `<img src="/assets/char/${id}.png" alt="" onerror="this.parentNode.remove()">
        <i>냥이${i + 1}</i>`;
      this.field.appendChild(el);
      const pos = { x: 20 + i * 26, y: 55 + (i % 2) * 20 };
      this.place(el, pos.x, pos.y);
      this.bots.push({ el, pos });
    });
    this.botTimer = setInterval(() => {
      for (const b of this.bots) {
        if (Math.random() < 0.45) continue;
        const x = 8 + Math.random() * 84;
        const y = 32 + Math.random() * 52;
        const dur = Math.max(600, Math.hypot(x - b.pos.x, y - b.pos.y) * 46);
        b.el.classList.toggle('flip', x < b.pos.x);
        b.el.style.transition = `left ${dur}ms linear, top ${dur}ms linear`;
        this.place(b.el, x, y);
        b.pos = { x, y };
      }
    }, 2600);
  }
}
