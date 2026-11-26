'use strict';
// イラレCAD：ファイルを開く・保存
//   .icad … 作業用の保存形式（中身は JSON）。ガイド・ID・3D の情報までそのまま残る
//   .svg  … イラレとやりとりする形式。開いた SVG はそのまま SVG に上書きできる

const isSvgName = (n) => /\.svg$/i.test(n || '');
const baseName = (n) => (n || '名称未設定').replace(/\.(svg|icad|json)$/i, '');
const ICAD_TYPE = { description: 'イラレCAD', accept: { 'application/json': ['.icad'] } };
const SVG_TYPE = { description: 'SVG', accept: { 'image/svg+xml': ['.svg'] } };

function serializeIcad() { return JSON.stringify({ app: 'illustcad', version: DOC_VERSION, doc }); }

// 読み込んだドキュメントに入れ替える（共通の後始末）
function setDocument(d, name, handle, skipped) {
  doc = d;
  if (!doc.layers || !doc.layers.length) doc.layers = newDoc().layers;
  normalizeDoc();
  S.sel.clear(); S.drawing = null; S.selGuide = null; S.xfOrigin = null;
  S.activeLayer = doc.layers[doc.layers.length - 1].id;
  S.fileName = name || '名称未設定.icad';
  // 読めなかった要素があるときは、上書き保存で消えないように別名保存にする
  S.fileHandle = skipped ? null : handle || null;
  resetHistory(); autosave(); fitView(); render(); updateUI();
  if (skipped) toast(`文字や画像など ${skipped} 個はまだ読み込めないので飛ばしました（元のファイルは上書きしません）`);
}
function loadDocFromSVG(text, name, handle) {
  let r;
  try { r = parseSVG(text); } catch (err) { toast('SVG を読み込めませんでした：' + err.message); return; }
  setDocument({
    units: 'pt', width: r.width, height: r.height, guides: [], solids: [],   // SVG は pt（normalizeDoc で mm に）
    layers: r.layers.map((L, i) => ({ id: uid(), name: L.name, color: LAYER_COLORS[i % LAYER_COLORS.length], visible: L.visible, locked: L.locked, items: L.items })),
  }, name, handle, r.skipped);
}
function loadDocFromIcad(text, name, handle) {
  let d;
  try {
    const o = JSON.parse(text);
    d = o && o.doc ? o.doc : o;
    if (!d || !Array.isArray(d.layers)) throw new Error('イラレCAD のファイルではありません');
    if (d.version > DOC_VERSION) toast('新しい版のアプリで保存されたファイルです。一部が読めないかもしれません');
  } catch (err) { toast('ファイルを読み込めませんでした：' + err.message); return; }
  setDocument(d, name, handle, 0);
}
function loadFileText(text, name, handle) {
  if (/^\s*\{/.test(text)) loadDocFromIcad(text, name, handle);
  else loadDocFromSVG(text, name, handle);
}

async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'イラレCAD・SVG', accept: { 'application/json': ['.icad'], 'image/svg+xml': ['.svg'] } }] });
      const f = await h.getFile();
      loadFileText(await f.text(), f.name, h);
      return;
    } catch (err) { if (err.name === 'AbortError') return; }
  }
  $('fileInput').click();
}
$('fileInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) loadFileText(await f.text(), f.name, null);
  e.target.value = '';
});

// ファイルに書く。handle があれば上書き、なければ保存先を選んでもらう。どちらも使えなければダウンロード
// 戻り値：保存したファイルの handle（ダウンロードのときは null）、やめたときは false
async function writeFile(text, { name, type, mime, handle }) {
  if (handle) {
    try { const w = await handle.createWritable(); await w.write(text); await w.close(); return handle; } catch (_) { /* 下の方法で保存 */ }
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [type] });
      const w = await h.createWritable(); await w.write(text); await w.close();
      return h;
    } catch (err) { if (err.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return null;
}

// 保存（Ctrl+S）／別名で保存（Ctrl+Shift+S）
async function save(as) {
  if (S.drawing) endDrawing();
  const svg = isSvgName(S.fileName) && !as;
  const name = svg ? S.fileName : baseName(S.fileName) + '.icad';
  const h = await writeFile(svg ? exportDocSVG(doc) : serializeIcad(), {
    name, type: svg ? SVG_TYPE : ICAD_TYPE, mime: svg ? 'image/svg+xml' : 'application/json',
    handle: as ? null : S.fileHandle,
  });
  if (h === false) return;
  S.fileHandle = h || null;
  S.fileName = h ? h.name : name;
  autosave(); updateUI();
  toast(h ? '保存しました：' + S.fileName : 'ダウンロードフォルダーに保存しました：' + S.fileName);
}
// SVG 書き出し（Ctrl+Alt+E）：いま開いているファイルはそのまま
async function exportSvgFile() {
  if (S.drawing) endDrawing();
  const name = baseName(S.fileName) + '.svg';
  const h = await writeFile(exportDocSVG(doc), { name, type: SVG_TYPE, mime: 'image/svg+xml', handle: null });
  if (h === false) return;
  toast(h ? 'SVG を書き出しました：' + h.name : 'ダウンロードフォルダーに書き出しました：' + name);
}
function newDocument() {
  if (allItems().length && !confirm('新しいドキュメントを作りますか？\n保存していない変更は消えます。')) return;
  setDocument(newDoc(), '名称未設定.icad', null, 0);
}
// SVG ファイルをドロップすると、いまのレイヤーに配置
$('stageWrap').addEventListener('dragover', (e) => e.preventDefault());
$('stageWrap').addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = [...e.dataTransfer.files].find((x) => /\.svg$/i.test(x.name) || x.type === 'image/svg+xml');
  if (!f) { toast('SVG ファイルをドロップしてください'); return; }
  try {
    const r = parseSVG(await f.text());
    pasteItems(r.layers.flatMap((L) => L.items), 'center');
    if (r.skipped) toast(`文字や画像など ${r.skipped} 個はまだ読み込めないので飛ばしました`);
  } catch (err) { toast('SVG を読み込めませんでした：' + err.message); }
});
