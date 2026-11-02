// 超！手書き Web 版（iPhone・iPad 用）。画面: 一覧・書く・図を描く・保存とバックアップ
import * as N from './note.js';
import * as S from './store.js';
import * as C from './cloud.js';
import { notesPdf } from './pdf.js';
import { InkView } from './ink.js';
import { openDraw } from './draw.js';
import { el, btn, toast, dialog, confirmDlg, TINT_FIG, TINT_DEL, TINT_OK, applyRotation, rotation, viewSize } from './ui.js';

export const VERSION = 'v5';
const $ = id => document.getElementById(id);
const screens = ['list', 'edit', 'draw', 'set'];
function show(name) {
  try { localStorage.setItem('inkmemo.screen', name); } catch (e) { /* なくてもよい */ }
  for (const s of screens) $('scr-' + s).hidden = s !== name;
}

// ---------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------

async function showList() {
  show('list');
  await refreshList();
  C.request(); // まだ送っていないメモがあれば送る（前に送れなかったもののやり直しも）
  if (await C.autoPull()) refreshList(); // 他の機械で書いたメモを取り込む
}

function buildList() {
  const head = $('list-head');
  const title = el('div', 'title');
  title.innerHTML = '<span class="cho">超</span>！手書き';
  const rb = btn('', () => toggleRot());
  rb.classList.add('rot'); rotBtns.push(rb);
  head.append(title, rb, btn('＋ 新しいメモ', () => openEdit(null), ['#FFC94D', '#2E2A20']));
  const row2 = $('list-row2');
  const st = el('div', 'cloud', '');
  st.id = 'cloud-text';
  const size = btn('', () => { S.setSettings({ small: !S.settings().small }); showSize(); refreshList(); });
  size.id = 'size-btn';
  row2.append(st, size, btn('保存・バックアップ', () => showSettings()));
  showSize();
  C.onStatus(s => { $('cloud-text').textContent = s; });
}

// 横向き: iPhone が画面を回さないときでも、ボタンで中身を 90 度回して横長で使える
const rotBtns = [];
function toggleRot() {
  S.setSettings({ rot: !S.settings().rot });
  applyRot();
}
/** 文字を入力中（キーボードが出ている）か */
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
function applyRot() {
  if (typing()) return; // キーボードで大きさが変わっても、並べ直さない
  const s = S.settings();
  applyRotation(s.rot, s.rotOther);
  const portrait = innerWidth < innerHeight; // 機械がもう横長なら、ボタンは出さない
  for (const b of rotBtns) {
    b.textContent = rotation() ? '縦向き' : '横向き';
    b.style.display = portrait ? '' : 'none';
  }
  if (ink) arrange();
}

function showSize() {
  // 押すとどうなるかを書く
  $('size-btn').textContent = S.settings().small ? '一覧: 小 → 大' : '一覧: 大 → 小';
}

async function refreshList() {
  const box = $('list-box');
  const notes = await S.listNotes();
  box.innerHTML = '';
  if (!notes.length) {
    box.appendChild(el('div', 'empty',
      'メモはまだありません。\n右上の「＋ 新しいメモ」で書き始めてください。\n\n書き方:\n' +
      '・画面のどこに書いても、指を離すと字が小さくなって行に入ります。\n' +
      '・2 本指でなぞると、ノートが上下に動きます。\n' +
      '・何も書きかけていないときに軽くタップすると、そこにカーソルが動きます。\n' +
      '・Apple Pencil で書くと、そのあとは指 1 本でノートが動きます（手のひらが当たっても書かれません）。\n' +
      '・一覧の「︙」で、送ったり（PDF・画像）消したりできます。'));
    return;
  }
  const small = S.settings().small;
  const rowW = box.clientWidth - 20;
  for (const n of notes) box.appendChild(makeRow(n, rowW, small));
}

