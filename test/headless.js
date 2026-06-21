#!/usr/bin/env node
/*
 * Code Dungeon prototype 無頭回歸測試
 *
 * 用法：node test/headless.js
 *
 * 做三件事：
 *  1. 連通性檢查：每關的樓梯與道具都從出生點可達、地圖每列等寬
 *  2. 難度曲線驗證：用不同等級的腳本跑各關，輸贏要符合預期
 *     （naive 應死在 L2、stock 應通 L5 ——關卡的「教學」就靠這個保證）
 *  3. 語法回歸：ES6 直線腳本可用、純運算腳本會被防呆擋下
 *
 * 原理：抽出 HTML 內的 <script>，stub 掉 DOM/localStorage 後在 Node 執行。
 * 每個 case 都 spawn 子行程跑，互不污染。
 *
 * 注意：本檔刻意「不」使用 "use strict" ——
 * 我們靠 sloppy mode 的 direct eval 讓遊戲腳本的 var/function 宣告
 * 洩漏到本層作用域（strict eval 會把宣告關進自己的 scope，拿不到 state/LEVELS）。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const HTML_PATH = path.join(__dirname, "..", "Code Dungeon Prototype.html");
const TURN_CAP = 4000;       // 超過視為卡死
const CASE_TIMEOUT = 30000;  // 單一 case 逾時（ms）

/* ---------- 測試用腳本（模擬不同程度的玩家） ---------- */
const SCRIPTS = {
  // 編輯器預設的初始腳本：無補血邏輯
  naive: `
var enemies = getEnemies();
if (enemies.length > 0) {
  var t = nearest(enemies);
  if (distance(t) <= 1) attack(t);
  else moveToward(t);
} else {
  explore();
}`,
  // 加上喝藥水、先打血少的
  smart: `
while (alive()) {
  if (hp() < 25 && hasPotion()) { drinkPotion(); continue; }
  if (hp() < 25 && getItems().length > 0) { moveToward(getItems()[0]); continue; }
  var enemies = getEnemies();
  if (enemies.length > 0) {
    enemies.sort(function (a, b) { return a.hp - b.hp; });
    var t = enemies[0];
    if (distance(t) <= 1) attack(t);
    else moveToward(t);
  } else {
    explore();
  }
}`,
  // 優先攻擊鄰近敵人（distance 為主、hp 為輔），低血撿補給
  pro: `
if (hp() < 30 && hasPotion()) {
  drinkPotion();
} else {
  var es = getEnemies();
  if (es.length > 0) {
    es.sort(function (a, b) { return (distance(a) * 100 + a.hp) - (distance(b) * 100 + b.hp); });
    var t = es[0];
    if (distance(t) <= 1) attack(t);
    else moveToward(t);
  } else if (hp() < 50 && getItems().length > 0) {
    moveToward(getItems()[0]);
  } else explore();
}`,
  // 戰前囤藥水：沒看到敵人就先撿光道具再前進（L5 的解法）
  stock: `
var es = getEnemies(), adj = null;
for (var i = 0; i < es.length; i++) if (distance(es[i]) <= 1) adj = es[i];
if (hp() < 30 && hasPotion()) drinkPotion();
else if (adj) attack(adj);
else if (es.length === 0 && getItems().length > 0) moveToward(getItems()[0]);
else if (es.length > 0) {
  es.sort(function (a, b) { return a.hp - b.hp; });
  moveToward(es[0]);
} else explore();`,
  // ES6 語法（const / 箭頭函式）應可正常執行
  es6: `
const enemies = getEnemies();
if (enemies.length > 0) {
  enemies.sort((a, b) => a.hp - b.hp);
  const t = enemies[0];
  if (distance(t) <= 1) attack(t);
  else moveToward(t);
} else {
  explore();
}`,
  // 純運算、零行動：應被防呆擋下而不是無限空轉
  idle: `var x = hp() + 1;`
};

