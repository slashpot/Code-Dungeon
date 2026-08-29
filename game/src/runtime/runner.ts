// 主執行緒側的 worker 協調器（與 DOM 解耦）。
// collector：每次 run 收集事件並回傳 promise，UI 與自動驗收共用同一條路徑。
import type { ActionSpec, WorkerIn, WorkerOut } from './protocol.ts';

export interface RunResult {
  status: 'done' | 'aborted' | 'error' | 'terminated';
  steps?: number;
  ms?: number;
  reason?: string;
  message?: string;
  line?: number | null;
}

export interface Collector {
  lines: number[];
  actions: Array<{ name: string; args: unknown[] }>;
  logs: string[];
  staleMessages: number;
  settle: (r: RunResult) => void;
  promise: Promise<RunResult>;
}

export interface RunOpts {
  actionSpecs?: ActionSpec[];
  maxSteps?: number;
  stepDelayMs?: number;
}

export interface RunnerCallbacks {
  createWorker: () => Worker;
  applyAction: (name: string, args: unknown[]) => unknown;
  onLine?: (line: number | null) => void;
  onLog?: (text: string) => void;
  onStatus?: (s: { state: string; [k: string]: unknown }) => void;
}

export interface Runner {
  worker: Worker | null;
  collector: Collector | null;
  spawn(): void;
  route(m: WorkerOut): void;
  run(code: string, opts?: RunOpts): Collector;
  terminate(): void;
}

export function createRunner({ createWorker, applyAction, onLine, onLog, onStatus }: RunnerCallbacks): Runner {
  const runner: Runner = {
    worker: null,
    collector: null,
    spawn() {
      this.worker = createWorker();
      const w = this.worker;
      w.onmessage = (e: MessageEvent) => {
        if (this.worker !== w) { // terminate 後的殘留訊息
          if (this.collector) this.collector.staleMessages++;
          return;
        }
        this.route(e.data as WorkerOut);
      };
    },
    route(m) {
      const c = this.collector;
      switch (m.type) {
        case 'action': {
          const value = applyAction(m.name, m.args);
          if (c) c.actions.push({ name: m.name, args: m.args });
          // applyAction 可能觸發 endRun→terminate（死亡/通關即中止腳本），此時不需回覆
          if (this.worker) this.worker.postMessage({ type: 'result', value } satisfies WorkerIn);
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
      const collector: Collector = {
        lines: [], actions: [], logs: [], staleMessages: 0,
        settle: () => {},
        promise: Promise.resolve({ status: 'terminated' }),
      };
      collector.promise = new Promise<RunResult>((resolve) => {
        collector.settle = (r) => { if (this.collector === collector) this.collector = null; resolve(r); };
      });
      this.collector = collector;
      this.worker!.postMessage({
        type: 'run',
        code,
        actionSpecs: opts.actionSpecs,
        maxSteps: opts.maxSteps,
        stepDelayMs: opts.stepDelayMs,
      } satisfies WorkerIn);
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
