/*
 * 對拍參照跑器：在 Node 裡跑 prototype 的引擎（sloppy eval，同 prototype/test/headless.js 手法），
 * 逐回合記錄狀態 trace，輸出 JSON 給 engine.test.js 比對。
 *
 * 用法（子行程）：CASE=<腳本名> LV=<關卡索引> CAP=<回合上限> node test/proto-ref.cjs
 * 輸出：stdout 一行 "TRACE_JSON:" + {outcome, trace}
 *
 * 注意：本檔刻意「不」使用 "use strict"——靠 sloppy mode 的 direct eval
 * 讓遊戲腳本的 var/function 宣告洩漏到本層作用域。
 */
const fs = require("fs");
const path = require("path");

const HTML_PATH = path.join(__dirname, "..", "..", "prototype", "Code Dungeon Prototype.html");
const SCRIPTS = require("./scripts.cjs");

const name = process.env.CASE;
const levelIdx = parseInt(process.env.LV || "0", 10);
const CAP = parseInt(process.env.CAP || "4000", 10);
const script = SCRIPTS[name];
if (!script) { console.error("unknown case: " + name); process.exit(2); }

/* ---------- DOM/localStorage stub（同 prototype 測試） ---------- */
const elements = {};
const fakeEl = () => ({
  style: {}, innerHTML: "", textContent: "", value: "", checked: false,
  children: [], appendChild(c) { this.children.push(c); }, removeChild() { this.children.shift(); },
  addEventListener() {}, scrollTop: 0, scrollHeight: 0, open: false, disabled: false
});
global.window = global;
global.document = {
  getElementById(id) { if (!elements[id]) elements[id] = fakeEl(); return elements[id]; },
  createElement: fakeEl,
  querySelector: fakeEl
};
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
store["codeDungeonProtoV2"] = JSON.stringify({ cur: levelIdx, unlocked: 99 });
document.getElementById("editor").value = script;

/* ---------- 抽出並 patch 遊戲腳本 ---------- */
let js = fs.readFileSync(HTML_PATH, "utf-8").split("<script>")[1].split("</" + "script>")[0];
js = js.replace('"use strict";', "");
js = js.replace("var speedIdx = 0;", "var speedIdx = 3;"); // MAX 速度
// trace patch 點＝turn++ 之後、世界反應之前（新引擎的 onTick 對齊此點）
js = js.replace("state.turn++;",
  "state.turn++; global.__trace.push(global.__snap());" +
  " if (state.turn > " + CAP + ") { global.__timedOut = true; throw STOP; }");

global.__trace = [];
eval(js);

global.__snap = function () {
  return {
    turn: state.turn,
    x: state.hero.x, y: state.hero.y, hp: state.hero.hp, potions: state.hero.potions,
    enemies: state.enemies.map(function (e) { return [e.id, e.x, e.y, e.hp]; })
  };
};

startRun().then(function () {
  let outcome;
  if (global.__timedOut) outcome = "TIMEOUT";
  else if (state.hero.hp <= 0) outcome = "DEAD";
  else if (state.hero.x === state.stairs.x && state.hero.y === state.stairs.y) outcome = "WIN";
  else if (state.turn === 0) outcome = "IDLE";
  else outcome = "ENDED";
  console.log("TRACE_JSON:" + JSON.stringify({ outcome: outcome, turns: state.turn, trace: global.__trace }));
}).catch(function (e) {
  console.error("HARNESS ERROR:", e && e.stack || e);
  process.exit(1);
});
