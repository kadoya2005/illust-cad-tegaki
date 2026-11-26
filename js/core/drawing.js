'use strict';
// イラレCAD：図面（図面レイヤー・寸法・三面図の紙）
//
// 図面レイヤー（L.drawing = true）
//   中のものは図面のためだけのもの。正面図・側面図・3D 表示・STL には出ない（OFF にし忘れても大丈夫）
//   寸法は L.dims に入る（パスとは別。STL や折りたたみの計算には入らない）
// 寸法 { id, dir: 'h'|'v'|'a', a, b, ra, rb, off }
//   a, b … 測る 2 点（最後に分かった位置。平面図の座標＝紙の座標）
//   ra, rb … 何にくっついているか
//     { k: 'node', id, s, i }   … パスのアンカー（形を動かすと寸法も付いてくる）
//     { k: 'view', v, w: [x,y,z] } … 三面図の点（立体の 3D の点。紙の上の位置は毎回計算し直す）
//     null … どこにもくっついていない
//   off … 寸法線の位置（a からの距離。水平なら y の差、垂直なら x の差、平行なら垂直方向の距離）
// 三面図の紙 doc.sheet = { x, y, size: 'A4'|'A3', scale: 'auto' | 数, layer: 図面レイヤーの ID }
//   図面レイヤーが見えているときだけ出る。第三角法（正面図の上に平面図、右に右側面図）

const SHEET_SIZES = { A4: [297, 210], A3: [420, 297] };
const SHEET_SCALES = [2, 1, 0.5, 0.2, 0.1, 0.05];
const DIM = { text: 3.5, arrow: 3, arrowW: 0.6, gap: 1, over: 2, sw: 0.25, color: '#000' };

const isDrawingLayer = (L) => !!(L && L.drawing);
function layerOfItem(it) { const f = findItem(it.id); return f && f.layer; }
// 図面レイヤー以外の、見えているパス（3D・STL・三面図に使う）
function modelLeaves() {
  const out = [];
  const walk = (arr) => { for (const n of arr) { if (n.hidden) continue; if (isGroup(n)) walk(n.children); else out.push(n); } };
  for (const L of doc.layers) if (L.visible && !L.drawing) walk(L.items);
  return out;
}
// 寸法を入れる図面レイヤー（なければ作る）
function drawingLayer(create) {
  const a = activeLayerObj();
  if (isDrawingLayer(a) && layerWritable(a)) return a;
  let L = [...doc.layers].reverse().find((x) => x.drawing && layerWritable(x));
  if (!L && create) {
    L = { id: uid(), name: '図面', color: '#e0559a', visible: true, locked: false, drawing: true, items: [], dims: [] };
    doc.layers.push(L);
    toast('「図面」レイヤーを作りました。寸法と三面図はここに入ります（3D・STL には出ません）');
  }
  if (L && !L.dims) L.dims = [];
  return L || null;
}
function allDims() { return doc.layers.flatMap((L) => (L.drawing && L.dims ? L.dims.map((d) => ({ d, L })) : [])); }
function findDim(id) { for (const L of doc.layers) for (const d of L.dims || []) if (d.id === id) return { d, L }; return null; }

