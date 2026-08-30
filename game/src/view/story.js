// 웹툰 뷰어 — 배경 한 장 위에 기존 캐릭터 그림을 얹어 컷을 만든다.
//
// **통짜 삽화를 안 그린다.** 44컷을 통짜로 그리면 44장이 필요한데, 배경 위에
// 인물을 합성하면 배경 8장 + 단장 스탠딩 9장으로 끝난다.
//
// 인물은 **웹툰용으로 따로 그린 것**이다 (assets/story/ST-CAP-*). 처음에는
// 게임 스프라이트를 그대로 얹었는데 2등신 치비라 컷 톤과 안 맞았다
// (단장 지적 2026-08-30). 편성 등장(내 용병이 컷에 서는 것)도 같은 이유로 뺐다 —
// 그림체가 한 결로 가는 쪽을 골랐다.
//
// 규칙 셋 (기획서 0절 — tutorial.json > antiPatterns 의 "시네마틱 오프닝 금지"와
// 부딪히지 않으려고 못 박은 것들):
//   1. 스토리는 첫 90초를 건드리지 않는다 — 프롤로그가 3컷뿐이고 나머지는 마일스톤 뒤다
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

    // 배경은 두 곳에서 온다 — 웹툰 전용 컷(CUT-*)은 story/, 전투 배경을
    // 빌려 쓰는 컷(BG-*)은 bg/ 다. 있는 그림을 빌리는 것이 새로 그리는 것보다 늘 싸다
    const dir = cut.bg.startsWith('CUT-') ? 'story' : 'bg';
    $(this.el, '#stBg').src = `/assets/${dir}/${cut.bg}.webp`;

    // ── 레이어 ── (layerHtml 이 타입별로 갈라 그린다)
    const layers = $(this.el, '#stLayers');
    layers.innerHTML = (cut.layers || []).flatMap(L => this.layerHtml(L)).join('');

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

  /**
   * 레이어 한 장(또는 여럿) → HTML.
   *
   * **인물은 `char/*.webp` 를 쓴다** — 도감 일러(`-ART`)는 배경이 딸려 있어
   * 원형 마스크로 잘라야 하고, 그러면 무기 끝이 잘린다 (기획서 9절 열린 질문 2).
   * 로스터·마을·랭킹이 이미 쓰는 그 투명 스프라이트가 합성에는 더 맞다.
   *
   * 편성이 비었거나 모자라면 **그 레이어만 빠진다** (기획서 3.3). 컷이 안 뜨는
   * 것보다 한 명 덜 서는 편이 낫다 — 시작 편성은 비어 있는 것이 정상이다.
   */
  layerHtml(L) {
    // 못 찾으면 한 단계 물러선다 — 웹툰 그림이 아직 없으면 게임 스프라이트로
    // 버틴다. 그림이 들어오는 대로 저절로 갈린다 (파일만 놓으면 된다)
    const one = ({ src, alt }, x, y, h, flip) => (!src ? '' : `<img class="st-l" src="${src}" alt=""
        style="left:${x * 100}%;top:${y * 100}%;height:${h * 100}%;
               transform:translate(-50%,-100%)${flip ? ' scaleX(-1)' : ''}"
        onerror="${alt ? `this.onerror=null;this.src='${alt}'` : 'this.remove()'}">`);
    const x = L.x ?? 0.5, y = L.y ?? 0.93, h = L.h ?? 0.55;

    // 단장 — 웹툰용으로 따로 그린 스탠딩이다 (에셋 지시서 26절 ST-CAP-*).
    // 게임 스프라이트는 2등신 치비라 컷 안에서 톤이 안 맞았다 (단장 지적)
    if (L.type === 'captain') return [one(this.api.captainSrc(L.pose || 'stand'), x, y, h, L.flip)];
    // 조연 실루엣 — 얼굴을 그리지 않는다. 특정 용병을 그리면 그 용병을 못 뽑은
    // 유저에게 낯선 얼굴이 되고, 로스터가 늘 때마다 다시 그려야 한다
    if (L.type === 'sil') return [one({ src: `/assets/story/${L.id}.webp` }, x, y, h, L.flip)];

    // 오버레이 — 화이트아웃·어둠. 그림이 아니라 판이라 img 가 아니다
    if (L.type === 'fx') {
      const bg = L.fx === 'whiteout' ? '#fff' : '#000';
      return [`<i class="st-fx" style="background:${bg};opacity:${L.amount ?? 0.5}"></i>`];
    }
    return [];
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
