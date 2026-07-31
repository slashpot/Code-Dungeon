# src/engine/ — Code Dungeon grid 引擎（純 ES module）

自 prototype 移植（M2，2026-07-31）：`engine.js`（createGame＋API v0 14 函式）、`levels.js`（6 關資料＋初始腳本）。
無 DOM、無 async、確定性——node 可直接 import，`test/engine.test.js` 跑連通性＋L1 案例＋與 prototype 的逐回合對拍。
對拍 reference＝《prototype/Code Dungeon Prototype.html》：引擎行為改動必須同步 prototype 並讓對拍全綠，否則兩邊分岔。
