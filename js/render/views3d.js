'use strict';
// イラレCAD：正面図・側面図（右側の2枚）。three.js で描く
// 最初は遠近のない三面図：正面図は手前（平面図の下側）から、側面図は右から見る
// Shift＋Space＋ドラッグで回して見られる（回しているあいだは「見るだけ」。ダブルクリックで正面・側面に戻る）
//
// three.js の座標：X ＝ 平面図の x（右）、Y ＝ 高さ z（上）、Z ＝ 平面図の y（下＝手前）

const VIEWS = [
  { id: 'viewFront', name: '正面図', yaw: 0 },     // 手前（+Z）から見る
  { id: 'viewSide', name: '側面図', yaw: 90 },     // 右（+X）から見る
];
const SNAP_DEG = 15;

// 表示の拡大率（2枚共通）、それぞれのずらし量（px）と向き（度）。Ctrl+0 で元に戻る
const V3 = {
  k: 1,
  pan: { viewFront: P(0, 0), viewSide: P(0, 0) },
  rot: { viewFront: { yaw: 0, pitch: 0 }, viewSide: { yaw: 90, pitch: 0 } },
  ok: false, scene: null, views: {}, meshes: new Map(), flatCache: new Map(), flats: null, handleHits: {}, penPlane: {}, board: null, light: null,
};
function fitViews3d() {
  V3.k = 1;
  for (const v of VIEWS) { V3.pan[v.id] = P(0, 0); V3.rot[v.id] = { yaw: v.yaw, pitch: 0 }; }
  renderViews();
}
const isRotated = (id) => { const v = VIEWS.find((w) => w.id === id), r = V3.rot[id]; return Math.abs(r.yaw - v.yaw) > 1e-6 || Math.abs(r.pitch) > 1e-6; };

// ---- three.js の準備 ----
function initViews3d() {
  if (V3.ok || !window.THREE) return V3.ok;
  try {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const light = new THREE.DirectionalLight(0xffffff, 0.6);
    scene.add(light, light.target);
    for (const v of VIEWS) {
      const box = $(v.id);
      const canvas = box.querySelector('canvas');
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setClearColor(0x535353);
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
      V3.views[v.id] = { renderer, camera, box, label: box.querySelector('.vlabel'), hint: box.querySelector('.vhint') };
    }
    Object.assign(V3, { scene, light, ok: true });
  } catch (e) {
    console.warn(e);
    for (const v of VIEWS) { const b = $(v.id).querySelector('.vhint'); if (b) b.textContent = 'この PC では 3D 表示（WebGL）が使えません'; }
  }
  return V3.ok;
}

// 押し出し1つの形（三角形と輪郭線）。形が変わったときだけ作り直す
function solidMesh(it) {
  const key = JSON.stringify(it.subs) + it.rule + it.x3d.z0 + ',' + it.x3d.h + JSON.stringify(it.plane || null);   // 置き場所（回したとき）も
  let m = V3.meshes.get(it.id);
  if (m && m.key === key) return m;
  if (m) { if (m.group.parent) m.group.parent.remove(m.group); disposeMesh(m); }   // 古いものを scene から外してから捨てる（残すと跡のように見える）
  const tris = solidTriangles(it);
  const pos = new Float32Array(tris.length * 9);
  let o = 0;
  // solidTriangles は [x, 奥行き(上が奥), 高さ] → three.js の [X, Y, Z] = [x, 高さ, 手前]
  for (const t of tris) for (const p of t) { pos[o++] = p[0]; pos[o++] = p[2]; pos[o++] = -p[1]; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0xd9d9d9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.id = it.id;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x222222 }));
  const group = new THREE.Group();
  group.add(mesh, edges);
  m = { key, group, mesh, edges };
  V3.meshes.set(it.id, m);
  return m;
}
function disposeMesh(m) {
  m.mesh.geometry.dispose(); m.mesh.material.dispose();
  m.edges.geometry.dispose(); m.edges.material.dispose();
}
// 押し出していないパス：その作業平面の上の線（plane がないものは床の上）
// パスごとに覚えておき、形・置き場所・色が変わったときだけ作り直す
function flatLine(it) {
  const col = it.stroke || it.fill || '#999999';
  const key = JSON.stringify(it.subs) + JSON.stringify(it.plane || null) + col + (FOLD_SHOW.has(it.id) ? '|' + it.fill : '');
  let m = V3.flatCache.get(it.id);
  if (m && m.key === key) return m;
  if (m) { if (m.group.parent) m.group.parent.remove(m.group); disposeGroup(m.group); }
  const g = new THREE.Group();
  const lift = flatOnFloor(it) ? 0.05 : 0;   // 床の線は、アートボードの板に埋もれないよう少しだけ上に
  for (const sb of it.subs) {
    if (sb.nodes.length < 2) continue;
    const pts = subWorldPts(it, sb).map((w) => toThree({ x: w.x, y: w.y, z: w.z + lift }));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(col) })));
  }
  // 折りたたみの面は、塗りのある板として見せる（クリックでも選べる）
  if (FOLD_SHOW.has(it.id) && it.fill) {
    const pl = planeOf(it), pos = [];
    for (const sh of profileShapes(it)) {
      const { pts, tris } = triangulateCap(sh.outer, sh.holes);
      const W = pts.map((p) => toThree(toWorld(pl, p)));
      for (const t of tris) for (const i of t) pos.push(W[i].x, W[i].y, W[i].z);
    }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color(it.fill), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      mesh.userData.id = it.id;
      g.add(mesh);
    }
  }
  g.userData.id = it.id;
  m = { key, group: g };
  V3.flatCache.set(it.id, m);
  return m;
}
function syncFlatLines(items) {
  if (!V3.flats) { V3.flats = new THREE.Group(); V3.scene.add(V3.flats); }
  const live = new Set(items.map((it) => it.id));
  for (const [id, m] of V3.flatCache) if (!live.has(id)) { if (m.group.parent) m.group.parent.remove(m.group); disposeGroup(m.group); V3.flatCache.delete(id); }
  for (const it of items) { const m = flatLine(it); if (m.group.parent !== V3.flats) V3.flats.add(m.group); }
}
function disposeGroup(g) {
  if (!g) return;
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}

