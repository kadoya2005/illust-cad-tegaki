'use strict';
// イラレCAD：ガイドのドラッグ・図形ツール・ツールの切り替え

// ---- ガイドを動かす・消す ----
function dragGuide(p) {
  const d = S.drag, g = doc.guides[d.i];
  if (!g) return;
  d.moved = true;
  g.v = g.axis === 'x' ? p.x : p.y;
}
function inRulerZone(sp, axis) {
  const r = stage.getBoundingClientRect();
  if (sp.x < 0 || sp.y < 0 || sp.x > r.width || sp.y > r.height) return true;
  return S.rulers && (axis === 'y' ? sp.y < RULER : sp.x < RULER);
}
function endGuideMove(sp) {
  const d = S.drag, g = doc.guides[d.i];
  if (g && inRulerZone(sp, g.axis)) { doc.guides.splice(d.i, 1); S.selGuide = null; }
  commit();
}

function shapeTool(kind) {
  return {
    down(e, p) {
      if (!layerWritable(activeLayerObj())) { toast('ロック中または非表示のレイヤーには描けません'); return; }
      const cands = buildCands();
      S.drag = { type: 'shape', kind, start: snapPoint(p, cands).p, moved: false, id: null, cands };
    },
    move(e, p) {
      const d = S.drag;
      if (!d.moved && vdist(p, d.start) * view.z < 3) return;
      d.moved = true;
      S.snapViz = null;
      if (!e.shiftKey) { const sn = snapPoint(p, d.cands); p = sn.p; S.snapViz = sn.viz; }
      d.last = { p, shift: e.shiftKey, alt: e.altKey };
      redrawShape(d);
    },
    up(e) {
      const d = S.drag;
      if (d.moved) { commit(); return; }
      const start = d.start, alt = e.altKey;
      S.drag = null;
      setTimeout(() => shapeDialog(kind, start, alt), 0);
    },
  };
}
function redrawShape(d) {
  const { p, shift, alt } = d.last;
  const subs = [shapeFromDrag(d.kind, d.start, p, shift, alt)];
  if (!d.id) { const it = newItem(subs, d.kind === 'line'); activeLayerObj().items.push(it); d.id = it.id; selItem(it, false); }
  else { const f = findItem(d.id); if (f) f.item.subs = subs; }
  renderArt();
}
// 角丸長方形：半径を幅・高さの半分までにおさえる。0 なら普通の長方形
function roundRectFit(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return rr > 1e-6 ? roundRectSub(x, y, w, h, rr, rr) : rectSub(x, y, x + w, y + h);
}
// 角丸長方形をドラッグ中の矢印キー（イラレと同じ）：↑ 大きく、↓ 小さく、← 角なし、→ いちばん丸く
function roundRectKey(k, sh) {
  const d = S.drag;
  if (!d || d.type !== 'shape' || d.kind !== 'roundRect') return false;
  const st = sh ? 2 : 0.5;
  if (k === 'ArrowUp') S.roundR += st;
  else if (k === 'ArrowDown') S.roundR = Math.max(0, S.roundR - st);
  else if (k === 'ArrowLeft') S.roundR = 0;
  else if (k === 'ArrowRight') { if (d.last) { const a = d.start, b = d.last.p; S.roundR = Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * (d.last.alt ? 1 : 0.5); } }
  else return false;
  S.roundR = Math.round(S.roundR * 100) / 100;
  if (d.last) { d.moved = true; redrawShape(d); }
  toast(`角丸の半径 ${fmt(S.roundR)} mm`);
  return true;
}
function shapeFromDrag(kind, a, b, shift, alt) {
  if (kind === 'line') {
    const q = shift ? constrain45(a, b) : b;
    const s = alt ? P(2 * a.x - q.x, 2 * a.y - q.y) : a;
    return { nodes: [mkNode(s.x, s.y), mkNode(q.x, q.y)], closed: false };
  }
  let dx = b.x - a.x, dy = b.y - a.y;
  if (shift) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
  const x0 = alt ? a.x - dx : a.x, y0 = alt ? a.y - dy : a.y, x1 = a.x + dx, y1 = a.y + dy;
  const L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);
  if (kind === 'roundRect') return roundRectFit(L, T, R - L, B - T, S.roundR);
  return kind === 'rect' ? rectSub(L, T, R, B) : ellipseSub((L + R) / 2, (T + B) / 2, (R - L) / 2, (B - T) / 2);
}
// 画面をクリックしたとき：数値で作る（イラレと同じ。移動などと同じ画面で、プレビューもできる）
//   長方形・楕円：幅・高さ・厚み（厚みを入れると、その高さで押し出した立体になる。空欄か 0 なら平らなパス）
//   直線：長さ・角度
function shapeDialog(kind, p, alt) {
  const isLine = kind === 'line';
  const isRR = kind === 'roundRect';
  const last = S.dlgLast[kind] || (isLine ? { len: 30, ang: 0 } : { w: 30, h: 30, t: 0 });
  const make = (v) => {
    if (isLine) {
      if (!(v.len > 0)) return null;
      const r = (v.ang * Math.PI) / 180, q = P(p.x + Math.cos(r) * v.len, p.y - Math.sin(r) * v.len);
      return alt ? { nodes: [mkNode(2 * p.x - q.x, 2 * p.y - q.y), mkNode(q.x, q.y)], closed: false } : { nodes: [mkNode(p.x, p.y), mkNode(q.x, q.y)], closed: false };
    }
    if (!(v.w > 0) || !(v.h > 0)) return null;
    const x0 = alt ? p.x - v.w / 2 : p.x, y0 = alt ? p.y - v.h / 2 : p.y;
    if (isRR) return roundRectFit(x0, y0, v.w, v.h, v.r > 0 ? v.r : 0);
    return kind === 'rect' ? rectSub(x0, y0, x0 + v.w, y0 + v.h) : ellipseSub(x0 + v.w / 2, y0 + v.h / 2, v.w / 2, v.h / 2);
  };
  openDialog({
    title: isLine ? '直線' : kind === 'rect' ? '長方形' : isRR ? '角丸長方形' : '楕円',
    fields: isLine
      ? [{ id: 'len', label: '長さ', value: fmt(last.len), unit: 'mm' }, { id: 'ang', label: '角度', value: fmt(last.ang), unit: '°（反時計回り）' }]
      : [{ id: 'w', label: '幅', value: fmt(last.w), unit: 'mm' }, { id: 'h', label: '高さ', value: fmt(last.h), unit: 'mm' },
        ...(isRR ? [{ id: 'r', label: '角丸の半径', value: fmt(S.roundR), unit: 'mm' }] : []),
        { id: 't', label: '厚み', value: last.t ? fmt(last.t) : '', unit: 'mm（空欄なら平らなパス）' }],
    copy: false,
    apply: (v, copy, pv) => {
      const sb = make(v);
      if (!sb) { if (!pv) toast(isLine ? '長さは 0 より大きくしてください' : '幅と高さは 0 より大きくしてください'); return; }
      const it = newItem([sb], isLine);
      if (!isLine && v.t > 0) it.x3d = { z0: 0, h: v.t };
      activeLayerObj().items.push(it);
      selItem(it, false);
      if (pv) return;
      if (isRR && v.r >= 0) S.roundR = v.r;
      S.dlgLast[kind] = isLine ? { len: v.len, ang: v.ang } : { w: v.w, h: v.h, t: v.t > 0 ? v.t : 0 };
      render(); commit();
    },
  });
}

