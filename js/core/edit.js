'use strict';
// イラレCAD：編集の操作（変形・重ね順・グループ・パスファインダー・色・貼り付けなど）

// ================= 編集の基本操作 =================
function snapshotSel() { const m = new Map(); for (const it of selectedItems()) m.set(it.id, clone(it.subs)); return m; }
function restoreFrom(orig) { for (const [id, subs] of orig) { const f = findItem(id); if (f) f.item.subs = clone(subs); } }

function duplicateSelection() {
  const tops = selectedTops();
  const copies = [], origs = [];
  for (let k = tops.length - 1; k >= 0; k--) {
    const t = tops[k];
    const c = reid(clone(t.node));
    t.parent.splice(t.index + 1, 0, c);
    copies.push(c); origs.push(t.node);
  }
  // 折った箱のコピーは、コピーどうしで折れたまま（選んだもの全部で ID を付け替える）
  if (typeof remapFoldRefs === 'function') remapFoldRefs(origs, copies);
  S.sel.clear();
  copies.forEach((c) => selectNode(c, true));
}

function insertNode(it, s, seg, t) {
  const sb = it.subs[s], n = sb.nodes, L = n.length;
  const a = n[seg], b = n[(seg + 1) % L];
  let nn;
  if (Geo.isLine(sb, seg)) {
    const m = vlerp(a, b, t);
    nn = mkNode(m.x, m.y);
  } else {
    const [l, r] = splitCubic(...Geo.seg(sb, seg), t);
    const hp = (q, anc) => (vdist(q, anc) < 1e-9 ? null : P(q.x, q.y));
    const m = l[3];
    a.hout = hp(l[1], a);
    nn = mkNode(m.x, m.y, null, null, true);
    nn.hin = hp(l[2], m); nn.hout = hp(r[1], m);
    b.hin = hp(r[2], b);
  }
  n.splice(seg + 1, 0, nn);
  return key(s, seg + 1);
}

// アンカー削除ツール：形をつないだまま消す
function removeAnchorKeepShape(it, s, i) {
  const sb = it.subs[s];
  sb.nodes.splice(i, 1);
  if (sb.nodes.length < 2) it.subs.splice(s, 1);
  if (!it.subs.length) removeItem(it.id); else S.sel.set(it.id, new Set());
}

// Delete キー（ダイレクト選択）：選んだアンカーとそこにつながる線を消す
function deleteSelectedNodes(it, set) {
  const out = [];
  it.subs.forEach((sb, s) => {
    const n = sb.nodes;
    const del = n.map((_, i) => set.has(key(s, i)));
    if (!del.some(Boolean)) { out.push(sb); return; }
    if (del.every(Boolean)) return;
    let order = [...n.keys()];
    if (sb.closed) { const f = del.indexOf(true); order = order.slice(f + 1).concat(order.slice(0, f + 1)); }
    let run = [];
    const flush = () => { if (run.length >= 2) out.push({ nodes: run, closed: false }); run = []; };
    for (const i of order) { if (del[i]) flush(); else run.push(n[i]); }
    flush();
  });
  it.subs = out;
}

function deleteSelection() {
  if (S.segSel && deleteSegment()) return;   // ダイレクト選択でつかんだ線だけを消す
  if (!S.sel.size) {
    if (S.selGuide != null && doc.guides[S.selGuide]) { doc.guides.splice(S.selGuide, 1); S.selGuide = null; drawOverlay(); commit(); }
    return;
  }
  const nodeMode = NODE_TOOLS.has(S.tool);
  for (const it of selectedItems()) {
    const set = S.sel.get(it.id);
    if (!nodeMode || set.size === 0 || set.size >= nodeCount(it)) { removeItem(it.id); continue; }
    deleteSelectedNodes(it, set);
    if (!it.subs.length) removeItem(it.id); else S.sel.set(it.id, new Set());
  }
  S.drawing = null;
  cleanSel(); commit(); render();
}