// 見る向き（度）からカメラの向き
function viewDir(rot) {
  const y = (rot.yaw * Math.PI) / 180, p = (rot.pitch * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
}

function renderViews() {
  if (document.body.classList.contains('no3d')) return;
  if (!initViews3d()) return;
  const solids = visibleSolids();
  const flats = modelLeaves().filter((it) => !extrudeOf(it));   // 図面レイヤーのものは出さない
  const scene = V3.scene;
  // 立体：いま見えているものだけ置く（消えたものは片付ける）
  const live = new Set(solids.map((it) => it.id));
  for (const [id, m] of V3.meshes) if (!live.has(id)) { scene.remove(m.group); disposeMesh(m); V3.meshes.delete(id); }
  const selIds = new Set(selectedItems().map((it) => it.id));
  for (const it of solids) {
    const m = solidMesh(it);
    if (m.group.parent !== scene) scene.add(m.group);
    const sel = selIds.has(it.id);
    m.mesh.visible = !S.outline;
    m.mesh.material.color.set(it.fill || it.stroke || '#d9d9d9');   // 塗りがなければ線の色
    m.mesh.material.emissive.set(0x000000);   // 選んでいても色は変えない（選択は輪郭の青で分かる）
    m.edges.material.color.set(sel ? 0x4f80ff : S.outline ? 0x111111 : 0x222222);
  }
  // 床の線とアートボード
  syncFlatLines(flats);
  if (!V3.board || V3.board.userData.w !== doc.width || V3.board.userData.h !== doc.height) {
    if (V3.board) { scene.remove(V3.board); disposeGroup(V3.board); }
    const b = new THREE.Group();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(doc.width, doc.height), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(doc.width / 2, 0, doc.height / 2);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plane.geometry), new THREE.LineBasicMaterial({ color: 0x777777 }));
    edge.rotation.copy(plane.rotation); edge.position.copy(plane.position);
    b.add(plane, edge);
    b.userData = { w: doc.width, h: doc.height };
    V3.board = b;
    scene.add(b);
  }

  // 大きさ：アートボードと形が入るように（2枚とも同じ縮尺）
  const wr = worldRange(modelLeaves());   // 3D の範囲（正面・側面に置いたパスも入れる）
  const zMax = Math.max(X3D_DEFAULT_H, wr ? wr.z1 : 0), zMin = Math.min(0, wr ? wr.z0 : 0);
  const xr = [Math.min(0, wr ? wr.x0 : 0), Math.max(doc.width, wr ? wr.x1 : 0)];
  const yr = [Math.min(0, wr ? wr.y0 : 0), Math.max(doc.height, wr ? wr.y1 : 0)];
  let center = new THREE.Vector3((xr[0] + xr[1]) / 2, (zMin + zMax) / 2, (yr[0] + yr[1]) / 2);
  let scale = Infinity;
  for (const v of VIEWS) {
    const r = V3.views[v.id].box.getBoundingClientRect();
    const span = v.id === 'viewFront' ? xr[1] - xr[0] : yr[1] - yr[0];
    scale = Math.min(scale, (r.width - 48) / Math.max(1, span), (r.height - 56) / Math.max(1, zMax - zMin));
  }
  // ドラッグ中・ペンで描いている途中は、縮尺と中心を始めたときのままにする（描いた点が画面の上でずれないように）
  if (V3.hold && V3.hold.pen && !S.drawing && !S.input) V3.hold = null;
  if (V3.hold) { scale = V3.hold.scale; center = V3.hold.center.clone(); }
  else V3.fit = { scale, center: center.clone() };
  if (!(scale > 0) || !isFinite(scale)) return;
  scale *= V3.k;
  V3.scale = scale;

  for (const v of VIEWS) {
    const vw = V3.views[v.id];
    const r = vw.box.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    vw.renderer.setSize(r.width, r.height, false);
    const cam = vw.camera;
    const w = r.width / scale, h = r.height / scale;
    cam.left = -w / 2; cam.right = w / 2; cam.top = h / 2; cam.bottom = -h / 2;
    cam.updateProjectionMatrix();
    // 向き：真上・真下を向いたときに上下が決まるよう、up は少しだけ倒す
    const rot = V3.rot[v.id];
    const dir = viewDir(rot);
    cam.up.set(0, 1, 0);
    if (Math.abs(rot.pitch) > 89.9) cam.up.set(-Math.sin((rot.yaw * Math.PI) / 180), 0, -Math.cos((rot.yaw * Math.PI) / 180)).multiplyScalar(Math.sign(rot.pitch));
    // ずらし（px）は、画面の右・上の向きに動かす
    cam.position.copy(center).addScaledVector(dir, 5000);
    cam.lookAt(center);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const pan = V3.pan[v.id];
    // 上に名前の分だけ下げる（以前の見え方に合わせる）
    const off = right.clone().multiplyScalar(-pan.x / scale).add(up.clone().multiplyScalar((pan.y + 8) / scale));
    cam.position.add(off);
    cam.updateMatrixWorld();
    // 光：カメラの少し左上から（面の向きで明るさが変わるように）
    V3.light.position.copy(cam.position).addScaledVector(up, 3000).addScaledVector(right, -2000);
    V3.light.target.position.copy(center).add(off);
    V3.light.target.updateMatrixWorld();
    vw.renderer.render(scene, cam);
    drawViewBox(v.id);   // 選んでいるものの枠
    vw.label.textContent = v.name + (isRotated(v.id) ? '（回転中・ダブルクリックで戻る）' : '');
    vw.hint.textContent = !solids.length && !FOLD_SHOW.size && v.id === 'viewFront' ? 'パスを選んで、パネルの「3D 押し出し」で高さを入れると、ここに立体が出ます' : '';
  }
}

// クリックした位置の立体（いちばん手前）
function hitView(id, x, y) {
  const vw = V3.views[id];
  if (!vw) return null;
  const r = vw.box.getBoundingClientRect();
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), vw.camera);
  const meshes = [...V3.meshes.values()].map((m) => m.mesh);
  for (const m of V3.flatCache.values()) for (const o of m.group.children) if (o.isMesh) meshes.push(o);   // 折りたたみの面
  const hit = rc.intersectObjects(meshes, false)[0];
  return hit ? hit.object.userData.id : null;
}
function zoomView3d(id, x, y, nk) {
  nk = Math.max(0.1, Math.min(64, nk));
  const f = nk / V3.k;
  // マウスの位置が動かないように、その図のずらし量を直す（もう一方は真ん中を中心に）
  for (const v of VIEWS) {
    const r = $(v.id).getBoundingClientRect();
    const cx = v.id === id ? x : r.width / 2, cy = v.id === id ? y : r.height / 2;
    const pan = V3.pan[v.id];
    const mx = cx - r.width / 2 - pan.x, my = cy - r.height / 2 - pan.y;
    V3.pan[v.id] = P(pan.x - mx * (f - 1), pan.y - my * (f - 1));
  }
  V3.k = nk;
  renderViews();
}

// ---- 正面図・側面図での選択と変形（イラレの選択ツールと同じ考え方） ----
// 選んだものには、どの図にもバウンディングボックスが出る
//   枠の中をドラッグ：その図の平面で移動（正面図＝左右 x と高さ、側面図＝左右 奥行きと高さ）。Shift で真横・真上に
//   取っ手をドラッグ：伸び縮み（横＝幅・奥行き、縦＝高さ）。Alt で中心から、Shift で縦横比をそのまま（角の取っ手）
//   平らなパスの上の取っ手を引き上げると、押し出しになる
// 回して見ている図では、選ぶだけ
const SNAP_PX = 6;      // ほかの立体の高さに吸着する距離
const editable = (id) => !isRotated(id);
// 画面の右へ 1px 動いたときの、平面図での動き（正面図＝x の +、側面図＝y の −。手前が左）
const hAxis = (id) => (id === 'viewFront' ? 'x' : 'y');
const hSign = (id) => (id === 'viewFront' ? 1 : -1);

