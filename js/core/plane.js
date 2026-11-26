'use strict';
// イラレCAD：作業平面（段階3）
// パスの形（nodes）は今までどおり 2D のまま持つ。どこに置くかを it.plane で持つ
//   it.plane = { o: [x, y, z], u: [x, y, z], v: [x, y, z] }
//   パスの点 (px, py) → アプリの 3D の点 = o + px·u + py·v
// plane がないパスは平面図（床）の上：o=(0,0,0)、u=(1,0,0)、v=(0,1,0)
//
// アプリの 3D の座標：x は右、y は下（＝手前）、z は上（高さ）
// three.js の座標：X = x、Y = z、Z = y（toThree で変える）
//
// 正面図・側面図の板は、画面の右と下がそのまま u と v になるように決める
//   正面図（手前から見る）：u=(1,0,0) 右、v=(0,0,-1) 下へ行くと低くなる。o の y が奥行き
//   側面図（右から見る）  ：u=(0,-1,0) 右へ行くと奥、v=(0,0,-1)。o の x が左右の位置

const PLANE_TOP = Object.freeze({ o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] });
const planeTop = (z = 0) => ({ o: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0] });
const planeFront = (depth = 0) => ({ o: [0, depth, 0], u: [1, 0, 0], v: [0, 0, -1] });
const planeSide = (x = 0) => ({ o: [x, 0, 0], u: [0, -1, 0], v: [0, 0, -1] });
// 図の名前から、その図の板（depth はその図の奥行きの位置）
const planeForView = (id, depth) => (id === 'viewFront' ? planeFront(depth) : id === 'viewSide' ? planeSide(depth) : planeTop(depth || 0));

// ---- 小さなベクトルの計算（[x, y, z] の配列） ----
const v3 = (x, y, z) => [x, y, z];
const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3len = (a) => Math.hypot(a[0], a[1], a[2]);

// パスの作業平面（ないものは床）
const planeOf = (it) => (it && it.plane) || PLANE_TOP;
// 床に平行な平面か（平面図にふつうに描いてよいもの）。高さが 0 でなくても平面図では同じ形に見える
function isTopPlane(pl) {
  pl = pl || PLANE_TOP;
  return Math.abs(pl.u[0] - 1) < 1e-9 && Math.abs(pl.u[1]) < 1e-9 && Math.abs(pl.u[2]) < 1e-9
    && Math.abs(pl.v[0]) < 1e-9 && Math.abs(pl.v[1] - 1) < 1e-9 && Math.abs(pl.v[2]) < 1e-9
    && Math.abs(pl.o[0]) < 1e-9 && Math.abs(pl.o[1]) < 1e-9;
}
// 平面図で扱うパスか：床に平行なもの、または折りたたみの面（平面図では展開図のまま直せる）
// 「平面図を組み立てた形で見る」（S.planFolded）のときは、折った面は真上から見た形になり、平面図では直せない
const onTop = (it) => !it.plane || (!!it.fold && !S.planFolded) || isTopPlane(it.plane);
// 3D で本当に床に平行に置かれているか（折った面は含まない）
const flatOnFloor = (it) => !it.plane || isTopPlane(it.plane);
// 平面の向き（法線）
const planeNormal = (pl) => v3cross(pl.u, pl.v);
// 正面・側面・床・そのほか（表示の名前などに使う）
function planeKind(pl) {
  const n = planeNormal(pl || PLANE_TOP);
  if (Math.abs(Math.abs(n[2]) - 1) < 1e-9) return 'top';
  if (Math.abs(Math.abs(n[1]) - 1) < 1e-9) return 'front';
  if (Math.abs(Math.abs(n[0]) - 1) < 1e-9) return 'side';
  return 'other';
}
// 同じ平面の上か（向きが同じで、同じ位置）
function samePlane(a, b) {
  a = a || PLANE_TOP; b = b || PLANE_TOP;
  const na = planeNormal(a), nb = planeNormal(b);
  return v3len(v3cross(na, nb)) < 1e-6 && Math.abs(v3dot(na, v3sub(b.o, a.o))) < 1e-6;
}
// 2D の座標の取り方まで同じか（同じ (x, y) が同じ 3D の点になる）。
// パスをつなぐ・アンカーを足す・まとめて形を変えるのは、これが true のときだけ
function sameFrame(a, b) {
  a = a || PLANE_TOP; b = b || PLANE_TOP;
  return v3len(v3sub(a.u, b.u)) < 1e-9 && v3len(v3sub(a.v, b.v)) < 1e-9 && v3len(v3sub(a.o, b.o)) < 1e-6;
}

// パスの 2D の点 → アプリの 3D の点 {x, y, z}
function toWorld(pl, p) {
  pl = pl || PLANE_TOP;
  return {
    x: pl.o[0] + p.x * pl.u[0] + p.y * pl.v[0],
    y: pl.o[1] + p.x * pl.u[1] + p.y * pl.v[1],
    z: pl.o[2] + p.x * pl.u[2] + p.y * pl.v[2],
  };
}
// アプリの 3D の点 → パスの 2D の点（平面に下ろした位置。u と v は長さ 1 で直角とする）
function toLocal(pl, w) {
  pl = pl || PLANE_TOP;
  const d = [w.x - pl.o[0], w.y - pl.o[1], w.z - pl.o[2]];
  return P(v3dot(d, pl.u), v3dot(d, pl.v));
}
// アプリの 3D の点 → three.js の点
const toThree = (w) => new THREE.Vector3(w.x, w.z, w.y);
const fromThree = (t) => ({ x: t.x, y: t.z, z: t.y });

