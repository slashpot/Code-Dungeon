// 測試用玩家腳本（與 prototype/test/headless.js 同款）——對拍時兩邊餵同一份。
// CJS：proto-ref.cjs（sloppy eval 環境）與 engine.test.js（ESM import CJS）共用。
module.exports = {
  // 編輯器預設的初始腳本：無補血邏輯
  naive: `
var enemies = getEnemies();
if (enemies.length > 0) {
  var t = nearest(enemies);
  if (distance(t) <= 1) attack(t);
  else moveToward(t);
} else {
  explore();
}`,
  // 加上喝藥水、先打血少的
  smart: `
while (alive()) {
  if (hp() < 25 && hasPotion()) { drinkPotion(); continue; }
  if (hp() < 25 && getItems().length > 0) { moveToward(getItems()[0]); continue; }
  var enemies = getEnemies();
  if (enemies.length > 0) {
    enemies.sort(function (a, b) { return a.hp - b.hp; });
    var t = enemies[0];
    if (distance(t) <= 1) attack(t);
    else moveToward(t);
  } else {
    explore();
  }
}`,
  // 優先攻擊鄰近敵人（distance 為主、hp 為輔），低血撿補給
  pro: `
if (hp() < 30 && hasPotion()) {
  drinkPotion();
} else {
  var es = getEnemies();
  if (es.length > 0) {
    es.sort(function (a, b) { return (distance(a) * 100 + a.hp) - (distance(b) * 100 + b.hp); });
    var t = es[0];
    if (distance(t) <= 1) attack(t);
    else moveToward(t);
  } else if (hp() < 50 && getItems().length > 0) {
    moveToward(getItems()[0]);
  } else explore();
}`,
  // 戰前囤藥水：沒看到敵人就先撿光道具再前進
  stock: `
var es = getEnemies(), adj = null;
for (var i = 0; i < es.length; i++) if (distance(es[i]) <= 1) adj = es[i];
if (hp() < 30 && hasPotion()) drinkPotion();
else if (adj) attack(adj);
else if (es.length === 0 && getItems().length > 0) moveToward(getItems()[0]);
else if (es.length > 0) {
  es.sort(function (a, b) { return a.hp - b.hp; });
  moveToward(es[0]);
} else explore();`,
  // ES6 語法（const / 箭頭函式）
  es6: `
const enemies = getEnemies();
if (enemies.length > 0) {
  enemies.sort((a, b) => a.hp - b.hp);
  const t = enemies[0];
  if (distance(t) <= 1) attack(t);
  else moveToward(t);
} else {
  explore();
}`,
  // 純運算、零行動：應被防呆擋下而不是無限空轉
  idle: `var x = hp() + 1;`
};
