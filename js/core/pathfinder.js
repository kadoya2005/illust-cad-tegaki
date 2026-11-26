'use strict';
// パスファインダー：paper.js を使って、ベジェ曲線のまま合体・型抜きなどを計算する

const Pathfinder = (() => {
  let ps = null;
  function scope() {
    if (!ps) {
      if (!window.paper) throw new Error('paper.js を読み込めませんでした');
      ps = new paper.PaperScope();
      ps.setup(new ps.Size(10, 10));
    }
    return ps;
  }

  // アプリのパス（サブパスの集まり）→ paper.js の CompoundPath
  function leafToPaper(it) {
    const s = scope();
    const cp = new s.CompoundPath({ insert: false });
    for (const sb of it.subs) {
      if (sb.nodes.length < 2) continue;
      const segs = sb.nodes.map((n) => new s.Segment(
        new s.Point(n.x, n.y),
        n.hin ? new s.Point(n.hin.x - n.x, n.hin.y - n.y) : new s.Point(0, 0),
        n.hout ? new s.Point(n.hout.x - n.x, n.hout.y - n.y) : new s.Point(0, 0),
      ));
      cp.addChild(new s.Path({ segments: segs, closed: true, insert: false }));
    }
    cp.fillRule = it.rule === 'evenodd' ? 'evenodd' : 'nonzero';
    return cp;
  }
  // いくつかのパス（グループの中身など）を1つの形にまとめる
  function toPaper(leaves) {
    let r = null;
    for (const it of leaves) { const p = leafToPaper(it); r = r ? r.unite(p, { insert: false }) : p; }
    return r;
  }
  // paper.js → アプリのサブパス
  function toSubs(pi) {
    const paths = pi.className === 'CompoundPath' ? pi.children : [pi];
    const subs = [];
    for (const p of paths) {
      if (!p.segments || p.segments.length < 2) continue;
      const nodes = p.segments.map((sg) => {
        const x = sg.point.x, y = sg.point.y, hi = sg.handleIn, ho = sg.handleOut;
        return mkNode(x, y, hi.isZero() ? null : P(x + hi.x, y + hi.y), ho.isZero() ? null : P(x + ho.x, y + ho.y));
      });
      const sb = { nodes, closed: p.closed };
      normalizeSub(sb);
      subs.push(sb);
    }
    return subs;
  }
  const isEmpty = (pi) => !pi || pi.isEmpty() || Math.abs(pi.area) < 1e-6;

  // 離れた部分ごとに分ける（穴はそれを囲む外形といっしょにする）
  function pieces(pi) {
    const s = scope();
    const kids = pi.className === 'CompoundPath' ? pi.children.slice() : [pi];
    if (kids.length <= 1) return [pi];
    const info = kids.map((c) => ({ c, pt: c.interiorPoint, area: Math.abs(c.area), depth: 0, parent: null }));
    for (const a of info) {
      for (const b of info) {
        if (a === b || b.area <= a.area || !b.c.contains(a.pt)) continue;
        a.depth++;
        if (!a.parent || b.area < a.parent.area) a.parent = b;
      }
    }
    return info.filter((a) => a.depth % 2 === 0).map((o) => {
      const cp = new s.CompoundPath({ insert: false });
      cp.addChild(o.c.clone({ insert: false }));
      info.filter((h) => h.parent === o && h.depth % 2 === 1).forEach((h) => cp.addChild(h.c.clone({ insert: false })));
      return cp;
    });
  }

  // objs: [{ leaves, style }] を下から上の順で。戻り値: [{ subs, style }]
  function run(op, objs) {
    const s = scope();
    const items = objs.map((o) => ({ pi: toPaper(o.leaves), style: o.style }));
    const reduce = (arr, fn) => arr.slice(1).reduce((acc, o) => acc[fn](o.pi, { insert: false }), arr[0].pi);
    const top = items[items.length - 1];
    let out = [];
    if (op === 'unite') out = [{ pi: reduce(items, 'unite'), style: top.style }];
    else if (op === 'minusFront') out = [{ pi: reduce(items, 'subtract'), style: items[0].style }];
    else if (op === 'minusBack') { const rev = items.slice().reverse(); out = [{ pi: reduce(rev, 'subtract'), style: top.style }]; }
    else if (op === 'intersect') out = [{ pi: reduce(items, 'intersect'), style: top.style }];
    else if (op === 'exclude') out = [{ pi: reduce(items, 'exclude'), style: top.style }];
    else if (op === 'divide' || op === 'trim') {
      let regions = [];
      for (const o of items) {
        const next = [];
        let rest = o.pi;
        for (const r of regions) {
          const D = r.pi.subtract(o.pi, { insert: false });
          if (!isEmpty(D)) next.push({ pi: D, style: r.style });
          if (op === 'divide') {
            const I = r.pi.intersect(o.pi, { insert: false });
            if (!isEmpty(I)) next.push({ pi: I, style: o.style });
            rest = rest.subtract(r.pi, { insert: false });
          }
        }
        if (!isEmpty(rest)) next.push({ pi: rest, style: o.style });
        regions = next;
      }
      for (const r of regions) for (const p of pieces(r.pi)) out.push({ pi: p, style: r.style });
    }
    const res = out.filter((o) => !isEmpty(o.pi)).map((o) => ({ subs: toSubs(o.pi), style: o.style })).filter((r) => r.subs.length);
    s.project.clear();
    return res;
  }

  return { run, scope };
})();
