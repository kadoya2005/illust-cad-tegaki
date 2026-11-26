'use strict';
// イラレCAD：平面図・正面図・側面図の大きさを、境目のドラッグで変える
//   平面図と正面図・側面図の境目（縦の線）：左右にドラッグで幅を変える
//   正面図と側面図の境目（横の線）：上下にドラッグで高さの割合を変える
//   境目をダブルクリック：元の大きさに戻す
// 大きさはブラウザに覚えておく

const SPLIT_KEY = PREFS_KEY + '.split';
const SPLIT = { w: 0, f: 0.5 };   // w：正面図・側面図の幅（px、0 なら既定）、f：正面図の高さの割合

function applySplit() {
  const views = $('views');
  if (SPLIT.w > 0) {
    // 平面図とパネルが残るように、幅を画面に合わせて抑える
    const max = Math.max(160, window.innerWidth - 46 - 250 - 200);
    document.body.style.setProperty('--vw', Math.round(Math.min(max, Math.max(160, SPLIT.w))) + 'px');
  } else document.body.style.removeProperty('--vw');
  views.style.gridTemplateRows = `${SPLIT.f}fr ${1 - SPLIT.f}fr`;
  $('splitH').style.top = `calc(${SPLIT.f * 100}% - 3px)`;
}
function saveSplit() {
  try { localStorage.setItem(SPLIT_KEY, JSON.stringify(SPLIT)); } catch (_) { /* 保存できなくても続ける */ }
}
function loadSplit() {
  try {
    const p = JSON.parse(localStorage.getItem(SPLIT_KEY) || '{}');
    if (p.w > 0) SPLIT.w = p.w;
    if (p.f > 0 && p.f < 1) SPLIT.f = p.f;
  } catch (_) { /* 既定のまま */ }
}

function initSplit() {
  loadSplit();
  const views = $('views');
  let raf = 0;
  const redraw = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; renderView(); renderViews(); });
  };
  const drag = (el, onMove) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      el.classList.add('on');
      const mv = (ev) => { onMove(ev); applySplit(); redraw(); };
      const up = () => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        el.classList.remove('on'); saveSplit(); redraw();
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  };
  // 縦の境目：views の右端は動かさず、左端をマウスに合わせる
  drag($('splitV'), (e) => { SPLIT.w = views.getBoundingClientRect().right - e.clientX; });
  drag($('splitH'), (e) => {
    const r = views.getBoundingClientRect();
    const min = Math.min(0.45, 60 / Math.max(1, r.height));   // どちらの図も 60px は残す
    SPLIT.f = Math.min(1 - min, Math.max(min, (e.clientY - r.top) / r.height));
  });
  $('splitV').addEventListener('dblclick', () => { SPLIT.w = 0; applySplit(); saveSplit(); redraw(); });
  $('splitH').addEventListener('dblclick', () => { SPLIT.f = 0.5; applySplit(); saveSplit(); redraw(); });
  window.addEventListener('resize', applySplit);
  applySplit();
}
