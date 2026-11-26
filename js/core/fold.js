'use strict';
// イラレCAD：展開図を折って組み立てる（試作2：折り線をつかむ）
//
// 面    ：平面図に描いた閉じたパス（押し出していないもの）。1つめのサブパスが外形
// 折り線：2つの面が「両端が同じ、まっすぐな辺」を共有しているところ（0.01mm までのずれは同じとみなす）
// 角度  ：折り線ごと。両側の面に同じ値を持たせる it.fold.h = { 相手の面の ID: 角度 }
//         表（上）の側へ谷折りに起こす向きが +。どちらの面から見ても同じ値になる
// 土台  ：つながっている面のまとまりごとに1つ。it.fold.base = 土台の面の 3D の置き方 { o, u, v }
//         ないときは、いちばん多くの面とつながっている面を床に置いたものとする
// 位置  ：面の 3D の位置（it.plane）は、土台と角度から毎回計算する
//
// 操作（正面図・側面図。選択ツール）
//   折り線をクリック → オレンジ（S.foldHinge）
//   ほかの線にマウスを乗せる → 緑。つかんでドラッグ → 青。つかんだ線の側が折れ、反対側は動かない
//   （つかんだ側に土台があるときは、反対側の面を新しい土台にして、そのままの位置に残す）

const FOLD_TOL = 0.01;   // mm
// 手で並べた面は、辺がほんの少しずれたり重なったりしやすい。この幅までのずれは、同じ線とみなす
const FOLD_GAP = 0.2;    // mm
// これより短い重なりは折り線にしない（ずれて重なった面の、上下の辺どうしが少しだけ重なる分など）
const FOLD_MIN_LEN = 0.5;   // mm

// 折りたたみの面になれるパスか（正面図・側面図でペンで描いたパスは除く）
function isFoldFace(it) {
  if (!it || isGroup(it) || (it.x3d && it.x3d.h > 0)) return false;
  if (it.plane && !it.fold) return false;
  const sb = it.subs && it.subs[0];
  return !!sb && sb.closed && sb.nodes.length >= 3;
}
// 外形のまっすぐな辺（方向線のない辺）
function foldEdges(it) {
  const n = it.subs[0].nodes, L = n.length, out = [];
  for (let i = 0; i < L; i++) {
    const a = n[i], b = n[(i + 1) % L];
    if (a.hout || b.hin || vdist(a, b) < FOLD_TOL) continue;
    out.push({ a: P(a.x, a.y), b: P(b.x, b.y), seg: i });
  }
  return out;
}
const faceArea = (it) => Math.abs(ringArea(it.subs[0].nodes));
const faceCenter2 = (it) => { const ns = it.subs[0].nodes; return P(ns.reduce((s, n) => s + n.x, 0) / ns.length, ns.reduce((s, n) => s + n.y, 0) / ns.length); };

// ---- 折り線の角度（両側の面に同じ値） ----
function hingeDeg(A, B) {
  const a = A.fold && A.fold.h && A.fold.h[B.id], b = B.fold && B.fold.h && B.fold.h[A.id];
  return isFinite(a) ? a : isFinite(b) ? b : 0;
}
function setHingeDeg(A, B, deg) {
  for (const [X, Y] of [[A, B], [B, A]]) {
    const h = { ...((X.fold && X.fold.h) || {}) };
    if (deg) h[Y.id] = deg; else delete h[Y.id];
    X.fold = { ...(X.fold || {}), h };
  }
}

