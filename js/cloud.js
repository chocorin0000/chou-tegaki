// Google ドライブ（超！手書きの Google Apps Script）への保存と、そこから取り込む処理。
// Android 版と同じスクリプト・同じフォルダを使うので、どの機械で書いたメモも同じ場所に入る。
// - 書き直したメモ（updated が、前に送ったときと違うもの）だけを送る
// - 送るときの PDF の名前は「メモ_冒頭の文字_作った日時.pdf」。冒頭の文字は、1 行目だけを小さな画像にして
//   スクリプトに読ませる（Gemini）。1 行目が変わっていなければ読み直さない（通信を減らすため）
// - 他の機械で書いたメモは、一覧を開いたときに取り込む（設定で OFF にできる）
import { settings, syncState, setSyncState, listNotes, loadNote, saveNote } from './store.js';
import { toJson, fromJson, headSig, headItems, headOf, fileName, canvasPen, drawGlyph, GLYPH } from './note.js';
import { notesPdf } from './pdf.js';

let statusText = '', listener = null, running = false, again = false;

export function onStatus(fn) { listener = fn; if (fn) fn(statusText); }
function setStatus(s) { statusText = s; if (listener) listener(s); }

export const configured = () => { const s = settings(); return !!(s.url && s.key); };

/** スクリプトに送る。ok でなければ例外 */
export async function call(req) {
  const s = settings();
  req.key = s.key;
  let res;
  try {
    // Content-Type を付けない（text/plain）と、ブラウザの前もっての問い合わせがなく、GAS でそのまま受け取れる
    res = await fetch(s.url.trim(), { method: 'POST', body: JSON.stringify(req), redirect: 'follow' });
  } catch (e) {
    throw new Error('つながりません。電波を確かめるか、URL が正しいか確かめてください');
  }
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch (e) {
    throw new Error('答えが読めません。URL が正しいか、デプロイの「アクセスできるユーザー」が「全員」か確かめてください');
  }
  if (!j.ok) throw new Error(j.error || '失敗しました');
  return j;
}

export async function ping() { return call({ action: 'ping' }); }

/** アプリでメモを消したとき（前にクラウドに送っていたら、クラウドでは「消したメモ」へ） */
export function markDeleted(id) {
  const st = syncState();
  if (id in st.sent) {
    delete st.sent[id];
    if (!st.del.includes(id)) st.del.push(id);
    setSyncState(st);
  }
  request();
}

export async function pendingCount() {
  const st = syncState();
  const notes = await listNotes();
  return st.del.length + notes.filter(n => st.sent[n.id] !== n.updated).length;
}

/** 自動保存が ON なら、まだ送っていないものを送る（何度呼んでもよい） */
export function request() {
  if (!configured()) { setStatus('クラウド: 未設定'); return; }
  if (!settings().auto) { setStatus('クラウド: 自動保存 OFF'); return; }
  syncNow();
}

export async function syncNow() {
  if (!configured()) { setStatus('クラウド: 未設定'); return; }
  if (running) { again = true; return; }
  running = true;
  try {
    do { again = false; await syncOnce(); } while (again);
  } finally { running = false; }
}

async function syncOnce() {
  const st = syncState();
  const todo = (await listNotes()).filter(n => st.sent[n.id] !== n.updated);
  const del = st.del.slice();
  if (!todo.length && !del.length) { setStatus('クラウド: 保存済み'); return; }
  if (!navigator.onLine) { setStatus(`クラウド: 電波がないので、あとで送ります（${todo.length + del.length} 件）`); return; }
  const total = todo.length + del.length;
  let done = 0;
  try {
    for (const n of todo) {
      setStatus(`クラウド: 保存中 ${done + 1} / ${total}`);
      const head = await headFor(n);
      const pdf = await notesPdf([n]);
      await call({ action: 'save', id: n.id, updated: n.updated, json: toJson(n), pdfName: fileName(n, head, '.pdf'), pdf: b64(pdf) });
      const s2 = syncState();
      s2.sent[n.id] = n.updated;
      setSyncState(s2);
      done++;
    }
    for (const id of del) {
      setStatus(`クラウド: 保存中 ${done + 1} / ${total}`);
      await call({ action: 'delete', id });
      const s2 = syncState();
      s2.del = s2.del.filter(x => x !== id);
      setSyncState(s2);
      done++;
    }
    setStatus('クラウド: 保存済み');
  } catch (e) {
    setStatus(`クラウド: 送れませんでした（${total - done} 件。あとでやり直します）\n${e.message}`);
  }
}

