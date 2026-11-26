'use strict';
// ベジェ曲線の計算と、パスのデータ構造まわりの道具

const P = (x, y) => ({ x, y });
const vadd = (a, b) => P(a.x + b.x, a.y + b.y);
const vsub = (a, b) => P(a.x - b.x, a.y - b.y);
const vmul = (a, s) => P(a.x * s, a.y * s);
const vlen = (a) => Math.hypot(a.x, a.y);
const vdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const vlerp = (a, b, t) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const fmt = (n) => { const r = Math.round(n * 1000) / 1000; return Object.is(r, -0) ? 0 : r; };
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = (o) => JSON.parse(JSON.stringify(o));
const KAPPA = 0.5522847498307936;

function cubicAt(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return P(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y);
}

// ド・カステリョのアルゴリズムで t の位置で2つに分ける
function splitCubic(p0, p1, p2, p3, t) {
  const a = vlerp(p0, p1, t), b = vlerp(p1, p2, t), c = vlerp(p2, p3, t);
  const d = vlerp(a, b, t), e = vlerp(b, c, t), m = vlerp(d, e, t);
  return [[p0, a, d, m], [m, e, c, p3]];
}

// origin から見て 45° 刻みにそろえる（Shift）
function constrain45(o, p) {
  const v = vsub(p, o);
  const a = Math.atan2(v.y, v.x);
  const s = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  const L = vlen(v) * Math.cos(a - s);
  return P(o.x + Math.cos(s) * L, o.y + Math.sin(s) * L);
}
const snapAngle = (a, step) => Math.round(a / step) * step;

function rotateFn(c, ang) {
  const co = Math.cos(ang), si = Math.sin(ang);
  return (q) => { const dx = q.x - c.x, dy = q.y - c.y; return P(c.x + dx * co - dy * si, c.y + dx * si + dy * co); };
}

// ---- データ構造 ----
// アイテム = { id, subs:[{nodes:[node], closed}], fill, stroke, sw, rule, hidden, locked }
// node = { x, y, hin:{x,y}|null, hout:{x,y}|null, smooth }   hin/hout は絶対座標。null はハンドルなし
function mkNode(x, y, hin = null, hout = null, smooth = false) { return { x, y, hin, hout, smooth }; }

function moveNode(n, dx, dy) {
  n.x += dx; n.y += dy;
  if (n.hin) { n.hin.x += dx; n.hin.y += dy; }
  if (n.hout) { n.hout.x += dx; n.hout.y += dy; }
}
function mapNode(n, f) {
  const r = f(n);
  if (n.hin) n.hin = f(n.hin);
  if (n.hout) n.hout = f(n.hout);
  n.x = r.x; n.y = r.y;
}
function mapItem(it, f) { it.subs.forEach((sb) => sb.nodes.forEach((n) => mapNode(n, f))); }

function reverseSub(sb) {
  sb.nodes.reverse();
  sb.nodes.forEach((n) => { const t = n.hin; n.hin = n.hout; n.hout = t; });
}

function isSmoothPair(n) {
  if (!n.hin || !n.hout) return false;
  const a = vsub(n.hin, n), b = vsub(n.hout, n);
  const la = vlen(a), lb = vlen(b);
  if (la < 1e-9 || lb < 1e-9) return false;
  const cross = Math.abs(a.x * b.y - a.y * b.x) / (la * lb);
  const dot = a.x * b.x + a.y * b.y;
  return cross < 0.02 && dot < 0;
}
function normalizeSub(sb) {
  for (const n of sb.nodes) {
    if (n.hin && vdist(n.hin, n) < 1e-9) n.hin = null;
    if (n.hout && vdist(n.hout, n) < 1e-9) n.hout = null;
    n.smooth = isSmoothPair(n);
  }
}

function rectSub(x0, y0, x1, y1) {
  return { nodes: [mkNode(x0, y0), mkNode(x1, y0), mkNode(x1, y1), mkNode(x0, y1)], closed: true };
}
function ellipseSub(cx, cy, rx, ry) {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return {
    closed: true,
    nodes: [
      mkNode(cx, cy - ry, P(cx - kx, cy - ry), P(cx + kx, cy - ry), true),
      mkNode(cx + rx, cy, P(cx + rx, cy - ky), P(cx + rx, cy + ky), true),
      mkNode(cx, cy + ry, P(cx + kx, cy + ry), P(cx - kx, cy + ry), true),
      mkNode(cx - rx, cy, P(cx - rx, cy + ky), P(cx - rx, cy - ky), true),
    ],
  };
}
function roundRectSub(x, y, w, h, rx, ry) {
  const kx = rx * KAPPA, ky = ry * KAPPA, x1 = x + w, y1 = y + h;
  return {
    closed: true,
    nodes: [
      mkNode(x + rx, y, P(x + rx - kx, y), null),
      mkNode(x1 - rx, y, null, P(x1 - rx + kx, y)),
      mkNode(x1, y + ry, P(x1, y + ry - ky), null),
      mkNode(x1, y1 - ry, null, P(x1, y1 - ry + ky)),
      mkNode(x1 - rx, y1, P(x1 - rx + kx, y1), null),
      mkNode(x + rx, y1, null, P(x + rx - kx, y1)),
      mkNode(x, y1 - ry, P(x, y1 - ry + ky), null),
      mkNode(x, y + ry, null, P(x, y + ry - ky)),
    ],
  };
}

