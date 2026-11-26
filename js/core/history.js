'use strict';
// イラレCAD：取り消し・やり直し・自動保存
// 画面には直接さわらない。変わったことは onDocChange で登録した関数に知らせる

const H = { stack: [], idx: -1, max: 300, listeners: [] };

// kind：'commit'（操作を確定した）／'restore'（取り消し・やり直しで doc が入れ替わった）
function onDocChange(fn) { H.listeners.push(fn); }
function emitDocChange(kind) { for (const fn of H.listeners) fn(kind); }

function resetHistory() { H.stack = [JSON.stringify(doc)]; H.idx = 0; }

// 1つの操作が終わったら呼ぶ（ドラッグ中は呼ばず、離したときに1回だけ）
function commit() {
  doc.layers.forEach((L) => pruneGroups(L.items));
  const s = JSON.stringify(doc);
  if (H.stack[H.idx] !== s) {
    H.stack.length = H.idx + 1;
    H.stack.push(s);
    if (H.stack.length > H.max) H.stack.shift();
    H.idx = H.stack.length - 1;
    autosave(s);
  }
  emitDocChange('commit');
}
function restoreState() {
  doc = JSON.parse(H.stack[H.idx]);
  autosave(H.stack[H.idx]);
  emitDocChange('restore');
}
const canUndo = () => H.idx > 0;
const canRedo = () => H.idx < H.stack.length - 1;
function undo() { if (S.drag || !canUndo()) return; H.idx--; restoreState(); }
function redo() { if (S.drag || !canRedo()) return; H.idx++; restoreState(); }

function autosave(s) {
  try { localStorage.setItem(AUTOSAVE_DOC, s || JSON.stringify(doc)); localStorage.setItem(AUTOSAVE_NAME, S.fileName); } catch (_) { /* 保存できなくても続ける */ }
}
function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_DOC);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && Array.isArray(d.layers) ? { doc: d, name: localStorage.getItem(AUTOSAVE_NAME) } : null;
  } catch (_) { return null; }
}