function makeRow(n, rowW, small) {
  const row = el('div', 'row' + (small ? ' small' : ''));
  const lineH = small ? 28 : 44;
  const dateW = small ? 88 : 0;
  const cv = firstLine(n, Math.max(60, rowW - (small ? dateW + 56 : 52)), lineH);
  const date = el('div', 'date', N.fmtDate(n.updated, small));
  const more = el('button', 'more', '︙');
  more.type = 'button';
  more.addEventListener('click', e => { e.stopPropagation(); rowMenu(n); });
  if (small) row.append(cv, date, more);
  else { const col = el('div', 'col'); col.append(cv, date); row.append(col, more); }
  row.addEventListener('click', () => openEdit(n.id));
  return row;
}

/** 1 行目の書き出し（改行か行の右端まで）を絵にする */
function firstLine(n, w, h) {
  const cv = el('canvas', 'first');
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  c.strokeStyle = '#B9CFE6'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, h - 0.5); c.lineTo(w, h - 0.5); c.stroke();
  const pen = N.canvasPen(c);
  let x = 0;
  for (const it of n.items) {
    if (it.type === N.NEWLINE) break;
    if (it.type === N.FIGURE) { if (x === 0) N.drawFigure(pen, it, 0, 0, h, w / h); break; }
    if (x * h > w) break;
    if (it.type === N.GLYPH) N.drawGlyph(pen, it, x * h, 0, h, Math.max(1.4, h * 0.045));
    x += it.w;
  }
  return cv;
}

async function rowMenu(n) {
  const v = await dialog({
    title: N.fmtDate(n.updated) + ' のメモ',
    items: [{ text: '送る・保存（PDF・画像）', value: 'send' }, { text: '消す', value: 'del' }],
  });
  if (v === 'send') shareNote(n);
  else if (v === 'del') {
    if (await confirmDlg(N.fmtDate(n.updated) + ' のメモ', '消す', 'このメモを消しますか?')) {
      await S.deleteNote(n.id);
      C.markDeleted(n.id); // クラウドでは「消したメモ」フォルダに移す
      refreshList();
    }
  }
}

// ---------------------------------------------------------------
// 書く
// ---------------------------------------------------------------

let ink, note, dirty = false, saveTimer = 0;
const E = {};

function buildEdit() {
  ink = new InkView($('ink'));
  ink.onChanged = () => { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(saveLocal, 1500); };
  ink.onFigureTap = (idx, fig) => drawFigure(idx, fig);
  E.list = btn('一覧', () => leaveEdit());
  E.fig = btn('図を描く', () => { ink.commitNow(); figMenu(); }, TINT_FIG);
  E.send = btn('送る', () => { ink.commitNow(); shareNote(note); });
  E.left = btn('◀', () => ink.moveCursor(-1));
  E.right = btn('▶', () => ink.moveCursor(1));
  E.space = btn('空白', () => ink.insertSpace());
  E.nl = btn('改行', () => ink.insertNewline(), TINT_OK);
  E.del = btn('消す', () => ink.backspace(), TINT_DEL);
  E.undo = btn('戻す', () => ink.undo());
  E.rot = btn('', () => toggleRot());
  rotBtns.push(E.rot);
  arrange();
  // iPhone は向きを変えた直後だと、まだ前の大きさを返すことがあるので、少し待ってからも並べ直す
  // 待ちは重ねない（大きさが何度も変わっても、最後の 1 回だけ並べ直す）
  let t1 = 0, t2 = 0;
  const again = () => {
    clearTimeout(t1); clearTimeout(t2);
    t1 = setTimeout(applyRot, 60); t2 = setTimeout(applyRot, 700);
  };
  addEventListener('resize', again);
  addEventListener('orientationchange', again);
  if (window.screen && screen.orientation) screen.orientation.addEventListener('change', again);
  matchMedia('(orientation: landscape)').addEventListener('change', again);
}

