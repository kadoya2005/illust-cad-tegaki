'use strict';
// イラレCAD：ツールが使うドラッグ処理とペンの補助

// ================= ツール =================
function startMove(p, e, nodesOnly) {
  // base・baseSel：動かし始めたときの元のもの（ドラッグ中に Alt を離してコピーをやめたら、ここに戻す）
  const d = { type: 'move', start: p, nodesOnly, dup: false, moved: false, dx: 0, dy: 0, orig: snapshotSel() };
  d.base = d.orig; d.baseSel = new Map([...S.sel].map(([k, v]) => [k, new Set(v)]));
  // 吸着に使う点：動かすアンカー、または選択範囲の角・辺の中点・中心
  const refs = [];
  const skip = { items: new Set(), nodes: new Set() };
  if (nodesOnly) {
    for (const it of selectedItems()) {
      const set = S.sel.get(it.id);
      it.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => { if (set.has(key(s, i))) { skip.nodes.add(it.id + '|' + key(s, i)); if (refs.length < 200) refs.push(P(n.x, n.y)); } }));
    }
  } else {
    const items = selectedItems();
    items.forEach((it) => skip.items.add(it.id));
    const bb = Geo.bbox(items);
    if (bb) for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) refs.push(P(bb.x + bb.w * fx, bb.y + bb.h * fy));
    const ha = hitAnchor(p);
    if (ha && S.sel.has(ha.it.id)) refs.unshift(P(ha.it.subs[ha.s].nodes[ha.i].x, ha.it.subs[ha.s].nodes[ha.i].y));
    // 動かすパスのアンカー全部も吸着に使う（面と面の辺をぴったり合わせるため）
    for (const it of items) for (const sb of it.subs) for (const n of sb.nodes) if (refs.length < 300) refs.push(P(n.x, n.y));
  }
  d.refs = refs;
  d.cands = buildCands(skip);
  d.segs = buildSnapSegs(skip);   // ほかのパスのまっすぐな辺（アンカーを辺の上に吸着させる）
  S.drag = d;
}
function dragMove(e, p) {
  const d = S.drag;
  const q = e.shiftKey ? constrain45(d.start, p) : p;
  let dx = q.x - d.start.x, dy = q.y - d.start.y;
  if (!d.moved && Math.hypot(dx, dy) * inputScale() < 3) return;
  d.moved = true;
  S.snapViz = null;
  if (!e.shiftKey) {
    // 移動は吸着を強めに（8px）。アンカーどうし → アンカーを辺の上へ → 縦横の位置合わせ、の順
    const sn = snapRefs(d.refs.map((r) => P(r.x + dx, r.y + dy)), d.cands, { segs: d.segs, px: 8 });
    dx += sn.dx; dy += sn.dy; S.snapViz = sn.viz;
  }
  // Alt：ドラッグの途中で押してもコピーになり、離すと移動に戻る（イラレと同じ。離した瞬間の状態で決まる）
  const wantCopy = !!e.altKey && !d.nodesOnly;
  if (wantCopy && !d.dup) { restoreFrom(d.base); duplicateSelection(); d.dup = true; d.orig = snapshotSel(); }
  else if (!wantCopy && d.dup) {
    for (const id of d.orig.keys()) removeItem(id);
    S.sel = new Map([...d.baseSel].map(([k, v]) => [k, new Set(v)]));
    d.dup = false; d.orig = d.base;
  }
  const place = () => {
    for (const [id, subs] of d.orig) {
      const f = findItem(id);
      if (!f) continue;
      f.item.subs = clone(subs);
      const set = S.sel.get(id);
      f.item.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => { if (d.nodesOnly && !(set && set.has(key(s, i)))) return; moveNode(n, dx, dy); }));
    }
  };
  place();
  // 面の辺がほかの面の辺に近づいたら（8px 以内）、ぴったり重ねる（そのまま離せば折り線になる）
  if (!e.shiftKey && !d.nodesOnly) {
    const c = foldEdgeSnap(new Set(d.orig.keys()), 8 / inputScale());
    if (c) { dx += c.x; dy += c.y; place(); S.snapViz = null; }
  }
  d.dx = dx; d.dy = dy; d.lastP = p;
  renderArt();
  // 動かしている面が、ほかの面と辺でぴったり接したか（折り線になるか）。renderArt で折り線を探し直している
  if (typeof FOLD_HINGES !== 'undefined') {
    const moved = new Set(d.orig.keys());
    d.contacts = FOLD_HINGES.filter((h) => moved.has(h.A.id) !== moved.has(h.B.id)).map((h) => h.e);
  }
}
// 動かしている面の辺と、ほかの面の辺が、ほぼ一直線に並んで重なっていたら、ぴったり重ねるためのずらし量を返す
//   辺に直角の向き：ずれをなくす。辺に沿った向き：角どうしが近ければ角も合わせる
function foldEdgeSnap(moved, tol) {
  const vdot = (a, b) => a.x * b.x + a.y * b.y;
  if (typeof isFoldFace === 'undefined') return null;
  const all = leaves(doc.layers.filter((L) => L.visible !== false).flatMap((L) => L.items)).filter(isFoldFace);
  const mov = all.filter((it) => moved.has(it.id)), fix = all.filter((it) => !moved.has(it.id) && !it.hidden);
  if (!mov.length || !fix.length) return null;
  const fixE = fix.flatMap(foldEdges);
  let best = null;
  for (const it of mov) for (const m of foldEdges(it)) for (const f of fixE) {
    const L = vdist(f.a, f.b), u = vmul(vsub(f.b, f.a), 1 / L), nrm = P(-u.y, u.x);
    const md = vsub(m.b, m.a), ml = vlen(md);
    if (Math.abs(md.x * u.y - md.y * u.x) > 0.02 * ml) continue;   // 平行でない（1° くらいまで）
    const sa = vdot(vsub(m.a, f.a), nrm), sb = vdot(vsub(m.b, f.a), nrm);
    if (Math.abs(sa) > tol || Math.abs(sb) > tol) continue;
    // 少し傾いた辺は、平行にずらしても両端は合わない。ずらしたあと両端とも折り線になる幅に入るときだけ吸い付く
    if (Math.abs(sa - sb) > FOLD_GAP) continue;
    const ta = vdot(vsub(m.a, f.a), u), tb = vdot(vsub(m.b, f.a), u);
    const ov = Math.min(L, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb));
    if (ov <= FOLD_MIN_LEN) continue;
    const dist = Math.abs((sa + sb) / 2);
    if (best && dist >= best.dist) continue;
    let corr = vmul(nrm, -(sa + sb) / 2);
    // 角どうしが近ければ、辺に沿っても合わせる
    let along = null;
    for (const t of [ta, tb]) for (const g of [0, L]) if (Math.abs(g - t) < tol && (along === null || Math.abs(g - t) < Math.abs(along))) along = g - t;
    if (along !== null) corr = vadd(corr, vmul(u, along));
    best = { dist, corr };
  }
  return best && vlen(best.corr) > 1e-9 ? best.corr : null;
}
// Alt を押した・離したときに、マウスを動かさなくてもすぐ切り替える
function refreshMoveDrag(e) {
  const d = S.drag;
  if (!d || d.type !== 'move' || !d.moved || !d.lastP) return;
  dragMove({ altKey: e.altKey, shiftKey: e.shiftKey }, d.lastP);
  drawOverlay();
}
function endMove() {
  const d = S.drag;
  if (d.moved) { S.lastTransform = { kind: 'move', prm: { dx: d.dx, dy: d.dy }, copy: d.dup, origin: null }; S.dlgLast.move = { dx: d.dx, dy: d.dy }; commit(); }
}

