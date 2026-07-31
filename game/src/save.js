// v0.1 存檔（localStorage，key 與 prototype 分開）。
// 結構：{ code, vim, story: {intro, accepted, done, reported}, pos: {x, y} }
const SAVE_KEY = 'codeCityV01';

export function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
}

export function save(patch) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...loadSave(), ...patch })); } catch (e) {}
}