// 光線（three.js のカメラから出る線）と作業平面の交点 → パスの 2D の点。平行なら null
function rayToLocal(pl, ray) {
  pl = pl || PLANE_TOP;
  const n = planeNormal(pl);
  const o = [ray.origin.x, ray.origin.z, ray.origin.y], d = [ray.direction.x, ray.direction.z, ray.direction.y];
  const den = v3dot(n, d);
  if (Math.abs(den) < 1e-9) return null;
  const t = v3dot(n, v3sub(pl.o, o)) / den;
  const w = v3add(o, v3mul(d, t));
  return toLocal(pl, { x: w[0], y: w[1], z: w[2] });
}

// パスを 3D の折れ線にする（サブパスごと。閉じたものは最初の点を最後にもう一度）
function subWorldPts(it, sb) {
  const pl = planeOf(it);
  const pts = polyFromSub(sb).map((p) => toWorld(pl, p));
  if (sb.closed && pts.length) pts.push(pts[0]);
  return pts;
}
// 3D の範囲 { x0, x1, y0, y1, z0, z1 }。押し出しは高さも入れる
function worldRange(items) {
  let r = null;
  const add = (w) => {
    if (!r) r = { x0: w.x, x1: w.x, y0: w.y, y1: w.y, z0: w.z, z1: w.z };
    else { r.x0 = Math.min(r.x0, w.x); r.x1 = Math.max(r.x1, w.x); r.y0 = Math.min(r.y0, w.y); r.y1 = Math.max(r.y1, w.y); r.z0 = Math.min(r.z0, w.z); r.z1 = Math.max(r.z1, w.z); }
  };
  for (const it of items) {
    if (flatOnFloor(it)) {
      const bb = Geo.bbox([it]);
      if (!bb) continue;
      const x = typeof extrudeOf === 'function' ? extrudeOf(it) : null;
      const z = it.plane ? it.plane.o[2] : 0;
      const za = x ? x.z0 : z, zb = x ? x.z0 + x.h : z;
      add({ x: bb.x, y: bb.y, z: za }); add({ x: bb.x + bb.w, y: bb.y + bb.h, z: zb });
    } else {
      const x = typeof extrudeOf === 'function' ? extrudeOf(it) : null;
      const n = planeNormal(planeOf(it));
      for (const sb of it.subs) if (sb.nodes.length) for (const w of subWorldPts(it, sb)) {
        if (!x) { add(w); continue; }
        // 傾いた押し出し：底と上の面の両方
        for (const z of [x.z0, x.z0 + x.h]) add({ x: w.x + n[0] * z, y: w.y + n[1] * z, z: w.z + n[2] * z });
      }
    }
  }
  return r;
}

// 平面図に出すための形：真上から見た 3D の線（床に平行でないパスの「参考」の表示）
// 傾いた押し出しは、底と上の面の輪郭と、角どうしを結ぶ線
function planProjD(it, sp) {
  let d = '';
  const x = typeof extrudeOf === 'function' ? extrudeOf(it) : null;
  const n = planeNormal(planeOf(it));
  const off = (w, z) => ({ x: w.x + n[0] * z, y: w.y + n[1] * z });
  const to = (w) => (sp ? sp(P(w.x, w.y)) : P(w.x, w.y));
  const line = (pts, closed) => pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join('') + (closed ? 'Z' : '');
  for (const sb of it.subs) {
    if (sb.nodes.length < 2) continue;
    const ws = subWorldPts(it, sb);
    if (!x) { d += line(ws.map(to), sb.closed); continue; }
    const a = ws.map((w) => to(off(w, x.z0))), b = ws.map((w) => to(off(w, x.z0 + x.h)));
    d += line(a, sb.closed) + line(b, sb.closed);
    // 角（アンカーポイント）どうしを結ぶ
    for (const nd of sb.nodes) { const w = toWorld(planeOf(it), P(nd.x, nd.y)); d += line([to(off(w, x.z0)), to(off(w, x.z0 + x.h))], false); }
  }
  return d;
}

// ---- 入力の文脈（どの図で操作しているか） ----
// S.input：正面図・側面図でペンなどを使っているあいだだけ { view, plane, scale, handleHits }。平面図では null
// ツールには、その作業平面の 2D の座標が渡る。ツール自身は 3D を知らなくてよい
const inputScale = () => (S.input ? S.input.scale : view.z);   // 1mm が画面で何 px か
// いま操作している平面の上のパスか（平面図では床に平行なパス）。違う平面のパスは選ばない・つながない
const inInputPlane = (it) => (S.input ? sameFrame(planeOf(it), S.input.plane) : onTop(it));