/* ---------- 預期結果矩陣（關卡索引從 0 起算） ---------- */
const EXPECT = [
  ["L1 初始腳本可直接通關",        0, "naive", "WIN"],
  ["L2 初始腳本應死（教喝藥水）",   1, "naive", "DEAD"],
  ["L2 smart 通關",               1, "smart", "WIN"],
  ["L3 smart 通關（迷宮）",        2, "smart", "WIN"],
  // smart 在 L4 可能戰死，也可能因「低血找藥 + 繞開敵人」變成永遠風箏（TIMEOUT）
  // 兩者都代表「這關需要更好的腳本」，只要不是 WIN 就符合難度設計
  ["L4 smart 應無法通關（教優先序）", 3, "smart", "DEAD|TIMEOUT"],
  ["L4 pro 通關",                 3, "pro",   "WIN"],
  ["L5 pro 不囤藥應死（教補給）",   4, "pro",   "DEAD"],
  ["L5 stock 囤藥通關",            4, "stock", "WIN"],
  ["L6 初始腳本應死（散兵）",       5, "naive", "DEAD"],
  ["L6 smart 應無法通關（教 distance 排序）", 5, "smart", "DEAD|TIMEOUT"],
  ["L6 pro 通關",                 5, "pro",   "WIN"],
  ["ES6 語法可用（L1）",           0, "es6",   "WIN"],
  ["零行動腳本被防呆擋下（L1）",    0, "idle",  "IDLE"]
];

/* ================= 子行程：跑單一 case ================= */
if (process.env.CASE) {
  runCase(process.env.CASE, parseInt(process.env.LV || "0", 10));
} else {
  runSuite();
}

function extractGameScript() {
  const html = fs.readFileSync(HTML_PATH, "utf-8");
  let js = html.split("<script>")[1].split("</" + "script>")[0];
  js = js.replace('"use strict";', "");                 // 讓 eval 的宣告洩漏到本層作用域
  js = js.replace("var speedIdx = 0;", "var speedIdx = 3;"); // MAX 速度
  js = js.replace("state.turn++;",                       // 回合上限：防卡死
    "state.turn++; if (state.turn > " + TURN_CAP + ") { global.__timedOut = true; throw STOP; }");
  return js;
}

function stubDom(editorCode, levelIdx) {
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
  // 預載存檔：直接落在目標關卡、全關解鎖
  store["codeDungeonProtoV2"] = JSON.stringify({ cur: levelIdx, unlocked: 99 });
  document.getElementById("editor").value = editorCode;
  return elements;
}

function runCase(name, levelIdx) {
  if (name === "check") return runConnectivityCheck();
  if (name === "exploredir") return runExploreDirCheck();
  if (name === "skilltrial") return runSkillTrialCheck();
  const script = SCRIPTS[name];
  if (!script) { console.log("RESULT:UNKNOWN_CASE"); process.exit(2); }
  stubDom(script, levelIdx);
  eval(extractGameScript());
  startRun().then(() => {
    let outcome;
    if (global.__timedOut) outcome = "TIMEOUT";
    else if (state.hero.hp <= 0) outcome = "DEAD";
    else if (state.hero.x === state.stairs.x && state.hero.y === state.stairs.y) outcome = "WIN";
    else if (state.turn === 0) outcome = "IDLE";
    else outcome = "ENDED";
    console.log("DETAIL: turns=" + state.turn + " kills=" + state.kills +
      " dmg=" + state.dmgTaken + " hp=" + state.hero.hp + (state.lastHit ? " lastHit=" + state.lastHit : ""));
    console.log("RESULT:" + outcome);
  }).catch((e) => { console.log("HARNESS ERROR:", e); console.log("RESULT:ERROR"); });
}

