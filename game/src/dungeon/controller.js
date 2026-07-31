// Dungeon 控制器：engine ＋ worker 直譯器管線 ＋ CodeMirror IDE ＋ Pixi 場景的接線。
// 執行語意同 prototype startRun：腳本跑完自動從頭執行（頂層變數重置），
// 零行動的一輪→停止；死亡/通關→中止腳本（terminate worker）＋結算面板。
import { createGame, STOP, HERO_MAXHP } from '../engine/engine.js';
import { LEVELS, STARTER_CODE } from '../engine/levels.js';
import { createRunner } from '../runtime/runner.js';
import { createEditor } from '../ide/editor.js';
import { DungeonScene } from './scene.js';
import { loadSave, save } from '../save.js';

const LEVEL_IDX = 0; // v0.1 範圍護欄：只有 L1
const MAX_STEPS = 300000;
const LOG_LIMIT = 300;

// API v0（14 函式；log 由 worker 內建）。arity 給 worker 固定 createAsyncFunction 簽名用。
const ACTION_SPECS = [
  { name: 'alive', arity: 0 }, { name: 'hp', arity: 0 }, { name: 'hasPotion', arity: 0 },
  { name: 'getEnemies', arity: 0 }, { name: 'getItems', arity: 0 }, { name: 'getStairs', arity: 0 },
  { name: 'myPos', arity: 0 }, { name: 'distance', arity: 1 }, { name: 'nearest', arity: 1 },
  { name: 'move', arity: 1 }, { name: 'moveToward', arity: 1 }, { name: 'attack', arity: 1 },
  { name: 'drinkPotion', arity: 0 }, { name: 'explore', arity: 1 },
];

