'use strict';
// SVG の読み込みと書き出し

// ---- パスデータ（d 属性）の読み取り ----
function parsePathD(d) {
  const subs = [];
  const L = d.length;
  let i = 0;
  const numRe = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const skip = () => { while (i < L && /[\s,]/.test(d[i])) i++; };
  const num = () => {
    skip(); numRe.lastIndex = i;
    const m = numRe.exec(d);
    if (!m) throw new Error('パスの数値を読めません');
    i = numRe.lastIndex;
    return parseFloat(m[0]);
  };
  const flag = () => {
    skip();
    const ch = d[i];
    if (ch !== '0' && ch !== '1') throw new Error('円弧のフラグを読めません');
    i++;
    return ch === '1';
  };
  const hasNum = () => { skip(); return i < L && /[+\-.\d]/.test(d[i]); };

  let cur = P(0, 0), start = P(0, 0), cs = null, cmd = null, prevCmd = '', prevC2 = null, prevQ = null;
  const startSub = (p) => { cs = { nodes: [mkNode(p.x, p.y)], closed: false }; subs.push(cs); };
  const ensure = () => { if (!cs || cs.closed) startSub(cur); };
  const lineTo = (p) => { ensure(); cs.nodes.push(mkNode(p.x, p.y)); cur = p; };
  const curveTo = (c1, c2, p) => {
    ensure();
    cs.nodes[cs.nodes.length - 1].hout = P(c1.x, c1.y);
    cs.nodes.push(mkNode(p.x, p.y, P(c2.x, c2.y), null));
    cur = p;
  };

  while (true) {
    skip();
    if (i >= L) break;
    if (/[a-zA-Z]/.test(d[i])) { cmd = d[i]; i++; }
    else if (!cmd || !hasNum()) throw new Error('パスの形式が正しくありません');
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const pt = () => { const x = num(), y = num(); return rel ? P(cur.x + x, cur.y + y) : P(x, y); };
    switch (C) {
      case 'M': { const p = pt(); startSub(p); cur = p; start = p; cmd = rel ? 'l' : 'L'; prevCmd = 'M'; continue; }
      case 'L': lineTo(pt()); break;
      case 'H': { const x = num(); lineTo(P(rel ? cur.x + x : x, cur.y)); break; }
      case 'V': { const y = num(); lineTo(P(cur.x, rel ? cur.y + y : y)); break; }
      case 'C': { const c1 = pt(), c2 = pt(), p = pt(); curveTo(c1, c2, p); prevC2 = c2; break; }
      case 'S': {
        const c1 = (prevCmd === 'C' || prevCmd === 'S') && prevC2 ? P(2 * cur.x - prevC2.x, 2 * cur.y - prevC2.y) : cur;
        const c2 = pt(), p = pt(); curveTo(c1, c2, p); prevC2 = c2; break;
      }
      case 'Q': { const q = pt(), p = pt(); curveTo(vlerp(cur, q, 2 / 3), vlerp(p, q, 2 / 3), p); prevQ = q; break; }
      case 'T': {
        const q = (prevCmd === 'Q' || prevCmd === 'T') && prevQ ? P(2 * cur.x - prevQ.x, 2 * cur.y - prevQ.y) : cur;
        const p = pt(); curveTo(vlerp(cur, q, 2 / 3), vlerp(p, q, 2 / 3), p); prevQ = q; break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), fa = flag(), fs = flag();
        const p = pt();
        if (vdist(cur, p) < 1e-12) break;
        if (rx === 0 || ry === 0) { lineTo(p); break; }
        for (const [c1, c2, q] of arcToCubics(cur.x, cur.y, rx, ry, (rot * Math.PI) / 180, fa, fs, p.x, p.y)) curveTo(c1, c2, q);
        cur = p;
        break;
      }
      case 'Z': {
        if (cs && !cs.closed) {
          cs.closed = true;
          const n = cs.nodes;
          if (n.length > 1 && vdist(n[0], n[n.length - 1]) < 1e-6) { n[0].hin = n[n.length - 1].hin; n.pop(); }
        }
        cur = start; prevCmd = 'Z'; cmd = null;
        continue;
      }
      default: throw new Error('未対応のパスコマンド: ' + cmd);
    }
    prevCmd = C;
  }
  return subs.filter((sb) => sb.nodes.length >= 2);
}