function runConnectivityCheck() {
  stubDom("", 0);
  eval(extractGameScript());
  let ok = true;
  for (let i = 0; i < LEVELS.length; i++) {
    loadLevel(i);
    const widthOk = LEVELS[i].map.every((row) => row.length === W);
    const stairsOk = !!bfs(state.hero.x, state.hero.y, (x, y) => x === state.stairs.x && y === state.stairs.y);
    const itemsOk = state.items.every((it) => !!bfs(state.hero.x, state.hero.y, (x, y) => x === it.x && y === it.y));
    const lineOk = widthOk && stairsOk && itemsOk;
    ok = ok && lineOk;
    console.log("DETAIL: L" + (i + 1) + " " + LEVELS[i].name +
      " | 等寬:" + widthOk + " 樓梯可達:" + stairsOk + " 道具可達:" + itemsOk);
  }
  console.log("RESULT:" + (ok ? "OK" : "FAIL"));
}

/* explore(dir) 機制檢查：在「四向等距」的開放空間裡，
 * 驗證 dirsPreferring 真的把 BFS 第一步導向指定方向（而非永遠往上）。 */
function runExploreDirCheck() {
  stubDom("", 0);
  eval(extractGameScript());
  // 7x7 邊牆包住 5x5 開放區，主角置中 (3,3)，四向都走得到 distance 2
  MAPSRC = ["#######", "#.....#", "#.....#", "#.....#", "#.....#", "#.....#", "#######"];
  W = MAPSRC[0].length; H = MAPSRC.length;
  const cx = 3, cy = 3; // 中心
  const goals = { up: [3, 1], down: [3, 5], left: [1, 3], right: [5, 3] };
  // goal：任一方向端點（皆 manhattan 距離 2、等距）
  const goal = (x, y) => Object.keys(goals).some((k) => goals[k][0] === x && goals[k][1] === y);
  const firstStepDir = (dir) => {
    const path = bfs(cx, cy, goal, null, dirsPreferring(dir));
    if (!path) return "NO_PATH";
    const dx = path[0][0] - cx, dy = path[0][1] - cy;
    if (dx === 1) return "right"; if (dx === -1) return "left";
    if (dy === 1) return "down"; if (dy === -1) return "up";
    return "?";
  };
  const cases = [
    ["預設（無方向）→ 往上", firstStepDir(null), "up"],
    ['explore("right") → 往右', firstStepDir("right"), "right"],
    ['explore("down") → 往下', firstStepDir("down"), "down"],
    ['explore("left") → 往左', firstStepDir("left"), "left"]
  ];
  let ok = true;
  for (const [label, got, want] of cases) {
    const pass = got === want;
    ok = ok && pass;
    console.log("DETAIL: " + label + "（實得 " + got + "）" + (pass ? "" : " ✗"));
  }
  console.log("RESULT:" + (ok ? "OK" : "FAIL"));
}

/* 多階 skill 機制檢查：
 *  1) 內建 nearest 是 Lv0 弱版（回傳清單第一個，非最近）
 *  2) 正確的參考實作能通過各 skill 各階的測試案例
 *  3) 弱版(first-in-list)會被 nearest Lv1 測試擋下（測試有牙齒） */