/** ボタンの並びを、今の向きに合わせる（横長で低い画面は L 字: 右の列と下の段） */
let lastLand = null;
function arrange() {
  const [w, h] = viewSize();
  const land = w > h && h < 560;
  const key = land + '/' + rotation();
  if (key === lastLand) { if (ink) ink.resize(); return; }
  lastLand = key;
  const scr = $('scr-edit');
  scr.classList.toggle('land', land);
  const side = $('edit-side'), r1 = $('edit-row1'), r2 = $('edit-row2');
  side.innerHTML = r1.innerHTML = r2.innerHTML = '';
  if (land) {
    side.append(E.undo, E.del, E.space, E.nl);
    r1.append(E.list, E.send, E.fig, E.rot, E.left, E.right);
  } else {
    r1.append(E.list, E.fig, E.send, E.rot);
    r2.append(E.left, E.right, E.space, E.nl, E.del, E.undo);
  }
}

async function openEdit(id) {
  note = id ? await S.loadNote(id) : null;
  if (!note) note = N.newNote();
  dirty = false;
  show('edit');
  ink.setNote(note);
  ink.resize();
}

async function saveLocal() {
  clearTimeout(saveTimer);
  if (!note) return;
  if (!note.items.length) return; // 何も書いていないメモは、一覧に戻るときに消す
  if (!dirty) return;
  note.updated = Date.now();
  dirty = false;
  await S.saveNote(note);
}

async function leaveEdit() {
  ink.commitNow();
  if (!note.items.length) {
    await S.deleteNote(note.id);
    C.markDeleted(note.id);
  } else await saveLocal();
  note = null;
  showList();
}

// 書いている途中でホーム画面に戻ったときなども、ここで保存してクラウドに送る
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'hidden' || !note || $('scr-edit').hidden) return;
  ink.commitNow();
  await saveLocal();
  C.request();
});

// ---- 図 ----

/** 図を描く: メモに図がなければすぐ新しい図。あれば、新しい図か、前の図を直す・消すかを選ぶ */
async function figMenu() {
  const figs = [];
  note.items.forEach((it, i) => { if (it.type === N.FIGURE) figs.push(i); });
  if (!figs.length) { drawFigure(-1, null); return; }
  const body = el('div', 'figlist');
  const add = btn('＋ 新しい図を描く（カーソルの位置に入る）', () => pick({ act: 'new' }), TINT_FIG);
  add.classList.add('wide');
  body.append(add, el('div', 'hint', '前に描いた図（ノートの図をタップしても直せます）'));
  let pick;
  const chosen = new Promise(ok => { pick = ok; });
  figs.forEach((idx, k) => {
    const fig = note.items[idx];
    const r = el('div', 'figrow');
    const th = figThumb(fig, 130, 90);
    th.addEventListener('click', () => pick({ act: 'fix', idx }));
    const col = el('div', 'figcol');
    const bs = el('div', 'figbtns');
    bs.append(btn('直す', () => pick({ act: 'fix', idx })), btn('消す', () => pick({ act: 'del', idx, no: k + 1 }), TINT_DEL));
    col.append(el('div', 'figname', '図 ' + (k + 1)), bs);
    r.append(th, col);
    body.appendChild(r);
  });
  const dlgP = dialog({ title: '図', body, cancel: '閉じる' });
  const v = await Promise.race([chosen, dlgP]);
  document.querySelectorAll('.dlg-back').forEach(b => b.remove());
  if (!v) return;
  if (v.act === 'new') drawFigure(-1, null);
  else if (v.act === 'fix') drawFigure(v.idx, note.items[v.idx]);
  else if (v.act === 'del' && await confirmDlg(`図 ${v.no} を消しますか？（下の「戻す」で元に戻せます）`, '消す')) ink.replaceFigure(v.idx, null);
}