function startMarquee(p, mode) { S.drag = { type: 'marquee', mode }; S.marquee = { a: p, b: p }; }
function endMarquee() {
  const { a, b } = S.marquee;
  const r = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  if ((r.x1 - r.x0) * inputScale() < 2 && (r.y1 - r.y0) * inputScale() < 2) return;
  const inR = (q) => q.x >= r.x0 && q.x <= r.x1 && q.y >= r.y0 && q.y <= r.y1;
  for (const it of editableItemsTopDown()) {
    if (S.drag.mode === 'items') { if (Geo.samples(it).some(inR)) selectNode(topOf(it), true); continue; }
    let set = S.sel.get(it.id);
    it.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => {
      if (!inR(n)) return;
      if (!set) { set = new Set(); S.sel.set(it.id, set); }
      set.add(key(s, i));
    }));
  }
}

function startScale(h) { S.drag = { type: 'scale', h, bb: Geo.bbox(selectedItems()), orig: snapshotSel(), moved: false, cands: buildCands({ items: new Set(S.sel.keys()) }) }; }
function dragScale(e, p) {
  const d = S.drag, bb = d.bb, h = d.h;
  if (!bb) return;
  d.moved = true;
  S.snapViz = null;
  if (!e.shiftKey) { const sn = snapPoint(p, d.cands); p = sn.p; S.snapViz = sn.viz; }
  const hasW = h.includes('w'), hasE = h.includes('e'), hasN = h.includes('n'), hasS = h.includes('s');
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  let ax = hasW ? bb.x + bb.w : hasE ? bb.x : cx;
  let ay = hasN ? bb.y + bb.h : hasS ? bb.y : cy;
  if (e.altKey) { ax = cx; ay = cy; }
  const hx = hasW ? bb.x : bb.x + bb.w, hy = hasN ? bb.y : bb.y + bb.h;
  let sx = (hasW || hasE) && Math.abs(hx - ax) > 1e-9 ? (p.x - ax) / (hx - ax) : 1;
  let sy = (hasN || hasS) && Math.abs(hy - ay) > 1e-9 ? (p.y - ay) / (hy - ay) : 1;
  if (e.shiftKey) {
    if ((hasW || hasE) && (hasN || hasS)) { const m = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * m; sy = Math.sign(sy || 1) * m; }
    else if (hasW || hasE) { sy = Math.abs(sx); ay = cy; }
    else { sx = Math.abs(sy); ax = cx; }
  }
  d.prm = { sx, sy }; d.frac = { fx: bb.w ? (ax - bb.x) / bb.w : 0.5, fy: bb.h ? (ay - bb.y) / bb.h : 0.5 };
  restoreFrom(d.orig);
  const f = (q) => P(ax + (q.x - ax) * sx, ay + (q.y - ay) * sy);
  for (const id of d.orig.keys()) { const fi = findItem(id); if (fi) mapItem(fi.item, f); }
  renderArt();
}

