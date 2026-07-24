# M0 spike — Godot + C# + Jint 技術驗證（2026-07-24 通過）

對應《v0.1 實行步驟》M0。五個驗證項全過，**不需評估路線 B（QuickJS GDExtension）**，可進 M1。

## 檔案

- `JintRunner.cs` — 核心（純 C#，無 Godot 相依，可獨立單元測試）。背景執行緒跑 Jint，
  stepped 模式下每個 statement 停在 `SemaphoreSlim` 閘門前，等主執行緒 `AdvanceOneStatement()` 放行。
- `JintSpike.cs` / `JintSpike.tscn` — demo 場景：左 CodeEdit（JS 高亮＋行號＋目前行反白），
  右動作 log；▶ 執行／■ 停止／範例／無窮迴圈 四顆按鈕。

## 怎麼跑

- **視覺 demo**：Godot .NET 版開啟專案按 F5（主場景已指向本場景）。改程式碼→執行→逐行反白→log 出動作；
  按「無窮迴圈」→執行，遊戲照跑不誤，隨時可停止。
- **自動驗收**（改動後必跑，等同 prototype 的 `node test/headless.js` 慣例）：

  ```sh
  dotnet build CodingPunk.csproj
  /Applications/Godot_mono.app/Contents/MacOS/Godot --headless --path .
  # exit 0 = PASS。phase 1: stepped 範例(委派+ES6+行號);phase 2: while(true) 全速被 MaxStatements 攔截
  ```

## 關鍵技術結論（Jint 4.14）

| 需求 | 作法 | 實測 |
|---|---|---|
| 逐行步進＋行號 | `options.DebugMode()` + `options.InitialStepMode(StepMode.Into)`；`engine.Debugger.Step` 事件，`info.Location.Start.Line`（1-based），回傳 `StepMode.Into` | 行號序列正確反映迴圈逐次執行（如 `3,4,5,4,5,…`），註解行不觸發 |
| 不凍死遊戲 | Jint 跑背景執行緒＋逐 statement 閘門，主執行緒只讀 volatile 狀態/收 `ConcurrentQueue` 事件 | 架構上不可能凍結；無窮迴圈下 UI 照常互動 |
| 無窮迴圈防呆 | 雙層：`options.MaxStatements(200_000)` 硬上限；`options.CancellationToken` 做停止鈕 | 全速 `while(true)` 46ms 被攔；`ExecutionCanceledException` **玩家 JS 的 try/catch 吃不掉**（console 對拍 Test 5） |
| C# 委派 | `engine.SetValue("move", new Action<string>(…))` | 直接呼叫，順序正確 |
| ES6 | Jint 原生支援 | const/template string 實測過，prototype 的 regex hack/ES5 限制在正式版不存在 |
| JS 錯誤回報 | `JavaScriptException.Location.Start.Line` | 帶行號進 log（「腳本錯誤(行 2)…」） |
| 語法高亮 | `CodeHighlighter`：keyword/color region 程式化設定（見 `SetupEditor()`） | 關鍵字/字串/註解/數字分色，行號 gutter |

執行緒約定（之後接引擎務必遵守）：**Godot API 一律不進背景執行緒**；跨執行緒只透過
volatile 欄位（CurrentLine/State）與 `ConcurrentQueue`（事件）。

## 給 M2 的接線筆記

- 正式玩法是「一次行動＝一回合」：把 spike 的固定 `StepDelaySec` 換成「行動函式被呼叫時才卡住等
  Godot 播完動畫再放行」——同一個閘門機制，把閘門從 Step 回呼移到（或加到）行動委派內即可；
  逐行反白仍由 Step 回呼提供。
- `JintRunner` 事件格式 `kind|text` 是 spike 便宜行事，M2 換成 typed struct/record。
- 環境注意：本機只有 .NET 10 runtime，csproj 已設 `RollForward=LatestMajor`；
  機器全域 NuGet 有內網 HTTP 源會擋 restore，專案內 `NuGet.config` 已鎖 nuget.org。
