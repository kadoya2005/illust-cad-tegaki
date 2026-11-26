'use strict';
// イラレCAD：数値入力のダイアログ

// ---- 数値入力のダイアログ ----
let dlg = null;
function openDialog({ title, fields, apply, copy = true, preview = true }) {
  closeMenus();
  $('dlgTitle').textContent = title;
  let h = '';
  for (const f of fields) {
    if (f.type === 'radio') {
      h += `<div class="radio">${f.options.map(([v, l]) => `<label><input type="radio" name="dlg_${f.id}" value="${v}"${v === f.value ? ' checked' : ''}> ${svgEsc(l)}</label>`).join('')}</div>`;
    } else {
      h += `<label for="dlg_${f.id}">${svgEsc(f.label)}</label><div><input type="number" step="any" id="dlg_${f.id}" value="${f.value}" style="width:110px"> <span class="unit">${f.unit || ''}</span></div>`;
    }
  }
  $('dlgBody').innerHTML = h;
  $('dlgCopy').hidden = !copy;
  $('dlgPreview').parentElement.hidden = !preview;
  $('dlgPreview').checked = false;
  dlg = { fields, apply, snap: JSON.stringify(doc), sel: new Map([...S.sel].map(([k, v]) => [k, new Set(v)])) };
  $('dialog').hidden = false;
  const first = $('dlgBody').querySelector('input[type=number]');
  if (first) { first.focus(); first.select(); }
}
function dlgValues() {
  const v = {};
  for (const f of dlg.fields) {
    if (f.type === 'radio') { const r = $('dlgBody').querySelector(`input[name="dlg_${f.id}"]:checked`); v[f.id] = r ? r.value : f.value; }
    else v[f.id] = parseFloat($('dlg_' + f.id).value) || 0;
  }
  return v;
}
function dlgRestore() { doc = JSON.parse(dlg.snap); S.sel = new Map([...dlg.sel].map(([k, v]) => [k, new Set(v)])); }
function dlgPreview() {
  if (!dlg) return;
  dlgRestore();
  if ($('dlgPreview').checked) dlg.apply(dlgValues(), false, true);
  render();
}
function dlgClose(action) {
  if (!dlg) return;
  const d = dlg, v = dlgValues();
  dlgRestore();
  dlg = null;
  $('dialog').hidden = true;
  if (document.activeElement) document.activeElement.blur();   // 入力欄にフォーカスが残るとショートカットが効かない
  if (action === 'ok' || action === 'copy') d.apply(v, action === 'copy', false);
  render(); updateUI();
}
$('dlgBody').addEventListener('input', dlgPreview);
$('dlgBody').addEventListener('change', dlgPreview);
$('dlgPreview').addEventListener('change', dlgPreview);
$('dlgOK').addEventListener('click', () => dlgClose('ok'));
$('dlgCopy').addEventListener('click', () => dlgClose('copy'));
$('dlgCancel').addEventListener('click', () => dlgClose('cancel'));