function cssColor(v) {
  if (!v || v === 'none' || v === 'transparent') return null;
  if (v.startsWith('url')) return '#888888';
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length >= 4 && p[3] === 0) return null;
    return '#' + p.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('').toLowerCase();
  return '#000000';
}

function elementSubs(el) {
  const g = (n) => { const v = el.getAttribute(n); return v == null ? 0 : parseFloat(v) || 0; };
  switch (el.localName) {
    case 'path': return parsePathD(el.getAttribute('d') || '');
    case 'rect': {
      const x = g('x'), y = g('y'), w = g('width'), h = g('height');
      if (w <= 0 || h <= 0) return null;
      let rx = el.hasAttribute('rx') ? g('rx') : null, ry = el.hasAttribute('ry') ? g('ry') : null;
      if (rx == null && ry != null) rx = ry;
      if (ry == null && rx != null) ry = rx;
      rx = Math.min(rx || 0, w / 2); ry = Math.min(ry || 0, h / 2);
      return [rx > 0 && ry > 0 ? roundRectSub(x, y, w, h, rx, ry) : rectSub(x, y, x + w, y + h)];
    }
    case 'circle': { const r = g('r'); return r > 0 ? [ellipseSub(g('cx'), g('cy'), r, r)] : null; }
    case 'ellipse': { const rx = g('rx'), ry = g('ry'); return rx > 0 && ry > 0 ? [ellipseSub(g('cx'), g('cy'), rx, ry)] : null; }
    case 'line': return [{ nodes: [mkNode(g('x1'), g('y1')), mkNode(g('x2'), g('y2'))], closed: false }];
    case 'polyline':
    case 'polygon': {
      const a = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat).filter(isFinite);
      const nodes = [];
      for (let k = 0; k + 1 < a.length; k += 2) nodes.push(mkNode(a[k], a[k + 1]));
      return nodes.length >= 2 ? [{ nodes, closed: el.localName === 'polygon' }] : null;
    }
  }
  return null;
}

// el から root までの transform をまとめた行列
function ctmTo(el, root) {
  let m = new DOMMatrix();
  for (let a = el; a && a !== root; a = a.parentElement) {
    const tl = a.transform && a.transform.baseVal;
    if (tl && tl.numberOfItems) {
      const c = tl.consolidate();
      if (c) { const mm = c.matrix; m = new DOMMatrix([mm.a, mm.b, mm.c, mm.d, mm.e, mm.f]).multiply(m); }
    }
  }
  return m;
}

const SHAPE_TAGS = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'];
const GROUP_TAGS = ['g', 'a', 'switch'];
const UNSUPPORTED_TAGS = ['text', 'image', 'use', 'foreignObject'];

function shapeToItem(el, ctx) {
  let subs;
  try { subs = elementSubs(el); } catch (e) { return null; }
  if (!subs || !subs.length) return null;
  const m = ctmTo(el, ctx.root);
  const f = (q) => P(m.a * q.x + m.c * q.y + m.e - ctx.ox, m.b * q.x + m.d * q.y + m.f - ctx.oy);
  subs.forEach((sb) => { sb.nodes.forEach((n) => mapNode(n, f)); normalizeSub(sb); });
  const cs = getComputedStyle(el);
  let sw = parseFloat(cs.strokeWidth);
  if (!isFinite(sw)) sw = 1;
  sw *= Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  const lineish = el.localName === 'line' || el.localName === 'polyline';
  return {
    id: el.getAttribute('data-icad-id') || uid(),
    subs,
    fill: lineish ? null : cssColor(cs.fill),
    stroke: cssColor(cs.stroke),
    sw: fmt(sw),
    rule: cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    hidden: cs.display === 'none',
    locked: el.getAttribute('data-locked') === 'true',
    ...parseX3d(el.getAttribute('data-icad-x3d')),
    ...parsePlane(el.getAttribute('data-icad-plane')),
    ...parseFold(el.getAttribute('data-icad-fold')),
  };
}

