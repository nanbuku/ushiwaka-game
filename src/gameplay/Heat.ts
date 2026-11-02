import * as THREE from 'three';
import type { Game } from '../core/Game';
import { clamp, rand } from '../core/Rng';
import type { CrimeKind } from './Karma';

const GAIN: Record<CrimeKind, number> = { faint: 0.25, steal: 0.45, shrine: 0.5, bite: 0.8, kill: 1.6 };

/**
 * 通報レベル（0〜5）。目撃者がいる悪事で上がり、保健所の職員が追ってくる。
 * 職員に見つからずにいると少しずつ下がる。
 */
export class Heat {
  value = 0;
  /** 職員に見られているか */
  seen = false;
  private unseenT = 0;
  private captureT = 0;
  capturing = false;
  private lastLevel = 0;

  constructor(private game: Game) {}

  get level() {
    return Math.floor(this.value + 1e-6);
  }

  report(kind: CrimeKind, pos: THREE.Vector3, victimIsCatcher = false) {
    const g = this.game;
    const radius = kind === 'steal' ? 14 : 22;
    const witnesses = g.npcs.witnesses(pos, radius);
    let gain = GAIN[kind] * (witnesses > 0 ? 1 : 0.25);
    if (victimIsCatcher) gain += 0.8;
    if (kind === 'steal' && witnesses > 0) g.hud.popText(pos.clone().setY(pos.y + 1.6), rand.pick(['どろぼう!', '万引きよ!', 'あっ、犬が!']), '#ffd166', 22);
    this.value = clamp(this.value + gain, 0, 5.99);
    this.unseenT = 0;
  }

  reset() {
    this.value = 0;
    this.captureT = 0;
    this.capturing = false;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player.pos;
    // 職員に見られているか
    let nearest = Infinity;
    for (const n of g.npcs.list) {
      if (n.kind !== 'catcher' || !n.conscious) continue;
      nearest = Math.min(nearest, Math.hypot(n.pos.x - p.x, n.pos.z - p.z));
    }
    this.seen = nearest < 32;
    if (!this.seen) {
      this.unseenT += dt;
      if (this.unseenT > 10) this.value = Math.max(0, this.value - dt * 0.09);
    } else this.unseenT = 0;

    const lv = this.level;
    if (lv > this.lastLevel) {
      g.hud.toast(lv >= 4 ? '保健所の特別捕獲班が出動した！' : `通報レベル ${lv}　保健所の職員が向かっている！`, 'bad', 4);
      g.audio.play('evil', undefined, 0.35);
    } else if (lv === 0 && this.lastLevel > 0) {
      g.hud.toast('保健所の追跡をふりきった', 'info', 3);
    }
    this.lastLevel = lv;

    // 捕獲判定（職員が近くにいて、うしわかが遅いと捕まる）
    if (g.player.dead || g.dialogue.active || g.capture.active) {
      this.captureT = 0;
      this.capturing = false;
      return;
    }
    let close = false;
    for (const n of g.npcs.list) {
      if (n.kind !== 'catcher' || !n.conscious) continue;
      if (Math.hypot(n.pos.x - p.x, n.pos.z - p.z) < 1.25) close = true;
    }
    const speed = Math.hypot(g.player.vel.x, g.player.vel.z);
    if (close && speed < 6.5) this.captureT += dt;
    else this.captureT = Math.max(0, this.captureT - dt * 1.5);
    this.capturing = this.captureT > 0.05;
    if (this.captureT > 1.1) {
      this.captureT = 0;
      g.capture.begin();
    }
  }

  get captureProgress() {
    return clamp(this.captureT / 1.1, 0, 1);
  }
}
