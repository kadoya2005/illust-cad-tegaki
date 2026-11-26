'use strict';
// イラレCAD：表示（座標変換・描画・定規・グリッド・選択の表示）

// ================= 表示 =================
function evScr(e) { const r = stage.getBoundingClientRect(); return P(e.clientX - r.left, e.clientY - r.top); }
// 画面 ＝ 平行移動 ＋ 回転 ＋ 拡大（view.r が 0 なら、今までどおり）
const toDoc = (s) => {
  const dx = s.x - view.x, dy = s.y - view.y, c = Math.cos(view.r), n = Math.sin(view.r);
  return P((dx * c + dy * n) / view.z, (-dx * n + dy * c) / view.z);
};
const toScr = (p) => {
  const c = Math.cos(view.r), n = Math.sin(view.r), x = p.x * view.z, y = p.y * view.z;
  return P(x * c - y * n + view.x, x * n + y * c + view.y);
};
// 回転・拡大を変えたあと、文書の点 d が画面の sp に来るように平行移動を決める
function placeDocAt(d, sp) { view.x = 0; view.y = 0; const q = toScr(d); view.x = sp.x - q.x; view.y = sp.y - q.y; }
const tol = () => 5 / inputScale();   // 5px（操作している図の倍率で）
function stageCenter() { const r = stage.getBoundingClientRect(); return P(r.width / 2, r.height / 2); }

function zoomAt(sp, nz) {
  nz = Math.min(64 * ZOOM_UNIT, Math.max(0.03125 * ZOOM_UNIT, nz));
  const d = toDoc(sp);
  view.z = nz; placeDocAt(d, sp);
  renderView();
}
function zoomStep(dir, sp) {
  const zs = ZOOMS.map((z) => z * ZOOM_UNIT);
  const nz = dir > 0 ? zs.find((z) => z > view.z * 1.001) || zs[zs.length - 1] : [...zs].reverse().find((z) => z < view.z / 1.001) || zs[0];
  zoomAt(sp || stageCenter(), nz);
}
function fitView() {
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const m = 40 + (S.rulers ? RULER : 0);
  // 回転していても入るように、回したアートボードの幅・高さで考える
  const c = Math.abs(Math.cos(view.r)), n = Math.abs(Math.sin(view.r));
  const bw = doc.width * c + doc.height * n, bh = doc.width * n + doc.height * c;
  view.z = Math.max(0.03125 * ZOOM_UNIT, Math.min((r.width - 2 * m) / bw, (r.height - 2 * m) / bh));
  placeDocAt(P(doc.width / 2, doc.height / 2), P(r.width / 2, r.height / 2));
  if (typeof fitViews3d === 'function') fitViews3d();   // 正面図・側面図も元の大きさに
  renderView();
}

