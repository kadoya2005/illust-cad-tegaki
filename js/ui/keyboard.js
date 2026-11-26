'use strict';
// イラレCAD：キーボードショートカット

// ================= キーボード =================
function isTyping() {
  const a = document.activeElement;
  if (!a) return false;
  if (a.isContentEditable || a.tagName === 'TEXTAREA') return true;
  return a.tagName === 'INPUT' && !['color', 'button', 'checkbox', 'file'].includes(a.type);
}
function refreshMods(e) {
  if (e) { S.keys.ctrl = e.ctrlKey || e.metaKey; S.keys.alt = e.altKey; S.keys.shift = e.shiftKey; }
  if (e && S.drag && S.drag.type === 'move') refreshMoveDrag(e);   // ドラッグ中の Alt：コピー ⇔ 移動
  updateCursor();
  if (!S.drag) {
    // Alt を押した・離したときに、カーソルの横の印とステータスバーをすぐ切り替える
    if (S.mouse && S.mouseScr && displayTool() === 'pen') S.penHint = penHint(S.mouse, S.keys.alt, S.mouseScr);
    showToolStatus();
    drawOverlay();
    updateCursor();   // 方向線や枠の位置が描き直されたあとで、もう一度
  }
}

document.addEventListener('keydown', (e) => {
  if (dlg) {
    if (e.key === 'Enter') { e.preventDefault(); dlgClose('ok'); }
    else if (e.key === 'Escape') { e.preventDefault(); dlgClose('cancel'); }
    return;
  }
  if (!$('help').hidden) { if (e.key === 'Escape' || e.key === 'F1') { e.preventDefault(); toggleHelp(false); } return; }
  if (isTyping()) { if (e.key === 'Escape' || e.key === 'Enter') document.activeElement.blur(); return; }
  const k = e.key, c = e.code, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey, alt = e.altKey;
  if (k === 'Alt') { e.preventDefault(); refreshMods(e); return; }
  if (k === 'Control' || k === 'Shift' || k === 'Meta') { refreshMods(e); return; }
  if (c === 'Space' || k === ' ') { e.preventDefault(); if (!S.spaceDown && (!S.drag || /^pen/.test(S.drag.type))) { S.spaceDown = true; refreshMods(e); } return; }   // ペンのドラッグ中の Space はアンカーの移動
  // 日本語入力がオンでも効くように物理キー（code）を優先し、なければ key から読む
  let kc = c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : /^Numpad\d$/.test(c) ? c.slice(6) : null;
  if (!kc && /^[a-z0-9]$/i.test(k)) kc = k.toUpperCase();
  // 日本語キーボードでは「;」がズームイン、「:」がガイド。英語キーボードでは「;」がガイド
  const plus = k === '+' || k === '=' || (k === ';' && S.jis) || c === 'NumpadAdd';
  const minus = k === '-' || c === 'NumpadSubtract';
  const brR = k === ']' || k === '}', brL = k === '[' || k === '{';

  if (ctrl) {
    let ok = true;
    if (k === ':' || (k === ';' && !S.jis)) { if (alt) toggleGuideLock(); else toggleGuides(); }
    // グリッド：日本語キーボードは Ctrl+¥・Ctrl+Shift+¥（イラレと同じ）、英語キーボードは Ctrl+'・Ctrl+Shift+'
    else if (c === 'IntlYen' || k === '¥' || k === '|' || (k === '\\' && S.jis)) { if (sh) toggleSnapGrid(); else toggleGrid(); }
    else if (k === "'" || (k === '"' && c === 'Quote')) { if (sh) toggleSnapGrid(); else toggleGrid(); }
    else if (kc === 'Z') { if (sh) redo(); else undo(); }
    else if (kc === 'Y') toggleOutline();
    else if (kc === 'A') { if (sh) deselectAll(); else selectAll(); }
    else if (kc === 'D') transformAgain();
    else if (kc === 'F') pasteItems(S.clipboard, 'front');
    else if (kc === 'B') pasteItems(S.clipboard, 'back');
    else if (kc === 'G') { if (sh) ungroupSelection(); else groupSelection(); }
    else if (kc === 'J') { if (alt) averageAnchors(); else joinPaths(); }
    else if (kc === 'K') openPrefs();
    else if (kc === 'H') { S.hideEdges = !S.hideEdges; drawOverlay(); }
    else if (kc === 'R') toggleRulers();
    else if (kc === 'U') toggleSmart();
    else if (kc === 'S') save(sh);
    else if (kc === 'E' && alt) exportSvgFile();
    else if (kc === 'O') openFile();
    else if (kc === '8') { if (alt && sh) releaseCompound(); else makeCompound(); }
    else if (kc === '2') { if (alt) unlockAll(); else lockSelection(); }
    else if (kc === '3') { if (alt) showAll(); else hideSelection(); }
    else if (kc === '0') fitView();
    else if (kc === '1' && sh && !alt) resetViewRotation();   // 回転ビューをリセット（イラレと同じ）
    else if (kc === '1' && !alt) zoomAt(stageCenter(), 1);
    else if (plus) zoomStep(1);
    else if (minus) zoomStep(-1);
    else if (brR) arrange(sh ? 'front' : 'forward');
    else if (brL) arrange(sh ? 'back' : 'backward');
    else if (kc === 'C') copySelection(false);
    else if (kc === 'X') copySelection(true);
    else if (kc === 'V') {
      // 外から来た SVG は paste イベントで受け取る。イベントが来なければアプリ内のクリップボードを使う
      const mode = sh ? 'inplace' : 'center';
      S.pasteMode = mode; S.pasteHandled = false;
      setTimeout(() => { if (!S.pasteHandled) { S.pasteHandled = true; pasteItems(S.clipboard, mode); } }, 120);
      ok = false;
    }
    else ok = false;
    if (ok) e.preventDefault();
    return;
  }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (!deleteSelectedDims()) deleteSelection(); return; }
  if (k === 'Enter' || k === 'Escape') {
    if (S.drawing) { e.preventDefault(); endDrawing(); }
    else if (k === 'Escape' && S.dimDraft) { S.dimDraft = null; drawOverlay(); }
    else if (k === 'Escape') { closeMenus(); if (S.foldHinge) { S.foldHinge = null; render(); updateUI(); } }   // オレンジの折り線を外す
    else if (SEL_TOOLS.has(S.tool) && S.sel.size) { e.preventDefault(); openXfDialog('move'); }   // イラレと同じく Enter で「移動」
    return;
  }
  if (k.startsWith('Arrow')) {
    e.preventDefault();
    if (roundRectKey(k, sh)) return;
    const st = sh ? S.keyStep * 10 : S.keyStep;
    nudge(k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0, alt);
    return;
  }
  if (k === 'Tab') { e.preventDefault(); document.body.classList.toggle(sh ? 'nopanelsR' : 'nopanels'); renderView(); return; }
  if (k === 'F1') { e.preventDefault(); toggleHelp(true); return; }
  if (e.repeat) return;
  if (kc === 'C' && sh) { setTool('convert'); return; }
  if (kc === 'X') { if (sh) swapColors(); else toggleActiveColor(); return; }
  if (kc === 'D' && !sh) { defaultColors(); return; }
  if (kc && !sh && !alt && TOOL_KEYS[kc]) { setTool(TOOL_KEYS[kc]); return; }
  if (plus) { setTool('addAnchor'); return; }
  if (minus) { setTool('deleteAnchor'); return; }
  if (k === '\\' || k === '¥' || c === 'IntlYen' || c === 'IntlRo' || (c === 'Backslash' && k === 'Process')) { setTool('line'); return; }
  if (k === '/' || c === 'NumpadDivide') { setColor(S.activeColor, null); return; }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.key === ' ') S.spaceDown = false;
  if (e.key === 'Alt') e.preventDefault();
  refreshMods(e);
});
window.addEventListener('blur', () => { S.spaceDown = false; S.keys = { ctrl: false, alt: false, shift: false }; updateCursor(); });
