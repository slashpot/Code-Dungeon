// v0.1 存檔（localStorage，key 與 prototype 分開）。
const SAVE_KEY = 'codeCityV01';

export interface StoryFlags {
  intro: boolean;
  accepted: boolean;
  done: boolean;
  reported: boolean;
}

export interface SaveData {
  code?: string;
  vim?: boolean;
  story?: Partial<StoryFlags>;
  pos?: { x: number; y: number };
}

export function loadSave(): SaveData {
  try { return (JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as SaveData) || {}; } catch (e) { return {}; }
}

export function save(patch: Partial<SaveData>): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...loadSave(), ...patch })); } catch (e) {}
}
