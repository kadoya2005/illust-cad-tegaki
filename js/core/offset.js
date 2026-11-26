'use strict';
// イラレCAD：パスのオフセット
// 流れ：ベジェを細かい折れ線にする → Clipper で輪郭を広げる／縮める → 折れ線をベジェに戻す（角はそのまま、曲がった部分は paper.js で曲線に当てはめ）

const OFFSET_SCALE = 1000;     // Clipper は整数で計算するので、mm を 1000 倍して渡す（1µm 単位）
const CORNER_DEG = 28;         // 折れ線の向きがこれより大きく変わる点は「角」として残す

// サブパスを折れ線に（曲線は長さに合わせて細かく分ける）
function polyFromSub(sb) {
  const pts = [];
  const cnt = Geo.segCount(sb);
  if (!cnt) return sb.nodes.map((n) => P(n.x, n.y));
  for (let i = 0; i < cnt; i++) {
    const s = Geo.seg(sb, i);
    pts.push(P(s[0].x, s[0].y));
    if (Geo.isLine(sb, i)) continue;
    const len = vdist(s[0], s[1]) + vdist(s[1], s[2]) + vdist(s[2], s[3]);
    const steps = Math.max(8, Math.min(200, Math.ceil(len / 0.25)));
    for (let k = 1; k < steps; k++) pts.push(cubicAt(s[0], s[1], s[2], s[3], k / steps));
  }
  if (!sb.closed) { const l = sb.nodes[sb.nodes.length - 1]; pts.push(P(l.x, l.y)); }
  return pts;
}

// 折れ線（閉じた輪郭）をベジェのサブパスに戻す
function subFromPoly(pts, closed) {
  // 重なった点を除く
  const q = [];
  for (const p of pts) if (!q.length || vdist(q[q.length - 1], p) > 1e-3) q.push(p);
  if (closed && q.length > 1 && vdist(q[0], q[q.length - 1]) <= 1e-3) q.pop();
  const n = q.length;
  if (n < 2) return null;
  const turn = (i) => {
    const a = q[(i - 1 + n) % n], b = q[i], c = q[(i + 1) % n];
    const v1 = vsub(b, a), v2 = vsub(c, b);
    const ang = Math.abs(Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y));
    return (ang * 180) / Math.PI;
  };
  // 角の位置
  const corners = [];
  for (let i = 0; i < n; i++) if ((!closed && (i === 0 || i === n - 1)) || (closed && turn(i) > CORNER_DEG)) corners.push(i);
  const s = Pathfinder.scope();
  // ひと続きの点列（角から角まで）を、直線か曲線にする
  const fitRun = (run) => {
    const a = run[0], b = run[run.length - 1];
    const L = vdist(a, b);
    const straight = run.every((p) => {
      if (L < 1e-9) return true;
      return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L < 0.02;
    });
    if (straight || run.length < 3) return [{ p: a, hout: null }, { p: b, hin: null }];
    const path = new s.Path({ segments: run.map((p) => [p.x, p.y]), insert: false });
    path.simplify(0.05);
    return path.segments.map((sg) => {
      const x = sg.point.x, y = sg.point.y;
      return { p: P(x, y), hin: sg.handleIn.isZero() ? null : P(x + sg.handleIn.x, y + sg.handleIn.y), hout: sg.handleOut.isZero() ? null : P(x + sg.handleOut.x, y + sg.handleOut.y) };
    });
  };
  // 区切る位置：とがった角に加えて、長い直線の両端（直線と円弧のつなぎ目）でも区切る
  // 角でない区切り（smoothAt）は、あとで方向線を一直線にそろえて、なめらかにつなぐ
  const sharp = new Set(corners);
  const splits = new Set(corners);
  const LONG = 0.7;   // mm。これより長い辺は「直線の部分」とみなす
  const ecount = closed ? n : n - 1;
  for (let i = 0; i < ecount; i++) if (vdist(q[i], q[(i + 1) % n]) > LONG) { splits.add(i); splits.add((i + 1) % n); }
  if (closed && !splits.size) for (let k = 0; k < 4; k++) splits.add(Math.floor((n * k) / 4));   // 円など
  const cuts = [...splits].sort((a, b) => a - b);
  const nodes = [], nodeSrc = [];
  const runs = [];
  const cc = closed ? cuts.length : cuts.length - 1;
  for (let k = 0; k < cc; k++) {
    const i0 = cuts[k], i1 = cuts[(k + 1) % cuts.length];
    const run = [];
    for (let i = i0; ; i = (i + 1) % n) { run.push(q[i]); if (i === i1 && run.length > 1) break; }
    runs.push(fitRun(run));
  }
  runs.forEach((segs, k) => {
    for (let j = 0; j < segs.length - 1; j++) {
      const g = segs[j];
      if (j === 0) {
        // 区切りの点：入ってくる側の方向線は1つ前のひと続きの最後から
        const prev = k > 0 ? runs[k - 1] : closed ? runs[runs.length - 1] : null;
        const hin = prev ? prev[prev.length - 1].hin || null : null;
        nodes.push(mkNode(g.p.x, g.p.y, hin, g.hout || null)); nodeSrc.push(cuts[k]);
      } else { nodes.push(mkNode(g.p.x, g.p.y, g.hin || null, g.hout || null)); nodeSrc.push(-1); }
    }
  });
  if (!closed && runs.length) { const last = runs[runs.length - 1], g = last[last.length - 1]; nodes.push(mkNode(g.p.x, g.p.y, g.hin || null, null)); nodeSrc.push(n - 1); }
  // 角でない区切りの点を、なめらかにつなぐ
  nodes.forEach((nd, j) => {
    const i = nodeSrc[j];
    if (i < 0 || sharp.has(i)) return;
    let u = null;
    if (nd.hin && nd.hout) u = vsub(nd.hout, nd.hin);
    else if (nd.hout && !nd.hin) u = vsub(q[i], q[(i - 1 + n) % n]);   // 直線から円弧へ：直線の向きに合わせる
    else if (nd.hin && !nd.hout) u = vsub(q[(i + 1) % n], q[i]);       // 円弧から直線へ
    if (!u || vlen(u) < 1e-9) return;
    u = vmul(u, 1 / vlen(u));
    if (nd.hin) nd.hin = vsub(nd, vmul(u, vdist(nd.hin, nd)));
    if (nd.hout) nd.hout = vadd(nd, vmul(u, vdist(nd.hout, nd)));
  });
  s.project.clear();
  const sb = { nodes, closed };
  normalizeSub(sb);
  return sb.nodes.length >= 2 ? sb : null;
}

