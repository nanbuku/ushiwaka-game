import type * as THREE from 'three';
import type { Game } from '../core/Game';
import type { ItemDef } from './Items';

export type CrimeKind = 'bite' | 'kill' | 'steal' | 'shrine' | 'faint' | 'bomb';

const VICTIM: Record<string, string> = {
  man: '男の人',
  woman: '女の人',
  child: '子ども',
  elderly: 'お年寄り',
  office: '会社員',
  clerk: '店員さん',
  catcher: '保健所の職員',
};

const SAVE_KEY = 'ushiwaka-save-v1';

/**
 * なんくの心の状態。
 * 通常は「幸福度」を上げていくが、うしわかの悪行が一定を超えると
 * なんくが悪に目覚め、「悪魔度」を上げる物語に切り替わる。
 */
export class Karma {
  happiness = 12;
  evil = 0;
  devil = 0;
  mode: 'normal' | 'devil' = 'normal';
  fallPending = false;
  ended: null | 'happy' | 'devil' = null;
  stats = { bites: 0, kills: 0, steals: 0, faints: 0, gifts: 0 };
  static FALL = 100;

  constructor(private game: Game) {}

  /** 悪行 25 刻みの段階（なんくのセリフが変わる） */
  get tier() {
    if (this.evil < 25) return 0;
    if (this.evil < 55) return 1;
    if (this.evil < 85) return 2;
    return 3;
  }

  crime(kind: CrimeKind, pos: THREE.Vector3, detail = '', count = 1, cause: 'bite' | 'car' | 'bomb' = 'bite') {
    const g = this.game;
    g.heat.report(kind, pos, detail === 'catcher');
    g.requests.onCrime(kind, detail, pos, count);
    let pts = { bite: 3, kill: 12, steal: 2, shrine: 4, faint: 1, bomb: 5 }[kind] * count;
    if (kind === 'kill' && (detail === 'child' || detail === 'elderly')) pts += 4;
    this.evil += pts;
    if (this.mode === 'devil') this.devil = Math.min(100, this.devil + pts * 0.5);
    switch (kind) {
      case 'bite':
        this.stats.bites++;
        g.hud.toast(`${VICTIM[detail] ?? '人'}に噛みついた　悪行 +${pts}`, 'bad');
        break;
      case 'kill': {
        this.stats.kills += count;
        const who = count > 1 ? `${count}人` : VICTIM[detail] ?? '人';
        const how = cause === 'car' ? 'をはねた…' : cause === 'bomb' ? 'を爆発に巻き込んだ…' : 'を噛み殺した…';
        g.hud.toast(`${who}${how}　悪行 +${pts}`, 'bad');
        break;
      }
      case 'steal':
        this.stats.steals++;
        g.hud.toast(`${detail}を盗んだ　悪行 +${pts}`, 'bad');
        g.audio.play('steal', g.player.pos, 0.6);
        break;
      case 'shrine':
        this.stats.steals++;
        g.hud.toast(`お供え物の${detail}を盗んだ　バチ当たり！ 悪行 +${pts}`, 'bad');
        g.audio.play('steal', g.player.pos, 0.6);
        break;
      case 'bomb':
        g.hud.toast(`爆弾を爆発させた！　悪行 +${pts}`, 'bad');
        break;
      case 'faint':
        this.stats.faints += count;
        g.hud.toast(`${detail}を気絶させた　悪行 +${pts}`, 'bad');
        break;
    }
    if (this.mode === 'normal' && !this.fallPending && this.evil >= Karma.FALL) {
      this.fallPending = true;
      g.audio.play('evil');
      g.hud.toast('なんくの様子が…？　家に帰ってみよう', 'evil', 6);
    }
    this.checkDevilEnd();
  }

  /** なんくに物を渡したときの変化量を返す */
  gift(def: ItemDef, stolen: boolean) {
    this.stats.gifts++;
    if (this.mode === 'normal') {
      const before = this.happiness;
      this.happiness = Math.min(100, this.happiness + def.happy);
      return this.happiness - before;
    }
    const before = this.devil;
    this.devil = Math.min(100, this.devil + def.devil + (stolen ? 3 : 0));
    return this.devil - before;
  }

  fall() {
    this.mode = 'devil';
    this.fallPending = false;
    this.devil = Math.max(this.devil, 20);
    this.game.requests.cancelIfModeChanged();
  }

  checkDevilEnd() {
    return this.mode === 'devil' && this.devil >= 100;
  }

  get happyEndReady() {
    return this.mode === 'normal' && this.happiness >= 100;
  }

  // ---------- セーブ ----------
  save() {
    try {
      const g = this.game;
      const data = {
        happiness: this.happiness,
        evil: this.evil,
        devil: this.devil,
        mode: this.mode,
        fallPending: this.fallPending,
        ended: this.ended,
        stats: this.stats,
        hours: g.sky.hours,
        requests: g.requests.save(),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* 保存できない環境では何もしない */
    }
  }

  static hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      this.happiness = d.happiness ?? 12;
      this.evil = d.evil ?? 0;
      this.devil = d.devil ?? 0;
      this.mode = d.mode === 'devil' ? 'devil' : 'normal';
      this.fallPending = !!d.fallPending;
      this.ended = d.ended ?? null;
      this.stats = { ...this.stats, ...(d.stats ?? {}) };
      if (typeof d.hours === 'number') this.game.sky.hours = d.hours;
      this.game.requests.load(d.requests);
      return true;
    } catch {
      return false;
    }
  }

  static clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* noop */
    }
  }
}