function nudge(dx, dy, dup) {
  if (!S.sel.size) return;
  if (dup) duplicateSelection();
  const nodeMode = NODE_TOOLS.has(S.tool) && !dup;
  for (const it of selectedItems()) {
    const set = S.sel.get(it.id);
    it.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => { if (nodeMode && !set.has(key(s, i))) return; moveNode(n, dx, dy); }));
  }
  S.lastTransform = { kind: 'move', prm: { dx, dy }, copy: !!dup, origin: null };
  render(); commit();
}

// ---- 変形（移動・回転・リフレクト・拡大縮小）を数値で ----
function xfCenter() {
  if (S.xfOrigin) return S.xfOrigin;
  const bb = Geo.bbox(selectedItems());
  return bb ? P(bb.x + bb.w / 2, bb.y + bb.h / 2) : null;
}
function xfFn(kind, c, prm) {
  if (kind === 'move') return (q) => P(q.x + prm.dx, q.y + prm.dy);
  if (kind === 'rotate') return rotateFn(c, prm.ang);
  if (kind === 'reflect') {
    // 基準点を通り、角度 axis の直線で折り返す
    const c2 = Math.cos(2 * prm.axis), s2 = Math.sin(2 * prm.axis);
    return (q) => { const dx = q.x - c.x, dy = q.y - c.y; return P(c.x + dx * c2 + dy * s2, c.y + dx * s2 - dy * c2); };
  }
  return (q) => P(c.x + (q.x - c.x) * prm.sx, c.y + (q.y - c.y) * prm.sy);
}
function applyXf(kind, prm, copy, origin, preview) {
  if (!S.sel.size) return;
  const c = origin || xfCenter();
  if (!c) return;
  if (copy) duplicateSelection();
  const f = xfFn(kind, c, prm);
  selectedItems().forEach((it) => mapItem(it, f));
  if (preview) { renderArt(); drawOverlay(); return; }
  S.lastTransform = { kind, prm, copy: !!copy, origin: origin ? P(origin.x, origin.y) : null };
  render(); commit();
}
function transformAgain() {
  const t = S.lastTransform;
  if (!t || !S.sel.size) return;
  let origin = t.origin;
  if (t.frac) { const bb = Geo.bbox(selectedItems()); if (bb) origin = P(bb.x + bb.w * t.frac.fx, bb.y + bb.h * t.frac.fy); }
  applyXf(t.kind, t.prm, t.copy, origin);
  if (t.frac) S.lastTransform = t;   // applyXf が上書きした基準点を、枠の中の位置に戻す
}

function arrange(mode) {
  const tops = selectedTops();
  if (!tops.length) return;
  const byParent = new Map();
  for (const t of tops) { if (!byParent.has(t.parent)) byParent.set(t.parent, new Set()); byParent.get(t.parent).add(t.node); }
  for (const [arr, set] of byParent) {
    const isSel = (n) => set.has(n);
    if (mode === 'front' || mode === 'back') {
      const sel = arr.filter(isSel), rest = arr.filter((n) => !isSel(n));
      arr.splice(0, arr.length, ...(mode === 'front' ? rest.concat(sel) : sel.concat(rest)));
    } else if (mode === 'forward') {
      for (let i = arr.length - 2; i >= 0; i--) if (isSel(arr[i]) && !isSel(arr[i + 1])) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    } else {
      for (let i = 1; i < arr.length; i++) if (isSel(arr[i]) && !isSel(arr[i - 1])) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
    }
  }
  render(); commit();
}

