// worker（直譯器）↔ 主執行緒的訊息協定，worker.ts / runner.ts / controller.ts 共用。

// createAsyncFunction 依函式 arity 決定 callback 位置，故每個 API 函式要宣告固定簽名。
export interface ActionSpec { name: string; arity: 0 | 1 }

export type WorkerIn =
  | { type: 'run'; code: string; actionSpecs?: ActionSpec[]; maxSteps?: number; stepDelayMs?: number }
  | { type: 'result'; value: unknown };

export type WorkerOut =
  | { type: 'ready' }
  | { type: 'started' }
  | { type: 'action'; name: string; args: unknown[] }
  | { type: 'line'; line: number }
  | { type: 'log'; text: string }
  | { type: 'done'; steps: number; ms: number }
  | { type: 'aborted'; reason: string; steps: number; ms: number }
  | { type: 'error'; message: string; line: number | null };
