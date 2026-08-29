// Web Worker：跑 JS-Interpreter（ES5）＋ Babel 前置轉譯（const/箭頭函式 → ES5，retainLines 保行號）。
// statement 層級逐行事件、步數上限、行動函式 async 閘門（等主執行緒回覆才繼續）。
// worker.terminate() 是主執行緒側的最終防線。
import Interpreter from 'js-interpreter';
import * as Babel from '@babel/standalone';
import type { ActionSpec, WorkerIn, WorkerOut } from './protocol.ts';

// Worker 全域（不引入 WebWorker lib，宣告最小介面即可）
const ctx = self as unknown as {
  postMessage(msg: WorkerOut): void;
  onmessage: ((e: { data: WorkerIn }) => void) | null;
};

let interp: Interpreter | null = null;
let running = false;
let steps = 0;
let maxSteps = 500000;
let stepDelayMs = 0;
let startTime = 0;
let lastLine = -1;
let pendingCb: ((v: unknown) => void) | null = null; // 直譯器是序列執行，同時最多一個未回覆的行動
let actionSpecs: ActionSpec[] = [];

const STMT_RE = /(?:Statement|Declaration)$/;

function post(msg: WorkerOut): void { ctx.postMessage(msg); }

function toES5(src: string): string {
  return Babel.transform(src, {
    presets: [['env', { targets: { ie: '11' } }]],
    retainLines: true,
    sourceType: 'script',
  }).code;
}

function makeApi(i: Interpreter, globalObj: unknown): void {
  // 行動/感知 API：async 閘門——呼叫時暫停直譯器，postMessage 給主執行緒，收到 result 才放行。
  // 參數/回傳值跨越 interpreter↔worker 邊界要做 pseudo↔native 轉換
  //（getEnemies 回物件陣列、attack(t) 收物件；primitive 會原樣通過）。
  // createAsyncFunction 依函式 arity 決定 callback 位置，不能用 rest 參數（length=0 會爆），
  // 故依 spec.arity 固定簽名（API v0 最多 1 個參數）。
  for (const spec of actionSpecs) {
    const name = spec.name;
    let fn: (...args: never[]) => void;
    if ((spec.arity | 0) === 0) {
      fn = function (cb: (v: unknown) => void) {
        pendingCb = cb;
        post({ type: 'action', name, args: [] });
      };
    } else {
      fn = function (a: unknown, cb: (v: unknown) => void) {
        pendingCb = cb;
        post({ type: 'action', name, args: a === undefined ? [] : [i.pseudoToNative(a)] });
      };
    }
    i.setProperty(globalObj, name, i.createAsyncFunction(fn));
  }
  i.setProperty(globalObj, 'log', i.createNativeFunction(function (v: unknown) {
    post({ type: 'log', text: String(v) });
  }));
}

function pump(): void {
  if (!running || !interp) return;
  const sliceEnd = steps + 2000; // 分片跑，讓 worker 事件圈保持可回應
  while (steps < sliceEnd) {
    if (interp.paused_) return; // 等主執行緒回 result，onmessage 會再叫 pump
    let more: boolean;
    try {
      more = interp.step();
    } catch (e) {
      running = false;
      const err = e as { loc?: { line: number }; message?: string } | null;
      post({ type: 'error', message: String((err && err.message) || e), line: err && err.loc ? err.loc.line : null });
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

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'run') {
    steps = 0;
    lastLine = -1;
    pendingCb = null;
    maxSteps = m.maxSteps || 500000;
    stepDelayMs = m.stepDelayMs || 0;
    actionSpecs = m.actionSpecs || [];
    let code: string;
    try {
      code = toES5(m.code);
    } catch (err) {
      const er = err as { loc?: { line: number }; message?: string } | null;
      post({ type: 'error', message: '語法錯誤: ' + ((er && er.message) || err), line: er && er.loc ? er.loc.line : null });
      return;
    }
    try {
      interp = new Interpreter(code, makeApi);
    } catch (err) {
      const er = err as { message?: string } | null;
      post({ type: 'error', message: String((er && er.message) || err), line: null });
      return;
    }
    running = true;
    startTime = performance.now();
    post({ type: 'started' });
    pump();
  } else if (m.type === 'result') {
    if (pendingCb && interp) {
      const cb = pendingCb;
      pendingCb = null;
      cb(interp.nativeToPseudo(m.value));
      if (running) pump();
    }
  }
};

post({ type: 'ready' });