// ---- グループ ----
function groupSelection() {
  const tops = selectedTops();
  if (!tops.length) return;
  const last = tops[tops.length - 1];
  const at = last.index - tops.filter((t) => t.parent === last.parent && t.index < last.index).length;
  for (let k = tops.length - 1; k >= 0; k--) tops[k].parent.splice(tops[k].index, 1);
  const g = { type: 'group', id: uid(), name: '', children: tops.map((t) => t.node), hidden: false, locked: false };
  last.parent.splice(at, 0, g);
  selectNode(g, false); afterSelect(); render(); commit();
}
function ungroupSelection() {
  const tops = selectedTops().filter((t) => isGroup(t.node));
  if (!tops.length) { toast('解除できるグループが選ばれていません'); return; }
  for (let k = tops.length - 1; k >= 0; k--) { const t = tops[k]; t.parent.splice(t.index, 1, ...t.node.children); }
  render(); commit();
}

function lockSelection() { const tops = selectedTops(); if (!tops.length) return; tops.forEach((t) => { t.node.locked = true; }); S.sel.clear(); render(); commit(); }
function unlockAll() {
  S.sel.clear();
  const unlocked = [];
  walkNodes((n) => { if (n.locked) { n.locked = false; unlocked.push(n); } });
  unlocked.forEach((n) => leaves([n]).forEach((it) => { const f = findItem(it.id); if (f && isEditable(f)) selItem(it, true); }));
  render(); commit();
}
function hideSelection() { const tops = selectedTops(); if (!tops.length) return; tops.forEach((t) => { t.node.hidden = true; }); S.sel.clear(); render(); commit(); }
function showAll() {
  S.sel.clear();
  const shown = [];
  walkNodes((n) => { if (n.hidden) { n.hidden = false; shown.push(n); } });
  shown.forEach((n) => leaves([n]).forEach((it) => { const f = findItem(it.id); if (f && isEditable(f)) selItem(it, true); }));
  render(); commit();
}

function makeCompound() {
  const items = selectedItems();
  if (items.length < 2) { toast('複合パスにするには、2つ以上のパスを選んでください'); return; }
  const base = items[0];
  for (const it of items.slice(1)) { base.subs.push(...it.subs); removeItem(it.id); }
  base.rule = 'evenodd';
  selItem(base, false); render(); commit();
}
function releaseCompound() {
  const items = selectedItems().filter((it) => it.subs.length > 1);
  if (!items.length) { toast('解除できる複合パスが選ばれていません'); return; }
  S.sel.clear();
  for (const it of items) {
    const f = findItem(it.id);
    const parts = it.subs.map((sb) => ({ ...clone(it), id: uid(), subs: [clone(sb)], rule: 'nonzero' }));
    f.parent.splice(f.index, 1, ...parts);
    parts.forEach((p) => selItem(p, true));
  }
  render(); commit();
}

function joinPaths() {
  const cands = [];
  for (const it of selectedItems()) it.subs.forEach((sb) => { if (!sb.closed && sb.nodes.length >= 2) cands.push({ it, sb }); });
  if (!cands.length) { toast('連結できる開いたパスが選ばれていません'); return; }
  if (cands.length === 1) {
    const n = cands[0].sb.nodes, a = n[0], b = n[n.length - 1];
    if (n.length > 2 && vdist(a, b) < 0.004) { a.hin = b.hin; a.smooth = false; n.pop(); }
    cands[0].sb.closed = true;
    render(); commit(); return;
  }
  const A = cands[0];
  while (cands.length >= 2) {
    let best = null;
    for (let j = 1; j < cands.length; j++) {
      const an = A.sb.nodes, bn = cands[j].sb.nodes;
      const opts = [[an[an.length - 1], bn[0], false, false], [an[an.length - 1], bn[bn.length - 1], false, true], [an[0], bn[0], true, false], [an[0], bn[bn.length - 1], true, true]];
      for (const [p, q, ra, rb] of opts) { const d = vdist(p, q); if (!best || d < best.d) best = { d, j, ra, rb }; }
    }
    const B = cands[best.j];
    if (best.ra) reverseSub(A.sb);
    if (best.rb) reverseSub(B.sb);
    const an = A.sb.nodes, bn = B.sb.nodes, last = an[an.length - 1], first = bn[0];
    if (best.d < 0.004) { last.hout = first.hout; last.smooth = false; an.push(...bn.slice(1)); }
    else { last.hout = null; first.hin = null; an.push(...bn); }
    B.it.subs.splice(B.it.subs.indexOf(B.sb), 1);
    if (!B.it.subs.length) removeItem(B.it.id);
    cands.splice(best.j, 1);
  }
  selItem(A.it, false); render(); commit();
}

