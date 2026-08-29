// v0.1-web：城市可行走（M1）＋ L1 dungeon 與遊戲內 IDE（M2）＋ 基礎故事與存檔（M3）。
// Pixi 場景、鍵盤輸入、城市↔dungeon 模式切換、劇情 gating、__game/__dungeon/__story 驗收掛勾。
import { Application } from 'pixi.js';
import { CITY } from './world/maps.ts';
import { GridScene } from './world/scene.ts';
import type { StepResult } from './world/scene.ts';
import { createDungeonController } from './dungeon/controller.ts';
import type { DungeonController, DungeonHooks } from './dungeon/controller.ts';
import { createDialogueUi } from './story/dialogue.ts';
import type { DialogueUi } from './story/dialogue.ts';
import { createStory, LOCKED_DOOR_MSG } from './story/story.ts';
import type { Story } from './story/story.ts';
import type { StoryFlags } from './save.ts';
import { loadSave, save } from './save.ts';

const VIEW_W = 640;
const VIEW_H = 416;
const qs = new URLSearchParams(location.search);
const MOVE_MS = qs.has('fast') ? 20 : 140;

const promptEl = document.getElementById('prompt')!;
const msgEl = document.getElementById('msg')!;
const sceneLabelEl = document.getElementById('scene-label')!;
const questEl = document.getElementById('quest')!;
const tbcEl = document.getElementById('tbc')!;

let msgTimer: ReturnType<typeof setTimeout> | null = null;
function showMsg(text: string): void {
  msgEl.textContent = text;
  msgEl.classList.add('show');
  if (msgTimer !== null) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => msgEl.classList.remove('show'), 2600);
}

function setQuest(text: string): void { questEl.textContent = text; }
function showTbc(): void { tbcEl.classList.add('show'); }
function hideTbc(): void { tbcEl.classList.remove('show'); }
function tbcVisible(): boolean { return tbcEl.classList.contains('show'); }

type SceneName = 'city' | 'dungeon';
interface AppState {
  app: Application;
  scene: SceneName;
  city: GridScene;
  dungeonCtl: DungeonController;
  story: Story;
  dialogue: DialogueUi;
}
// boot() 內全部填好之後才會被任何 handler 觸碰
const state = {} as AppState;

function showCity(): void {
  state.app.stage.removeChildren();
  state.app.stage.addChild(state.city.container);
  state.scene = 'city';
  sceneLabelEl.textContent = '霓虹街';
  state.city.refreshPrompt();
}

function enterDungeon(): void {
  const container = state.dungeonCtl.enter();
  state.app.stage.removeChildren();
  state.app.stage.addChild(container);
  state.scene = 'dungeon';
  sceneLabelEl.textContent = '機房 — 用腳本操控你的 avatar';
  promptEl.textContent = '';
}

function doInteract(): string | null {
  if (tbcVisible() || state.dialogue.isActive() || state.scene !== 'city') return null;
  const action = state.city.facingCell().action;
  if (!action) return null;
  switch (action.type) {
    case 'enter-dungeon':
      if (!state.story.canEnterDungeon()) { showMsg(LOCKED_DOOR_MSG); return 'locked'; }
      save({ pos: { x: state.city.player.x, y: state.city.player.y } });
      enterDungeon();
      return 'enter-dungeon';
    case 'client':
      state.story.talkToClient();
      return 'client';
    case 'message':
      showMsg(action.text);
      return 'message';
  }
}

/* ---------- 鍵盤輸入（城市模式限定；dungeon 模式把鍵盤留給編輯器） ---------- */
const KEY_DIR: Record<string, string> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};
const INTERACT_KEYS = new Set(['KeyZ', 'Enter', 'Space']);
const held = new Set<string>();