// 面のつながり（折り線）を探す
// 2つの面のまっすぐな辺が、同じ直線の上で重なっていれば、その重なった部分が折り線
// （端と端が同じでなくてもよい。長い辺に小さいフラップが2枚並ぶ形も見つかる）
// 同じところに3枚以上の辺が重なるとき（その場で複製した箱など）は、角度でつながっている面どうしだけを組にする
function foldGraph() {
  const faces = leaves(doc.layers.flatMap((L) => L.items)).filter(isFoldFace);
  const edges = [];
  for (const f of faces) for (const e of foldEdges(f)) edges.push({ f, e, len: vdist(e.a, e.b) });
  // e2 が e1 と同じ直線の上にあるか。重なっている区間（e1 の上の 0..1）を返す
  const overlap = (e1, e2) => {
    const d = vsub(e1.e.b, e1.e.a), L = e1.len, u = vmul(d, 1 / L);
    const off = (p) => Math.abs((p.x - e1.e.a.x) * u.y - (p.y - e1.e.a.y) * u.x);
    if (off(e2.e.a) > FOLD_GAP || off(e2.e.b) > FOLD_GAP) return null;
    const t = (p) => ((p.x - e1.e.a.x) * u.x + (p.y - e1.e.a.y) * u.y);
    const lo = Math.max(0, Math.min(t(e2.e.a), t(e2.e.b))), hi = Math.min(L, Math.max(t(e2.e.a), t(e2.e.b)));
    return hi - lo > FOLD_MIN_LEN ? { a: vadd(e1.e.a, vmul(u, lo)), b: vadd(e1.e.a, vmul(u, hi)) } : null;
  };
  const cand = [];
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const x = edges[i], y = edges[j];
    if (x.f === y.f) continue;
    const ov = overlap(x, y);
    if (ov) cand.push({ x, y, ov });
  }
  const linked = (A, B) => !!(A.fold && A.fold.h && B.id in A.fold.h) || !!(B.fold && B.fold.h && A.id in B.fold.h);
  const adj = new Map(faces.map((f) => [f.id, []]));
  const hinges = [], paired = new Set();
  for (const c of cand) {
    const A = c.x.f, B = c.y.f, k = hingeKey(A, B);
    if (paired.has(k)) continue;   // 同じ2枚の面のあいだの折り線は1本だけ
    // 同じ区間に、ほかの面の辺も重なっているか（重なり部分の真ん中で調べる）
    const mid = vlerp(c.ov.a, c.ov.b, 0.5);
    const dx = vsub(c.x.e.b, c.x.e.a);
    const parallel = (e) => { const d = vsub(e.e.b, e.e.a); return Math.abs(d.x * dx.y - d.y * dx.x) < 1e-6 * vlen(d) * vlen(dx); };
    const crowd = edges.some((e) => e.f !== A && e.f !== B && parallel(e) && segDist(mid, e.e.a, e.e.b) < FOLD_GAP);
    if (crowd && !linked(A, B)) continue;   // どれとどれか決まらないので使わない
    paired.add(k);
    hinges.push({ A, B, e: { a: c.ov.a, b: c.ov.b }, segA: c.x.e.seg, segB: c.y.e.seg });
  }
  // 1枚の面に並んでついたフラップどうし（X・Y がどちらも Z に、一直線の折り線でついている）の境目は、
  // 折り線ではなく切れ目とみなす（つながったままだと、フラップを1枚ずつ折れない）
  const onLine = (h1, h2) => [h2.e.a, h2.e.b].every((p) => Math.abs((p.x - h1.e.a.x) * (h1.e.b.y - h1.e.a.y) - (p.y - h1.e.a.y) * (h1.e.b.x - h1.e.a.x)) < FOLD_GAP * vdist(h1.e.a, h1.e.b));
  const touch = (h, X) => h.A === X || h.B === X;
  const other = (h, X) => (h.A === X ? h.B : h.A);
  const kept = hinges.filter((h) => !hinges.some((h1) => h1 !== h && touch(h1, h.A) && !touch(h1, h.B)
    && hinges.some((h2) => h2 !== h && h2 !== h1 && touch(h2, h.B) && touch(h2, other(h1, h.A)) && onLine(h1, h2))));
  for (const h of kept) { adj.get(h.A.id).push({ to: h.B, e: h.e }); adj.get(h.B.id).push({ to: h.A, e: h.e }); }
  return { faces, adj, hinges: kept };
}
// つながっている面のまとまりごとに、土台からの木にする
function foldTrees(g) {
  const { faces, adj } = g || foldGraph();
  const seen = new Set(), trees = [];
  for (const f0 of faces) {
    if (seen.has(f0.id)) continue;
    const comp = [], st = [f0];
    seen.add(f0.id);
    while (st.length) { const f = st.pop(); comp.push(f); for (const a of adj.get(f.id)) if (!seen.has(a.to.id)) { seen.add(a.to.id); st.push(a.to); } }
    const deg = (f) => adj.get(f.id).length;
    const root = comp.find((f) => f.fold && f.fold.base)
      || comp.reduce((b, f) => (deg(f) > deg(b) || (deg(f) === deg(b) && faceArea(f) > faceArea(b) + 1e-9) ? f : b));
    trees.push({ root, comp, ...treeFrom(root, adj) });
  }
  return trees;
}
// root から近い順にたどる（親の面と、親とのあいだの折り線）
function treeFrom(root, adj) {
  const parent = new Map(), order = [root], vis = new Set([root.id]);
  for (let i = 0; i < order.length; i++) {
    const f = order[i];
    for (const a of adj.get(f.id)) if (!vis.has(a.to.id)) { vis.add(a.to.id); parent.set(a.to.id, { face: f, e: a.e }); order.push(a.to); }
  }
  return { parent, order };
}

