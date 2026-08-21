// 자동 횡스크롤 전투 씬 (PixiJS)
import { S, D, requiredCp, mercOf, totalCp, fmt } from './state.js';

const T = { walk: 2, fight: 3, bossWalk: 2, bossFight: 6 };   // combat.json > stagePresentation.timing
const ENC = 3, ENEMY_N = 4;

// 단장 뒤 용병 5인 "(" 대형 — 위/아래가 앞(우), 가운데가 뒤(좌). 값은 스프라이트 크기 비례.
// 겹침 방지 - 세로 5레인 + "(" 가로 오프셋 + 원근 스케일
// dy 간격이 스프라이트 높이 이상이라 서로 가리지 않는다.
const LANE = [
  { dx: 0.62, dy: -1.55, sc: 0.80 },
  { dx: 0.24, dy: -0.78, sc: 0.90 },
  { dx: -0.20, dy: 0.00, sc: 1.00 },
  { dx: 0.24, dy: 0.78, sc: 1.10 },
  { dx: 0.62, dy: 1.55, sc: 1.20 },
];
const ELANE = [
  { dx: 0.05, dy: -1.20, sc: 0.84 },
  { dx: 1.10, dy: -0.40, sc: 0.94 },
  { dx: 0.05, dy: 0.40, sc: 1.04 },
  { dx: 1.10, dy: 1.20, sc: 1.14 },
];

const ease = {
  outQuad: t => 1 - (1 - t) * (1 - t),
  inQuad: t => t * t,
  outBack: t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
};

export class Battle {
  constructor(canvas, onStageClear) {
    this.canvas = canvas;
    this.onStageClear = onStageClear;
    this.app = null;
    this.tex = new Map();
    this.units = [];
    this.anims = [];
    this.t = 0;
    this.phase = 'walk';
    this.enc = 0;
    this.hitStop = 0;
    this.shake = 0;
  }

  async init() {
    const app = new PIXI.Application();
    await app.init({
      canvas: this.canvas, background: '#1a2436',
      resizeTo: this.canvas.parentElement, antialias: true,
    });
    this.app = app;
    this.w = () => app.screen.width;
    this.h = () => app.screen.height;

    this.root = new PIXI.Container(); app.stage.addChild(this.root);
    this.bg = new PIXI.Container(); this.root.addChild(this.bg);
    this.field = new PIXI.Container(); this.field.sortableChildren = true; this.root.addChild(this.field);
    this.fx = new PIXI.Container(); this.root.addChild(this.fx);
    this.buildBg();

    app.ticker.add((tk) => this.update(tk.deltaMS / 1000));
    await this.reset();
  }

  buildBg() {
    this.bgTiles = [];
    this.ground = new PIXI.Graphics();
    this.bg.addChild(this.ground);
  }

  bgFor(stage) {
    const r = D.stages.backgrounds.find(b => stage >= b.from && stage <= b.to);
    return (r ? r.asset.replace("bg_BG", "BG-") : "BG-01");
  }

  async setBg(stage) {
    const id = this.bgFor(stage);
    if (this.bgId === id && this.bgTiles.length) return;
    this.bgId = id;
    for (const t of this.bgTiles) this.bg.removeChild(t);
    this.bgTiles = [];
    const tex = await this.tex_(`../assets/bg/${id}.png`);
    if (!tex) return;
    const H = this.h();
    const w = tex.width * (H / tex.height);
    for (let i = 0; i < 2; i++) {
      const sp = new PIXI.Sprite(tex);
      sp.width = w + 2; sp.height = H; sp.x = i * w; sp.y = 0;
      this.bg.addChildAt(sp, i);
      this.bgTiles.push(sp);
    }
    this.bgW = w;
  }

  layout() {
    const H = this.h(), W = this.w();
    this.centerY = H * 0.58;
    this.unit = H * 0.145;
    const top = this.centerY - this.unit * 1.9;
    const g = this.ground.clear();
    g.rect(0, top, W, H - top).fill({ color: 0x0a1524, alpha: 0.34 });
    g.rect(0, top, W, 2).fill({ color: 0xbcd6ff, alpha: 0.25 });
  }