// 押し出していないパス（床の上の線）をクリックで拾う
function hitFlat(id, q) {
  const vw = V3.views[id], r = vw.box.getBoundingClientRect();
  let best = null, bd = 5;
  for (const it of modelLeaves()) {
    if (extrudeOf(it)) continue;
    for (const sb of it.subs) {
      if (sb.nodes.length < 2) continue;
      const pts = subWorldPts(it, sb).map((w) => {
        const pr = toThree(w).project(vw.camera);
        return P(((pr.x + 1) / 2) * r.width, ((1 - pr.y) / 2) * r.height);
      });
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], ab = vsub(b, a), L2 = ab.x * ab.x + ab.y * ab.y;
        const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y) / L2)) : 0;
        const d = vdist(q, vadd(a, vmul(ab, t)));
        if (d < bd) { bd = d; best = it.id; }
      }
    }
  }
  return best;
}
// 選んでいるものの範囲（平面図の bbox と高さ）
// 折りたたみの面を選んでいたら、つながっている面ぜんぶ（箱ごと）を対象にする
function expandFoldComps(items) {
  if (typeof FOLD_SHOW === 'undefined' || !items.some((it) => FOLD_SHOW.has(it.id))) return items;
  const out = new Set(items);
  for (const t of foldTrees()) if (t.comp.length > 1 && t.comp.some((f) => out.has(f))) t.comp.forEach((f) => out.add(f));
  return [...out];
}
function selRange() {
  const items = expandFoldComps(selectedItems());
  if (!items.length) return null;
  const wr = worldRange(items);
  if (!wr) return null;
  const bb = { x: wr.x0, y: wr.y0, w: wr.x1 - wr.x0, h: wr.y1 - wr.y0 };
  // planar：全部が床に平行なパス（いまの押し出しの編集ができるのはこのときだけ）
  return { items, bb, zMin: wr.z0, zMax: wr.z1, planar: items.every(flatOnFloor) };
}
// その図の画面での、選んでいるものの枠（px）
function viewBox(id) {
  const sr = selRange();
  if (!sr) return null;
  const vw = V3.views[id], r = vw.box.getBoundingClientRect();
  const { bb, zMin, zMax } = sr;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const x of [bb.x, bb.x + bb.w]) for (const y of [bb.y, bb.y + bb.h]) for (const z of [zMin, zMax]) {
    const pr = new THREE.Vector3(x, z, y).project(vw.camera);
    const sx = ((pr.x + 1) / 2) * r.width, sy = ((1 - pr.y) / 2) * r.height;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  // ハンドル（伸び縮み・押し出し）が使えるのは、床に平らなものを真横から見ているときだけ
  const handles = sr.planar && editable(id);
  // 押し出せる面（閉じたパスで、まだ押し出していない平らなもの）を選んでいるか
  const arrow = handles && (V3.arrowActive === id || y1 - y0 < 1) && sr.items.some((it) => !extrudeOf(it) && it.subs.some((sb) => sb.closed && sb.nodes.length >= 3));
  return { x0, x1, y0, y1, ...sr, handles, arrow };
}
const EX_ARROW = 30;   // 押し出しの矢印の長さ（px）
const VB_HANDLES = (b) => {
  const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
  // 平らなもの（高さ 0）は上の取っ手だけ（引き上げると押し出し）
  const flat = b.y1 - b.y0 < 1;
  // 押し出せる平らな面：上の取っ手は、上向きの矢印（→）の先。矢印を引くと押し出し
  const hs = { n: [mx, b.arrow ? b.y0 - EX_ARROW : b.y0], e: [b.x1, my], w: [b.x0, my] };
  if (!flat) Object.assign(hs, { nw: [b.x0, b.y0], ne: [b.x1, b.y0], sw: [b.x0, b.y1], se: [b.x1, b.y1], s: [mx, b.y1] });
  return hs;
};
// 枠と取っ手を描く（canvas の上の SVG）
// 回転ハンドル（つまみ）の絵：折り線からつまみへの細い線と丸。マウスが乗ると緑、ドラッグ中は青
function foldHandlesSvg(oh, sc, hover, active) {
  const m = sc(toWorld(planeOf(oh.A), vlerp(oh.e.a, oh.e.b, 0.5)));
  let h = '';
  for (const hd of hingeHandles(oh)) {
    const s = sc(hd.w), on = hover === hd.face.id || active === hd.face.id, col = on ? COL_ROT_HOT : COL_ROT;   // 回す＝オレンジ（乗せる・引いている間は濃く大きく）
    h += `<line x1="${m.x}" y1="${m.y}" x2="${s.x}" y2="${s.y}" stroke="${col}" stroke-width="1.5" stroke-dasharray="3 2"/>`;
    h += `<circle cx="${s.x}" cy="${s.y}" r="${on ? 8 : 6}" fill="${col}" stroke="#fff" stroke-width="2"/>`;
  }
  return h;
}
// 折り線（オレンジ）と、つかむ線（緑。ドラッグ中は青）
function viewFoldSvg(id) {
  let h = '';
  const sc = (w) => localToViewW(id, w);
  const oh = S.foldHinge && findHinge(S.foldHinge);
  if (oh) {
    const [a, b] = hingeWorld(oh).map(sc);
    h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ff8c1a" stroke-width="3" stroke-linecap="round"/>`;
    h += foldHandlesSvg(oh, sc, V3.handleHover, V3.handleActive);
  }
  const g = V3.grabLine, f = g && findItem(g.face);
  // 動く側の面を薄く色づけ（ドラッグ前に、どこが動くか分かるように）
  if (oh && f) {
    const side = foldSide(oh, f.item);
    if (side) for (const id of side) {
      const ff = findItem(id); if (!ff) continue;
      const it2 = ff.item, pl2 = planeOf(it2);
      const pts2 = polyFromSub(it2.subs[0]).map((p) => sc(toWorld(pl2, p)));
      h += `<polygon points="${pts2.map((p) => p.x + ',' + p.y).join(' ')}" fill="${COL_MOVE}" fill-opacity="${g.active ? 0.3 : 0.18}" stroke="none"/>`;
    }
  }
  if (oh && f) {
    const it = f.item, n = it.subs[0].nodes, a = n[g.seg], b = n[(g.seg + 1) % n.length], pl = planeOf(it);
    if (a && b) {
      const pts = [];
      for (let k = 0; k <= 12; k++) pts.push(sc(toWorld(pl, cubicAt(a, a.hout || a, b.hin || b, b, k / 12))));
      h += `<polyline points="${pts.map((p) => p.x + ',' + p.y).join(' ')}" fill="none" stroke="${COL_MOVE}" stroke-width="${g.active ? 5 : 3}" stroke-linecap="round"/>`;
    }
  }
  return h;
}
function drawViewBox(id) {
  const svg = V3.views[id].box.querySelector('.vover');
  const nodes = viewNodesSvg(id) + viewFoldSvg(id);
  const b = !NODE_TOOLS.has(displayTool()) && !S.drawing ? viewBox(id) : null;   // ペンなどでは枠を出さない（イラレと同じ）
  if (!b || S.hideEdges) { svg.innerHTML = nodes; return; }
  const col = findItem(b.items[0].id).layer.color;
  let h = nodes + `<rect x="${b.x0}" y="${b.y0}" width="${Math.max(0, b.x1 - b.x0)}" height="${Math.max(0, b.y1 - b.y0)}" fill="none" stroke="${col}" stroke-width="1"/>`;
  if (b.handles) for (const [k, [x, y]] of Object.entries(VB_HANDLES(b))) {
    if (k === 'n' && b.arrow) {
      // 押し出しの向きの矢印：面から上へ。先の三角をつかんで引き上げる
      const hot = V3.arrowHover === id || V3.arrowActive === id;
      const c = COL_MOVE, y0 = b.y0, wdt = V3.arrowActive === id ? 3 : hot ? 2.5 : 2;   // 押し出し＝動かす＝緑（引いている間も緑のまま、太く）
      h += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y + 6}" stroke="${c}" stroke-width="${wdt}"/>`
        + `<path d="M${x} ${y - (hot ? 5 : 3)}L${x - (hot ? 9 : 7)} ${y + 8}L${x + (hot ? 9 : 7)} ${y + 8}Z" fill="${c}" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>`;
      continue;
    }
    h += `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="#fff" stroke="${col}" stroke-width="1"/>`;
  }
  svg.innerHTML = h;
}
// この図の向きの平面か（正面図なら正面の板、側面図なら側面の板。奥行きはどこでもよい）
function planeFitsView(id, pl) {
  if (!pl || id === 'viewPlan') return false;
  const base = planeForView(id, 0);
  return v3len(v3sub(pl.u, base.u)) < 1e-9 && v3len(v3sub(pl.v, base.v)) < 1e-9;
}
// 図の画面の点 → 作業平面の 2D の点
function viewToLocal(id, q, pl) {
  const vw = V3.views[id], r = vw.box.getBoundingClientRect();
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2((q.x / r.width) * 2 - 1, -(q.y / r.height) * 2 + 1), vw.camera);
  return rayToLocal(pl, rc.ray) || P(0, 0);
}
// アプリの 3D の点 → 図の画面の点
function localToViewW(id, w) {
  const vw = V3.views[id], r = vw.box.getBoundingClientRect();
  const pr = toThree(w).project(vw.camera);
  return P(((pr.x + 1) / 2) * r.width, ((1 - pr.y) / 2) * r.height);
}
// 作業平面の 2D の点 → 図の画面の点
function localToView(id, pl, p) {
  const vw = V3.views[id], r = vw.box.getBoundingClientRect();
  const pr = toThree(toWorld(pl, p)).project(vw.camera);
  return P(((pr.x + 1) / 2) * r.width, ((1 - pr.y) / 2) * r.height);
}
// 選んでいるパスのアンカーと方向線（その図の向きの平面にあるものだけ）。平面図の drawOverlay と同じ見え方
function viewNodesSvg(id) {
  const hits = (V3.handleHits[id] = []);
  if (!editable(id) || S.hideEdges) return '';
  const nodeTool = NODE_TOOLS.has(displayTool());
  let h = '';
  for (const it of selectedItems()) {
    const pl = planeOf(it);
    if (!planeFitsView(id, pl)) continue;
    const col = findItem(it.id).layer.color, set = S.sel.get(it.id);
    const sp = (p) => localToView(id, pl, p);
    if (nodeTool) {
      it.subs.forEach((sb, s) => {
        const n = sb.nodes, L = n.length, show = new Set();
        for (let i = 0; i < L; i++) {
          if (!set.has(key(s, i))) continue;
          show.add(i + '|hin'); show.add(i + '|hout');
          if (i > 0 || sb.closed) show.add((i - 1 + L) % L + '|hout');
          if (i < L - 1 || sb.closed) show.add((i + 1) % L + '|hin');
        }
        for (const k of show) {
          const [is, w] = k.split('|');
          const nd = n[+is], hp = nd && nd[w];
          if (!hp) continue;
          const a = sp(nd), b = sp(hp);
          h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${col}" stroke-width="1"/>`;
          h += `<circle cx="${b.x}" cy="${b.y}" r="3.5" fill="${col}" stroke="#fff" stroke-width="1"/>`;
          hits.push({ id: it.id, s, i: +is, which: w, x: b.x, y: b.y });
        }
      });
    }
    it.subs.forEach((sb, s) => sb.nodes.forEach((nd, i) => {
      const a = sp(nd), on = !nodeTool || set.has(key(s, i));
      h += `<rect x="${a.x - 3}" y="${a.y - 3}" width="6" height="6" fill="${on ? col : '#fff'}" stroke="${col}" stroke-width="1"/>`;
    }));
  }
  return h;
}