function pathEl(it) {
  // 床に平行でないパス（正面図・側面図に描いたもの）は、真上から見た線を薄く出すだけ（平面図では選べない）
  if (!onTop(it)) return `<path d="${planProjD(it)}" fill="none" stroke="${it.stroke || it.fill || '#888'}" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  const d = Geo.itemD(it);
  if (S.outline) return `<path data-id="${it.id}" d="${d}" fill="none" fill-rule="${it.rule}" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  return `<path data-id="${it.id}" d="${d}" fill="${it.fill || 'none'}" fill-rule="${it.rule}" stroke="${it.stroke || 'none'}" stroke-width="${it.sw}" stroke-miterlimit="10"/>`;
}
// 平面図での折り線の両端（文書の座標）
function planHingePts(h) {
  if (S.planFolded) return hingeWorld(h).map((w) => P(w.x, w.y));
  return [h.e.a, h.e.b];
}
function renderNodes(arr, later) {
  let h = '';
  for (const n of arr) {
    if (n.hidden) continue;
    // 組み立てた形で見るとき、折った面はあとで高さの順に描く（高い面が上に重なる）
    if (later && !isGroup(n) && n.fold && n.plane) { later.push(n); continue; }
    h += isGroup(n) ? '<g>' + renderNodes(n.children, later) + '</g>' : pathEl(n);
  }
  return h;
}
// 折った面を真上から見た形（塗りあり）
function foldedPlanEl(it) {
  const d = planProjD(it);
  if (S.outline) return `<path d="${d}" fill="none" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  return `<path d="${d}" fill="${it.fill || 'none'}" fill-rule="${it.rule}" stroke="${it.stroke || 'none'}" stroke-width="${it.sw}" stroke-linejoin="round" pointer-events="none"/>`;
}
const avgZ = (it) => { const ns = it.subs[0].nodes; return ns.reduce((s, n) => s + toWorld(it.plane, n).z, 0) / ns.length; };
function renderArt() {
  if (typeof applyFolds === 'function') applyFolds();   // 折りたたみの面の 3D の位置を、角度から決め直す
  let h = typeof sheetSvg === 'function' ? sheetSvg() : '';   // 三面図の紙（いちばん下）
  for (const L of doc.layers) {
    if (!L.visible) continue;
    const later = S.planFolded ? [] : null;
    h += '<g>' + renderNodes(L.items, later);
    if (later) h += later.sort((a, b) => avgZ(a) - avgZ(b)).map(foldedPlanEl).join('');
    h += '</g>';
  }
  if (typeof dimsSvg === 'function') h += dimsSvg();   // 寸法（いちばん上）
  art.innerHTML = h;
  S.snapCache = null;
  renderViews();   // 正面図・側面図も描き直す
}
function renderGrid() {
  if (!S.grid) { gridG.innerHTML = ''; return; }
  const r = stage.getBoundingClientRect();
  const cs = [P(0, 0), P(r.width, 0), P(0, r.height), P(r.width, r.height)].map(toDoc);
  const a = P(Math.min(...cs.map((q) => q.x)), Math.min(...cs.map((q) => q.y))), b = P(Math.max(...cs.map((q) => q.x)), Math.max(...cs.map((q) => q.y)));
  let major = GRID_MAJOR;
  while (major * view.z < 12) major *= 2;
  const minor = GRID_MAJOR / GRID_DIV;
  const showMinor = major === GRID_MAJOR && minor * view.z >= 6;
  const step = showMinor ? minor : major;
  let h = '';
  const line = (x1, y1, x2, y2, isMajor) => { h += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${isMajor ? '#c4c4c4' : '#e8e8e8'}" stroke-width="1" vector-effect="non-scaling-stroke"/>`; };
  const isMaj = (v) => Math.abs(v / major - Math.round(v / major)) < 1e-6;
  const lines = [];
  for (let v = Math.floor(a.x / step) * step; v <= b.x; v += step) lines.push(['x', v, isMaj(v)]);
  for (let v = Math.floor(a.y / step) * step; v <= b.y; v += step) lines.push(['y', v, isMaj(v)]);
  // 細い線を先に、太い線を後に描く
  lines.sort((p, q) => p[2] - q[2]).forEach(([ax, v, m]) => (ax === 'x' ? line(v, a.y, v, b.y, m) : line(a.x, v, b.x, v, m)));
  gridG.innerHTML = h;
}
function drawRuler(cv, w, h, axis) {
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, w, h);
  if (Math.abs(view.r) > 1e-9) {
    // 回転しているときは目盛りを出さない
    g.fillStyle = '#9a9a9a'; g.font = '9px system-ui, sans-serif';
    if (axis === 'x') g.fillText('回転ビュー中（Ctrl+Shift+1 で戻す）', 30, 13);
    return;
  }
  const z = view.z, off = axis === 'x' ? view.x : view.y, len = axis === 'x' ? w : h;
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const major = steps.find((s) => s * z >= 50) || 20000;
  const div = (major * z) / 10 >= 5 ? 10 : (major * z) / 5 >= 5 ? 5 : 2;
  const minor = major / div;
  g.strokeStyle = '#8a8a8a'; g.fillStyle = '#c8c8c8'; g.font = '9px system-ui, sans-serif'; g.lineWidth = 1;
  g.beginPath();
  for (let k = Math.floor(-off / z / minor); k * minor <= (len - off) / z; k++) {
    const v = k * minor, s = Math.round(v * z + off) + 0.5;
    const isMaj = k % div === 0;
    const tl = isMaj ? RULER : k % (div / 2) === 0 && div % 2 === 0 ? RULER * 0.45 : RULER * 0.25;
    if (axis === 'x') { g.moveTo(s, RULER); g.lineTo(s, RULER - tl); } else { g.moveTo(RULER, s); g.lineTo(RULER - tl, s); }
    if (isMaj) {
      const label = String(Math.round(v));
      if (axis === 'x') g.fillText(label, s + 2, 9);
      else { g.save(); g.translate(2, s + 2); g.rotate(Math.PI / 2); g.fillText(label, 0, -1); g.restore(); }
    }
  }
  g.stroke();
  g.strokeStyle = '#1e1e1e'; g.beginPath();
  if (axis === 'x') { g.moveTo(0, RULER - 0.5); g.lineTo(w, RULER - 0.5); } else { g.moveTo(RULER - 0.5, 0); g.lineTo(RULER - 0.5, h); }
  g.stroke();
  if (S.mouseScr) {
    g.strokeStyle = '#ff6a6a'; g.beginPath();
    const m = Math.round(axis === 'x' ? S.mouseScr.x : S.mouseScr.y) + 0.5;
    if (axis === 'x') { g.moveTo(m, 0); g.lineTo(m, RULER); } else { g.moveTo(0, m); g.lineTo(RULER, m); }
    g.stroke();
  }
}
function drawRulers() {
  $('stageWrap').classList.toggle('rulers', S.rulers);
  if (!S.rulers) return;
  const r = stage.getBoundingClientRect();
  drawRuler($('rulerTop'), r.width, RULER, 'x');
  drawRuler($('rulerLeft'), RULER, r.height, 'y');
}
// 回転ビューの角度（度、-179〜180）
const viewDeg = () => Math.round(((((view.r * 180) / Math.PI) % 360) + 540) % 360 - 180);
// 画面の真ん中を中心に回す
function setViewRotation(rad) {
  const c = stageCenter(), d = toDoc(c);
  view.r = rad;
  placeDocAt(d, c);
  renderView();
}
// 回転ビューをリセット（イラレと同じ Ctrl+Shift+1）。正面図・側面図の回転も戻す
function resetViewRotation() {
  setViewRotation(0);
  if (typeof V3 !== 'undefined') { for (const v of VIEWS) V3.rot[v.id] = { yaw: v.yaw, pitch: 0 }; renderViews(); }
}
function renderView() {
  world.setAttribute('transform', `translate(${view.x} ${view.y}) rotate(${(view.r * 180) / Math.PI}) scale(${view.z})`);
  for (const r of [board, boardEdge]) { r.setAttribute('width', doc.width); r.setAttribute('height', doc.height); }
  const deg = viewDeg();
  $('zoomLabel').textContent = Math.round((view.z / ZOOM_UNIT) * 1000) / 10 + '%' + (deg ? `　↻${deg}°` : '');
  $('zoomLabel').title = deg ? 'クリックで回転ビューをリセット（Ctrl+Shift+1）' : '';
  $('zoomLabel').classList.toggle('rotated', !!deg);
  renderGrid(); drawRulers(); drawOverlay();
}
function render() { renderArt(); renderView(); }