  async tex_(path) {
    if (this.tex.has(path)) return this.tex.get(path);
    try { const t = await PIXI.Assets.load(path); this.tex.set(path, t); return t; }
    catch { this.tex.set(path, null); return null; }
  }

  async makeSprite(path, size, flip, lean) {
    const t = await this.tex_(path);
    const holder = new PIXI.Container();          // 스케일 연출용 래퍼
    let sp;
    if (t) {
      sp = new PIXI.Sprite(t);
      sp.anchor.set(0.5, 1);
      const s = size / Math.max(t.width, t.height);
      sp.scale.set(flip ? -s : s, s);
    } else {
      sp = new PIXI.Graphics();
      sp.circle(0, -size / 2, size / 2.6).fill(0x6c7a99);
    }
    holder.addChild(sp);
    holder.inner = sp;
    holder.flip = flip ? -1 : 1;
    holder.baseScale = { x: Math.abs(sp.scale?.x ?? 1), y: Math.abs(sp.scale?.y ?? 1) };
    holder.rotation = lean || 0;
    holder.baseRot = lean || 0;
    const sh = new PIXI.Graphics();
    sh.ellipse(0, 0, size * 0.30, size * 0.10).fill({ color: 0x000000, alpha: 0.30 });
    holder.addChildAt(sh, 0);
    holder.shadow = sh;
    return holder;
  }

  setPose(h, sx, sy) {   // 스쿼시 & 스트레치
    if (!h.inner.scale) return;
    h.inner.scale.set(h.baseScale.x * sx * h.flip, h.baseScale.y * sy);
  }

  tint(h, c) { if (h.inner.tint !== undefined) h.inner.tint = c; }

  async reset() {
    this.field.removeChildren(); this.fx.removeChildren();
    this.units = []; this.anims = []; this.t = 0; this.phase = 'walk'; this.enc = 0;
    this.layout();
    await this.setBg(S.stage);
    const H = this.h(), W = this.w();

    const unit = this.unit;
    const capSize = unit * 1.40;
    this.captain = await this.makeSprite(`../assets/captain/captain_warrior.png`, capSize, false, 0.055);
    this.captain.x = W * 0.415;
    this.captain.y = this.centerY + unit * 0.85;
    this.captain.zIndex = 900;
    this.field.addChild(this.captain);
    this.capBase = { x: this.captain.x, y: this.captain.y };

    const ids = S.equipped.mercenary.slice(0, 5);
    const baseX = W * 0.245;
    for (let i = 0; i < ids.length; i++) {
      const m = mercOf(ids[i]);
      const L = LANE[i] || LANE[2];
      const size = unit * L.sc;
      const h = await this.makeSprite(`../assets/char/${m.id}.png`, size, false, 0.05);
      h.x = baseX + L.dx * unit * 0.85;
      h.y = this.centerY + L.dy * unit;
      h.zIndex = Math.round(h.y);
      this.field.addChild(h);
      this.units.push({ h, side: 'A', base: { x: h.x, y: h.y }, id: m.id, size, busy: 0 });
    }
    this.allyCp = totalCp();
    await this.spawnWave(false);
  }

  async spawnWave(boss) {
    for (const u of this.units.filter(x => x.side === 'B')) this.field.removeChild(u.h);
    this.units = this.units.filter(x => x.side === 'A');
    const H = this.h(), W = this.w();
    const n = boss ? 1 : ENEMY_N;
    const unit = this.unit;
    const req = requiredCp(S.stage);
    const bosses = ['B-01', 'B-02', 'B-03', 'B-04'];
    const baseX = W * 0.70;
    for (let i = 0; i < n; i++) {
      const path = boss
        ? `../assets/boss/${bosses[S.stage % bosses.length]}.png`
        : `../assets/enemy/E-${String(1 + ((S.stage * 3 + i) % 12)).padStart(2, '0')}.png`;
      const L = boss ? { dx: 0.2, dy: 0.6, sc: 2.05 } : (ELANE[i] || ELANE[0]);
      const size = unit * L.sc;
      const h = await this.makeSprite(path, size, true, -0.05);
      h.x = baseX + L.dx * unit * 0.85;
      h.y = this.centerY + L.dy * unit;
      h.zIndex = Math.round(h.y);
      this.field.addChild(h);
      const hp = boss ? req * 2.4 : req * 0.85 / n;
      this.units.push({ h, side: 'B', hp, max: hp, base: { x: h.x, y: h.y }, size, boss, busy: 0 });
    }
    this.boss = boss;
  }