// ---- 正面図・側面図のペン（ペンツールそのものは平面図と同じ。作業平面の 2D の座標を渡すだけ） ----
// 描く平面：描いている途中のパス → 選んでいるパス → この図で前に使った平面 → アートボードの真ん中の奥行き
function viewPenPlane(id) {
  const f = S.drawing && findItem(S.drawing.id);
  if (f && planeFitsView(id, f.item.plane)) return f.item.plane;
  const sel = selectedItems().find((it) => planeFitsView(id, it.plane));
  if (sel) return sel.plane;
  if (V3.penPlane[id]) return V3.penPlane[id];
  return planeForView(id, id === 'viewFront' ? doc.height / 2 : doc.width / 2);
}
function viewPenDown(id, e, q) {
  const pl = viewPenPlane(id);
  const f = S.drawing && findItem(S.drawing.id);
  if (f && !sameFrame(planeOf(f.item), pl)) endDrawing();   // 別の平面で描いていたものは、そこで終える
  S.input = { view: id, plane: pl, scale: V3.scale, handleHits: V3.handleHits[id] || [] };
  V3.penPlane[id] = clone(pl);
  if (!V3.hold && V3.fit) V3.hold = { ...V3.fit, pen: true };
  S.keys.ctrl = e.ctrlKey || e.metaKey; S.keys.alt = e.altKey; S.keys.shift = e.shiftKey;
  S.activeTool = 'pen'; S.selGuide = null; S.segSel = null; S.hover = null;
  Tools.pen.down(e, viewToLocal(id, q, pl), q);
  if (!S.drag) endViewPen(e, q);   // クリックだけで終わる操作（アンカーの削除・連結など）
  else { drawOverlay(); updateUI(); }
}
function viewPenMove(e, q) {
  if (!S.drag || !S.input) return;
  S.keys.alt = e.altKey; S.keys.shift = e.shiftKey;
  S.input.scale = V3.scale;
  Tools.pen.move(e, viewToLocal(S.input.view, q, S.input.plane), q);
  drawOverlay();
}
function endViewPen(e, q) {
  if (S.drag && S.input) Tools.pen.up(e, viewToLocal(S.input.view, q, S.input.plane), q);
  S.drag = null; S.activeTool = null; S.snapViz = null; S.input = null;
  afterSelect(); drawOverlay(); updateUI(); updateCursor();
  renderViews();
}

