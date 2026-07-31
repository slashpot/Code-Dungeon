// 主執行緒側的 worker 協調器，自 spike-web main.js 抽出、與 DOM 解耦（M2 接上 dungeon）。
// collector：每次 run 收集事件並回傳 promise，UI 與自動驗收共用同一條路徑。
export function createRunner({ createWorker, applyAction, onLine, onLog, onStatus }) {
  const runner = {
    worker: null,
    collector: null,
    spawn() {
      this.worker = createWorker();
      const w = this.worker;
      w.onmessage = (e) => {
        if (this.worker !== w) { // terminate 後的殘留訊息
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
          if (c) c.actions.push({ name: m.name, args: m.args });
          // applyAction 可能觸發 endRun→terminate（死亡/通關即中止腳本），此時不需回覆
          if (this.worker) this.worker.postMessage({ type: 'result', value });
          break;
        }
        case 'line':
          if (c) c.lines.push(m.line);
          if (onLine) onLine(m.line);
          break;
        case 'log':
          if (c) c.logs.push(m.text);
          if (onLog) onLog(m.text);
          break;
        case 'started':
          if (onStatus) onStatus({ state: 'started' });
          break;
        case 'done':
          if (onLine) onLine(null);
          if (onStatus) onStatus({ state: 'done', steps: m.steps, ms: m.ms });
          if (c) c.settle({ status: 'done', steps: m.steps, ms: m.ms });
          break;
        case 'aborted':
          if (onLine) onLine(null);
          if (onStatus) onStatus({ state: 'aborted', reason: m.reason, steps: m.steps, ms: m.ms });
          if (c) c.settle({ status: 'aborted', reason: m.reason, steps: m.steps, ms: m.ms });
          break;
        case 'error':
          if (onLine) onLine(null);
          if (onStatus) onStatus({ state: 'error', message: m.message, line: m.line });
          if (c) c.settle({ status: 'error', message: m.message, line: m.line });
          break;
      }
    },
    run(code, opts = {}) {
      if (!this.worker) this.spawn();
      const collector = {
        lines: [], actions: [], logs: [], staleMessages: 0,
        settle: null, promise: null,
      };
      collector.promise = new Promise((resolve) => {
        collector.settle = (r) => { if (this.collector === collector) this.collector = null; resolve(r); };
      });
      this.collector = collector;
      this.worker.postMessage({
        type: 'run',
        code,
        actionSpecs: opts.actionSpecs,
        maxSteps: opts.maxSteps,
        stepDelayMs: opts.stepDelayMs,
      });
      return collector;
    },
    terminate() {
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      if (this.collector) this.collector.settle({ status: 'terminated' });
      if (onLine) onLine(null);
      if (onStatus) onStatus({ state: 'terminated' });
    },
  };
  return runner;
}