// キーを押している間だけ切り替わるツール（イラレと同じ）
//   Space → 手のひら／Ctrl+Space → ズーム／Ctrl → 最後に使った選択ツール
//   Alt：アンカー追加 ⇔ アンカー削除（ペン＋Alt のアンカーポイントツールは、ペンの中で扱う）
function tempTool(ctrl, alt) {
  if (S.spaceDown) return ctrl ? 'zoom' : S.keys.shift ? 'rotView' : 'hand';   // Shift+Space：回転ビュー（イラレと同じ）
  if (ctrl && !SEL_TOOLS.has(S.tool)) return S.lastSelTool;
  // 選択ツール ⇄ ダイレクト選択ツール：Ctrl を押している間だけ入れ替わる（イラレと同じ）
  if (ctrl && S.tool === 'select') return 'direct';
  if (ctrl && S.tool === 'direct') return 'select';
  if (alt && S.tool === 'addAnchor') return 'deleteAnchor';
  if (alt && S.tool === 'deleteAnchor') return 'addAnchor';
  return S.tool;
}
function displayTool() {
  if (S.drag && S.activeTool) return S.activeTool;
  return tempTool(S.keys.ctrl, S.keys.alt);
}
function effectiveTool(e) { return tempTool(e.ctrlKey || e.metaKey, e.altKey); }

