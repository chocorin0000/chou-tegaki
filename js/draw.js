// 図を描く画面（Android 版の DrawActivity v19 と同じ）。画面全体に、縮めずにそのまま書ける。
// 道具: 選ぶ・ペン・直線・矢印・四角・丸・消しゴム、色 7 つ、太さ 4 段階、塗り（なし・うすく・ぬる）
// 「選ぶ」: タップで 1 つ、何もないところからなぞると四角く囲んだ中のものをまとめて選ぶ。
//   枠の中をなぞると動く、角の丸で大きさ（直線・矢印 1 つは両端の丸）、上の × で消す。色・太さ・塗りも変えられる。
// 「ノートに入れる」で、書いたものを 1 つの図にする。図の幅はノートの行の幅（行の単位）。上下の余白は切る。
import { figure, css, fillColor, argb, shapeOf, fillOf } from './note.js';
import { el, btn, toast, dialog, TINT_OK, TINT_DEL } from './ui.js';

const PEN = 0, LINE = 1, ARROW = 2, RECT = 3, CIRCLE = 4, ERASER = 5, SELECT = 6;
const TOOL_ORDER = [SELECT, PEN, LINE, ARROW, RECT, CIRCLE, ERASER];
const TOOL_NAMES = ['ペン', '直線', '矢印', '四角', '丸', '消しゴム', '選ぶ'];
const COLORS = [0x1A2A40, 0xE53935, 0x1E6FD9, 0x2E9E4F, 0xF28C1E, 0x8E44AD, 0x795548].map(argb);
const WIDTH_NAMES = ['細', '中', '太', '極太'];
const WIDTH_PX = [1.5, 3, 6, 12];
const FILL_NAMES = ['なし', 'うすく', 'ぬる'];
const DRAG_NONE = 0, DRAG_MOVE = 1, DRAG_HANDLE = 2, DRAG_BAND = 3;

let selectHintShown = false, fillHintShown = false;

/** 1 画（座標は行の単位）。作ったあとは変えない */
function stroke(pts, color, width, kind, fill) {
  return { pts, color, width, kind, fill: kind === RECT || kind === CIRCLE ? fill : 0 };
}
function bounds(pts) {
  const r = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
  for (let k = 0; k + 1 < pts.length; k += 2) union(r, pts[k], pts[k + 1]);
  return r;
}
function union(r, x, y) { r.l = Math.min(r.l, x); r.t = Math.min(r.t, y); r.r = Math.max(r.r, x); r.b = Math.max(r.b, y); }
const inside = (r, x, y) => x >= r.l && x <= r.r && y >= r.t && y <= r.b;

/** 直線・矢印・四角・丸の点（ピクセル）。矢印は 1 本の線で「元 → 先 → 羽 → 先 → 羽」 */
function shape(tool, x0, y0, x1, y1, w) {
  if (tool === ARROW) {
    const ang = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
    const head = Math.min(len * 0.45, Math.max(w * 4.5, 12)), a = 28 * Math.PI / 180;
    return [x0, y0, x1, y1, x1 - head * Math.cos(ang - a), y1 - head * Math.sin(ang - a), x1, y1,
      x1 - head * Math.cos(ang + a), y1 - head * Math.sin(ang + a)];
  }
  if (tool === RECT) return [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
  if (tool === CIRCLE) {
    const seg = 64, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    const p = [];
    for (let i = 0; i <= seg; i++) { const t = 2 * Math.PI * i / seg; p.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t)); }
    return p;
  }
  return [x0, y0, x1, y1];
}

function near(p, u, x, y, r) {
  if (p.length === 2) return Math.hypot(p[0] * u - x, p[1] * u - y) <= r;
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k] * u, ay = p[k + 1] * u, dx = p[k + 2] * u - ax, dy = p[k + 3] * u - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= r) return true;
  }
  return false;
}

