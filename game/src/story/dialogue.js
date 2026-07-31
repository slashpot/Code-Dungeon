// 對話框（自製最小版）：打字機逐字顯示、Z/Enter 前進；打字中前進＝先跳到整句。
// lines 格式：[{ who, text }]；who 空字串＝獨白/旁白。
const TYPE_MS = 16;

export function createDialogueUi({ box, speaker, text, more }) {
  let lines = [];
  let idx = 0;
  let active = false;
  let typing = false;
  let timer = null;
  let full = '';
  let done = null;

  function startLine() {
    const l = lines[idx];
    speaker.textContent = l.who || '';
    speaker.style.display = l.who ? '' : 'none';
    full = l.text;
    text.textContent = '';
    typing = true;
    more.style.visibility = 'hidden';
    let i = 0;
    clearInterval(timer);
    timer = setInterval(() => {
      i++;
      text.textContent = full.slice(0, i);
      if (i >= full.length) {
        clearInterval(timer);
        typing = false;
        more.style.visibility = 'visible';
      }
    }, TYPE_MS);
  }

  function show(newLines, onDone) {
    lines = newLines;
    idx = 0;
    active = true;
    done = onDone || null;
    box.style.display = 'block';
    startLine();
  }

  function advance() {
    if (!active) return;
    if (typing) {
      clearInterval(timer);
      text.textContent = full;
      typing = false;
      more.style.visibility = 'visible';
      return;
    }
    idx++;
    if (idx < lines.length) {
      startLine();
    } else {
      active = false;
      box.style.display = 'none';
      const cb = done;
      done = null;
      if (cb) cb();
    }
  }

  return { show, advance, isActive: () => active };
}