function hitViewHandle(id, q) {
  const b = viewBox(id);
  if (!b || !b.handles) return null;
  let best = null, bd = 6;
  for (const [k, [x, y]] of Object.entries(VB_HANDLES(b))) {
    const d = Math.hypot(x - q.x, y - q.y) - (k === 'n' && b.arrow ? 4 : 0);   // 矢印の先は少し広くつかめる
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
const insideViewBox = (id, q) => { const b = viewBox(id); return !!b && q.x >= b.x0 - 3 && q.x <= b.x1 + 3 && q.y >= b.y0 - 3 && q.y <= b.y1 + 3; };

// ---- 正面図・側面図で回す（イラレのバウンディングボックスと同じ：角の少し外をドラッグ） ----
// 正面図は奥行きの軸、側面図は左右の軸のまわりに回る。中心は枠の真ん中。Shift で 45° ずつ
// 回すのは、パスを置く平面（plane の o・u・v）だけ。2D の形と押し出しの高さはそのまま
// 折りたたみの面（折った箱）は、まだ回さない
const viewRight = (id) => (id === 'viewFront' ? [1, 0, 0] : [0, -1, 0]);   // 画面の右が 3D のどの向きか（上は z）
const canRotate = (items) => items.length && !items.some((it) => it.fold || (typeof FOLD_SHOW !== 'undefined' && FOLD_SHOW.has(it.id)));
function hitViewRotate(id, q) {
  const b = viewBox(id);
  if (!b || !editable(id) || !canRotate(b.items)) return null;
  if (q.x > b.x0 && q.x < b.x1 && q.y > b.y0 && q.y < b.y1) return null;
  const cs = { nw: [b.x0, b.y0], ne: [b.x1, b.y0], se: [b.x1, b.y1], sw: [b.x0, b.y1] };
  for (const [k, [x, y]] of Object.entries(cs)) if (Math.hypot(x - q.x, y - q.y) <= 18) return k;
  return null;
}
// 3D の向き w を、画面の右 H と上 z の面の中で φ（反時計回り、ラジアン）回す
function rotInView(w, H, ph) {
  const h = v3dot(w, H), z = w[2];
  const rest = v3sub(w, v3add(v3mul(H, h), [0, 0, z]));
  const c = Math.cos(ph), sn = Math.sin(ph);
  return v3add(rest, v3add(v3mul(H, h * c - z * sn), [0, 0, h * sn + z * c]));
}
// 0・±1 にごく近い値はそろえる（90° ずつ回して元に戻したとき、ぴったり床に戻るように）
const tidy = (a) => a.map((x) => (Math.abs(x) < 1e-12 ? 0 : Math.abs(x - 1) < 1e-12 ? 1 : Math.abs(x + 1) < 1e-12 ? -1 : x));
// パス1つを、平面の形（plane と、法線の向きの z0）にする。床の押し出しは z0 が床からの高さなので、それを平面の高さに移す
function toPlaneForm(it) {
  if (!flatOnFloor(it)) return;
  const pl = planeOf(it);
  const o = [pl.o[0], pl.o[1], pl.o[2]];
  if (it.x3d) { o[2] = it.x3d.z0; it.x3d = { ...it.x3d, z0: 0 }; }
  it.plane = { o, u: [...pl.u], v: [...pl.v] };
}
// 回したあと、床に平行な向きにぴったり戻っていたら、いつもの床のパスの形に戻す
function fromPlaneForm(it) {
  const pl = it.plane;
  if (!pl) return;
  const top = v3len(v3sub(pl.u, [1, 0, 0])) < 1e-9 && v3len(v3sub(pl.v, [0, 1, 0])) < 1e-9;
  if (!top) return;
  const [ox, oy, oz] = pl.o;
  if (ox || oy) mapItem(it, (p) => P(p.x + ox, p.y + oy));
  if (it.x3d) { it.x3d = { ...it.x3d, z0: oz + it.x3d.z0 }; delete it.plane; }
  else if (Math.abs(oz) > 1e-9) it.plane = planeTop(oz);
  else delete it.plane;
}
// 選んだもの（items）を、中心 c のまわりに、その図の画面で φ 回す
function rotateItems3d(items, id, c, ph) {
  const H = viewRight(id);
  for (const it of items) {
    toPlaneForm(it);
    const pl = it.plane;
    const o = v3add(c, rotInView(v3sub(pl.o, c), H, ph));
    let u = rotInView(pl.u, H, ph), v = rotInView(pl.v, H, ph);
    // u・v を長さ 1 で直角にそろえ直す
    u = v3mul(u, 1 / v3len(u));
    v = v3sub(v, v3mul(u, v3dot(v, u))); v = v3mul(v, 1 / v3len(v));
    it.plane = { o: tidy(o.map((x) => Math.round(x * 1e9) / 1e9)), u: tidy(u), v: tidy(v) };
    fromPlaneForm(it);
  }
}
function startViewRotate(id, corner, q) {
  const sr = selRange();
  if (!sr || !canRotate(sr.items)) return null;
  if (V3.fit) V3.hold = V3.fit;
  const c = [sr.bb.x + sr.bb.w / 2, sr.bb.y + sr.bb.h / 2, (sr.zMin + sr.zMax) / 2];
  const b = viewBox(id);
  return { type: 'vxf', kind: 'rotate', view: id, corner, s: q, sr, moved: false, c, sc: P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2),
    snap: new Map(sr.items.map((it) => [it.id, clone({ subs: it.subs, plane: it.plane || null, fold: it.fold || null, x3d: it.x3d || null })])) };
}
function rotateViewXf(d, q, e) {
  moveViewXf3dReset(d);   // ドラッグを始めたときの形から毎回計算する（回すたびに誤差がたまらない）
  // 画面は y が下向きなので、上向きにして角度をとる（反時計回りが +）
  const a0 = Math.atan2(-(d.s.y - d.sc.y), d.s.x - d.sc.x), a1 = Math.atan2(-(q.y - d.sc.y), q.x - d.sc.x);
  let deg = ((a1 - a0) * 180) / Math.PI;
  deg = ((deg + 540) % 360) - 180;
  if (e.shiftKey) deg = Math.round(deg / 45) * 45;
  rotateItems3d(d.sr.items, d.view, d.c, (deg * Math.PI) / 180);
  d.tip = `回転 ${r2(deg)}°`;
  render(); updateUI();
}

// 吸着する高さ：ほかの立体の上と下、床（0）
function snapHeights(exclude) {
  const hs = [0];
  for (const it of visibleSolids()) if (!exclude.has(it.id) && flatOnFloor(it)) hs.push(it.x3d.z0, it.x3d.z0 + it.x3d.h);
  return hs;
}
function snapZ(d, edges, dz, e) {
  d.snapZ = null;
  if (e.ctrlKey) return dz;   // Ctrl で吸着しない
  let best = null, bd = SNAP_PX / V3.scale;
  for (const base of edges) for (const z of d.snaps) { const diff = z - (base + dz); if (Math.abs(diff) < bd) { bd = Math.abs(diff); best = { diff, z }; } }
  if (best) { d.snapZ = best.z; return dz + best.diff; }
  return dz;
}
function startViewXf(id, kind, handle, q) {
  const sr = selRange();
  if (!sr) return null;
  if (V3.fit) V3.hold = V3.fit;   // ドラッグが終わるまで画面の縮尺を変えない
  // 折った箱・正面や側面に描いたパスを含むとき、または回して見ているときは、3D でそのまま平行移動
  if (kind === 'move' && (!sr.planar || !editable(id))) {
    const items = sr.items;
    return { type: 'vxf', kind: 'move3d', view: id, s: q, sr, moved: false, rot: !editable(id), zRef: sr.zMin,
      snap: new Map(items.map((it) => [it.id, clone({ subs: it.subs, plane: it.plane || null, fold: it.fold || null, x3d: it.x3d || null })])) };
  }
  if (!sr.planar || !editable(id)) return null;
  const vb = viewBox(id);
  V3.arrowActive = handle === 'n' && vb && vb.arrow ? id : null;   // 矢印を引いている間は、立体の上に矢印を出したまま
  return {
    type: 'vxf', kind, handle, view: id, s: q, sr, moved: false,
    subs: new Map(sr.items.map((it) => [it.id, clone(it.subs)])),   // 箱ごと動かすこともあるので、選んだものだけでなく対象全部
    x3d: new Map(sr.items.map((it) => [it.id, it.x3d ? { ...it.x3d } : null])),
    snaps: snapHeights(new Set(sr.items.map((it) => it.id))),
  };
}
// 図の画面の点 → 高さ z の水平面の上の 3D の点（回して見ている図で、床と平行に動かすため）
function viewToFloor(id, q, z) {
  const vw = V3.views[id], r = vw.box.getBoundingClientRect();
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2((q.x / r.width) * 2 - 1, -(q.y / r.height) * 2 + 1), vw.camera);
  const o = rc.ray.origin, dir = rc.ray.direction;   // three.js：Y が高さ
  if (Math.abs(dir.y) < 1e-6) return null;
  const t = (z - o.y) / dir.y;
  return { x: o.x + dir.x * t, y: o.z + dir.z * t, z };
}
// 3D でそのまま平行移動（d = [dx, dy, dz]、アプリの座標）
//   折った箱：土台の置き方をずらす（展開図はそのまま）／正面・側面に描いたパス：作業平面をずらす
//   床のパス・押し出し：形を横にずらし、押し出しは高さもずらす
function translateWorld(items, d) {
  const done = new Set();
  for (const t of foldTrees()) {
    if (t.comp.length < 2 || !t.comp.some((f) => items.includes(f))) continue;
    const r = t.root, b = (r.fold && r.fold.base) || PLANE_TOP;
    r.fold = { ...(r.fold || {}), base: { o: [b.o[0] + d[0], b.o[1] + d[1], b.o[2] + d[2]], u: [...b.u], v: [...b.v] } };
    t.comp.forEach((f) => done.add(f));
  }
  for (const it of items) {
    if (done.has(it)) continue;
    if (it.plane && !it.fold) it.plane = { ...it.plane, o: it.plane.o.map((v, i) => v + d[i]) };
    else {
      mapItem(it, (p) => P(p.x + d[0], p.y + d[1]));
      if (it.x3d) it.x3d = { ...it.x3d, z0: it.x3d.z0 + d[2] };
    }
  }
}
function moveViewXf3dReset(d) {
  for (const [id, o] of d.snap) {
    const f = findItem(id); if (!f) continue;
    const it = f.item; it.subs = clone(o.subs);
    for (const k of ['plane', 'fold', 'x3d']) { if (o[k]) it[k] = clone(o[k]); else delete it[k]; }
  }
}
function moveViewXf3d(d, q, e) {
  // 元に戻してから動かす
  for (const [id, o] of d.snap) {
    const f = findItem(id); if (!f) continue;
    const it = f.item; it.subs = clone(o.subs);
    for (const k of ['plane', 'fold', 'x3d']) { if (o[k]) it[k] = clone(o[k]); else delete it[k]; }
  }
  let w;
  if (d.rot) {
    // 回して見ている図：選んだものの底の高さの水平面の上で動かす（上下は真横から見た図で）
    const a = viewToFloor(d.view, d.s, d.zRef), b = viewToFloor(d.view, q, d.zRef);
    if (!a || !b) return;
    w = [b.x - a.x, b.y - a.y, 0];
    if (e.shiftKey) { if (Math.abs(w[0]) > Math.abs(w[1])) w[1] = 0; else w[0] = 0; }
  } else {
    let dx = q.x - d.s.x, dy = q.y - d.s.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const sc = V3.scale, h = (dx / sc) * hSign(d.view), dz = -dy / sc;
    w = hAxis(d.view) === 'x' ? [h, 0, dz] : [0, h, dz];
  }
  translateWorld(d.sr.items, w);
  d.tip = `横 ${r2(w[0])}　奥行き ${r2(w[1])}　高さ ${r2(w[2])} mm`;
  render(); updateUI();
}
function moveViewXf(d, q, e) {
  let dx = q.x - d.s.x, dy = q.y - d.s.y;
  if (!d.moved && Math.hypot(dx, dy) < 3) return;
  d.moved = true;
  if (d.kind === 'move3d') { moveViewXf3d(d, q, e); return; }
  if (d.kind === 'rotate') { rotateViewXf(d, q, e); return; }
  const sc = V3.scale, ax = hAxis(d.view), sg = hSign(d.view);
  const { bb, zMin, zMax, items } = d.sr;
  restoreFrom(d.subs);
  for (const it of items) { const o = d.x3d.get(it.id); if (o) it.x3d = { ...o }; else delete it.x3d; }
  let tip = '';
  if (d.kind === 'move') {
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const du = (dx / sc) * sg;                 // 平面図での動き（その図の横の向き）
    let dz = -dy / sc;
    const solids = items.filter((it) => d.x3d.get(it.id));
    if (solids.length && dz) dz = snapZ(d, [zMin, zMax], dz, e);
    else dz = solids.length ? dz : 0;
    const f = ax === 'x' ? (p) => P(p.x + du, p.y) : (p) => P(p.x, p.y + du);
    items.forEach((it) => mapItem(it, f));
    for (const it of solids) it.x3d.z0 += dz;
    tip = `${ax === 'x' ? '横' : '奥行き'} ${r2(du)} mm　高さ ${r2(dz)} mm`;
  } else {
    const h = d.handle;
    const hasE = h.includes('e'), hasW = h.includes('w'), hasN = h.includes('n'), hasS = h.includes('s');
    // 横：画面の左右の端を、平面図の座標にする
    const lo = ax === 'x' ? bb.x : bb.y, hi = ax === 'x' ? bb.x + bb.w : bb.y + bb.h, span = hi - lo;
    // 画面の右の端が平面図のどちらか（側面図は手前＝ y の大きい方が左）
    const rightV = sg > 0 ? hi : lo, leftV = sg > 0 ? lo : hi;
    let kx = 1, aU = null;
    if ((hasE || hasW) && span > 1e-9) {
      const move = (dx / sc) * sg;   // 動かす端の、平面図での動き
      if (hasE) { aU = e.altKey ? (lo + hi) / 2 : leftV; const edge = rightV + move; kx = (edge - aU) / (rightV - aU); }
      else { aU = e.altKey ? (lo + hi) / 2 : rightV; const edge = leftV + move; kx = (edge - aU) / (leftV - aU); }
    }
    // 縦：高さ
    let kz = 1, aZ = null, create = false, dzc = 0;
    const zs = zMax - zMin;
    if (hasN || hasS) {
      let dz = -dy / sc;
      if (zs < 1e-6) {
        // 平らなもの：上の取っ手を引き上げると押し出し
        if (hasN) { dz = snapZ(d, [zMax], dz, e); create = true; dzc = Math.max(0.1, dz); }
      } else if (hasN) {
        aZ = e.altKey ? (zMin + zMax) / 2 : zMin;
        dz = snapZ(d, [zMax], dz, e);
        kz = (zMax + dz - aZ) / (zMax - aZ);
      } else {
        aZ = e.altKey ? (zMin + zMax) / 2 : zMax;
        dz = snapZ(d, [zMin], dz, e);
        kz = (zMin + dz - aZ) / (zMin - aZ);
      }
    }
    // Shift：角の取っ手は縦横の比をそのまま
    if (e.shiftKey && aU != null && aZ != null) { const k = Math.max(Math.abs(kx), Math.abs(kz)); kx = k; kz = k; }
    kx = Math.max(0.01, kx); kz = Math.max(0.001, kz);
    if (aU != null) {
      const f = ax === 'x' ? (p) => P(aU + (p.x - aU) * kx, p.y) : (p) => P(p.x, aU + (p.y - aU) * kx);
      items.forEach((it) => mapItem(it, f));
    }
    if (aZ != null) {
      for (const it of items) {
        if (!it.x3d) continue;
        const z0 = aZ + (it.x3d.z0 - aZ) * kz, z1 = aZ + (it.x3d.z0 + it.x3d.h - aZ) * kz;
        it.x3d = { ...it.x3d, z0: Math.min(z0, z1), h: Math.max(0.1, Math.abs(z1 - z0)) };
      }
    }
    if (create) for (const it of items) if (it.subs.some((sb) => sb.closed && sb.nodes.length >= 2)) it.x3d = { ...(it.x3d || {}), z0: zMin, h: dzc };
    const nr = selRange();
    const w = ax === 'x' ? nr.bb.w : nr.bb.h;
    tip = `${ax === 'x' ? '幅' : '奥行き'} ${r2(w)} mm　高さ ${r2(nr.zMax - nr.zMin)} mm`;
  }
  d.tip = tip + (d.snapZ != null ? '　（吸着）' : '');
  render(); updateUI();
}
function endViewXf(d) {
  V3.hold = null;
  if (!d.moved) { renderViews(); return; }
  const x = selectedItems().find((it) => it.x3d);
  if (x) S.lastExH = x.x3d.h;
  render(); commit();
}

