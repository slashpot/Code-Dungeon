# src/engine/ — M2 移植區

prototype 的 grid 引擎最小集（地圖字串解析、回合 tick、視野 BFS、戰鬥、毒沼/藥水）
在 M2 抽成**純 ES module**放這裡——node 可直接 import，回歸測試不再走 sloppy-eval。
對拍 reference＝《prototype/Code Dungeon Prototype.html》內的 JS 引擎（同地圖同腳本逐回合狀態必須一致）。