// 子要素を読み込んで、パスとグループの木にする
function parseNodes(parent, ctx) {
  const out = [];
  for (const ch of Array.from(parent.children)) {
    const tag = ch.localName;
    if (GROUP_TAGS.includes(tag)) {
      const kids = parseNodes(ch, ctx);
      if (!kids.length) continue;
      out.push({
        type: 'group', id: ch.getAttribute('data-icad-id') || uid(), name: ch.getAttribute('data-name') || '', children: kids,
        hidden: getComputedStyle(ch).display === 'none', locked: ch.getAttribute('data-locked') === 'true',
      });
    } else if (SHAPE_TAGS.includes(tag)) {
      const it = shapeToItem(ch, ctx);
      if (it) out.push(it); else ctx.skipped++;
    } else if (UNSUPPORTED_TAGS.includes(tag)) {
      ctx.skipped++;
    }
  }
  return out;
}

// SVG テキストを読み込んで { width, height, layers:[{name, visible, locked, items}], skipped } を返す
function parseSVG(text) {
  const dom = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (dom.querySelector('parsererror')) throw new Error('SVG の形式が正しくありません');
  const src = dom.documentElement;
  if (src.localName !== 'svg') throw new Error('SVG ファイルではありません');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const root = document.importNode(src, true);
  holder.appendChild(root);
  document.body.appendChild(holder);
  try {
    let width = 595.28, height = 841.89, ox = 0, oy = 0;
    const vb = root.getAttribute('viewBox');
    const vba = vb ? vb.trim().split(/[\s,]+/).map(Number) : [];
    if (vba.length === 4 && vba.every(isFinite) && vba[2] > 0 && vba[3] > 0) {
      [ox, oy, width, height] = vba;
    } else {
      const w = parseFloat(root.getAttribute('width')), h = parseFloat(root.getAttribute('height'));
      if (w > 0) width = w;
      if (h > 0) height = h;
    }
    const ctx = { root, ox, oy, skipped: 0 };
    const topG = Array.from(root.children).filter((c) => c.localName === 'g');
    const layers = [];
    // イラレはレイヤーを data-name 付きの <g> で書き出す。レイヤーが1つのときは <svg> 自体に data-name が付く
    const singleLayer = root.hasAttribute('data-name') && !topG.some((g) => g.hasAttribute('data-name'));
    if (singleLayer) {
      layers.push({ name: root.getAttribute('data-name'), visible: true, locked: false, items: parseNodes(root, ctx) });
    } else {
      let loose = null, n = 0;
      for (const ch of Array.from(root.children)) {
        if (ch.localName === 'g') {
          n++;
          layers.push({
            name: ch.getAttribute('data-name') || ch.getAttribute('id') || 'レイヤー ' + n,
            visible: getComputedStyle(ch).display !== 'none',
            locked: ch.getAttribute('data-locked') === 'true',
            items: parseNodes(ch, ctx),
          });
          loose = null;
        } else {
          const nodes = parseNodes({ children: [ch] }, ctx);
          if (!nodes.length) continue;
          if (!loose) { loose = { name: 'レイヤー ' + ++n, visible: true, locked: false, items: [] }; layers.push(loose); }
          loose.items.push(...nodes);
        }
      }
    }
    return { width, height, layers, skipped: ctx.skipped };
  } finally {
    holder.remove();
  }
}

