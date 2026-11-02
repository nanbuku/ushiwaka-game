import * as THREE from 'three';
import type { Game } from '../core/Game';

/** 保健所に捕まったときの流れ（檻 → なんくのお迎え → 家） */
export class Capture {
  active = false;
  private t = 0;
  private phase = 0;

  constructor(private game: Game) {}

  begin() {
    const g = this.game;
    if (this.active || g.player.dead) return;
    this.active = true;
    this.t = 0;
    this.phase = 0;
    if (g.player.driving) g.player.exitVehicle();
    if (g.player.carrying) g.player.drop(false);
    g.audio.play('yelp', g.player.pos, 1);
    g.hud.toast('保健所につかまった！', 'bad', 4);
    g.hud.popText(g.player.headWorld(), 'キャイン!', '#ffffff', 30);
    g.hud.fade(true);
  }

  update(dt: number) {
    if (!this.active) return;
    const g = this.game;
    this.t += dt;
    if (this.phase === 0 && this.t > 1.0) {
      this.phase = 1;
      const pound = g.world.zones.find((z) => z.name === 'pound');
      if (pound) {
        const cx = (pound.rect.x0 + pound.rect.x1) / 2;
        const cz = (pound.rect.z0 + pound.rect.z1) / 2;
        g.player.teleport(new THREE.Vector3(cx, g.world.groundHeight(cx, cz) + 0.3, cz), 0);
        g.camRig.snapBehind(0);
        g.camRig.targetDist = 3.2;
      }
      g.heat.reset();
      g.npcs.dismissCatchers();
      g.hud.fade(false);
      g.dialogue.show(
        '保健所の職員',
        ['ふう、やっと捕まえたぞ。', 'こいつが噂の白い犬か…。どう見てもぬいぐるみだな。', '飼い主の「なんく」さんに連絡しておいた。迎えが来るまで、おとなしくしてろよ。'],
        false,
        () => {
          this.phase = 2;
          this.t = 0;
          g.hud.fade(true);
        },
      );
    }
    if (this.phase === 2 && this.t > 1.0) {
      this.phase = 3;
      this.active = false;
      g.respawnAtHome(false);
      g.hud.fade(false);
      const k = g.karma;
      if (k.mode === 'devil') {
        k.devil = Math.min(100, k.devil + 4);
        g.dialogue.show('なんく', ['保健所のやつら、私のうしわかを檻に入れるなんて…。', '許さない。今度来たら、あいつらの番だからね。'], true);
      } else {
        k.happiness = Math.max(0, k.happiness - 6);
        g.dialogue.show('なんく', ['うしわか！ 保健所から電話があって、心臓が止まるかと思った…。', '何回も頭を下げて、やっと返してもらえたんだよ。', 'お願いだから、いい子にしててね…？'], false);
        g.hud.toast('なんくの幸福度 -6', 'bad');
      }
      k.save();
    }
  }
}
