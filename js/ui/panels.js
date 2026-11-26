'use strict';
// イラレCAD：パネル・メニュー・レイヤー

// ================= パネル・メニュー =================
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
function setSwatch(el, color) { el.style.background = color || '#ffffff'; el.classList.toggle('none', !color); }
const r2 = (n) => Math.round(n * 1000) / 1000;   // 表示は小数3けた（mm。Illustrator と同じ）
const ICON_EYE = '<svg viewBox="0 0 16 16"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

const MENUS = {
  object: [
    ['移動…', 'Enter', () => openXfDialog('move')], ['変形の繰り返し', 'Ctrl+D', transformAgain], '-',
    ['グループ', 'Ctrl+G', groupSelection], ['グループ解除', 'Ctrl+Shift+G', ungroupSelection], '-',
    ['連結', 'Ctrl+J', joinPaths], ['平均…', 'Ctrl+Alt+J', averageAnchors], ['パスのオフセット…', '', openOffsetDialog], ['複合パスを作成', 'Ctrl+8', makeCompound], ['複合パスを解除', 'Ctrl+Alt+Shift+8', releaseCompound], '-',
    ['最前面へ', 'Ctrl+Shift+]', () => arrange('front')], ['前面へ', 'Ctrl+]', () => arrange('forward')],
    ['背面へ', 'Ctrl+[', () => arrange('backward')], ['最背面へ', 'Ctrl+Shift+[', () => arrange('back')], '-',
    ['ロック', 'Ctrl+2', lockSelection], ['すべてをロック解除', 'Ctrl+Alt+2', unlockAll],
    ['隠す', 'Ctrl+3', hideSelection], ['すべてを表示', 'Ctrl+Alt+3', showAll],
  ],
  view: [
    ['アウトライン', 'Ctrl+Y', toggleOutline, () => S.outline], ['アートボード全体', 'Ctrl+0', fitView], ['100%', 'Ctrl+1', () => zoomAt(stageCenter(), 1)], ['回転ビューをリセット', 'Ctrl+Shift+1', resetViewRotation], '-',
    ['境界線を隠す', 'Ctrl+H', () => { S.hideEdges = !S.hideEdges; drawOverlay(); }, () => S.hideEdges],
    ['正面図・側面図', '', toggle3dViews, () => S.show3d], ['平面図を組み立てた形で見る', '', togglePlanFolded, () => S.planFolded],
    ['定規', 'Ctrl+R', toggleRulers, () => S.rulers], ['スマートガイド', 'Ctrl+U', toggleSmart, () => S.smart], '-',
    ['ガイドを表示', 'Ctrl+:', toggleGuides, () => S.showGuides], ['ガイドをロック', 'Ctrl+Alt+:', toggleGuideLock, () => S.guidesLocked], ['ガイドを消去', '', clearGuides], '-',
    ['グリッドを表示', 'Ctrl+¥', toggleGrid, () => S.grid], ['グリッドにスナップ', 'Ctrl+Shift+¥', toggleSnapGrid, () => S.snapGrid],
  ],
};
function buildMenu(name) {
  const box = $('menu-' + name);
  box.innerHTML = '';
  for (const m of MENUS[name]) {
    if (m === '-') { box.appendChild(document.createElement('hr')); continue; }
    const [label, sc, fn, check] = m;
    const b = document.createElement('button');
    b.innerHTML = `<span class="ck">${check && check() ? '✓' : ''}</span><span class="lb"></span><span class="sc"></span>`;
    b.querySelector('.lb').textContent = label;
    b.querySelector('.sc').textContent = sc;
    b.addEventListener('click', () => { closeMenus(); fn(); });
    box.appendChild(b);
  }
}
function closeMenus() { document.querySelectorAll('.dropdown').forEach((d) => { d.hidden = true; }); }
document.querySelectorAll('[data-menu]').forEach((btn) => btn.addEventListener('click', (e) => {
  e.stopPropagation();
  const box = $('menu-' + btn.dataset.menu);
  const open = box.hidden;
  closeMenus();
  if (open) {
    buildMenu(btn.dataset.menu);
    const r = btn.getBoundingClientRect();
    box.style.top = r.bottom + 4 + 'px';
    box.style.left = Math.max(4, Math.min(r.left, innerWidth - 254)) + 'px';
    box.hidden = false;
  }
}));
document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown') && !e.target.closest('[data-menu]')) closeMenus(); });