/**
 * 描く画面を開く。fig は描き直す図（新しい図は null）、width は図の幅（行の単位）。
 * 結果: { done: item または null（全部消した） } / { cancel: true } / { remove: true }（図を消す）
 */
export function openDraw(root, fig, width) {
  return new Promise(resolve => new DrawScreen(root, fig, width, resolve));
}

class DrawScreen {
  constructor(root, fig, width, resolve) {
    this.root = root; this.resolve = resolve;
    this.editing = !!fig;
    this.figW = fig ? fig.w : width;
    this.strokes = [];
    if (fig) fig.s.forEach((s, i) => this.strokes.push(stroke(s.slice(), fig.c[i], fig.k[i], shapeOf(fig, i), fillOf(fig, i))));
    this.undoS = []; this.redoS = [];
    this.changed = false;
    this.sel = [];
    this.tool = PEN; this.colorIdx = 0; this.widthIdx = 1; this.fillIdx = 0;
    this.scrollY = 0;
    this.ptrs = new Map();
    this.drag = DRAG_NONE;
    this.build();
  }

  // ---- 画面を作る ----

  build() {
    const r = this.root;
    r.innerHTML = '';
    r.className = 'screen draw';
    const top = el('div', 'bar');
    const bDone = btn('ノートに入れる', () => this.done(), TINT_OK);
    bDone.style.flex = '1.7';
    this.bUndo = btn('戻す', () => this.undo());
    this.bRedo = btn('やり直す', () => this.redo());
    const bClear = btn(this.editing ? '図を消す' : '全部消す', () => this.clearPressed(), TINT_DEL);
    top.append(bDone, btn('やめる', () => this.cancel()), this.bUndo, this.bRedo, bClear);
    this.cv = el('canvas', 'drawcv');
    const tools = el('div', 'bar');
    this.toolBtns = TOOL_ORDER.map(t => {
      const b = btn(TOOL_NAMES[t], () => this.setTool(t));
      if (t === ERASER) b.style.flex = '1.45';
      tools.appendChild(b);
      return b;
    });
    const colors = el('div', 'bar colors');
    this.colorCells = COLORS.map((c, i) => {
      const cell = el('button', 'swatch');
      cell.type = 'button';
      cell.style.setProperty('--c', css(c));
      cell.onclick = () => {
        this.colorIdx = i;
        if (this.sel.length) this.restyleSelected();
        else if (this.tool === ERASER || this.tool === SELECT) this.tool = PEN; // 色を選んだら書くつもり
        this.showSel();
      };
      colors.appendChild(cell);
      return cell;
    });
    this.bWidth = btn('', () => {
      this.widthIdx = (this.widthIdx + 1) % WIDTH_NAMES.length;
      if (this.sel.length) this.restyleSelected();
      this.showSel();
    });
    this.bFill = btn('', () => {
      this.fillIdx = (this.fillIdx + 1) % FILL_NAMES.length;
      if (this.sel.length) this.refillSelected();
      else if (this.fillIdx > 0 && this.tool !== RECT && this.tool !== CIRCLE && !fillHintShown) {
        fillHintShown = true;
        toast('このあと描く四角・丸の中が塗られます');
      }
      this.showSel();
    });
    for (const b of [this.bWidth, this.bFill]) { b.classList.add('two'); colors.appendChild(b); }
    r.append(top, this.cv, tools, colors);

    this.ctx = this.cv.getContext('2d');
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => this.move(e));
    this.cv.addEventListener('pointerup', e => this.up(e));
    this.cv.addEventListener('pointercancel', e => this.up(e, true));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.cv);
    this.showSel();
  }

  resize() {
    const b = this.cv.getBoundingClientRect();
    if (!b.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = b.width; this.h = b.height;
    this.cv.width = Math.round(b.width * dpr);
    this.cv.height = Math.round(b.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  unit() { return this.w / this.figW; }

  setTool(t) {
    this.tool = t;
    if (t !== SELECT) this.select(-1);
    else if (!selectHintShown) {
      selectHintShown = true;
      toast('タップで 1 つ選ぶ。何もないところからなぞって四角く囲むと、中のものをまとめて選べる。枠の中をなぞると動く、角の丸で大きさ', true);
    }
    this.showSel();
  }

  showSel() {
    this.toolBtns.forEach((b, i) => b.classList.toggle('on', TOOL_ORDER[i] === this.tool));
    this.colorCells.forEach((c, i) =>
      c.classList.toggle('on', i === this.colorIdx && this.tool !== ERASER && (this.tool !== SELECT || this.sel.length > 0)));
    this.bWidth.innerHTML = '太さ<br>' + WIDTH_NAMES[this.widthIdx];
    this.bFill.innerHTML = '塗り<br>' + FILL_NAMES[this.fillIdx];
    // 塗るときは目立たせる（うすく: 黄色の枠、ぬる: 今の色で塗ったボタン）
    this.bFill.style.background = this.fillIdx === 2 ? css(COLORS[this.colorIdx]) : '';
    this.bFill.style.boxShadow = this.fillIdx ? 'inset 0 0 0 3px #FFC94D' : '';
    this.bUndo.style.opacity = this.undoS.length ? 1 : 0.4;
    this.bRedo.style.opacity = this.redoS.length ? 1 : 0.4;
    this.invalidate();
  }

  // ---- 戻す・やり直す ----

  push() {
    this.undoS.push(this.strokes.slice());
    if (this.undoS.length > 100) this.undoS.shift();
    this.redoS = [];
    this.changed = true;
  }
  undo() {
    if (!this.undoS.length) return;
    this.redoS.push(this.strokes);
    this.strokes = this.undoS.pop();
    this.changed = true;
    this.select(-1);
  }
  redo() {
    if (!this.redoS.length) return;
    this.undoS.push(this.strokes);
    this.strokes = this.redoS.pop();
    this.changed = true;
    this.select(-1);
  }

  async clearPressed() {
    if (this.editing) {
      const ok = await dialog({ message: 'この図をノートから消しますか？（ノートの「戻す」で元に戻せます）', buttons: [{ text: '図を消す', value: true, tint: '#C0392B' }] });
      if (ok) this.finish({ remove: true });
      return;
    }
    if (!this.strokes.length) return;
    const ok = await dialog({ message: 'この図に書いたものを全部消しますか？（「戻す」で元に戻せます）', buttons: [{ text: '全部消す', value: true, tint: '#C0392B' }] });
    if (ok) { this.push(); this.strokes = []; this.select(-1); }
  }

  done() { this.finish({ done: this.toItem() }); }

  async cancel() {
    if (!this.changed) { this.finish({ cancel: true }); return; }
    const v = await dialog({
      message: '書いた図をノートに入れますか？', cancel: '続けて書く',
      buttons: [{ text: '入れずに戻る', value: 'drop', tint: '#C0392B' }, { text: 'ノートに入れる', value: 'done' }],
    });
    if (v === 'done') this.done();
    else if (v === 'drop') this.finish({ cancel: true });
  }

  finish(res) {
    this.ro.disconnect();
    this.root.innerHTML = '';
    this.resolve(res);
  }

  // ---- 選ぶ ----

  select(i) { this.selectMany(i >= 0 ? [i] : []); }

  /** まとめて選ぶ。最初のものの色・太さ・塗りを、下のボタンに出す */
  selectMany(l) {
    this.sel = l.slice().sort((a, b) => a - b);
    if (this.sel.length) {
      const s = this.strokes[this.sel[0]];
      COLORS.forEach((c, k) => { if (c === (s.color | 0)) this.colorIdx = k; });
      const wpx = s.width * this.unit();
      let best = 0;
      WIDTH_PX.forEach((w, k) => { if (Math.abs(w - wpx) < Math.abs(WIDTH_PX[best] - wpx)) best = k; });
      this.widthIdx = best;
      for (const i of this.sel) {
        const t = this.strokes[i];
        if (t.kind === RECT || t.kind === CIRCLE) { this.fillIdx = t.fill; break; }
      }
    }
    this.showSel();
  }

  restyleSelected() {
    if (!this.sel.length) return;
    const w = WIDTH_PX[this.widthIdx] / this.unit();
    this.push();
    for (const i of this.sel) {
      const s = this.strokes[i];
      const pts = s.kind === ARROW ? this.arrowPts(s.pts[0], s.pts[1], s.pts[2], s.pts[3], w) : s.pts;
      this.strokes[i] = stroke(pts, COLORS[this.colorIdx], w, s.kind, s.fill);
    }
    this.showSel();
  }

  refillSelected() {
    if (!this.sel.some(i => this.strokes[i].kind === RECT || this.strokes[i].kind === CIRCLE)) {
      toast('塗れるのは四角と丸だけです');
      return;
    }
    this.push();
    for (const i of this.sel) {
      const s = this.strokes[i];
      if (s.kind === RECT || s.kind === CIRCLE) this.strokes[i] = stroke(s.pts, s.color, s.width, s.kind, this.fillIdx);
    }
    this.showSel();
  }

  /** 図にする。上下の空いたところは切る。何も書いていなければ null */
  toItem() {
    if (!this.strokes.length) return null;
    let minY = Infinity, maxY = -Infinity;
    for (const s of this.strokes) for (let k = 1; k < s.pts.length; k += 2) {
      minY = Math.min(minY, s.pts[k] - s.width / 2);
      maxY = Math.max(maxY, s.pts[k] + s.width / 2);
    }
    const pad = 0.25, shift = minY - pad, h = maxY + pad - shift;
    return figure(this.figW, h,
      this.strokes.map(s => s.pts.map((v, k) => (k % 2 ? v - shift : v))),
      this.strokes.map(s => s.color | 0),
      this.strokes.map(s => s.width),
      this.strokes.map(s => s.kind | (s.fill << 4)));
  }

  arrowPts(x0, y0, x1, y1, w) {
    const u = this.unit();
    return shape(ARROW, x0 * u, y0 * u, x1 * u, y1 * u, w * u).map(v => v / u);
  }

  // ---- 描く ----

  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  path(p, u, oy, close) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(p[0] * u, p[1] * u + oy);
    for (let k = 2; k < p.length; k += 2) c.lineTo(p[k] * u, p[k + 1] * u + oy);
    if (close) c.closePath();
  }

  strokePx(p, u, oy, color, w) {
    const c = this.ctx;
    if (p.length < 2) return;
    w = Math.max(1, w);
    if (p.length === 2) {
      c.fillStyle = css(color);
      c.beginPath(); c.arc(p[0] * u, p[1] * u + oy, w / 2, 0, Math.PI * 2); c.fill();
      return;
    }
    c.strokeStyle = css(color); c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
    this.path(p, u, oy, false);
    c.stroke();
  }

  fillPx(p, u, oy, color, fill) {
    if (p.length < 6) return;
    this.ctx.fillStyle = css(fillColor(color, fill));
    this.path(p, u, oy, true);
    this.ctx.fill();
  }

  draw() {
    const c = this.ctx, u = this.unit(), W = this.w, H = this.h;
    if (!W) return;
    c.fillStyle = '#FFFDF5';
    c.fillRect(0, 0, W, H);
    // 薄い方眼（ノートの 1 行の高さごと）
    c.strokeStyle = '#E3EAF2'; c.lineWidth = 1;
    c.beginPath();
    for (let y = -(this.scrollY % u); y < H; y += u) { c.moveTo(0, y); c.lineTo(W, y); }
    for (let x = u; x < W; x += u) { c.moveTo(x, 0); c.lineTo(x, H); }
    c.stroke();
    const oy = -this.scrollY;
    // 塗りを先に（あとから書いた字や線が隠れないように。ノートでも同じ）
    for (const s of this.strokes) if (s.fill) this.fillPx(s.pts, u, oy, s.color, s.fill);
    const preview = this.drawing && this.tool !== ERASER && this.tool !== SELECT;
    const w = WIDTH_PX[this.widthIdx], col = COLORS[this.colorIdx];
    const sh = preview && this.tool !== PEN ? shape(this.tool, this.sx, this.sy, this.ex, this.ey, w) : null;
    if (sh && this.fillIdx && (this.tool === RECT || this.tool === CIRCLE)) this.fillPx(sh, 1, 0, col, this.fillIdx);
    for (const s of this.strokes) this.strokePx(s.pts, u, oy, s.color, s.width * u);
    if (preview) this.strokePx(this.tool === PEN ? this.buf : sh, 1, 0, col, w);
    if (this.tool === SELECT && this.drag === DRAG_BAND) {
      const x = Math.min(this.sx, this.ex), y = Math.min(this.sy, this.ey);
      c.fillStyle = 'rgba(47,128,237,0.09)';
      c.fillRect(x, y, Math.abs(this.ex - this.sx), Math.abs(this.ey - this.sy));
      c.setLineDash([8, 5]); c.strokeStyle = '#2F80ED'; c.lineWidth = 1.5;
      c.strokeRect(x, y, Math.abs(this.ex - this.sx), Math.abs(this.ey - this.sy));
      c.setLineDash([]);
    }
    if (this.tool === SELECT && this.sel.length) this.drawSelection();
  }

  drawSelection() {
    const c = this.ctx, u = this.unit();
    if (this.sel.length > 1) {
      // まとめて選んだときは、1 つずつにも薄い枠
      c.fillStyle = 'rgba(47,128,237,0.09)';
      for (const i of this.sel) {
        const b = bounds(this.strokes[i].pts);
        c.fillRect(b.l * u - 3, b.t * u - this.scrollY - 3, (b.r - b.l) * u + 6, (b.b - b.t) * u + 6);
      }
    }
    const r = this.selRectPx();
    c.setLineDash([8, 5]); c.strokeStyle = '#2F80ED'; c.lineWidth = 1.5;
    c.strokeRect(r.l, r.t, r.r - r.l, r.b - r.t);
    c.setLineDash([]);
    for (const h of this.handles()) {
      c.beginPath(); c.arc(h[0], h[1], 9, 0, Math.PI * 2);
      c.fillStyle = '#fff'; c.fill();
      c.lineWidth = 2.5; c.strokeStyle = '#2F80ED'; c.stroke();
    }
    const d = this.delPos();
    c.beginPath(); c.arc(d[0], d[1], 13, 0, Math.PI * 2);
    c.fillStyle = '#E53935'; c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(d[0] - 5, d[1] - 5); c.lineTo(d[0] + 5, d[1] + 5);
    c.moveTo(d[0] - 5, d[1] + 5); c.lineTo(d[0] + 5, d[1] - 5);
    c.stroke();
  }

  /** 選んだもの全部を囲む四角（行の単位） */
  selBounds() {
    const b = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    for (const i of this.sel) { const p = this.strokes[i].pts; for (let k = 0; k + 1 < p.length; k += 2) union(b, p[k], p[k + 1]); }
    return b;
  }

  /** 選んだものの枠（画面のピクセル、少し広げる。細い線でも小さくなりすぎない） */
  selRectPx() {
    const b = this.selBounds(), u = this.unit();
    let maxW = 0;
    for (const i of this.sel) maxW = Math.max(maxW, this.strokes[i].width);
    const pad = 10 + maxW * u / 2;
    const r = { l: b.l * u - pad, t: b.t * u - this.scrollY - pad, r: b.r * u + pad, b: b.b * u - this.scrollY + pad };
    const min = 56;
    if (r.r - r.l < min) { const g = (min - (r.r - r.l)) / 2; r.l -= g; r.r += g; }
    if (r.b - r.t < min) { const g = (min - (r.b - r.t)) / 2; r.t -= g; r.b += g; }
    return r;
  }

  singleLine() {
    if (this.sel.length !== 1) return false;
    const k = this.strokes[this.sel[0]].kind;
    return k === LINE || k === ARROW;
  }

  /** つまみの場所（ピクセル）。直線・矢印 1 つは両端、ほかは 4 つの角（左上・右上・右下・左下） */
  handles() {
    const u = this.unit();
    if (this.singleLine()) {
      const s = this.strokes[this.sel[0]];
      return [[s.pts[0] * u, s.pts[1] * u - this.scrollY], [s.pts[2] * u, s.pts[3] * u - this.scrollY]];
    }
    const r = this.selRectPx();
    return [[r.l, r.t], [r.r, r.t], [r.r, r.b], [r.l, r.b]];
  }

  /** 「×」（消す）の場所: 枠の上のまん中（上に出せないときは下） */
  delPos() {
    const r = this.selRectPx();
    let y = r.t - 22;
    if (y < 16) y = r.b + 22;
    return [(r.l + r.r) / 2, y];
  }

  // ---- タッチ ----

  pos(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  avgY() { let s = 0; for (const p of this.ptrs.values()) s += p[1]; return s / Math.max(1, this.ptrs.size); }

  // Apple Pencil を使ったあとは、ペンだけで書き、指はノートを上下に動かすだけにする（手のひらで書かれないように）
  down(e) {
    e.preventDefault();
    try { this.cv.setPointerCapture(e.pointerId); } catch (x) { /* なくてよい */ }
    const p = this.pos(e);
    if (e.pointerType === 'pen') {
      this.penSeen = true;
      this.startDraw(e, p);
      return;
    }
    this.ptrs.set(e.pointerId, p);
    if (this.penSeen || this.ptrs.size >= 2) {
      // 2 本指: 書きかけは捨てて、上下に動かす（大きな図を描くとき）
      if (!this.penSeen) { this.drawing = false; this.drag = DRAG_NONE; this.drawId = null; }
      this.scrolling = true;
      this.lastY = this.avgY();
      this.invalidate();
      return;
    }
    this.scrolling = false;
    this.startDraw(e, p);
  }

  startDraw(e, p) {
    this.drawId = e.pointerId;
    this.drawing = true;
    this.erasing = false;
    this.sx = this.ex = p[0];
    this.sy = this.ey = p[1];
    this.buf = [p[0], p[1]];
    if (this.tool === ERASER) this.eraseAt(p[0], p[1]);
    if (this.tool === SELECT) this.selectDown(p[0], p[1]);
    this.invalidate();
  }

  move(e) {
    if (e.pointerId === this.drawId && this.drawing) {
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of (evs.length ? evs : [e])) {
        const q = this.pos(ev);
        this.add(q);
        if (this.tool === ERASER) this.eraseAt(q[0], q[1]);
      }
      const q = this.pos(e);
      if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, q);
      this.ex = q[0]; this.ey = q[1];
      if (this.tool === SELECT) this.selectMove(this.ex, this.ey);
      this.invalidate();
      return;
    }
    if (!this.ptrs.has(e.pointerId)) return;
    e.preventDefault();
    this.ptrs.set(e.pointerId, this.pos(e));
    if (this.scrolling) {
      const y = this.avgY();
      this.scrollY = Math.max(0, Math.min(this.maxScroll(), this.scrollY + this.lastY - y));
      this.lastY = y;
      this.invalidate();
    }
  }

  up(e, cancel) {
    if (e.pointerId === this.drawId) {
      this.drawId = null;
      this.ptrs.delete(e.pointerId);
      if (this.drawing && !cancel) {
        if (this.tool !== ERASER && this.tool !== SELECT) this.finishStroke();
        if (this.tool === SELECT && this.drag === DRAG_BAND) this.finishBand();
      }
      this.drawing = false;
      this.drag = DRAG_NONE;
      this.showSel();
      return;
    }
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    if (this.scrolling && this.ptrs.size) { this.lastY = this.avgY(); return; }
    this.scrolling = false;
    this.showSel();
  }

  add(p) {
    const a = this.buf, n = a.length;
    if (n >= 2 && Math.abs(a[n - 2] - p[0]) < 0.5 && Math.abs(a[n - 1] - p[1]) < 0.5) return;
    a.push(p[0], p[1]);
  }

  maxScroll() {
    const u = this.unit();
    let bottom = 0;
    for (const s of this.strokes) for (let k = 1; k < s.pts.length; k += 2) bottom = Math.max(bottom, s.pts[k] * u);
    return Math.max(0, bottom + this.h / 2 - this.h);
  }

  /** 書き終えた 1 画（形）を、行の単位にして足す */
  finishStroke() {
    const u = this.unit(), wpx = WIDTH_PX[this.widthIdx];
    let px;
    if (this.tool === PEN) px = this.buf.slice();
    else {
      if (Math.hypot(this.ex - this.sx, this.ey - this.sy) < 6) return; // ほとんど動いていない
      px = shape(this.tool, this.sx, this.sy, this.ex, this.ey, wpx);
    }
    const pts = px.map((v, k) => (k % 2 ? (v + this.scrollY) / u : v / u));
    this.push();
    this.strokes.push(stroke(pts, COLORS[this.colorIdx], wpx / u, this.tool, this.fillIdx));
  }

  /** 消しゴム: 指の近くを通る画を、画ごと消す */
  eraseAt(x, y) {
    const u = this.unit();
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (near(s.pts, u, x, y + this.scrollY, 14 + s.width * u / 2)) {
        if (!this.erasing) { this.push(); this.erasing = true; }
        this.strokes.splice(i, 1);
      }
    }
  }

  /** タップしたところにあるもの（上に描いたものから探す）。四角・丸は中を押しても選べる */
  hitTest(x, y) {
    const u = this.unit();
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (near(s.pts, u, x, y + this.scrollY, 16 + s.width * u / 2)) return i;
    }
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (s.kind !== RECT && s.kind !== CIRCLE) continue;
      if (inside(bounds(s.pts), x / u, (y + this.scrollY) / u)) return i;
    }
    return -1;
  }

  selectDown(x, y) {
    this.drag = DRAG_NONE;
    this.dragPushed = false;
    if (this.sel.length) {
      const d = this.delPos();
      if (Math.hypot(x - d[0], y - d[1]) <= 18) {
        this.push();
        for (let k = this.sel.length - 1; k >= 0; k--) this.strokes.splice(this.sel[k], 1);
        this.select(-1);
        return;
      }
      const hs = this.handles();
      for (let i = 0; i < hs.length; i++) {
        if (Math.hypot(x - hs[i][0], y - hs[i][1]) <= 24) {
          this.drag = DRAG_HANDLE;
          this.handleNo = i;
          this.keepOrigs();
          return;
        }
      }
      const r = this.selRectPx();
      if (x >= r.l && x <= r.r && y >= r.t && y <= r.b) {
        this.drag = DRAG_MOVE;
        this.keepOrigs();
        return;
      }
    }
    const hit = this.hitTest(x, y);
    this.select(hit);
    if (hit >= 0) { this.drag = DRAG_MOVE; this.keepOrigs(); }
    else this.drag = DRAG_BAND; // 何もないところ: なぞって四角く囲む
  }

  keepOrigs() {
    this.origs = this.sel.map(i => this.strokes[i]);
    this.origBounds = this.selBounds();
  }

  /** 四角く囲んだ中に入っているもの（点の 8 割以上が中）を、まとめて選ぶ */
  finishBand() {
    if (Math.hypot(this.ex - this.sx, this.ey - this.sy) < 10) return; // ただのタップ
    const u = this.unit();
    const r = {
      l: Math.min(this.sx, this.ex) / u, t: (Math.min(this.sy, this.ey) + this.scrollY) / u,
      r: Math.max(this.sx, this.ex) / u, b: (Math.max(this.sy, this.ey) + this.scrollY) / u,
    };
    const l = [];
    this.strokes.forEach((s, i) => {
      const p = s.pts, all = p.length / 2;
      let n = 0;
      for (let k = 0; k + 1 < p.length; k += 2) if (inside(r, p[k], p[k + 1])) n++;
      if (all > 0 && n >= all * 0.8) l.push(i);
    });
    if (!l.length) { toast('囲んだ中に何もありません（全体が入るように囲んでください）'); return; }
    this.selectMany(l);
  }

  selectMove(x, y) {
    if (this.drag === DRAG_BAND || this.drag === DRAG_NONE || !this.origs || this.origs.length !== this.sel.length) return;
    if (!this.dragPushed) {
      if (Math.hypot(x - this.sx, y - this.sy) < 4) return;
      this.push();
      this.dragPushed = true;
    }
    const u = this.unit(), dx = (x - this.sx) / u, dy = (y - this.sy) / u;
    if (this.drag === DRAG_MOVE) {
      this.sel.forEach((idx, j) => {
        const o = this.origs[j];
        this.strokes[idx] = stroke(o.pts.map((v, k) => v + (k % 2 ? dy : dx)), o.color, o.width, o.kind, o.fill);
      });
      return;
    }
    if (this.singleLine()) {
      // 直線・矢印: つまんだ端だけ動かす（矢印の羽は作り直す）
      const o = this.origs[0];
      let [x0, y0, x1, y1] = o.pts;
      if (this.handleNo === 0) { x0 += dx; y0 += dy; } else { x1 += dx; y1 += dy; }
      const p = o.kind === ARROW ? this.arrowPts(x0, y0, x1, y1, o.width) : [x0, y0, x1, y1];
      this.strokes[this.sel[0]] = stroke(p, o.color, o.width, o.kind, o.fill);
      return;
    }
    // 角をつまんだ: 反対の角を動かさずに、縦横を広げる・縮める
    const b = this.origBounds, h = this.handleNo;
    const fx = h === 0 || h === 3 ? b.r : b.l, fy = h === 0 || h === 1 ? b.b : b.t;
    const cx = h === 0 || h === 3 ? b.l : b.r, cy = h === 0 || h === 1 ? b.t : b.b;
    const min = 8 / u, ow = cx - fx, oh = cy - fy;
    let nw = ow + dx, nh = oh + dy;
    // 小さくしすぎて裏返らないように
    if ((Math.abs(ow) > 1e-4 && Math.sign(nw) !== Math.sign(ow)) || Math.abs(nw) < min) nw = (ow < 0 ? -1 : 1) * min;
    if ((Math.abs(oh) > 1e-4 && Math.sign(nh) !== Math.sign(oh)) || Math.abs(nh) < min) nh = (oh < 0 ? -1 : 1) * min;
    const scx = Math.abs(ow) < 1e-4 ? 1 : nw / ow, scy = Math.abs(oh) < 1e-4 ? 1 : nh / oh;
    // まとめて選んだときは、線の太さも一緒に変える（字を縮めても太くならないように）
    const group = this.sel.length > 1;
    const wsc = group ? Math.sqrt(Math.abs(scx * scy)) : 1, minW = 0.8 / u;
    this.sel.forEach((idx, j) => {
      const o = this.origs[j];
      const w = group ? Math.max(minW, o.width * wsc) : o.width;
      let p = o.pts.map((v, k) => (k % 2 ? fy + (v - fy) * scy : fx + (v - fx) * scx));
      if (o.kind === ARROW) p = this.arrowPts(p[0], p[1], p[2], p[3], w); // 羽の形がくずれないように作り直す
      this.strokes[idx] = stroke(p, o.color, w, o.kind, o.fill);
    });
  }
}