// ---- 正面図・側面図のマウス ----
// Space＋ドラッグ（中ボタンでも）：手のひら
// Shift＋Space＋ドラッグ：3D 手のひら（回す）。ドラッグ中に Shift を押していると 15° ずつ
// ダブルクリック：回したのを元に戻す／Alt＋ホイール：拡大・縮小／ホイール：上下（Ctrl・Shift で左右）
// クリック：立体・線を選ぶ（Shift で追加・外す）。何もないところをクリックで選択解除
for (const v of VIEWS) {
  const el = $(v.id);
  const local = (e) => { const r = el.getBoundingClientRect(); return P(e.clientX - r.left, e.clientY - r.top); };
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    closeMenus();
    const q = local(e);
    const grab = () => { try { el.setPointerCapture(e.pointerId); } catch (_) { /* つかめなくても動かす */ } };
    // 虫眼鏡：Ctrl+Space（Alt も押すと縮小）、またはズームツール（Z）。クリックした所を中心に
    const zoomTool = e.button === 0 && ((S.spaceDown && (e.ctrlKey || e.metaKey)) || (!S.spaceDown && S.tool === 'zoom'));
    if (zoomTool) {
      e.preventDefault();
      zoomView3d(v.id, q.x, q.y, V3.k * (e.altKey ? 0.5 : 2));
      return;
    }
    if (e.button === 0 && S.spaceDown && e.shiftKey) {
      e.preventDefault(); grab();
      drag = { type: 'orbit', s: q, o: { ...V3.rot[v.id] } };
      updateCursor();
      return;
    }
    if (e.button === 1 || (e.button === 0 && (S.spaceDown || S.tool === 'hand'))) {
      e.preventDefault(); grab();
      drag = { type: 'pan', s: q, o: P(V3.pan[v.id].x, V3.pan[v.id].y) };
      updateCursor();
      return;
    }
    if (e.button !== 0) return;
    // ペン：その図の向きの板の上に描く（回して見ているときは描けない）
    if (effectiveTool(e) === 'pen') {
      if (!editable(v.id)) { toast('回して見ている図では描けません（ダブルクリックで戻す）'); return; }
      grab(); drag = { type: 'pen' };
      viewPenDown(v.id, e, q);
      if (!S.drag) drag = null;
      return;
    }
    if (S.drawing) endDrawing();
    // 取っ手：伸び縮み
    const hd = !e.shiftKey && hitViewHandle(v.id, q);
    if (hd) { grab(); drag = startViewXf(v.id, 'scale', hd, q); return; }
    // 枠の角の少し外：回す
    const rz = !e.shiftKey && SEL_TOOLS.has(effectiveTool(e)) && hitViewRotate(v.id, q);
    if (rz) { grab(); drag = startViewRotate(v.id, rz, q); return; }
    // 折りたたみ：オレンジの折り線があるときは、ほかの線（緑）をつかんで折る
    const toScr3 = (w) => localToViewW(v.id, w);
    const oh = S.foldHinge && findHinge(S.foldHinge);
    // 回転ハンドル（つまみ）：つかんだ側の面が起きる
    const fh = oh && !e.shiftKey && hitFoldHandle(oh, toScr3, q);
    if (fh) {
      const undo = snapshotFolds();
      const d = startHingeDrag(oh, fh.face);
      if (!d) { toast('面のつながりが輪になっているので、ここでは折れません'); return; }
      applyFolds();
      grab();
      if (V3.fit) V3.hold = V3.fit;
      drag = { type: 'fold', d, grab2: fh.p2, s: q, moved: false, undo };
      V3.handleActive = fh.face.id;
      renderViews();
      return;
    }
    if (oh && !e.shiftKey) {
      const gl = hitGrabLine(oh, toScr3, q);
      if (gl) {
        const undo = snapshotFolds();
        const d = startHingeDrag(oh, gl.face);
        if (!d) { toast('面のつながりが輪になっているので、この線では折れません'); return; }
        applyFolds();
        grab();
        if (V3.fit) V3.hold = V3.fit;
        drag = { type: 'fold', d, grab2: gl.mid, gl, s: q, moved: false, undo };
        V3.grabLine = { face: gl.face.id, seg: gl.seg, active: true };
        renderViews();
        return;
      }
    }
    // 折り線をクリック → オレンジ（もう一度クリックで外す）
    // 折った箱は辺のほとんどが折り線なので、折り線の上でも「ドラッグなら移動」にする（クリックだけならオレンジ）
    const hh = !e.shiftKey && hitHinge(toScr3, q);
    // 立体・線をクリック
    const id = hitView(v.id, q.x, q.y) || hitFlat(v.id, q);
    const f = id && findItem(id);
    const pickFace = () => {
      const target = topOf(f.item);
      const ls = leaves([target]);
      const wasSel = ls.every((it) => S.sel.has(it.id) && isFullySel(it));
      if (e.shiftKey && wasSel) { ls.forEach((it) => S.sel.delete(it.id)); afterSelect(); render(); updateUI(); return false; }
      if (e.shiftKey || !wasSel) selectNode(target, e.shiftKey);
      afterSelect(); render(); updateUI();
      return true;
    };
    if (hh) { grab(); drag = { type: 'hingeOrMove', hh, pickFace: f ? pickFace : null, s: q }; return; }
    if (f) {
      if (pickFace()) { grab(); drag = startViewXf(v.id, 'move', null, q); }   // 回して見ている図でも、床と平行に動かせる
      return;
    }
    // 枠の中（何もないところでも）：移動
    if (!e.shiftKey && insideViewBox(v.id, q)) { grab(); drag = startViewXf(v.id, 'move', null, q); return; }
    if (!e.shiftKey) { S.sel.clear(); S.foldHinge = null; }
    afterSelect(); render(); updateUI();
  });
  el.addEventListener('pointermove', (e) => {
    const q = local(e);
    if (!drag) { hoverView(v.id, q); return; }
    if (drag.type === 'pen') { viewPenMove(e, q); return; }
    // 折り線の上から動かし始めた：面を選んで、移動に切り替える
    if (drag.type === 'hingeOrMove') {
      if (Math.hypot(q.x - drag.s.x, q.y - drag.s.y) < 3) return;
      const s0 = drag.s;
      drag = drag.pickFace && drag.pickFace() ? startViewXf(v.id, 'move', null, s0) : (insideViewBox(v.id, s0) ? startViewXf(v.id, 'move', null, s0) : null);
      if (drag) { moveViewXf(drag, q, e); showTip(v.id, q, drag.moved ? drag.tip : ''); }
      return;
    }
    if (drag.type === 'fold') {
      if (!drag.moved && Math.hypot(q.x - drag.s.x, q.y - drag.s.y) < 3) return;
      drag.moved = true;
      const raw = hingeAngleToward(drag.d, drag.grab2, (w) => localToViewW(v.id, w), q);
      const deg = snapFoldDeg(raw, e.shiftKey);
      setHingeDeg(drag.d.h.A, drag.d.h.B, deg);
      render(); updateUI();
      showTip(v.id, q, `角度 ${r2(deg)}°`);
      return;
    }
    if (drag.type === 'vxf') { moveViewXf(drag, q, e); showTip(v.id, q, drag.moved ? drag.tip : ''); return; }
    if (drag.type === 'pan') V3.pan[v.id] = P(drag.o.x + q.x - drag.s.x, drag.o.y + q.y - drag.s.y);
    else {
      // 横に動かすと横に回る、縦に動かすと見下ろす・見上げる（0.5° / px）
      let yaw = drag.o.yaw - (q.x - drag.s.x) * 0.5;
      let pitch = drag.o.pitch + (q.y - drag.s.y) * 0.5;
      if (e.shiftKey) { yaw = Math.round(yaw / SNAP_DEG) * SNAP_DEG; pitch = Math.round(pitch / SNAP_DEG) * SNAP_DEG; }
      pitch = Math.max(-90, Math.min(90, pitch));
      V3.rot[v.id] = { yaw: ((yaw % 360) + 360) % 360, pitch };
    }
    renderViews();
  });
  const end = (e) => {
    if (!drag) return;
    const cancel = e && e.type === 'pointercancel';
    V3.arrowActive = null;
    if (cancel) {
      // 途中で中断された（ほかの窓に切り替わった、など）：元に戻して終わる
      if (drag.type === 'fold' && drag.undo) restoreFolds(drag.undo);
      if (drag.type === 'vxf' && drag.moved) { if (drag.kind === 'move3d' || drag.kind === 'rotate') moveViewXf3dReset(drag); else { restoreFrom(drag.subs); for (const it of drag.sr.items) { const o = drag.x3d.get(it.id); if (o) it.x3d = { ...o }; else delete it.x3d; } } }
      if (drag.type === 'pen') endViewPen(e, local(e));
      V3.hold = null; V3.grabLine = null; V3.handleActive = null; showTip(v.id, null, '');
      drag = null; render(); updateUI(); updateCursor();
      return;
    }
    if (drag.type === 'pen') endViewPen(e, local(e));
    if (drag.type === 'hingeOrMove') {   // 動かさずに離した：折り線をオレンジに（もう一度で外す）
      const k = hingeKey(drag.hh.A, drag.hh.B);
      S.foldHinge = S.foldHinge === k ? null : k;
      V3.grabLine = null;
      render(); updateUI();
    }
    if (drag.type === 'fold') { V3.hold = null; V3.grabLine = null; V3.handleActive = null; showTip(v.id, null, ''); render(); commit(); }
    if (drag.type === 'vxf') { endViewXf(drag); showTip(v.id, null, ''); }
    drag = null; updateCursor();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', () => { if (!drag) el.dataset.hover = ''; updateViewsCursor(); });
  el.addEventListener('dblclick', () => { if (isRotated(v.id)) { V3.rot[v.id] = { yaw: v.yaw, pitch: 0 }; renderViews(); } });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const q = local(e);
    const pinch = e.ctrlKey && !Number.isInteger(e.deltaY);
    if (e.altKey || pinch) zoomView3d(v.id, q.x, q.y, V3.k * Math.exp(-e.deltaY * (pinch ? 0.01 : 0.0015)));
    else {
      const p0 = V3.pan[v.id];
      V3.pan[v.id] = e.ctrlKey || e.shiftKey ? P(p0.x - (e.deltaY || e.deltaX), p0.y) : P(p0.x - e.deltaX, p0.y - e.deltaY);
      renderViews();
    }
  }, { passive: false });
}
// カーソル：Space で手のひら、Shift＋Space で回す、取っ手の上で伸び縮みの矢印、ふだんは黒い矢印
const HANDLE_CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
function updateViewsCursor() {
  for (const v of VIEWS) {
    const el = $(v.id), hv = el.dataset.hover;
    const zoom = (S.spaceDown && S.keys.ctrl) || (!S.spaceDown && S.tool === 'zoom');
    el.style.cursor = zoom ? (S.keys.alt ? 'zoom-out' : 'zoom-in')
      : S.spaceDown ? (S.keys.shift ? ROTATE_CURSORS.ne : 'grab')
      : S.tool === 'hand' ? 'grab'
      : hv === 'grab' ? 'grab' : hv && hv.startsWith('rot-') ? ROTATE3D_CURSORS[hv.slice(4)] : HANDLE_CURSORS[hv] || (S.tool === 'pen' && !S.keys.ctrl ? 'crosshair' : SELECT_CURSOR);
  }
}
function hoverView(id, q) {
  if (!V3.ok) return;
  const busy = S.spaceDown || S.tool === 'zoom' || S.tool === 'hand';
  const rz = busy || !SEL_TOOLS.has(S.tool) ? null : !hitViewHandle(id, q) && hitViewRotate(id, q);
  $(id).dataset.hover = busy ? '' : hitViewHandle(id, q) || (rz ? 'rot-' + rz : '');
  const ah = !busy && hitViewHandle(id, q) === 'n' && (viewBox(id) || {}).arrow ? id : null;   // 押し出しの矢印にマウスが乗ったら青
  if (ah !== (V3.arrowHover || null)) { V3.arrowHover = ah; drawViewBox(id); }
  // オレンジの折り線があるとき、つかめる線にマウスが乗ったら緑
  const oh = S.foldHinge && !S.spaceDown && SEL_TOOLS.has(S.tool) && findHinge(S.foldHinge);
  const hd = oh ? hitFoldHandle(oh, (w) => localToViewW(id, w), q) : null;
  if ((hd ? hd.face.id : null) !== (V3.handleHover || null)) { V3.handleHover = hd ? hd.face.id : null; for (const v of VIEWS) drawViewBox(v.id); drawOverlay(); }
  const gl = oh && !hd ? hitGrabLine(oh, (w) => localToViewW(id, w), q) : null;
  const next = gl ? { face: gl.face.id, seg: gl.seg, view: id } : null;
  if (JSON.stringify(V3.grabLine || null) !== JSON.stringify(next)) { V3.grabLine = next; for (const v of VIEWS) drawViewBox(v.id); }
  if (gl || hd) $(id).dataset.hover = 'grab';
  updateViewsCursor();
}
// ドラッグ中の数値
function showTip(id, q, text) {
  const tip = V3.views[id] && V3.views[id].box.querySelector('.vtip');
  if (!tip) return;
  tip.hidden = !text || !q;
  if (tip.hidden) return;
  tip.textContent = text;
  tip.style.left = q.x + 14 + 'px'; tip.style.top = q.y + 10 + 'px';
}
