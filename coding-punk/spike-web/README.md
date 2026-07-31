# M0-B spike — JS/Web 路線技術驗證（2026-07-24 通過）

對應 Todoist「🧪 M0-B Spike（JS/Web 路線驗證）」。與 Godot+Jint 的 M0 spike（`../spike/`）做**同規格對照**：
五個驗證項全過。**技術上兩條路線都成立**，Godot vs Web 的選擇回到產品面（桌面感、發行、vim 成本），不在此定案。

## 技術選型（為什麼是 JS-Interpreter 而不是 quickjs-emscripten）

quickjs-emscripten 語法支援好（完整 ES2020）但**沒有暴露 debugger/逐行 API**——② 逐 statement 步進做不到，直接出局。
JS-Interpreter（NeilFraser）反之：逐步執行是原生設計（AST 直譯、`step()` 完全受控、`node.loc` 自帶行號），
但只支援 ES5。解法：**Babel standalone 前置轉譯**（`presets: env→ie11`、`retainLines: true`），
const/箭頭函式實測可用且行號對回原始碼。管線＝ `玩家原始碼 → Babel(ES5化,保行號) → JS-Interpreter(Worker 內逐步跑)`。

## 檔案

- `src/worker.js` — 核心（對應 Godot 版 JintRunner）：Worker 內跑 Babel＋JS-Interpreter，
  逐 statement 發 `line` 事件；行動函式走 async 閘門（`createAsyncFunction` 暫停直譯器，
  postMessage 給主執行緒、收到 result 才放行）——主執行緒架構上不會被玩家腳本凍死。
- `src/main.js` — 遊戲畫面（canvas 極簡地牢：勇者/史萊姆/樓梯）、CodeMirror 6 編輯器
  （JS 高亮＋vim＋目前行反白）、worker 協調、`window.runAcceptance()` 自動驗收掛勾。
- `test/acceptance.js` — 自動驗收：build → 靜態伺服 → headless Chrome（用系統 Chrome，
  puppeteer-core 免下載）→ 五項驗證 → **exit 0 = 全過**。vim 項用真實鍵盤事件驅動。

## 怎麼跑

```sh
npm install
npm test                        # 自動驗收（改動後必跑），exit 0 = PASS
npm run build && npm run serve  # 手動 demo：http://localhost:8137
```

手動 demo：▶ 逐行執行（行反白＋動作 log）／⚡ 全速／■ 停止(terminate)／無窮迴圈與 native 卡死範例／Vim 開關。

## 驗收結果（對照 Godot spike）

| 驗證項 | Web 路線作法 | 實測 | Godot+Jint 對照 |
|---|---|---|---|
| ① 場景委派 | Worker→主執行緒 async 閘門，move/attack 驅動 canvas | 5 move＋2 attack 順序正確，到樓梯 | `engine.SetValue` 委派，等價 |
| ② 逐行步進含行號 | `step()`＋stack 頂 statement 節點 `loc.start.line`（Babel retainLines 保行號） | 行號序列正確反映迴圈逐次（`3,4,3,4…`），註解行不觸發；**const/箭頭函式過** | DebugMode＋Step 事件，等價 |
| ③ 死迴圈防呆（軟） | 步數上限（MaxStatements 等價），停在直譯器外 | 200k steps 約 0.6s 攔下，**玩家 try/catch 吃不掉** | Jint 46ms（200k statements）——Jint 快一個數量級，但兩者都遠低於體感門檻 |
| ③ 死迴圈防呆（硬） | `worker.terminate()`＋重生 worker | **連「永不返回的 native 呼叫」都殺得掉**（這點比 CancellationToken 強——.NET 執行緒卡死在 native 委派裡是停不掉的）；卡死期間主執行緒照常跳動，殺掉後重生即可再跑 | CancellationToken 只能在 statement 邊界停 |
| ④ 編輯器＋JS 高亮 | CodeMirror 6 `@codemirror/lang-javascript` | token 分色、行號 gutter，開箱即用 | CodeEdit 要程式化設定 keyword/region |
| ⑤ Vim motion | `@replit/codemirror-vim` 一個套件 | **hjkl／dw／dd／insert 全過**（真實鍵盤事件實測） | **Godot CodeEdit 無現成 vim mode，要自己實作**——這是 Web 路線最大的省工點 |

## 誠實的取捨（給翻案討論用）

- **ES6 支援是「轉譯出來的」**：Jint 原生跑 ES6+；Web 路線靠 Babel 前置轉譯（const/箭頭實測過，
  generator/async 需 regenerator，未驗）。行號靠 `retainLines`，statement 起始行可靠，
  極端的多行表達式可能對不準。
- **速度差一個數量級**：JS-Interpreter ~330k micro-steps/s vs Jint 200k statements/46ms。
  對「一次行動＝一回合」的玩法無感，但若未來要全速跑大量模擬（離線進度、無頭平衡測試）要留意。
- **bundle 肥**：worker 4.9MB（Babel standalone 佔大頭）、main 1.2MB，未 minify。可瘦身
  （只留 transform-arrow-functions/block-scoping 等幾個 plugin，不用整包 preset-env），spike 不做。
- js-interpreter npm 鏡像的 `createAsyncFunction` **依函式 arity 決定 callback 位置**，
  native 函式不能用 rest 參數（length=0 會 `Invalid array length`），要固定簽名。
- 測試環境：headless 用系統 Chrome（`CHROME_PATH` 可覆寫路徑）。