// ---- 書き出し ----
const svgEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 押し出し（3D）は data-icad-x3d="底,高さ" で残す（SVG の中なので pt。イラレで開いて保存すると消えます）
function parseX3d(v) {
  const a = (v || '').split(',').map(Number);
  return a.length === 2 && a.every(isFinite) && a[1] > 0 ? { x3d: { z0: a[0], h: a[1] } } : {};
}
// 作業平面（3D）は data-icad-plane="o.x,o.y,o.z,u.x,u.y,u.z,v.x,v.y,v.z" で残す
function parsePlane(v) {
  const a = (v || '').split(',').map(Number);
  return a.length === 9 && a.every(isFinite) ? { plane: { o: a.slice(0, 3), u: a.slice(3, 6), v: a.slice(6, 9) } } : {};
}
// 折りたたみの角度は data-icad-fold="角度"（重しの面は "角度,fixed"）
function parseFold(v) {
  if (!v) return {};
  try { const o = JSON.parse(v); if (o && typeof o === 'object') return { fold: o }; } catch (_) { /* 試作1の形 */ }
  const [d] = v.split(',');
  return isFinite(+d) ? { fold: { deg: +d } } : {};
}
// 折りたたみ（折り線ごとの角度・土台の置き方）は data-icad-fold に JSON で
const foldAttr = (n) => (n.fold && Object.keys(n.fold).length ? ` data-icad-fold="${svgEsc(JSON.stringify(n.fold))}"` : '');
const planeAttr = (n) => (n.plane ? ` data-icad-plane="${[...n.plane.o, ...n.plane.u, ...n.plane.v].map(fmt).join(',')}"` : '');
function nodeToSVG(n, ind) {
  // data-icad-id：読み込み直しても ID が変わらないように（3D の断面が ID で参照するため）
  const extra = ` data-icad-id="${svgEsc(n.id)}"` + (n.x3d ? ` data-icad-x3d="${fmt(n.x3d.z0)},${fmt(n.x3d.h)}"` : '') + planeAttr(n) + foldAttr(n) + (n.locked ? ' data-locked="true"' : '') + (n.hidden ? ' style="display:none"' : '');
  if (n.type === 'group') {
    const name = n.name ? ` data-name="${svgEsc(n.name)}"` : '';
    return `${ind}<g${name}${extra}>\n` + n.children.map((c) => nodeToSVG(c, ind + '  ')).join('') + `${ind}</g>\n`;
  }
  const a = [`d="${Geo.itemD(n)}"`, `fill="${n.fill || 'none'}"`];
  if (n.rule === 'evenodd') a.push('fill-rule="evenodd"');
  a.push(`stroke="${n.stroke || 'none'}"`);
  if (n.stroke) a.push(`stroke-width="${fmt(n.sw)}"`, 'stroke-miterlimit="10"');
  return `${ind}<path ${a.join(' ')}${extra}/>\n`;
}

// 書き出しは Illustrator に合わせて pt（中の mm を換算する）
function exportDocSVG(doc) {
  const w = fmt(doc.width * PT_PER_MM), h = fmt(doc.height * PT_PER_MM);
  const ids = new Set();
  let out = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n`;
  for (const L of doc.layers) {
    let id = L.name.replace(/[^\p{L}\p{N}_.-]/gu, '_');
    if (!/^[\p{L}_]/u.test(id)) id = '_' + id;
    const base = id;
    let k = 2;
    while (ids.has(id)) id = base + '-' + k++;
    ids.add(id);
    const extra = (L.visible ? '' : ' style="display:none"') + (L.locked ? ' data-locked="true"' : '');
    out += `  <g id="${svgEsc(id)}" data-name="${svgEsc(L.name)}"${extra}>\n`;
    for (const n of L.items) out += nodeToSVG(scaleNodeUnits(clone(n), PT_PER_MM), '    ');
    out += '  </g>\n';
  }
  return out + '</svg>\n';
}

// コピー用：選んだものだけの SVG（nodes はパスかグループ）
function exportItemsSVG(nodes) {
  nodes = nodes.map((n) => scaleNodeUnits(clone(n), PT_PER_MM));
  const ls = [];
  const walk = (arr) => arr.forEach((n) => (n.type === 'group' ? walk(n.children) : ls.push(n)));
  walk(nodes);
  const bb = Geo.bbox(ls) || { x: 0, y: 0, w: 0, h: 0 };
  const pad = Math.max(0, ...ls.map((it) => (it.stroke ? it.sw / 2 : 0)));
  const x = fmt(bb.x - pad), y = fmt(bb.y - pad), w = fmt(bb.w + pad * 2), h = fmt(bb.h + pad * 2);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">\n`;
  for (const n of nodes) out += nodeToSVG(n, '  ');
  return out + '</svg>\n';
}
