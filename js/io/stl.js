'use strict';
// イラレCAD：STL 書き出し（3D プリンター用。単位は mm）

const STL_TYPE = { description: 'STL（3D プリンター用）', accept: { 'model/stl': ['.stl'] } };

// 押し出しをすべて三角形にして、バイナリの STL にする
function buildSTL(items) {
  const k = 1;   // 中の値がもう mm
  const tris = [];
  for (const it of items) for (const t of solidTriangles(it)) tris.push(t);
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  const head = 'IllustCAD STL (mm)';
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const [a, b, c] of tris) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz]) { dv.setFloat32(o, v, true); o += 4; }
    for (const p of [a, b, c]) for (const v of p) { dv.setFloat32(o, v * k, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return { buf, count: tris.length };
}

async function exportStlFile() {
  if (S.drawing) endDrawing();
  // 選んでいる押し出しがあればそれだけ、なければ見えている押し出しすべて
  const sel = selectedItems().filter((it) => extrudeOf(it) && !isDrawingLayer(layerOfItem(it)));   // 図面レイヤーのものは出さない
  const items = sel.length ? sel : visibleSolids();
  if (!items.length) { toast('押し出した立体がありません。パスを選んで、パネルの「3D 押し出し」で高さを入れてください'); return; }
  const { buf, count } = buildSTL(items);
  const name = baseName(S.fileName) + '.stl';
  const h = await writeFile(new Blob([buf], { type: 'model/stl' }), { name, type: STL_TYPE, mime: 'model/stl', handle: null });
  if (h === false) return;
  const what = sel.length ? `選んだ ${items.length} 個` : `${items.length} 個`;
  toast(`STL を書き出しました（${what}、三角形 ${count} 枚、単位 mm）` + (h ? '：' + h.name : ''));
}