// 面の座標の取り方（plane）を、折り線のまわりに deg 度まわす。親の面の表（法線）の側へ起こす向きが +
function rotateFrame(pf, e, face, deg) {
  const A = toWorld(pf, e.a), B = toWorld(pf, e.b);
  const a = [A.x, A.y, A.z];
  let k = v3sub([B.x, B.y, B.z], a);
  k = v3mul(k, 1 / (v3len(k) || 1));
  // 面がわの点（折り線のすぐ内側）が、折り線から見てどちら側か
  const C = toWorld(pf, faceInnerPoint(face, e)), ca = v3sub([C.x, C.y, C.z], a);
  const d = v3sub(ca, v3mul(k, v3dot(k, ca)));
  if (v3dot(v3cross(k, d), planeNormal(pf)) < 0) k = v3mul(k, -1);
  const t = (deg * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
  const rot = (v) => v3add(v3add(v3mul(v, cs), v3mul(v3cross(k, v), sn)), v3mul(k, v3dot(k, v) * (1 - cs)));
  return { o: v3add(a, rot(v3sub(pf.o, a))), u: rot(pf.u), v: rot(pf.v) };
}
// 折り線 e の真ん中から少しだけ面の内側に入った点（2D）。くぼんだ形の面でも、面がどちら側にあるか間違えない
const FOLD_INNER = new Map();
function faceInnerPoint(face, e) {
  const key = face.id + '|' + e.a.x + ',' + e.a.y + ',' + e.b.x + ',' + e.b.y;
  if (FOLD_INNER.has(key)) return FOLD_INNER.get(key);
  const m = vlerp(e.a, e.b, 0.5), d = vsub(e.b, e.a), L = vlen(d) || 1, n = P(-d.y / L, d.x / L);
  const poly = polyFromSub(face.subs[0]);
  const inside = (p) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
  const step = Math.min(0.5, L * 0.05);
  let r = faceCenter2(face);
  for (const sg of [1, -1]) { const q = vadd(m, vmul(n, step * sg)); if (inside(q)) { r = q; break; } }
  FOLD_INNER.set(key, r);
  return r;
}
const isIdentityFrame = (pl) => v3len(pl.o) < 1e-9 && v3len(v3sub(pl.u, [1, 0, 0])) < 1e-9 && v3len(v3sub(pl.v, [0, 1, 0])) < 1e-9;
const fmt6 = (n) => { const r = Math.round(n * 1e6) / 1e6; return Object.is(r, -0) ? 0 : r; };
const roundFrame = (fr) => ({ o: fr.o.map(fmt6), u: fr.u.map(fmt6), v: fr.v.map(fmt6) });

// 試作1（面ごとの角度 it.fold.deg）で保存したものを、折り線ごとの角度に直す
function migrateFoldDeg() {
  const all = leaves(doc.layers.flatMap((L) => L.items));
  if (!all.some((it) => it.fold && isFinite(it.fold.deg))) return;
  for (const t of foldTrees()) for (const f of t.order) {
    if (!f.fold || !isFinite(f.fold.deg)) continue;
    const pr = t.parent.get(f.id);
    const d = f.fold.deg;
    const { deg, ...rest } = f.fold; f.fold = rest;
    if (pr && d) setHingeDeg(f, pr.face, d);
  }
  for (const it of all) if (it.fold && 'deg' in it.fold) { const { deg, ...rest } = it.fold; it.fold = rest; }
}

// コピーした面どうしの角度を引き継ぐ（元の面の ID を、コピーの ID に付け替える）
// origs と copies は同じ形の木（パス・グループ）。コピーの外を指す角度は捨てる
function remapFoldRefs(origs, copies) {
  const o = leaves(origs), c = leaves(copies), map = new Map();
  o.forEach((it, i) => { if (c[i]) map.set(it.id, c[i].id); });
  for (const it of c) {
    if (!it.fold) continue;
    const h = {};
    for (const [k, v] of Object.entries(it.fold.h || {})) if (map.has(k)) h[map.get(k)] = v;
    it.fold = { ...it.fold, h };
  }
}

// 板として見せる面（ほかの面と折り線でつながっている面）
const FOLD_SHOW = new Set();
// 面ごとに：親の面（土台の側）とのあいだの折り線。パネルの角度入力で使う
const FOLD_INFO = new Map();
// 折り線の一覧（いまの 3D の位置つき）。クリックで選ぶのに使う
let FOLD_HINGES = [];
// 土台と角度から、面の 3D の位置（it.plane）を決め直す。描き直しのたびに呼ぶ
function applyFolds() {
  migrateFoldDeg();
  FOLD_SHOW.clear(); FOLD_INFO.clear(); FOLD_INNER.clear();
  const g = foldGraph();
  for (const t of foldTrees(g)) {
    if (t.comp.length > 1) t.comp.forEach((f) => FOLD_SHOW.add(f.id));   // つながった面は、開いていても板で見せる
    const frames = new Map([[t.root.id, (t.root.fold && t.root.fold.base) || PLANE_TOP]]);
    for (const f of t.order) {
      if (f === t.root) continue;
      const pr = t.parent.get(f.id), pf = frames.get(pr.face.id);
      const deg = hingeDeg(f, pr.face);
      frames.set(f.id, deg ? rotateFrame(pf, pr.e, f, deg) : pf);
      FOLD_INFO.set(f.id, { parent: pr.face, e: pr.e });
    }
    for (const f of t.comp) {
      if (f !== t.root && f.fold && f.fold.base) { const { base, ...rest } = f.fold; f.fold = rest; }   // 土台は1つだけ
      const fr = frames.get(f.id) || PLANE_TOP;
      if (isIdentityFrame(fr)) { if (f.plane) delete f.plane; }
      else { f.plane = roundFrame(fr); f.fold = f.fold || {}; }
    }
  }
  FOLD_HINGES = g.hinges;
  // 選んでいた折り線がなくなったら外す
  if (S.foldHinge && !findHinge(S.foldHinge)) S.foldHinge = null;
}
const hingeKey = (A, B) => (A.id < B.id ? A.id + '|' + B.id : B.id + '|' + A.id);
function findHinge(key) { return FOLD_HINGES.find((h) => hingeKey(h.A, h.B) === key) || null; }
// 折り線の 3D の両端
function hingeWorld(h) { const pl = planeOf(h.A); return [toWorld(pl, h.e.a), toWorld(pl, h.e.b)]; }

// ---- パネル ----
// 選んでいる面のうち、折れるもの・土台
function selectedFoldFaces() {
  const trees = foldTrees(), info = new Map();
  for (const t of trees) for (const f of t.comp) info.set(f.id, { root: f === t.root, alone: t.comp.length < 2 });
  const sel = leaves(selectedTops().map((t) => t.node)).filter((it) => info.has(it.id));
  return { movable: sel.filter((it) => !info.get(it.id).root && !info.get(it.id).alone), roots: sel.filter((it) => info.get(it.id).root && !info.get(it.id).alone), alone: sel.filter((it) => info.get(it.id).alone) };
}
// 角度を入れる：オレンジの折り線があればそれ、なければ選んだ面と土台の側の面のあいだ
function setFold(deg) {
  if (!isFinite(deg)) return;
  deg = Math.max(-180, Math.min(180, deg));
  const h = S.foldHinge && findHinge(S.foldHinge);
  if (h) { setHingeDeg(h.A, h.B, deg); render(); commit(); return; }
  const { movable, roots, alone } = selectedFoldFaces();
  if (!movable.length) {
    toast(roots.length ? '土台の面は動きません（ほかの面を選ぶか、折り線をクリックしてください）' : alone.length ? 'この面は、ほかの面と辺がつながっていません（辺をぴったり重ねてください）' : '折り線をクリックするか、折る面を選んでください');
    return;
  }
  for (const it of movable) { const fi = FOLD_INFO.get(it.id); if (fi) setHingeDeg(it, fi.parent, deg); }
  render(); commit();
}
// 全部開く（展開図に戻す。土台も床に戻す）
function unfoldAll() {
  let n = 0;
  for (const it of leaves(doc.layers.flatMap((L) => L.items))) if (it.fold && (Object.keys(it.fold.h || {}).length || it.fold.base)) { it.fold = {}; n++; }
  if (!n) return;
  render(); commit();
}

// ---- 折り線をつかんで折る ----
// 折り線 h のうち、面 g を含む側を動かす。動かない側の面を土台にして、今の位置に残す
// 戻り値：{ h, fixed, moving, path }（path：動かない面 → … → g の道すじ）
// 折り線 h を切ったときに、面 g の側にある面の ID。輪になっていて分かれないときは null
function foldSide(h, g, adj) {
  adj = adj || foldGraph().adj;
  const side = new Set([g.id]), st = [g];
  const cut = (f, a) => (f === h.A && a.to === h.B) || (f === h.B && a.to === h.A);
  while (st.length) { const f = st.pop(); for (const a of adj.get(f.id) || []) if (!cut(f, a) && !side.has(a.to.id)) { side.add(a.to.id); st.push(a.to); } }
  return side.has(h.A.id) && side.has(h.B.id) ? null : side;
}
function startHingeDrag(h, g) {
  const { adj } = foldGraph();
  const side = foldSide(h, g, adj);
  if (!side) return null;   // 輪になっている（折り線を切っても分かれない）
  const moving = side.has(h.A.id) ? h.A : h.B, fixed = moving === h.A ? h.B : h.A;
  // 土台がつかんだ側にあるときは、動かない側の面を新しい土台にする（今の位置のまま）
  const t = foldTrees().find((x) => x.comp.includes(fixed));
  if (t && side.has(t.root.id)) {
    for (const f of t.comp) if (f.fold && f.fold.base) { const { base, ...rest } = f.fold; f.fold = rest; }
    fixed.fold = { ...(fixed.fold || {}), base: roundFrame(planeOf(fixed)) };
  }
  // 動かない面から g までの道すじ
  const { parent } = treeFrom(fixed, adj);
  const path = [];
  for (let f = g; f !== fixed; f = parent.get(f.id).face) path.unshift({ face: f, e: parent.get(f.id).e, from: parent.get(f.id).face });
  return { h, fixed, moving, path, g };
}
// つかんだ線の真ん中（g の 2D）が、マウスにいちばん近づく折り線の角度を探す
// 真横から見ていると同じ位置になる角度が2つあることがあるので、今の角度に近い方を選ぶ
// range：探す角度の範囲 [最小, 最大]（真上から見る平面図では、上に起こす側だけにする）
function hingeAngleToward(d, grab2, toScreen, q, range) {
  const base = planeOf(d.fixed), prev = hingeDeg(d.h.A, d.h.B);
  const lo = range ? range[0] : -180, hi = range ? range[1] : 180;
  const frameOf = (deg) => {
    let fr = base;
    for (const st of d.path) fr = rotateFrame(fr, st.e, st.face, st.from === d.fixed && st.face === d.moving ? deg : hingeDeg(st.face, st.from));
    return fr;
  };
  const cost = (deg) => { const s = toScreen(toWorld(frameOf(deg), grab2)); return Math.hypot(s.x - q.x, s.y - q.y) + Math.abs(deg - prev) * 0.02; };
  let best = prev, bc = cost(prev);
  if (prev < lo || prev > hi) { best = lo; bc = cost(lo); }
  for (let x = lo; x <= hi; x += 2) { const c = cost(x); if (c < bc) { bc = c; best = x; } }
  for (let x = best - 2; x <= best + 2; x += 0.1) { if (x < lo || x > hi) continue; const c = cost(x); if (c < bc) { bc = c; best = x; } }
  return Math.max(lo, Math.min(hi, best));
}
// 吸着：0°・±90°・±180° の近く（4° 以内）に吸い付く。Shift で 15° ずつ
function snapFoldDeg(deg, shift) {
  if (shift) return Math.round(deg / 15) * 15;
  for (const s of [0, 90, -90, 180, -180]) if (Math.abs(deg - s) <= 4) return s;
  return Math.round(deg * 10) / 10;
}

// ---- 線の当たり判定（画面の px） ----
const segDist = (q, a, b) => { const ab = vsub(b, a), L2 = ab.x * ab.x + ab.y * ab.y; const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y) / L2)) : 0; return vdist(q, vadd(a, vmul(ab, t))); };
// 折り線（toScreen：3D → 画面）
function hitHinge(toScreen, q, tolPx = 5) {
  let best = null, bd = tolPx;
  for (const h of FOLD_HINGES) {
    const [a, b] = hingeWorld(h).map(toScreen);
    const d = segDist(q, a, b);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
// オレンジの折り線のまとまりの中の、つかめる線（折り線そのものは除く）。{ face, seg, mid }（mid は face の 2D）
function hitGrabLine(h, toScreen, q, tolPx = 6) {
  const { adj } = foldGraph();
  const seen = new Set([h.A.id]), st = [h.A], comp = [];
  while (st.length) { const f = st.pop(); comp.push(f); for (const a of adj.get(f.id)) if (!seen.has(a.to.id)) { seen.add(a.to.id); st.push(a.to); } }
  let best = null, bd = tolPx;
  for (const f of comp) {
    const n = f.subs[0].nodes, L = n.length, pl = planeOf(f);
    for (let i = 0; i < L; i++) {
      if ((f === h.A && i === h.segA) || (f === h.B && i === h.segB)) continue;
      const a = n[i], b = n[(i + 1) % L];
      const pts = [];
      for (let k = 0; k <= 8; k++) pts.push(cubicAt(a, a.hout || a, b.hin || b, b, k / 8));
      const sp = pts.map((p) => toScreen(toWorld(pl, p)));
      for (let k = 0; k < 8; k++) { const d = segDist(q, sp[k], sp[k + 1]); if (d < bd) { bd = d; best = { face: f, seg: i, mid: cubicAt(a, a.hout || a, b.hin || b, b, 0.5), pts }; } }
    }
  }
  return best;
}

// ---- 回転ハンドル：オレンジの折り線の両側の面に1つずつ出る「つまみ」 ----
// つかんだ側の面が、折り線のまわりに起きる（反対側は動かない）。線を探したり、図を傾けたりしなくてよい
// 戻り値：[{ face, p2（その面の 2D の点）, w（3D の点） }]
function hingeHandles(h) {
  const m = vlerp(h.e.a, h.e.b, 0.5);
  return [h.A, h.B].map((F) => {
    let n = vsub(faceInnerPoint(F, h.e), m);
    n = vmul(n, 1 / (vlen(n) || 1));
    let far = 0;
    for (const v of polyFromSub(F.subs[0])) far = Math.max(far, (v.x - m.x) * n.x + (v.y - m.y) * n.y);
    const p2 = vadd(m, vmul(n, Math.max(1, far * 0.6)));
    return { face: F, p2, w: toWorld(planeOf(F), p2) };
  });
}
function hitFoldHandle(h, toScreen, q, tolPx = 9) {
  let best = null, bd = tolPx;
  for (const hd of hingeHandles(h)) { const s = toScreen(hd.w), d = Math.hypot(s.x - q.x, s.y - q.y); if (d < bd) { bd = d; best = hd; } }
  return best;
}
// 折りたたみのデータを控える・戻す（ドラッグが途中で中断されたとき、元の角度・置き方に戻す）
function snapshotFolds() {
  return new Map(leaves(doc.layers.flatMap((L) => L.items)).filter((it) => it.fold).map((it) => [it.id, clone(it.fold)]));
}
function restoreFolds(snap) {
  for (const it of leaves(doc.layers.flatMap((L) => L.items))) {
    if (snap.has(it.id)) it.fold = clone(snap.get(it.id)); else if (it.fold) delete it.fold;
  }
}