function runSkillTrialCheck() {
  stubDom("", 0);
  eval(extractGameScript());
  let ok = true;
  const log = (label, pass) => { ok = ok && pass; console.log("DETAIL: " + label + (pass ? " ✓" : " ✗")); };

  // 1) 內建弱版 nearest
  loadLevel(0);
  const api = makeApi();
  const weak = api.nearest([{ x: 9, y: 0 }, { x: 1, y: 0 }]);
  log("內建 nearest 是弱版(回傳第一個)", weak && weak.x === 9);

  // 參考實作
  const C = {
    distance: "function distance(t){var m=myPos();return Math.abs(m.x-t.x)+Math.abs(m.y-t.y);}",
    near1: "function nearest(list){var b=null,bd=Infinity;for(var i=0;i<list.length;i++){var d=distance(list[i]);if(d<bd){bd=d;b=list[i];}}return b;}",
    near2: "function nearest(list){var b=null,bd=Infinity,bh=Infinity;for(var i=0;i<list.length;i++){var d=distance(list[i]),h=list[i].hp;if(d<bd||(d===bd&&h<bh)){bd=d;bh=h;b=list[i];}}return b;}",
    nearWeak: "function nearest(list){return list[0]||null;}"
  };
  let POS = { x: 0, y: 0 };
  const myPos = () => ({ x: POS.x, y: POS.y });
  const trial = (id) => TRIALS.find((t) => t.id === id);
  const runLevel = (id, lvCode, levelIdx, prereq) => {
    const map = {}; if (prereq) map.distance = prereq; map[id] = lvCode;
    const fn = buildTrialFns(myPos, map)[id];
    return trial(id).levels[levelIdx].cases.every((c) => {
      POS = c.pos; let g; try { g = fn.apply(null, c.args); } catch (e) { return false; }
      const exp = ("expectIdx" in c) ? c.args[0][c.expectIdx] : c.expect;
      if (exp === null || exp === undefined) return g === null || g === undefined;
      if ("expectIdx" in c) return !!g && g.x === exp.x && g.y === exp.y;
      return g === exp;
    });
  };
  // 2) 正確參考實作各階通過
  log("distance Lv1 參考實作通過", runLevel("distance", C.distance, 0, null));
  log("nearest Lv1 參考實作通過（用 distance）", runLevel("nearest", C.near1, 0, C.distance));
  log("nearest Lv2 參考實作通過（hp tie-break）", runLevel("nearest", C.near2, 1, C.distance));
  // 3) 弱版被 Lv1 測試擋下
  log("弱版 nearest 無法通過 Lv1（測試有牙齒）", runLevel("nearest", C.nearWeak, 0, C.distance) === false);

  console.log("RESULT:" + (ok ? "OK" : "FAIL"));
}

/* ================= 父行程：跑整個套件 ================= */
function runSuite() {
  let pass = 0, fail = 0;
  const spawn = (env) => spawnSync(process.execPath, [__filename], {
    env: { ...process.env, ...env }, encoding: "utf-8", timeout: CASE_TIMEOUT
  });
  const resultOf = (out) => ((out || "").match(/RESULT:(\w+)/) || [])[1] || "NO_OUTPUT";
  const detailOf = (out) => ((out || "").split("\n").filter((l) => l.startsWith("DETAIL:")).join(" | ").replace(/DETAIL: /g, ""));

  console.log("=== 連通性檢查 ===");
  {
    const r = spawn({ CASE: "check" });
    const res = resultOf(r.stdout);
    console.log(detailOf(r.stdout));
    console.log(res === "OK" ? "PASS\n" : "FAIL\n");
    res === "OK" ? pass++ : fail++;
  }

  console.log("=== explore(dir) 方向參數 ===");
  {
    const r = spawn({ CASE: "exploredir" });
    const res = resultOf(r.stdout);
    console.log(detailOf(r.stdout));
    console.log(res === "OK" ? "PASS\n" : "FAIL\n");
    res === "OK" ? pass++ : fail++;
  }

  console.log("=== 多階 skill 機制 ===");
  {
    const r = spawn({ CASE: "skilltrial" });
    const res = resultOf(r.stdout);
    console.log(detailOf(r.stdout));
    console.log(res === "OK" ? "PASS\n" : "FAIL\n");
    res === "OK" ? pass++ : fail++;
  }

  console.log("=== 難度曲線與語法回歸 ===");
  for (const [label, lv, scriptName, expected] of EXPECT) {
    const r = spawn({ CASE: scriptName, LV: String(lv) });
    const res = resultOf(r.stdout);
    const okay = expected.split("|").indexOf(res) !== -1;
    okay ? pass++ : fail++;
    console.log((okay ? "PASS" : "FAIL") + "  " + label +
      "  [期望 " + expected + "，實得 " + res + "]  " + detailOf(r.stdout));
  }

  console.log("\n結果：" + pass + " 通過 / " + fail + " 失敗");
  process.exit(fail === 0 ? 0 : 1);
}