/** 図の小さな絵（枠に収まるように縮める） */
function figThumb(fig, w, h) {
  const cv = el('canvas', 'thumb');
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  c.fillStyle = '#FFFDF5'; c.fillRect(0, 0, w, h);
  const u = Math.min((w - 8) / fig.w, (h - 8) / fig.h);
  N.drawFigure(N.canvasPen(c), fig, (w - fig.w * u) / 2, (h - fig.h * u) / 2, u, fig.w);
  return cv;
}

async function drawFigure(idx, fig) {
  show('draw');
  const res = await openDraw($('scr-draw'), fig, ink.figureWidth());
  show('edit');
  ink.resize();
  if (res.remove) ink.replaceFigure(idx, null);
  else if ('done' in res) {
    if (idx >= 0) ink.replaceFigure(idx, res.done); // 描き直し（全部消したら図も消える）
    else if (res.done) ink.insertFigure(res.done);
  }
}

// ---------------------------------------------------------------
// 送る（PDF・画像）
// ---------------------------------------------------------------

async function shareNote(n) {
  if (!n || !n.items.length) { toast('まだ何も書いていません'); return; }
  const v = await dialog({
    title: 'このメモを送る・保存する',
    items: [{ text: 'PDF で送る（拡大してもきれい・印刷向き）', value: 'pdf' },
            { text: '画像で送る（LINE などですぐ見える）', value: 'png' }],
  });
  if (!v) return;
  toast(v === 'pdf' ? 'PDF を作っています…' : '画像を作っています…');
  try {
    // 名前: 前にクラウドに保存したときに読んだ冒頭の文字があれば使う（ここでは読みに行かない）
    const head = await C.headFor(n, false);
    let blob;
    if (v === 'pdf') blob = new Blob([await notesPdf([n])], { type: 'application/pdf' });
    else blob = await new Promise(ok => renderImage(n).toBlob(ok, 'image/png'));
    const file = new File([blob], N.fileName(n, head, v === 'pdf' ? '.pdf' : '.png'), { type: blob.type });
    await sendFile(file);
  } catch (e) {
    toast('作れませんでした: ' + e.message, true);
  }
}

