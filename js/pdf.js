// メモを PDF にする（Android 版の PdfExport と同じ並べ方）。
// 字と図は線（ベクター）のまま入れるので、拡大してもきれいで、ファイルも小さい。用紙は A4 縦。
// v7 から「送る」では、1 行の長さを、書く画面（縦向き / 横向き）の 1 行と同じにできる（行の切れ目が画面と同じになる）。
// 上の日時の文字は、日本語の字の形を PDF に入れなくて済むように、小さな画像（JPEG）にして入れる。
import { layout, drawItem, span, GLYPH, FIGURE, fmtDate } from './note.js';

const PAGE_W = 595, PAGE_H = 842, MARGIN = 40, HEAD = 34, LINE_H0 = 30;
const enc = new TextEncoder();
const num = v => {
  const s = (Math.round(v * 100) / 100).toFixed(2);
  return s.replace(/\.?0+$/, '') || '0';
};
const rgb = c => [(c >>> 16) & 255, (c >>> 8) & 255, c & 255].map(v => num(v / 255)).join(' ');

/** PDF 用の pen（note.js の canvasPen と同じ形）。y は下から上なので裏返す */
function pdfPen(ops, alphas) {
  const path = (p, ox, oy, s) => {
    let out = `${num(ox + p[0] * s)} ${num(PAGE_H - (oy + p[1] * s))} m`;
    for (let k = 2; k < p.length; k += 2) out += ` ${num(ox + p[k] * s)} ${num(PAGE_H - (oy + p[k + 1] * s))} l`;
    return out;
  };
  return {
    stroke(p, ox, oy, s, color, w) {
      if (p.length < 2) return;
      const pts = p.length === 2 ? [p[0], p[1], p[0], p[1]] : p; // 点は長さ 0 の線（丸い端で丸い点になる）
      ops.push(`${rgb(color)} RG ${num(Math.max(0.3, w))} w ${path(pts, ox, oy, s)} S`);
    },
    fill(p, ox, oy, s, color) {
      if (p.length < 6) return;
      const a = ((color >>> 24) & 255) / 255;
      let gs = '';
      if (a < 0.999) {
        const name = 'GA' + Math.round(a * 100);
        alphas[name] = a;
        gs = `/${name} gs `;
      }
      ops.push(`q ${gs}${rgb(color)} rg ${path(p, ox, oy, s)} h f Q`);
    },
  };
}

/** 日時などの小さな文字を画像（JPEG）にする */
async function textImage(text, wPt, hPt) {
  const scale = 4;
  const cv = document.createElement('canvas');
  cv.width = Math.round(wPt * scale);
  cv.height = Math.round(hPt * scale);
  const c = cv.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#808080';
  c.font = `${9 * scale}px -apple-system, "Hiragino Sans", sans-serif`;
  c.textBaseline = 'alphabetic';
  c.fillText(text, 0, cv.height - 3 * scale);
  const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.9));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: cv.width, h: cv.height };
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(await out);
}

/**
 * 全部のメモを 1 つの PDF に。メモごとに新しいページから始める。Uint8Array を返す。
 * lineUnits: 1 行の長さ（行の単位。書く画面の 1 行と同じ値を渡すと、行の切れ目が画面と同じになる）。0 ならいつもの大きさ
 */