// バウンディングボックスの角の外をドラッグ：中心で回転（Shift で 45° ずつ）
function startBBoxRotate(corner, p) {
  const bb = Geo.bbox(selectedItems());
  if (!bb) return;
  S.drag = { type: 'bbRotate', corner, c: P(bb.x + bb.w / 2, bb.y + bb.h / 2), start: p, orig: snapshotSel(), moved: false, ang: 0 };
}
function dragBBoxRotate(e, p) {
  const d = S.drag, c = d.c;
  if (!d.moved && vdist(p, d.start) * inputScale() < 2) return;
  d.moved = true;
  let a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(d.start.y - c.y, d.start.x - c.x);
  if (e.shiftKey) a = snapAngle(a, Math.PI / 4);
  d.ang = a;
  restoreFrom(d.orig);
  const f = rotateFn(c, a);
  for (const id of d.orig.keys()) { const fi = findItem(id); if (fi) mapItem(fi.item, f); }
  renderArt();
}
function endBBoxRotate() {
  const d = S.drag;
  if (!d.moved) return;
  S.lastTransform = { kind: 'rotate', prm: { ang: d.ang }, copy: false, origin: null };
  commit();
}

function endScale() {
  const d = S.drag;
  if (!d.moved || !d.prm) return;
  // Ctrl+D でくり返せるように。基準点は「枠のどこか」で覚えておく（左上の角、中心など）
  S.lastTransform = { kind: 'scale', prm: d.prm, copy: false, origin: null, frac: d.frac };
  commit();
}

