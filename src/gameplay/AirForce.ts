import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G, groups, RAPIER } from '../core/Physics';
import { clamp, rand } from '../core/Rng';
import { ARMED } from '../npc/Human';
import { VehicleModel } from '../vehicles/VehicleModel';
import { castShot } from './Guns';

interface Craft {
  kind: 'jet' | 'heli';
  model: VehicleModel;
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  vel: THREE.Vector3;
  speed: number;
  hp: number;
  hitR: number;
  alive: boolean;
  falling: boolean;
  leaving: boolean;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  missileCd: number;
  gunCd: number;
  burst: number;
  orbit: number;
  seeT: number;
  see: boolean;
  roll: number;
}

interface EMissile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Mesh;
  t: number;
  decoy: THREE.Vector3 | null;
}

/**
 * 敵の空軍。盗んだ機体で飛び回ったり、通報レベルが上がると、
 * 戦闘機（追尾ミサイル・機関砲）と攻撃ヘリ（機関砲・ロケット）が出撃する。
 * 敵のミサイルはフレア（X / 戦闘機は Space）でそらせる。
 */
export class AirForce {
  crafts: Craft[] = [];
  missiles: EMissile[] = [];
  private flares: { mesh: THREE.Mesh; vel: THREE.Vector3; t: number }[] = [];
  private flareCd = 0;
  private flyT = 0;
  private spawnT = 0;
  private beepT = 0;
  private lastTgt = new THREE.Vector3();
  private tgtVel = new THREE.Vector3();
  private warnEl: HTMLDivElement;
  warn = false;
  private flareMat = new THREE.MeshBasicMaterial({ color: '#fff2b0' });
  private missileMat = new THREE.MeshBasicMaterial({ color: '#e8e8e8' });

