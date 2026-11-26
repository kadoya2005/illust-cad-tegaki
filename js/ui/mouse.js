'use strict';
// イラレCAD：マウス・定規からのガイド

// ================= マウス =================
stage.addEventListener('pointerdown', (e) => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  closeMenus();
  S.input = null;
  const sp = evScr(e), p = toDoc(sp);
  S.mouse = p; S.mouseScr = sp;
  S.keys.ctrl = e.ctrlKey || e.metaKey; S.keys.alt = e.altKey; S.keys.shift = e.shiftKey;
  if (e.button === 1) { e.preventDefault(); stage.setPointerCapture(e.pointerId); S.activeTool = 'hand'; Tools.hand.down(e, p, sp); return; }
  if (e.button !== 0) return;
  stage.setPointerCapture(e.pointerId);
  const t = effectiveTool(e);
  S.activeTool = t;
  S.selGuide = null; S.segSel = null;
  if (S.drawing && t !== 'pen' && t !== 'hand' && t !== 'zoom') endDrawing();
  else if (S.drawing && t === 'pen') { const f = findItem(S.drawing.id); if (f && !onTop(f.item)) endDrawing(); }   // 正面図・側面図で描いていたパスは、平面図では続けない
  S.hover = null;
  // 平面図の回転ハンドル（つまみ）：真上から見て、つまみを折り線の方へ引くほど面が起きる
  if (SEL_TOOLS.has(t) && typeof findHinge === 'function' && S.foldHinge) {
    const oh = findHinge(S.foldHinge);
    const hd = oh && hitFoldHandle(oh, (w) => toScr(P(w.x, w.y)), sp);
    if (hd) {
      const undo = snapshotFolds();
      const d = startHingeDrag(oh, hd.face);
      if (d) {
        applyFolds();
        const prev = hingeDeg(oh.A, oh.B);
        S.activeTool = 'foldHandle';
        S.drag = { type: 'foldPlan', d, grab2: hd.p2, s: sp, moved: false, undo, face: hd.face.id, range: prev < 0 ? [-180, 0] : [0, 180], side: foldSide(oh, hd.face) };
        drawOverlay(); updateCursor();
        return;
      }
    }
  }
  // 選択ツールで折り線をクリックすると、その折り線もオレンジにする（面はいつもどおり選ばれる）
  if (SEL_TOOLS.has(t) && typeof FOLD_HINGES !== 'undefined') {
    let best = null, bd = tol();
    for (const h of FOLD_HINGES) { const [a, b] = planHingePts(h); const d = segDist(p, a, b); if (d < bd) { bd = d; best = h; } }
    if (best) S.foldHinge = hingeKey(best.A, best.B);
  }
  Tools[t].down(e, p, sp);
  drawOverlay(); updateCursor();
});
stage.addEventListener('pointermove', (e) => {
  if (S.input && S.drag) return;   // 正面図・側面図でドラッグ中
  S.input = null;
  const sp = evScr(e), p = toDoc(sp);
  S.mouse = p; S.mouseScr = sp;
  S.keys.ctrl = e.ctrlKey || e.metaKey; S.keys.alt = e.altKey; S.keys.shift = e.shiftKey;
  if (S.drag) { Tools[S.activeTool].move(e, p, sp); drawOverlay(); }
  else {
    const t = effectiveTool(e);
    S.hover = ['select', 'direct', 'eyedropper', 'addAnchor', 'convert', 'rotate'].includes(t) ? (hitItem(p) || {}).it?.id || null : null;
    S.penHint = t === 'pen' ? penHint(p, e.altKey, sp) : '';
    S.snapViz = ['pen', 'rect', 'roundRect', 'ellipse', 'line'].includes(t) && !e.shiftKey ? snapPoint(p, cachedCands()).viz
      : t === 'dim' && !(S.dimDraft && S.dimDraft.b) ? dimSnap(p, e.shiftKey).viz : null;
    // 回転ハンドルにマウスが乗ったら緑
    const oh = SEL_TOOLS.has(t) && typeof findHinge === 'function' && S.foldHinge && findHinge(S.foldHinge);
    const hd = oh && hitFoldHandle(oh, (w) => toScr(P(w.x, w.y)), sp);
    S.foldHandleHover = hd ? hd.face.id : null;
    drawOverlay();
    updateCursor();
  }
  if (S.rulers) drawRulers();
  $('stPos').textContent = `X ${p.x.toFixed(2)}  Y ${p.y.toFixed(2)} mm`;
});
// 平面図で回転ハンドルをドラッグ（Tools の1つとして扱う）
Tools.foldHandle = {
  down() {},
  move(e, p, sp) {
    const d = S.drag;
    if (!d.moved && Math.hypot(sp.x - d.s.x, sp.y - d.s.y) < 3) return;
    d.moved = true;
    const raw = hingeAngleToward(d.d, d.grab2, (w) => toScr(P(w.x, w.y)), sp, d.range);
    d.deg = snapFoldDeg(raw, e.shiftKey);
    setHingeDeg(d.d.h.A, d.d.h.B, d.deg);
    render(); updateUI();
  },
  up() { if (S.drag.moved) { render(); commit(); } },
};
function finishPointer(e, cancel) {
  if (!S.drag) return;
  const sp = evScr(e), p = toDoc(sp);
  if (cancel && S.drag.type === 'foldPlan' && S.drag.undo) { restoreFolds(S.drag.undo); render(); }   // 中断されたら元の角度に
  if (cancel && S.drag.type === 'move' && S.drag.moved) {   // 中断されたら元の位置に（コピー中ならコピーを消す）
    const d = S.drag;
    if (d.dup) { for (const id of d.orig.keys()) removeItem(id); S.sel = new Map([...d.baseSel].map(([k, v]) => [k, new Set(v)])); }
    restoreFrom(d.base); renderArt();
  }
  if (!cancel) Tools[S.activeTool].up(e, p, sp);
  if (SEL_TOOLS.has(S.activeTool)) S.xfOrigin = null;   // 選び直したら基準点は中心に戻る
  S.drag = null; S.marquee = null; S.activeTool = null; S.snapViz = null;
  afterSelect(); drawOverlay(); updateUI(); updateCursor();
}
stage.addEventListener('pointerup', (e) => finishPointer(e, false));
stage.addEventListener('pointercancel', (e) => finishPointer(e, true));
stage.addEventListener('pointerleave', () => { if (!S.drag) { S.mouseScr = null; S.hover = null; S.penHint = ''; S.snapViz = null; drawOverlay(); if (S.rulers) drawRulers(); } });
stage.addEventListener('contextmenu', (e) => e.preventDefault());
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const sp = evScr(e);
  const pinch = e.ctrlKey && !Number.isInteger(e.deltaY);
  if (e.altKey || pinch) zoomAt(sp, view.z * Math.exp(-e.deltaY * (pinch ? 0.01 : 0.0015)));
  else if (e.ctrlKey || e.shiftKey) { view.x -= e.deltaY || e.deltaX; renderView(); }
  else { view.x -= e.deltaX; view.y -= e.deltaY; renderView(); }
}, { passive: false });

// 定規からドラッグしてガイドを作る（上の定規→横のガイド、左の定規→縦のガイド）
for (const [id, axis] of [['rulerTop', 'y'], ['rulerLeft', 'x']]) {
  const cv = $(id);
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    if (!S.showGuides) { S.showGuides = true; savePrefs(); }
    S.drag = { type: 'guideNew', axis, v: null, over: false };
  });
  cv.addEventListener('pointermove', (e) => {
    const sp = evScr(e), p = toDoc(sp);
    S.mouseScr = sp;
    if (S.drag && S.drag.type === 'guideNew') {
      S.drag.v = axis === 'x' ? p.x : p.y;
      S.drag.over = !inRulerZone(sp, axis);
      drawOverlay();
    }
    drawRulers();
  });
  cv.addEventListener('pointerup', (e) => {
    if (!S.drag || S.drag.type !== 'guideNew') return;
    const d = S.drag;
    S.drag = null;
    if (d.over && d.v != null) { doc.guides.push({ axis, v: d.v }); commit(); }
    drawOverlay();
  });
}

// ボタンがフォーカスを取らないようにする（Space や Enter が押されないように）
document.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
