'use strict';
// イラレCAD：起動
// ファイルの読み込み順は index.html を見てください（core → render → tools → ui → io → app）

// doc が変わったときの画面の更新（取り消しの仕組みから知らされる）
onDocChange((kind) => {
  if (kind === 'restore') {
    S.selGuide = null;
    const sb = drawingSub();
    if (sb && !sb.closed && sb.nodes.length) selectDrawingLast(); else S.drawing = null;
    cleanSel(); ensureActiveLayer(); render();
  }
  updateUI();
});

function init() {
  // 版の番号：読み込んだ app.js の ?v= から（ページに上げるたびに上げている番号）
  const vm = (document.querySelector('script[src*="app.js"]') || {}).src?.match(/[?&]v=(\d+)/);
  if (vm) $('appVer').textContent = 'ver ' + vm[1];
  loadPrefs();
  initSplit();
  const saved = loadAutosave();
  if (saved) { doc = saved.doc; if (saved.name) S.fileName = saved.name; }
  normalizeDoc(); ensureActiveLayer(); resetHistory();
  buildHelp();
  document.body.classList.toggle('no3d', !S.show3d);
  fitView(); render(); updateUI(); updateCursor();
  document.body.classList.toggle('no3d', !S.show3d);
  window.addEventListener('resize', () => { renderView(); renderViews(); });
  // キーボードの配列（日本語か英語か）を調べる。分からなければ日本語として扱う
  try {
    if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
      navigator.keyboard.getLayoutMap().then((m) => { const v = m.get('BracketLeft'); if (v) S.jis = v === '@'; }).catch(() => {});
    }
  } catch (_) { /* そのまま */ }
}
init();
