// 對話框（自製最小版）：打字機逐字顯示、Z/Enter 前進；打字中前進＝先跳到整句。
// who 空字串＝獨白/旁白。
const TYPE_MS = 16;

export interface DialogueLine { who: string; text: string }

export interface DialogueUi {
  show(lines: DialogueLine[], onDone?: () => void): void;
  advance(): void;
  isActive(): boolean;
}

export interface DialogueEls {
  box: HTMLElement;
  speaker: HTMLElement;
  text: HTMLElement;
  more: HTMLElement;
}

export function createDialogueUi({ box, speaker, text, more }: DialogueEls): DialogueUi {
  let lines: DialogueLine[] = [];
  let idx = 0;
  let active = false;
  let typing = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let full = '';
  let done: (() => void) | null = null;

  function startLine(): void {
    const l = lines[idx];
    speaker.textContent = l.who || '';
    speaker.style.display = l.who ? '' : 'none';
    full = l.text;
    text.textContent = '';
    typing = true;
    more.style.visibility = 'hidden';
    let i = 0;
    if (timer !== null) clearInterval(timer);
    timer = setInterval(() => {
      i++;
      text.textContent = full.slice(0, i);
      if (i >= full.length) {
        if (timer !== null) clearInterval(timer);
        typing = false;
        more.style.visibility = 'visible';
      }
    }, TYPE_MS);
  }

  function show(newLines: DialogueLine[], onDone?: () => void): void {
    lines = newLines;
    idx = 0;
    active = true;
    done = onDone || null;
    box.style.display = 'block';
    startLine();
  }

  function advance(): void {
    if (!active) return;
    if (typing) {
      if (timer !== null) clearInterval(timer);
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
