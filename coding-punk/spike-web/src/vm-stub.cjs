// js-interpreter 在 Node 環境才需要 vm（regex fallback）；瀏覽器/Worker 走 Web Worker 分支。
module.exports = null;
