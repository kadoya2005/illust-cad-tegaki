'use strict';
// イラレCAD 手描き：鉛筆ツール（N）
// 描いている間は点を集めて折れ線で見せるだけ（重い計算はしない）。離したら paper.js の simplify でベジェにして、パスを 1 つ足す
// 取り消しは一筆で 1 回（離したときに commit を 1 回だけ）
// 判定は画面の px（CSS px。devicePixelRatio は掛けない）、保存する形は mm
// 平面図と、正面図・側面図（真正面・真横のとき）で使える。正面図・側面図ではペンと同じ作業平面に描く

const PENCIL_CLOSE_PX = 10;    // 終点が始点から画面で 10px 以内なら閉じる
const PENCIL_LEAVE_PX = 30;    // ただし一度は始点から 30px 以上離れた線だけ（タップや短い往復は閉じない）
const PENCIL_STEP_PX = 0.75;   // 直前の点から画面で 0.75px 未満の点は省く
const PENCIL_SMOOTH_DEFAULT = 1;   // なめらかさの初期値（画面の px）。許容誤差(mm) = なめらかさ ÷ 倍率(px/mm)

// ---- 一筆のデータ（画面に触らない。自動テストからも使う） ----
// sp：画面の点（px）、p：作業平面の 2D の点（mm）、scale：1mm が画面で何 px か
function pencilStroke(sp, p, opt = {}) {
  return { scr: [P(sp.x, sp.y)], pts: [P(p.x, p.y)], maxAway: 0, willClose: false,
    scale: opt.scale || 1, view: opt.view || null, plane: opt.plane || null, pointerId: opt.pointerId ?? null };
}
function pencilPush(st, sp, p) {
  const last = st.scr[st.scr.length - 1];
  if (Math.hypot(sp.x - last.x, sp.y - last.y) < PENCIL_STEP_PX) return false;
  st.scr.push(P(sp.x, sp.y)); st.pts.push(P(p.x, p.y));
  const s0 = st.scr[0], d = Math.hypot(sp.x - s0.x, sp.y - s0.y);
  st.maxAway = Math.max(st.maxAway, d);
  st.willClose = st.maxAway >= PENCIL_LEAVE_PX && d <= PENCIL_CLOSE_PX;
  return true;
}
// 一筆 → サブパス { nodes, closed }（hin / hout は絶対座標）。点が足りなければ null
// smoothPx：なめらかさ（画面の px）。0 なら当てはめずに折れ線のまま
function pencilFit(st, smoothPx) {
  const pts = st.pts.slice(), scr = st.scr.slice();
  if (pts.length < 2) return null;
  let closed = st.willClose && pts.length >= 3;
  if (closed) {
    // 始点に重なる終わりの点は外して、閉じた形として当てはめる（継ぎ目にごく短い線ができないように）
    while (pts.length > 3 && vdist(scr[scr.length - 1], scr[0]) < PENCIL_CLOSE_PX / 2) { pts.pop(); scr.pop(); }
  }
  const tolMm = smoothPx > 0 ? smoothPx / st.scale : 0;
  // 閉じた線は、始点に戻る「開いた線」として当てはめてから、重なった両端を 1 つにまとめる
  // （paper.js 0.12.18 の閉じたパスの simplify は継ぎ目で大きくずれるため。描き始めが角なら、角のまま残る）
  const fitPts = closed && tolMm > 0 ? [...pts, pts[0]] : pts;
  const ps = Pathfinder.scope();
  const path = new ps.Path({ segments: fitPts.map((q) => [q.x, q.y]), insert: false });
  // paper.js 0.12.18 の simplify は「距離の 2 乗」を許容誤差と比べる。距離で tolMm にするため 2 乗して渡す
  if (tolMm > 0) path.simplify(tolMm * tolMm);
  const nodes = path.segments.map((sg) => {
    const x = sg.point.x, y = sg.point.y, hi = sg.handleIn, ho = sg.handleOut;
    return mkNode(x, y, hi.isZero() ? null : P(x + hi.x, y + hi.y), ho.isZero() ? null : P(x + ho.x, y + ho.y));
  });
  if (closed && tolMm > 0 && nodes.length >= 3) {
    const end = nodes.pop();
    nodes[0].hin = end.hin ? P(end.hin.x - end.x + nodes[0].x, end.hin.y - end.y + nodes[0].y) : null;
  }
  if (nodes.length < 2) return null;
  const sb = { nodes, closed };
  normalizeSub(sb);
  return sb;
}

