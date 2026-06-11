# Code Dungeon — 專案狀態（給 Claude 與未來的自己）

用 JavaScript 寫腳本操控勇者闖地牢的 Roguelike 程式遊戲，參考 The Farmer Was Replaced。
完整概念見《Code Dungeon 設計文件.md》，可玩原型為《Code Dungeon Prototype.html》（單檔、零依賴、雙擊即玩）。

## 目前進度（2026-06-10）

- [x] 概念提案與設計文件
- [x] API v0 定案（紙上驗證：三情境腳本各 ≤15 行）
- [x] 可遊玩 prototype：5 個模組化關卡、逐步執行、localStorage 存檔
- [ ] 好玩度測試（找 2~3 人玩，含不會寫程式的人）
- [ ] 之後：隨機地圖、技能（fireball 等）、放置模式、JS-Interpreter 換裝

## 已定案的關鍵決策（含理由，勿輕易翻案）

1. **語言 = JavaScript**，網頁遊戲零安裝；prototype 用 `await` 注入執行玩家程式碼，正式版需換 JS-Interpreter（才有逐行高亮、更強沙箱）。
2. **回合制**：一次行動函式呼叫 = 一回合；確定性模擬（同 seed 同結果），無頭測試與離線進度都靠這個。
3. **腳本跑完自動從頭執行**（TFWR 模式），不需 `while(alive())` 樣板；明確迴圈保留給多階段策略。防呆：跑完一輪零行動即停止。
4. **4 方向移動、曼哈頓距離**；輔助函式（explore/moveToward/nearest）prototype 內建，正式版改逐步解鎖。
5. **資訊差設計**：玩家看全圖（視野外調暗），勇者 API 只拿視野內資訊（牆會擋視野，BFS 距離 ≤3）。這是驅動玩家寫偵察邏輯的核心動力。
6. **尋路規則**：moveToward/explore 會繞開敵人（否則卡死），但不繞毒沼——地形代價是玩家的功課。毒沼 = 回合結束站在上面就扣血。
7. **關卡模組化**：`LEVELS` 陣列，每關 `{name, hint, map}`，地圖用字串畫（`#`牆 `~`毒沼 `!`藥水 `>`樓梯 `s/g/B`敵人）。加關卡零引擎改動。
8. **API v0（13 函式）**：感知 alive/hp/hasPotion/getEnemies/getItems/getStairs/distance/nearest ＋ 行動 move/moveToward/attack/drinkPotion/explore（＋log）。

## 關卡難度曲線（已用無頭模擬驗證可通關）

L1 走廊（初始腳本可過）→ L2 毒沼（需喝藥水）→ L3 迷宮 → L4 亂鬥（需目標優先序）→ L5 Boss（需戰前囤藥水；繞 Boss 衝樓梯也是合法速通）。

## 驗證方法（重要慣例）

改動引擎或關卡後，用無頭模擬驗證：抽出 HTML 內的 `<script>`，stub DOM 後在 Node 跑各等級腳本（naive 應死在 L2、stock 應通 L5），並 BFS 檢查每關樓梯/道具可達。曾靠這個抓到視野穿牆、無限空轉、尋路卡死三個 bug。

## 已知限制 / 待辦

- localStorage 存檔（key: `codeDungeonProtoV2`）綁瀏覽器與檔案路徑，不跨裝置；如需要可加匯出/匯入按鈕。
- 玩家自訂函式內呼叫行動函式靠 regex 轉換，邊角案例可能失敗（換直譯器後根治）。
- 數值平衡僅以驗證腳本粗調：hero 50HP/atk6、slime 10/3、goblin 18/5、boss 32/7、藥水+30、毒沼-4。