// ================= 三面図 =================
const vkey = (w) => `${Math.round(w[0] * 1000)},${Math.round(w[1] * 1000)},${Math.round(w[2] * 1000)}`;
// 見る向き（その向きへ見る）：正面図は手前から奥へ、平面図は上から下へ、右側面図は右から左へ
const VIEW_DIRS = { front: [0, -1, 0], top: [0, 0, -1], side: [-1, 0, 0] };
// 立体の線（3D の線分）を集める：押し出しは三角形から角の線と輪郭線、平らな面（塗りのある閉じたパス）は外形
// 戻り値：{ edges: { front: [[w1, w2], ...], top, side }, range }
let SHEET_CACHE = null;
function modelEdges() {
  const items = modelLeaves();
  const sig = JSON.stringify(items.map((it) => [it.id, it.subs, it.x3d, it.plane, it.fold && it.fold.base]));
  if (SHEET_CACHE && SHEET_CACHE.sig === sig) return SHEET_CACHE;
  const out = { front: [], top: [], side: [] };
  const anchors = new Map();   // 3D の点 → どのアンカーか（寸法を形に付いてこさせるため）
  let range = null;
  const addR = (w) => {
    if (!range) range = { x0: w[0], x1: w[0], y0: w[1], y1: w[1], z0: w[2], z1: w[2] };
    else { range.x0 = Math.min(range.x0, w[0]); range.x1 = Math.max(range.x1, w[0]); range.y0 = Math.min(range.y0, w[1]); range.y1 = Math.max(range.y1, w[1]); range.z0 = Math.min(range.z0, w[2]); range.z1 = Math.max(range.z1, w[2]); }
  };
  const push = (v, a, b) => { if (Math.hypot(...proj2(v, a).map((c, i) => c - proj2(v, b)[i])) > 1e-6) out[v].push([a, b]); };
  for (const it of items) {
    if (extrudeOf(it)) {
      it.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => { for (const z of [0, 1]) { const w = anchorWorld({ id: it.id, s, i, z }, it); if (w) anchors.set(vkey(w), { id: it.id, s, i, z }); } }));
      // 三角形を、同じ位置の頂点でつなぐ
      const tris = solidTriangles(it).map((t) => t.map((p) => [p[0], -p[1], p[2]]));
      const em = new Map();
      for (const t of tris) {
        const n = v3cross([t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]]);
        const l = Math.hypot(n[0], n[1], n[2]);
        if (l < 1e-12) continue;
        const nn = [-n[0] / l, -n[1] / l, -n[2] / l];   // y を反転したので向きも反転
        for (let i = 0; i < 3; i++) {
          const a = t[i], b = t[(i + 1) % 3], ka = vkey(a), kb = vkey(b);
          const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          let e = em.get(k);
          if (!e) { e = { a, b, ns: [] }; em.set(k, e); }
          e.ns.push(nn);
        }
        t.forEach(addR);
      }
      for (const e of em.values()) {
        const [n1, n2] = e.ns;
        const sharp = e.ns.length !== 2 || n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < Math.cos((30 * Math.PI) / 180);
        for (const v of ['front', 'top', 'side']) {
          let ok = sharp;
          if (!ok) {
            const d = VIEW_DIRS[v], s1 = n1[0] * d[0] + n1[1] * d[1] + n1[2] * d[2], s2 = n2[0] * d[0] + n2[1] * d[1] + n2[2] * d[2];
            ok = (s1 > 1e-9 && s2 < -1e-9) || (s1 < -1e-9 && s2 > 1e-9);   // 輪郭線（表と裏の境目）
          }
          if (ok) push(v, e.a, e.b);
        }
      }
    } else if (it.fill && it.subs.some((sb) => sb.closed)) {
      const pl = planeOf(it);
      it.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => { const w = anchorWorld({ id: it.id, s, i, z: null }, it); if (w) anchors.set(vkey(w), { id: it.id, s, i, z: null }); }));
      for (const sb of it.subs) {
        if (!sb.closed || sb.nodes.length < 2) continue;
        const pts = polyFromSub(sb).map((q) => { const w = toWorld(pl, q); return [w.x, w.y, w.z]; });
        pts.forEach(addR);
        for (let i = 0; i < pts.length; i++) for (const v of ['front', 'top', 'side']) push(v, pts[i], pts[(i + 1) % pts.length]);
      }
    }
  }
  SHEET_CACHE = { sig, edges: out, range, anchors };
  return SHEET_CACHE;
}
// アンカー { id, s, i, z } の 3D の点。z：0＝押し出しの下、1＝上、null＝平らな面
function anchorWorld(a, it) {
  it = it || (findItem(a.id) || {}).item;
  const n = it && !isGroup(it) && it.subs[a.s] && it.subs[a.s].nodes[a.i];
  if (!n) return null;
  if (a.z == null) { if (extrudeOf(it)) return null; const w = toWorld(planeOf(it), n); return [w.x, w.y, w.z]; }
  const x = extrudeOf(it);
  if (!x) return null;
  const w = solidPoint(it, P(n.x, n.y), a.z ? x.z0 + x.h : x.z0);
  return [w.x, w.y, w.z];
}
// 3D の点を、その図の 2D（紙の右・下が正）に。縮尺と置き場所はかけない
function proj2(v, w) {
  if (v === 'front') return [w[0], -w[2]];
  if (v === 'top') return [w[0], w[1]];
  return [-w[1], -w[2]];   // 右側面図：手前（y が大きい）が左
}
// 紙の上の置き場所を決める：{ s（縮尺）, map(v, w) → 紙の点, boxes }
function sheetLayout() {
  const sh = doc.sheet;
  if (!sh) return null;
  const me = modelEdges(), r = me.range;
  const [PW, PH] = SHEET_SIZES[sh.size] || SHEET_SIZES.A4;
  const margin = 10, titleH = 22, gap = 15;
  const areaW = PW - 2 * margin - 10, areaH = PH - 2 * margin - titleH - 10;
  if (!r) return { me, s: 1, PW, PH, map: null, empty: true };
  const W = r.x1 - r.x0, D = r.y1 - r.y0, Hh = r.z1 - r.z0;
  const need = (s) => [(W + D) * s + gap, (D + Hh) * s + gap];
  let s = sh.scale;
  if (s === 'auto' || !(s > 0)) s = SHEET_SCALES.find((k) => { const [w, h] = need(k); return w <= areaW && h <= areaH; }) || SHEET_SCALES[SHEET_SCALES.length - 1];
  const [tw, th] = need(s);
  const left = sh.x + margin + 5 + Math.max(0, (areaW - tw) / 2), top = sh.y + margin + 5 + Math.max(0, (areaH - th) / 2);
  const frontL = left, frontB = top + D * s + gap + Hh * s, topT = top, sideL = left + W * s + gap;
  const map = (v, w) => {
    if (v === 'front') return P(frontL + (w[0] - r.x0) * s, frontB - (w[2] - r.z0) * s);
    if (v === 'top') return P(frontL + (w[0] - r.x0) * s, topT + (w[1] - r.y0) * s);
    return P(sideL + (r.y1 - w[1]) * s, frontB - (w[2] - r.z0) * s);
  };
  return { me, s, PW, PH, map, margin, titleH };
}
const sheetVisible = () => { const sh = doc.sheet; if (!sh) return false; const L = doc.layers.find((x) => x.id === sh.layer); return !!L && L.visible; };
const scaleLabel = (s) => (s >= 1 ? `${r2(s)}:1` : `1:${r2(1 / s)}`);
// 三面図の紙の SVG（文書の座標＝紙の mm）
function sheetSvg() {
  if (!sheetVisible()) return '';
  const sh = doc.sheet, lay = sheetLayout(), { PW, PH } = lay;
  let h = `<g pointer-events="none"><rect x="${sh.x}" y="${sh.y}" width="${PW}" height="${PH}" fill="#fff" stroke="#000" stroke-opacity="0.5" stroke-width="0.3"/>`;
  const m = lay.margin || 10, tH = lay.titleH || 22;
  h += `<rect x="${sh.x + m}" y="${sh.y + m}" width="${PW - 2 * m}" height="${PH - 2 * m}" fill="none" stroke="#000" stroke-width="0.7"/>`;
  // 表題欄（右下）
  const tw = 110, tx = sh.x + PW - m - tw, ty = sh.y + PH - m - tH;
  const name = baseName(S.fileName), date = new Date().toISOString().slice(0, 10);
  h += `<rect x="${tx}" y="${ty}" width="${tw}" height="${tH}" fill="none" stroke="#000" stroke-width="0.5"/>`
    + `<line x1="${tx}" y1="${ty + tH / 2}" x2="${tx + tw}" y2="${ty + tH / 2}" stroke="#000" stroke-width="0.25"/>`
    + `<line x1="${tx + 70}" y1="${ty}" x2="${tx + 70}" y2="${ty + tH}" stroke="#000" stroke-width="0.25"/>`
    + `<text x="${tx + 3}" y="${ty + 7.5}" font-size="4" fill="#000">${svgEsc(name)}</text>`
    + `<text x="${tx + 3}" y="${ty + tH / 2 + 7.5}" font-size="3" fill="#000">第三角法　単位 mm</text>`
    + `<text x="${tx + 73}" y="${ty + 7.5}" font-size="3.2" fill="#000">尺度 ${scaleLabel(lay.s)}</text>`
    + `<text x="${tx + 73}" y="${ty + tH / 2 + 7.5}" font-size="3" fill="#000">${date}</text>`;
  if (lay.empty) h += `<text x="${sh.x + PW / 2}" y="${sh.y + PH / 2}" font-size="5" fill="#999" text-anchor="middle">立体（押し出したパス）がまだありません</text>`;
  else {
    let d = '';
    for (const v of ['front', 'top', 'side']) for (const [a, b] of lay.me.edges[v]) {
      const p = lay.map(v, a), q = lay.map(v, b);
      d += `M${r3(p.x)} ${r3(p.y)}L${r3(q.x)} ${r3(q.y)}`;
    }
    h += `<path d="${d}" fill="none" stroke="#000" stroke-width="0.5" stroke-linecap="round"/>`;
  }
  return h + '</g>';
}
const r3 = (v) => Math.round(v * 1000) / 1000;
// 三面図の点（寸法の吸着先）：[{ x, y, kind, ref }]
function sheetCands() {
  if (!sheetVisible()) return [];
  const lay = sheetLayout();
  if (!lay.map) return [];
  const seen = new Set(), out = [];
  for (const v of ['front', 'top', 'side']) for (const e of lay.me.edges[v]) for (const w of e) {
    const p = lay.map(v, w), k = v + Math.round(p.x * 1000) + ',' + Math.round(p.y * 1000);
    if (seen.has(k)) continue;
    seen.add(k);
    const an = lay.me.anchors.get(vkey(w));
    out.push({ x: p.x, y: p.y, kind: { front: '正面図', top: '平面図', side: '右側面図' }[v], ref: { k: 'view', v, w: w.slice(), an: an ? { ...an } : null } });
  }
  return out;
}
// 三面図の紙を作る・消す
function toggleSheet() {
  if (doc.sheet) {
    doc.sheet = null;
    render(); commit(); updateDrawingPanel();
    return;
  }
  const L = drawingLayer(true);
  doc.sheet = { x: doc.width + 30, y: 0, size: 'A4', scale: 'auto', layer: L.id };
  render(); commit(); updateDrawingPanel();
  zoomToDocRect({ x: 0, y: 0, w: doc.sheet.x + SHEET_SIZES.A4[0], h: Math.max(doc.height, SHEET_SIZES.A4[1]) });
}
function zoomToDocRect(b) {
  const r = stage.getBoundingClientRect();
  if (!r.width) return;
  view.r = 0;
  view.z = Math.min((r.width - 80) / b.w, (r.height - 80) / b.h);
  placeDocAt(P(b.x + b.w / 2, b.y + b.h / 2), P(r.width / 2, r.height / 2));
  renderView();
}