function startHandleDrag(hh, breakMode) {
  const f = findItem(hh.id);
  S.drag = { type: 'handle', id: hh.id, s: hh.s, i: hh.i, which: hh.which, orig: clone(f.item.subs[hh.s].nodes[hh.i]), breakMode, moved: false, cands: cachedCands() };
}
function dragHandle(e, p) {
  const d = S.drag, f = findItem(d.id);
  if (!f) return;
  const nd = f.item.subs[d.s].nodes[d.i], o = d.orig;
  let q = p;
  S.snapViz = null;
  if (e.shiftKey) q = constrain45(o, p);
  else if (S.input) q = p;
  else { const sn = snapPoint(p, d.cands); q = sn.p; S.snapViz = sn.viz; }
  d.moved = true;
  nd[d.which] = P(q.x, q.y);
  const other = d.which === 'hin' ? 'hout' : 'hin';
  // Alt を一度押したら、離しても折れたまま（片方だけ動く＝鋭角）
  if (e.altKey) d.breakMode = true;
  if (d.breakMode) {
    nd.smooth = false;
    nd[other] = o[other] ? P(o[other].x, o[other].y) : null;
  } else if ((o.smooth || isSmoothPair(o)) && o[other]) {
    // なめらかな点：反対側の方向線も一直線のまま回る（長さはそのまま）
    nd.smooth = true;
    const L = vdist(o[other], o), v = vsub(o, q), l = vlen(v);
    if (l > 1e-9) nd[other] = vadd(o, vmul(v, L / l));
  }
  renderArt();
}

function startConvert(ha, p) { S.drag = { type: 'convert', id: ha.it.id, s: ha.s, i: ha.i, start: p, moved: false }; }
function dragConvert(e, p) {
  const d = S.drag, f = findItem(d.id);
  if (!f) return;
  const nd = f.item.subs[d.s].nodes[d.i];
  if (!d.moved && vdist(p, d.start) * inputScale() < 3) return;
  d.moved = true;
  const q = e.shiftKey ? constrain45(nd, p) : p;
  nd.hout = P(q.x, q.y); nd.hin = P(2 * nd.x - q.x, 2 * nd.y - q.y); nd.smooth = true;
  renderArt();
}
function endConvert() {
  const d = S.drag, f = findItem(d.id);
  if (f && !d.moved) { const nd = f.item.subs[d.s].nodes[d.i]; nd.hin = null; nd.hout = null; nd.smooth = false; renderArt(); }
  commit();
}