// ガイド（文書の縦線・横線）を、画面の端から端まで
function guideLine(axis, v, attrs) {
  const L = 1e6;
  const a = toScr(axis === 'x' ? P(v, -L) : P(-L, v)), b = toScr(axis === 'x' ? P(v, L) : P(L, v));
  return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${attrs}/>`;
}
// 文書の四角を、画面の上の多角形に（回転ビューでは傾いて見える）
function docRectPts(bb, pad) {
  const c = [P(bb.x, bb.y), P(bb.x + bb.w, bb.y), P(bb.x + bb.w, bb.y + bb.h), P(bb.x, bb.y + bb.h)].map(toScr);
  if (pad) {
    const m = P((c[0].x + c[2].x) / 2, (c[0].y + c[2].y) / 2);
    c.forEach((q, i) => { const v = vsub(q, m), l = vlen(v) || 1; c[i] = vadd(q, vmul(v, pad / l)); });
  }
  return c.map((q) => `${q.x},${q.y}`).join(' ');
}
function drawOverlay() {
  // 選択が変わったら、正面図・側面図の枠と色も描き直す
  if (typeof V3 !== 'undefined' && V3.ok) { const sig = displayTool() + '|' + (S.foldHinge || '') + '|' + (S.drawing ? S.drawing.id : '') + '|' + [...S.sel].map(([id, set]) => id + ':' + [...set].join('.')).join(); if (sig !== V3.lastSel) { V3.lastSel = sig; renderViews(); } }
  const t = displayTool();
  const nodeTool = NODE_TOOLS.has(t);
  const sp = toScr;
  const r = stage.getBoundingClientRect();
  let h = '';
  S.handleHits = []; S.bboxHits = []; S.bboxDoc = null;

  // ガイド
  if (S.showGuides) {
    doc.guides.forEach((g, i) => {
      const col = i === S.selGuide ? '#0060ff' : GUIDE_COLOR;
      h += guideLine(g.axis, g.v, `stroke="${col}" stroke-width="1"`);
    });
  }
  if (S.drag && S.drag.type === 'guideNew' && S.drag.v != null) {
    const g = S.drag;
    h += guideLine(g.axis, g.v, `stroke="${GUIDE_COLOR}" stroke-dasharray="4 3"`);
  }

  // マウスの下にあるもの（選択ツールではグループ全体）
  if (S.hover && !S.drag) {
    const f = findItem(S.hover);
    if (f) {
      const list = t === 'select' ? leaves([topOf(f.item)]) : [f.item];
      for (const it of list) if (!S.sel.has(it.id)) h += `<path d="${Geo.itemD(it, sp)}" fill="none" stroke="${f.layer.color}" stroke-width="1.5"/>`;
    }
  }
  // 平面図で扱うのは床に平行なパスだけ。ほかの平面のものは、真上から見た線を選択の色で出す
  const allSel = selectedItems(), items = allSel.filter(onTop);
  for (const it of S.hideEdges ? [] : allSel) if (!onTop(it)) h += `<path d="${planProjD(it, sp)}" fill="none" stroke="${findItem(it.id).layer.color}" stroke-width="1"/>`;
  for (const it of S.hideEdges ? [] : items) {
    const col = findItem(it.id).layer.color;
    const set = S.sel.get(it.id);
    h += `<path d="${Geo.itemD(it, sp)}" fill="none" stroke="${col}" stroke-width="1"/>`;
    if (nodeTool) {
      it.subs.forEach((sb, s) => {
        const n = sb.nodes, L = n.length, show = new Set();
        for (let i = 0; i < L; i++) {
          if (!set.has(key(s, i))) continue;
          show.add(i + '|hin'); show.add(i + '|hout');
          if (i > 0 || sb.closed) show.add((i - 1 + L) % L + '|hout');
          if (i < L - 1 || sb.closed) show.add((i + 1) % L + '|hin');
        }
        // つかんだ線（セグメント）の両端の方向線
        const g = S.segSel;
        if (g && g.id === it.id && g.s === s && n[g.seg]) { show.add(g.seg + '|hout'); show.add((g.seg + 1) % L + '|hin'); }
        for (const k of show) {
          const [is, w] = k.split('|');
          const i = +is, nd = n[i], hp = nd[w];
          if (!hp) continue;
          const a = sp(nd), b = sp(hp);
          h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${col}" stroke-width="1"/>`;
          // マウスが乗っている方向線の先は大きく表示（つかめることが分かるように）
          const hov = S.mouseScr && !S.drag && Math.hypot(b.x - S.mouseScr.x, b.y - S.mouseScr.y) <= 8;
          h += `<circle cx="${b.x}" cy="${b.y}" r="${hov ? 5.5 : 3.5}" fill="${col}" stroke="#fff" stroke-width="1"/>`;
          S.handleHits.push({ id: it.id, s, i, which: w, x: b.x, y: b.y });
        }
      });
    }
    it.subs.forEach((sb, s) => sb.nodes.forEach((nd, i) => {
      const a = sp(nd);
      const on = !nodeTool || set.has(key(s, i));
      h += `<rect x="${a.x - 3}" y="${a.y - 3}" width="6" height="6" fill="${on ? col : '#fff'}" stroke="${col}" stroke-width="1"/>`;
    }));
  }

  // バウンディングボックス（選択ツール）
  const moving = S.drag && (S.drag.type === 'move' || S.drag.type === 'xf') && S.drag.moved;
  if (t === 'select' && items.length && !moving && !S.hideEdges) {
    const bb = Geo.bbox(items);
    if (bb) {
      const col = findItem(items[0].id).layer.color;
      S.bboxDoc = bb;
      h += `<polygon points="${docRectPts(bb)}" fill="none" stroke="${col}" stroke-width="1"/>`;
      const X0 = bb.x, X1 = bb.x + bb.w, Y0 = bb.y, Y1 = bb.y + bb.h, MX = bb.x + bb.w / 2, MY = bb.y + bb.h / 2;
      const dp = { nw: [X0, Y0], n: [MX, Y0], ne: [X1, Y0], e: [X1, MY], se: [X1, Y1], s: [MX, Y1], sw: [X0, Y1], w: [X0, MY] };
      for (const [id, [dx, dy]] of Object.entries(dp)) {
        const { x, y } = sp(P(dx, dy));
        h += `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="#fff" stroke="${col}" stroke-width="1"/>`;
        S.bboxHits.push({ id, x, y });
      }
    }
  }
  // 折り線（オレンジ）：展開図ならその辺、組み立てた形なら真上から見た線
  const oh = typeof findHinge === 'function' && S.foldHinge && findHinge(S.foldHinge);
  if (oh) {
    const [a, b] = planHingePts(oh).map(sp);
    h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ff8c1a" stroke-width="3" stroke-linecap="round"/>`;
    // ドラッグ中：動く側の面を真上から見た形（点線）。平面図が展開図のままでも、起き方が分かるように
    const fd = S.drag && S.drag.type === 'foldPlan' ? S.drag : null;
    if (fd && fd.side) for (const id of fd.side) { const f = findItem(id); if (f) h += `<path d="${planProjD(f.item, sp)}" fill="${COL_ROT}" fill-opacity="0.12" stroke="${COL_ROT}" stroke-width="1" stroke-dasharray="4 3"/>`; }   // つまみで回している＝オレンジ
    // 回転ハンドル：真上から見た位置に出す（面が起きるほど折り線に近づく）
    h += foldHandlesSvg(oh, (w) => sp(P(w.x, w.y)), S.foldHandleHover, fd ? fd.face : null);
    if (fd && fd.moved && S.mouseScr) h += `<text x="${S.mouseScr.x + 14}" y="${S.mouseScr.y + 22}" font-size="12" font-weight="700" fill="#fff" stroke="${COL_ROT}" stroke-width="3" paint-order="stroke">角度 ${r2(fd.deg || 0)}°</text>`;
  }
  // 整列のキーオブジェクト（太い枠）
  if (S.keyId && !S.hideEdges) {
    const f = findItem(S.keyId);
    const bb = f && Geo.bbox(leaves([f.item]));
    if (bb) {
      h += `<polygon points="${docRectPts(bb, 2.8)}" fill="none" stroke="${f.layer.color}" stroke-width="3"/>`;
    }
  }
  // 回転・リフレクト・拡大縮小の基準点
  if (XF_TOOLS.has(t) && items.length) {
    const c = (S.drag && S.drag.c) || xfCenter();
    if (S.drag && S.drag.type === 'xf' && S.drag.moved && t === 'reflect' && S.drag.prm) {
      const a = S.drag.prm.axis, q = sp(c), L = 3000;
      h += `<line x1="${q.x - Math.cos(a) * L}" y1="${q.y - Math.sin(a) * L}" x2="${q.x + Math.cos(a) * L}" y2="${q.y + Math.sin(a) * L}" stroke="#00b3ff" stroke-dasharray="5 4"/>`;
    }
    if (c) {
      const q = sp(c);
      h += `<circle cx="${q.x}" cy="${q.y}" r="5" fill="none" stroke="#00b3ff" stroke-width="1.5"/><path d="M${q.x - 9} ${q.y}h18M${q.x} ${q.y - 9}v18" stroke="#00b3ff" stroke-width="1"/>`;
    }
  }
  if (S.marquee) {
    const { a, b } = S.marquee;
    const mb = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    h += `<polygon points="${docRectPts(mb)}" fill="rgba(79,128,255,0.08)" stroke="#4f80ff" stroke-dasharray="3 3"/>`;
  }
  // ペンのラバーバンド（次の線のプレビュー）
  if (t === 'pen' && S.drawing && !S.drag && S.mouseScr) {
    const sb = drawingSub();
    if (sb) {
      const last = sb.nodes[sb.nodes.length - 1];
      let q = S.keys.shift ? constrain45(last, S.mouse) : S.mouse;
      if (!S.keys.shift && S.snapViz && S.snapViz.p) q = S.snapViz.p;
      const a = sp(last), c1 = sp(last.hout || last), b = sp(q);
      const col = findItem(S.drawing.id).layer.color;
      h += `<path d="M${a.x} ${a.y}C${c1.x} ${c1.y} ${b.x} ${b.y} ${b.x} ${b.y}" fill="none" stroke="${col}" stroke-width="1"/>`;
    }
  }
  // スマートガイド
  if (S.snapViz) {
    for (const [a, b] of S.snapViz.lines) {
      const p1 = sp(a), p2 = sp(b);
      h += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${SMART_COLOR}" stroke-width="1"/>`;
    }
    if (S.snapViz.label && S.snapViz.at) {
      const q = sp(S.snapViz.at);
      h += `<circle cx="${q.x}" cy="${q.y}" r="3" fill="none" stroke="${SMART_COLOR}" stroke-width="1.5"/>`;
      h += `<text x="${q.x + 8}" y="${q.y - 6}" font-size="11" fill="${SMART_COLOR}" stroke="#fff" stroke-width="3" paint-order="stroke">${S.snapViz.label}</text>`;
    }
  }
  // 移動中に面と面の辺がぴったり接した：その辺をオレンジに、カーソルの横に「折り線」
  if (S.drag && S.drag.type === 'move' && S.drag.contacts && S.drag.contacts.length && S.mouseScr) {
    for (const e of S.drag.contacts) { const a = sp(e.a), b = sp(e.b); h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ff8c1a" stroke-width="3" stroke-linecap="round"/>`; }
    const m = S.mouseScr;
    h += `<g transform="translate(${m.x + 14},${m.y + 16})"><rect x="0" y="-12" width="96" height="18" rx="3" fill="#ff8c1a"/><text x="6" y="1" font-size="12" font-weight="700" fill="#fff">✓ 折り線になる</text></g>`;
  }
  if (t === 'pen' && S.penHint && S.mouseScr && !S.drag) {
    h += `<text x="${S.mouseScr.x + 10}" y="${S.mouseScr.y + 18}" font-size="13" font-weight="700" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">${S.penHint}</text>`;
  }
  if (typeof dimOverlaySvg === 'function') h += dimOverlaySvg(t);
  overlay.innerHTML = h;
}
