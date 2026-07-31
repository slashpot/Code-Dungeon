// Code Dungeon grid 引擎——自 prototype 移植成純 ES module（無 DOM、無 async、確定性）。
// 對拍基準＝《prototype/Code Dungeon Prototype.html》：同地圖同腳本，逐回合狀態必須一致；
// 行為變更需先過 test/engine.test.js 的對拍案例。
//
// 與 prototype 的結構差異（語意不變）：
// - 行動函式是同步的：呼叫＝執行行動＋推進一回合（prototype 的 await tick() 是 UI 節奏，非語意）。
// - 死亡/通關/回合上限時 throw STOP 中止玩家程式（同 prototype），status 記錄結果。
// - 無 __loop 防呆：無行動迴圈由直譯器層的步數上限攔截（比 LOOP_GUARD 更強）。

export const ENEMY_DEF = {
  s: { type: "slime", hp: 10, atk: 3 },
  g: { type: "goblin", hp: 18, atk: 5 },
  B: { type: "orc-boss", hp: 32, atk: 7 }
};
export const HERO_MAXHP = 50;
export const HERO_ATK = 6;
export const POTION_HEAL = 30;
export const POISON_DMG = 4;
export const SIGHT = 3;       // 勇者視野：BFS 走行距離（牆會擋視線）
export const AGGRO_RANGE = 5; // 敵人追擊範圍：BFS 走行距離（隔牆不會仇恨）

export const STOP = { __stop: true }; // 內部訊號：中止玩家程式（非錯誤）

const DIRVEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function createGame(level, opts = {}) {
  const MAPSRC = level.map;
  const H = MAPSRC.length;
  const W = MAPSRC[0].length;
  const onLog = opts.onLog || function () {};
  const onTick = opts.onTick || null; // 對拍用：turn++ 後、世界反應前（與 prototype 測試的 patch 點一致）
  const turnCap = opts.turnCap || 0;

  const state = {
    hero: { x: 0, y: 0, hp: HERO_MAXHP, potions: 0 },
    enemies: [],   // {id, x, y, hp, maxhp, atk, type, ch}
    items: [],     // {x, y, type}
    stairs: null,  // {x, y}
    seen: {},      // posKey -> true（勇者看過的格子，API 用）
    dist: {},      // posKey -> 與勇者的 BFS 距離（reveal 更新）
    turn: 0, kills: 0, dmgTaken: 0,
    lastHit: null, exploreDone: false
  };
  let status = "playing"; // playing | won | dead | timeout

  /* ---------- 地圖工具 ---------- */
  function posKey(x, y) { return x + "," + y; }
  function isWall(x, y) { return x < 0 || y < 0 || x >= W || y >= H || MAPSRC[y][x] === "#"; }
  function isPoison(x, y) { return MAPSRC[y][x] === "~"; }
  function manhattan(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

  function enemyAt(x, y) {
    for (let i = 0; i < state.enemies.length; i++) {
      if (state.enemies[i].x === x && state.enemies[i].y === y) return state.enemies[i];
    }
    return null;
  }
  function enemyBlocked(x, y) { return !!enemyAt(x, y); }

  // 產生 BFS 鄰居展開順序：偏好 dir，最後才是其反方向（等距目標的方向性 tie-break）
  function dirsPreferring(dir) {
    const base = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const pref = DIRVEC[dir];
    if (!pref) return base;
    const opp = [-pref[0], -pref[1]];
    const perp = [];
    for (let i = 0; i < base.length; i++) {
      const d = base[i];
      const isPref = d[0] === pref[0] && d[1] === pref[1];
      const isOpp = d[0] === opp[0] && d[1] === opp[1];
      if (!isPref && !isOpp) perp.push(d);
    }
    return [pref].concat(perp).concat([opp]);
  }
  // 由起點朝目標的「主要方向」（曼哈頓上較大的軸），explore 看見樓梯後的預設傾向
  function dominantDir(fromX, fromY, toX, toY) {
    const dx = toX - fromX, dy = toY - fromY;
    if (Math.abs(dx) >= Math.abs(dy)) return dx === 0 ? null : (dx > 0 ? "right" : "left");
    return dy > 0 ? "down" : "up";
  }

  // BFS 最短路徑。goal(x,y) 判定目標；blocked(x,y)（可選）為臨時障礙（如敵人），
  // 但目標格本身不受 blocked 影響。回傳「下一步起」的路徑陣列；到不了回傳 null。
  function bfs(sx, sy, goal, blocked, dirOrder) {
    const prev = {}; const q = [[sx, sy]]; let found = null;
    prev[posKey(sx, sy)] = null;
    const dirs = dirOrder || [[0, -1], [0, 1], [-1, 0], [1, 0]];
    while (q.length) {
      const cur = q.shift();
      if (goal(cur[0], cur[1]) && !(cur[0] === sx && cur[1] === sy)) { found = cur; break; }
      for (let i = 0; i < 4; i++) {
        const nx = cur[0] + dirs[i][0], ny = cur[1] + dirs[i][1];
        if (isWall(nx, ny) || (posKey(nx, ny) in prev)) continue;
        if (blocked && blocked(nx, ny) && !goal(nx, ny)) continue;
        prev[posKey(nx, ny)] = cur; q.push([nx, ny]);
      }
    }
    if (!found) return null;
    const path = []; let node = found;
    while (prev[posKey(node[0], node[1])]) { path.unshift(node); node = prev[posKey(node[0], node[1])]; }
    return path;
  }

  /* ---------- 視野 ---------- */
  // 從勇者位置做 BFS，更新「與勇者的走行距離」表；SIGHT 內標記為已看過。牆會擋視線。
  function reveal() {
    const dist = {}; dist[posKey(state.hero.x, state.hero.y)] = 0;
    const q = [[state.hero.x, state.hero.y]];
    while (q.length) {
      const c = q.shift(); const d = dist[posKey(c[0], c[1])];
      if (d >= AGGRO_RANGE) continue;
      const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (let i = 0; i < 4; i++) {
        const nx = c[0] + dirs[i][0], ny = c[1] + dirs[i][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || posKey(nx, ny) in dist) continue;
        dist[posKey(nx, ny)] = d + 1;
        if (!isWall(nx, ny)) q.push([nx, ny]);
      }
    }
    state.dist = dist;
    for (const k in dist) if (dist[k] <= SIGHT) state.seen[k] = true;
  }
  function visibleNow(x, y) { const d = state.dist[posKey(x, y)]; return d !== undefined && d <= SIGHT; }

  /* ---------- 回合推進 ---------- */
  // 勇者走一步：撞牆/撞敵人 = 浪費回合；走到道具上自動撿取。
  function heroStep(nx, ny) {
    if (isWall(nx, ny)) { onLog("撞牆了，浪費一回合", "warn", state.turn); return; }
    if (enemyAt(nx, ny)) { onLog("被 " + enemyAt(nx, ny).type + " 擋住了", "warn", state.turn); return; }
    state.hero.x = nx; state.hero.y = ny;
    for (let i = state.items.length - 1; i >= 0; i--) {
      if (state.items[i].x === nx && state.items[i].y === ny) {
        state.hero.potions++; state.items.splice(i, 1); onLog("撿到藥水！", "good", state.turn);
      }
    }
  }

  // 敵人 AI：相鄰就攻擊；走行距離 ≤ AGGRO_RANGE 就朝勇者逼近（簡單貪婪步，不繞路）。
  function enemyTurn() {
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i], h = state.hero;
      const d = manhattan(e.x, e.y, h.x, h.y);
      const walkDist = state.dist[posKey(e.x, e.y)];
      if (d === 1) {
        h.hp -= e.atk; state.dmgTaken += e.atk; state.lastHit = e.type;
        onLog(e.type + " 攻擊你 -" + e.atk + " HP", "bad", state.turn);
      } else if (walkDist !== undefined && walkDist <= AGGRO_RANGE) {
        const dx = h.x - e.x, dy = h.y - e.y;
        const tries = Math.abs(dx) >= Math.abs(dy)
          ? [[e.x + Math.sign(dx), e.y], [e.x, e.y + Math.sign(dy)]]
          : [[e.x, e.y + Math.sign(dy)], [e.x + Math.sign(dx), e.y]];
        for (let t = 0; t < tries.length; t++) {
          const nx = tries[t][0], ny = tries[t][1];
          if (!isWall(nx, ny) && !enemyAt(nx, ny) && !(nx === h.x && ny === h.y) && !(nx === e.x && ny === e.y)) { e.x = nx; e.y = ny; break; }
        }
      }
    }
  }

  // 一回合 = 一次行動函式呼叫。流程：毒沼結算 → 敵人行動 → 視野更新 → 輸贏判定。
  function tick() {
    state.turn++;
    if (onTick) onTick(state);
    if (turnCap && state.turn > turnCap) { status = "timeout"; throw STOP; }
    if (isPoison(state.hero.x, state.hero.y)) {
      state.hero.hp -= POISON_DMG; state.dmgTaken += POISON_DMG; state.lastHit = "毒沼";
      onLog("身處毒沼 -" + POISON_DMG + " HP", "bad", state.turn);
    }
    enemyTurn();
    reveal();
    if (state.hero.hp <= 0) { status = "dead"; throw STOP; }
    if (state.hero.x === state.stairs.x && state.hero.y === state.stairs.y) { status = "won"; throw STOP; }
  }

  function guardPlaying() { if (status !== "playing") throw STOP; }

  /* ---------- 玩家 API（v0，14 函式＋log）---------- */
  const snap = function (e) { return { id: e.id, x: e.x, y: e.y, hp: e.hp, type: e.type }; };
  const api = {
    alive: function () { return state.hero.hp > 0; },
    hp: function () { return state.hero.hp; },
    hasPotion: function () { return state.hero.potions > 0; },
    getEnemies: function () { return state.enemies.filter(function (e) { return visibleNow(e.x, e.y); }).map(snap); },
    getItems: function () { return state.items.filter(function (i) { return state.seen[posKey(i.x, i.y)]; }).map(function (i) { return { x: i.x, y: i.y, type: i.type }; }); },
    getStairs: function () { return state.seen[posKey(state.stairs.x, state.stairs.y)] ? { x: state.stairs.x, y: state.stairs.y } : null; },
    myPos: function () { return { x: state.hero.x, y: state.hero.y }; },
    distance: function (t) { return manhattan(state.hero.x, state.hero.y, t.x, t.y); },
    // Lv0 弱版：沒有距離意識，直接回傳清單第一個（skill 系統 v0.2 移植後才有升級）
    nearest: function (list) { return (list && list.length) ? list[0] : null; },
    move: function (dir) {
      guardPlaying();
      const d = DIRVEC[dir];
      if (!d) { onLog('move() 方向要是 "up/down/left/right"', "warn", state.turn); } else heroStep(state.hero.x + d[0], state.hero.y + d[1]);
      tick();
    },
    moveToward: function (t) {
      guardPlaying();
      if (!t || typeof t.x !== "number") { onLog("moveToward() 需要一個有 x, y 的目標", "warn", state.turn); tick(); return; }
      const goal = function (x, y) { return x === t.x && y === t.y; };
      let path = bfs(state.hero.x, state.hero.y, goal, enemyBlocked);
      if (!path) path = bfs(state.hero.x, state.hero.y, goal); // 繞不開敵人時退回直線路徑
      if (!path) onLog("走不到那裡，浪費一回合", "warn", state.turn);
      else heroStep(path[0][0], path[0][1]);
      tick();
    },
    attack: function (t) {
      guardPlaying();
      const e = t ? state.enemies.filter(function (en) { return en.id === t.id; })[0] : null;
      if (!e) onLog("目標已不存在，浪費一回合", "warn", state.turn);
      else if (manhattan(state.hero.x, state.hero.y, e.x, e.y) > 1) onLog("目標太遠打不到（射程 1），浪費一回合", "warn", state.turn);
      else {
        e.hp -= HERO_ATK;
        if (e.hp <= 0) { state.enemies.splice(state.enemies.indexOf(e), 1); state.kills++; onLog("擊殺 " + e.type + "！", "good", state.turn); }
        else onLog("攻擊 " + e.type + " -" + HERO_ATK + "（剩 " + e.hp + "）", "", state.turn);
      }
      tick();
    },
    drinkPotion: function () {
      guardPlaying();
      if (state.hero.potions > 0) { state.hero.potions--; state.hero.hp = Math.min(HERO_MAXHP, state.hero.hp + POTION_HEAL); onLog("喝藥水 +" + POTION_HEAL + " HP", "good", state.turn); }
      else onLog("沒有藥水！浪費一回合", "warn", state.turn);
      tick();
    },
    explore: function (dir) {
      guardPlaying();
      // 決定方向傾向：明確指定 > 已看見樓梯則朝樓梯 > 無傾向
      if (dir && !DIRVEC[dir]) { onLog('explore() 的方向要是 "up"/"down"/"left"/"right"，已忽略：' + dir, "warn", state.turn); dir = null; }
      if (!dir && state.seen[posKey(state.stairs.x, state.stairs.y)]) {
        dir = dominantDir(state.hero.x, state.hero.y, state.stairs.x, state.stairs.y);
      }
      const order = dirsPreferring(dir);
      const path = bfs(state.hero.x, state.hero.y, function (x, y) { return !state.seen[posKey(x, y)] && !isWall(x, y); }, enemyBlocked, order);
      if (!path) {
        if (!state.exploreDone) { onLog("已無可探索的區域，朝樓梯前進", "sys", state.turn); state.exploreDone = true; }
        const p2 = bfs(state.hero.x, state.hero.y, function (x, y) { return x === state.stairs.x && y === state.stairs.y; }, enemyBlocked, order);
        if (p2) heroStep(p2[0][0], p2[0][1]);
      }
      else heroStep(path[0][0], path[0][1]);
      tick();
    },
    log: function (msg) { onLog("你的 log：" + String(msg), "sys", state.turn); }
  };

  /* ---------- 初始化 ---------- */
  let id = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = MAPSRC[y][x];
    if (c === "h") { state.hero.x = x; state.hero.y = y; }
    else if (ENEMY_DEF[c]) { const d = ENEMY_DEF[c]; state.enemies.push({ id: id++, x: x, y: y, hp: d.hp, maxhp: d.hp, atk: d.atk, type: d.type, ch: c }); }
    else if (c === "!") state.items.push({ x: x, y: y, type: "potion" });
    else if (c === ">") state.stairs = { x: x, y: y };
  }
  reveal();

  return {
    level, state, W, H, MAPSRC, api,
    get status() { return status; },
    isWall, isPoison, visibleNow,
    bfs, // 測試（連通性檢查）用
  };
}