function updateDrawingPanel() {
  const sh = doc.sheet;
  $('btnSheet').textContent = sh ? '三面図の紙を消す' : '三面図の紙を作る';
  $('sheetOpts').style.display = sh ? '' : 'none';
  if (sh) { $('sheetSize').value = sh.size; $('sheetScale').value = String(sh.scale); }
}
$('btnSheet').addEventListener('click', () => toggleSheet());
$('sheetSize').addEventListener('change', (e) => { if (doc.sheet) { doc.sheet.size = e.target.value; render(); commit(); } e.target.blur(); });
$('sheetScale').addEventListener('change', (e) => { if (doc.sheet) { const v = e.target.value; doc.sheet.scale = v === 'auto' ? 'auto' : +v; render(); commit(); } e.target.blur(); });
function updateUI() {
  cleanSel(); ensureActiveLayer();
  updateDrawingPanel();
  const items = selectedItems();
  if (items.length) { const it = items[items.length - 1]; S.fill = it.fill; S.stroke = it.stroke; S.sw = it.sw; }
  document.querySelectorAll('[data-group]').forEach((b) => setGroupSlot(b, S.tool));   // M キーなどでグループの中のツールにしたら、ボタンの絵も替える
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === S.tool));
  setSwatch($('swFill'), S.fill); setSwatch($('swStroke'), S.stroke);
  $('colorWell').classList.toggle('strokeActive', S.activeColor === 'stroke');
  $('inFill').value = S.fill || '#ffffff'; $('inFill').classList.toggle('none', !S.fill); $('fillNone').classList.toggle('on', !S.fill);
  $('inStroke').value = S.stroke || '#000000'; $('inStroke').classList.toggle('none', !S.stroke); $('strokeNone').classList.toggle('on', !S.stroke);
  if (document.activeElement !== $('inSw')) $('inSw').value = r2(S.sw);
  $('swUnit').textContent = `mm（${r2(S.sw * PT_PER_MM)}pt）`;   // Illustrator の pt でいくつか
  const bb = items.length ? Geo.bbox(items) : null;
  for (const [id, v] of [['inX', bb && bb.x], ['inY', bb && bb.y], ['inW', bb && bb.w], ['inH', bb && bb.h]]) {
    const el = $(id);
    el.disabled = !bb;
    if (document.activeElement !== el) el.value = bb ? r2(v) : '';
  }
  if (document.activeElement !== $('inBW')) $('inBW').value = r2(doc.width);
  if (document.activeElement !== $('inBH')) $('inBH').value = r2(doc.height);
  const tops = selectedTops();
  document.querySelectorAll('[data-pf]').forEach((b) => { b.disabled = tops.length < (b.dataset.pf === 'divide' || b.dataset.pf === 'trim' ? 1 : 2); });
  renderLayers();
  $('fileName').textContent = S.fileName;
  document.title = S.fileName + ' - イラレCAD';
  $('btnUndo').disabled = !canUndo();
  $('btnRedo').disabled = !canRedo();
  $('btnOutline').classList.toggle('on', S.outline);
  showToolStatus();
  $('alignTo').value = S.alignTo;
  $('btnOffset').disabled = !items.length;
  // 3D 押し出し：選んだものの値（ばらばらなら空欄）
  const prof = selectedProfileLeaves();
  const exs = prof.map((it) => it.x3d || null);
  const same = (f) => (exs.length && exs.every((e) => e && f(e) === f(exs[0])) ? r2(f(exs[0])) : '');
  for (const [id, f] of [['inExH', (e) => e.h], ['inExZ', (e) => e.z0]]) {
    const el = $(id);
    el.disabled = !prof.length;
    if (document.activeElement !== el) el.value = same(f);
  }
  $('btnExtrude').disabled = !prof.length;
  $('btnUnextrude').disabled = !exs.some(Boolean);
  // 折りたたみ：選んだ面の角度（ばらばらなら空欄）
  const fs = selectedFoldFaces(), oh = S.foldHinge && findHinge(S.foldHinge);
  const degs = oh ? [hingeDeg(oh.A, oh.B)] : fs.movable.map((it) => { const fi = FOLD_INFO.get(it.id); return fi ? hingeDeg(it, fi.parent) : 0; });
  const fd = $('inFoldDeg'), can = !!oh || fs.movable.length > 0;
  fd.disabled = !can;
  if (document.activeElement !== fd) fd.value = degs.length && degs.every((d) => d === degs[0]) ? r2(degs[0]) : '';
  $('btnFold90').disabled = $('btnFold0').disabled = !can;
  $('btnPlanFolded').textContent = S.planFolded ? '平面図：組み立て' : '平面図：展開図';
  $('btnPlanFolded').classList.toggle('on', !!S.planFolded);
  $('foldNote').textContent = oh ? '折り線（オレンジ）を選んでいます。正面図・側面図でほかの線をつかむと、その側が折れます' : fs.movable.length ? '' : fs.roots.length ? '土台の面です（動きません）' : fs.alone.length ? 'ほかの面と辺がつながっていません' : '正面図・側面図で折り線をクリックするとオレンジになります';
  const flags = [];
  if (S.smart) flags.push('スマートガイド');
  if (S.snapGrid) flags.push('グリッドにスナップ');
  $('stFlags').textContent = flags.join('・');
}