// ---- パスファインダー ----
const PF_NAMES = { unite: '合体', minusFront: '前面オブジェクトで型抜き', intersect: '交差', exclude: '中マド', divide: '分割', trim: '刈り込み', minusBack: '背面オブジェクトで型抜き' };
function styleOf(n) { const ls = leaves([n]); const it = ls[ls.length - 1]; return { fill: it.fill, stroke: it.stroke, sw: it.sw }; }
function pathfinder(op) {
  const tops = selectedTops();
  const need = op === 'divide' || op === 'trim' ? 1 : 2;
  if (tops.length < need) { toast(`${PF_NAMES[op]}には、${need === 2 ? '2つ以上の' : ''}オブジェクトを選んでください`); return; }
  let res;
  try {
    res = Pathfinder.run(op, tops.map((t) => ({ leaves: leaves([t.node]), style: styleOf(t.node) })));
  } catch (err) { toast('パスファインダーでエラーが出ました：' + err.message); return; }
  if (!res.length) { toast('結果が空になりました（重なっている部分がありません）'); return; }
  const last = tops[tops.length - 1];
  const at = last.index - tops.filter((t) => t.parent === last.parent && t.index < last.index).length;
  for (let k = tops.length - 1; k >= 0; k--) tops[k].parent.splice(tops[k].index, 1);
  const made = res.map((r) => ({ id: uid(), subs: r.subs, fill: r.style.fill, stroke: r.style.stroke, sw: r.style.sw, rule: 'nonzero', hidden: false, locked: false }));
  const node = (op === 'divide' || op === 'trim') && made.length > 1 ? { type: 'group', id: uid(), name: '', children: made, hidden: false, locked: false } : null;
  last.parent.splice(at, 0, ...(node ? [node] : made));
  S.sel.clear();
  (node ? [node] : made).forEach((n) => selectNode(n, true));
  render(); commit();
}

// ---- 色 ----
function setColor(which, val, doCommit = true) {
  S[which] = val; S.activeColor = which;
  for (const it of selectedItems()) it[which] = val;
  renderArt();
  if (doCommit) commit(); else updateUI();
}
function defaultColors() {
  S.fill = '#ffffff'; S.stroke = '#000000'; S.sw = 0.35;
  for (const it of selectedItems()) { it.fill = S.fill; it.stroke = S.stroke; it.sw = 0.35; }
  renderArt(); commit();
}
function swapColors() {
  const f = S.fill; S.fill = S.stroke; S.stroke = f;
  for (const it of selectedItems()) { const t = it.fill; it.fill = it.stroke; it.stroke = t; }
  renderArt(); commit();
}
function toggleActiveColor() { S.activeColor = S.activeColor === 'fill' ? 'stroke' : 'fill'; updateUI(); }

