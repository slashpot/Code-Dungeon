// v0.1-web M1：城市可行走＋dungeon 入口進出。Pixi 場景、鍵盤輸入、場景切換、__game 驗收掛勾。
import { Application } from 'pixi.js';
import { CITY, DUNGEON_STUB } from './world/maps.js';
import { GridScene } from './world/scene.js';

const VIEW_W = 640;
const VIEW_H = 416;
const qs = new URLSearchParams(location.search);
const MOVE_MS = qs.has('fast') ? 20 : 140;

const promptEl = document.getElementById('prompt');
const msgEl = document.getElementById('msg');
const sceneLabelEl = document.getElementById('scene-label');

let msgTimer = null;
function showMsg(text) {
  msgEl.textContent = text;
  msgEl.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => msgEl.classList.remove('show'), 2600);
}

const state = { scene: null, scenes: {}, returnPos: null };

function currentScene() { return state.scenes[state.scene]; }

function switchScene(name) {
  const app = state.app;
  app.stage.removeChildren();
  state.scene = name;
  const scene = currentScene();
  app.stage.addChild(scene.container);
  sceneLabelEl.textContent = name === 'city' ? '霓虹街' : '機房（暫代空場景）';
  scene.refreshPrompt();
}

function doInteract() {
  const scene = currentScene();
  const action = scene.facingCell().action;
  if (!action) return null;
  switch (action.type) {
    case 'enter-dungeon': {
      state.returnPos = { x: scene.player.x, y: scene.player.y };
      const spawn = DUNGEON_STUB.spawn;
      state.scenes.dungeon.setPos(spawn.x, spawn.y, spawn.facing);
      switchScene('dungeon');
      showMsg('（M2 之後這裡才是真正的 dungeon＋IDE）');
      break;
    }
    case 'exit-dungeon': {
      const r = state.returnPos;
      state.scenes.city.setPos(r.x, r.y, 'down');
      switchScene('city');
      break;
    }
    case 'message':
      showMsg(action.text);
      break;
  }
  return action.type;
}

// ---------- 鍵盤輸入 ----------
const KEY_DIR = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};
const INTERACT_KEYS = new Set(['KeyZ', 'Enter', 'Space']);
const held = new Set();

function setupInput() {
  window.addEventListener('keydown', (e) => {
    const dir = KEY_DIR[e.code];
    if (dir) {
      e.preventDefault();
      held.add(dir);
      const scene = currentScene();
      if (!scene.player.moving) scene.step(dir);
    } else if (INTERACT_KEYS.has(e.code)) {
      e.preventDefault();
      doInteract();
    }
  });
  window.addEventListener('keyup', (e) => {
    const dir = KEY_DIR[e.code];
    if (dir) held.delete(dir);
  });
  window.addEventListener('blur', () => held.clear());
}

// ---------- 啟動 ----------
async function boot() {
  const app = new Application();
  await app.init({
    width: VIEW_W, height: VIEW_H,
    background: 0x0b0d12,
    antialias: false,
    preference: 'webgl',
  });
  document.getElementById('game').appendChild(app.canvas);
  state.app = app;

  const onPrompt = (text) => { promptEl.textContent = text || ''; };
  const sceneOpts = { viewW: VIEW_W, viewH: VIEW_H, moveMs: MOVE_MS, onPrompt };
  state.scenes.city = new GridScene({ mapDef: CITY, ...sceneOpts });
  state.scenes.dungeon = new GridScene({ mapDef: DUNGEON_STUB, ...sceneOpts });
  switchScene('city');

  setupInput();

  app.ticker.add((ticker) => {
    const scene = currentScene();
    scene.update(ticker.deltaMS);
    if (!scene.player.moving && held.size > 0) {
      scene.step(held.values().next().value);
    }
  });

  // 無頭驗收掛勾
  window.__game = {
    scene: () => state.scene,
    idle: () => !currentScene().player.moving,
    pos: () => ({ x: currentScene().player.x, y: currentScene().player.y }),
    facing: () => currentScene().player.facing,
    step: (dir) => currentScene().step(dir),
    interact: () => doInteract(),
    promptText: () => promptEl.textContent,
  };
  window.__READY__ = true;
}

boot();