const Geo = {
  segCount(sb) { const n = sb.nodes.length; if (n < 2) return 0; return sb.closed ? n : n - 1; },
  seg(sb, i) {
    const n = sb.nodes, a = n[i], b = n[(i + 1) % n.length];
    return [a, a.hout || a, b.hin || b, b];
  },
  isLine(sb, i) { const n = sb.nodes, a = n[i], b = n[(i + 1) % n.length]; return !a.hout && !b.hin; },
  subD(sb, f) {
    const n = sb.nodes;
    if (!n.length) return '';
    const q = (p) => { const r = f ? f(p) : p; return fmt(r.x) + ' ' + fmt(r.y); };
    let d = 'M' + q(n[0]);
    const cnt = Geo.segCount(sb);
    for (let i = 0; i < cnt; i++) {
      const s = Geo.seg(sb, i);
      if (Geo.isLine(sb, i)) d += 'L' + q(s[3]);
      else d += 'C' + q(s[1]) + ' ' + q(s[2]) + ' ' + q(s[3]);
    }
    if (sb.closed) d += 'Z';
    return d;
  },
  itemD(it, f) { return it.subs.map((sb) => Geo.subD(sb, f)).join(''); },

  // 点 p にいちばん近いパス上の位置
  nearest(it, p) {
    let best = null;
    it.subs.forEach((sb, s) => {
      if (sb.nodes.length === 1) {
        const d = vdist(sb.nodes[0], p);
        if (!best || d < best.d) best = { s, seg: -1, t: 0, d, pt: P(sb.nodes[0].x, sb.nodes[0].y) };
      }
      const cnt = Geo.segCount(sb);
      for (let i = 0; i < cnt; i++) {
        const [a, b, c, e] = Geo.seg(sb, i);
        const N = 24;
        let bt = 0, bd = Infinity;
        for (let k = 0; k <= N; k++) {
          const t = k / N, d = vdist(cubicAt(a, b, c, e, t), p);
          if (d < bd) { bd = d; bt = t; }
        }
        let h = 1 / N;
        for (let r = 0; r < 14; r++) {
          h /= 2;
          for (const t of [bt - h, bt + h]) {
            if (t < 0 || t > 1) continue;
            const d = vdist(cubicAt(a, b, c, e, t), p);
            if (d < bd) { bd = d; bt = t; }
          }
        }
        if (!best || bd < best.d) best = { s, seg: i, t: bt, d: bd, pt: cubicAt(a, b, c, e, bt) };
      }
    });
    return best;
  },

  samples(it, per = 8) {
    const out = [];
    for (const sb of it.subs) {
      sb.nodes.forEach((n) => out.push(n));
      const cnt = Geo.segCount(sb);
      for (let i = 0; i < cnt; i++) {
        const s = Geo.seg(sb, i);
        for (let k = 1; k < per; k++) out.push(cubicAt(s[0], s[1], s[2], s[3], k / per));
      }
    }
    return out;
  },

  bbox(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const inc = (q) => { if (q.x < x0) x0 = q.x; if (q.y < y0) y0 = q.y; if (q.x > x1) x1 = q.x; if (q.y > y1) y1 = q.y; };
    for (const it of items) {
      for (const sb of it.subs) {
        sb.nodes.forEach(inc);
        const cnt = Geo.segCount(sb);
        for (let i = 0; i < cnt; i++) {
          if (Geo.isLine(sb, i)) continue;
          const s = Geo.seg(sb, i);
          for (let k = 1; k < 24; k++) inc(cubicAt(s[0], s[1], s[2], s[3], k / 24));
        }
      }
    }
    if (x0 === Infinity) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },
};

// SVG の円弧（A コマンド）を3次ベジェに変換する
function arcToCubics(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  const sinp = Math.sin(phi), cosp = Math.cos(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosp * dx + sinp * dy, y1p = -sinp * dx + cosp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cosp * cxp - sinp * cyp + (x1 + x2) / 2;
  const cy = sinp * cxp + cosp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const d = dt / segs;
  const k = (4 / 3) * Math.tan(d / 4);
  const map = (ux, uy) => P(cx + rx * ux * cosp - ry * uy * sinp, cy + rx * ux * sinp + ry * uy * cosp);
  const out = [];
  let t = t1;
  for (let i = 0; i < segs; i++) {
    const c1 = Math.cos(t), s1 = Math.sin(t), c2 = Math.cos(t + d), s2 = Math.sin(t + d);
    out.push([map(c1 - k * s1, s1 + k * c1), map(c2 + k * s2, s2 - k * c2), map(c2, s2)]);
    t += d;
  }
  return out;
}
