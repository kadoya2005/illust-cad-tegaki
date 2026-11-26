'use strict';
// イラレCAD：寸法ツールと、選択ツールでの寸法の選択・移動
//   1 回目のクリック＝1 点目、2 回目＝2 点目、3 回目＝寸法線の位置（左右に出せば垂直、上下に出せば水平。Shift で斜め）
//   点はアンカーや三面図の角に吸着し、そこにくっつく（形を直すと数値も直る）

// 吸着先：平面図のアンカー（くっつけられる）と、三面図の点
function dimCands() {
  const out = [];
  for (const it of visibleLeaves()) {
    if (!onTop(it)) continue;
    it.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => out.push({ x: n.x, y: n.y, kind: 'アンカー', ref: { k: 'node', id: it.id, s, i } })));
  }
  return out.concat(sheetCands());
}
function dimSnap(p, shift) {
  const cands = dimCands();
  if (shift) return { p, ref: null, viz: null };
  const sn = snapPoint(p, cands);
  const c = cands.find((k) => Math.abs(k.x - sn.p.x) < 1e-9 && Math.abs(k.y - sn.p.y) < 1e-9);
  return { p: sn.p, ref: c ? c.ref : null, viz: sn.viz };
}
Tools.dim = {
  down(e, p) {
    const L = drawingLayer(false);
    if (L && !layerWritable(L)) { toast('図面レイヤーがロック中か非表示です'); return; }
    const dr = S.dimDraft;
    if (dr && dr.b) {
      const pl = dimFromPlace(dr.a, dr.b, p, e.shiftKey);
      const layer = drawingLayer(true);
      const d = { id: uid(), ...pl, a: dr.a, b: dr.b, ra: dr.ra, rb: dr.rb };
      layer.dims.push(d);
      S.dimDraft = null;
      S.selDims = new Set([d.id]);
      render(); commit(); updateUI();
      return;
    }
    const q = dimSnap(p, false);
    if (!dr) { S.dimDraft = { a: q.p, ra: q.ref }; return; }
    if (vdist(q.p, dr.a) < 1e-6) return;
    dr.b = q.p; dr.rb = q.ref;
  },
  move() {},
  up() {},
};
// 文書の座標の SVG を、画面（overlay）に重ねるための変形
const docToScrTransform = () => `translate(${view.x} ${view.y}) rotate(${(view.r * 180) / Math.PI}) scale(${view.z})`;
// overlay：作っている途中の寸法と、選んでいる寸法
function dimOverlaySvg(t) {
  let h = '';
  for (const id of S.selDims || []) {
    const f = findDim(id);
    if (f && f.L.visible) h += dimSvg(f.d, f.L.color);
  }
  const dr = t === 'dim' && S.dimDraft;
  if (dr && S.mouse) {
    if (!dr.b) {
      const q = dimSnap(S.mouse, S.keys.shift).p;
      h += `<line x1="${dr.a.x}" y1="${dr.a.y}" x2="${q.x}" y2="${q.y}" stroke="#2f7bff" stroke-width="${1 / view.z}" stroke-dasharray="${4 / view.z} ${3 / view.z}"/>`;
    } else {
      const pl = dimFromPlace(dr.a, dr.b, S.mouse, S.keys.shift);
      h += dimSvg({ id: 'draft', ...pl, a: dr.a, b: dr.b, ra: dr.ra, rb: dr.rb }, '#2f7bff');
    }
    h += `<circle cx="${dr.a.x}" cy="${dr.a.y}" r="${3 / view.z}" fill="#2f7bff"/>`;
    if (dr.b) h += `<circle cx="${dr.b.x}" cy="${dr.b.y}" r="${3 / view.z}" fill="#2f7bff"/>`;
  }
  return h ? `<g transform="${docToScrTransform()}" pointer-events="none">${h}</g>` : '';
}

// 選択ツール：寸法をクリックで選ぶ、ドラッグで寸法線の位置を動かす
(function () {
  const sel = Tools.select, down0 = sel.down, move0 = sel.move, up0 = sel.up;
  sel.down = function (e, p, sp) {
    const hd = !(S.sel.size && (hitBBoxHandle(sp) || hitBBoxRotate(sp))) && hitDim(p);
    if (hd) {
      if (!e.shiftKey) S.sel.clear();
      if (!S.selDims) S.selDims = new Set();
      if (e.shiftKey && S.selDims.has(hd.d.id)) S.selDims.delete(hd.d.id);
      else { if (!e.shiftKey) S.selDims.clear(); S.selDims.add(hd.d.id); }
      S.drag = { type: 'dimMove', id: hd.d.id, moved: false, s: sp };
      return;
    }
    if (!e.shiftKey && S.selDims) S.selDims.clear();
    down0.call(this, e, p, sp);
  };
  sel.move = function (e, p, sp) {
    const d = S.drag;
    if (d.type !== 'dimMove') return move0.call(this, e, p, sp);
    if (!d.moved && Math.hypot(sp.x - d.s.x, sp.y - d.s.y) < 3) return;
    d.moved = true;
    const f = findDim(d.id);
    if (!f) return;
    const g = dimGeom(f.d), dm = f.d;
    if (dm.dir === 'h') dm.off = p.y - g.a.y;
    else if (dm.dir === 'v') dm.off = p.x - g.a.x;
    else { const u = vsub(g.b, g.a), l = vlen(u) || 1; dm.off = ((p.x - g.a.x) * -u.y + (p.y - g.a.y) * u.x) / l; }
    renderArt();
  };
  sel.up = function (e, p, sp) {
    const d = S.drag;
    if (d.type !== 'dimMove') return up0.call(this, e, p, sp);
    if (d.moved) commit();
  };
})();
