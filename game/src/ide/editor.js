// 遊戲內 IDE：CodeMirror 6（JS 高亮＋vim＋執行行反白），自 spike-web main.js 抽出（M2 接上 dungeon panel）。
import { basicSetup } from 'codemirror';
import { EditorView, Decoration } from '@codemirror/view';
import { EditorState, StateEffect, StateField, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { vim, getCM } from '@replit/codemirror-vim';

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
  let vimOn = vimEnabled;

  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        vimCompartment.of(vimOn ? vim({ status: true }) : []),
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
      view.dispatch({ effects: vimCompartment.reconfigure(on ? vim({ status: true }) : []) });
    },
    // 無頭驗收用
    helpers: {
      focus: () => view.focus(),
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
