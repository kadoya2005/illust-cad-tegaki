'use strict';
// イラレCAD：設定値・ツールの一覧

// イラレCAD 2D 試作：画面・ツール・ショートカット

const DOC_VERSION = 3;         // ドキュメント（.icad）の形の版（3：単位を mm に）
const PT_PER_MM = 72 / 25.4;   // 1mm = 2.8346pt。中の値は mm。Illustrator（SVG）とのやりとりだけ pt に換算する
const MM_PER_PT = 25.4 / 72;   // 1pt = 0.3528mm
const LAYER_COLORS = ['#4f80ff', '#ff4f4f', '#3fbf3f', '#3fbfff', '#ff4fff', '#ffbf3f', '#9f6fff', '#ff8f3f'];
// 3D の操作の色（そろえる）：回す＝オレンジ、動かす（移動・押し出し・折る線をつかむ）＝緑。ドラッグ中も色は変えず、太く・大きくして見せる
const COL_ROT = '#ff8c1a', COL_ROT_HOT = '#ff5a00', COL_MOVE = '#2fbf4f';
const SEL_TOOLS = new Set(['select', 'direct']);
const NODE_TOOLS = new Set(['direct', 'pen', 'addAnchor', 'deleteAnchor', 'convert']);
const XF_TOOLS = new Set(['rotate', 'reflect', 'scale']);
const TOOL_KEYS = { V: 'select', A: 'direct', P: 'pen', M: 'rect', L: 'ellipse', R: 'rotate', O: 'reflect', S: 'scale', I: 'eyedropper', H: 'hand', Z: 'zoom' };
const TOOLS_META = {
  select: { name: '選択ツール', key: 'V', hint: 'クリックで選択（グループは丸ごと）・ドラッグで移動／Shift で追加選択／Alt+ドラッグで複製／枠の四角で拡大縮小' },
  direct: { name: 'ダイレクト選択ツール', key: 'A', hint: 'アンカーやハンドルを個別に動かす／曲線の線をドラッグで形を変える／Shift で追加／Alt+クリックでパス全体、もう一度でグループ' },
  pen: { name: 'ペンツール', key: 'P', hint: 'クリックで直線、ドラッグで曲線／ドラッグ中に Alt で切り返し、Space でアンカーを移動／始点をクリックで閉じる／Enter・Esc で終了／Alt でアンカーポイントツール／Shift で 45°' },
  addAnchor: { name: 'アンカーポイントの追加ツール', key: '+', hint: 'パスの線の上をクリックしてアンカーを追加' },
  deleteAnchor: { name: 'アンカーポイントの削除ツール', key: '-', hint: 'アンカーをクリックして削除（形はつながったまま）' },
  convert: { name: 'アンカーポイントツール', key: 'Shift+C', hint: 'アンカーをクリックで角に、ドラッグで曲線に／方向線の先をドラッグで片側だけ動かす（切り返し）' },
  rect: { name: '長方形ツール', key: 'M', hint: 'ドラッグで描く／Shift で正方形／Alt で中心から／クリックで数値指定／ボタンの長押しで角丸長方形ツール' },
  roundRect: { name: '角丸長方形ツール', key: '', hint: 'ドラッグで描く／ドラッグ中に ↑↓ で角丸を大きく・小さく、← で角なし、→ でいちばん丸く／Shift で正方形／Alt で中心から／クリックで数値指定（角丸の半径も）' },
  ellipse: { name: '楕円形ツール', key: 'L', hint: 'ドラッグで描く／Shift で正円／Alt で中心から／クリックで数値指定' },
  line: { name: '直線ツール', key: '\\', hint: 'ドラッグで描く／Shift で 45°／Alt で中心から／クリックで数値指定' },
  dim: { name: '寸法ツール', key: '', hint: '1・2 回目のクリックで測る 2 点（アンカーや三面図の角に吸着してくっつく）、3 回目で寸法線の位置。左右に出すと垂直、上下に出すと水平、Shift で斜め／Esc でやめる。寸法は図面レイヤーに入り、3D・STL には出ません' },
  rotate: { name: '回転ツール', key: 'R', hint: 'クリックで基準点、ドラッグで回転／Shift で 45° 刻み／離すときに Alt でコピー／Alt+クリックで基準点を決めて数値入力' },
  reflect: { name: 'リフレクトツール', key: 'O', hint: 'クリックで基準点、ドラッグで軸を決めて折り返し／Shift で 45° 刻み／離すときに Alt でコピー／Alt+クリックで基準点を決めて数値入力' },
  scale: { name: '拡大・縮小ツール', key: 'S', hint: 'クリックで基準点、ドラッグで拡大縮小／Shift で縦横比を保つ／離すときに Alt でコピー／Alt+クリックで基準点を決めて数値入力' },
  eyedropper: { name: 'スポイトツール', key: 'I', hint: 'クリックしたオブジェクトの塗りと線を、選択中のものに写す' },
  hand: { name: '手のひらツール', key: 'H', hint: 'ドラッグで表示位置を動かす（Space を押している間も使えます）' },
  zoom: { name: 'ズームツール', key: 'Z', hint: 'クリックで拡大／Alt+クリックで縮小' },
  rotView: { name: '回転ビュー', key: 'Shift+Space', hint: 'ドラッグで画面を回す（Shift で 15° ずつ）／Ctrl+Shift+1 で元に戻す' },
};
const ZOOM_UNIT = PT_PER_MM;   // 表示 100% のときの view.z（1mm ＝ 2.83px。Illustrator と同じ見た目の大きさ）
const ZOOMS = [0.03125, 0.0625, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const AUTOSAVE_DOC = 'illustcad-tegaki.autosave.doc';
const AUTOSAVE_NAME = 'illustcad-tegaki.autosave.name';
const PREFS_KEY = 'illustcad-tegaki.prefs';
const RULER = 20;              // 定規の太さ（px）
const GRID_MAJOR = 10;         // グリッド：10mm ごとに太線
const GRID_DIV = 10;           // その中を 10 分割（1mm）
const GUIDE_COLOR = '#00c8ff';
const SMART_COLOR = '#ff3fd0';