// ステータスバーのツール名。キーを押して一時的に切り替わっているときは、そのツールを出す
function showToolStatus() {
  let t = S.drag ? S.tool : displayTool();
  if (!S.drag && t === 'pen' && S.keys.alt) t = 'convert';
  const meta = TOOLS_META[t] || TOOLS_META[S.tool];
  const temp = t !== S.tool ? `（一時的に。${TOOLS_META[S.tool].name}に戻ります）` : `（${meta.key}）`;
  $('stTool').textContent = meta.name + temp;
  $('stHint').textContent = meta.hint;
}

let LAYERS_SIG = '';
function renderLayers() {
  const ul = $('layerList');
  // 変わっていなければ作り直さない（ドラッグ中に毎回作り直すと重くなる）
  const sig = S.activeLayer + '|' + doc.layers.map((L) => [L.id, L.name, L.color, L.visible, L.locked, !!L.drawing, leaves(L.items).some((it) => S.sel.has(it.id))].join(',')).join('/');
  if (sig === LAYERS_SIG && ul.children.length === doc.layers.length && !ul.querySelector('.nmEdit')) return;
  if (ul.querySelector('.nmEdit')) return;   // 名前を書き換えている最中は触らない
  LAYERS_SIG = sig;
  ul.innerHTML = '';
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const L = doc.layers[i];
    const li = document.createElement('li');
    li.dataset.id = L.id;
    if (L.id === S.activeLayer) li.className = 'active';
    const hasSel = leaves(L.items).some((it) => S.sel.has(it.id));
    li.innerHTML = `<span class="chip" style="background:${L.color}"></span>` +
      `<button class="ib eye ${L.visible ? '' : 'off'}" title="表示／非表示">${ICON_EYE}</button>` +
      `<button class="ib lock ${L.locked ? '' : 'off'}" title="ロック／解除">${ICON_LOCK}</button>` +
      `<button class="ib draw ${L.drawing ? '' : 'off'}" title="図面レイヤー（寸法・三面図用。中のものは 3D・STL に出ない）">図</button>` +
      `<span class="nm"></span>` +
      `<span class="selmark" style="${hasSel ? 'background:' + L.color : ''}"></span>`;
    li.querySelector('.nm').textContent = L.name;
    ul.appendChild(li);
  }
}
// レイヤー名をダブルクリックで、その場で名前を変える（イラレと同じ）
function startLayerRename(id) {
  const li = $('layerList').querySelector(`li[data-id="${id}"]`), L = doc.layers.find((x) => x.id === id);
  if (!li || !L) return;
  const nm = li.querySelector('.nm');
  const inp = document.createElement('input');
  inp.type = 'text'; inp.value = L.name; inp.className = 'nmEdit';
  nm.replaceWith(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v && v !== L.name) { L.name = v; commit(); }
    inp.remove(); LAYERS_SIG = '';   // 書き換え欄を消してから、一覧を作り直す
    renderLayers();
  };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}
