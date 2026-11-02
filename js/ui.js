// 画面の部品: ボタン・短い知らせ（トースト）・確かめる箱・選ぶ一覧

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** ボタン。tint = [背景, 字の色] */
export function btn(text, onClick, tint) {
  const b = el('button', 'btn', text);
  b.type = 'button';
  if (tint) { b.style.background = tint[0]; b.style.color = tint[1]; b.style.fontWeight = 'bold'; }
  b.addEventListener('click', e => { e.preventDefault(); onClick(e); });
  return b;
}

export const TINT_FIG = ['#BFD9F2', '#1C3D63'];
export const TINT_DEL = ['#F2B8A6', '#8A2A14'];
export const TINT_OK = ['#B8DEC6', '#1E4D33'];

let toastTimer = 0;
export function toast(msg, long = false) {
  let t = document.getElementById('toast');
  if (!t) { t = el('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), long ? 4000 : 2200);
}

/**
 * 箱を出す。buttons = [{text, value, tint}]（右から並ぶ）、items = [{text, value}]（縦の一覧）。
 * body に DOM を入れてもよい。選んだ value で解決（外をタップ・「やめる」は null）
 */
export function dialog({ title, message, items, buttons, body, cancel = 'やめる' }) {
  return new Promise(ok => {
    const back = el('div', 'dlg-back');
    const box = el('div', 'dlg');
    if (title) box.appendChild(el('div', 'dlg-title', title));
    if (message) box.appendChild(el('div', 'dlg-msg', message));
    if (body) { const w = el('div', 'dlg-body'); w.appendChild(body); box.appendChild(w); }
    const close = v => { back.remove(); ok(v); };
    if (items) {
      const list = el('div', 'dlg-items');
      for (const it of items) {
        const b = el('button', 'dlg-item', it.text);
        b.type = 'button';
        b.addEventListener('click', () => close(it.value));
        list.appendChild(b);
      }
      box.appendChild(list);
    }
    const row = el('div', 'dlg-btns');
    if (cancel) row.appendChild(Object.assign(el('button', 'dlg-btn', cancel), { onclick: () => close(null) }));
    for (const b of buttons || []) {
      const x = el('button', 'dlg-btn strong', b.text);
      if (b.tint) { x.style.color = b.tint; }
      x.onclick = () => close(b.value);
      row.appendChild(x);
    }
    box.appendChild(row);
    back.appendChild(box);
    back.addEventListener('click', e => { if (e.target === back) close(null); });
    document.body.appendChild(back);
    // 中の部品から閉じられるように
    back.closeWith = close;
    box.closeWith = close;
  });
}

export function confirmDlg(message, okText, title, danger = true) {
  return dialog({ title, message, buttons: [{ text: okText, value: true, tint: danger ? '#C0392B' : '#1E6FD9' }] });
}

// ---- 横向き（iPhone が画面を回さないときのために、中身を 90 度回す） ----
let rot = 0; // 0 / 90 / -90（いま実際に回している角度）
let lastBody = '';
export const rotation = () => rot;
/** want = 横向きにしたい、other = 反対の向き。機械がもう横長なら回さない */
/**
 * 本当の画面の大きさ。ホーム画面から開いたとき、iPhone は高さを上の帯（47 ほど）の分だけ少なく教えてきて、
 * 下に隙間ができることがある。そのときは画面（screen）の大きさまで広げる。差が大きいとき（iPad の小さい窓など）は広げない。
 */
export function fullSize() {
  let W = innerWidth, H = innerHeight;
  if (navigator.standalone && screen.width && screen.height) {
    const a = Math.max(screen.width, screen.height), b = Math.min(screen.width, screen.height);
    const [fw, fh] = W < H ? [b, a] : [a, b];
    if (fw >= W && fw - W <= 80) W = fw;
    if (fh >= H && fh - H <= 80) H = fh;
  }
  return [W, H];
}
export function applyRotation(want, other) {
  const [W, H] = fullSize();
  rot = want && W < H ? (other ? -90 : 90) : 0;
  const r = document.documentElement, b = document.body.style;
  r.classList.toggle('rot90', rot === 90);
  r.classList.toggle('rot270', rot === -90);
  const want2 = rot
    ? { width: H + 'px', height: W + 'px', transform: rot === 90 ? `translateX(${W}px) rotate(90deg)` : `translateY(${H}px) rotate(-90deg)` }
    : { width: W + 'px', height: H + 'px', transform: '' };
  const k = JSON.stringify(want2);
  if (k === lastBody) return; // 同じなら触らない（触ると、また大きさが変わったことになるため）
  lastBody = k;
  Object.assign(b, { position: 'fixed', left: '0', top: '0', transformOrigin: '0 0' }, want2);
}
/** 中身から見た画面の幅と高さ */
export const viewSize = () => { const [W, H] = fullSize(); return rot ? [H, W] : [W, H]; };
/** 指の位置を、canvas の中の座標に（回しているときは回し戻す） */
export function localPos(e, cv) {
  const r = cv.getBoundingClientRect();
  if (rot === 90) return [e.clientY - r.top, r.right - e.clientX];
  if (rot === -90) return [r.bottom - e.clientY, e.clientX - r.left];
  return [e.clientX - r.left, e.clientY - r.top];
}
