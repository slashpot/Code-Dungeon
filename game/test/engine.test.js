// 引擎移植的 node 測試：連通性（全 6 關）＋ L1 難度案例 ＋ 與 prototype 引擎的逐回合對拍。
// 跑法：node test/engine.test.js（npm test 會先跑這個再跑瀏覽器驗收）
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createGame, STOP } from "../src/engine/engine.js";
import { LEVELS } from "../src/engine/levels.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = createRequire(import.meta.url)("./scripts.cjs");
const TURN_CAP = 4000;

let pass = 0, fail = 0;
function check(label, ok, detail) {
  ok ? pass++ : fail++;
  console.log((ok ? "PASS" : "FAIL") + "  " + label + (detail ? "  " + detail : ""));
}

/* ---------- 新引擎的腳本驅動器（同 prototype startRun 的重跑語意） ---------- */
function runScript(levelIdx, code, opts = {}) {
  const trace = [];
  const game = createGame(LEVELS[levelIdx], {
    turnCap: TURN_CAP,
    onTick: opts.trace ? (s) => trace.push({
      turn: s.turn, x: s.hero.x, y: s.hero.y, hp: s.hero.hp, potions: s.hero.potions,
      enemies: s.enemies.map((e) => [e.id, e.x, e.y, e.hp]),
    }) : null,
  });
  const keys = Object.keys(game.api);
  const fn = new Function(...keys, code);
  const vals = keys.map((k) => game.api[k]);
  let outcome = null;
  while (game.status === "playing") {
    const before = game.state.turn;
    try {
      fn(...vals);
    } catch (e) {
      if (e !== STOP) throw e;
      break;
    }
    if (game.state.turn === before) { outcome = before === 0 ? "IDLE" : "ENDED"; break; }
  }
  if (!outcome) {
    outcome = { won: "WIN", dead: "DEAD", timeout: "TIMEOUT" }[game.status] || "ENDED";
  }
  return { outcome, turns: game.state.turn, trace, game };
}

/* ---------- 1. 連通性檢查（全 6 關） ---------- */
console.log("=== 連通性檢查 ===");
for (let i = 0; i < LEVELS.length; i++) {
  const g = createGame(LEVELS[i]);
  const widthOk = LEVELS[i].map.every((row) => row.length === g.W);
  const stairsOk = !!g.bfs(g.state.hero.x, g.state.hero.y, (x, y) => x === g.state.stairs.x && y === g.state.stairs.y);
  const itemsOk = g.state.items.every((it) => !!g.bfs(g.state.hero.x, g.state.hero.y, (x, y) => x === it.x && y === it.y));
  const parOk = typeof LEVELS[i].par === "number" && LEVELS[i].par > 0;
  check(`L${i + 1} ${LEVELS[i].name}`, widthOk && stairsOk && itemsOk && parOk,
    `等寬:${widthOk} 樓梯可達:${stairsOk} 道具可達:${itemsOk} par:${parOk ? LEVELS[i].par : "缺"}`);
}

/* ---------- 2. L1 難度案例（v0.1 遊戲內只有 L1） ---------- */
console.log("=== L1 案例 ===");
{
  const r = runScript(0, SCRIPTS.naive);
  check("L1 初始腳本通關且 turns ≤ par", r.outcome === "WIN" && r.turns <= LEVELS[0].par,
    `outcome=${r.outcome} turns=${r.turns} par=${LEVELS[0].par}`);
}
{
  const r = runScript(0, SCRIPTS.es6);
  check("L1 ES6 語法（const/箭頭）可用", r.outcome === "WIN", `outcome=${r.outcome} turns=${r.turns}`);
}
{
  const r = runScript(0, SCRIPTS.idle);
  check("零行動腳本被防呆擋下", r.outcome === "IDLE", `outcome=${r.outcome}`);
}

/* ---------- 3. 對拍：prototype 引擎 vs 新引擎，逐回合狀態一致 ---------- */
console.log("=== 對拍（vs prototype 引擎） ===");
const PARITY_CASES = [
  ["naive @ L1", "naive", 0],
  ["es6 @ L1", "es6", 0],
  ["stock @ L1", "stock", 0],
  ["smart @ L2（毒沼/藥水路徑）", "smart", 1],
  ["pro @ L4（多敵混戰路徑）", "pro", 3],
];
for (const [label, scriptName, lv] of PARITY_CASES) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "test", "proto-ref.cjs")], {
    env: { ...process.env, CASE: scriptName, LV: String(lv), CAP: String(TURN_CAP) },
    encoding: "utf-8", timeout: 60000,
  });
  const m = (r.stdout || "").match(/TRACE_JSON:(.*)/);
  if (!m) {
    check(`對拍 ${label}`, false, `prototype 參照跑器無輸出（stderr: ${(r.stderr || "").slice(0, 200)}）`);
    continue;
  }
  const ref = JSON.parse(m[1]);
  const mine = runScript(lv, SCRIPTS[scriptName], { trace: true });
  const outcomeOk = ref.outcome === mine.outcome && ref.turns === mine.turns;
  let traceOk = ref.trace.length === mine.trace.length;
  let firstDiff = -1;
  if (traceOk) {
    for (let i = 0; i < ref.trace.length; i++) {
      if (JSON.stringify(ref.trace[i]) !== JSON.stringify(mine.trace[i])) { traceOk = false; firstDiff = i; break; }
    }
  }
  check(`對拍 ${label}`, outcomeOk && traceOk,
    `proto=${ref.outcome}/${ref.turns}t vs new=${mine.outcome}/${mine.turns}t trace=${ref.trace.length}:${mine.trace.length}筆` +
    (firstDiff >= 0 ? ` 首異@${firstDiff}: proto=${JSON.stringify(ref.trace[firstDiff])} new=${JSON.stringify(mine.trace[firstDiff])}` : ""));
}

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
