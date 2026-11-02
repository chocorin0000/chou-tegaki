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