function setupInput(): void {
  window.addEventListener('keydown', (e) => {
    const isInteract = INTERACT_KEYS.has(e.code);
    if (tbcVisible()) {
      if (isInteract) { e.preventDefault(); hideTbc(); }
      return;
    }
    if (state.scene !== 'city') return;
    if (state.dialogue.isActive()) {
      if (isInteract) { e.preventDefault(); state.dialogue.advance(); }
      return; // 對話中不移動
    }
    const dir = KEY_DIR[e.code];
    if (dir) {
      e.preventDefault();
      held.add(dir);
      if (!state.city.player.moving) void state.city.step(dir);
    } else if (isInteract) {
      e.preventDefault();
      doInteract();
    }
  });
  window.addEventListener('keyup', (e) => {
    const dir = KEY_DIR[e.code];
    if (dir) held.delete(dir);
  });
  window.addEventListener('blur', () => held.clear());
  tbcEl.addEventListener('click', hideTbc);
}

/* ---------- 驗收掛勾型別 ---------- */
interface GameHooks {
  scene(): SceneName;
  idle(): boolean;
  pos(): { x: number; y: number } | null;
  facing(): string | null;
  step(dir: string): Promise<StepResult | 'not-city'>;
  interact(): string | null;
  promptText(): string;
}
interface StoryHooks {
  active(): boolean;
  advance(): void;
  flags(): StoryFlags;
  quest(): string;
  tbcVisible(): boolean;
}
declare global {
  interface Window {
    __game: GameHooks;
    __dungeon: DungeonHooks;
    __story: StoryHooks;
    __READY__: boolean;
  }
}

/* ---------- 啟動 ---------- */
async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    width: VIEW_W, height: VIEW_H,
    background: 0x0b0d12,
    antialias: false,
    preference: 'webgl',
  });
  document.getElementById('game')!.appendChild(app.canvas);
  state.app = app;

  state.dialogue = createDialogueUi({
    box: document.getElementById('dlg')!,
    speaker: document.getElementById('dlg-speaker')!,
    text: document.getElementById('dlg-text')!,
    more: document.getElementById('dlg-more')!,
  });
  state.story = createStory({
    dialogue: state.dialogue,
    onQuestChange: setQuest,
    onMsg: showMsg,
    onTbc: showTbc,
  });

  const onPrompt = (text: string | null) => { promptEl.textContent = text || ''; };
  state.city = new GridScene({
    mapDef: CITY, viewW: VIEW_W, viewH: VIEW_H, moveMs: MOVE_MS, onPrompt,
    onStep: (x, y) => save({ pos: { x, y } }),
  });
  const savedPos = loadSave().pos;
  if (savedPos) state.city.setPos(savedPos.x, savedPos.y, 'down');

  state.dungeonCtl = createDungeonController({
    viewW: VIEW_W, viewH: VIEW_H,
    onLeave: showCity,
    onWin: () => state.story.markJobDone(),
  });
  showCity();
  setQuest(state.story.questText());

  setupInput();

  app.ticker.add((ticker) => {
    if (state.scene === 'city') {
      state.city.update(ticker.deltaMS);
      if (!state.dialogue.isActive() && !state.city.player.moving && held.size > 0) {
        void state.city.step(held.values().next().value!);
      }
    } else if (state.scene === 'dungeon') {
      state.dungeonCtl.update(ticker.deltaMS);
    }
  });

  state.story.introIfNeeded();

  // 無頭驗收掛勾
  window.__game = {
    scene: () => state.scene,
    idle: () => state.scene !== 'city' || !state.city.player.moving,
    pos: () => (state.scene === 'city' ? { x: state.city.player.x, y: state.city.player.y } : null),
    facing: () => (state.scene === 'city' ? state.city.player.facing : null),
    step: (dir) => (state.scene === 'city' ? state.city.step(dir) : Promise.resolve('not-city' as const)),
    interact: () => doInteract(),
    promptText: () => promptEl.textContent || '',
  };
  window.__dungeon = state.dungeonCtl.hooks;
  window.__story = {
    active: () => state.dialogue.isActive(),
    advance: () => state.dialogue.advance(),
    flags: () => ({ ...state.story.flags }),
    quest: () => state.story.questText(),
    tbcVisible,
  };
  window.__READY__ = true;
}

void boot();
