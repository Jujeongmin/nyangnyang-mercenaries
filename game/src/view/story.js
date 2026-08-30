// 웹툰 뷰어 — 컷 하나가 그림 한 장이다.
//
// 처음에는 배경과 인물을 따로 그려 합성했다. 게임 스프라이트를 얹었더니 톤이
// 안 맞았고, 웹툰용 인물을 따로 그려도 배경과 광원·붓질이 겉돌았다.
// **한 장으로 그린다** (단장 확정 2026-08-30). 컷 수만큼 그림이 늘지만
// 이 게임의 스토리는 첫 시작의 한 편(EP0)뿐이라 아홉 장이면 끝난다.
//
// 규칙 셋 (기획서 0절 — tutorial.json > antiPatterns 의 "시네마틱 오프닝 금지"와
// 부딪히지 않으려고 못 박은 것들):
//   1. 언제나 건너뛸 수 있다
//   2. 전투를 멈추지 않는다 — 뒤에서 계속 돈다
//   3. 마지막 컷이 튜토리얼로 넘긴다 — 이야기가 끝나고 화면만 바뀌면 유저는
//      다시 혼자가 된다
//
// 그림이 없으면 그 컷은 **검은 판에 글만** 뜬다. 이야기가 안 깨지고, 파일을
// 놓는 대로 갈린다.

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

  /**
   * 한 컷을 그린다.
   *
   * **컷이 무엇을 요구하면 먼저 채운다** (`needs`). EP0 의 3컷은 "고른 직업의
   * 단장" 이라 직업이 없으면 그릴 수 없다 — 그때 화를 잠시 접고 직업 선택을
   * 띄운 뒤 이어서 그린다. 세계관(1·2컷)을 먼저 보여 주고 길을 고르게 하려면
   * 이 갈라짐이 필요하다 (단장 지시 2026-08-30).
   */
  async draw() {
    const cut = this.ep?.cuts?.[this.i];
    if (!cut) return this.close(false);
    if (cut.needs && this.api.ensure) {
      // 화를 덮개째 감춘다 — 직업 선택 창이 스토리 위에 겹쳐 뜨면 둘 다 안 읽힌다
      this.el.classList.remove('show');
      try { await this.api.ensure(cut.needs); } catch { /* 못 채웠으면 그냥 그린다 */ }
      // 건너뛰기가 그 사이에 눌렸으면 이미 닫혔다
      if (!this.ep) return;
      this.el.classList.add('show');
    }
    const cutEl = $(this.el, '#stCut');
    // 아래에서 밀려 올라오는 읽기 방향 — 세로 스크롤 웹툰의 그 움직임이다.
    // 클래스를 껐다 켜야 애니메이션이 매 컷 다시 돈다
    cutEl.classList.remove('in');
    void cutEl.offsetWidth;
    cutEl.classList.add('in');

    // 컷 그림. byClass 인 컷은 **고른 직업**으로 갈린다 — 방금 누른 선택이
    // 그대로 그림으로 돌아오는 자리다
    const id = cut.byClass ? `${cut.art}-${this.api.captainClass?.() || 'warrior'}` : cut.art;
    const img = $(this.el, '#stBg');
    img.classList.remove('gone');
    img.onerror = () => img.classList.add('gone');   // 없으면 검은 판 + 글만
    img.src = `/assets/story/${id}.webp`;

    // 오버레이(어둠·화이트아웃)만 레이어로 남는다. 인물은 컷 그림 안에 있다
    $(this.el, '#stLayers').innerHTML = (cut.layers || [])
      .filter(L => L.type === 'fx')
      .map(L => `<i class="st-fx" style="background:${L.fx === 'whiteout' ? '#fff' : '#000'};
        opacity:${L.amount ?? 0.5}"></i>`).join('');

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
      // **닉네임을 안 쓴다** (단장 지시 2026-08-30). 이야기 속 화자는 유저가
      // 붙인 단 이름이 아니라 주인공 그 자신이다 — 자동 배정된 "날쌘펭귄73" 이
      // 대사 앞에 붙으면 그 순간 이야기가 아니라 게임 UI 가 된다.
      who.textContent = cut.say.who === 'captain'
        ? this.api.t('냥이단장') : this.api.t(cut.say.who || '');
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
