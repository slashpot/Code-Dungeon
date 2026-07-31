// 地圖用字串畫（沿用 prototype 慣例；正式美術進來後這層換成 Tiled JSON 載入）。
// legend：每個字元 → {solid, color, prompt?, action?}；`h` = 主角起點（地面）。

export const TILE = 32;

const BASE = {
  '.': { solid: false },
  'h': { solid: false, hero: true },
  '#': { solid: true },
};

export const CITY = {
  id: 'city',
  ground: 0x171a23,
  wallColor: 0x333a4e,
  rows: [
    '##########################',
    '#........................#',
    '#.####..####..####..####.#',
    '#.####..#D##..####..####.#',
    '#........................#',
    '#........................#',
    '#..####.......####...N...#',
    '#..#L##.......####.......#',
    '#........................#',
    '#.####..#####..####..###.#',
    '#.####..#####..####..###.#',
    '#....C...................#',
    '#........................#',
    '#h.......................#',
    '##########################',
  ],
  legend: {
    ...BASE,
    'D': {
      solid: true, color: 0xe6c453,
      prompt: '機房入口 — Z / Enter 進入',
      action: { type: 'enter-dungeon' },
    },
    'L': {
      solid: true, color: 0x8a5fb0,
      prompt: '緊閉的門 — Z / Enter 推推看',
      action: { type: 'message', text: '上鎖了。門禁系統要等有人給你案子再說。' },
    },
    'N': {
      solid: true, color: 0x67c26b,
      prompt: '路人 — Z / Enter 搭話',
      action: { type: 'message', text: '「霓虹街的雨，下個不停。」' },
    },
    'C': {
      solid: true, color: 0x5dcaa5,
      prompt: '老周 — Z / Enter 搭話',
      action: { type: 'client' },
    },
  },
};

export function parseMap(def) {
  const rows = def.rows;
  const h = rows.length;
  const w = rows[0].length;
  const cells = [];
  let hero = null;
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const spec = def.legend[ch] || BASE['#'];
      if (spec.hero) hero = { x, y };
      row.push(spec);
    }
    cells.push(row);
  }
  return { id: def.id, w, h, cells, hero, ground: def.ground, wallColor: def.wallColor, spawn: def.spawn };
}
