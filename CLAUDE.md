# Code Dungeon — 專案狀態（給 Claude 與未來的自己）

用 JavaScript 寫腳本操控勇者闖地牢的 Roguelike 程式遊戲，參考 The Farmer Was Replaced。
完整概念見《Code Dungeon 設計文件.md》，可玩原型為《Code Dungeon Prototype.html》（單檔、零依賴、雙擊即玩）。

## 目前進度（2026-07-10）

- [x] 概念提案與設計文件
- [x] API v0 定案（紙上驗證：三情境腳本各 ≤15 行）
- [x] 可遊玩 prototype：5 個模組化關卡、逐步執行、localStorage 存檔
- [x] 程式整理（分區/命名/常數）＋ 回歸測試入庫（`node test/headless.js`，16 案例）
- [x] 修煉場（dojo）骨架：玩家親手實作 helper、testcase 全過即解鎖，完成的實作於闖關時注入取代內建版（首批：distance、nearest）
- [x] 每關 par（目標回合數）＋ ⭐ 顯示：TFWR 式軟激勵，讓弱版內建的低效率「看得見」；par 校準入回歸測試
- [x] 觀察清單補 4.5 節（dojo/skill 觀察）＋ L6，回答「軟門檻是否成立」
- [ ] 好玩度測試（找 2~3 人玩，含不會寫程式的人）
- [ ] 之後：隨機地圖、技能（fireball 等）、放置模式、直譯器換裝；修煉場擴充（moveToward／explore 需先補「跨回合持久記憶」primitive）

## 已定案的關鍵決策（含理由，勿輕易翻案）

1. **語言 = JavaScript**，網頁遊戲零安裝；prototype 用 `await` 注入執行玩家程式碼，正式版需換 JS-Interpreter（才有逐行高亮、更強沙箱）。
2. **回合制**：一次行動函式呼叫 = 一回合；確定性模擬（同 seed 同結果），無頭測試與離線進度都靠這個。
3. **腳本跑完自動從頭執行**（TFWR 模式），不需 `while(alive())` 樣板；明確迴圈保留給多階段策略。防呆：跑完一輪零行動即停止。
4. **4 方向移動、曼哈頓距離**；輔助函式（explore/moveToward/nearest）prototype 內建，正式版改逐步解鎖。
5. **資訊差設計**：玩家看全圖（視野外調暗），勇者 API 只拿視野內資訊（牆會擋視野，BFS 距離 ≤3）。這是驅動玩家寫偵察邏輯的核心動力。
6. **尋路規則**：moveToward/explore 會繞開敵人（否則卡死），但不繞毒沼——地形代價是玩家的功課。毒沼 = 回合結束站在上面就扣血。`explore(dir?)` 可帶選擇性方向（"up/down/left/right"）做等距 tie-break 傾向；無參數時若已看見樓梯則預設朝樓梯方向（dominantDir）漂移，否則維持原始 up→down→left→right 順序。注意：此「朝樓梯漂移」預設會縮短毒沼穿越路徑，曾使 L2 naive 腳本苟活，故 L2 毒沼已補強（樓梯兩側各加一格 ~）以維持「逼學喝藥水」。
7. **關卡模組化**：`LEVELS` 陣列，每關 `{name, hint, map, par}`，地圖用字串畫（`#`牆 `~`毒沼 `!`藥水 `>`樓梯 `s/g/B`敵人）。加關卡零引擎改動。`par`＝目標回合數（軟激勵），用無頭測試「該關通關參考腳本」的 turns 校準（略高留餘裕）；回歸測試會驗證參考腳本 turns ≤ par，par 失準會直接 FAIL。
8. **API v0（14 函式）**：感知 alive/hp/hasPotion/getEnemies/getItems/getStairs/myPos/distance/nearest ＋ 行動 move/moveToward/attack/drinkPotion/explore（＋log）。`myPos()` 回傳勇者座標 {x,y}，是讓玩家能自己實作 distance/nearest 的前提；與資訊差設計不衝突（自己的位置算視野內，且 getEnemies/Items/Stairs 本來就給絕對座標）。
9. **修煉場（dojo）＋ 多階 skill（弱版內建 vs 升級）**：`TRIALS` 每個 skill 有 `levels[]`（Lv1..N，各含 `desc/starter/cases`）。**內建版＝Lv0**，修煉通過某階即解鎖該階實作並注入。決策方向＝「弱化內建版、修煉逐級升級」：
   - `nearest`：內建 Lv0 是**弱版**＝直接回傳清單第一個（無距離意識）；Lv1 真正最近、Lv2 距離平手時挑 hp 低的。這就是 skill 有意義的關鍵（不修煉 = 笨 targeting）。
   - `distance`：刻意**不弱化**（內建仍正確），因為弱化會讓 L1 初始腳本失效、破壞新手可玩性；故 distance 維持單階「入門用」，練它＝熟悉修煉流程＋換成自己的版本。
   - 機制：`skillRec(id)→{level,codes}`（相容舊 `{code,done}`）；驗證用 `buildTrialFns(myPos, {id:code})` 把玩家 `function id(){}` 字串＋前置 skill「目前最高階」實作編進同一 scope，逐案 stub myPos；全過 `save({trials:{id:{level,codes}}})` 並把 level 推進到該階。`startRun`→`applyTrials(api)` 用每個 skill「目前最高階」的程式碼包 try/catch（出錯退回內建版）覆蓋 api[id]——「你的程式碼就是你勇者的能力」。
   - **軟性門檻＝終局設計，不是暫時妥協**（2026-07-10 定案，對照 TFWR 分析）：TFWR 的硬鎖全放在「玩家無法自己重寫的東西」（語言原語、感知），可重寫的（min/max）不擋、賣方便。對應到本作：distance/nearest 可被玩家在主腳本手寫繞過——這**不是 bug 而是玩法**（手寫＝學習目標已達成）；dojo 的價值定位是「寫一次、永久注入、主腳本乾淨」＋升級變強。若未來要加硬門檻，加在**感知層**（正式版新關卡逐步解鎖 getEnemies 等，玩家無法重寫），**不加在 skill 層**。搭配 par（目標回合數）做軟激勵：弱版 nearest 的繞路直接反映在回合數上。此定位是否成立由好玩度測試驗證（觀察清單 4.5 節：走修煉 A／手寫 B 都算成功，反覆送死 C 才是引導失敗）。
   - UI：可修煉 helper 對玩家稱 **skill**，`#skillbar` 顯示等級（✓頂階／◐部分/●可練 Lv1/🔒未解鎖、`id Lv n/max`），點 chip 進入修煉場（無獨立按鈕，`openDojo(id)`）。dojo 一次只練「下一階」，過了自動進到再下一階。
   - 待辦：`moveToward`/`explore` 這類「重寫很痛」的才是 skill 系統真正發光處，但需先補「跨回合持久記憶」primitive；多階的高階版（如 nearest 依路徑距離）也卡在同一個 primitive。