// ---- ペン ----
function drawingSub() {
  if (!S.drawing) return null;
  const f = findItem(S.drawing.id);
  if (!f || !f.item.subs || !f.item.subs[S.drawing.s]) { S.drawing = null; return null; }
  return f.item.subs[S.drawing.s];
}
function selectDrawingLast() {
  const sb = drawingSub();
  if (!sb) return;
  S.sel.clear();
  S.sel.set(S.drawing.id, new Set([key(S.drawing.s, sb.nodes.length - 1)]));
}
function endDrawing() {
  const sb = drawingSub();
  if (sb && sb.nodes.length < 2) {
    const f = findItem(S.drawing.id);
    f.item.subs.splice(S.drawing.s, 1);
    if (!f.item.subs.length) removeItem(f.item.id);
  }
  S.drawing = null;
  cleanSel(); render(); commit();
}
// ---- ダイレクト選択で曲線の線をドラッグ（イラレと同じく、つかんだ点が指についてくるように両側の方向線を伸ばす）----
function startReshape(it, s, seg, t, p) {
  const sb = it.subs[s], L = sb.nodes.length;
  S.drag = { type: 'reshape', id: it.id, s, seg, t, start: p, moved: false, oa: clone(sb.nodes[seg]), ob: clone(sb.nodes[(seg + 1) % L]) };
}
function dragReshape(e, p) {
  const d = S.drag, f = findItem(d.id);
  if (!f) return;
  const sb = f.item.subs[d.s], L = sb.nodes.length;
  const a = sb.nodes[d.seg], b = sb.nodes[(d.seg + 1) % L];
  const dx = p.x - d.start.x, dy = p.y - d.start.y;
  if (!d.moved && Math.hypot(dx, dy) * inputScale() < 3) return;
  d.moved = true;
  // 曲線上の点 B(t) を (dx,dy) 動かすための、2つの制御点の動かし方
  const t = Math.min(0.95, Math.max(0.05, d.t));
  const k1 = 3 * (1 - t) * (1 - t) * t, k2 = 3 * (1 - t) * t * t;
  const c = 1 / (k1 * (1 - t) + k2 * t);
  const w1 = (1 - t) * c, w2 = t * c;
  const oa = d.oa, ob = d.ob, c1 = oa.hout || oa, c2 = ob.hin || ob;
  a.hout = P(c1.x + dx * w1, c1.y + dy * w1);
  b.hin = P(c2.x + dx * w2, c2.y + dy * w2);
  // なめらかなアンカーは、反対側の方向線も向きをそろえて折れないようにする
  const keepSmooth = (n, o, moved, other) => {
    if (!o.smooth || !o[other]) return;
    const len = vdist(o[other], o), v = vsub(n, n[moved]), l = vlen(v);
    if (l > 1e-9) n[other] = vadd(n, vmul(v, len / l));
  };
  keepSmooth(a, oa, 'hout', 'hin');
  keepSmooth(b, ob, 'hin', 'hout');
  renderArt();
}
// 選んだ線（セグメント）を消す：閉じたパスは開き、開いたパスは2本に分かれる
function deleteSegment() {
  const g = S.segSel;
  S.segSel = null;
  const f = g && findItem(g.id);
  if (!f) return false;
  const it = f.item, sb = it.subs[g.s];
  if (!sb) return false;
  const n = sb.nodes, L = n.length;
  if (sb.closed) {
    sb.nodes = n.slice(g.seg + 1).concat(n.slice(0, g.seg + 1));
    sb.closed = false;
  } else {
    const first = n.slice(0, g.seg + 1), second = n.slice(g.seg + 1);
    it.subs.splice(g.s, 1);
    if (first.length >= 2) it.subs.splice(g.s, 0, { nodes: first, closed: false });
    if (second.length >= 2) {
      const other = { ...clone(it), id: uid(), subs: [{ nodes: second, closed: false }] };
      f.parent.splice(f.index + 1, 0, other);
    }
    if (!it.subs.length) removeItem(it.id);
  }
  S.sel.clear();
  if (L) { cleanSel(); render(); commit(); }
  return true;
}

// ペンのカーソルの横に出す印（イラレのカーソルの変化の代わり）
function penHint(p, alt, sp) {
  const sb = drawingSub();
  if (alt) {
    // Alt：アンカーポイントツール（切り返し）
    if (sp && hitHandle(sp)) return '^ 切り返し';
    if (sb && vdist(sb.nodes[sb.nodes.length - 1], p) <= tol()) return '^ 切り返し';
    if (hitAnchor(p)) return '^';
  }
  if (sb) {
    const n = sb.nodes;
    if (n.length >= 2 && vdist(n[0], p) <= tol()) return '○';
    if (vdist(n[n.length - 1], p) <= tol()) return '^';
    const ha = hitAnchor(p);
    if (ha && !(ha.it.id === S.drawing.id && ha.s === S.drawing.s)) {
      const ob = ha.it.subs[ha.s];
      if (!ob.closed && (ha.i === 0 || ha.i === ob.nodes.length - 1)) return '連結';
    }
    return '';
  }
  const ha = hitAnchor(p);
  if (ha) {
    const ob = ha.it.subs[ha.s];
    if (!ob.closed && (ha.i === 0 || ha.i === ob.nodes.length - 1)) return '/';
    if (S.sel.has(ha.it.id)) return '−';
  }
  for (const it of selectedItems()) { const nr = Geo.nearest(it, p); if (nr && nr.seg >= 0 && nr.d <= tol()) return '+'; }
  return '*';
}
function penSnap(p, e, from) {
  if (e.shiftKey && from) return constrain45(from, p);
  if (S.input) return p;   // 正面図・側面図では、まだ吸着しない
  return snapPoint(p, cachedCands()).p;
}