function setTool(t) {
  if (!TOOLS_META[t]) return;
  if (S.drawing && t !== 'pen' && t !== 'hand' && t !== 'zoom') endDrawing();
  S.tool = t;
  if (t !== 'dim') S.dimDraft = null;
  if (SEL_TOOLS.has(t)) S.lastSelTool = t;
  if (!XF_TOOLS.has(t)) S.xfOrigin = null;
  S.hover = null; S.penHint = ''; S.snapViz = null;
  updateUI(); drawOverlay(); updateCursor();
}
// 方向線の先に重ねたときのカーソル（イラレのアンカーポイントツールの「＜」）。先端（左の角）がクリック位置
const HANDLE_CURSOR = (() => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">'
    + '<polyline points="15,4 4,12 15,20" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="miter" stroke-linecap="square"/>'
    + '<polyline points="15,4 4,12 15,20" fill="none" stroke="#000" stroke-width="1.6" stroke-linejoin="miter" stroke-linecap="square"/></svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 12, default`;
})();
// 選択ツール＝黒い矢印、ダイレクト選択ツール＝白い矢印（先端がクリック位置）
const svgCursor = (body, hx, hy, fb) => `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' + body + '</svg>')}") ${hx} ${hy}, ${fb}`;
const ARROW_PTS = '2,2 2,19 6.5,15 9.5,21.5 12.2,20.3 9.3,14 15,14';
const SELECT_CURSOR = svgCursor(`<polygon points="${ARROW_PTS}" fill="#000" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`, 2, 2, 'default');
const DIRECT_CURSOR = svgCursor(`<polygon points="${ARROW_PTS}" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>`, 2, 2, 'default');
// バウンディングボックスの角の外：回転のカーソル（曲がった両矢印）。角の向きに合わせて回す
const ROTATE_CURSORS = {}, ROTATE3D_CURSORS = {};
for (const [id, deg] of Object.entries({ ne: 0, se: 90, sw: 180, nw: 270 })) {
  const arc = '<path d="M5,9 Q15,9 15,19" fill="none" stroke="STK" stroke-width="SW"/>'
    + '<polygon points="5,5 5,13 1,9" fill="STK" stroke="STK" stroke-width="SW2"/>'
    + '<polygon points="11,19 19,19 15,23" fill="STK" stroke="STK" stroke-width="SW2"/>';
  const layer = (stk, sw, sw2) => arc.replace(/STK/g, stk).replace(/SW2/g, sw2).replace(/SW/g, sw);
  ROTATE_CURSORS[id] = svgCursor(`<g transform="rotate(${deg} 12 12)">${layer('#fff', 4, 2.5)}${layer('#000', 1.5, 0.5)}</g>`, 12, 12, 'crosshair');
  // 正面図・側面図で立体を回すとき（3D の回転）はオレンジ
  ROTATE3D_CURSORS[id] = svgCursor(`<g transform="rotate(${deg} 12 12)">${layer('#fff', 4.5, 3)}${layer(COL_ROT, 2, 0.8)}</g>`, 12, 12, 'crosshair');
}
function overRotate(t) {
  if (S.drag) return S.drag.type === 'bbRotate' ? S.drag.corner : null;
  if (t !== 'select' || !S.mouseScr || !S.sel.size) return null;
  if (hitBBoxHandle(S.mouseScr)) return null;
  return hitBBoxRotate(S.mouseScr);
}
function overHandle(t) {
  if (S.drag) return S.drag.type === 'handle';
  if (!S.mouseScr) return false;
  const ok = t === 'direct' || t === 'convert' || (t === 'pen' && S.keys.alt);
  return ok && !!hitHandle(S.mouseScr);
}
function updateCursor() {
  const t = displayTool();
  let c = 'default';
  const rot = overRotate(t);
  if (rot) c = ROTATE_CURSORS[rot];
  else if (overHandle(t)) c = HANDLE_CURSOR;
  else if (t === 'select') c = SELECT_CURSOR;
  else if (t === 'direct') c = DIRECT_CURSOR;
  else if (t === 'rotView') c = ROTATE_CURSORS.ne;
  else if (t === 'hand') c = S.drag && S.drag.type === 'pan' ? 'grabbing' : 'grab';
  else if (t === 'zoom') c = S.keys.alt ? 'zoom-out' : 'zoom-in';
  else if (!SEL_TOOLS.has(t)) c = 'crosshair';
  stage.style.cursor = c;
  if (typeof updateViewsCursor === 'function') updateViewsCursor();
}
