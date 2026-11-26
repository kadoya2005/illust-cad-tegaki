'use strict';
// イラレCAD：スマートガイド・ガイド・グリッドへの吸着

// ================= スマートガイド・ガイド・グリッドへの吸着 =================
// 吸着先の点（アンカー、オブジェクトの中心、アートボードの角と中心）
function buildCands(skip) {
  const pts = [];
  for (const it of visibleLeaves()) {
    if (!onTop(it)) continue;   // ほかの平面のパスには平面図で吸着しない
    if (skip && skip.items && skip.items.has(it.id)) continue;
    it.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => {
      if (skip && skip.nodes && skip.nodes.has(it.id + '|' + key(s, i))) return;
      pts.push({ x: n.x, y: n.y, kind: 'アンカー' });
    }));
    const bb = Geo.bbox([it]);
    if (bb) pts.push({ x: bb.x + bb.w / 2, y: bb.y + bb.h / 2, kind: '中心' });
  }
  const W = doc.width, Ht = doc.height;
  for (const [x, y] of [[0, 0], [W, 0], [0, Ht], [W, Ht]]) pts.push({ x, y, kind: 'アートボード' });
  pts.push({ x: W / 2, y: Ht / 2, kind: '中心' });
  return pts;
}
// 吸着先の辺：見えているパスのまっすぐな辺（skip の中のものは除く）
function buildSnapSegs(skip) {
  const out = [];
  for (const it of visibleLeaves()) {
    if (!onTop(it) || (skip && skip.items && skip.items.has(it.id))) continue;
    for (const sb of it.subs) {
      const n = sb.nodes, L = n.length;
      for (let i = 0; i < (sb.closed ? L : L - 1); i++) {
        const a = n[i], b = n[(i + 1) % L];
        if (a.hout || b.hin || vdist(a, b) < 1e-6) continue;
        out.push({ a: P(a.x, a.y), b: P(b.x, b.y) });
        if (out.length > 3000) return out;
      }
    }
  }
  return out;
}
function cachedCands() { if (!S.snapCache) S.snapCache = buildCands(); return S.snapCache; }
// refs（動かしている点の仮の位置）をどれだけずらせば吸着するか
function snapRefs(refs, cands, opt) {
  const T = ((opt && opt.px) || 5) / view.z;
  const viz = { lines: [], label: '', at: null };
  if (!refs.length) return { dx: 0, dy: 0, viz };
  if (S.snapGrid) {
    const st = GRID_MAJOR / GRID_DIV, r = refs[0];
    return { dx: Math.round(r.x / st) * st - r.x, dy: Math.round(r.y / st) * st - r.y, viz };
  }
  let pt = null, bx = null, by = null;
  if (S.smart && cands) {
    for (const r of refs) for (const c of cands) {
      const dx = c.x - r.x, dy = c.y - r.y, ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax <= T && ay <= T && (!pt || ax + ay < pt.d)) pt = { d: ax + ay, dx, dy, c };
      if (ax <= T && (!bx || ax < Math.abs(bx.dx))) bx = { dx, c, r };
      if (ay <= T && (!by || ay < Math.abs(by.dy))) by = { dy, c, r };
    }
  }
  if (S.showGuides) {
    for (const g of doc.guides) for (const r of refs) {
      if (g.axis === 'x') { const dx = g.v - r.x; if (Math.abs(dx) <= T && (!bx || Math.abs(dx) < Math.abs(bx.dx))) bx = { dx, r }; }
      else { const dy = g.v - r.y; if (Math.abs(dy) <= T && (!by || Math.abs(dy) < Math.abs(by.dy))) by = { dy, r }; }
    }
  }
  if (pt) { viz.label = pt.c.kind; viz.at = P(pt.c.x, pt.c.y); return { dx: pt.dx, dy: pt.dy, viz }; }
  // アンカーを、ほかのパスの辺の上へ（面と面の辺をぴったり接触させる）
  if (S.smart && opt && opt.segs) {
    let best = null;
    for (const r of refs) for (const s of opt.segs) {
      const ab = vsub(s.b, s.a), L2 = ab.x * ab.x + ab.y * ab.y;
      const t = Math.max(0, Math.min(1, ((r.x - s.a.x) * ab.x + (r.y - s.a.y) * ab.y) / L2));
      const q = vadd(s.a, vmul(ab, t)), d = vdist(q, r);
      if (d <= T && (!best || d < best.d)) best = { d, dx: q.x - r.x, dy: q.y - r.y, q };
    }
    if (best) { viz.label = 'パス'; viz.at = best.q; return { dx: best.dx, dy: best.dy, viz }; }
  }
  const dx = bx ? bx.dx : 0, dy = by ? by.dy : 0;
  if (bx && bx.c) viz.lines.push([P(bx.c.x, bx.c.y), P(bx.r.x + dx, bx.r.y + dy)]);
  if (by && by.c) viz.lines.push([P(by.c.x, by.c.y), P(by.r.x + dx, by.r.y + dy)]);
  return { dx, dy, viz };
}
function snapPoint(p, cands) {
  const r = snapRefs([p], cands);
  const q = P(p.x + r.dx, p.y + r.dy);
  r.viz.p = q;
  return { p: q, viz: r.viz };
}
