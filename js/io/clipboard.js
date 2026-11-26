'use strict';
// イラレCAD：クリップボード（イラレとの SVG のやりとり）

// ---- クリップボード（イラレとの SVG のやりとりもここ） ----
function copySelection(cut) {
  const tops = selectedTops();
  if (!tops.length) return;
  const nodes = tops.map((t) => t.node);
  S.clipboard = clone(nodes);
  S.clipText = exportItemsSVG(nodes);
  try { navigator.clipboard.writeText(S.clipText).catch(() => {}); } catch (_) { /* 使えない環境ではアプリ内だけ */ }
  if (cut) { nodes.forEach((n) => removeItem(n.id)); render(); commit(); }
}
// SVG のテキストを貼り付ける。読めたら true
function pasteSvgText(txt, mode) {
  if (!/<svg[\s>]/i.test(txt || '')) return false;
  try {
    const r = parseSVG(txt);
    const nodes = r.layers.flatMap((L) => L.items).map((n) => scaleNodeUnits(n, MM_PER_PT));   // SVG（pt）→ mm
    if (!nodes.length) return false;
    pasteItems(nodes, mode);
    if (r.skipped) toast(`文字や画像など ${r.skipped} 個はまだ読み込めないので飛ばしました`);
    return true;
  } catch (_) { return false; }
}
// イラレはコピーしたものを「image/svg+xml」としてクリップボードに入れる（ふつうの文字としては入れない）。
// paste イベントからは読めないので、Async Clipboard API（Chrome / Edge）で読む。初回だけブラウザが許可を聞く
async function readClipboardSvg() {
  if (!navigator.clipboard || !navigator.clipboard.read) return null;
  const items = await navigator.clipboard.read();
  for (const it of items) {
    for (const t of ['image/svg+xml', 'web image/svg+xml', 'text/plain', 'text/html']) {
      if (!it.types.includes(t)) continue;
      const txt = await (await it.getType(t)).text();
      if (/<svg[\s>]/i.test(txt)) return txt;
    }
  }
  return null;
}
document.addEventListener('paste', (e) => {
  if (isTyping()) return;
  e.preventDefault();
  if (S.pasteHandled) return;
  S.pasteHandled = true;
  const mode = S.pasteMode;
  S.pasteMode = 'center';
  const cd = e.clipboardData;
  const txt = (cd && cd.getData('text/plain')) || '';
  // このアプリでコピーしたもの
  if (S.clipboard && txt && txt === S.clipText) { pasteItems(S.clipboard, mode); return; }
  // テキストの SVG（コードエディタなどからのコピー）
  if (pasteSvgText(txt, mode)) return;
  // イラレなど：SVG は別の形式で入っている
  readClipboardSvg().then((svg) => {
    if (svg && pasteSvgText(svg, mode)) return;
    if (!txt && S.clipboard && !svg) { pasteItems(S.clipboard, mode); return; }
    toast('クリップボードに貼り付けられる形（SVG）が見つかりませんでした');
  }).catch(() => toast('クリップボードを読めませんでした。アドレスバーの左のアイコンから「クリップボード」を許可してください'));
});
