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
        <div id="alGround"></div>
        <div class="al-bd" data-b="boss"   style="left:6%;top:17%">
          <img src="/assets/boss/B-01.png" alt="" onerror="this.remove()">
          <b>보스 소굴</b></div>
        <div class="al-bd" data-b="donate" style="right:7%;top:15%">
          <img src="/assets/ui/CH-01.png" alt="" onerror="this.remove()">
          <b>기부 창고</b></div>
        <div class="al-bd" data-b="shop"   style="left:8%;top:46%">
          <img src="/assets/ui/IC-SHOP.png" alt="" onerror="this.remove()">
          <b>연합 상점</b></div>
        <div class="al-bd" data-b="member" style="right:8%;top:47%">
          <img src="/assets/ui/IC-RANK.png" alt="" onerror="this.remove()">
          <b>게시판</b></div>
        <div id="alCap"><img src="/assets/captain/captain_warrior.png" alt=""></div>
        <div id="alDemoNote">주민은 서버 연동 전 데모입니다</div>
      </div>`;
    root.appendChild(this.el);
    $(this.el, '.sh-back').addEventListener('click', () => this.close());

    this.field = $(this.el, '#alField');
    this.cap = $(this.el, '#alCap');
    this.capPos = { x: 50, y: 78 };            // % 좌표. y 는 마을 길 위
    this.walkT = null;
    this.bots = [];
    this.botTimer = null;

    // 바닥 탭 → 걸어간다. 건물 탭 → 그 앞까지 걸어간 뒤 연다.
    this.field.addEventListener('click', e => {
      const bd = e.target.closest('.al-bd');
      const r = this.field.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * 100;
      const y = (e.clientY - r.top) / r.height * 100;
      if (bd) {
        const br = bd.getBoundingClientRect();
        const bx = (br.left + br.width / 2 - r.left) / r.width * 100;
        const by = (br.bottom - r.top) / r.height * 100 + 6;
        this.walkTo(bx, Math.max(30, Math.min(88, by)),
          () => this.api.openPanel(bd.dataset.b));
      } else {
        // 길 밖(하늘)은 무시 — 단장이 지붕 위로 올라가면 마을이 장난감이 된다
        if (y < 26) return;
        this.walkTo(x, Math.max(30, Math.min(88, y)));
      }
    });
  }

  open() {
    this.el.classList.add('show');
    this.render();
    this.place(this.cap, this.capPos.x, this.capPos.y);
    this.spawnBots();
  }

  close() {
    this.el.classList.remove('show');
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

  walkTo(x, y, then) {
    const c = this.capPos;
    const dist = Math.hypot(x - c.x, (y - c.y) * 1.6);
    const dur = Math.max(240, dist * 26);          // 거리 비례 시간
    this.cap.classList.add('walk');
    this.cap.classList.toggle('flip', x < c.x);
    this.cap.style.transition = `left ${dur}ms linear, top ${dur}ms linear`;
    this.place(this.cap, x, y);
    this.capPos = { x, y };
    clearTimeout(this.walkT);
    this.walkT = setTimeout(() => {
      this.cap.classList.remove('walk');
      then?.();
    }, dur + 40);
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
