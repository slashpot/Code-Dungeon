// Web Worker：跑 JS-Interpreter（ES5）＋ Babel 前置轉譯（const/箭頭函式 → ES5，retainLines 保行號）。
// 自 spike-web 移植；行動/感知函式清單改由 run 訊息的 actionSpecs 傳入（M2 綁 API v0 14 函式）。
// statement 層級逐行事件、步數上限、行動函式 async 閘門（等主執行緒回覆才繼續）。
// worker.terminate() 是主執行緒側的最終防線。
import Interpreter from 'js-interpreter';
import * as Babel from '@babel/standalone';

let interp = null;
let running = false;
let steps = 0;
let maxSteps = 500000;
let stepDelayMs = 0;
let startTime = 0;
let lastLine = -1;
let pendingCb = null; // 直譯器是序列執行，同時最多一個未回覆的行動
let actionSpecs = [];

const STMT_RE = /(?:Statement|Declaration)$/;

function post(msg) { self.postMessage(msg); }

function toES5(src) {
  return Babel.transform(src, {
    presets: [['env', { targets: { ie: '11' } }]],
    retainLines: true,
    sourceType: 'script',
  }).code;
}

function makeApi(i, globalObj) {
  // 行動/感知 API：async 閘門——呼叫時暫停直譯器，postMessage 給主執行緒，收到 result 才放行。
  // createAsyncFunction 依函式 arity 決定 callback 位置，不能用 rest 參數（length=0 會爆），
  // 故依 spec.arity 固定簽名（API v0 最多 2 個參數：distance(a,b)）。
  for (const spec of actionSpecs) {
    const name = spec.name;
    const arity = spec.arity | 0;
    let fn;
    if (arity === 0) {
      fn = function (cb) {
        pendingCb = cb;
        post({ type: 'action', name, args: [] });
      };
    } else if (arity === 1) {
      fn = function (a, cb) {
        pendingCb = cb;
        post({ type: 'action', name, args: a === undefined ? [] : [a] });
      };
    } else {
      fn = function (a, b, cb) {
        pendingCb = cb;
        const args = [];
        if (a !== undefined) args.push(a);
        if (b !== undefined) args.push(b);
        post({ type: 'action', name, args });
      };
    }
    i.setProperty(globalObj, name, i.createAsyncFunction(fn));
  }
  i.setProperty(globalObj, 'log', i.createNativeFunction(function (v) {
    post({ type: 'log', text: String(v) });
  }));
}

function pump() {
  if (!running) return;
  const sliceEnd = steps + 2000; // 分片跑，讓 worker 事件圈保持可回應
  while (steps < sliceEnd) {
    if (interp.paused_) return; // 等主執行緒回 result，onmessage 會再叫 pump
    let more;
    try {
      more = interp.step();
    } catch (e) {
      running = false;
      const line = e && e.loc ? e.loc.line : null;
      post({ type: 'error', message: String((e && e.message) || e), line });
      return;
    }
    steps++;
    if (!more) {
      running = false;
      post({ type: 'done', steps, ms: Math.round(performance.now() - startTime) });
      return;
    }
    if (steps > maxSteps) {
      // 步數上限：直接停在直譯器外面，玩家 JS 的 try/catch 攔不到
      running = false;
      post({ type: 'aborted', reason: 'budget', steps, ms: Math.round(performance.now() - startTime) });
      return;
    }
    const stack = interp.getStateStack();
    const node = stack[stack.length - 1].node;
    if (node && node.loc && STMT_RE.test(node.type)) {
      const line = node.loc.start.line;
      if (line !== lastLine) {
        lastLine = line;
        post({ type: 'line', line });
        if (stepDelayMs > 0) { setTimeout(pump, stepDelayMs); return; }
      }
    }
  }
  setTimeout(pump, 0);
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'run') {
    steps = 0;
    lastLine = -1;
    pendingCb = null;
    maxSteps = m.maxSteps || 500000;
    stepDelayMs = m.stepDelayMs || 0;
    actionSpecs = m.actionSpecs || [];
    let code;
    try {
      code = toES5(m.code);
    } catch (err) {
      const line = err && err.loc ? err.loc.line : null;
      post({ type: 'error', message: '語法錯誤: ' + ((err && err.message) || err), line });
      return;
    }
    try {
      interp = new Interpreter(code, makeApi);
    } catch (err) {
      post({ type: 'error', message: String((err && err.message) || err), line: null });
      return;
    }
    running = true;
    startTime = performance.now();
    post({ type: 'started' });
    pump();
  } else if (m.type === 'result') {
    if (pendingCb) {
      const cb = pendingCb;
      pendingCb = null;
      cb(m.value);
      if (running) pump();
    }
  }
};

post({ type: 'ready' });
