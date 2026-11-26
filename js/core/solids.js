'use strict';
// イラレCAD：3D（段階1：押し出し）
// 押し出しはパスそのものに持たせる：it.x3d = { z0: 底の高さ, h: 高さ }（単位 mm）
// こうしておくと、コピー・複製・取り消し・保存でそのまま付いてくる
// 座標：平面図の x は右、y は下（＝手前）、z は上（高さ）

const X3D_DEFAULT_H = 10;   // 押し出すときの最初の高さ（mm）

// 押し出し：床に平行なパスと、傾いた平面のパス（回した立体・正面図や側面図に描いたパス）。折りたたみの面は、折っているあいだは押し出さない
//   床に平行なもの：z0 は床からの高さ（いままでどおり。plane.o の高さは使わない）
//   傾いたもの：z0 は、その平面から法線（u×v）の向きへの距離。立体は z0〜z0+h
const extrudeOf = (it) => (it && !isGroup(it) && it.x3d && it.x3d.h > 0 && (flatOnFloor(it) || !it.fold) ? it.x3d : null);
// 押し出しの 3D の点：パスの 2D の点 p と、押し出しの向きの位置 z（床なら高さ、傾いたものは z0 からの距離を含めた値）
function solidPoint(it, p, z) {
  if (flatOnFloor(it)) return { x: p.x, y: p.y, z };
  const pl = planeOf(it), w = toWorld(pl, p), n = planeNormal(pl);
  return { x: w.x + n[0] * z, y: w.y + n[1] * z, z: w.z + n[2] * z };
}
// 選んでいるパス（グループの中も）のうち、閉じたサブパスがあるもの
function selectedProfileLeaves() {
  return leaves(selectedTops().map((t) => t.node)).filter((it) => it.subs.some((sb) => sb.closed && sb.nodes.length >= 2));
}
// 押し出す（高さ・底の高さのどちらかだけ変えるときは、もう一方に undefined を渡す）
function setExtrude(h, z0) {
  const ls = selectedProfileLeaves();
  if (!ls.length) { toast('閉じたパスを選んでください（開いたパスは押し出せません）'); return; }
  for (const it of ls) {
    const cur = it.x3d || { z0: 0, h: S.lastExH || X3D_DEFAULT_H };
    it.x3d = { ...cur, z0: isFinite(z0) ? z0 : cur.z0, h: isFinite(h) && h > 0 ? h : cur.h };
  }
  S.lastExH = ls[0].x3d.h;
  render(); commit();
}
function removeExtrude() {
  const ls = leaves(selectedTops().map((t) => t.node)).filter((it) => it.x3d);
  if (!ls.length) return;
  ls.forEach((it) => { delete it.x3d; });
  render(); commit();
}
// 表示されている押し出し（隠したもの・隠したレイヤーは除く）
function visibleSolids() { return modelLeaves().filter(extrudeOf); }   // 図面レイヤーのものは除く

// ---- 断面を折れ線の輪郭にする（外形と穴を組にする） ----
// 戻り値：[{ outer: [P...], holes: [[P...], ...] }]。外形は反時計回り、穴は時計回り（y を上向きにしたとき）
const RING_SCALE = 1000;
function profileShapes(it) {
  const C = ClipperLib;
  const toC = (pts) => pts.map((p) => ({ X: Math.round(p.x * RING_SCALE), Y: Math.round(-p.y * RING_SCALE) }));   // y を上向きに
  const paths = it.subs.filter((sb) => sb.closed && sb.nodes.length >= 2).map((sb) => toC(polyFromSub(sb))).filter((p) => p.length >= 3);
  if (!paths.length) return [];
  const ft = it.rule === 'evenodd' ? C.PolyFillType.pftEvenOdd : C.PolyFillType.pftNonZero;
  const cl = new C.Clipper();
  cl.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  cl.Execute(C.ClipType.ctUnion, tree, ft, ft);
  const back = (path) => path.map((q) => P(q.X / RING_SCALE, -q.Y / RING_SCALE));   // 平面図の座標に戻す
  const out = [];
  const walk = (node) => {
    for (const ch of node.Childs()) {
      if (!ch.IsHole()) {
        out.push({ outer: back(ch.Contour()), holes: ch.Childs().map((h) => back(h.Contour())) });
        ch.Childs().forEach(walk);   // 穴の中の島
      }
    }
  };
  walk(tree);
  return out;
}