// ---- 表示の切り替え ----
// 平面図：展開図 ⇔ 組み立てた形（真上から見たところ）
function togglePlanFolded() { S.planFolded = !S.planFolded; savePrefs(); cleanSel(); render(); updateUI(); toast(S.planFolded ? '平面図：組み立てた形（折った面は平面図では直せません）' : '平面図：展開図'); }
function togglePref(k) { S[k] = !S[k]; savePrefs(); renderView(); updateUI(); }
const toggleRulers = () => togglePref('rulers');
// 正面図・側面図を出す／しまう
function toggle3dViews() { S.show3d = !S.show3d; savePrefs(); document.body.classList.toggle('no3d', !S.show3d); renderView(); renderViews(); updateUI(); }
const toggleGrid = () => togglePref('grid');
const toggleSnapGrid = () => togglePref('snapGrid');
const toggleSmart = () => togglePref('smart');
const toggleGuides = () => togglePref('showGuides');
const toggleGuideLock = () => togglePref('guidesLocked');
function clearGuides() { if (!doc.guides.length) return; doc.guides = []; S.selGuide = null; renderView(); commit(); }
function toggleOutline() { S.outline = !S.outline; renderArt(); drawOverlay(); updateUI(); }

// ---- 貼り付け（nodes はパスかグループ） ----
function pasteItems(nodes, mode) {
  if (!nodes || !nodes.length) return;
  let arr = activeLayerObj().items, L = activeLayerObj(), at = null;
  if (mode === 'front' || mode === 'back') {
    const tops = selectedTops();
    if (tops.length) {
      const t = mode === 'front' ? tops[tops.length - 1] : tops[0];
      arr = t.parent; L = t.layer; at = mode === 'front' ? t.index + 1 : t.index;
    } else at = mode === 'front' ? arr.length : 0;
  }
  if (!layerWritable(L)) { toast('ロック中または非表示のレイヤーには貼り付けられません'); return; }
  const copies = clone(nodes).map(reid);
  if (typeof remapFoldRefs === 'function') remapFoldRefs(nodes, copies);
  copies.forEach((n) => { n.hidden = false; n.locked = false; leaves([n]).forEach(normalizeLeaf); });
  if (mode === 'center') {
    const bb = Geo.bbox(leaves(copies));
    if (bb) {
      const c = toDoc(stageCenter());
      const dx = c.x - (bb.x + bb.w / 2), dy = c.y - (bb.y + bb.h / 2);
      leaves(copies).forEach((it) => it.subs.forEach((sb) => sb.nodes.forEach((n) => moveNode(n, dx, dy))));
    }
  }
  if (at === null) at = arr.length;
  arr.splice(at, 0, ...copies);
  S.sel.clear();
  copies.forEach((n) => selectNode(n, true));
  afterSelect(); render(); commit();
}

