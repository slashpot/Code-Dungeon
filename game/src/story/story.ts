// v0.1 劇情最小集（一條線，無分支）：開場獨白 → 老周接案（解鎖機房）→ 通關 → 交差 → To be continued。
// flags 進 localStorage（`save.ts`），對應驗收「新開存檔→對話→dungeon→交差流程無死路；重開能接續」。
import { loadSave, save } from '../save.ts';
import type { StoryFlags } from '../save.ts';
import type { DialogueUi, DialogueLine } from './dialogue.ts';

const INTRO: DialogueLine[] = [
  { who: '', text: '又是酸雨的一天。房租拖了兩週，帳戶剩 ¤340。' },
  { who: '', text: '我的全部資產：一台改裝終端機，和一雙還算快的手。' },
  { who: '', text: '聽說路口的老周在找會寫程式的人。去碰碰運氣吧。' },
];
const ACCEPT: DialogueLine[] = [
  { who: '老周', text: '新面孔？嗯……聽說你的手腳還算乾淨。' },
  { who: '老周', text: '北邊那間機房，門禁是 Nakamura 的舊系統。把裡面的守衛程式清乾淨，走到資料井就算完事。' },
  { who: '老周', text: '你人不用進去——用終端機寫腳本，操控 avatar 替你跑。avatar 掛了就再來，人不會有事。' },
  { who: '老周', text: '酬勞 ¤2,000。門，我幫你開好了。' },
];
const REMIND: DialogueLine[] = [
  { who: '老周', text: '機房在北邊，黃色的大門。記住：用腳本，別逞英雄。' },
];
const REPORT: DialogueLine[] = [
  { who: '老周', text: '乾淨俐落。¤2,000，轉過去了。' },
  { who: '老周', text: '不過——你清掉的守衛程式，記錄檔裡有 Nakamura 以外的簽名。有人比你早一步進去過。' },
  { who: '老周', text: '風聲有點緊。先別問，之後有案子我再找你。' },
];
const AFTER: DialogueLine[] = [
  { who: '老周', text: '先避避風頭。之後有案子我再找你。' },
];

export const LOCKED_DOOR_MSG = '機房大門深鎖，門禁亮著紅燈。先去找個案子吧——路口的老周好像在找人。';

export interface Story {
  flags: StoryFlags;
  questText(): string;
  introIfNeeded(): void;
  talkToClient(): void;
  canEnterDungeon(): boolean;
  markJobDone(): void;
}

export interface CreateStoryOpts {
  dialogue: DialogueUi;
  onQuestChange?: (text: string) => void;
  onMsg?: (text: string) => void;
  onTbc?: () => void;
}

export function createStory({ dialogue, onQuestChange, onMsg, onTbc }: CreateStoryOpts): Story {
  const s = loadSave().story || {};
  const flags: StoryFlags = { intro: !!s.intro, accepted: !!s.accepted, done: !!s.done, reported: !!s.reported };

  function questText(): string {
    if (!flags.accepted) return '目標：找路口的老周接個案子';
    if (!flags.done) return '目標：潛入機房（北邊黃色大門）';
    if (!flags.reported) return '目標：回去找老周交差';
    return '';
  }
  function persist(): void {
    save({ story: { ...flags } });
    if (onQuestChange) onQuestChange(questText());
  }

  function introIfNeeded(): void {
    if (flags.intro) return;
    dialogue.show(INTRO, () => { flags.intro = true; persist(); });
  }

  function talkToClient(): void {
    if (!flags.accepted) {
      dialogue.show(ACCEPT, () => {
        flags.accepted = true;
        persist();
        if (onMsg) onMsg('任務更新：潛入機房（北邊黃色大門）');
      });
    } else if (!flags.done) {
      dialogue.show(REMIND);
    } else if (!flags.reported) {
      dialogue.show(REPORT, () => {
        flags.reported = true;
        persist();
        if (onTbc) onTbc();
      });
    } else {
      dialogue.show(AFTER);
    }
  }

  function canEnterDungeon(): boolean { return flags.accepted; }
  function markJobDone(): void {
    if (!flags.done) { flags.done = true; persist(); }
  }

  return { flags, questText, introIfNeeded, talkToClient, canEnterDungeon, markJobDone };
}