// パス1つをオフセットしたサブパスの配列を返す。join：'miter' | 'round' | 'bevel'
function offsetSubs(it, delta, join, miterLimit) {
  if (!window.ClipperLib) throw new Error('Clipper を読み込めませんでした');
  const C = ClipperLib;
  const toC = (pts) => pts.map((p) => ({ X: Math.round(p.x * OFFSET_SCALE), Y: Math.round(p.y * OFFSET_SCALE) }));
  const jt = join === 'round' ? C.JoinType.jtRound : join === 'bevel' ? C.JoinType.jtSquare : C.JoinType.jtMiter;
  const co = new C.ClipperOffset(Math.max(1, miterLimit || 4), 0.007 * OFFSET_SCALE);
  const closed = it.subs.filter((sb) => sb.closed && sb.nodes.length >= 2).map((sb) => toC(polyFromSub(sb)));
  if (closed.length) {
    // 穴の向きをそろえてから渡す（複合パスの塗りのルールに合わせる）
    const ft = it.rule === 'evenodd' ? C.PolyFillType.pftEvenOdd : C.PolyFillType.pftNonZero;
    co.AddPaths(C.Clipper.SimplifyPolygons(closed, ft), jt, C.EndType.etClosedPolygon);
  }
  for (const sb of it.subs) {
    if (sb.closed || sb.nodes.length < 2) continue;
    co.AddPath(toC(polyFromSub(sb)), jt, join === 'round' ? C.EndType.etOpenRound : C.EndType.etOpenButt);
  }
  const sol = new C.Paths();
  // 開いたパスだけのときは、内側がないので両側に広げる
  co.Execute(sol, (closed.length ? delta : Math.abs(delta)) * OFFSET_SCALE);
  return sol
    .map((path) => subFromPoly(path.map((p) => P(p.X / OFFSET_SCALE, p.Y / OFFSET_SCALE)), true))
    .filter(Boolean);
}
