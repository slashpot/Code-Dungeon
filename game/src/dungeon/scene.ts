// DungeonScene：把 engine 的 game state 渲染成 Pixi 場景。
// 三層：靜態地形 / 動態實體（每幀重畫，位置用 lerp 產生移動動畫）/ 視野迷霧（每回合重畫）。
import { Container, Graphics } from 'pixi.js';
import type { Game } from '../engine/engine.ts';

const TILE = 32;
const COLORS: Record<string, number> = {
  floor: 0x141b28, wall: 0x2c3550, wallTop: 0x3d4a6e, poison: 0x3c3489,
  stairs: 0x53c8e6, item: 0xe6c453, hero: 0x5aa2e8,
  slime: 0x67c26b, goblin: 0xf0997b, 'orc-boss': 0xd85a30,
  hpBack: 0x1a1020, hpFill: 0xe24b4a, flash: 0xffffff,
};
const ENEMY_RADIUS: Record<string, number> = { slime: 0.28, goblin: 0.32, 'orc-boss': 0.42 };
const MOVE_LERP_MS = 90; // 實體滑到新格子的時間

type EntityKey = number | 'hero';

export class DungeonScene {
  viewW: number;
  viewH: number;
  container: Container;
  mapLayer: Graphics;
  dynLayer: Graphics;
  fogLayer: Graphics;
  game: Game | null = null;
  disp: Map<EntityKey, { x: number; y: number }> = new Map();   // 顯示用像素座標
  flashUntil: Map<number, number> = new Map();                  // enemyId → timestamp（被攻擊的白閃）

  constructor({ viewW, viewH }: { viewW: number; viewH: number }) {
    this.viewW = viewW;
    this.viewH = viewH;
    this.container = new Container();
    this.mapLayer = new Graphics();
    this.dynLayer = new Graphics();
    this.fogLayer = new Graphics();
    this.container.addChild(this.mapLayer, this.dynLayer, this.fogLayer);
  }

  attach(game: Game): void {
    this.game = game;
    this.container.x = Math.floor((this.viewW - game.W * TILE) / 2);
    this.container.y = Math.floor((this.viewH - game.H * TILE) / 2);
    this.disp.clear();
    this.flashUntil.clear();
    this.drawMap();
    this.sync();
    this.drawDyn();
  }

  drawMap(): void {
    const game = this.game!;
    const g = this.mapLayer;
    const { W, H, MAPSRC } = game;
    g.clear();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = MAPSRC[y][x];
        const px = x * TILE, py = y * TILE;
        if (c === '#') {
          g.rect(px, py, TILE, TILE).fill(COLORS.wall);
          g.rect(px, py, TILE, 3).fill(COLORS.wallTop);
        } else {
          g.rect(px, py, TILE, TILE).fill(c === '~' ? COLORS.poison : COLORS.floor);
          if (c === '~') g.circle(px + TILE / 2, py + TILE / 2, 3).fill({ color: 0x6a5fd4, alpha: 0.6 });
        }
      }
    }
    const s = game.state.stairs;
    g.rect(s.x * TILE + 3, s.y * TILE + 3, TILE - 6, TILE - 6).fill({ color: COLORS.stairs, alpha: 0.25 });
    g.poly([
      s.x * TILE + 9, s.y * TILE + 12,
      s.x * TILE + TILE - 9, s.y * TILE + 12,
      s.x * TILE + TILE / 2, s.y * TILE + TILE - 9,
    ]).fill(COLORS.stairs);
  }

  // 每回合呼叫：更新迷霧＋補齊/清掉實體的顯示座標
  sync(): void {
    const game = this.game!;
    const { W, H, state } = game;
    const fog = this.fogLayer;
    fog.clear();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!game.visibleNow(x, y)) fog.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0x05070c, alpha: 0.55 });
      }
    }
    const alive = new Set<EntityKey>(['hero']);
    if (!this.disp.has('hero')) this.disp.set('hero', { x: state.hero.x * TILE, y: state.hero.y * TILE });
    for (const e of state.enemies) {
      alive.add(e.id);
      if (!this.disp.has(e.id)) this.disp.set(e.id, { x: e.x * TILE, y: e.y * TILE });
    }
    for (const k of [...this.disp.keys()]) if (!alive.has(k)) this.disp.delete(k);
  }

  onAction(name: string, args: unknown[]): void {
    const t = args[0] as { id?: number } | null | undefined;
    if (name === 'attack' && t && typeof t.id === 'number') {
      this.flashUntil.set(t.id, performance.now() + 160);
    }
  }

  update(dtMs: number): void {
    if (!this.game) return;
    const k = Math.min(1, dtMs / MOVE_LERP_MS);
    const move = (key: EntityKey, tx: number, ty: number) => {
      const d = this.disp.get(key);
      if (!d) return;
      d.x += (tx - d.x) * k;
      d.y += (ty - d.y) * k;
      if (Math.abs(d.x - tx) < 0.5) d.x = tx;
      if (Math.abs(d.y - ty) < 0.5) d.y = ty;
    };
    const st = this.game.state;
    move('hero', st.hero.x * TILE, st.hero.y * TILE);
    for (const e of st.enemies) move(e.id, e.x * TILE, e.y * TILE);
    this.drawDyn();
  }

  drawDyn(): void {
    const game = this.game!;
    const g = this.dynLayer;
    const st = game.state;
    const now = performance.now();
    g.clear();
    for (const it of st.items) {
      const cx = it.x * TILE + TILE / 2, cy = it.y * TILE + TILE / 2;
      g.poly([cx, cy - 7, cx + 7, cy, cx, cy + 7, cx - 7, cy]).fill(COLORS.item);
    }
    for (const e of st.enemies) {
      const d = this.disp.get(e.id) || { x: e.x * TILE, y: e.y * TILE };
      const r = (ENEMY_RADIUS[e.type] || 0.3) * TILE;
      const flashing = (this.flashUntil.get(e.id) || 0) > now;
      g.circle(d.x + TILE / 2, d.y + TILE / 2, r).fill(flashing ? COLORS.flash : (COLORS[e.type] || 0xf0997b));
      g.rect(d.x + 4, d.y + 1, TILE - 8, 3).fill(COLORS.hpBack);
      g.rect(d.x + 4, d.y + 1, (TILE - 8) * Math.max(0, e.hp / e.maxhp), 3).fill(COLORS.hpFill);
    }
    if (st.hero.hp > 0) {
      const d = this.disp.get('hero') || { x: st.hero.x * TILE, y: st.hero.y * TILE };
      g.circle(d.x + TILE / 2, d.y + TILE / 2, TILE * 0.34).fill(COLORS.hero);
      g.circle(d.x + TILE / 2, d.y + TILE / 2, TILE * 0.14).fill(0xdfe6ef);
    }
  }
}