$('layerList').addEventListener('click', (e) => {
  if (e.target.closest('.nmEdit')) return;
  const li = e.target.closest('li');
  if (!li) return;
  // 1回目のクリックで一覧が作り直されるので、ダブルクリックは「2回目のクリック」で受ける
  if (e.detail === 2 && !e.target.closest('.ib')) { startLayerRename(li.dataset.id); return; }
  const L = doc.layers.find((x) => x.id === li.dataset.id);
  if (!L) return;
  if (e.target.closest('.eye')) { L.visible = !L.visible; cleanSel(); render(); commit(); return; }
  if (e.target.closest('.lock')) { L.locked = !L.locked; cleanSel(); render(); commit(); return; }
  if (e.target.closest('.draw')) {
    L.drawing = !L.drawing;
    if (L.drawing && !L.dims) L.dims = [];
    toast(L.drawing ? `「${L.name}」を図面レイヤーにしました（中のものは 3D・STL に出ません）` : `「${L.name}」をふつうのレイヤーに戻しました`);
    render(); commit(); return;
  }
  S.activeLayer = L.id; updateUI();
});
$('layerAdd').addEventListener('click', () => {
  const n = doc.layers.length;
  let num = n + 1;
  while (doc.layers.some((L) => L.name === 'レイヤー ' + num)) num++;
  const L = { id: uid(), name: 'レイヤー ' + num, color: LAYER_COLORS[n % LAYER_COLORS.length], visible: true, locked: false, items: [] };
  doc.layers.splice(doc.layers.indexOf(activeLayerObj()) + 1, 0, L);
  S.activeLayer = L.id; render(); commit();
});
$('layerDel').addEventListener('click', () => {
  if (doc.layers.length <= 1) { toast('最後のレイヤーは削除できません'); return; }
  const L = activeLayerObj();
  const cnt = leaves(L.items).length;
  if (cnt && !confirm(`「${L.name}」とその中の ${cnt} 個のパスを削除しますか？`)) return;
  const i = doc.layers.indexOf(L);
  doc.layers.splice(i, 1);
  S.activeLayer = doc.layers[Math.max(0, i - 1)].id;
  cleanSel(); render(); commit();
});
function moveLayer(dir) {
  const L = activeLayerObj(), i = doc.layers.indexOf(L), j = i + dir;
  if (j < 0 || j >= doc.layers.length) return;
  [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]];
  render(); commit();
}
$('layerUp').addEventListener('click', () => moveLayer(1));
$('layerDown').addEventListener('click', () => moveLayer(-1));