  constructor(private game: Game) {
    this.warnEl = document.createElement('div');
    this.warnEl.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);font:800 26px "M PLUS Rounded 1c",sans-serif;color:#ff4d4d;text-shadow:0 0 8px #000,0 0 2px #000;pointer-events:none;z-index:30;display:none;letter-spacing:2px';
    this.warnEl.textContent = '⚠ ミサイル接近！ フレア（X / Space）';
    document.body.appendChild(this.warnEl);
  }

  private target() {
    const p = this.game.player;
    return p.driving ? p.driving.pos.clone().setY(p.driving.pos.y + 1.2) : p.pos.clone().setY(p.pos.y + 0.4);
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    const pv = p.driving;
    const air = pv && (pv.kind === 'jet' || pv.kind === 'heli') ? pv : null;
    const airborne = !!air && air.pos.y > g.world.groundHeight(air.pos.x, air.pos.z) + 4;
    // 盗んだ機体で飛び続けると、防衛隊が戦闘機を出してくる
    if (airborne) {
      this.flyT += dt;
      if (this.flyT > 12) g.heat.value = Math.min(5.6, Math.max(g.heat.value, 2.2) + dt * 0.12);
    } else this.flyT = 0;
    const tgt = this.target();
    if (dt > 0) this.tgtVel.copy(tgt).sub(this.lastTgt).divideScalar(dt).clampLength(0, 200);
    this.lastTgt.copy(tgt);
    const lv = g.heat.level;
    const calm = p.dead || g.capture.active || g.dialogue.active;
    const wantJet = calm || !airborne ? 0 : lv >= 5 ? 3 : lv >= 4 ? 2 : lv >= 3 ? 1 : 0;
    const wantHeli = calm ? 0 : lv >= 5 ? 2 : lv >= 4 ? 1 : 0;
    const active = (k: 'jet' | 'heli') => this.crafts.filter((c) => c.kind === k && c.alive && !c.leaving);
    for (const [k, want] of [['jet', wantJet], ['heli', wantHeli]] as const) {
      const list = active(k);
      for (let i = want; i < list.length; i++) list[i].leaving = true;
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 5;
      if (active('jet').length < wantJet) this.spawn('jet', tgt);
      else if (active('heli').length < wantHeli) this.spawn('heli', tgt);
    }
    for (const c of this.crafts) this.think(c, tgt, dt, airborne);
    for (let i = this.crafts.length - 1; i >= 0; i--) {
      const c = this.crafts[i];
      if (!c.alive || (c.leaving && c.pos.distanceTo(tgt) > 1500)) this.remove(i);
    }
    this.updateMissiles(dt, tgt);
    // フレア
    this.flareCd -= dt;
    const inp = g.input;
    if (air && inp.active && !g.dialogue.busy && (inp.pressed('KeyX') || (air.kind === 'jet' && inp.pressed('Space'))) && this.flareCd <= 0) this.dropFlares(air.pos);
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.t += dt;
      f.vel.y -= 9 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.scale.setScalar(Math.max(0.1, 1.6 - f.t * 0.4));
      if (f.t > 3.5) {
        g.scene.remove(f.mesh);
        this.flares.splice(i, 1);
      }
    }
    this.warn = this.missiles.some((m) => !m.decoy && m.pos.distanceTo(tgt) < 900);
    this.warnEl.style.display = this.warn && Math.sin(performance.now() * 0.02) > -0.3 ? 'block' : 'none';
    if (this.warn) {
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = 0.25;
        g.audio.play('beep', undefined, 0.5, 1.5);
      }
    }
  }

  private spawn(kind: 'jet' | 'heli', tgt: THREE.Vector3) {
    const g = this.game;
    const a = rand.range(0, Math.PI * 2);
    const d = kind === 'jet' ? 1100 : 360;
    const x = clamp(tgt.x + Math.cos(a) * d, -1300, 1300);
    const z = clamp(tgt.z + Math.sin(a) * d, -1300, 1300);
    const y = kind === 'jet' ? 260 : g.world.groundHeight(x, z) + 60;
    const model = new VehicleModel(kind, 0.95);
    model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshStandardMaterial).color && !(m.material as THREE.Material).transparent) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.color.multiplyScalar(0.55);
        m.material = mat;
      }
    });
    g.scene.add(model.root);
    const w = g.physics.world;
    const body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    const collider = w.createCollider(
      RAPIER.ColliderDesc.cuboid(kind === 'jet' ? 2 : 1.6, 1.2, kind === 'jet' ? 5.5 : 4.2).setTranslation(0, 1.3, 0).setCollisionGroups(groups(G.VEHICLE, G.STATIC | G.VEHICLE)),
      body,
    );
    const pos = new THREE.Vector3(x, y, z);
    const fwd = tgt.clone().sub(pos).normalize();
    this.crafts.push({ kind, model, pos, fwd, vel: new THREE.Vector3(), speed: kind === 'jet' ? 92 : 0, hp: kind === 'jet' ? 300 : 360, hitR: 7, alive: true, falling: false, leaving: false, body, collider, missileCd: rand.range(3, 6), gunCd: 2, burst: 0, orbit: a, seeT: 0, see: false, roll: 0 });
    g.hud.toast(kind === 'jet' ? '防衛隊の戦闘機がスクランブル発進した！' : '防衛隊の攻撃ヘリが来た！', 'bad', 3.5);
  }

  private think(c: Craft, tgt: THREE.Vector3, dt: number, airborne: boolean) {
    const g = this.game;
    const gy = g.world.groundHeight(c.pos.x, c.pos.z);
    if (c.falling) {
      c.vel.y -= 22 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.roll += dt * 4;
      if (Math.random() < dt * 30) g.fx.flame(c.pos.clone(), 1.6);
      if (Math.random() < dt * 20) g.fx.smoke(c.pos.clone(), true);
      if (c.pos.y <= gy + 0.5) {
        g.explode(c.pos.clone().setY(gy + 0.5), false, 1.7);
        c.alive = false;
      }
      this.sync(c);
      return;
    }
    const toT = tgt.clone().sub(c.pos);
    const dist = toT.length();
    const dirT = toT.clone().divideScalar(Math.max(dist, 0.01));
    if (c.kind === 'jet') {
      const lead = tgt.clone().addScaledVector(this.tgtVel, dist / 260).sub(c.pos).normalize();
      const desired = c.leaving ? c.pos.clone().setY(0).normalize().setY(0.25).normalize() : dist < 160 ? c.fwd.clone() : lead;
      if (c.pos.y - gy < 70) desired.y = Math.max(desired.y, 0.4);
      desired.normalize();
      const ang = c.fwd.angleTo(desired);
      const prevYaw = Math.atan2(c.fwd.x, c.fwd.z);
      if (ang > 1e-4) c.fwd.lerp(desired, Math.min(1, (1.05 * dt) / ang)).normalize();
      let dy = Math.atan2(c.fwd.x, c.fwd.z) - prevYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      c.roll += (clamp((-dy / Math.max(dt, 1e-3)) * 1.2, -1.3, 1.3) - c.roll) * Math.min(1, dt * 3);
      c.vel.copy(c.fwd).multiplyScalar(c.speed);
      c.pos.addScaledVector(c.vel, dt);
      const aim = c.fwd.angleTo(dirT);
      c.missileCd -= dt;
      c.gunCd -= dt;
      if (!c.leaving && airborne && dist < 800 && dist > 160 && aim < 0.4 && c.missileCd <= 0) {
        c.missileCd = rand.range(7, 10);
        this.fireMissile(c.pos.clone().addScaledVector(c.fwd, 6), c.fwd.clone().multiplyScalar(c.speed + 30));
      }
      if (!c.leaving && dist < 320 && aim < 0.12 && c.gunCd <= 0) {
        c.gunCd = 0.1;
        this.gun(c, tgt, dist, 0.35);
      }
    } else {
      // ヘリ：目標のまわりを回りながら撃つ
      c.orbit += dt * 0.22;
      const ring = c.leaving ? c.pos.clone().multiplyScalar(1.5).setY(140) : tgt.clone().add(new THREE.Vector3(Math.cos(c.orbit) * 75, 0, Math.sin(c.orbit) * 75));
      if (!c.leaving) ring.y = Math.max(g.world.groundHeight(ring.x, ring.z), tgt.y) + 26;
      const want = ring.sub(c.pos).clampLength(0, 36);
      c.vel.lerp(want, Math.min(1, dt * 0.8));
      c.pos.addScaledVector(c.vel, dt);
      if (c.pos.y < gy + 8) c.pos.y = gy + 8;
      c.fwd.set(dirT.x, 0, dirT.z).normalize();
      c.roll = clamp(-c.vel.dot(new THREE.Vector3(Math.cos(Math.atan2(c.fwd.x, c.fwd.z)), 0, -Math.sin(Math.atan2(c.fwd.x, c.fwd.z)))) * 0.02, -0.4, 0.4);
      c.seeT -= dt;
      if (c.seeT <= 0) {
        c.seeT = 0.4;
        const hit = g.physics.raycast(c.pos.clone().setY(c.pos.y + 0.5), dirT, dist - 2, G.STATIC);
        c.see = !hit;
      }
      c.gunCd -= dt;
      c.missileCd -= dt;
      if (!c.leaving && c.see && dist < 170 && !g.player.dead) {
        if (c.gunCd <= 0) {
          if (c.burst <= 0) c.burst = 10;
          c.burst--;
          c.gunCd = c.burst > 0 ? 0.09 : rand.range(2.2, 3.2);
          this.gun(c, tgt, dist, 0.45);
        }
        // ロケットは地上の目標だけ（空の機体には機関砲）
        if (c.missileCd <= 0 && !airborne) {
          c.missileCd = rand.range(5, 7);
          for (let k = 0; k < 2; k++) g.police.fireShell(c.pos.clone().setY(c.pos.y + 0.8), tgt.clone().add(new THREE.Vector3(rand.range(-3, 3), 0, rand.range(-3, 3))), 95, '#ffb347');
          g.audio.play('whoosh', c.pos, 1, 0.7);
        }
      }
      if (c.model.rotor) c.model.rotor.rotation.y += dt * 30;
    }
    this.sync(c);
  }

  private gun(c: Craft, tgt: THREE.Vector3, dist: number, acc: number) {
    const g = this.game;
    const p = g.player;
    const from = c.pos.clone().setY(c.pos.y + 1).addScaledVector(c.fwd, c.kind === 'jet' ? 6 : 3);
    const dir = tgt.clone().sub(from);
    const sp = p.driving ? Math.abs(p.driving.speed) : Math.hypot(p.vel.x, p.vel.z);
    if (Math.random() > acc * clamp(1.2 - sp / 60, 0.3, 1)) {
      const m = 1 + dist * 0.03;
      dir.add(new THREE.Vector3(rand.range(-m, m), rand.range(-m, m), rand.range(-m, m)));
    }
    dir.normalize();
    const hit = castShot(g, from, dir, 420, { exclude: c.collider, hitPlayer: true, npcFilter: (n) => !ARMED.includes(n.kind) });
    g.weapons.tracers.add(from, hit.point, '#ff8a7a', 0.05);
    g.audio.play('gun', c.pos, 0.55, 0.85);
    if (hit.player) p.hurt(6, c.pos);
    else if (hit.vehicle) {
      hit.vehicle.hp -= hit.vehicle.kind === 'tank' ? 0.3 : 3;
      g.fx.sparks(hit.point);
    } else if (hit.npc) hit.npc.bitten(30, from);
  }

  private fireMissile(pos: THREE.Vector3, vel: THREE.Vector3) {
    const g = this.game;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.2, 8).rotateX(Math.PI / 2), this.missileMat);
    mesh.position.copy(pos);
    g.scene.add(mesh);
    this.missiles.push({ pos, vel, mesh, t: 0, decoy: null });
    g.audio.play('whoosh', pos, 1, 0.5);
  }

  private updateMissiles(dt: number, tgt: THREE.Vector3) {
    const g = this.game;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.t += dt;
      const aim = m.decoy ?? tgt;
      const want = aim.clone().sub(m.pos).normalize();
      const sp = Math.min(165, m.vel.length() + 60 * dt);
      const cur = m.vel.clone().normalize();
      const ang = cur.angleTo(want);
      if (ang > 1e-4) cur.lerp(want, Math.min(1, (1.9 * dt) / ang)).normalize();
      m.vel.copy(cur).multiplyScalar(sp);
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(m.pos.clone().add(m.vel));
      if (Math.random() < dt * 40) g.fx.smoke(m.pos.clone(), false);
      const gy = g.world.groundHeight(m.pos.x, m.pos.z);
      const near = m.pos.distanceTo(aim) < (m.decoy ? 8 : 7);
      if (near || m.t > 10 || m.pos.y < gy) {
        g.scene.remove(m.mesh);
        m.mesh.geometry.dispose();
        this.missiles.splice(i, 1);
        g.explode(m.pos.clone(), false, 1.3);
        if (m.decoy && near) g.thrills.count('dodge');
      }
    }
  }

  private dropFlares(pos: THREE.Vector3) {
    const g = this.game;
    this.flareCd = 5;
    for (let k = 0; k < 10; k++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), this.flareMat);
      mesh.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
      g.scene.add(mesh);
      this.flares.push({ mesh, vel: new THREE.Vector3(rand.range(-14, 14), rand.range(-4, 10), rand.range(-14, 14)), t: 0 });
    }
    for (const m of this.missiles) {
      if (!m.decoy && m.pos.distanceTo(pos) < 700 && Math.random() < 0.9) m.decoy = pos.clone().add(new THREE.Vector3(rand.range(-30, 30), rand.range(-25, 0), rand.range(-30, 30)));
    }
    g.audio.play('pop', pos, 1, 0.7);
    g.hud.popText(pos.clone().setY(pos.y + 3), 'フレア!', '#fff2b0', 22);
  }

  private sync(c: Craft) {
    const yaw = Math.atan2(c.fwd.x, c.fwd.z);
    const pitch = Math.asin(clamp(c.fwd.y, -1, 1));
    c.model.root.position.copy(c.pos);
    c.model.root.rotation.set(c.kind === 'jet' ? -pitch : clamp(c.vel.length() * 0.008, 0, 0.3), yaw, c.roll);
    c.body.setNextKinematicTranslation({ x: c.pos.x, y: c.pos.y, z: c.pos.z });
  }

  private damage(c: Craft, amount: number) {
    if (c.falling || !c.alive) return;
    c.hp -= amount;
    this.game.fx.sparks(c.pos);
    if (c.hp > 0) return;
    const g = this.game;
    c.falling = true;
    c.vel.copy(c.fwd).multiplyScalar(c.kind === 'jet' ? c.speed * 0.7 : 6);
    g.fx.explosion(c.pos.clone(), g.world.groundHeight(c.pos.x, c.pos.z), 1.2);
    g.audio.play('boom', c.pos, 1, 0.8);
    g.hud.popText(c.pos.clone().setY(c.pos.y + 4), '撃墜!!', '#ffd166', 40);
    g.karma.crime('kill', c.pos, 'soldier', 1, 'missile');
    g.thrills.event('air', 1);
  }

  /** 弾が当たったか */
  onShot(handle: number, dmg: number) {
    const c = this.crafts.find((o) => o.collider.handle === handle);
    if (!c) return false;
    this.damage(c, dmg * 0.6);
    return true;
  }

  onExplosion(pos: THREE.Vector3, R: number, scale: number, byPlayer: boolean) {
    if (!byPlayer) return;
    for (const c of this.crafts) if (c.alive && pos.distanceTo(c.pos) < R + c.hitR) this.damage(c, 240 * scale);
  }

  /** 核の衝撃波 */
  sweep(pos: THREE.Vector3, r: number) {
    for (const c of this.crafts) if (c.alive && pos.distanceTo(c.pos) < r) this.damage(c, 99999);
  }

  /** ミサイルの狙いにできる機体 */
  targets() {
    return this.crafts.filter((c) => c.alive && !c.falling);
  }

  private remove(i: number) {
    const c = this.crafts[i];
    this.game.scene.remove(c.model.root);
    this.game.physics.world.removeRigidBody(c.body);
    this.crafts.splice(i, 1);
  }
}
