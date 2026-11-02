// 1 つのメモと、その並べ方・描き方（Android 版の Note.java と同じ形）
// 中身は「手書きの字」「空白」「改行」「図」の並び。座標は行の高さ = 1 の単位。
// 保存の形（JSON）も Android 版と同じなので、同じ Google ドライブのデータを読み書きできる。

export const GLYPH = 0, SPACE = 1, NEWLINE = 2, FIGURE = 3;
export const SPACE_W = 0.45;
export const INK = 0xFF1A2A40 | 0; // 字の色（Android の int と同じ数）
const SIMPLIFY_EPS = 0.008;

// ---- 並びの 1 つ分 ----

export function glyph(w, strokes) {
  return { type: GLYPH, w, h: 1, s: strokes.map(st => simplify(st, SIMPLIFY_EPS)) };
}
export function space() { return { type: SPACE, w: SPACE_W, h: 1 }; }
export function newline() { return { type: NEWLINE, w: 0, h: 1 }; }

/** 図。ペンの線だけ間引く（四角・丸・矢印は形のまま） */
export function figure(w, h, strokes, colors, widths, kinds) {
  const s = strokes.map((st, i) => (kinds[i] & 0xF) !== 0 ? st : simplify(st, SIMPLIFY_EPS));
  return { type: FIGURE, w, h, s, c: colors, k: widths, m: kinds };
}
export const kindOf = (it, i) => (it.m && i < it.m.length ? it.m[i] : 0);
export const shapeOf = (it, i) => kindOf(it, i) & 0xF;
export const fillOf = (it, i) => (kindOf(it, i) >> 4) & 3;

/** ダグラス・ポーカー法: 線の形を保ったまま、まっすぐな部分の点を減らす */
export function simplify(s, eps) {
  const n = s.length / 2;
  if (n <= 2) return s.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [0, n - 1];
  while (stack.length) {
    const b = stack.pop(), a = stack.pop();
    const ax = s[a * 2], ay = s[a * 2 + 1], dx = s[b * 2] - ax, dy = s[b * 2 + 1] - ay;
    const len = Math.hypot(dx, dy);
    let best = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = s[i * 2] - ax, py = s[i * 2 + 1] - ay;
      const d = len < 1e-6 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / len;
      if (d > best) { best = d; idx = i; }
    }
    if (best > eps) { keep[idx] = 1; stack.push(a, idx, idx, b); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(s[i * 2], s[i * 2 + 1]);
  return out;
}

// ---- メモ ----

export function newNote() {
  const t = Date.now();
  return { id: String(t), created: t, updated: t, items: [] };
}

/** 図を縮める割合（行の幅より広い図は、幅に合わせて縮める） */
export const figScale = (it, maxW) => (it.w > maxW ? maxW / it.w : 1);
/** 図が使う行の数 */
export const span = (it, maxW) => Math.max(1, Math.ceil(it.h * figScale(it, maxW) - 0.02));

/**
 * 行の幅 maxW で、各 item の行番号（lineOf）と左端の x（xOf）を決める。戻り値は行の数。
 * pageLines > 0（PDF）のときは、ページの残りに入らない図を次のページの頭から置く。
 */
export function layout(items, maxW, pageLines = 0) {
  const lineOf = new Array(items.length), xOf = new Array(items.length);
  let line = 0, x = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === FIGURE) {
      if (x > 0) line++;
      const sp = span(it, maxW);
      if (pageLines > 0 && sp <= pageLines && (line % pageLines) + sp > pageLines)
        line = (Math.floor(line / pageLines) + 1) * pageLines;
      lineOf[i] = line; xOf[i] = 0;
      line += sp; x = 0;
      continue;
    }
    if (it.type === NEWLINE) {
      lineOf[i] = line; xOf[i] = x;
      line++; x = 0;
      continue;
    }
    if (x > 0 && x + it.w > maxW) { line++; x = 0; }
    lineOf[i] = line; xOf[i] = x;
    x += it.w;
  }
  return { lineOf, xOf, lines: line + 1 };
}

// ---- 色 ----