  // ---------- 연출 ----------
  anim(dur, fn, done) { this.anims.push({ t: 0, dur, fn, done }); }

  slash(x, y, size, crit) {
    const g = new PIXI.Graphics();
    const R = size * 0.62;
    g.arc(0, 0, R, -1.05, 1.05).stroke({ width: size * 0.20, color: crit ? 0xffd24a : 0xffffff, alpha: 1, cap: 'round' });
    g.arc(0, 0, R * 0.92, -0.95, 0.95).stroke({ width: size * 0.07, color: crit ? 0xff8a2a : 0x9fd0ff, alpha: .9, cap: 'round' });
    g.x = x; g.y = y;
    g.rotation = -0.5 + Math.random() * 1.0;
    g.scale.set(0.45);
    this.fx.addChild(g);
    this.anim(0.24, (t) => {
      g.scale.set(0.45 + ease.outQuad(t) * 0.9);
      g.alpha = 1 - ease.inQuad(t);
      g.rotation += 0.035;
    }, () => this.fx.removeChild(g));
  }

  ring(x, y, size) {
    const g = new PIXI.Graphics();
    g.circle(0, 0, size * 0.3).stroke({ width: 3, color: 0xffffff, alpha: .8 });
    g.x = x; g.y = y; this.fx.addChild(g);
    this.anim(0.22, (t) => { g.scale.set(1 + t * 2.1); g.alpha = 0.8 * (1 - t); },
      () => this.fx.removeChild(g));
  }

  attack(a, f) {
    const crit = Math.random() < 0.18;
    const dmg = this.allyCp / 24 * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1);
    const bx = a.base.x, by = a.base.y;
    a.busy = 1;