export async function notesPdf(notes, lineUnits = 0) {
  const LINE_H = Math.max(14, Math.min(80, lineUnits > 0 ? (PAGE_W - MARGIN * 2) / lineUnits : LINE_H0));
  const top0 = MARGIN + HEAD - LINE_H0; // 1 行目の上（行が高くても、上の日時の字に重ならない）
  const objs = []; // [{dict, stream?}]
  const add = o => { objs.push(o); return objs.length + 2; }; // 1 = Catalog、2 = Pages
  const pageIds = [];
  const alphas = {};

  for (let k = 0; k < notes.length; k++) {
    const n = notes[k];
    const label = notes.length > 1 ? `メモ ${k + 1} / ${notes.length}　　` : '';
    const maxW = (PAGE_W - MARGIN * 2) / LINE_H;
    const perPage = Math.floor((PAGE_H - top0 - MARGIN - HEAD) / LINE_H);
    const { lineOf, xOf, lines } = layout(n.items, maxW, perPage);
    const pages = Math.max(1, Math.ceil(lines / perPage));
    const head = `${label}作成 ${fmtDate(n.created)}　　更新 ${fmtDate(n.updated || Date.now())}`;

    for (let p = 0; p < pages; p++) {
      const ops = [];
      const pen = pdfPen(ops, alphas);
      // 上の文字（画像）
      const text = head + (pages > 1 ? `　　${p + 1} / ${pages} ページ` : '');
      const tw = PAGE_W - MARGIN * 2, th = 14;
      const img = await textImage(text, tw, th);
      const imId = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`, stream: img.bytes });
      ops.push(`q ${num(tw)} 0 0 ${th} ${MARGIN} ${num(PAGE_H - (MARGIN - 4))} cm /Im0 Do Q`);
      // 罫線
      ops.push('1 J 1 j 0.725 0.812 0.902 RG 0.6 w');
      for (let l = 0; l < perPage; l++) {
        const y = num(PAGE_H - (top0 + (l + 1) * LINE_H));
        ops.push(`${MARGIN} ${y} m ${PAGE_W - MARGIN} ${y} l S`);
      }
      // 字と図（ページの行の場所の外は描かない）
      const clipH = perPage * LINE_H + LINE_H * 0.2;
      ops.push(`q 0 ${num(PAGE_H - (top0 + clipH))} ${PAGE_W} ${num(clipH)} re W n`);
      for (let i = 0; i < n.items.length; i++) {
        const it = n.items[i];
        if (it.type !== GLYPH && it.type !== FIGURE) continue;
        const l = lineOf[i] - p * perPage;
        const lEnd = it.type === FIGURE ? l + span(it, maxW) : l + 1;
        if (lEnd <= 0 || l >= perPage) continue;
        drawItem(pen, it, MARGIN + xOf[i] * LINE_H, top0 + l * LINE_H, LINE_H, maxW, LINE_H * 0.045);
      }
      ops.push('Q');
      const raw = enc.encode(ops.join('\n'));
      const z = await deflate(raw);
      const cId = add(z ? { dict: `<< /Length ${z.length} /Filter /FlateDecode >>`, stream: z }
                        : { dict: `<< /Length ${raw.length} >>`, stream: raw });
      const pageId = add({ dict: '' }); // あとで中身を入れる（ExtGState がそろってから）
      objs[pageId - 3].page = { cId, imId };
      pageIds.push(pageId);
    }
  }
  if (!pageIds.length) {
    const cId = add({ dict: '<< /Length 0 >>', stream: new Uint8Array(0) });
    const pageId = add({ dict: '' });
    objs[pageId - 3].page = { cId, imId: 0 };
    pageIds.push(pageId);
  }
  // 透かしの塗り（うすく）の設定
  const gsNames = Object.keys(alphas);
  const gsId = gsNames.length ? add({ dict: '<< ' + gsNames.map(k => `/${k} << /Type /ExtGState /ca ${num(alphas[k])} >>`).join(' ') + ' >>' }) : 0;
  for (const id of pageIds) {
    const pg = objs[id - 3].page;
    const res = [];
    if (pg.imId) res.push(`/XObject << /Im0 ${pg.imId} 0 R >>`);
    if (gsId) res.push(`/ExtGState ${gsId} 0 R`);
    objs[id - 3].dict = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${pg.cId} 0 R /Resources << ${res.join(' ')} >> >>`;
  }

  // 書き出す
  const parts = [];
  let size = 0;
  const offsets = [];
  const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const all = [
    { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { dict: `<< /Type /Pages /Kids [${pageIds.map(i => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>` },
    ...objs,
  ];
  all.forEach((o, i) => {
    offsets.push(size);
    put(`${i + 1} 0 obj\n${o.dict}\n`);
    if (o.stream) { put('stream\n'); put(o.stream); put('\nendstream\n'); }
    put('endobj\n');
  });
  const xref = size;
  put(`xref\n0 ${all.length + 1}\n0000000000 65535 f \n`);
  for (const off of offsets) put(String(off).padStart(10, '0') + ' 00000 n \n');
  put(`trailer\n<< /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let o = 0;
  for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}
