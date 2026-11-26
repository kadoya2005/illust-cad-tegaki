'use strict';
// イラレCAD：表示の設定（定規・グリッドなど）をブラウザに覚えておく

const PREF_FLAGS = ['rulers', 'grid', 'snapGrid', 'smart', 'showGuides', 'guidesLocked', 'show3d', 'planFolded'];
function savePrefs() {
  try {
    const p = { keyStepMm: S.keyStep };
    for (const k of PREF_FLAGS) p[k] = S[k];
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch (_) { /* 保存できなくても続ける */ }
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    for (const k of PREF_FLAGS) if (typeof p[k] === 'boolean') S[k] = p[k];
    if (p.keyStepMm > 0) S.keyStep = p.keyStepMm;
  } catch (_) { /* 既定のまま */ }
}
