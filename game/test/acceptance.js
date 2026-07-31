// M1 自動驗收：build → 靜態伺服 → headless Chrome 三項驗證 → exit 0 = 全過。
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
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[page:error] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[page:exception] ${e.message}`));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY__ === true', { timeout: 15000 });

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

  // ③ 場景切換：走到機房門 → 進 dungeon → 走動 → 出來回到街上原位
  {
    await walk('right', 2);   // (7,13)
    await walk('up', 9);      // (7,4)
    await walk('right', 2);   // (9,4)
    const faceDoor = await g("step('up')"); // 門是 solid：blocked 但轉向
    const prompt = await g('promptText()');
    const enter = await g('interact()');
    const inDungeon = await g('scene()');
    const spawn = await g('pos()');
    await walk('left', 1);
    await walk('right', 1);
    await g("step('down')"); // 面向出口
    const exit = await g('interact()');
    const backScene = await g('scene()');
    const backPos = await g('pos()');
    results.scenes = {
      pass: faceDoor === 'blocked' && prompt.includes('機房')
        && enter === 'enter-dungeon' && inDungeon === 'dungeon'
        && spawn.x === 4 && spawn.y === 3
        && exit === 'exit-dungeon' && backScene === 'city'
        && backPos.x === 9 && backPos.y === 4,
      detail: `門提示="${prompt}" 進=${inDungeon}@(${spawn.x},${spawn.y}) 出=${backScene}@(${backPos.x},${backPos.y})`,
    };
  }

  // 4. 報告
  const ITEMS = [
    ['move', '① 逐格移動：程式步進＋真實鍵盤事件'],
    ['collide', '② 碰撞阻擋：grid 查表、位置不變'],
    ['scenes', '③ 場景切換：機房門進出、街上位置保留'],
  ];
  console.log('\n== M1 驗收結果 ==');
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
