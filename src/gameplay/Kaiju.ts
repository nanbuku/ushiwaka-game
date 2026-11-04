import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G, groups, quatY, RAPIER } from '../core/Physics';
import { clamp, damp, rand } from '../core/Rng';
import { furMaterial } from '../player/Fur';

const SHELLS = 12;

/**
 * 終章のボス：捨てられたぬいぐるみに灰色の想いが注がれて生まれた、巨大な怪獣〈グレイ〉。
 * なんくの家をめざして歩き、足元の建物を踏みつぶし、灰色のビームを吐く。
 */
export class Kaiju {
  root = new THREE.Group();
  maxHp = 9000;
  hp = 9000;
  pos: THREE.Vector3;
  yaw = 0;
  gone = false;
  dying = -1;
  collider: RAPIER.Collider;
  private body: RAPIER.RigidBody;
  private t = 0;
  private stepT = 1;
  private beamT = 5;
  private side = 0;
  private flash = 0;
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private head = new THREE.Group();
  private mats: THREE.MeshStandardMaterial[] = [];

  constructor(
    private game: Game,
    x: number,
    z: number,
    private goal: THREE.Vector3,
  ) {
    this.pos = new THREE.Vector3(x, game.world.groundHeight(x, z), z);
    this.yaw = Math.atan2(goal.x - x, goal.z - z);
    const fur = furMaterial('#8e8b93', 0.3, SHELLS, 7);
    const pale = furMaterial('#bdb9c2', 0.22, SHELLS, 8);
    this.mats.push(fur.material, pale.material);
    const ell = (rx: number, ry: number, rz: number) => new THREE.SphereGeometry(1, 20, 14).scale(rx, ry, rz);
    const part = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, px: number, py: number, pz: number) => {
      const im = new THREE.InstancedMesh(geo, m, SHELLS);
      im.position.set(px, py, pz);
      im.frustumCulled = false;
      im.castShadow = true;
      parent.add(im);
      return im;
    };
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 2.2, 4.2, 0);
      part(ell(1.6, 2.6, 1.6), fur.material, leg, 0, -1.6, 0);
      part(ell(1.8, 0.9, 2.3), pale.material, leg, 0, -3.7, 0.5);
      this.root.add(leg);
      this.legs.push(leg);
      const arm = new THREE.Group();
      arm.position.set(sx * 4.0, 10.5, 0);
      arm.rotation.z = sx * 0.45;
      part(ell(1.3, 3.2, 1.3), fur.material, arm, 0, -2.6, 0);
      this.root.add(arm);
      this.arms.push(arm);
    }
    part(ell(4.2, 4.6, 3.6), fur.material, this.root, 0, 8.2, 0);
    part(ell(2.8, 3.0, 0.9), pale.material, this.root, 0, 7.8, 2.9);
    this.head.position.set(0, 14.6, 0.2);
    this.root.add(this.head);
    part(ell(3.6, 3.2, 3.2), fur.material, this.head, 0, 0, 0);
    part(ell(1.6, 1.1, 1.2), pale.material, this.head, 0, -0.9, 2.7);
    for (const sx of [-1, 1]) part(ell(1.25, 1.25, 0.6), fur.material, this.head, sx * 2.6, 2.6, 0);
    const black = new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.4 });
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), black);
    nose.position.set(0, -0.5, 3.85);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 16).rotateX(Math.PI / 2), black);
    button.position.set(-1.3, 0.5, 2.85);
    // 取れたボタンの穴から、赤く光る目
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), new THREE.MeshBasicMaterial({ color: '#ff2a2a' }));
    eye.position.set(1.3, 0.5, 2.8);
    // つぎはぎ
    for (let i = 0; i < 5; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), black);
      st.position.set(-0.4 + i * 0.25, 2.1, 2.3);
      st.rotation.x = -0.6;
      this.head.add(st);
    }
    this.head.add(nose, button, eye);
    game.scene.add(this.root);

    const w = game.physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y, this.pos.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(5.5, 4).setTranslation(0, 9, 0).setCollisionGroups(groups(G.STATIC, G.ALL)), this.body);
    this.sync();
  }

  get alive() {
    return this.dying < 0;
  }

  /** 攻撃を受けた */
  damage(amount: number) {
    if (this.dying >= 0) return;
    this.hp -= amount;
    this.flash = 0.18;
    if (this.hp <= this.maxHp * 0.35 && this.hp + amount > this.maxHp * 0.35) {
      this.game.hud.toast('グレイが怒り狂っている！ 動きが速くなった！', 'bad', 3);
      this.game.audio.play('bigbark', this.pos, 1, 0.3);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dying = 0;
      this.game.audio.play('bigbark', this.pos, 1, 0.25);
      this.game.physics.world.removeCollider(this.collider, true);
    }
  }

  update(dt: number) {
    const g = this.game;
    this.t += dt;
    if (this.dying >= 0) {
      // 小さな古いぬいぐるみに戻っていく
      this.dying += dt;
      this.root.scale.setScalar(Math.max(0.025, 1 - this.dying / 3));
      if (Math.random() < dt * 20) g.fx.sparks(this.pos.clone().add(new THREE.Vector3(rand.range(-3, 3), rand.range(1, 12) * this.root.scale.y, rand.range(-3, 3))));
      if (this.dying > 3.3) this.gone = true;
      this.sync();
      return;
    }
    const to = this.goal.clone().sub(this.pos).setY(0);
    const dist = to.length();
    const angry = this.hp < this.maxHp * 0.35;
    const speed = dist > 24 ? (angry ? 3.4 : 2.3) : 0;
    const p = g.player.driving ? g.player.driving.pos : g.player.pos;
    if (speed > 0) {
      let d = Math.atan2(to.x, to.z) - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * damp(1.2, dt);
      this.pos.x += Math.sin(this.yaw) * speed * dt;
      this.pos.z += Math.cos(this.yaw) * speed * dt;
    }
    this.pos.y = g.world.groundHeight(this.pos.x, this.pos.z);
    const ph = this.t * (speed > 0 ? 2.3 : 0.9);
    const amp = speed > 0 ? 0.45 : 0.08;
    this.legs[0].rotation.x = Math.sin(ph) * amp;
    this.legs[1].rotation.x = -Math.sin(ph) * amp;
    this.arms[0].rotation.x = -Math.sin(ph) * amp * 0.8;
    this.arms[1].rotation.x = Math.sin(ph) * amp * 0.8;
    this.root.rotation.z = Math.sin(ph) * 0.05;
    let look = Math.atan2(p.x - this.pos.x, p.z - this.pos.z) - this.yaw;
    while (look > Math.PI) look -= Math.PI * 2;
    while (look < -Math.PI) look += Math.PI * 2;
    this.head.rotation.y += (clamp(look, -0.9, 0.9) - this.head.rotation.y) * damp(2, dt);
    // 足音（建物を踏みつぶす）
    if (speed > 0) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = Math.PI / 2.3 / (angry ? 1.45 : 1);
        this.stomp();
      }
    }
    // 灰色のビーム
    this.beamT -= dt;
    const dp = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    if (this.beamT <= 0 && !g.dialogue.active && dp < 110 && !g.player.dead) {
      this.beamT = angry ? 3.2 : 5.2;
      const from = new THREE.Vector3(0, -0.9, 3.5).applyMatrix4(this.head.matrixWorld);
      const to2 = p.clone().add(new THREE.Vector3(rand.range(-2.5, 2.5), 0.4, rand.range(-2.5, 2.5)));
      g.police.fireShell(from, to2, 55, '#b7a8ff');
      g.audio.play('bigbark', this.pos, 1, 0.35);
    }
    // 近づきすぎると、腕でなぎはらう
    if (dp < 9 && !g.player.driving && Math.random() < dt * 0.8) {
      g.player.hurt(28, this.pos);
      g.player.vel.add(g.player.pos.clone().sub(this.pos).setY(0).normalize().multiplyScalar(16).setY(8));
      g.hud.popText(g.player.headWorld(), 'ドゴッ!', '#ff9f9f', 30);
    }
    if (this.flash > 0) this.flash -= dt;
    for (const m of this.mats) m.emissiveIntensity = 0.1 + Math.max(0, this.flash) * 6;
    this.sync();
  }

  private stomp() {
    const g = this.game;
    this.side = 1 - this.side;
    const sx = this.side ? 2.2 : -2.2;
    const fp = this.pos.clone().add(new THREE.Vector3(Math.cos(this.yaw) * sx + Math.sin(this.yaw) * 1.5, 0, -Math.sin(this.yaw) * sx + Math.cos(this.yaw) * 1.5));
    g.destruction.damageArea(fp, 9, 1500, true, false);
    for (const n of g.npcs.list) {
      if (!n.alive || Math.hypot(n.pos.x - fp.x, n.pos.z - fp.z) > 7) continue;
      n.fling(n.pos.clone().sub(fp).setY(0).normalize().multiplyScalar(12).setY(9));
    }
    for (const v of g.traffic.list) {
      if (v.charred || Math.hypot(v.pos.x - fp.x, v.pos.z - fp.z) > 7) continue;
      if (v === g.player.driving) v.hp -= 40;
      else v.blast(v.pos.clone().sub(fp).setY(0).normalize().multiplyScalar(8).setY(8));
    }
    const dp = g.player.pos.distanceTo(fp);
    if (dp < 6) g.player.hurt(22, fp);
    g.camRig.addShake(Math.max(0, 1.4 - g.camera.position.distanceTo(fp) / 45));
    g.audio.play('crash', fp, 1, 0.45);
    for (let i = 0; i < 6; i++) g.fx.smoke(fp.clone().add(new THREE.Vector3(rand.range(-3, 3), 0.5, rand.range(-3, 3))), false);
  }

  private sync() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.updateMatrixWorld(true);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.body.setNextKinematicRotation(quatY(this.yaw));
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.game.physics.world.removeRigidBody(this.body);
  }
}
