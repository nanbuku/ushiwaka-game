import * as THREE from 'three';
import type { Game } from '../core/Game';
import { rand } from '../core/Rng';
import { VehicleModel } from '../vehicles/VehicleModel';
import { makeSign } from './Kit';

const R = 430;
const ALT = 150;

/**
 * 空を飛ぶもの：グレイハート社の飛行船〈モノクローム号〉（街の上を回る。撃ち落とせる）と、
 * 遠くをただよう気球。
 */
export class Skyships {
  /** 飛行船（ミサイルの狙いにもなる） */
  ship = { root: new THREE.Group(), pos: new THREE.Vector3(), hp: 2400, maxHp: 2400, falling: -1, respawn: 0, hitR: 22 };
  private a = 0;
  private balloons: { root: THREE.Object3D; a: number; r: number; y: number; s: number }[] = [];

  constructor(private game: Game) {
    const r = this.ship.root;
    const gray = new THREE.MeshStandardMaterial({ color: '#6b6e75', roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2f3238', roughness: 0.5 });
    const env = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18).scale(13, 13, 46), gray);
    env.castShadow = true;
    r.add(env);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 12, 10), dark);
      const ang = (i / 4) * Math.PI * 2;
      fin.position.set(Math.cos(ang) * 10, Math.sin(ang) * 10, -40);
      fin.rotation.z = ang + Math.PI / 2;
      r.add(fin);
    }
    const gondola = new THREE.Mesh(new THREE.BoxGeometry(5, 3.5, 18), dark);
    gondola.position.set(0, -14, 4);
    r.add(gondola);
    for (const sx of [-1, 1]) {
      const sign = makeSign('MONOCHROME', 34, 7, '#2f3238', '#d8d8e0', true);
      sign.position.set(sx * 13.2, 0, 0);
      sign.rotation.y = (sx * Math.PI) / 2;
      r.add(sign);
    }
    game.scene.add(r);
    for (let i = 0; i < 4; i++) {
      const m = new VehicleModel('balloon', rand.next());
      m.root.scale.setScalar(1.3);
      game.scene.add(m.root);
      this.balloons.push({ root: m.root, a: rand.range(0, Math.PI * 2), r: rand.range(250, 560), y: rand.range(60, 120), s: rand.range(0.006, 0.012) * (rand.chance(0.5) ? 1 : -1) });
    }
  }

  get alive() {
    return this.ship.falling < 0 && this.ship.respawn <= 0;
  }

  /** 爆発に巻き込まれた */
  onExplosion(pos: THREE.Vector3, R2: number, scale: number, byPlayer: boolean) {
    const s = this.ship;
    if (!byPlayer || !this.alive || pos.distanceTo(s.pos) > R2 + 26) return;
    s.hp -= 320 * scale;
    this.game.fx.sparks(pos);
    if (s.hp <= 0) {
      s.falling = 0;
      this.game.hud.toast('グレイハートの飛行船〈モノクローム号〉を撃ち落とした！', 'good', 5);
      this.game.audio.play('boom', s.pos, 1, 0.5);
    }
  }

  update(dt: number) {
    const g = this.game;
    const s = this.ship;
    for (const b of this.balloons) {
      b.a += b.s * dt;
      b.root.position.set(Math.cos(b.a) * b.r, b.y + Math.sin(b.a * 7) * 4, Math.sin(b.a) * b.r);
    }
    if (s.respawn > 0) {
      s.respawn -= dt;
      if (s.respawn <= 0) {
        s.hp = s.maxHp;
        s.root.visible = true;
        s.root.rotation.z = 0;
      }
      return;
    }
    if (s.falling >= 0) {
      // 燃えながら落ちる
      s.falling += dt;
      s.pos.y -= (4 + s.falling * 9) * dt;
      s.root.rotation.z += dt * 0.25;
      s.root.rotation.x += dt * 0.12;
      s.root.position.copy(s.pos);
      if (Math.random() < dt * 25) g.fx.flame(s.pos.clone().add(new THREE.Vector3(rand.range(-10, 10), rand.range(-6, 8), rand.range(-30, 30))), 3);
      if (Math.random() < dt * 15) g.fx.smoke(s.pos.clone().add(new THREE.Vector3(rand.range(-10, 10), 5, rand.range(-30, 30))), true);
      if (s.pos.y < g.world.groundHeight(s.pos.x, s.pos.z) + 6) {
        g.explode(s.pos.clone().setY(g.world.groundHeight(s.pos.x, s.pos.z) + 1), false, 3.2);
        s.root.visible = false;
        s.falling = -1;
        s.respawn = 150;
      }
      return;
    }
    this.a += (11 / R) * dt;
    s.pos.set(Math.cos(this.a) * R, ALT, Math.sin(this.a) * R);
    s.root.position.copy(s.pos);
    s.root.rotation.y = -this.a;
  }
}