export function createDungeonController({ viewW, viewH, onLeave, onWin }) {
  const el = (id) => document.getElementById(id);
  const els = {
    editor: el('editor-box'), status: el('run-status'), hud: el('run-hud'), log: el('run-log'),
    result: el('dg-result'), resultTitle: el('dg-title'), resultStats: el('dg-stats'), resultHint: el('dg-hint'),
    leaveWin: el('dg-leave'), close: el('dg-close'),
    run: el('btn-run'), fast: el('btn-fast'), stop: el('btn-stop'), reset: el('btn-reset'),
    restore: el('btn-restore'), vim: el('btn-vim'), leave: el('btn-leave'), levelLabel: el('dg-level'),
  };

  const scene = new DungeonScene({ viewW, viewH });
  let editor = null;
  let runner = null;
  let game = null;
  let running = false;
  let linesSeen = 0;
  let vimOn = !!loadSave().vim;

  function log(msg, cls, turn) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = `[T${turn !== undefined ? turn : (game ? game.state.turn : 0)}] ${msg}`;
    els.log.appendChild(line);
    while (els.log.children.length > LOG_LIMIT) els.log.removeChild(els.log.firstChild);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function updateHud() {
    if (!game) return;
    const h = game.state.hero;
    els.hud.textContent = `回合 ${game.state.turn} ・ HP ${Math.max(0, h.hp)}/${HERO_MAXHP} ・ 藥水 ${h.potions} ・ 擊殺 ${game.state.kills}`;
  }

  function setRunUi(isRunning) {
    els.run.disabled = isRunning;
    els.fast.disabled = isRunning;
    els.reset.disabled = isRunning;
    els.restore.disabled = isRunning;
    els.stop.disabled = !isRunning;
  }

  function resetGame() {
    game = createGame(LEVELS[LEVEL_IDX], { onLog: log });
    scene.attach(game);
    els.result.style.display = 'none';
    updateHud();
  }

  function ensureEditor() {
    if (editor) return;
    editor = createEditor({ parent: els.editor, doc: loadSave().code || STARTER_CODE, vimEnabled: vimOn });
    els.vim.textContent = `Vim: ${vimOn ? 'ON' : 'OFF'}`;
  }

  function ensureRunner() {
    if (runner) return;
    runner = createRunner({
      createWorker: () => new Worker('dist/runtime/worker.js'),
      applyAction,
      onLine: (line) => { if (line !== null) linesSeen++; editor.setExecHighlight(line); },
      onLog: (text) => log(`你的 log：${text}`, 'sys'),
      onStatus: (s) => {
        if (s.state === 'started') els.status.textContent = '執行中…';
      },
    });
  }

  function applyAction(name, args) {
    if (!game || game.status !== 'playing') return null;
    let value;
    try {
      value = game.api[name].apply(null, args);
    } catch (e) {
      if (e !== STOP) log(`引擎錯誤：${e.message}`, 'bad');
    }
    scene.onAction(name, args);
    scene.sync();
    updateHud();
    if (game.status !== 'playing') endRun();
    return value === undefined ? null : value;
  }

  function endRun() {
    running = false;
    runner.terminate(); // 中止腳本（等同 prototype 的 throw STOP）；collector 以 terminated 收尾
    setRunUi(false);
    const win = game.status === 'won';
    const st = game.state;
    const par = LEVELS[LEVEL_IDX].par;
    els.resultTitle.textContent = win ? '通關！' : '你死了';
    els.resultTitle.style.color = win ? '#5dcaa5' : '#f09595';
    els.resultStats.textContent = `回合 ${st.turn}${win && par ? `／par ${par}${st.turn <= par ? ' ⭐' : ''}` : ''} ・ 擊殺 ${st.kills} ・ 共受到 ${st.dmgTaken} 點傷害`;
    els.resultHint.textContent = win
      ? (st.turn <= par ? '⭐ 低於 par！這份腳本很不錯。' : `比 par 多花 ${st.turn - par} 回合——更聰明的目標選擇或路線能更快。`)
      : `死因：${st.lastHit || '未知'} ── 改改程式再來一次`;
    els.leaveWin.style.display = win ? '' : 'none';
    els.result.style.display = 'flex';
    els.status.textContent = win ? '通關' : '死亡';
    log(win ? '=== 通關！ ===' : `=== 死亡（死因：${st.lastHit || '未知'}）===`, win ? 'good' : 'bad');
    if (win && onWin) onWin();
  }

  function saveCode() { if (editor) save({ code: editor.getDoc() }); }

  async function startRun(stepDelayMs) {
    if (running) return;
    ensureRunner();
    running = true;
    linesSeen = 0;
    setRunUi(true);
    els.log.innerHTML = '';
    resetGame();
    saveCode();
    log('=== 開始執行 ===', 'sys');
    while (running) {
      const before = game.state.turn;
      const c = runner.run(editor.getDoc(), { actionSpecs: ACTION_SPECS, stepDelayMs, maxSteps: MAX_STEPS });
      const r = await c.promise;
      if (!running) break; // endRun / 手動停止已處理
      if (r.status === 'error') {
        log(`程式錯誤${r.line ? `（行 ${r.line}）` : ''}：${r.message}`, 'bad');
        els.status.textContent = `程式錯誤${r.line ? `（行 ${r.line}）` : ''}`;
        break;
      }
      if (r.status === 'aborted') {
        log('腳本被步數上限攔下——可能是沒有行動的無限迴圈（迴圈內要有 move/attack 等行動函式）', 'bad');
        els.status.textContent = '已強制中止（步數上限）';
        break;
      }
      if (r.status === 'terminated') break;
      if (game.status !== 'playing') break;
      if (game.state.turn === before) {
        log('腳本跑完一輪但沒有執行任何行動，已停止（至少要呼叫一個行動函式）', 'warn');
        els.status.textContent = '已停止（零行動）';
        break;
      }
    }
    running = false;
    setRunUi(false);
    editor.setExecHighlight(null);
  }

  function stopRun() {
    if (!running) return;
    running = false;
    runner.terminate();
    setRunUi(false);
    els.status.textContent = '已手動停止';
    log('已手動停止', 'sys');
  }

  /* ---------- 按鈕 ---------- */
  els.run.onclick = () => startRun(120);
  els.fast.onclick = () => startRun(0);
  els.stop.onclick = stopRun;
  els.reset.onclick = () => { if (!running) { els.log.innerHTML = ''; resetGame(); els.status.textContent = '已重置'; } };
  els.restore.onclick = () => { if (!running) { editor.setDoc(STARTER_CODE); els.status.textContent = '已還原初始腳本'; } };
  els.vim.onclick = () => {
    vimOn = !vimOn;
    editor.setVim(vimOn);
    els.vim.textContent = `Vim: ${vimOn ? 'ON' : 'OFF'}`;
    save({ vim: vimOn });
  };
  els.leave.onclick = () => leave();
  els.leaveWin.onclick = () => leave();
  els.close.onclick = () => { els.result.style.display = 'none'; };

  function enter() {
    ensureEditor();
    document.body.classList.add('ide-mode');
    els.levelLabel.textContent = `L1 ${LEVELS[LEVEL_IDX].name} — par ${LEVELS[LEVEL_IDX].par} 回合`;
    els.log.innerHTML = '';
    els.status.textContent = '寫好腳本後按 ▶ 執行';
    resetGame();
    log(`「${LEVELS[LEVEL_IDX].name}」：${LEVELS[LEVEL_IDX].hint}`, 'sys');
    return scene.container;
  }

  function leave() {
    stopRun();
    saveCode();
    document.body.classList.remove('ide-mode');
    els.result.style.display = 'none';
    onLeave();
  }

  function update(dtMs) { scene.update(dtMs); }

  // 無頭驗收掛勾
  const hooks = {
    status: () => (game ? game.status : null),
    running: () => running,
    turn: () => (game ? game.state.turn : 0),
    par: () => LEVELS[LEVEL_IDX].par,
    linesSeen: () => linesSeen,
    getCode: () => { ensureEditor(); return editor.getDoc(); },
    setCode: (code) => { ensureEditor(); editor.setDoc(code); },
    logHas: (text) => els.log.textContent.includes(text),
    vimOn: () => vimOn,
    setCursorLine: (n) => editor.helpers.setCursorLine(n),
    lineNumberTexts: () => editor.helpers.lineNumberTexts(),
  };

  return { enter, leave, update, hooks };
}