/**
 * ファイル名用の冒頭の文字。1 行目が前に読んだときと同じなら、覚えているものを使う。
 * 新しく読んだら、メモに覚えておく（updated は変えない）。読めなかったら ''（名前は日時だけになる）
 */
export async function headFor(n, read = true) {
  const sig = headSig(n);
  if (n.headSig === sig) return n.head || '';
  if (!read || !headItems(n).some(it => it.type === GLYPH)) return '';
  let head = '';
  try {
    const r = await call({ action: 'ocr', png: firstLinePng(n) });
    head = headOf(r.text || '', 12);
  } catch (e) {
    // スクリプトが古い（ocr がない）・GEMINI_KEY がない・回数の上限など。名前は日時だけにする
    head = '';
  }
  n.head = head;
  n.headSig = sig;
  const cur = await loadNote(n.id);
  if (cur && cur.updated === n.updated) { cur.head = head; cur.headSig = sig; await saveNote(cur); }
  return head;
}

/** 1 行目（冒頭の 14 字まで）を白地の画像にする（base64 の PNG） */
function firstLinePng(n) {
  const lineH = 64, pad = 8;
  const items = headItems(n);
  let w = 0;
  for (const it of items) w += it.w;
  const cv = document.createElement('canvas');
  cv.width = Math.max(64, Math.ceil(w * lineH + pad * 2));
  cv.height = lineH + pad * 2;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, cv.width, cv.height);
  const pen = canvasPen(c);
  let x = 0;
  for (const it of items) {
    if (it.type === GLYPH) drawGlyph(pen, it, pad + x * lineH, pad, lineH);
    x += it.w;
  }
  return cv.toDataURL('image/png').split(',')[1];
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---- 他の機械で書いたメモを取り込む ----

/** クラウドにあるメモのうち、ここにないもの・クラウドのほうが新しいものを数える */
export async function planPull() {
  const r = await call({ action: 'list' });
  const local = new Map((await listNotes()).map(n => [n.id, n]));
  const st = syncState();
  const ids = [];
  let newer = 0;
  for (const o of r.items) {
    const l = local.get(o.id);
    // ここで消したメモ（クラウドの「消したメモ」へ移す予定のもの）は取り込まない
    if (st.del.includes(o.id)) continue;
    if (!l || l.updated < o.updated) ids.push(o.id);
    else newer++;
  }
  return { ids, cloudCount: r.items.length, newer };
}

export async function pull(plan, progress) {
  let n = 0;
  for (const id of plan.ids) {
    if (progress) progress(`取り込んでいます ${n + 1} / ${plan.ids.length}`);
    const r = await call({ action: 'get', id });
    const note = fromJson(id, r.json);
    await saveNote(note);
    const st = syncState();
    st.sent[id] = note.updated; // クラウドと同じなので、送り直さない
    setSyncState(st);
    n++;
  }
  return n;
}

/** 一覧を開いたとき: 設定が ON なら、他の機械のメモを取り込む。取り込んだ数を返す */
export async function autoPull() {
  const s = settings();
  if (!configured() || !s.pull || !navigator.onLine) return 0;
  try {
    const plan = await planPull();
    if (!plan.ids.length) return 0;
    const n = await pull(plan, t => setStatus('クラウド: ' + t));
    setStatus(`クラウド: ${n} 件のメモを取り込みました`);
    return n;
  } catch (e) {
    return 0;
  }
}
