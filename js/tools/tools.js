'use strict';
// イラレCAD：各ツールの動き（down / move / up）

const Tools = {
  select: {
    down(e, p, sp) {
      if (S.sel.size) {
        const hb = hitBBoxHandle(sp);
        if (hb) { startScale(hb); return; }
        const rc = hitBBoxRotate(sp);
        if (rc && !hitItem(p)) { startBBoxRotate(rc, p); return; }
      }
      const hit = hitItem(p);
      if (hit) {
        const target = topOf(hit.it);
        const ls = leaves([target]);
        const wasSel = ls.every((it) => S.sel.has(it.id));
        if (e.shiftKey && wasSel) { ls.forEach((it) => S.sel.delete(it.id)); updateUI(); return; }
        if (e.shiftKey || wasSel) selectNode(target, true); else selectNode(target, false);
        startMove(p, e, false);
        // 選択中のものをもう一度クリック（ドラッグしない）すると、整列のキーオブジェクトになる
        S.drag.keyCand = wasSel && !e.shiftKey && !e.altKey ? target.id : null;
        return;
      }
      const gi = hitGuide(sp);
      if (gi >= 0) { S.sel.clear(); S.selGuide = gi; S.drag = { type: 'guideMove', i: gi, moved: false }; return; }
      if (!e.shiftKey) S.sel.clear();
      startMarquee(p, 'items');
    },
    move(e, p, sp) {
      const d = S.drag;
      if (d.type === 'move') dragMove(e, p);
      else if (d.type === 'scale') dragScale(e, p);
      else if (d.type === 'bbRotate') dragBBoxRotate(e, p);
      else if (d.type === 'guideMove') dragGuide(p);
      else S.marquee.b = p;
    },
    up(e, p, sp) {
      const d = S.drag;
      if (d.type === 'move') {
        if (!d.moved && d.keyCand && selectedTops().length >= 2) {
          S.keyId = S.keyId === d.keyCand ? null : d.keyCand;
          S.alignTo = S.keyId ? 'key' : 'selection';
        }
        endMove();
      }
      else if (d.type === 'scale') endScale();
      else if (d.type === 'bbRotate') endBBoxRotate();
      else if (d.type === 'guideMove') endGuideMove(sp);
      else endMarquee();
    },
  },

  direct: {
    down(e, p, sp) {
      const hh = hitHandle(sp);
      if (hh) { startHandleDrag(hh, e.altKey); return; }
      const ha = hitAnchor(p);
      if (ha && !e.altKey) {
        const k = key(ha.s, ha.i), set = S.sel.get(ha.it.id);
        if (e.shiftKey) {
          if (set && set.has(k)) { set.delete(k); updateUI(); return; }
          if (set) set.add(k); else S.sel.set(ha.it.id, new Set([k]));
        } else if (!(set && set.has(k))) { S.sel.clear(); S.sel.set(ha.it.id, new Set([k])); }
        startMove(p, e, true);
        return;
      }
      const hit = ha ? { it: ha.it, kind: 'anchor' } : hitItem(p);
      if (hit) {
        const it = hit.it;
        if (e.altKey) {
          // グループ選択：1回目はパス全体、もう一度クリックするごとに1つ外側のグループ
          let target = it;
          if (isFullySel(it)) {
            const anc = findItem(it.id).ancestors;
            for (let a = anc.length - 1; a >= 0; a--) if (!leaves([anc[a]]).every(isFullySel)) { target = anc[a]; break; }
          }
          selectNode(target, e.shiftKey || target !== it);
        } else if (hit.kind === 'fill') selItem(it, e.shiftKey);
        else if (hit.seg >= 0 && !e.shiftKey && !Geo.isLine(it.subs[hit.s], hit.seg)) {
          // 曲線の線をつかんだ：線（セグメント）を選び、ドラッグで形を変える
          S.sel.clear(); S.sel.set(it.id, new Set());
          S.segSel = { id: it.id, s: hit.s, seg: hit.seg };
          startReshape(it, hit.s, hit.seg, hit.t, p);
          return;
        } else {
          const L = it.subs[hit.s].nodes.length;
          const ks = hit.seg < 0 ? [key(hit.s, 0)] : [key(hit.s, hit.seg), key(hit.s, (hit.seg + 1) % L)];
          if (!e.shiftKey) S.sel.clear();
          let set = S.sel.get(it.id);
          if (!set) { set = new Set(); S.sel.set(it.id, set); }
          ks.forEach((k) => set.add(k));
        }
        startMove(p, { altKey: false }, true);
        return;
      }
      const gi = hitGuide(sp);
      if (gi >= 0) { S.sel.clear(); S.selGuide = gi; S.drag = { type: 'guideMove', i: gi, moved: false }; return; }
      if (!e.shiftKey) S.sel.clear();
      startMarquee(p, 'nodes');
    },
    move(e, p) {
      const d = S.drag;
      if (d.type === 'handle') dragHandle(e, p);
      else if (d.type === 'reshape') dragReshape(e, p);
      else if (d.type === 'move') dragMove(e, p);
      else if (d.type === 'guideMove') dragGuide(p);
      else S.marquee.b = p;
    },
    up(e, p, sp) {
      const d = S.drag;
      if (d.type === 'handle' || d.type === 'reshape') { if (d.moved) commit(); }
      else if (d.type === 'move') endMove();
      else if (d.type === 'guideMove') endGuideMove(sp);
      else endMarquee();
    },
  },

  pen: {
    down(e, p, sp) {
      const sb = drawingSub();
      if (sb) {
        const { id, s } = S.drawing, n = sb.nodes, it = findItem(id).item;
        // 切り返し：Alt+ドラッグで方向線の片側だけを動かす
        if (e.altKey) { const hh = hitHandle(sp); if (hh) { startHandleDrag(hh, true); return; } }
        if (n.length >= 2 && vdist(n[0], p) <= tol()) { sb.closed = true; S.drag = { type: 'penClose', id, s, start: p, moved: false }; renderArt(); return; }
        const last = n[n.length - 1];
        if (vdist(last, p) <= tol()) { last.hout = null; last.smooth = false; S.drag = { type: 'penLast', id, s, i: n.length - 1, start: p, moved: false }; renderArt(); return; }
        const ha = hitAnchor(p);
        // Alt はアンカーポイントツールに一時切り替え（描いている途中でも）
        if (e.altKey && ha) { const set = S.sel.get(ha.it.id) || new Set(); set.add(key(ha.s, ha.i)); S.sel.set(ha.it.id, set); startConvert(ha, p); return; }
        // ほかの開いたパスの端をクリック → 連結
        if (ha && !(ha.it.id === id && ha.s === s)) {
          const ob = ha.it.subs[ha.s], OL = ob.nodes.length;
          if (!ob.closed && OL >= 2 && (ha.i === 0 || ha.i === OL - 1)) {
            if (ha.i === OL - 1) reverseSub(ob);
            n.push(...ob.nodes);
            ha.it.subs.splice(ha.s, 1);
            if (!ha.it.subs.length) removeItem(ha.it.id);
            S.drawing = null; selItem(it, false); render(); commit();
            return;
          }
        }
        const q = penSnap(p, e, last);
        n.push(mkNode(q.x, q.y));
        selectDrawingLast();
        S.drag = { type: 'penNew', id, s, i: n.length - 1, start: q, moved: false };
        renderArt();
        return;
      }
      const ha = hitAnchor(p);
      if (ha) {
        const ob = ha.it.subs[ha.s], OL = ob.nodes.length;
        if (e.altKey) { S.sel.set(ha.it.id, new Set([key(ha.s, ha.i)])); startConvert(ha, p); return; }
        if (!ob.closed && (ha.i === 0 || ha.i === OL - 1)) {
          if (ha.i === 0 && OL > 1) reverseSub(ob);
          S.drawing = { id: ha.it.id, s: ha.s };
          selectDrawingLast();
          S.drag = { type: 'penLast', id: ha.it.id, s: ha.s, i: OL - 1, start: p, moved: false };
          renderArt();
          return;
        }
        if (S.sel.has(ha.it.id)) { removeAnchorKeepShape(ha.it, ha.s, ha.i); render(); commit(); return; }
      }
      if (e.altKey) { const hh = hitHandle(sp); if (hh) { startHandleDrag(hh, true); return; } }
      for (const it of selectedItems()) {
        if (!inInputPlane(it)) continue;   // 違う平面のパスにはアンカーを足さない
        const nr = Geo.nearest(it, p);
        if (nr && nr.seg >= 0 && nr.d <= tol()) { const k = insertNode(it, nr.s, nr.seg, nr.t); S.sel.clear(); S.sel.set(it.id, new Set([k])); render(); commit(); return; }
      }
      const L = activeLayerObj();
      if (!layerWritable(L)) { toast('ロック中または非表示のレイヤーには描けません'); return; }
      const q = penSnap(p, e, null);
      const it = newItem([{ nodes: [mkNode(q.x, q.y)], closed: false }], false);
      if (S.input) it.plane = clone(S.input.plane);   // 正面図・側面図で描いたパスは、その平面に置く
      L.items.push(it);
      S.drawing = { id: it.id, s: 0 };
      selectDrawingLast();
      S.drag = { type: 'penNew', id: it.id, s: 0, i: 0, start: q, moved: false };
      renderArt();
    },
    move(e, p) {
      const d = S.drag;
      if (d.type === 'handle') { dragHandle(e, p); return; }
      if (d.type === 'convert') { dragConvert(e, p); return; }
      const f = findItem(d.id);
      if (!f) return;
      const sb = f.item.subs[d.s];
      const nd = d.type === 'penClose' ? sb.nodes[0] : sb.nodes[d.i];
      if (!d.moved && vdist(p, d.start) * inputScale() < 3 && !S.spaceDown) return;
      d.moved = true;
      S.snapViz = null;
      // ドラッグ中に Space：アンカーごと動かす（イラレと同じ）
      if (S.spaceDown && d.type !== 'penLast') {
        if (!d.spaceFrom) d.spaceFrom = { p, node: clone(nd) };
        const o = d.spaceFrom.node, dx = p.x - d.spaceFrom.p.x, dy = p.y - d.spaceFrom.p.y;
        nd.x = o.x + dx; nd.y = o.y + dy;
        nd.hin = o.hin ? P(o.hin.x + dx, o.hin.y + dy) : null;
        nd.hout = o.hout ? P(o.hout.x + dx, o.hout.y + dy) : null;
        renderArt();
        return;
      }
      d.spaceFrom = null;
      const q = e.shiftKey ? constrain45(nd, p) : p;
      const mirror = P(2 * nd.x - q.x, 2 * nd.y - q.y);
      // 切り返し：ドラッグ中に Alt を押すと、手前の方向線を残して先側だけ動かす。一度折ったら Alt を離しても折れたまま
      if (e.altKey) d.broken = true;
      if (d.type === 'penNew') {
        nd.hout = P(q.x, q.y);
        if (!d.broken) { nd.hin = mirror; nd.smooth = true; } else nd.smooth = false;
      } else if (d.type === 'penClose') {
        nd.hin = mirror;
        if (!d.broken) { nd.hout = P(q.x, q.y); nd.smooth = true; } else nd.smooth = false;
      } else if (d.type === 'penLast') {
        nd.hout = P(q.x, q.y); nd.smooth = false;
      }
      renderArt();
    },
    up() {
      const d = S.drag;
      if (d.type === 'convert') { endConvert(); return; }
      if (d.type === 'penClose') { S.drawing = null; const f = findItem(d.id); if (f) selItem(f.item, false); }
      commit();
    },
  },

  addAnchor: {
    down(e, p) {
      for (const it of editableItemsTopDown()) {
        const nr = Geo.nearest(it, p);
        if (nr && nr.seg >= 0 && nr.d <= tol()) { const k = insertNode(it, nr.s, nr.seg, nr.t); S.sel.clear(); S.sel.set(it.id, new Set([k])); render(); commit(); return; }
      }
    },
  },
  deleteAnchor: {
    down(e, p) { const ha = hitAnchor(p); if (ha) { removeAnchorKeepShape(ha.it, ha.s, ha.i); render(); commit(); } },
  },
  convert: {
    down(e, p, sp) {
      const hh = hitHandle(sp);
      if (hh) { startHandleDrag(hh, true); return; }
      const ha = hitAnchor(p);
      if (ha) {
        const set = S.sel.get(ha.it.id) || new Set();
        set.add(key(ha.s, ha.i)); S.sel.set(ha.it.id, set);
        startConvert(ha, p);
        return;
      }
      const hit = hitItem(p);
      S.sel.clear();
      if (hit) S.sel.set(hit.it.id, new Set());
    },
    move(e, p) { if (S.drag.type === 'handle') dragHandle(e, p); else dragConvert(e, p); },
    up() { if (S.drag.type === 'convert') endConvert(); else if (S.drag.moved) commit(); },
  },

  rect: shapeTool('rect'),
  roundRect: shapeTool('roundRect'),
  ellipse: shapeTool('ellipse'),
  line: shapeTool('line'),

  rotate: xfTool('rotate'),
  reflect: xfTool('reflect'),
  scale: xfTool('scale'),

  eyedropper: {
    down(e, p) {
      const h = hitItem(p);
      if (!h) return;
      const src = h.it;
      const targets = selectedItems().filter((it) => it !== src);
      S.fill = src.fill; S.stroke = src.stroke; S.sw = src.sw;
      for (const it of targets) { it.fill = src.fill; it.stroke = src.stroke; it.sw = src.sw; }
      if (!targets.length) S.sel.clear();
      renderArt(); commit();
    },
  },

  // 回転ビュー（Shift+Space を押している間）：画面の真ん中を中心に回す。Shift で 15° ずつ
  rotView: {
    down(e, p, sp) { const c = stageCenter(); S.drag = { type: 'rotView', c, a0: Math.atan2(sp.y - c.y, sp.x - c.x), r0: view.r }; updateCursor(); },
    move(e, p, sp) {
      const d = S.drag;
      let r = d.r0 + Math.atan2(sp.y - d.c.y, sp.x - d.c.x) - d.a0;
      if (e.shiftKey) r = snapAngle(r, Math.PI / 12);
      setViewRotation(r);
    },
    up() { updateUI(); },
  },
  hand: {
    down(e, p, sp) { S.drag = { type: 'pan', s: sp, vx: view.x, vy: view.y }; updateCursor(); },
    move(e, p, sp) { const d = S.drag; view.x = d.vx + sp.x - d.s.x; view.y = d.vy + sp.y - d.s.y; renderView(); },
    up() {},
  },
  zoom: {
    down(e, p, sp) { S.drag = { type: 'zoom', s: sp }; },
    move() {},
    up(e, p, sp) { zoomStep(e.altKey ? -1 : 1, sp); },
  },
};
