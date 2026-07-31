// 遊戲內 IDE：CodeMirror 6（JS 高亮＋vim＋執行行反白），自 spike-web main.js 抽出（M2 接上 dungeon panel）。
import { basicSetup } from 'codemirror';
import { EditorView, Decoration, lineNumbers } from '@codemirror/view';
import { EditorState, StateEffect, StateField, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { vim, getCM } from '@replit/codemirror-vim';

// vim 模式的相對行號（number+relativenumber 混合：游標行顯示絕對行號，其餘顯示距離）。
// 每次呼叫回傳新的 config 物件：lineNumberConfig facet 值改變 → 觸發 lineMarkerChange 重畫。
// 與 basicSetup 內建的 lineNumbers() 不會重複出 gutter（lineNumberGutter 是模組常數，extension 去重）。
function relativeLineNumbers() {
  return lineNumbers({
    formatNumber: (n, state) => {
      if (n > state.doc.lines) return String(n);
      const cur = state.doc.lineAt(state.selection.main.head).number;
      return n === cur ? String(n) : String(Math.abs(cur - n));
    },
  });
}

const setExecLine = StateEffect.define();
const execLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setExecLine)) {
        if (e.value == null || e.value > tr.state.doc.lines) deco = Decoration.none;
        else {
          const line = tr.state.doc.line(e.value);
          deco = Decoration.set([Decoration.line({ class: 'exec-line' }).range(line.from)]);
        }
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function createEditor({ parent, doc = '', vimEnabled = true }) {
  const vimCompartment = new Compartment();
  const relCompartment = new Compartment();
  let vimOn = vimEnabled;

  // gutter 不會因游標移動自動重畫（lineMarkerChange 只看 config 變化），
  // 所以游標換行時用 microtask 重新 reconfigure（dispatch 不能在 update 進行中同步呼叫）。
  const relRefresher = EditorView.updateListener.of((u) => {
    if (!vimOn || !u.selectionSet) return;
    const cur = u.state.doc.lineAt(u.state.selection.main.head).number;
    const prev = u.startState.doc.lineAt(u.startState.selection.main.head).number;
    if (cur === prev) return;
    queueMicrotask(() => {
      if (vimOn) view.dispatch({ effects: relCompartment.reconfigure(relativeLineNumbers()) });
    });
  });

  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        vimCompartment.of(vimOn ? vim({ status: true }) : []),
        relCompartment.of(vimOn ? relativeLineNumbers() : []),
        relRefresher,
        basicSetup,
        javascript(),
        execLineField,
        EditorView.theme({}, { dark: true }),
      ],
    }),
    parent,
  });

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    setExecHighlight(line) {
      view.dispatch({ effects: setExecLine.of(line) });
    },
    vimEnabled: () => vimOn,
    setVim(on) {
      vimOn = on;
      view.dispatch({
        effects: [
          vimCompartment.reconfigure(on ? vim({ status: true }) : []),
          relCompartment.reconfigure(on ? relativeLineNumbers() : []),
        ],
      });
    },
    // 無頭驗收用
    helpers: {
      focus: () => view.focus(),
      setCursorLine: (n) => {
        view.dispatch({ selection: { anchor: view.state.doc.line(n).from } });
      },
      lineNumberTexts: () =>
        Array.from(view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
          .map((el) => el.textContent.trim())
          .filter(Boolean),
      cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
      cursorCh: () => {
        const head = view.state.selection.main.head;
        return head - view.state.doc.lineAt(head).from;
      },
      vimInsertMode: () => {
        const cm = getCM(view);
        return !!(cm && cm.state.vim && cm.state.vim.insertMode);
      },
    },
  };
}
