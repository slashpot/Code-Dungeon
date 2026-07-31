// M0-B 自動驗收：build → 靜態伺服 → headless Chrome 跑五項驗證 → exit 0 = 全過。
// 慣例對齊 Godot spike（--headless 自動驗收）與 prototype（node test/headless.js）。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createStaticServer } from '../serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

// 1. build
console.log('== build ==');
const b = spawnSync(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'inherit' });
if (b.status !== 0) fail('esbuild build 失敗');

// 2. serve
const server = createStaticServer(ROOT);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html?autotest=1`;

// 3. headless Chrome（用系統 Chrome，免下載 Chromium）
function findChrome() {
  if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH };
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'darwin' && fs.existsSync(mac)) return { executablePath: mac };
  return { channel: 'chrome' };
}

let browser;
try {
  browser = await puppeteer.launch({ ...findChrome(), headless: true });
} catch (e) {
  fail(`找不到/啟不動 Chrome：${e.message}（可設 CHROME_PATH 環境變數指定）`);
}

const hardTimeout = setTimeout(() => fail('整體逾時（120s）'), 120000);

try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[page:error] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[page:exception] ${e.message}`));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY__ === true', { timeout: 15000 });

  // 項目①〜④：頁面內自動驗收
  const results = await page.evaluate(() => window.runAcceptance());

  // 項目⑤：vim motion —— 用真實鍵盤事件（puppeteer keyboard）驅動
  const vimChecks = [];
  const h = 'window.__helpers';
  const evalH = (expr) => page.evaluate(`${h}.${expr}`);

  await evalH(`setDoc('alpha beta\\nsecond line\\nthird line')`);
  await page.click('.cm-content');
  await page.keyboard.press('Escape'); // 確保 normal mode
  await page.keyboard.type('gg');

  await page.keyboard.type('j');
  vimChecks.push(['j 下移一行', (await evalH('cursorLine()')) === 2]);
  await page.keyboard.type('l');
  vimChecks.push(['l 右移一格', (await evalH('cursorCh()')) === 1]);
  await page.keyboard.type('k');
  vimChecks.push(['k 上移一行', (await evalH('cursorLine()')) === 1]);
  await page.keyboard.type('h');
  vimChecks.push(['h 左移一格', (await evalH('cursorCh()')) === 0]);

  await page.keyboard.type('dw');
  vimChecks.push(['dw 刪一個字', (await evalH('getDoc()')).startsWith('beta')]);
  await page.keyboard.type('dd');
  vimChecks.push(['dd 刪一行', (await evalH('getDoc()')) === 'second line\nthird line']);

  await page.keyboard.type('i');
  vimChecks.push(['i 進 insert mode', (await evalH('vimInsertMode()')) === true]);
  await page.keyboard.type('X');
  await page.keyboard.press('Escape');
  vimChecks.push(['insert 輸入生效', (await evalH('getDoc()')).startsWith('Xsecond')]);

  results.vim = {
    pass: vimChecks.every(([, ok]) => ok),
    detail: vimChecks.map(([name, ok]) => `${ok ? '✓' : '✗'}${name}`).join(' '),
  };

  // 4. 報告
  const ITEMS = [
    ['scene', '① 網頁場景可跑：move/attack 委派驅動畫面'],
    ['stepping', '② 逐行步進含行號（Worker 內 statement-level）'],
    ['budget', '③a 死迴圈防呆：步數上限攔截，try/catch 吃不掉'],
    ['terminate', '③b 死迴圈防呆：worker.terminate() 強制中斷，主執行緒不卡'],
    ['editor', '④ 編輯器整合：CodeMirror 6 + JS 語法高亮'],
    ['vim', '⑤ Vim motion：hjkl / dw / dd / insert'],
  ];
  console.log('\n== M0-B 驗收結果 ==');
  let allPass = true;
  for (const [key, title] of ITEMS) {
    const r = results[key] || { pass: false, detail: '無結果' };
    if (!r.pass) allPass = false;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${title}`);
    console.log(`      ${r.detail}`);
  }
  console.log(allPass ? '\n✅ 全部通過（exit 0）' : '\n❌ 有項目未過（exit 1）');
  clearTimeout(hardTimeout);
  await browser.close();
  server.close();
  process.exit(allPass ? 0 : 1);
} catch (e) {
  clearTimeout(hardTimeout);
  await browser.close().catch(() => {});
  server.close();
  fail(e.stack || String(e));
}