// ================= 寸法 =================
// くっついている先の、いまの位置（null なら参照切れ）
function refPoint(ref, fallback) {
  if (!ref) return fallback;
  if (ref.k === 'node') {
    const f = findItem(ref.id), sb = f && !isGroup(f.item) && f.item.subs[ref.s], n = sb && sb.nodes[ref.i];
    if (!n || !onTop(f.item)) return null;
    return P(n.x, n.y);
  }
  if (ref.k === 'view') {
    const lay = sheetVisible() && sheetLayout();
    if (!lay || !lay.map) return null;
    // アンカーの角なら、いまのアンカーの位置から（形を直すと付いてくる）。輪郭線の点などは、その 3D の点が残っているときだけ
    const w = ref.an ? anchorWorld(ref.an) : ref.w;
    if (!w) return null;
    if (!ref.an) { const kk = vkey(w); if (!lay.me.edges[ref.v].some(([a, b]) => vkey(a) === kk || vkey(b) === kk)) return null; }
    return lay.map(ref.v, w);
  }
  return fallback;
}
// 寸法の形：{ a, b, p1, p2（寸法線の両端）, len（mm）, ok }
function dimGeom(d) {
  const A = refPoint(d.ra, d.a), B = refPoint(d.rb, d.b);
  const ok = !!(A && B);
  const a = A || d.a, b = B || d.b;
  let p1, p2, len;
  if (d.dir === 'h') { const y = a.y + d.off; p1 = P(a.x, y); p2 = P(b.x, y); len = Math.abs(b.x - a.x); }
  else if (d.dir === 'v') { const x = a.x + d.off; p1 = P(x, a.y); p2 = P(x, b.y); len = Math.abs(b.y - a.y); }
  else {
    const u = vsub(b, a), l = vlen(u) || 1, n = P(-u.y / l, u.x / l);
    p1 = vadd(a, vmul(n, d.off)); p2 = vadd(b, vmul(n, d.off)); len = l;
  }
  // 三面図の上の寸法は、縮尺で割って実物の長さに
  const sc = (d.ra && d.ra.k === 'view') || (d.rb && d.rb.k === 'view') ? (sheetLayout() || {}).s || 1 : 1;
  return { a, b, p1, p2, len: len / sc, ok };
}
const fmtDim = (v) => String(Math.round(v * 100) / 100);
// 寸法 1 つの SVG（文書の座標＝mm）
function dimSvg(d, col) {
  const g = dimGeom(d), c = col || (g.ok ? DIM.color : '#e23');
  const { a, b, p1, p2 } = g;
  const sw = DIM.sw;
  let h = '';
  // 寸法補助線：測る点から少し離して、寸法線の少し先まで
  for (const [q, p] of [[a, p1], [b, p2]]) {
    const v = vsub(p, q), l = vlen(v);
    if (l < 1e-6) continue;
    const u = vmul(v, 1 / l), s = vadd(q, vmul(u, Math.min(DIM.gap, l))), e = vadd(p, vmul(u, DIM.over));
    h += `<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" stroke="${c}" stroke-width="${sw}"/>`;
  }
  h += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${c}" stroke-width="${sw}"/>`;
  const L = vdist(p1, p2);
  if (L > 1e-6) {
    const u = vmul(vsub(p2, p1), 1 / L), n = P(-u.y, u.x), al = Math.min(DIM.arrow, L / 2.5), aw = DIM.arrowW * (al / DIM.arrow);
    for (const [tip, dir] of [[p1, u], [p2, vmul(u, -1)]]) {
      const bse = vadd(tip, vmul(dir, al));
      const l1 = vadd(bse, vmul(n, aw)), l2 = vadd(bse, vmul(n, -aw));
      h += `<path d="M${tip.x} ${tip.y}L${l1.x} ${l1.y}L${l2.x} ${l2.y}Z" fill="${c}"/>`;
    }
  }
  // 数値：寸法線の真ん中の上（読む向きは下か右から）
  let ang = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  if (ang > 90.001) ang -= 180; else if (ang <= -90.001) ang += 180;
  const m = P((p1.x + p2.x) / 2, (p1.y + p2.y) / 2), r = (ang * Math.PI) / 180, up = P(Math.sin(r), -Math.cos(r));
  const t = vadd(m, vmul(up, 0.8));
  h += `<text x="${t.x}" y="${t.y}" font-size="${DIM.text}" fill="${c}" text-anchor="middle" transform="rotate(${ang} ${t.x} ${t.y})">${fmtDim(g.len)}${g.ok ? '' : ' ?'}</text>`;
  return `<g data-dim="${d.id}" pointer-events="none">${h}</g>`;
}
function dimsSvg() {
  let h = '';
  for (const L of doc.layers) if (L.visible && L.drawing && L.dims) for (const d of L.dims) h += dimSvg(d);
  return h;
}
// 寸法の当たり判定（文書の点 p）
function hitDim(p) {
  const T = tol() * 1.5;
  for (const L of [...doc.layers].reverse()) {
    if (!L.visible || !L.drawing || !L.dims || L.locked) continue;
    for (const d of [...L.dims].reverse()) {
      const g = dimGeom(d), m = P((g.p1.x + g.p2.x) / 2, (g.p1.y + g.p2.y) / 2);
      if (segDist(p, g.p1, g.p2) <= T || vdist(p, m) <= DIM.text * 1.5 + T) return { d, L };
    }
  }
  return null;
}
// 3 点目（寸法線の位置 c）から、向きと位置を決める
//   2 点の横の範囲の外（左右）なら垂直、それ以外は水平。Shift で 2 点を結ぶ向き（平行）
function dimFromPlace(a, b, c, aligned) {
  if (aligned) {
    const u = vsub(b, a), l = vlen(u) || 1, n = P(-u.y / l, u.x / l);
    return { dir: 'a', off: (c.x - a.x) * n.x + (c.y - a.y) * n.y };
  }
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const outX = c.x < x0 || c.x > x1, outY = c.y < y0 || c.y > y1;
  let dir;
  if (outX && !outY) dir = 'v';
  else if (outY && !outX) dir = 'h';
  else dir = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'h' : 'v';
  return dir === 'h' ? { dir, off: c.y - a.y } : { dir, off: c.x - a.x };
}
function deleteSelectedDims() {
  if (!S.selDims || !S.selDims.size) return false;
  for (const L of doc.layers) if (L.dims) L.dims = L.dims.filter((d) => !S.selDims.has(d.id));
  S.selDims.clear();
  render(); commit();
  return true;
}