## 關卡難度曲線（已用無頭模擬驗證可通關）

L1 走廊（初始腳本可過）→ L2 毒沼（需喝藥水）→ L3 迷宮 → L4 亂鬥（需目標優先序）→ L5 Boss（需戰前囤藥水；繞 Boss 衝樓梯也是合法速通）→ L6 散兵坑道（敵人四散＋藥水有限，需 distance/nearest 排目標＋低血回血；naive/smart 死、pro/stock 過，hint 導引玩家去練 skill）。

## 驗證方法（重要慣例）

改動引擎或關卡後跑 `node test/headless.js`：連通性檢查（每關樓梯/道具 BFS 可達＋par 存在）＋ 難度曲線矩陣（naive 應死在 L2、stock 應通 L5 等；WIN 案例同時驗證 turns ≤ par）＋ explore(dir) 方向 tie-break 檢查＋多階 skill 機制檢查（內建 nearest 是弱版、各階參考實作通過、弱版被 Lv1 測試擋下），共 16 個案例。曾靠這個抓到視野穿牆、無限空轉、尋路卡死、smart 腳本永遠風箏、explore 朝樓梯漂移破壞 L2 教學等 bug。測試靠 sloppy-mode direct eval 取得遊戲內部狀態，測試檔不可加 "use strict"。

## 待決：正式版直譯器選型（影響 ES6 支援）

prototype 實測：玩家腳本「直線邏輯」可用 ES6（const/箭頭函式），但在箭頭函式/函式運算式內呼叫行動函式會 SyntaxError（regex 轉換只認 `function name(){}` 宣告式）。三條路：
1. JS-Interpreter ＋ 守 ES5：逐行高亮最容易（逐 AST 節點執行），玩家語法受限
2. Babel 轉譯 ES6→ES5 再餵 JS-Interpreter：語法自由，但高亮/錯誤訊息需 source map 映射，工程量大
3. 換 ES6+ 直譯器（如 Sval）或 WASM（QuickJS）：語法最自由，逐步執行支援度需逐一驗證
範例腳本目前刻意用 var（ES5），是為了讓選項 1 保持開放。

## 已知限制 / 待辦

- localStorage 存檔（key: `codeDungeonProtoV2`）綁瀏覽器與檔案路徑，不跨裝置；如需要可加匯出/匯入按鈕。同一 key 下另存 `code`（編輯器內容）與 `trials`（各 skill 的 `{level, codes:{階:程式碼}}`；相容舊 `{code, done}`）。（註：code snippet 功能已移除，因與 skill 機制定位衝突。）
- 玩家自訂函式內呼叫行動函式靠 regex 轉換，邊角案例可能失敗（換直譯器後根治）。
- 數值平衡僅以驗證腳本粗調：hero 50HP/atk6、slime 10/3、goblin 18/5、boss 32/7、藥水+30、毒沼-4。
