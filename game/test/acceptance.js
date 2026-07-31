// 瀏覽器自動驗收（M1＋M2）：build → 靜態伺服 → headless Chrome 六項驗證 → exit 0 = 全過。
// 慣例對齊 spike-web（npm test）與 prototype（node test/headless.js）。
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
const url = `http://127.0.0.1:${port}/index.html?fast=1&autotest=1`;

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

const hardTimeout = setTimeout(() => fail('整體逾時（90s）'), 90000);

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[page:error] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[page:exception] ${e.message}`));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY__ === true', { timeout: 15000 });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const g = (expr) => page.evaluate(`window.__game.${expr}`);
  const walk = async (dir, n) => {
    for (let i = 0; i < n; i++) {
      const r = await g(`step('${dir}')`);
      if (r !== 'ok') throw new Error(`walk ${dir} 第 ${i + 1} 步 → ${r}（pos=${JSON.stringify(await g('pos()'))}）`);
    }
  };
  const results = {};

  // ① 移動：程式 step ×3 ＋ 真實鍵盤 ArrowRight ×1
  {
    const p0 = await g('pos()');
    await walk('right', 3);
    const p1 = await g('pos()');
    await page.click('#game canvas');
    await page.keyboard.press('ArrowRight');
    let keyOk = true;
    try {
      await page.waitForFunction('window.__game.pos().x === 5 && window.__game.idle()', { timeout: 3000 });
    } catch { keyOk = false; }
    const p2 = await g('pos()');
    results.move = {
      pass: p0.x === 1 && p0.y === 13 && p1.x === 4 && p1.y === 13 && keyOk,
      detail: `start=(${p0.x},${p0.y}) step×3=(${p1.x},${p1.y}) 鍵盤後=(${p2.x},${p2.y})`,
    };
  }

  // ② 碰撞：往下是外牆 → blocked、位置不變
  {
    const before = await g('pos()');
    const r = await g("step('down')");
    const after = await g('pos()');
    results.collide = {
      pass: r === 'blocked' && before.x === after.x && before.y === after.y,
      detail: `step('down')=${r} pos=(${after.x},${after.y})（未變）`,
    };
  }

  // ③ 進入 dungeon：走到機房門 → 互動 → IDE 模式＋初始腳本已載入
  {
    await walk('right', 2);   // (7,13)
    await walk('up', 9);      // (7,4)
    await walk('right', 2);   // (9,4)
    const faceDoor = await g("step('up')"); // 門是 solid：blocked 但轉向
    const prompt = await g('promptText()');
    const enter = await g('interact()');
    const inDungeon = await g('scene()');
    const ideVisible = await page.evaluate(() => document.body.classList.contains('ide-mode'));
    const code = await page.evaluate('window.__dungeon.getCode()');
    results.enter = {
      pass: faceDoor === 'blocked' && prompt.includes('機房')
        && enter === 'enter-dungeon' && inDungeon === 'dungeon'
        && ideVisible && code.includes('getEnemies'),
      detail: `門提示="${prompt}" scene=${inDungeon} ide=${ideVisible} 腳本含getEnemies=${code.includes('getEnemies')}`,
    };
  }

  // ④ 初始腳本通關 L1：⚡ 全速 → won、turns ≤ par、有逐行事件、有結算 log
  {
    await page.click('#btn-fast');
    let won = true;
    try {
      await page.waitForFunction("window.__dungeon.status() === 'won'", { timeout: 20000 });
    } catch { won = false; }
    const turn = await page.evaluate('window.__dungeon.turn()');
    const par = await page.evaluate('window.__dungeon.par()');
    const lines = await page.evaluate('window.__dungeon.linesSeen()');
    const winLog = await page.evaluate("window.__dungeon.logHas('=== 通關')");
    results.winL1 = {
      pass: won && turn <= par && lines > 0 && winLog,
      detail: `won=${won} turns=${turn}/par ${par} 逐行事件=${lines} 通關log=${winLog}`,
    };
  }

  // ⑤ 死亡與重來：爛腳本 → dead；還原腳本 → 再通關
  {
    await page.click('#dg-close');
    await page.evaluate(`window.__dungeon.setCode("move('right');")`);
    await page.click('#btn-fast');
    let died = true;
    try {
      await page.waitForFunction("window.__dungeon.status() === 'dead'", { timeout: 20000 });
    } catch { died = false; }
    const deadLog = await page.evaluate("window.__dungeon.logHas('=== 死亡')");
    await page.click('#dg-close');
    await page.click('#btn-restore');
    await page.click('#btn-fast');
    let rewon = true;
    try {
      await page.waitForFunction("window.__dungeon.status() === 'won'", { timeout: 20000 });
    } catch { rewon = false; }
    results.deathRetry = {
      pass: died && deadLog && rewon,
      detail: `爛腳本死亡=${died} 死亡log=${deadLog} 還原後再通關=${rewon}`,
    };
  }

  // ⑥ Vim 相對行號：vim ON → 游標行絕對、其餘相對；vim OFF → 恢復絕對行號
  {
    const d = (expr) => page.evaluate(`window.__dungeon.${expr}`);
    await d(`setCode(${JSON.stringify('a\nb\nc\nd\ne\nf\ng\nh')})`);
    await page.click('#btn-vim'); // OFF → ON
    await d('setCursorLine(6)');
    await sleep(80); // 相對行號經 microtask reconfigure 重畫
    const rel = (await d('lineNumberTexts()')).join(',');
    await d('setCursorLine(3)');
    await sleep(80);
    const rel2 = (await d('lineNumberTexts()')).join(',');
    await page.click('#btn-vim'); // ON → OFF
    await sleep(80);
    const abs = (await d('lineNumberTexts()')).join(',');
    results.relnum = {
      pass: rel.includes('5,4,3,2,1,6,1,2') && rel2.includes('2,1,3,1,2,3,4,5') && abs.includes('1,2,3,4,5,6,7,8'),
      detail: `游標行6="${rel}" 游標行3="${rel2}" vim關="${abs}"`,
    };
  }

  // ⑦ 回街上：結算面板的「← 回街上」→ 城市、位置保留、IDE 收起
  {
    await page.click('#dg-leave');
    const backScene = await g('scene()');
    const backPos = await g('pos()');
    const ideGone = await page.evaluate(() => !document.body.classList.contains('ide-mode'));
    results.leave = {
      pass: backScene === 'city' && backPos.x === 9 && backPos.y === 4 && ideGone,
      detail: `scene=${backScene} pos=(${backPos.x},${backPos.y}) ide收起=${ideGone}`,
    };
  }

  // 4. 報告
  const ITEMS = [
    ['move', '① 逐格移動：程式步進＋真實鍵盤事件'],
    ['collide', '② 碰撞阻擋：grid 查表、位置不變'],
    ['enter', '③ 進入 dungeon：IDE 模式＋初始腳本載入'],
    ['winL1', '④ 初始腳本通關 L1（含逐行事件與 par）'],
    ['deathRetry', '⑤ 爛腳本死亡 → 還原 → 再通關'],
    ['relnum', '⑥ Vim 相對行號：ON 相對／OFF 絕對'],
    ['leave', '⑦ 回街上：位置保留、IDE 收起'],
  ];
  console.log('\n== 瀏覽器驗收結果 ==');
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