/** Android の色の数（0xAARRGGBB の int）を CSS の色に */
export function css(c) {
  c = c >>> 0;
  const a = (c >>> 24) / 255, r = (c >>> 16) & 255, g = (c >>> 8) & 255, b = c & 255;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a.toFixed(3)})`;
}
/** 塗りの色: うすく（1）は線の色を透かしたもの、ぬる（2）は線の色そのまま */
export function fillColor(color, fill) {
  return fill === 1 ? ((color & 0x00FFFFFF) | 0x40000000) | 0 : color | 0;
}
export const argb = hex => (0xFF000000 | hex) | 0;

// ---- 描く ----
// pen は「線を描く・塗る」だけを持つもの（画面の canvas 用と、PDF 用がある）:
//   pen.stroke(pts, ox, oy, scale, color, widthPx)   点 1 つだけなら丸い点
//   pen.fill(pts, ox, oy, scale, color)               閉じた形の中を塗る

export function canvasPen(ctx) {
  return {
    stroke(p, ox, oy, s, color, w) {
      if (p.length < 2) return;
      w = Math.max(1, w);
      if (p.length === 2) {
        ctx.fillStyle = css(color);
        ctx.beginPath();
        ctx.arc(ox + p[0] * s, oy + p[1] * s, w / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.strokeStyle = css(color);
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ox + p[0] * s, oy + p[1] * s);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(ox + p[k] * s, oy + p[k + 1] * s);
      ctx.stroke();
    },
    fill(p, ox, oy, s, color) {
      if (p.length < 6) return;
      ctx.fillStyle = css(color);
      ctx.beginPath();
      ctx.moveTo(ox + p[0] * s, oy + p[1] * s);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(ox + p[k] * s, oy + p[k + 1] * s);
      ctx.closePath();
      ctx.fill();
    },
  };
}

/** 字の線の太さ（ピクセル） */
export const inkWidth = lineH => Math.max(1.6, lineH * 0.045);

export function drawGlyph(pen, g, left, top, lineH, w = inkWidth(lineH)) {
  for (const s of g.s) pen.stroke(s, left, top, lineH, INK, w);
}

export function drawFigure(pen, g, left, top, lineH, maxW) {
  const u = lineH * figScale(g, maxW);
  // 塗りを先に全部描く（あとから書いた字や線が、塗りに隠れないように）
  g.s.forEach((s, i) => {
    const f = fillOf(g, i);
    if (f) pen.fill(s, left, top, u, fillColor(g.c ? g.c[i] : INK, f));
  });
  g.s.forEach((s, i) => {
    pen.stroke(s, left, top, u, g.c ? g.c[i] : INK, Math.max(1, (g.k ? g.k[i] : 0.06) * u));
  });
}

export function drawItem(pen, it, left, top, lineH, maxW, w) {
  if (it.type === GLYPH) drawGlyph(pen, it, left, top, lineH, w);
  else if (it.type === FIGURE) drawFigure(pen, it, left, top, lineH, maxW);
}

// ---- 保存の形（JSON、Android 版と同じ） ----

const r3 = f => Math.round(f * 1000) / 1000;

export function toJson(n) {
  const o = { v: 1, created: n.created, updated: n.updated, items: [] };
  for (const it of n.items) {
    if (it.type === SPACE) o.items.push({ t: 's' });
    else if (it.type === NEWLINE) o.items.push({ t: 'n' });
    else if (it.type === FIGURE) o.items.push({
      t: 'f', w: r3(it.w), h: r3(it.h), s: it.s.map(st => st.map(r3)),
      c: it.c.map(x => x | 0), k: it.k.map(r3), m: it.s.map((_, i) => kindOf(it, i)),
    });
    else o.items.push({ t: 'g', w: r3(it.w), s: it.s.map(st => st.map(r3)) });
  }
  // Android で「文字にする」をしたときの文字（そのまま持っておく）と、ファイル名用の冒頭の文字
  if (n.text != null) { o.text = n.text; o.textSig = n.textSig; }
  if (n.head != null) { o.head = n.head; o.headSig = n.headSig; }
  return JSON.stringify(o);
}

export function fromJson(id, text) {
  const o = JSON.parse(text);
  const n = { id, created: o.created || 0, updated: o.updated || 0, items: [] };
  if (o.text != null) { n.text = o.text; n.textSig = o.textSig; }
  if (o.head != null) { n.head = o.head; n.headSig = o.headSig; }
  for (const j of o.items || []) {
    if (j.t === 's') n.items.push(space());
    else if (j.t === 'n') n.items.push(newline());
    else if (j.t === 'f') {
      const len = j.s.length;
      n.items.push({
        type: FIGURE, w: j.w, h: j.h, s: j.s,
        c: Array.from({ length: len }, (_, i) => (j.c && j.c[i] != null ? j.c[i] : INK) | 0),
        k: Array.from({ length: len }, (_, i) => (j.k && j.k[i] != null ? j.k[i] : 0.06)),
        m: Array.from({ length: len }, (_, i) => (j.m && j.m[i] != null ? j.m[i] : 0)),
      });
    } else n.items.push({ type: GLYPH, w: j.w, h: 1, s: j.s });
  }
  return n;
}

/** 1 行目の中身の印（ファイル名用の冒頭の文字を、読み直すかどうか決める） */
export function headItems(n, max = 14) {
  const out = [];
  for (const it of n.items) {
    if (it.type === NEWLINE || it.type === FIGURE) break;
    out.push(it);
    if (out.filter(x => x.type === GLYPH).length >= max) break;
  }
  return out;
}
export function headSig(n) {
  let h = 7;
  for (const it of headItems(n)) {
    h = (h * 31 + it.type) | 0;
    h = (h * 31 + Math.round(it.w * 1000)) | 0;
    if (it.s) for (const s of it.s) { h = (h * 31 + s.length) | 0; if (s.length) h = (h * 31 + Math.round(s[0] * 1000)) | 0; }
  }
  return (h >>> 0).toString(16);
}

/** ファイル名に使う冒頭: 空白・ファイル名に使えない字・「_」を除いて max 文字まで。終わりの句読点も落とす */
export function headOf(text, max = 12) {
  if (!text) return '';
  let s = text.replace(/[\s　\\/:*?"<>|_〓\u0000-\u001f]/g, '');
  s = Array.from(s).slice(0, max).join('');
  return s.replace(/[。、．，.,!！?？]+$/, '');
}

const pad2 = x => String(x).padStart(2, '0');
/** 「メモ_冒頭の文字_261101-1348.pdf」（Android 版と同じ名前の付け方） */
export function fileName(n, head, ext) {
  const d = new Date(n.created);
  const stamp = `${pad2(d.getFullYear() % 100)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  return 'メモ_' + (head ? head + '_' : '') + stamp + ext;
}

const WD = '日月火水木金土';
export function fmtDate(t, short = false) {
  const d = new Date(t);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (short) return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${hm}`;
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}(${WD[d.getDay()]}) ${hm}`;
}
