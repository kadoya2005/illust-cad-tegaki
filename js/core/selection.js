'use strict';
// イラレCAD：選択

// ---- 選択（パス単位。グループは中のパスを全部選ぶ） ----
function nodeCount(it) { return it.subs.reduce((a, sb) => a + sb.nodes.length, 0); }
function selItem(it, add) {
  if (!add) S.sel.clear();
  const set = new Set();
  it.subs.forEach((sb, s) => sb.nodes.forEach((_, i) => set.add(key(s, i))));
  S.sel.set(it.id, set);
}
function selectNode(n, add) { if (!add) S.sel.clear(); leaves([n]).forEach((it) => selItem(it, true)); }
function isFullySel(it) { const set = S.sel.get(it.id); return !!set && set.size >= nodeCount(it); }
function selectedItems() { return allItems().filter((it) => S.sel.has(it.id)); }
// 選ばれている「まとまり」：中身が全部選ばれたグループは1つとして数える
function selectedTops() {
  const out = [];
  const walk = (arr, L) => arr.forEach((n, i) => {
    if (isGroup(n)) {
      const ls = leaves([n]);
      if (ls.length && ls.every((it) => S.sel.has(it.id))) out.push({ node: n, parent: arr, index: i, layer: L });
      else if (ls.some((it) => S.sel.has(it.id))) walk(n.children, L);
    } else if (S.sel.has(n.id)) out.push({ node: n, parent: arr, index: i, layer: L });
  });
  doc.layers.forEach((L) => walk(L.items, L));
  return out;
}
function cleanSel() {
  for (const id of [...S.sel.keys()]) {
    const f = findItem(id);
    if (!f || isGroup(f.item) || !isEditable(f)) { S.sel.delete(id); continue; }
    const set = S.sel.get(id);
    for (const k of [...set]) {
      const [s, i] = k.split(',').map(Number);
      if (!f.item.subs[s] || !f.item.subs[s].nodes[i]) set.delete(k);
    }
  }
  // キーオブジェクトは、選択中のまとまりの中にあるときだけ有効
  if (S.keyId && !selectedTops().some((t) => t.node.id === S.keyId)) { S.keyId = null; if (S.alignTo === 'key') S.alignTo = 'selection'; }
}
function afterSelect() {
  const items = selectedItems();
  if (items.length) S.activeLayer = findItem(items[items.length - 1].id).layer.id;
}
function selectAll() { S.sel.clear(); editableItemsTopDown().forEach((it) => selItem(it, true)); drawOverlay(); updateUI(); }
function deselectAll() { S.sel.clear(); S.selGuide = null; if (S.selDims) S.selDims.clear(); drawOverlay(); updateUI(); }