$('inFill').addEventListener('input', (e) => setColor('fill', e.target.value, false));
$('inFill').addEventListener('change', () => commit());
$('inStroke').addEventListener('input', (e) => setColor('stroke', e.target.value, false));
$('inStroke').addEventListener('change', () => commit());
$('fillNone').addEventListener('click', () => setColor('fill', null));
$('strokeNone').addEventListener('click', () => setColor('stroke', null));
// 打っているあいだも pt の換算を出す
$('inSw').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v >= 0) $('swUnit').textContent = `mm（${r2(v * PT_PER_MM)}pt）`; });
$('inSw').addEventListener('change', (e) => {
  const v = parseFloat(e.target.value);
  if (!(v >= 0)) { updateUI(); return; }
  S.sw = v;
  for (const it of selectedItems()) it.sw = v;
  renderArt(); commit();
});
for (const id of ['inX', 'inY', 'inW', 'inH']) {
  $(id).addEventListener('change', () => {
    const items = selectedItems();
    const v = parseFloat($(id).value);
    if (!items.length || !isFinite(v)) { updateUI(); return; }
    const bb = Geo.bbox(items);
    let f;
    if (id === 'inX') f = (q) => P(q.x + v - bb.x, q.y);
    else if (id === 'inY') f = (q) => P(q.x, q.y + v - bb.y);
    else if (id === 'inW') { if (bb.w < 1e-9 || v <= 0) { updateUI(); return; } f = (q) => P(bb.x + (q.x - bb.x) * (v / bb.w), q.y); }
    else { if (bb.h < 1e-9 || v <= 0) { updateUI(); return; } f = (q) => P(q.x, bb.y + (q.y - bb.y) * (v / bb.h)); }
    items.forEach((it) => mapItem(it, f));
    render(); commit();
  });
}
$('inExH').addEventListener('change', () => { const v = parseFloat($('inExH').value); if (v > 0) setExtrude(v, undefined); else updateUI(); });
$('inExZ').addEventListener('change', () => { const v = parseFloat($('inExZ').value); if (isFinite(v)) setExtrude(undefined, v); else updateUI(); });
$('btnExtrude').addEventListener('click', () => setExtrude(parseFloat($('inExH').value), undefined));
$('inFoldDeg').addEventListener('change', () => { const v = parseFloat($('inFoldDeg').value); if (isFinite(v)) setFold(v); else updateUI(); });
$('btnFold90').addEventListener('click', () => setFold(90));
$('btnFold0').addEventListener('click', () => setFold(0));
$('btnUnfoldAll').addEventListener('click', unfoldAll);
$('btnPlanFolded').addEventListener('click', togglePlanFolded);
$('btnUnextrude').addEventListener('click', removeExtrude);
for (const [id, prop] of [['inBW', 'width'], ['inBH', 'height']]) {
  $(id).addEventListener('change', () => {
    const v = parseFloat($(id).value);
    if (v > 0) { doc[prop] = v; render(); commit(); } else updateUI();
  });
}
$('swFill').addEventListener('click', () => { if (S.activeColor === 'fill') $('inFill').click(); else { S.activeColor = 'fill'; updateUI(); } });
$('swStroke').addEventListener('click', () => { if (S.activeColor === 'stroke') $('inStroke').click(); else { S.activeColor = 'stroke'; updateUI(); } });
$('btnDefault').addEventListener('click', defaultColors);
$('btnSwap').addEventListener('click', swapColors);
$('btnNone').addEventListener('click', () => setColor(S.activeColor, null));
// ツールのグループ（イラレと同じく、ボタンを長押し・右クリックで中のツールを選ぶ。選んだツールがボタンに出る）
const TOOL_GROUPS = {
  rect: [
    ['rect', '<svg viewBox="0 0 20 20"><rect x="3.5" y="5" width="13" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'],
    ['roundRect', '<svg viewBox="0 0 20 20"><rect x="3.5" y="5" width="13" height="10" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'],
  ],
};
function setGroupSlot(b, t) {
  const g = TOOL_GROUPS[b.dataset.group], ent = g && g.find(([id]) => id === t);
  if (!ent || b.dataset.tool === t) return;
  const m = TOOLS_META[t];
  b.dataset.tool = t; b.innerHTML = ent[1];
  b.title = `${m.name}${m.key ? ` (${m.key})` : ''}　長押しでほかのツール`;
}
function closeFlyout() { const f = document.querySelector('.flyout'); if (f) f.remove(); }
function openFlyout(b) {
  closeFlyout();
  const f = document.createElement('div');
  f.className = 'flyout';
  for (const [id, icon] of TOOL_GROUPS[b.dataset.group]) {
    const m = TOOLS_META[id], x = document.createElement('button');
    x.innerHTML = `${icon}<span>${m.name}</span>${m.key ? `<span class="unit">${m.key}</span>` : ''}`;
    x.dataset.flyTool = id;
    x.classList.toggle('on', id === b.dataset.tool);
    x.addEventListener('pointerup', () => { setGroupSlot(b, id); closeFlyout(); setTool(id); });
    f.appendChild(x);
  }
  const r = b.getBoundingClientRect();
  f.style.left = r.right + 2 + 'px'; f.style.top = r.top - 3 + 'px';
  document.body.appendChild(f);
}
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.flyout') && !e.target.closest('.grp')) closeFlyout(); });
document.querySelectorAll('[data-group]').forEach((b) => {
  let timer = null;
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    delete b.dataset.held;
    closeFlyout();
    timer = setTimeout(() => { timer = null; b.dataset.held = '1'; openFlyout(b); }, 400);
  });
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
  b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop);
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); stop(); openFlyout(b); });
});
document.querySelectorAll('[data-tool]').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.held) { delete b.dataset.held; return; }   // 長押しのあとのクリックは無視（メニューを開いたまま）
    setTool(b.dataset.tool);
  });
  // ツールのダブルクリックで数値入力（イラレと同じ）
  b.addEventListener('dblclick', () => {
    const t = b.dataset.tool;
    if (t === 'select' || t === 'direct') openXfDialog('move');
    else if (XF_TOOLS.has(t)) { S.xfOrigin = null; openXfDialog(t); }
    else if (t === 'hand') fitView();
    else if (t === 'zoom') zoomAt(stageCenter(), 1);
  });
});
document.querySelectorAll('[data-pf]').forEach((b) => b.addEventListener('click', () => pathfinder(b.dataset.pf)));
document.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => alignObjects(b.dataset.align)));
document.querySelectorAll('[data-dist]').forEach((b) => b.addEventListener('click', () => distributeObjects(b.dataset.dist)));
document.querySelectorAll('[data-space]').forEach((b) => b.addEventListener('click', () => distributeSpacing(b.dataset.space, parseFloat($('inGap').value) || 0)));
$('alignTo').addEventListener('change', (e) => {
  S.alignTo = e.target.value;
  if (S.alignTo === 'key' && !S.keyId) toast('選択中のオブジェクトの1つをクリックすると、キーオブジェクトになります');
  e.target.blur();
});
$('btnOffset').addEventListener('click', openOffsetDialog);

const COMMANDS = {
  new: newDocument, open: openFile, save: () => save(false), saveAs: () => save(true), exportSvg: exportSvgFile, exportStl: exportStlFile,
  undo, redo, outline: toggleOutline, fit: fitView, help: () => toggleHelp(true), prefs: openPrefs,
};
document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => COMMANDS[b.dataset.cmd]()));

// 表示倍率の横の「↻30°」をクリックすると、回転ビューをリセット
$('zoomLabel').addEventListener('click', () => { if (viewDeg()) resetViewRotation(); });
