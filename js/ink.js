// 手書きの画面（Android 版の InkView と同じ動き）。
import { localPos } from './ui.js';
// 画面のどこに書いてもよく、指を離してしばらく書かなければ、書いた字を小さくしてカーソルの位置に入れる。
// - 2 本指でなぞる: ノートを上下に動かす
// - 軽くタップ（何も書きかけていないとき）: そこにカーソルを動かす。図をタップすると図を直す
// - Apple Pencil で書いたあとは、指 1 本でなぞるとノートが動く（手のひらで字が書かれないように）
import { layout, drawItem, glyph, space, newline, span, figScale, canvasPen, GLYPH, NEWLINE, FIGURE, inkWidth } from './note.js';

export const COMMIT_DELAY_MS = 700;

export class InkView {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.pen = canvasPen(this.ctx);
    this.lineH = 40; this.marginL = 18; this.marginR = 10; this.marginT = 12;
    this.note = null; this.cursor = 0; this.scrollY = 0;
    this.pending = []; this.cur = null;
    this.lastTop = -1; this.lastH = -1;
    this.undoStack = [];
    this.ptrs = new Map();
    this.scrolling = false; this.penSeen = false;
    this.timer = 0;
    this.onChanged = null; this.onFigureTap = null;
    this.lay = { lineOf: [], xOf: [], lines: 1 };
    this.w = 0; this.h = 0;
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.cancel(e));
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = { width: this.cv.clientWidth, height: this.cv.clientHeight }; // 回していても中身から見た大きさ
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    if (r.width === this.w && r.height === this.h && this.cv.width === Math.round(r.width * dpr)) { this.draw(); return; }
    this.w = r.width; this.h = r.height;
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ensureCursorVisible();
    this.draw();
  }

  setNote(n) {
    this.note = n;
    this.cursor = n.items.length;
    this.undoStack = [];
    this.pending = []; this.cur = null;
    this.lastTop = this.lastH = -1;
    this.scrollY = 0;
    this.ensureCursorVisible();
    this.invalidate();
  }

  maxW() { return (this.w - this.marginL - this.marginR) / this.lineH; }
  /** 図の幅（行の単位）。図を描く画面の幅が、この幅になる */
  figureWidth() { return Math.max(4, this.maxW()); }

  // ---- ボタンから呼ぶ操作 ----

  commitNow() { clearTimeout(this.timer); this.commitPending(); }
  insertSpace() { this.commitNow(); this.insert(space()); }
  insertNewline() { this.commitNow(); this.insert(newline()); }
  insertFigure(f) { this.commitNow(); this.insert(f); }

  /** index の図を描き直したものと入れ替える（fig が null なら消す） */
  replaceFigure(index, fig) {
    if (!this.note || index < 0 || index >= this.note.items.length) return;
    this.pushUndo();
    if (!fig) {
      this.note.items.splice(index, 1);
      if (this.cursor > index) this.cursor--;
    } else this.note.items[index] = fig;
    this.changed();
  }

  /** 書きかけがあればその最後の 1 画を、なければカーソルの前の 1 つを消す */
  backspace() {
    if (this.pending.length) {
      this.pending.pop();
      clearTimeout(this.timer);
      if (this.pending.length) this.timer = setTimeout(() => this.commitPending(), COMMIT_DELAY_MS);
      this.invalidate();
      return;
    }
    if (this.cursor === 0) return;
    this.pushUndo();
    this.note.items.splice(this.cursor - 1, 1);
    this.cursor--;
    this.changed();
  }

  /** 書きかけがあればそれを捨てる。なければ 1 つ前の状態に戻す */
  undo() {
    if (this.pending.length) {
      this.pending = [];
      clearTimeout(this.timer);
      this.invalidate();
      return;
    }
    const s = this.undoStack.pop();
    if (!s) return;
    this.note.items = s.items;
    this.cursor = s.cursor;
    this.changed();
  }

  moveCursor(d) {
    this.commitNow();
    this.cursor = Math.max(0, Math.min(this.note.items.length, this.cursor + d));
    this.ensureCursorVisible();
    this.invalidate();
  }

  insert(it) {
    this.pushUndo();
    this.note.items.splice(this.cursor, 0, it);
    this.cursor++;
    this.changed();
  }

  pushUndo() {
    this.undoStack.push({ items: this.note.items.slice(), cursor: this.cursor });
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  changed() {
    this.ensureCursorVisible();
    this.invalidate();
    if (this.onChanged) this.onChanged();
  }

  // ---- 書いた字をノートに入れる ----

  commitPending() {
    if (!this.pending.length || !this.note) return;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const s of this.pending) for (let k = 0; k < s.length; k += 2) {
      bx0 = Math.min(bx0, s[k]); bx1 = Math.max(bx1, s[k]);
      by0 = Math.min(by0, s[k + 1]); by1 = Math.max(by1, s[k + 1]);
    }
    const bw = bx1 - bx0, bh = by1 - by0;
    const ref = this.w * 0.3; // 前に字を入れていないときの「ふつうの字の高さ」
    let refH, top;
    if (this.lastH > 0 && bh < this.lastH * 0.6) {
      // 小さな字（「、」「。」「ー」など）: 前の字と同じ大きさの枠の中の位置に置く
      refH = this.lastH; top = this.lastTop;
    } else if (this.lastH < 0 && bh < ref * 0.5) {
      refH = ref; top = (by0 + by1) / 2 - ref / 2;
    } else {
      refH = Math.max(bh, 1); top = by0;
      this.lastH = refH; this.lastTop = top;
    }
    const pad = 0.06, s = 0.8 / refH;
    let minY = Infinity, maxY = -Infinity;
    const strokes = this.pending.map(src => {
      const dst = new Array(src.length);
      for (let k = 0; k < src.length; k += 2) {
        dst[k] = (src[k] - bx0) * s + pad;
        dst[k + 1] = 0.1 + (src[k + 1] - top) * s;
        minY = Math.min(minY, dst[k + 1]); maxY = Math.max(maxY, dst[k + 1]);
      }
      return dst;
    });
    // 行からはみ出すときは、上下にずらして行の中に入れる
    let shift = 0;
    if (maxY > 1.0) shift = 1.0 - maxY;
    if (minY + shift < 0.02) shift = 0.02 - minY;
    if (shift) for (const st of strokes) for (let k = 1; k < st.length; k += 2) st[k] += shift;
    const w = Math.max(bw * s + pad * 2, 0.18);
    this.pending = [];
    this.insert(glyph(w, strokes));
  }

  // ---- 並べる・描く ----

  doLayout() {
    this.lay = this.note ? layout(this.note.items, this.maxW()) : { lineOf: [], xOf: [], lines: 1 };
  }

  /** カーソルの位置 [行番号, x]（行の単位）。カーソルは items[c] の前 */
  cursorPos(c) {
    if (c === 0) return [0, 0];
    const prev = this.note.items[c - 1];
    if (prev.type === NEWLINE) return [this.lay.lineOf[c - 1] + 1, 0];
    if (prev.type === FIGURE) return [this.lay.lineOf[c - 1] + span(prev, this.maxW()), 0];
    return [this.lay.lineOf[c - 1], this.lay.xOf[c - 1] + prev.w];
  }

  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const c = this.ctx, w = this.w, h = this.h, L = this.lineH;
    if (!w) return;
    c.fillStyle = '#FFFDF5';
    c.fillRect(0, 0, w, h);
    if (!this.note) return;
    this.doLayout();
    const first = Math.max(0, Math.floor((this.scrollY - this.marginT) / L));
    const last = Math.floor((this.scrollY + h - this.marginT) / L) + 1;
    c.strokeStyle = '#B9CFE6'; c.lineWidth = 1;
    c.beginPath();
    for (let l = first; l <= last; l++) {
      const y = Math.round(this.marginT + (l + 1) * L - this.scrollY) + 0.5;
      c.moveTo(0, y); c.lineTo(w, y);
    }
    c.stroke();
    c.strokeStyle = '#F0B8B8';
    c.beginPath();
    c.moveTo(this.marginL - 6.5, 0); c.lineTo(this.marginL - 6.5, h);
    c.stroke();
    const mw = this.maxW(), { lineOf, xOf } = this.lay, iw = inkWidth(L);
    this.note.items.forEach((it, i) => {
      if (it.type !== GLYPH && it.type !== FIGURE) return;
      const l = lineOf[i], lEnd = it.type === FIGURE ? l + span(it, mw) : l;
      if (lEnd < first - 1 || l > last) return;
      drawItem(this.pen, it, this.marginL + xOf[i] * L, this.marginT + l * L - this.scrollY, L, mw, iw);
    });
    // カーソル
    const cp = this.cursorPos(this.cursor);
    const cx = this.marginL + cp[1] * L, ct = this.marginT + cp[0] * L - this.scrollY;
    c.fillStyle = '#E04040';
    c.fillRect(cx - 1, ct + L * 0.12, 2.5, L * 0.83);
    // 書きかけ（画面いっぱいの大きさのまま、青で）
    for (const s of this.pending) this.pen.stroke(s, 0, 0, 1, 0xB02F6FB0 | 0, 6);
    if (this.cur) this.pen.stroke(this.cur, 0, 0, 1, 0xB02F6FB0 | 0, 6);
  }

  maxScroll() {
    this.doLayout();
    return Math.max(0, this.marginT + (this.lay.lines + 2) * this.lineH - this.h);
  }

  ensureCursorVisible() {
    if (!this.note || !this.h) return;
    this.doLayout();
    const top = this.marginT + this.cursorPos(this.cursor)[0] * this.lineH;
    if (top - this.lineH < this.scrollY) this.scrollY = Math.max(0, top - this.lineH);
    // カーソルの行の下に、もう 2 行見えるようにする
    if (top + this.lineH * 3 > this.scrollY + this.h) this.scrollY = top + this.lineH * 3 - this.h;
    this.scrollY = Math.max(0, Math.min(this.scrollY, this.maxScroll()));
  }

  // ---- タッチ ----

  pos(e) {
    return localPos(e, this.cv);
  }

  avgY() {
    let s = 0;
    for (const p of this.ptrs.values()) s += p[1];
    return this.ptrs.size ? s / this.ptrs.size : 0;
  }

  down(e) {
    if (!this.note) return;
    e.preventDefault();
    try { this.cv.setPointerCapture(e.pointerId); } catch (x) { /* なくてよい */ }
    const p = this.pos(e);
    clearTimeout(this.timer);
    if (e.pointerType === 'pen') {
      // Apple Pencil: いつも書く（手のひらが画面に触れていても）
      this.penSeen = true;
      this.startStroke(e, p);
      return;
    }
    this.ptrs.set(e.pointerId, p);
    // ペンで書いている人の指、または 2 本目の指: 書かずにノートを動かす
    if (this.penSeen || this.ptrs.size >= 2) {
      if (!this.penSeen) { this.cur = null; this.drawId = null; }
      this.scrolling = true;
      this.lastScrollY = this.avgY();
      this.invalidate();
      return;
    }
    this.scrolling = false;
    this.startStroke(e, p);
  }

  startStroke(e, p) {
    this.drawId = e.pointerId;
    this.cur = [p[0], p[1]];
    this.downTime = e.timeStamp;
    this.invalidate();
  }

  move(e) {
    if (e.pointerId === this.drawId && this.cur) {
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of (evs.length ? evs : [e])) this.add(this.pos(ev));
      if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, this.pos(e));
      this.invalidate();
      return;
    }
    if (!this.ptrs.has(e.pointerId)) return;
    e.preventDefault();
    this.ptrs.set(e.pointerId, this.pos(e));
    if (this.scrolling) {
      const y = this.avgY();
      this.scrollY = Math.max(0, Math.min(this.maxScroll(), this.scrollY + this.lastScrollY - y));
      this.lastScrollY = y;
      this.invalidate();
    }
  }

  add(p) {
    const a = this.cur, n = a.length;
    if (n >= 2 && Math.abs(a[n - 2] - p[0]) < 0.5 && Math.abs(a[n - 1] - p[1]) < 0.5) return;
    a.push(p[0], p[1]);
  }

  up(e) {
    const p = this.pos(e);
    if (e.pointerId === this.drawId) {
      this.drawId = null;
      this.ptrs.delete(e.pointerId);
      if (this.cur) {
        this.add(p);
        if (!this.pending.length && this.isTap(this.cur, e.timeStamp - this.downTime)) {
          const fi = this.figureAt(p[0], p[1]);
          if (fi >= 0 && this.onFigureTap) this.onFigureTap(fi, this.note.items[fi]);
          else this.tapCursor(p[0], p[1]);
        } else {
          this.pending.push(this.cur);
          this.timer = setTimeout(() => this.commitPending(), COMMIT_DELAY_MS);
        }
        this.cur = null;
      }
      this.invalidate();
      return;
    }
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    if (this.scrolling) {
      if (this.ptrs.size) { this.lastScrollY = this.avgY(); return; }
      this.scrolling = false;
      if (this.pending.length && !this.cur) this.timer = setTimeout(() => this.commitPending(), COMMIT_DELAY_MS);
    }
    this.invalidate();
  }

  cancel(e) {
    this.ptrs.delete(e.pointerId);
    if (e.pointerId === this.drawId) { this.drawId = null; this.cur = null; }
    if (!this.ptrs.size) this.scrolling = false;
    if (this.pending.length) this.timer = setTimeout(() => this.commitPending(), COMMIT_DELAY_MS);
    this.invalidate();
  }

  isTap(a, ms) {
    if (ms > 300) return false;
    for (let k = 0; k < a.length; k += 2)
      if (Math.abs(a[k] - a[0]) > 8 || Math.abs(a[k + 1] - a[1]) > 8) return false;
    return true;
  }

  /** タップした場所にある図の番号（なければ -1） */
  figureAt(x, y) {
    this.doLayout();
    const mw = this.maxW(), L = this.lineH;
    const items = this.note.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type !== FIGURE) continue;
      const top = this.marginT + this.lay.lineOf[i] * L - this.scrollY;
      const bottom = top + span(it, mw) * L;
      const right = this.marginL + it.w * figScale(it, mw) * L;
      if (y >= top && y <= bottom && x >= this.marginL - 6 && x <= right) return i;
    }
    return -1;
  }

  /** タップした場所にいちばん近いカーソルの位置へ動かす */
  tapCursor(x, y) {
    this.doLayout();
    const line = Math.floor((y + this.scrollY - this.marginT) / this.lineH);
    const ux = (x - this.marginL) / this.lineH;
    let best = this.note.items.length, bestD = Infinity;
    for (let c = 0; c <= this.note.items.length; c++) {
      const p = this.cursorPos(c);
      if (Math.floor(p[0]) !== line) continue;
      const d = Math.abs(p[1] - ux);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (bestD === Infinity) best = line < 0 ? 0 : this.note.items.length; // 字のない行
    this.cursor = best;
    this.invalidate();
  }
}