    // 1) 앤티시페이션 — 뒤로 당기며 웅크림
    this.anim(0.11, (t) => {
      a.h.x = bx - 10 * ease.outQuad(t);
      this.setPose(a.h, 1 + 0.10 * t, 1 - 0.12 * t);
    }, () => {
      // 2) 돌진 — 앞으로 뻗으며 늘어남
      this.anim(0.10, (t) => {
        a.h.x = bx - 10 + (48 + 10) * ease.outQuad(t);
        this.setPose(a.h, 1 + 0.22 * (1 - t), 1 - 0.10 * (1 - t));
        a.h.rotation = a.h.baseRot + 0.10 * ease.outQuad(t);
      }, () => {
        // 3) 임팩트
        this.impact(a, f, dmg, crit);
        // 4) 복귀
        const sx = a.h.x;
        this.anim(0.26, (t) => {
          a.h.x = sx + (bx - sx) * ease.inQuad(t);
          this.setPose(a.h, 1 + 0.10 * (1 - t), 1);
          a.h.rotation = a.h.baseRot + 0.10 * (1 - t);
        }, () => { a.h.x = bx; a.h.rotation = a.h.baseRot; this.setPose(a.h, 1, 1); a.busy = 0; });
      });
    });
  }

  impact(a, f, dmg, crit) {
    if (f.hp <= 0) return;
    f.hp -= dmg;
    const fx = f.h.x, fy = f.h.y - f.size * 0.55;

    this.slash(fx - f.size * 0.1, fy, f.size, crit);
    this.ring(fx, fy, f.size);
    this.popDmg(fx, fy - f.size * 0.25, dmg, crit);

    this.hitStop = crit ? 0.085 : 0.045;
    this.shake = crit ? 7 : (f.boss ? 5 : 0);

    // 피격 반동 + 눌림
    this.tint(f.h, 0xff7070);
    const fbx = f.base.x;
    this.anim(0.09, (t) => {
      f.h.x = fbx + 16 * ease.outQuad(t);
      this.setPose(f.h, 1 - 0.14 * t, 1 + 0.14 * t);
    }, () => {
      this.anim(0.20, (t) => {
        f.h.x = fbx + 16 * (1 - ease.outQuad(t));
        this.setPose(f.h, 1 - 0.14 * (1 - t), 1 + 0.14 * (1 - t));
      }, () => {
        f.h.x = fbx; this.setPose(f.h, 1, 1); this.tint(f.h, 0xffffff);
        if (f.hp <= 0) this.die(f);
      });
    });
  }

  die(f) {
    const g = f.h;
    this.anim(0.35, (t) => {
      g.alpha = 1 - t;
      g.y = f.base.y - t * 18;
      this.setPose(f.h, 1 - t * 0.5, 1 - t * 0.5);
      g.rotation = t * 0.5;
    }, () => { g.alpha = 0; });
    f.dead = true;
  }

  popDmg(x, y, v, crit) {
    const t = new PIXI.Text({
      text: fmt(v),
      style: {
        fontFamily: 'sans-serif', fontSize: crit ? 27 : 17, fontWeight: '900',
        fill: crit ? 0xffd24a : 0xffffff, stroke: { color: 0x101010, width: 4 },
      },
    });
    t.anchor.set(0.5);
    const sx = x + (Math.random() * 26 - 13), vx = (Math.random() * 30 - 15);
    t.x = sx; t.y = y; t.scale.set(0.4);
    this.fx.addChild(t);
    this.anim(0.62, (k) => {
      t.scale.set(k < 0.18 ? ease.outBack(k / 0.18) : 1);
      t.x = sx + vx * k;
      t.y = y - (58 * k - 40 * k * k);          // 포물선
      t.alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }, () => this.fx.removeChild(t));
  }

  // ---------- 루프 ----------
  update(rawDt) {
    if (!this.app) return;

    // 히트스톱
    if (this.hitStop > 0) { this.hitStop -= rawDt; this.stepAnims(0); this.applyShake(rawDt); return; }
    const dt = rawDt * S.speed;
    this.t += dt;
    this.stepAnims(dt);
    this.applyShake(dt);

    const walking = this.phase === 'walk' || this.phase === 'bossWalk';
    if (walking && this.bgTiles.length) {
      for (const sp of this.bgTiles) {
        sp.x -= 46 * dt;
        if (sp.x <= -this.bgW) sp.x += this.bgW * 2;
      }
    }
    const bob = walking ? 5 : 2.5;
    for (const u of this.units) if (!u.busy && !u.dead) u.h.y = u.base.y + Math.sin(this.t * 6.5 + u.base.x * 0.1) * bob;
    if (this.captain) this.captain.y = this.capBase.y + Math.sin(this.t * 6.5) * bob;

    const dur = this.phase === 'walk' ? T.walk
      : this.phase === 'fight' ? T.fight
        : this.phase === 'bossWalk' ? T.bossWalk : T.bossFight;

    if (this.phase === 'fight' || this.phase === 'bossFight') this.combatTick(dt);

    if (this.t >= dur) {
      this.t = 0;
      if (this.phase === 'walk') this.phase = 'fight';
      else if (this.phase === 'fight') {
        this.enc++;
        if (this.enc >= ENC) { this.phase = 'bossWalk'; this.spawnWave(true); }
        else { this.phase = 'walk'; this.spawnWave(false); }
      }
      else if (this.phase === 'bossWalk') this.phase = 'bossFight';
      else this.finish();
    }
  }

  stepAnims(dt) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.fn(k);
      if (k >= 1) { this.anims.splice(i, 1); a.done && a.done(); }
    }
  }

  applyShake(dt) {
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 40);
      this.root.x = (Math.random() - 0.5) * this.shake;
      this.root.y = (Math.random() - 0.5) * this.shake * 0.7;
    } else { this.root.x = 0; this.root.y = 0; }
  }

  combatTick(dt) {
    this.atkT = (this.atkT || 0) + dt;
    if (this.atkT < 0.34) return;
    this.atkT = 0;
    const allies = this.units.filter(u => u.side === 'A' && !u.busy);
    const foes = this.units.filter(u => u.side === 'B' && u.hp > 0);
    if (!foes.length || !allies.length) return;
    this.attack(allies[Math.floor(Math.random() * allies.length)], foes[0]);
  }

  async finish() {
    this.onStageClear(totalCp() >= requiredCp(S.stage) * 0.9);
    await this.reset();
  }
}
