import type { Game } from '../core/Game';

interface Entry {
  name: string;
  lines: string[];
  devil: boolean;
  onDone?: () => void;
}

/** 画面下のセリフ枠（文字送り＋キュー） */
export class Dialogue {
  active = false;
  private box: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private cur: Entry | null = null;
  private idx = 0;
  private typed = 0;
  private pending: Entry[] = [];
  private openedAt = 0;

  constructor(private game: Game, root: HTMLElement) {
    this.box = document.createElement('div');
    this.box.className = 'dialogue hidden';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'dlg-name';
    this.textEl = document.createElement('div');
    this.textEl.className = 'dlg-text';
    const more = document.createElement('div');
    more.className = 'dlg-more';
    more.textContent = '▼ E / クリック';
    this.box.append(this.nameEl, this.textEl, more);
    root.appendChild(this.box);
  }

  show(name: string, lines: string[], devil = false, onDone?: () => void) {
    const e = { name, lines, devil, onDone };
    if (this.active) this.pending.unshift(e);
    else this.open(e);
  }

  /** 今の会話のあとに続ける */
  queue(name: string, lines: string[], devil = false, onDone?: () => void) {
    const e = { name, lines, devil, onDone };
    if (this.active) this.pending.push(e);
    else this.open(e);
  }

  private open(e: Entry) {
    this.cur = e;
    this.idx = 0;
    this.typed = 0;
    this.active = true;
    this.openedAt = this.game.frame;
    this.box.classList.remove('hidden');
    this.box.classList.toggle('devil', e.devil);
    this.box.classList.toggle('narration', !e.name);
    this.nameEl.textContent = e.name;
    this.render();
  }

  private render() {
    if (!this.cur) return;
    const line = this.cur.lines[this.idx] ?? '';
    this.textEl.textContent = line.slice(0, Math.floor(this.typed));
  }

  advance() {
    if (!this.cur) return;
    const line = this.cur.lines[this.idx] ?? '';
    if (this.typed < line.length) {
      this.typed = line.length;
      this.render();
      return;
    }
    this.game.audio.play('click', undefined, 0.4);
    this.idx++;
    this.typed = 0;
    if (this.idx >= this.cur.lines.length) {
      const done = this.cur.onDone;
      this.cur = null;
      this.active = false;
      this.box.classList.add('hidden');
      done?.();
      const next = this.pending.shift();
      if (next) this.open(next);
      return;
    }
    this.render();
  }

  update(dt: number) {
    if (!this.active || !this.cur) return;
    const line = this.cur.lines[this.idx] ?? '';
    if (this.typed < line.length) {
      this.typed = Math.min(line.length, this.typed + dt * 34);
      this.render();
    }
    const inp = this.game.input;
    if (this.game.frame !== this.openedAt && (inp.pressed('KeyE') || inp.pressed('Space') || inp.pressed('Enter') || inp.mousePressed(0))) this.advance();
  }
}
