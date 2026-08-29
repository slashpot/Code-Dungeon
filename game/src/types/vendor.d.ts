// 無官方型別的第三方套件——只宣告本專案用到的最小介面。

declare module 'js-interpreter' {
  export default class Interpreter {
    constructor(code: string, initFunc?: (interp: Interpreter, globalObj: unknown) => void);
    paused_: boolean;
    step(): boolean;
    getStateStack(): Array<{ node: { type: string; loc?: { start: { line: number } } } | null }>;
    setProperty(obj: unknown, name: string, value: unknown): void;
    createNativeFunction(fn: (...args: never[]) => unknown): unknown;
    createAsyncFunction(fn: (...args: never[]) => void): unknown;
    pseudoToNative(v: unknown): unknown;
    nativeToPseudo(v: unknown): unknown;
  }
}

declare module '@babel/standalone' {
  export function transform(
    code: string,
    opts: { presets?: unknown[]; retainLines?: boolean; sourceType?: string }
  ): { code: string };
}
