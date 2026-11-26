'use strict';
// イラレCAD：ドキュメント（パスとグループの木）の操作

// ================= ドキュメント（パスとグループの木） =================
const isGroup = (n) => n.type === 'group';
function leaves(nodes, out = []) { for (const n of nodes) { if (isGroup(n)) leaves(n.children, out); else out.push(n); } return out; }
function allItems() { return doc.layers.flatMap((L) => leaves(L.items)); }
function findIn(arr, id, L, anc) {
  for (let i = 0; i < arr.length; i++) {
    const n = arr[i];
    if (n.id === id) return { item: n, layer: L, parent: arr, index: i, ancestors: anc };
    if (isGroup(n)) { const r = findIn(n.children, id, L, anc.concat([n])); if (r) return r; }
  }
  return null;
}
function findItem(id) { for (const L of doc.layers) { const r = findIn(L.items, id, L, []); if (r) return r; } return null; }
const layerWritable = (L) => !!L && L.visible && !L.locked;
function isEditable(f) { return layerWritable(f.layer) && !f.item.hidden && !f.item.locked && f.ancestors.every((g) => !g.hidden && !g.locked); }
// 上にあるものから順に、編集できるパス
function editableItemsTopDown() {
  const out = [];
  const walk = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { const n = arr[i]; if (n.hidden || n.locked) continue; if (isGroup(n)) walk(n.children); else if (inInputPlane(n)) out.push(n); } };   // 操作している平面の上のパスだけ（平面図では床に平行なもの）
  for (let li = doc.layers.length - 1; li >= 0; li--) if (layerWritable(doc.layers[li])) walk(doc.layers[li].items);
  return out;
}
// 見えているパス（スナップ先）
function visibleLeaves() {
  const out = [];
  const walk = (arr) => { for (const n of arr) { if (n.hidden) continue; if (isGroup(n)) walk(n.children); else out.push(n); } };
  for (const L of doc.layers) if (L.visible) walk(L.items);
  return out;
}
function walkNodes(fn) { const w = (arr) => arr.forEach((n) => { fn(n); if (isGroup(n)) w(n.children); }); doc.layers.forEach((L) => w(L.items)); }
function pruneGroups(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const n = arr[i];
    if (isGroup(n)) { pruneGroups(n.children); if (!n.children.length) arr.splice(i, 1); }
  }
}
function reid(n) { n.id = uid(); if (isGroup(n)) n.children.forEach(reid); return n; }
function topOf(it) { const f = findItem(it.id); return f && f.ancestors.length ? f.ancestors[0] : it; }
function activeLayerObj() { return doc.layers.find((L) => L.id === S.activeLayer) || doc.layers[doc.layers.length - 1]; }
function ensureActiveLayer() {
  if (!doc.layers.length) doc.layers.push(newDoc().layers[0]);
  if (!doc.layers.some((L) => L.id === S.activeLayer)) S.activeLayer = doc.layers[doc.layers.length - 1].id;
}
function newItem(subs, isLine) {
  return { id: uid(), subs, fill: isLine ? null : S.fill, stroke: isLine ? S.stroke || '#000000' : S.stroke, sw: S.sw, rule: 'nonzero', hidden: false, locked: false };
}
function removeItem(id) {
  const f = findItem(id);
  if (!f) return;
  f.parent.splice(f.index, 1);
  leaves([f.item]).forEach((it) => S.sel.delete(it.id));
}
// 単位の換算：形・方向線・線の太さ・押し出し・作業平面の位置を k 倍する（mm ⇔ pt）
function scaleNodeUnits(n, k) {
  if (isGroup(n)) { (n.children || []).forEach((c) => scaleNodeUnits(c, k)); return n; }
  for (const sb of n.subs || []) for (const nd of sb.nodes || []) {
    nd.x *= k; nd.y *= k;
    if (nd.hin) nd.hin = P(nd.hin.x * k, nd.hin.y * k);
    if (nd.hout) nd.hout = P(nd.hout.x * k, nd.hout.y * k);
  }
  if (isFinite(n.sw)) n.sw *= k;
  if (n.x3d) n.x3d = { ...n.x3d, z0: n.x3d.z0 * k, h: n.x3d.h * k };
  if (n.plane) n.plane = { ...n.plane, o: n.plane.o.map((v) => v * k) };
  if (n.fold && n.fold.base) n.fold = { ...n.fold, base: { ...n.fold.base, o: n.fold.base.o.map((v) => v * k) } };
  return n;
}
function normalizeLeaf(it) {
  it.id = it.id || uid(); it.rule = it.rule || 'nonzero'; it.sw = isFinite(it.sw) ? it.sw : 0.35;
  it.hidden = !!it.hidden; it.locked = !!it.locked; it.subs = it.subs || [];
  it.fill = it.fill === undefined ? null : it.fill; it.stroke = it.stroke === undefined ? null : it.stroke;
}
// 読み込んだドキュメントの抜けを埋め、ID が重ならないようにする（3D の断面は ID でパスを参照するため）
function normalizeDoc() {
  doc.version = DOC_VERSION;
  if (!Array.isArray(doc.guides)) doc.guides = [];
  if (!Array.isArray(doc.layers)) doc.layers = [];
  // 前の版（pt）や SVG から読んだもの（pt）は mm に直す
  if (doc.units !== 'mm') {
    const k = MM_PER_PT;
    // アートボードは 0.01mm に丸める（A4 の 595.28pt × 841.89pt → 210 × 297mm）
    if (doc.width > 0) doc.width = Math.round(doc.width * k * 100) / 100;
    if (doc.height > 0) doc.height = Math.round(doc.height * k * 100) / 100;
    doc.guides.forEach((g) => { g.v *= k; });
    doc.layers.forEach((L) => (L.items || []).forEach((n) => scaleNodeUnits(n, k)));
    doc.units = 'mm';
  }
  if (!(doc.width > 0)) doc.width = 210;
  if (!(doc.height > 0)) doc.height = 297;
  if (!Array.isArray(doc.solids)) doc.solids = [];
  doc.layers.forEach((L, i) => {
    L.id = L.id || uid(); L.color = L.color || LAYER_COLORS[i % LAYER_COLORS.length];
    L.visible = L.visible !== false; L.locked = !!L.locked; L.items = L.items || [];
  });
  const seen = new Set();
  walkNodes((n) => {
    if (isGroup(n)) { n.children = n.children || []; n.hidden = !!n.hidden; n.locked = !!n.locked; }
    else normalizeLeaf(n);
    if (!n.id || seen.has(n.id)) n.id = uid();
    seen.add(n.id);
  });
  doc.layers.forEach((L) => pruneGroups(L.items));
}