/** iPhone・iPad の「共有」の画面（LINE・メール・ファイルに保存・画像を保存など）を出す */
export async function sendFile(file) {
  // 共有の画面は、ボタンを押した直後でないと出せないので、できあがってからもう一度押してもらう
  const ok = await dialog({
    title: 'できました', message: file.name,
    buttons: [{ text: '送る・保存する', value: true }],
  });
  if (!ok) return;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); }
    catch (e) { if (e.name !== 'AbortError') toast('送れませんでした: ' + e.message, true); }
    return;
  }
  // 共有の画面がない（パソコンなど）: ダウンロード
  const a = el('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/** メモを画像にする。幅 1200 ピクセル、罫線のノートで、高さは書いた行の数に合わせる */
function renderImage(n) {
  const W = 1200, M = 48, HEAD = 56, lineH = 64;
  const maxW = (W - M * 2) / lineH;
  const { lineOf, xOf, lines: l0 } = N.layout(n.items, maxW);
  const lines = Math.max(3, l0);
  const h = Math.min(M + HEAD + lines * lineH + M, 13000);
  const cv = el('canvas');
  cv.width = W; cv.height = h;
  const c = cv.getContext('2d');
  c.fillStyle = '#FFFDF5'; c.fillRect(0, 0, W, h);
  c.strokeStyle = '#B9CFE6'; c.lineWidth = 2;
  c.beginPath();
  for (let l = 0; l < lines; l++) { const y = M + HEAD + (l + 1) * lineH; c.moveTo(M, y); c.lineTo(W - M, y); }
  c.stroke();
  c.fillStyle = '#808080';
  c.font = '24px -apple-system, "Hiragino Sans", sans-serif';
  c.fillText('手書きメモ　' + N.fmtDate(n.updated), M, M + 24);
  const pen = N.canvasPen(c);
  n.items.forEach((it, i) => {
    if (it.type === N.GLYPH || it.type === N.FIGURE)
      N.drawItem(pen, it, M + xOf[i] * lineH, M + HEAD + lineOf[i] * lineH, lineH, maxW, lineH * 0.045);
  });
  return cv;
}

// ---------------------------------------------------------------
// 保存・バックアップ（設定）
// ---------------------------------------------------------------

function showSettings() {
  show('set');
  const s = S.settings();
  const box = $('set-box');
  box.innerHTML = '';
  const sec = t => box.appendChild(el('div', 'section', t));
  const note = t => box.appendChild(el('div', 'note', t));
  const label = t => box.appendChild(el('div', 'label', t));
  const result = el('div', 'result');
  const say = t => { result.textContent = t; };

  sec('自動でクラウドに保存（Google ドライブ）');
  note('Android の超！手書きと同じスクリプト（URL と合言葉）を入れると、書き終えるたびに Google ドライブの「手書きメモ」フォルダへ自動で保存します。'
    + 'どの機械（iPhone・iPad・Android）で書いたメモも同じフォルダに入り、ほかの機械のメモも取り込めます。');
  label('ウェブアプリの URL（/exec で終わるもの）');
  const url = el('textarea', 'input');
  url.rows = 2; url.value = s.url; url.placeholder = 'https://script.google.com/macros/s/…/exec';
  url.autocapitalize = 'off'; url.spellcheck = false;
  box.appendChild(url);
  label('合言葉（スクリプト プロパティの PASSWORD と同じもの）');
  const key = el('input', 'input');
  key.type = 'password'; key.value = s.key; key.autocapitalize = 'off'; key.spellcheck = false;
  box.appendChild(key);
  const check = (text, on, fn) => {
    const l = el('label', 'check');
    const c = el('input');
    c.type = 'checkbox'; c.checked = on;
    c.addEventListener('change', () => fn(c.checked));
    l.append(c, document.createTextNode(text));
    box.appendChild(l);
    return c;
  };
  check('合言葉を見せる', false, on => { key.type = on ? 'text' : 'password'; });
  const auto = check('書き終えたら自動でクラウドに保存する', s.auto, () => {});
  const pull = check('一覧を開いたとき、ほかの機械で書いたメモを取り込む', s.pull, () => {});
  check('「横向き」ボタンで回す向きを反対にする（右に倒して持つ）', s.rotOther, on => { S.setSettings({ rotOther: on }); applyRot(); });
  const save = () => S.setSettings({ url: url.value.trim(), key: key.value.trim(), auto: auto.checked, pull: pull.checked });
  for (const x of [url, key]) x.addEventListener('change', save);
  for (const x of [auto, pull]) x.addEventListener('change', save);

  const button = (t, fn) => { const b = btn(t, fn); b.classList.add('wide'); box.appendChild(b); };
  button('保存して、つながるか試す', async () => {
    save();
    if (!C.configured()) { say('URL と合言葉の両方を入れてください。'); return; }
    say('試しています…');
    try {
      const r = await C.ping();
      say(`つながりました。\nGoogle ドライブのフォルダ「${r.folder}」に保存します。\nいまクラウドにあるメモ: ${r.count} 件`);
      C.request();
    } catch (e) { say('つながりませんでした。\n' + e.message); }
  });
  button('今すぐ全部をクラウドに保存', () => {
    save();
    if (!C.configured()) { say('先に URL と合言葉を入れてください。'); return; }
    C.syncNow();
    say('送り始めました。一覧の上に進み具合が出ます。');
  });
  button('クラウドからメモを取り込む', async () => {
    save();
    if (!C.configured()) { say('先に URL と合言葉を入れてください。'); return; }
    say('クラウドのメモを調べています…');
    try {
      const plan = await C.planPull();
      const info = `クラウドにあるメモ: ${plan.cloudCount} 件\nここにない・クラウドのほうが新しい: ${plan.ids.length} 件\n`
        + `ここのほうが新しいか同じ（そのまま）: ${plan.newer} 件`;
      if (!plan.ids.length) { say(info + '\n\n取り込むメモはありません。'); return; }
      say(info);
      if (!await confirmDlg(info, '取り込む', `${plan.ids.length} 件のメモを取り込みますか?`, false)) return;
      const n = await C.pull(plan, say);
      say(`${n} 件のメモを取り込みました。一覧で見られます。`);
    } catch (e) { say('途中で失敗しました。もう一度押すと、残りを取り込みます。\n' + e.message); }
  });
  box.appendChild(result);

  sec('全部のメモを 1 つの PDF にする');
  note('全部のメモを 1 つの PDF にまとめて、送ったり「ファイル」に保存したりできます（見る用）。');
  button('全部のメモを PDF にして送る・保存する', async () => {
    const notes = await S.listNotes();
    if (!notes.length) { toast('まだメモがありません'); return; }
    toast('PDF を作っています…');
    const d = new Date();
    const name = `手書きメモ_全部_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.pdf`;
    const pdf = await notesPdf(notes.slice().reverse());
    sendFile(new File([pdf], name, { type: 'application/pdf' }));
  });

  sec('はじめての準備（パソコンでするのがおすすめ）');
  note('Android の超！手書きで使っているスクリプトを、そのまま使います。\n'
    + '・ファイル名に冒頭の文字を入れるには、新しいスクリプト（Code.gs）に貼り替えて、スクリプト プロパティに GEMINI_KEY（Gemini の API キー）を足し、「デプロイを管理」→ 鉛筆 → バージョン「新バージョン」→「デプロイ」をしてください。URL は変わりません。\n'
    + '・GEMINI_KEY がないときは、ファイル名は「メモ_作った日時.pdf」になります。');
  box.appendChild(el('div', 'ver', '超！手書き Web 版 ' + VERSION + '　' + innerWidth + '×' + innerHeight + ' / ' + screen.width + '×' + screen.height + ' / ' + viewSize().join('×') + (navigator.standalone ? ' H' : '')));
  const lg = readLog();
  if (lg.length) box.appendChild(el('div', 'ver', '記録:\n' + lg.slice(-8).join('\n')));
}

// ---------------------------------------------------------------
// はじめ
// ---------------------------------------------------------------

// 困ったときのための小さな記録（設定の画面のいちばん下に出す）
function readLog() { try { return JSON.parse(localStorage.getItem('inkmemo.log') || '[]'); } catch (e) { return []; } }
function addLog(t) {
  try {
    const d = new Date(), l = readLog();
    l.push(`${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} ${t}`);
    localStorage.setItem('inkmemo.log', JSON.stringify(l.slice(-20)));
  } catch (e) { /* なくてもよい */ }
}
addEventListener('error', e => addLog('エラー ' + (e.message || '') + ' ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || '')));
addEventListener('unhandledrejection', e => addLog('エラー ' + ((e.reason && e.reason.message) || e.reason)));

function start() {
  let prev = '';
  try { prev = localStorage.getItem('inkmemo.screen') || ''; } catch (e) { /* */ }
  addLog(`起動 ${VERSION}（前は ${prev || '-'} の画面）${innerWidth}×${innerHeight}`);
  $('set-back').addEventListener('click', () => showList());
  document.addEventListener('focusin', e => { if (/INPUT|TEXTAREA/.test(e.target.tagName)) addLog('入力の枠を押した'); });
  buildList();
  buildEdit();
  applyRot();
  // ブラウザの拡大・ページのはね返りで、書いている画面が動かないように
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('touchmove', e => { if (e.target.tagName === 'CANVAS') e.preventDefault(); }, { passive: false });
  S.askPersist();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  addEventListener('online', () => C.request());
  showList();
}

start();
