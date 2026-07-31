// 主執行緒：遊戲畫面（canvas）、CodeMirror 6 編輯器（JS 高亮＋vim）、worker 協調、自動驗收掛勾。
import { basicSetup } from 'codemirror';
import { EditorView, Decoration } from '@codemirror/view';
import { EditorState, StateEffect, StateField, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { vim, getCM } from '@replit/codemirror-vim';

// ---------- 遊戲（極簡：夠驗證 move/attack 委派即可） ----------
const MAP = [
  '########',
  '#......#',
  '#h...s>#',
  '#......#',
  '########',
];
const TILE = 44;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const game = { hero: null, enemy: null, stairs: null, win: false };

function resetGame() {
  game.win = false;
  for (let y = 0; y < MAP.length; y++) {
    for (let x = 0; x < MAP[y].length; x++) {
      const c = MAP[y][x];
      if (c === 'h') game.hero = { x, y, hp: 50, atk: 6 };
      else if (c === 's') game.enemy = { x, y, hp: 10, alive: true };
      else if (c === '>') game.stairs = { x, y };
    }
  }
  render();
}

function tileAt(x, y) {
  const c = (MAP[y] || '')[x];
  return c === undefined ? '#' : (c === '#' ? '#' : '.');
}

function applyAction(name, args) {
  const h = game.hero;
  const e = game.enemy;
  switch (name) {
    case 'move': {
      const d = DIRS[args[0]];
      if (!d) { uiLog(`move(${args[0]}) 無效方向`); return 'bad-dir'; }
      const nx = h.x + d[0]; const ny = h.y + d[1];
      if (tileAt(nx, ny) === '#' || (e.alive && e.x === nx && e.y === ny)) {
        uiLog(`move(${args[0]}) → 被擋住`);
        return 'blocked';
      }
      h.x = nx; h.y = ny;
      if (h.x === game.stairs.x && h.y === game.stairs.y) {
        game.win = true;
        uiLog(`move(${args[0]}) → 🏁 到達樓梯`);
      } else {
        uiLog(`move(${args[0]}) → (${h.x},${h.y})`);
      }
      return 'ok';
    }
    case 'attack': {
      if (!e.alive || Math.abs(e.x - h.x) + Math.abs(e.y - h.y) !== 1) {
        uiLog('attack() → 沒有相鄰目標');
        return -1;
      }
      e.hp -= h.atk;
      if (e.hp <= 0) { e.alive = false; uiLog('attack() → 💀 史萊姆倒下'); }
      else uiLog(`attack() → 史萊姆剩 ${e.hp} HP`);
      return Math.max(e.hp, 0);
    }
    case 'enemyHp': return game.enemy.alive ? game.enemy.hp : 0;
    case 'myX': return h.x;
    case 'myY': return h.y;
    default: return null;
  }
}

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');

function render() {
  ctx.fillStyle = '#14161c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < MAP.length; y++) {
    for (let x = 0; x < MAP[y].length; x++) {
      ctx.fillStyle = tileAt(x, y) === '#' ? '#3a3f4d' : '#1e222c';
      ctx.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
    }
  }
  const s = game.stairs;
  ctx.fillStyle = '#e6c453';
  ctx.font = `${TILE * 0.6}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('>', s.x * TILE + TILE / 2, s.y * TILE + TILE / 2);
  if (game.enemy.alive) {
    ctx.fillStyle = '#67c26b';
    ctx.beginPath();
    ctx.arc(game.enemy.x * TILE + TILE / 2, game.enemy.y * TILE + TILE / 2, TILE * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#dfe6ef';
    ctx.font = '11px monospace';
    ctx.fillText(`${game.enemy.hp}`, game.enemy.x * TILE + TILE / 2, game.enemy.y * TILE + 6);
  }
  ctx.fillStyle = '#5aa2e8';
  ctx.beginPath();
  ctx.arc(game.hero.x * TILE + TILE / 2, game.hero.y * TILE + TILE / 2, TILE * 0.34, 0, Math.PI * 2);
  ctx.fill();
}

const logEl = document.getElementById('log');
function uiLog(text) {
  const div = document.createElement('div');
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

// ---------- Worker 協調 ----------
// collector：每次 run 收集事件並回傳 promise，UI 與自動驗收共用同一條路徑。
const runner = {
  worker: null,
  collector: null,
  spawn() {
    this.worker = new Worker('dist/worker.js');
    const w = this.worker;
    w.onmessage = (e) => {
      if (this.worker !== w) { // terminate 後的殘留訊息（理論上不會發生，驗收會盯這個）
        if (this.collector) this.collector.staleMessages++;
        return;
      }
      this.route(e.data);
    };
  },
  route(m) {
    const c = this.collector;
    switch (m.type) {
      case 'action': {
        const value = applyAction(m.name, m.args);
        render();
        if (c) c.actions.push({ name: m.name, args: m.args });
        this.worker.postMessage({ type: 'result', value });
        break;
      }
      case 'line':
        if (c) c.lines.push(m.line);
        setExecHighlight(m.line);
        break;
      case 'log':
        uiLog(`[log] ${m.text}`);
        if (c) c.logs.push(m.text);
        break;
      case 'hanging':
        uiLog('worker 進入 native 卡死（hang）');
        if (c) c.hanging = true;
        break;
      case 'started':
        setStatus('執行中…');
        break;
      case 'done':
        setExecHighlight(null);
        setStatus(`完成：${m.steps} steps / ${m.ms}ms`);
        if (c) c.settle({ status: 'done', steps: m.steps, ms: m.ms });
        break;
      case 'aborted':
        setExecHighlight(null);
        setStatus(`🛑 超過步數上限（${m.steps} steps / ${m.ms}ms）強制中止`);
        uiLog(`🛑 步數上限攔截：${m.steps} steps，${m.ms}ms`);
        if (c) c.settle({ status: 'aborted', reason: m.reason, steps: m.steps, ms: m.ms });
        break;
      case 'error':
        setExecHighlight(null);
        setStatus(`腳本錯誤${m.line ? `(行 ${m.line})` : ''}：${m.message}`);
        uiLog(`❌ ${m.message}`);
        if (c) c.settle({ status: 'error', message: m.message, line: m.line });
        break;
    }
  },
  run(code, opts = {}) {
    if (!this.worker) this.spawn();
    resetGame();
    logEl.textContent = '';
    const collector = {
      lines: [], actions: [], logs: [], hanging: false, staleMessages: 0,
      settle: null, promise: null,
    };
    collector.promise = new Promise((resolve) => {
      collector.settle = (r) => { if (this.collector === collector) this.collector = null; resolve(r); };
    });
    this.collector = collector;
    this.worker.postMessage({ type: 'run', code, maxSteps: opts.maxSteps, stepDelayMs: opts.stepDelayMs });
    return collector;
  },
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.collector) this.collector.settle({ status: 'terminated' });
    setExecHighlight(null);
    setStatus('已強制終止（worker.terminate）');
  },
};

const statusEl = document.getElementById('status');
function setStatus(t) { statusEl.textContent = t; }

// ---------- 編輯器（CodeMirror 6 ＋ vim） ----------
const setExecLine = StateEffect.define();
const execLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setExecLine)) {
        if (e.value == null || e.value > tr.state.doc.lines) deco = Decoration.none;
        else {
          const line = tr.state.doc.line(e.value);
          deco = Decoration.set([Decoration.line({ class: 'exec-line' }).range(line.from)]);
        }
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const vimCompartment = new Compartment();
let vimEnabled = true;

const SAMPLE = `// 走到史萊姆旁邊、打死牠、走上樓梯（const/箭頭函式 = ES6）
const dirs = ['right', 'right', 'right'];
for (let i = 0; i < dirs.length; i++) {
  move(dirs[i]);
}
const poke = () => attack();
while (enemyHp() > 0) {
  poke();
}
move('right');
move('right');
log('到達樓梯!');
`;

const LOOP_SAMPLE = `try {
  while (true) {}
} catch (e) {
  log('caught'); // 若這行執行到，代表防呆被玩家 try/catch 吃掉 = 失敗
}
`;

const HANG_SAMPLE = `// hang() 模擬「永不返回的 native 呼叫」：步數上限攔不到，
// 只能靠主執行緒 worker.terminate()（按 ■ 停止）。遊戲畫面不會卡死。
hang();
`;

const view = new EditorView({
  state: EditorState.create({
    doc: SAMPLE,
    extensions: [
      vimCompartment.of(vim({ status: true })),
      basicSetup,
      javascript(),
      execLineField,
      EditorView.theme({}, { dark: true }),
    ],
  }),
  parent: document.getElementById('editor'),
});

function setExecHighlight(line) {
  view.dispatch({ effects: setExecLine.of(line) });
}

function setDoc(text) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

// ---------- UI 按鈕 ----------
document.getElementById('btn-run').onclick = () => runner.run(view.state.doc.toString(), { stepDelayMs: 120 });
document.getElementById('btn-fast').onclick = () => runner.run(view.state.doc.toString(), { stepDelayMs: 0 });
document.getElementById('btn-stop').onclick = () => runner.terminate();
document.getElementById('btn-sample').onclick = () => setDoc(SAMPLE);
document.getElementById('btn-loop').onclick = () => setDoc(LOOP_SAMPLE);
document.getElementById('btn-hang').onclick = () => setDoc(HANG_SAMPLE);
const vimBtn = document.getElementById('btn-vim');
vimBtn.onclick = () => {
  vimEnabled = !vimEnabled;
  view.dispatch({ effects: vimCompartment.reconfigure(vimEnabled ? vim({ status: true }) : []) });
  vimBtn.textContent = `Vim: ${vimEnabled ? 'ON' : 'OFF'}`;
};

resetGame();
setStatus('就緒');

// ---------- 自動驗收（headless 由 test/acceptance.js 驅動） ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(20);
  }
}

window.__helpers = {
  setDoc,
  getDoc: () => view.state.doc.toString(),
  cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
  cursorCh: () => {
    const head = view.state.selection.main.head;
    return head - view.state.doc.lineAt(head).from;
  },
  focus: () => view.focus(),
  vimInsertMode: () => {
    const cm = getCM(view);
    return !!(cm && cm.state.vim && cm.state.vim.insertMode);
  },
};

window.runAcceptance = async function runAcceptance() {
  const results = {};

  // ①＋② 場景委派＋逐行行號：跑 ES6 範例（const/箭頭函式），全速收 line/action 事件
  {
    const c = runner.run(SAMPLE, { stepDelayMs: 0 });
    const r = await Promise.race([c.promise, sleep(15000).then(() => ({ status: 'timeout' }))]);
    const moves = c.actions.filter((a) => a.name === 'move').map((a) => a.args[0]);
    const attacks = c.actions.filter((a) => a.name === 'attack').length;
    const sceneOk = r.status === 'done'
      && game.hero.x === 6 && game.hero.y === 2
      && !game.enemy.alive && game.win
      && moves.length === 5 && attacks === 2
      && c.logs.includes('到達樓梯!');
    results.scene = {
      pass: sceneOk,
      detail: `status=${r.status} hero=(${game.hero.x},${game.hero.y}) win=${game.win} moves=${moves.length} attacks=${attacks}`,
    };

    const count = (ln) => c.lines.filter((x) => x === ln).length;
    const mustVisit = [2, 3, 4, 6, 7, 8, 10, 11, 12];
    const visitedAll = mustVisit.every((ln) => count(ln) > 0);
    const stepOk = visitedAll && count(4) >= 3 && count(8) >= 2 && count(1) === 0
      && c.lines.every((ln) => ln >= 1 && ln <= 12);
    results.stepping = {
      pass: stepOk,
      detail: `lines=${c.lines.length} 事件，迴圈行4×${count(4)} 行8×${count(8)}，註解行1×${count(1)}，序列頭=${c.lines.slice(0, 12).join(',')}`,
    };
  }

  // ③a 步數上限：while(true) 全速被攔，且玩家 try/catch 吃不掉
  {
    const c = runner.run(LOOP_SAMPLE, { stepDelayMs: 0, maxSteps: 200000 });
    const r = await Promise.race([c.promise, sleep(30000).then(() => ({ status: 'timeout' }))]);
    const budgetOk = r.status === 'aborted' && r.reason === 'budget' && !c.logs.includes('caught');
    results.budget = {
      pass: budgetOk,
      detail: `status=${r.status} steps=${r.steps} ms=${r.ms} caught=${c.logs.includes('caught')}`,
      ms: r.ms, steps: r.steps,
    };
  }

  // ③b worker.terminate()：native 卡死時主執行緒照常跳動，terminate 後可重生
  {
    let ticks = 0;
    const iv = setInterval(() => { ticks++; }, 25);
    const c = runner.run('hang();', { stepDelayMs: 0 });
    await waitFor(() => c.hanging, 5000, 'worker hanging');
    const ticksAtHang = ticks;
    await sleep(500); // worker 卡死期間主執行緒應照常跳動
    const ticksDuring = ticks - ticksAtHang;
    runner.terminate();
    await sleep(300);
    const stale = c.staleMessages;
    const c2 = runner.run("log('revived');", { stepDelayMs: 0 });
    const r2 = await Promise.race([c2.promise, sleep(10000).then(() => ({ status: 'timeout' }))]);
    clearInterval(iv);
    const termOk = ticksDuring >= 10 && stale === 0 && r2.status === 'done' && c2.logs.includes('revived');
    results.terminate = {
      pass: termOk,
      detail: `卡死期間主執行緒 tick=${ticksDuring}（500ms 應≈20），殘留訊息=${stale}，重生後執行=${r2.status}`,
    };
  }

  // ④ 編輯器＋JS 語法高亮：doc 設回範例後應有大量 token span
  {
    setDoc(SAMPLE);
    await sleep(100);
    const tokenSpans = document.querySelectorAll('.cm-editor .cm-line span[class]').length;
    results.editor = {
      pass: !!document.querySelector('.cm-editor') && tokenSpans >= 10,
      detail: `token spans=${tokenSpans}`,
    };
  }

  window.__RESULTS__ = results;
  return results;
};

window.__READY__ = true;
