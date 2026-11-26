'use strict';
// イラレCAD：画面の要素・ドキュメント・アプリの状態

const $ = (id) => document.getElementById(id);
const stage = $('stage'), world = $('world'), board = $('board'), boardEdge = $('boardEdge');
const gridG = $('grid'), art = $('art'), overlay = $('overlay');
const key = (s, i) => s + ',' + i;

// ドキュメントの形
//   units  … 座標の単位。mm（3D プリント向け）。Illustrator の SVG は pt なので、読み書きのときに換算する
//            （前の版のファイルは units: 'pt'。開くときに mm に直す）
//   layers … 2D の整理用（レイヤー → パスとグループの木）
//   solids … 3D の形を置く場所（例：{ id, type:'loft', sections:[{ pathId, z }] }）。
//            断面はパスの ID で参照するので、レイヤーの並びとは関係なく決められる
function newDoc() {
  return {
    version: DOC_VERSION, units: 'mm', width: 210, height: 297, guides: [], solids: [],
    layers: [{ id: uid(), name: 'レイヤー 1', color: LAYER_COLORS[0], visible: true, locked: false, items: [] }],
  };
}

let doc = newDoc();
const view = { x: 0, y: 0, z: 1, r: 0 };   // r：回転ビューの角度（ラジアン、時計回りが +）
const S = {
  tool: 'select', lastSelTool: 'select', activeTool: null,
  sel: new Map(),            // パスID → 選択中アンカーのキー集合 "サブパス番号,アンカー番号"
  activeLayer: null,
  fill: '#ffffff', stroke: '#000000', sw: 0.35, activeColor: 'fill',
  drawing: null,             // ペンで描いている途中のパス { id, s }
  outline: false,
  rulers: false, grid: false, snapGrid: false, smart: true, showGuides: true, guidesLocked: false, show3d: true, planFolded: false, foldHinge: null, lastExH: 0,
  selGuide: null, snapViz: null, snapCache: null, jis: true,
  xfOrigin: null,            // 回転・リフレクト・拡大縮小の基準点（null なら選択範囲の中心）
  keyStep: 0.1,              // 矢印キーで動く量（mm）。Ctrl+K で変更
  hideEdges: false,          // Ctrl+H：選択の線とアンカーを隠す
  dlgLast: {},
  selDims: new Set(),        // 選んでいる寸法の ID
  dimDraft: null,            // 寸法ツールで作っている途中 { a, ra, b, rb }
  roundR: 4.23,              // 角丸長方形ツールの角丸の半径（mm。イラレの初期値 12pt と同じ）
  segSel: null,              // ダイレクト選択でつかんだ線（セグメント）{ id, s, seg }
  keyId: null,               // 整列のキーオブジェクト（選択中のまとまりの ID）
  alignTo: 'selection',      // 整列の基準：'selection' | 'key' | 'artboard'
  drag: null,
  keys: { ctrl: false, alt: false, shift: false }, spaceDown: false,
  mouse: null, mouseScr: null, hover: null, penHint: '',
  marquee: null, handleHits: [], bboxHits: [],
  clipboard: null, clipText: null, pasteMode: 'center', pasteHandled: true,
  lastTransform: null,
  fileName: '名称未設定.icad', fileHandle: null,
};
