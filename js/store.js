// メモの保存（iPhone・iPad の中。ブラウザの IndexedDB）と、設定（localStorage）
import { toJson, fromJson } from './note.js';

let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((ok, ng) => {
    const r = indexedDB.open('inkmemo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('notes');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  });
  return dbp;
}

function tx(mode, fn) {
  return db().then(d => new Promise((ok, ng) => {
    const t = d.transaction('notes', mode);
    const st = t.objectStore('notes');
    const res = fn(st);
    t.oncomplete = () => ok(res && 'result' in res ? res.result : undefined);
    t.onerror = () => ng(t.error);
  }));
}

export async function saveNote(n) {
  await tx('readwrite', st => st.put(toJson(n), n.id));
}

export async function deleteNote(id) {
  await tx('readwrite', st => st.delete(id));
}

export async function loadNote(id) {
  const s = await tx('readonly', st => st.get(id));
  return s ? fromJson(id, s) : null;
}

/** 全部のメモ（新しく書き直した順） */
export async function listNotes() {
  const d = await db();
  return new Promise((ok, ng) => {
    const out = [];
    const t = d.transaction('notes', 'readonly');
    const req = t.objectStore('notes').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      try { out.push(fromJson(c.key, c.value)); } catch (e) { /* 壊れたものはとばす */ }
      c.continue();
    };
    t.oncomplete = () => ok(out.sort((a, b) => b.updated - a.updated));
    t.onerror = () => ng(t.error);
  });
}

/** ブラウザに「消さないで」と頼む（ホーム画面に追加したアプリでは、ふつうは消されない） */
export function askPersist() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* なくてよい */ }
}

// ---- 設定 ----

const PREF = 'inkmemo.settings';
const DEF = { url: '', key: '', auto: true, pull: true, small: false, rot: false, rotOther: false, autoSpace: false };

export function settings() {
  try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(PREF) || '{}')); }
  catch (e) { return Object.assign({}, DEF); }
}
export function setSettings(patch) {
  const s = Object.assign(settings(), patch);
  try { localStorage.setItem(PREF, JSON.stringify(s)); } catch (e) { /* 保存できなくても動く */ }
  return s;
}

// クラウドに送ったときの updated（メモごと）と、クラウドで「消したメモ」に移してもらうメモ
const SYNC = 'inkmemo.sync';
export function syncState() {
  try { return Object.assign({ sent: {}, del: [] }, JSON.parse(localStorage.getItem(SYNC) || '{}')); }
  catch (e) { return { sent: {}, del: [] }; }
}
export function setSyncState(s) {
  try { localStorage.setItem(SYNC, JSON.stringify(s)); } catch (e) { /* なくてよい */ }
}