// ---- ツールの動き ----
// 描き始め。opt.view があれば正面図・側面図（S.input が作業平面）
function pencilBegin(e, sp, p, opt = {}) {
  const L = activeLayerObj();
  if (!layerWritable(L)) { toast('ロック中または非表示のレイヤーには描けません'); return false; }
  if (S.drawing) endDrawing();   // ペンで描いていた途中のパスは、そこで終える
  S.pencil = pencilStroke(sp, p, { scale: inputScale(), view: opt.view, plane: opt.plane, pointerId: e.pointerId });
  S.drag = { type: 'pencil' };
  S.activeTool = 'pencil';
  S.hover = null; S.snapViz = null;
  pencilRequestDraw();
  return true;
}
// 動いた：getCoalescedEvents があれば、間の点も全部拾う。conv(ev) → { sp, p }
function pencilMove(e, conv) {
  const st = S.pencil;
  if (!st || e.pointerId !== st.pointerId) return;
  const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
  const evs = list && list.length ? list : [e];
  let added = false;
  for (const ev of evs) { const c = conv(ev); if (pencilPush(st, c.sp, c.p)) added = true; }
  if (added) pencilRequestDraw();
}
// 離した：ベジェにしてドキュメントに足す（取り消しはこれで 1 回）
function pencilFinish() {
  const st = S.pencil;
  S.pencil = null;
  if (!st) return null;
  const sb = pencilFit(st, S.pencilSmooth);
  if (!sb) { pencilRequestDraw(); return null; }
  const it = newItem([sb], !sb.closed);
  if (st.plane) it.plane = clone(st.plane);   // 正面図・側面図で描いた線は、その平面に置く
  activeLayerObj().items.push(it);
  selItem(it, false);
  render(); commit();
  return it;
}
// 中断（pointercancel・lostpointercapture・画面が隠れた・Esc）：その一筆は捨てる
function pencilAbort(why) {
  const st = S.pencil;
  if (!st) return;
  S.pencil = null;
  if (S.activeTool === 'pencil') { S.drag = null; S.activeTool = null; S.input = null; }
  toast(`描いている途中で中断されたので、その一筆は捨てました${why ? '（' + why + '）' : ''}`);
  if (st.view && typeof drawViewBox === 'function') drawViewBox(st.view);
  drawOverlay(); updateCursor();
}

// ---- 描いている途中の表示：requestAnimationFrame にまとめる ----
let pencilFrame = 0, pencilLastView = null;
function pencilRequestDraw() {
  if (S.pencil) pencilLastView = S.pencil.view;
  if (pencilFrame) return;
  pencilFrame = requestAnimationFrame(() => {
    pencilFrame = 0;
    const v = S.pencil ? S.pencil.view : pencilLastView;
    if (v) { if (typeof drawViewBox === 'function') drawViewBox(v); }
    else drawOverlay();
  });
}
// 折れ線のプレビューと「離すと閉じる」の予告（SVG の文字列）。view：null なら平面図
function pencilPreviewSvg(view) {
  const st = S.pencil;
  if (!st || st.view !== (view || null)) return '';
  const col = (activeLayerObj() || {}).color || '#4f80ff';
  const s0 = st.scr[0], last = st.scr[st.scr.length - 1];
  let h = '';
  // 始点の印：閉じられる距離まで離れたら輪を出し、近づいたら塗る
  if (st.maxAway >= PENCIL_LEAVE_PX) {
    h += `<circle cx="${s0.x}" cy="${s0.y}" r="${PENCIL_CLOSE_PX}" fill="${st.willClose ? col : 'none'}" fill-opacity="0.25" stroke="${col}" stroke-width="1" stroke-dasharray="${st.willClose ? '' : '3 2'}"/>`;
  }
  h += `<polyline points="${st.scr.map((q) => q.x.toFixed(1) + ',' + q.y.toFixed(1)).join(' ')}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (st.willClose) {
    h += `<line x1="${last.x}" y1="${last.y}" x2="${s0.x}" y2="${s0.y}" stroke="${col}" stroke-width="1.5" stroke-dasharray="3 2"/>`;
    h += `<text x="${last.x + 12}" y="${last.y + 20}" font-size="13" font-weight="700" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">離すと閉じる</text>`;
  }
  return h;
}

// 平面図の鉛筆（mouse.js から Tools の 1 つとして呼ばれる）
const planConv = (ev) => { const sp = evScr(ev); return { sp, p: toDoc(sp) }; };
Tools.pencil = {
  down(e, p, sp) { pencilBegin(e, sp, p); },
  move(e) { pencilMove(e, planConv); },
  up() { pencilFinish(); },
};

// なめらかさの数値入力（鉛筆ツールをダブルクリック。イラレの「鉛筆ツールオプション」と同じ入り口）
function openPencilPrefs() {
  openDialog({
    title: '鉛筆ツールオプション',
    fields: [{ id: 'smooth', label: 'なめらかさ（画面で何 px までずれてよいか。大きいほどアンカーが減る。0 で当てはめない）', value: S.pencilSmooth, unit: 'px' }],
    copy: false, preview: false,
    apply: (v) => { if (v.smooth >= 0) { S.pencilSmooth = v.smooth; savePrefs(); toast(`鉛筆のなめらかさ：${v.smooth}px`); } },
  });
}

// 画面が隠れた・ほかの窓に切り替わった：描いている一筆は捨てる
document.addEventListener('visibilitychange', () => { if (document.hidden) pencilAbort('画面が隠れた'); });
window.addEventListener('blur', () => pencilAbort('ほかの窓に切り替わった'));
