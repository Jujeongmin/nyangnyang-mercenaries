// 웹툰 뷰어 — 배경 한 장 위에 기존 캐릭터 그림을 얹어 컷을 만든다.
//
// **통짜 삽화를 안 그린다.** 44컷을 통짜로 그리면 44장이 필요한데, 배경 위에
// 로스터의 `-ART`·단장 초상을 합성하면 새 그림이 배경 8장으로 끝난다.
// 덤으로 컷이 **그 유저의 편성**을 보여 준다 — 남의 이야기가 아니게 된다.
//
// 규칙 셋 (기획서 0절 — tutorial.json > antiPatterns 의 "시네마틱 오프닝 금지"와
// 부딪히지 않으려고 못 박은 것들):
//   1. 스토리는 첫 90초를 건드리지 않는다 — 프롤로그 3컷뿐이고 나머지는 마일스톤 뒤다
//   2. 언제나 건너뛸 수 있다. 건너뛰어도 보상은 그대로다
//   3. 전투를 멈추지 않는다 — 뒤에서 계속 돈다
//
// 좌표는 전부 **컷 크기에 대한 비율**이다 (story.json > layerNote). 픽셀을 박으면
// 화면 폭이 바뀔 때 인물이 배경에서 떠오른다.

const $ = (el, s) => el.querySelector(s);

export class StoryViewer {
  /**
   * @param api {state, data, t, onDone(id, {skipped}), captainSrc(tier), faceOf(x)}
   */
  constructor(root, api) {
    this.api = api;
    this.ep = null;
    this.i = 0;
    this.el = document.createElement('div');
    this.el.id = 'story';
    this.el.innerHTML = `
      <div id="stCut">
        <img id="stBg" alt="">
        <div id="stLayers"></div>
      </div>
      <div id="stText"><b id="stWho"></b><p id="stLine"></p></div>
      <button id="stSkip"></button>
      <div id="stNext"></div>`;
    root.appendChild(this.el);

    // 탭하면 다음 컷. **버튼 위에서는 안 넘긴다** — 건너뛰기를 누르려다
    // 한 컷이 넘어가면 유저는 자기가 뭘 눌렀는지 모른다
    this.el.addEventListener('click', e => {
      if (e.target.closest('#stSkip')) return;
      this.next();
    });
    $(this.el, '#stSkip').addEventListener('click', () => this.close(true));
  }

  /** 한 화를 연다. 끝나거나 건너뛰면 약속이 풀린다 */
  play(ep) {
    return new Promise(done => {
      this.ep = ep;
      this.i = 0;
      this.done = done;
      $(this.el, '#stSkip').textContent = this.api.t('건너뛰기');
      this.el.classList.add('show');
      this.draw();
    });
  }

  draw() {
    const cut = this.ep?.cuts?.[this.i];
    if (!cut) return this.close(false);
    const cutEl = $(this.el, '#stCut');
    // 아래에서 밀려 올라오는 읽기 방향 — 세로 스크롤 웹툰의 그 움직임이다.
    // 클래스를 껐다 켜야 애니메이션이 매 컷 다시 돈다
    cutEl.classList.remove('in');
    void cutEl.offsetWidth;
    cutEl.classList.add('in');

    $(this.el, '#stBg').src = `/assets/story/${cut.bg}.webp`;

    // ── 레이어 ──
    // 지금 쓰는 것은 captain 하나다. party·boss·text 는 EP1 이후에 온다 —
    // 쓰지도 않는 타입을 미리 만들어 두면 첫 화가 그만큼 늦어진다.
    const layers = $(this.el, '#stLayers');
    layers.innerHTML = (cut.layers || []).map(L => {
      const src = L.type === 'captain' ? this.api.captainSrc(L.tier || 1) : null;
      if (!src) return '';
      // y 는 **발끝**이다 — 인물 높이의 절반만큼 위로 올려 앉힌다
      return `<img class="st-l" src="${src}" alt=""
        style="left:${L.x * 100}%;top:${L.y * 100}%;height:${L.h * 100}%;
               transform:translate(-50%,-100%)${L.flip ? ' scaleX(-1)' : ''}"
        onerror="this.remove()">`;
    }).join('');

    // ── 글 ──
    // 나레이션은 이름이 없다. 대사는 누가 말하는지가 붙는다
    const who = $(this.el, '#stWho'), line = $(this.el, '#stLine');
    const box = $(this.el, '#stText');
    if (cut.narr) {
      box.className = 'narr';
      who.textContent = '';
      line.textContent = this.api.t(cut.narr);
    } else if (cut.say) {
      box.className = 'say';
      who.textContent = cut.say.who === 'captain'
        ? (this.api.state.nickname || this.api.t('단장')) : this.api.t(cut.say.who || '');
      line.textContent = this.api.t(cut.say.ko);
    } else {
      box.className = 'none';
      who.textContent = ''; line.textContent = '';
    }

    // 마지막 컷에서는 "다음" 표시를 바꾼다 — 한 번 더 탭하면 닫힌다
    $(this.el, '#stNext').textContent = this.i >= this.ep.cuts.length - 1
      ? this.api.t('탭하면 끝') : this.api.t('탭하면 다음');
  }

  next() {
    this.i++;
    if (this.i >= (this.ep?.cuts?.length || 0)) return this.close(false);
    this.draw();
  }

  close(skipped) {
    if (!this.ep) return;
    const id = this.ep.id;
    this.el.classList.remove('show');
    this.ep = null;
    const done = this.done; this.done = null;
    this.api.onDone?.(id, { skipped: !!skipped });
    done?.();
  }
}