// ---- 整列（イラレの整列パネルと同じ）----
// 基準：S.alignTo = 'selection'（選択範囲）| 'key'（キーオブジェクト）| 'artboard'（アートボード）
function alignRef(tops) {
  if (S.alignTo === 'artboard' || tops.length === 1) return { x: 0, y: 0, w: doc.width, h: doc.height };
  if (S.alignTo === 'key' && S.keyId) { const t = tops.find((x) => x.node.id === S.keyId); if (t) return Geo.bbox(leaves([t.node])); }
  return Geo.bbox(selectedItems());
}
function moveTop(t, dx, dy) { if (dx || dy) leaves([t.node]).forEach((it) => it.subs.forEach((sb) => sb.nodes.forEach((n) => moveNode(n, dx, dy)))); }
// how：left / hcenter / right / top / vcenter / bottom
function alignObjects(how) {
  const tops = selectedTops();
  if (!tops.length) { toast('揃えるオブジェクトを選んでください'); return; }
  const R = alignRef(tops);
  for (const t of tops) {
    if (S.alignTo === 'key' && t.node.id === S.keyId) continue;
    const b = Geo.bbox(leaves([t.node]));
    if (!b) continue;
    let dx = 0, dy = 0;
    if (how === 'left') dx = R.x - b.x;
    else if (how === 'hcenter') dx = R.x + R.w / 2 - (b.x + b.w / 2);
    else if (how === 'right') dx = R.x + R.w - (b.x + b.w);
    else if (how === 'top') dy = R.y - b.y;
    else if (how === 'vcenter') dy = R.y + R.h / 2 - (b.y + b.h / 2);
    else if (how === 'bottom') dy = R.y + R.h - (b.y + b.h);
    moveTop(t, dx, dy);
  }
  render(); commit();
}
// 分布：オブジェクトの左端（中央・右端…）が等間隔になるように。両端のものは動かさない
function distributeObjects(how) {
  const tops = selectedTops();
  if (tops.length < 3) { toast('分布には3つ以上のオブジェクトを選んでください'); return; }
  const horiz = ['left', 'hcenter', 'right'].includes(how);
  const pos = (b) => {
    if (how === 'left') return b.x; if (how === 'hcenter') return b.x + b.w / 2; if (how === 'right') return b.x + b.w;
    if (how === 'top') return b.y; if (how === 'vcenter') return b.y + b.h / 2; return b.y + b.h;
  };
  const list = tops.map((t) => ({ t, b: Geo.bbox(leaves([t.node])) })).filter((o) => o.b).sort((a, c) => pos(a.b) - pos(c.b));
  const p0 = pos(list[0].b), p1 = pos(list[list.length - 1].b), step = (p1 - p0) / (list.length - 1);
  list.forEach((o, i) => { const d = p0 + step * i - pos(o.b); moveTop(o.t, horiz ? d : 0, horiz ? 0 : d); });
  render(); commit();
}
// 等間隔に分布：オブジェクトのすき間をそろえる。キーオブジェクトがあれば、指定した間隔でキーを動かさずに並べる
function distributeSpacing(axis, gap) {
  const tops = selectedTops();
  const useKey = S.alignTo === 'key' && S.keyId;
  if (tops.length < (useKey ? 2 : 3)) { toast(useKey ? '2つ以上のオブジェクトを選んでください' : '3つ以上のオブジェクトを選ぶか、キーオブジェクトを決めてください'); return; }
  const H = axis === 'h';
  const lo = (b) => (H ? b.x : b.y), size = (b) => (H ? b.w : b.h);
  const list = tops.map((t) => ({ t, b: Geo.bbox(leaves([t.node])) })).filter((o) => o.b).sort((a, c) => lo(a.b) - lo(c.b));
  let g = gap;
  if (!useKey) {
    const span = lo(list[list.length - 1].b) + size(list[list.length - 1].b) - lo(list[0].b);
    g = (span - list.reduce((a, o) => a + size(o.b), 0)) / (list.length - 1);
  }
  const ki = useKey ? list.findIndex((o) => o.t.node.id === S.keyId) : 0;
  // キー（またはいちばん端）から外側へ順に並べる
  let cur = lo(list[ki].b) + size(list[ki].b);
  for (let i = ki + 1; i < list.length; i++) { const d = cur + g - lo(list[i].b); moveTop(list[i].t, H ? d : 0, H ? 0 : d); cur += g + size(list[i].b); }
  cur = lo(list[ki].b);
  for (let i = ki - 1; i >= 0; i--) { const d = cur - g - size(list[i].b) - lo(list[i].b); moveTop(list[i].t, H ? d : 0, H ? 0 : d); cur -= g + size(list[i].b); }
  render(); commit();
}

// ---- パスのオフセット（オブジェクト → パス → パスのオフセット）----
function applyOffset(delta, join, miter, preview) {
  const items = selectedItems();
  if (!items.length) return;
  const made = [];
  for (const it of items) {
    const subs = offsetSubs(it, delta, join, miter);
    if (!subs.length) continue;
    const f = findItem(it.id);
    const n = { ...clone(it), id: uid(), subs, rule: 'nonzero', hidden: false, locked: false };
    f.parent.splice(f.index, 0, n);   // 元のパスのすぐ背面に置く
    made.push(n);
  }
  if (preview) { renderArt(); return; }
  if (!made.length) { toast('オフセットの結果が空になりました（内側に縮めすぎかもしれません）'); return; }
  S.sel.clear();
  made.forEach((n) => selItem(n, true));
  render(); commit();
}