// ---- 三角形に分ける（穴あき多角形。耳を切り取るやり方） ----
// 入力：平面の点（x, y は数学の向き＝y 上）。外形は反時計回り、穴は時計回り。戻り値：点の配列と三角形の番号
function triangulate(outer, holes) {
  const pts = outer.slice();
  let ring = pts.map((_, i) => i);
  // 穴は、外形とつないで1本の輪にする（右端の点から、見える外形の点へ橋をかける）
  const hs = holes.map((h) => h.slice()).sort((a, b) => Math.max(...b.map((p) => p.x)) - Math.max(...a.map((p) => p.x)));
  for (const h of hs) {
    const base = pts.length;
    h.forEach((p) => pts.push(p));
    let hi = 0;
    h.forEach((p, i) => { if (p.x > h[hi].x) hi = i; });
    const hp = h[hi];
    let best = -1, bd = Infinity;
    for (let k = 0; k < ring.length; k++) {
      const q = pts[ring[k]];
      if (q.x < hp.x - 1e-9) continue;
      const d = (q.x - hp.x) ** 2 + (q.y - hp.y) ** 2;
      if (d >= bd) continue;
      if (crossesRing(hp, q, pts, ring) || crossesHole(hp, q, h)) continue;
      bd = d; best = k;
    }
    if (best < 0) { for (let k = 0; k < ring.length; k++) { const q = pts[ring[k]]; const d = (q.x - hp.x) ** 2 + (q.y - hp.y) ** 2; if (d < bd) { bd = d; best = k; } } }
    const hole = [];
    for (let j = 0; j <= h.length; j++) hole.push(base + ((hi + j) % h.length));
    ring = [...ring.slice(0, best + 1), ...hole, ring[best], ...ring.slice(best + 1)];
  }
  // 耳を切り取る
  const tris = [];
  const area2 = (a, b, c) => (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x);
  const inTri = (p, a, b, c) => {
    const A = pts[a], B = pts[b], C = pts[c];
    const d1 = (B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x);
    const d2 = (C.x - B.x) * (p.y - B.y) - (C.y - B.y) * (p.x - B.x);
    const d3 = (A.x - C.x) * (p.y - C.y) - (A.y - C.y) * (p.x - C.x);
    return d1 >= -1e-12 && d2 >= -1e-12 && d3 >= -1e-12;
  };
  let r = ring.slice();
  let guard = 0;
  while (r.length > 3 && guard < r.length * 4) {
    let cut = false;
    for (let i = 0; i < r.length; i++) {
      const a = r[(i - 1 + r.length) % r.length], b = r[i], c = r[(i + 1) % r.length];
      if (area2(a, b, c) <= 1e-12) continue;   // へこんだ角は耳ではない
      let ok = true;
      for (let j = 0; j < r.length; j++) {
        const k = r[j];
        if (k === a || k === b || k === c) continue;
        const p = pts[k];
        if ((p.x === pts[a].x && p.y === pts[a].y) || (p.x === pts[b].x && p.y === pts[b].y) || (p.x === pts[c].x && p.y === pts[c].y)) continue;
        if (area2(r[(j - 1 + r.length) % r.length], k, r[(j + 1) % r.length]) > 0) continue;   // 出っぱった点は耳の中に入らない
        if (inTri(p, a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push([a, b, c]);
      r.splice(i, 1);
      cut = true;
      guard = 0;
      break;
    }
    if (!cut) {
      // うまく切れないとき（細い・重なった点）：いちばんましな角を切る
      guard++;
      let bi = 0, ba = -Infinity;
      for (let i = 0; i < r.length; i++) { const v = area2(r[(i - 1 + r.length) % r.length], r[i], r[(i + 1) % r.length]); if (v > ba) { ba = v; bi = i; } }
      tris.push([r[(bi - 1 + r.length) % r.length], r[bi], r[(bi + 1) % r.length]]);
      r.splice(bi, 1);
    }
  }
  if (r.length === 3) tris.push(r);
  return { pts, tris };
}
function segX(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}
function crossesRing(a, b, pts, ring) {
  for (let i = 0; i < ring.length; i++) if (segX(a, b, pts[ring[i]], pts[ring[(i + 1) % ring.length]])) return true;
  return false;
}
function crossesHole(a, b, h) {
  for (let i = 0; i < h.length; i++) if (segX(a, b, h[i], h[(i + 1) % h.length])) return true;
  return false;
}
const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; } return s / 2; };

// 上と下の面を三角形に分ける。three.js の earcut（くぼみ・穴に強い）を使い、なければ自前のやり方で
function triangulateCap(outer, holes) {
  if (window.THREE && THREE.ShapeUtils) {
    const o = outer.map((p) => new THREE.Vector2(p.x, p.y));
    const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)));
    const faces = THREE.ShapeUtils.triangulateShape(o, hs);   // o・hs の最後の重なった点は取り除かれる
    const pts = [...o, ...hs.flat()].map((v) => P(v.x, v.y));
    // 三角形の向きを、上から見て反時計回りにそろえる（裏返った面を作らない）
    const tris = faces.map(([a, b, c]) => {
      const ar = (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x);
      return ar < 0 ? [a, c, b] : [a, b, c];
    });
    return { pts, tris };
  }
  return triangulate(outer, holes);
}
// 押し出したパス1つ → 三角形の一覧 [[x,y,z]×3]（3D の向き：X 右、Y 奥、Z 上。単位 mm）
function solidTriangles(it) {
  const ex = extrudeOf(it);
  if (!ex) return [];
  const z0 = ex.z0, z1 = ex.z0 + ex.h;
  const out = [];
  for (const sh of profileShapes(it)) {
    // 数学の向き（y 上）にして、外形は反時計回り・穴は時計回りにそろえる
    const up = (r) => r.map((p) => P(p.x, -p.y));
    let outer = up(sh.outer); if (ringArea(outer) < 0) outer.reverse();
    const holes = sh.holes.map(up).map((h) => (ringArea(h) > 0 ? h.reverse() : h));
    const { pts, tris } = triangulateCap(outer, holes);
    // 2D（数学の向き）と押し出しの位置 → 3D（[x, 奥行き(上が奥), 高さ]）。
    // 床ならそのまま。傾いたものは平面に置いて法線の向きへ（向きを保つ回転なので、三角形の表裏はそのまま）
    const flat = flatOnFloor(it);
    const T = (q, z) => {
      if (flat) return [q.x, q.y, z];
      const w = solidPoint(it, P(q.x, -q.y), z);
      return [w.x, -w.y, w.z];
    };
    const P3 = (i, z) => T(pts[i], z);
    for (const [a, b, c] of tris) {
      out.push([P3(a, z1), P3(b, z1), P3(c, z1)]);   // 上の面（上向き）
      out.push([P3(a, z0), P3(c, z0), P3(b, z0)]);   // 下の面（下向き）
    }
    // 側面：輪の辺ごとに四角（三角2つ）。外形は反時計回りなので、外向きになる
    for (const r of [outer, ...holes]) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        const a0 = T(a, z0), b0 = T(b, z0), a1 = T(a, z1), b1 = T(b, z1);
        out.push([a0, b0, b1], [a0, b1, a1]);
      }
    }
  }
  return out;
}
