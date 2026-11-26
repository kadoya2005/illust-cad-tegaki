'use strict';
// イラレCAD：当たり判定

// ================= 当たり判定 =================
function hitAnchor(p) {
  for (const it of editableItemsTopDown()) {
    for (let s = 0; s < it.subs.length; s++) {
      const ns = it.subs[s].nodes;
      for (let i = 0; i < ns.length; i++) if (vdist(ns[i], p) <= tol()) return { it, s, i };
    }
  }
  return null;
}
function pointInFill(it, p) {
  const el = art.querySelector(`[data-id="${it.id}"]`);
  try { return el ? el.isPointInFill(new DOMPoint(p.x, p.y)) : false; } catch (_) { return false; }
}
function hitItem(p) {
  for (const it of editableItemsTopDown()) {
    const nr = Geo.nearest(it, p);
    const half = it.stroke && !S.outline ? it.sw / 2 : 0;
    if (nr && nr.d <= tol() + half) return { it, kind: 'stroke', ...nr };
    if (it.fill && !S.outline && pointInFill(it, p)) return { it, kind: 'fill' };
  }
  return null;
}
// 方向線の先（ハンドル）。いちばん近いものを、少し広めの範囲（8px）で拾う
function hitHandle(sp) {
  let best = null, bd = 8;
  for (const h of S.input ? S.input.handleHits : S.handleHits) { const d = Math.hypot(h.x - sp.x, h.y - sp.y); if (d <= bd) { bd = d; best = h; } }
  return best;
}
// バウンディングボックスの取っ手（いちばん近いもの。小さい図形で隣の取っ手を拾わないように）
function hitBBoxHandle(sp) {
  let best = null, bd = Infinity;
  for (const b of S.bboxHits) {
    if (Math.abs(b.x - sp.x) > 5 || Math.abs(b.y - sp.y) > 5) continue;
    const d = Math.hypot(b.x - sp.x, b.y - sp.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best ? best.id : null;
}
// バウンディングボックスの四隅の少し外側（回転）。返すのは角の名前（nw / ne / se / sw）
function hitBBoxRotate(sp) {
  const bb = S.bboxDoc;
  if (!bb || !S.bboxHits.length) return null;
  const q = toDoc(sp);   // 回転ビューでも合うように、文書の座標で「枠の中か」を見る
  if (q.x > bb.x && q.x < bb.x + bb.w && q.y > bb.y && q.y < bb.y + bb.h) return null;
  for (const id of ['nw', 'ne', 'se', 'sw']) {
    const c = S.bboxHits.find((b) => b.id === id);
    if (c && Math.hypot(c.x - sp.x, c.y - sp.y) <= 18) return id;
  }
  return null;
}
function hitGuide(sp) {
  if (!S.showGuides || S.guidesLocked) return -1;
  for (let i = doc.guides.length - 1; i >= 0; i--) {
    const g = doc.guides[i];
    const q = toDoc(sp);
    const d = Math.abs((g.axis === 'x' ? q.x : q.y) - g.v) * view.z;
    if (d <= 3) return i;
  }
  return -1;
}
