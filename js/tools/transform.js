'use strict';
// イラレCAD：回転・リフレクト・拡大縮小ツール

// ---- 回転・リフレクト・拡大縮小ツール（イラレと同じ操作）----
// クリック：基準点を決める／ドラッグ：変形／離すときに Alt：コピー／Alt+クリック：基準点を決めて数値入力
function xfTool(kind) {
  return {
    down(e, p) {
      if (!selectedItems().length) { const h = hitItem(p); if (!h) return; selectNode(topOf(h.it), false); }
      if (e.altKey) { S.xfOrigin = p; S.drag = { type: 'xfAlt' }; return; }
      S.drag = { type: 'xf', c: xfCenter(), start: p, orig: snapshotSel(), moved: false, prm: null };
    },
    move(e, p) {
      const d = S.drag;
      if (d.type !== 'xf') return;
      if (!d.moved && vdist(p, d.start) * view.z < 3) return;
      d.moved = true;
      const c = d.c;
      let prm;
      if (kind === 'rotate') {
        let a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(d.start.y - c.y, d.start.x - c.x);
        if (e.shiftKey) a = snapAngle(a, Math.PI / 4);
        prm = { ang: a };
      } else if (kind === 'reflect') {
        let a = Math.atan2(p.y - c.y, p.x - c.x);
        if (e.shiftKey) a = snapAngle(a, Math.PI / 4);
        prm = { axis: a };
      } else {
        const v0 = vsub(d.start, c), v = vsub(p, c);
        let sx = Math.abs(v0.x) > 1e-6 ? v.x / v0.x : 1, sy = Math.abs(v0.y) > 1e-6 ? v.y / v0.y : 1;
        if (e.shiftKey) { const l2 = v0.x * v0.x + v0.y * v0.y; const s = l2 > 1e-9 ? (v.x * v0.x + v.y * v0.y) / l2 : 1; sx = sy = s; }
        prm = { sx, sy };
      }
      d.prm = prm;
      restoreFrom(d.orig);
      const f = xfFn(kind, c, prm);
      for (const id of d.orig.keys()) { const fi = findItem(id); if (fi) mapItem(fi.item, f); }
      renderArt();
    },
    up(e, p) {
      const d = S.drag;
      if (d.type === 'xfAlt') { const k = kind; setTimeout(() => openXfDialog(k), 0); return; }
      if (!d.moved) { S.xfOrigin = p; return; }
      if (e.altKey) {
        restoreFrom(d.orig);
        duplicateSelection();
        const f = xfFn(kind, d.c, d.prm);
        selectedItems().forEach((it) => mapItem(it, f));
        renderArt();
      }
      S.lastTransform = { kind, prm: d.prm, copy: e.altKey, origin: S.xfOrigin ? P(S.xfOrigin.x, S.xfOrigin.y) : null };
      commit();
    },
  };
}