const deg = (r) => Math.round((r * 180) / Math.PI * 1000) / 1000;
function openXfDialog(kind) {
  if (!S.sel.size) { toast('先にオブジェクトを選んでください'); S.xfOrigin = null; return; }
  const origin = S.xfOrigin ? P(S.xfOrigin.x, S.xfOrigin.y) : null;
  const last = S.dlgLast[kind] || {};
  const done = (key, v) => { S.dlgLast[key] = v; };
  if (kind === 'move') {
    const v0 = S.dlgLast.move || { dx: 0, dy: 0 };
    openDialog({
      title: '移動',
      fields: [{ id: 'dx', label: '水平方向', value: fmt(v0.dx), unit: 'mm' }, { id: 'dy', label: '垂直方向', value: fmt(v0.dy), unit: 'mm' }],
      apply: (v, copy, pv) => { if (!pv) done('move', { dx: v.dx, dy: v.dy }); applyXf('move', { dx: v.dx, dy: v.dy }, copy, null, pv); },
    });
  } else if (kind === 'rotate') {
    openDialog({
      title: '回転',
      fields: [{ id: 'a', label: '角度', value: last.a || 0, unit: '°（反時計回り）' }],
      apply: (v, copy, pv) => { if (!pv) done('rotate', v); applyXf('rotate', { ang: (-v.a * Math.PI) / 180 }, copy, origin, pv); },
    });
  } else if (kind === 'reflect') {
    openDialog({
      title: 'リフレクト',
      fields: [
        { id: 'axis', type: 'radio', value: last.axis || 'v', options: [['h', '水平'], ['v', '垂直'], ['a', '角度']] },
        { id: 'a', label: '角度', value: last.a == null ? 90 : last.a, unit: '°' },
      ],
      apply: (v, copy, pv) => {
        if (!pv) done('reflect', v);
        const a = v.axis === 'h' ? 0 : v.axis === 'v' ? Math.PI / 2 : (-v.a * Math.PI) / 180;
        applyXf('reflect', { axis: a }, copy, origin, pv);
      },
    });
  } else if (kind === 'scale') {
    openDialog({
      title: '拡大・縮小',
      fields: [
        { id: 'mode', type: 'radio', value: last.mode || 'u', options: [['u', '縦横比を固定'], ['n', '縦横比を変更']] },
        { id: 'u', label: '拡大・縮小', value: last.u == null ? 100 : last.u, unit: '%' },
        { id: 'h', label: '水平方向', value: last.h == null ? 100 : last.h, unit: '%' },
        { id: 'v', label: '垂直方向', value: last.v == null ? 100 : last.v, unit: '%' },
      ],
      apply: (v, copy, pv) => {
        if (!pv) done('scale', v);
        const prm = v.mode === 'u' ? { sx: v.u / 100, sy: v.u / 100 } : { sx: v.h / 100, sy: v.v / 100 };
        applyXf('scale', prm, copy, origin, pv);
      },
    });
  }
}
function openPrefs() {
  openDialog({
    title: '環境設定',
    fields: [{ id: 'step', label: 'キー入力（矢印キーで動く量）', value: S.keyStep, unit: 'mm' }],
    copy: false, preview: false,
    apply: (v) => { if (v.step > 0) { S.keyStep = v.step; savePrefs(); toast(`矢印キーで ${v.step}mm 動きます（Shift で ${fmt(v.step * 10)}mm）`); } },
  });
}
// 平均（Ctrl+Alt+J）：選んだアンカーの位置をそろえる
function averageAnchors() {
  const pts = [];
  for (const it of selectedItems()) { const set = S.sel.get(it.id); it.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => { if (set.has(key(s, i))) pts.push(n); })); }
  if (pts.length < 2) { toast('2つ以上のアンカーを選んでください'); return; }
  const ax = pts.reduce((a, n) => a + n.x, 0) / pts.length, ay = pts.reduce((a, n) => a + n.y, 0) / pts.length;
  openDialog({
    title: '平均',
    fields: [{ id: 'axis', type: 'radio', value: (S.dlgLast.avg || {}).axis || 'b', options: [['h', '水平方向'], ['v', '垂直方向'], ['b', '2軸とも']] }],
    copy: false,
    apply: (v, copy, pv) => {
      if (!pv) S.dlgLast.avg = v;
      for (const it of selectedItems()) {
        const set = S.sel.get(it.id);
        it.subs.forEach((sb, s) => sb.nodes.forEach((n, i) => {
          if (!set.has(key(s, i))) return;
          moveNode(n, v.axis === 'h' ? 0 : ax - n.x, v.axis === 'v' ? 0 : ay - n.y);
        }));
      }
      if (pv) renderArt(); else { render(); commit(); }
    },
  });
}

// パスのオフセット（イラレと同じ項目：オフセット・角の形状・角の比率）
function openOffsetDialog() {
  if (!S.sel.size) { toast('先にパスを選んでください'); return; }
  const last = S.dlgLast.offset || { d: 2, join: 'miter', m: 4 };
  openDialog({
    title: 'パスのオフセット',
    fields: [
      { id: 'd', label: 'オフセット', value: last.d, unit: 'mm（マイナスで内側）' },
      { id: 'join', type: 'radio', value: last.join, options: [['miter', 'マイター'], ['round', 'ラウンド'], ['bevel', 'ベベル']] },
      { id: 'm', label: '角の比率', value: last.m, unit: '' },
    ],
    copy: false,
    apply: (v, copy, pv) => {
      if (!pv) S.dlgLast.offset = v;
      try { applyOffset(v.d, v.join, v.m, pv); } catch (err) { toast('オフセットでエラーが出ました：' + err.message); }
    },
  });
}
