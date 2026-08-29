// GridScene：一張字串地圖的 Pixi 場景——tile 層、主角逐格移動、鏡頭跟隨、面向格互動偵測。
// 無物理引擎：碰撞＝grid 查表。
import { Container, Graphics } from 'pixi.js';
import { TILE, parseMap } from './maps.ts';
import type { MapDef, ParsedMap, CellSpec, Facing } from './maps.ts';

const DIRS: { [k: string]: { dx: number; dy: number } } = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export type StepResult = 'ok' | 'blocked' | 'busy' | 'bad-dir';

export interface GridSceneOpts {
  mapDef: MapDef;
  viewW: number;
  viewH: number;
  moveMs: number;
  onPrompt: (text: string | null) => void;
  onStep?: (x: number, y: number) => void;
}

interface PlayerState {
  x: number; y: number;
  facing: Facing;
  moving: boolean;
  px: number; py: number;
  from: { px: number; py: number } | null;
  to: { px: number; py: number } | null;
  t: number;
  resolve: ((r: StepResult) => void) | null;
}

export class GridScene {
  map: ParsedMap;
  viewW: number;
  viewH: number;
  moveMs: number;
  onPrompt: (text: string | null) => void;
  onStep: ((x: number, y: number) => void) | null;
  container: Container;
  playerG: Graphics;
  player: PlayerState;

  constructor({ mapDef, viewW, viewH, moveMs, onPrompt, onStep }: GridSceneOpts) {
    this.map = parseMap(mapDef);
    this.viewW = viewW;
    this.viewH = viewH;
    this.moveMs = moveMs;
    this.onPrompt = onPrompt;
    this.onStep = onStep || null;

    this.container = new Container();
    this.container.addChild(this.buildTileLayer());

    this.playerG = new Graphics();
    this.container.addChild(this.playerG);

    const start = this.map.spawn || this.map.hero || { x: 1, y: 1 };
    this.player = {
      x: start.x, y: start.y,
      facing: ('facing' in start && start.facing) || 'down',
      moving: false,
      px: start.x * TILE, py: start.y * TILE,
      from: null, to: null, t: 0, resolve: null,
    };
    this.drawPlayer();
    this.updateCamera();
  }

  buildTileLayer(): Graphics {
    const g = new Graphics();
    const { w, h, cells, ground, wallColor } = this.map;
    g.rect(0, 0, w * TILE, h * TILE).fill(ground);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = cells[y][x];
        if (c.color !== undefined) {
          g.rect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4).fill(c.color);
        } else if (c.solid) {
          g.rect(x * TILE, y * TILE, TILE, TILE).fill(wallColor);
          g.rect(x * TILE, y * TILE, TILE, 3).fill(0x4a5470);
        } else if ((x + y) % 2 === 0) {
          g.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0xffffff, alpha: 0.015 });
        }
      }
    }
    return g;
  }

  drawPlayer(): void {
    const g = this.playerG;
    const p = this.player;
    const cx = p.px + TILE / 2;
    const cy = p.py + TILE / 2;
    const d = DIRS[p.facing];
    g.clear();
    g.circle(cx, cy, TILE * 0.34).fill(0x5aa2e8);
    g.circle(cx + d.dx * TILE * 0.22, cy + d.dy * TILE * 0.22, TILE * 0.1).fill(0xdfe6ef);
  }

  cellAt(x: number, y: number): CellSpec {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return { solid: true };
    return this.map.cells[y][x];
  }

  facingCell(): CellSpec {
    const d = DIRS[this.player.facing];
    return this.cellAt(this.player.x + d.dx, this.player.y + d.dy);
  }

  refreshPrompt(): void {
    const c = this.facingCell();
    this.onPrompt(c.prompt || null);
  }

  // 一次一格；動畫進行中呼叫回傳 'busy'（輸入端只在 idle 時觸發）
  step(dir: string): Promise<StepResult> {
    const p = this.player;
    if (p.moving) return Promise.resolve('busy');
    const d = DIRS[dir];
    if (!d) return Promise.resolve('bad-dir');
    p.facing = dir as Facing;
    const nx = p.x + d.dx;
    const ny = p.y + d.dy;
    if (this.cellAt(nx, ny).solid) {
      this.drawPlayer();
      this.refreshPrompt();
      return Promise.resolve('blocked');
    }
    p.moving = true;
    p.from = { px: p.px, py: p.py };
    p.to = { px: nx * TILE, py: ny * TILE };
    p.x = nx;
    p.y = ny;
    p.t = 0;
    return new Promise((resolve) => { p.resolve = resolve; });
  }

  setPos(x: number, y: number, facing?: Facing): void {
    const p = this.player;
    p.x = x; p.y = y;
    if (facing) p.facing = facing;
    p.px = x * TILE; p.py = y * TILE;
    p.moving = false;
    this.drawPlayer();
    this.updateCamera();
    this.refreshPrompt();
  }

  update(dtMs: number): void {
    const p = this.player;
    if (p.moving && p.from && p.to) {
      p.t = Math.min(1, p.t + dtMs / this.moveMs);
      p.px = p.from.px + (p.to.px - p.from.px) * p.t;
      p.py = p.from.py + (p.to.py - p.from.py) * p.t;
      if (p.t >= 1) {
        p.moving = false;
        p.px = p.to.px; p.py = p.to.py;
        const resolve = p.resolve;
        p.resolve = null;
        this.refreshPrompt();
        if (this.onStep) this.onStep(p.x, p.y);
        if (resolve) resolve('ok');
      }
      this.drawPlayer();
      this.updateCamera();
    }
  }

  updateCamera(): void {
    const mapW = this.map.w * TILE;
    const mapH = this.map.h * TILE;
    this.container.x = -clampCam(this.player.px + TILE / 2 - this.viewW / 2, mapW, this.viewW);
    this.container.y = -clampCam(this.player.py + TILE / 2 - this.viewH / 2, mapH, this.viewH);
  }
}

function clampCam(target: number, mapPx: number, viewPx: number): number {
  if (mapPx <= viewPx) return (mapPx - viewPx) / 2; // 地圖比視窗小 → 置中
  return Math.max(0, Math.min(target, mapPx - viewPx));
}
