import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G, groups, RAPIER } from '../core/Physics';
import { angleDiff, clamp, damp, rand } from '../core/Rng';
import type { WorldItem } from '../gameplay/Items';
import { WEAPON_KEYS, WEAPON_ORDER } from '../gameplay/Weapons';
import type { Vehicle } from '../vehicles/Vehicle';
import { DogModel } from './DogModel';

const RADIUS = 0.2;
const HALF = 0.1;
const CENTER = RADIUS + HALF;

/** プレイヤーが操作する「うしわか」 */
export class Ushiwaka {
  model = new DogModel();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  grounded = false;
  hp = 100;
  maxHp = 100;
  carrying: WorldItem | null = null;
  /** 運転中の乗り物 */
  driving: Vehicle | null = null;
  dead = false;
  swimming = false;
  visualYOffset = 0;
  private body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private cc: RAPIER.KinematicCharacterController;
  private biteCd = 0;
  private barkCd = 0;
  private biteT = 9;
  private barkT = 9;
  private barkBig = false;
  private charge = 0;
  private coyote = 0;
  private hurtCd = 0;
  private sinceHurt = 99;
  private stepT = 0;
  private wasSwimming = false;
  /** 防具（もふもふベスト）。体力より先に減る */
  armor = 0;
  maxArmor = 100;
  private jumps = 0;
  dashT = 0;
  private dashCd = 0;
  private dashDir = new THREE.Vector3();
  shieldT = 0;
  shieldCd = 0;
  spinCd = 0;
  private spinT = 9;
  /** 死んだふり（ぬいぐるみのふり）中 */
  playDead = false;
  gliding = false;
  private flipT = 9;
  private shieldMesh: THREE.Mesh;

  constructor(private game: Game) {
    const w = game.physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 5, 0));
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(groups(G.PLAYER, G.STATIC | G.NPC | G.ITEM | G.VEHICLE | G.DEBRIS)),
      this.body,
    );
    this.cc = w.createCharacterController(0.02);
    this.cc.enableAutostep(0.32, 0.1, false);
    this.cc.enableSnapToGround(0.3);
    this.cc.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    game.scene.add(this.model.root);
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 24, 16),
      new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.shieldMesh.visible = false;
    game.scene.add(this.shieldMesh);
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** 口の位置（ワールド座標） */
  mouthWorld(out = new THREE.Vector3()) {
    return out.set(this.pos.x + Math.sin(this.yaw) * 0.42, this.pos.y + 0.38, this.pos.z + Math.cos(this.yaw) * 0.42);
  }

  headWorld(out = new THREE.Vector3()) {
    return out.set(this.pos.x + Math.sin(this.yaw) * 0.25, this.pos.y + 0.75, this.pos.z + Math.cos(this.yaw) * 0.25);
  }

  teleport(p: THREE.Vector3, yaw: number) {
    this.pos.copy(p);
    this.body.setTranslation({ x: p.x, y: p.y + CENTER, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + CENTER, z: p.z });
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.syncModel(0);
  }

  update(dt: number) {
    const g = this.game;
    const inp = g.input;
    const canAct = inp.active && !g.dialogue.active && !this.dead && !g.paused && !g.capture.active;
    this.biteCd -= dt;
    this.barkCd -= dt;
    this.biteT += dt;
    this.barkT += dt;
    this.hurtCd -= dt;
    this.sinceHurt += dt;
    this.dashT -= dt;
    this.dashCd -= dt;
    this.shieldT -= dt;
    this.shieldCd -= dt;
    this.spinCd -= dt;
    this.spinT += dt;
    this.flipT += dt;
    if (this.sinceHurt > 4 && !this.dead) this.hp = Math.min(this.maxHp, this.hp + dt * 8);
    this.shieldMesh.visible = this.shieldT > 0 && !this.driving;
    if (this.shieldMesh.visible) {
      this.shieldMesh.position.set(this.pos.x, this.pos.y + 0.35, this.pos.z);
      this.shieldMesh.scale.setScalar(1 + Math.sin(this.spinT * 10) * 0.03);
    }

    // ---------- 運転中 ----------
    if (this.driving) {
      const v = this.driving;
      if (canAct && inp.pressed('KeyF')) {
        // 降りたフレームですぐ乗り直さないよう、ここで終わる
        this.exitVehicle();
        return;
      }
      v.drive(dt, v.playerInput());
      if (canAct && inp.mousePressed(2)) {
        g.audio.play('horn', v.pos, 0.9);
        this.bark(false);
      }
      g.audio.engineSet(Math.abs(v.speed) / v.spec.maxSpeed);
      v.sync(dt);
      const seat = v.seatWorld();
      this.pos.copy(seat);
      this.yaw = v.yaw;
      this.vel.set(0, 0, 0);
      this.body.setNextKinematicTranslation({ x: seat.x, y: seat.y + CENTER, z: seat.z });
      this.syncModel(dt, Math.abs(v.speed) * (v.kind === 'bicycle' ? 0.35 : 0));
      return;
    }
    if (canAct && inp.pressed('KeyF')) {
      const v = g.traffic.nearest(this.pos, 1.6);
      if (v) {
        this.enterVehicle(v);
        return;
      }
    }

    // ---------- 移動入力 ----------
    let ix = 0;
    let iz = 0;
    if (canAct) {
      if (inp.down('KeyW') || inp.down('ArrowUp')) iz += 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) iz -= 1;
      if (inp.down('KeyA')) ix -= 1;
      if (inp.down('KeyD')) ix += 1;
      // 死んだふり（動くか Z でやめる）
      if (inp.pressed('KeyZ')) this.setPlayDead(!this.playDead);
      if (this.playDead && (ix || iz || inp.pressed('Space'))) this.setPlayDead(false);
      if (this.playDead) {
        ix = 0;
        iz = 0;
      }
    }
    const cy = g.camRig.yaw;
    const fx = -Math.sin(cy);
    const fz = -Math.cos(cy);
    const rx = Math.cos(cy);
    const rz = -Math.sin(cy);
    let dx = fx * iz + rx * ix;
    let dz = fz * iz + rz * ix;
    const dl = Math.hypot(dx, dz);
    if (dl > 1) {
      dx /= dl;
      dz /= dl;
    }
    const water = g.world.waterAt(this.pos.x, this.pos.z);
    this.swimming = !!water && this.pos.y < water.y + 0.25;
    const running = canAct && (inp.down('ShiftLeft') || inp.down('ShiftRight'));
    const maxSpeed = this.swimming ? 2.8 : running ? 11.5 : 4.6;
    const k = damp(this.grounded || this.swimming ? 14 : 5, dt);
    this.vel.x += (dx * maxSpeed - this.vel.x) * k;
    this.vel.z += (dz * maxSpeed - this.vel.z) * k;

    // ---------- ダッシュ（C / Ctrl） ----------
    if (canAct && (inp.pressed('KeyC') || inp.pressed('ControlLeft')) && this.dashCd <= 0 && !this.playDead) {
      this.dashT = 0.22;
      this.dashCd = 0.65;
      if (dl > 0.1) this.dashDir.set(dx, 0, dz).normalize();
      else this.dashDir.copy(this.forward);
      this.yaw = Math.atan2(this.dashDir.x, this.dashDir.z);
      g.audio.play('whoosh', this.pos, 0.8, 1.3);
      for (let i = 0; i < 4; i++) g.fx.smoke(this.pos.clone().setY(this.pos.y + 0.2), false);
    }
    if (this.dashT > 0) {
      this.vel.x = this.dashDir.x * 23;
      this.vel.z = this.dashDir.z * 23;
      this.vel.y = Math.max(this.vel.y, 0);
    }

    // ---------- ジャンプ（二段・壁ジャンプ・滑空）と重力 ----------
    if (this.grounded) this.jumps = 0;
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (canAct && inp.pressed('Space') && !this.playDead) {
      const wall = this.coyote > 0 ? null : this.wallNormal();
      if (this.coyote > 0) {
        this.vel.y = 7.8;
        this.jumps = 1;
        g.audio.play(this.swimming ? 'splash' : 'jump', this.pos, 0.6);
        if (this.swimming) g.fx.splash(this.pos);
      } else if (wall) {
        this.vel.set(wall.x * 8, 8.6, wall.z * 8);
        this.jumps = 1;
        this.yaw = Math.atan2(wall.x, wall.z);
        g.audio.play('jump', this.pos, 0.7, 1.3);
        g.fx.smoke(this.pos.clone().sub(wall.clone().multiplyScalar(0.25)).setY(this.pos.y + 0.3), false);
      } else if (this.jumps < 2) {
        this.vel.y = 7.6;
        this.jumps = 2;
        this.flipT = 0;
        g.audio.play('jump', this.pos, 0.6, 1.5);
        g.fx.smoke(this.pos.clone().setY(this.pos.y + 0.1), false);
      }
      this.coyote = 0;
      this.grounded = false;
    }
    this.gliding = canAct && !this.grounded && this.vel.y < 0 && this.jumps >= 1 && inp.down('Space') && !this.swimming;
    this.vel.y = Math.max(this.vel.y - 26 * dt, this.gliding ? -2.2 : -30);

    // ---------- 衝突つき移動 ----------
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.cc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.PLAYER, G.STATIC | G.NPC | G.VEHICLE));
    const mv = this.cc.computedMovement();
    this.grounded = this.cc.computedGrounded();
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    if (desired.y > 0 && mv.y < desired.y * 0.3) this.vel.y = Math.min(this.vel.y, 0);
    const t = this.body.translation();
    const nx = t.x + mv.x;
    const ny = t.y + mv.y;
    const nz = t.z + mv.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.pos.set(nx, ny - CENTER, nz);
    if (this.pos.y < -15) this.game.respawnAtHome(false);

    // 向き
    const hs = Math.hypot(mv.x, mv.z) / Math.max(dt, 1e-4);
    if (dl > 0.1 && !this.dead) {
      const targetYaw = Math.atan2(dx, dz);
      this.yaw += angleDiff(this.yaw, targetYaw) * damp(13, dt);
    }

    // 水しぶき・足音
    if (this.swimming && !this.wasSwimming) {
      g.fx.splash(this.pos);
      g.audio.play('splash', this.pos, 0.7);
    }
    this.wasSwimming = this.swimming;
    if (this.swimming && hs > 0.5) {
      this.stepT -= dt;
      if (this.stepT < 0) {
        this.stepT = 0.25;
        g.fx.ripple(this.pos);
      }
    }

    // ---------- アクション ----------
    if (canAct) {
      const w = g.weapons;
      if (inp.mousePressed(0)) {
        if (w.current === 'bite' || this.carrying) this.bite();
        else w.attackPressed();
      }
      if (inp.mouseDown(0) && (w.current === 'chainsaw' || w.current === 'smg') && !this.carrying) w.attackHeld(dt);
      for (let i = 0; i < WEAPON_ORDER.length; i++) if (inp.pressed(WEAPON_KEYS[i])) w.select(WEAPON_ORDER[i]);
      if (inp.pressed('KeyR')) w.cycle();
      if (inp.pressed('KeyG')) w.detonate();
      if (inp.pressed('KeyV')) this.spinAttack();
      if (inp.pressed('KeyX') && this.shieldCd <= 0) {
        this.shieldT = 4;
        this.shieldCd = 10;
        g.audio.play('mega', this.pos, 0.6, 0.6);
        g.hud.popText(this.headWorld(), 'もふもふシールド!', '#9fd8ff', 22);
      }
      if (inp.mouseDown(2)) this.charge = Math.min(1.2, this.charge + dt);
      if (inp.mouseReleased(2)) {
        this.bark(this.charge > 0.75);
        this.charge = 0;
      }
      if (inp.pressed('KeyE')) this.interact();
      if (inp.pressed('KeyQ') && this.carrying) this.drop(true);
    } else this.charge = 0;

    this.syncModel(dt, hs);
  }

  enterVehicle(v: Vehicle) {
    const g = this.game;
    this.driving = v;
    g.traffic.board(v);
    g.audio.play('jump', this.pos, 0.6);
    g.hud.popText(this.headWorld(), v.kind === 'scooter' ? 'ブンブン!' : 'ブロロン!', '#ffffff', 24);
  }

  /** 降りる。速く走っているときは飛び降りて転がる */
  exitVehicle() {
    const v = this.driving;
    if (!v) return;
    const g = this.game;
    this.driving = null;
    g.traffic.unboard(v);
    // 右ハンドルなので右側（バイクは左右どちらでも）へ降りる
    const side = v.spec.halfW + 0.55;
    const rx = -Math.cos(v.yaw);
    const rz = Math.sin(v.yaw);
    let p = new THREE.Vector3(v.pos.x + rx * side, v.pos.y + 0.35, v.pos.z + rz * side);
    const blocked = g.physics.raycast(new THREE.Vector3(v.pos.x, v.pos.y + 0.6, v.pos.z), new THREE.Vector3(rx, 0, rz), side + 0.3, G.STATIC);
    if (blocked) p = new THREE.Vector3(v.pos.x - rx * side, v.pos.y + 0.35, v.pos.z - rz * side);
    this.teleport(p, v.yaw);
    const sp = Math.abs(v.speed);
    if (sp > 6) {
      // 飛び降り
      const f = v.forward.clone().multiplyScalar(v.speed * 0.55);
      this.vel.set(f.x + rx * 3, 3.5, f.z + rz * 3);
      this.hurtCd = 0;
      this.hurt(Math.min(30, sp * 1.1), p.clone().sub(new THREE.Vector3(rx, 0, rz)));
      g.hud.popText(this.headWorld(), 'ゴロゴロ…', '#ffffff', 26);
    }
  }

  /** バイクで激突したときなど、乗り物から投げ出される */
  bailOut(force: boolean) {
    if (!this.driving) return;
    const v = this.driving;
    if (force) v.speed = Math.max(v.speed, 7);
    this.exitVehicle();
  }

  private syncModel(dt: number, hs = 0) {
    this.visualYOffset = this.swimming ? -0.2 : 0;
    const r = this.model.root;
    r.position.set(this.pos.x, this.pos.y + this.visualYOffset, this.pos.z);
    r.rotation.y = this.yaw;
    this.model.update(dt, {
      speed: this.dead ? 0 : hs,
      grounded: this.grounded,
      vy: this.vel.y,
      biteT: this.biteT,
      barkT: this.barkT,
      barkBig: this.barkBig,
      charge: this.charge,
      swim: this.swimming,
      happy: this.game.karma.mode === 'devil' ? 1 : this.game.karma.happiness / 100,
      carrying: !!this.carrying,
      down: this.dead || this.playDead,
      sit: !!this.driving,
      glide: this.gliding,
    });
    // 二段ジャンプの宙返り・回転アタック
    if (this.flipT < 0.45) r.rotation.x = -(this.flipT / 0.45) * Math.PI * 2;
    else if (!this.dead && !this.playDead) r.rotation.x = 0;
    if (this.spinT < 0.4) r.rotation.y = this.yaw + (this.spinT / 0.4) * Math.PI * 4;
  }

  // ---------- 噛みつき ----------
  bite() {
    if (this.biteCd > 0) return;
    const g = this.game;
    this.biteCd = 0.4;
    this.biteT = 0;
    const npc = g.npcs.findBiteTarget(this.pos, this.yaw, 1.3);
    if (npc) {
      this.yaw = Math.atan2(npc.pos.x - this.pos.x, npc.pos.z - this.pos.z);
      g.npcs.playerBites(npc);
      return;
    }
    if (!this.carrying) {
      const it = g.items.findNear(this.mouthWorld(), this.pos.y, 0.85);
      if (it) {
        this.pickUp(it);
        return;
      }
    }
    // 物（ドレインライトや街灯など）に噛みつく
    if (g.story.biteAt(this.mouthWorld(), 30) || g.destruction.hitNear(this.mouthWorld(), 0.9, 30, true)) return;
    g.audio.play('chomp', this.pos, 0.5);
  }

  /** 空中で、すぐそばにある壁の向き（壁ジャンプ用） */
  private wallNormal(): THREE.Vector3 | null {
    const g = this.game;
    const o = new THREE.Vector3(this.pos.x, this.pos.y + 0.3, this.pos.z);
    let best: THREE.Vector3 | null = null;
    let bd = 0.62;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const hit = g.physics.raycast(o, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), 0.62, G.STATIC | G.VEHICLE);
      if (hit && hit.dist < bd && Math.abs(hit.normal.y) < 0.4) {
        bd = hit.dist;
        best = hit.normal.clone().setY(0).normalize();
      }
    }
    return best;
  }

  /** 回転アタック（まわりの人をはじき飛ばす） */
  spinAttack() {
    const g = this.game;
    if (this.spinCd > 0 || this.playDead) return;
    this.spinCd = 1.1;
    this.spinT = 0;
    g.audio.play('whoosh', this.pos, 1, 0.8);
    g.fx.shockwave(this.pos.clone().setY(this.pos.y + 0.3), 3, false);
    for (const n of g.npcs.list) {
      if (!n.alive) continue;
      const d = Math.hypot(n.pos.x - this.pos.x, n.pos.z - this.pos.z);
      if (d > 2.6) continue;
      const dir = n.pos.clone().sub(this.pos).setY(0).normalize();
      if (n.hp <= 45) {
        n.fling(dir.multiplyScalar(11).add(new THREE.Vector3(0, 6, 0)));
        g.karma.crime('kill', n.pos, n.kind, 1, 'bite');
      } else {
        n.bitten(45, this.pos);
        g.karma.crime('bite', n.pos, n.kind);
      }
    }
    for (const v of g.traffic.list) if (!v.wrecked && v !== this.driving && v.contains(this.pos, 1.2)) v.hp -= 25;
  }

  setPlayDead(on: boolean) {
    if (this.playDead === on || this.driving) return;
    this.playDead = on;
    if (on) {
      if (this.carrying) this.drop(false);
      this.game.hud.popText(this.headWorld(), '（ただのぬいぐるみです）', '#ffffff', 18);
    }
  }

  /** 武器を振る動き（噛みつきと同じ頭の動き） */
  swing() {
    this.biteT = 0;
  }

  // ---------- 吠える ----------
  bark(big: boolean, mega = false) {
    if (this.barkCd > 0 && !mega) return;
    const g = this.game;
    mega = mega || (g.weapons.current === 'megaphone' && g.weapons.ammo.megaphone > 0);
    this.barkCd = big ? 1.4 : 0.45;
    this.barkT = 0;
    this.barkBig = big;
    const radius = (big ? 15 : 7.5) * (mega ? 2.2 : 1);
    if (mega) g.audio.play('mega', this.pos, 1);
    g.audio.play(big ? 'bigbark' : 'bark', this.pos, big ? 1 : 0.85, rand.range(0.95, 1.08));
    const head = this.headWorld();
    g.fx.shockwave(head, radius, big);
    g.hud.popText(head.clone().add(new THREE.Vector3(0, 0.4, 0)), big ? 'ワオオオォン!!' : rand.pick(['ワン!', 'ワンッ!', 'キャン!']), big ? '#ff3b6b' : '#ffffff', big ? 40 : 28);
    if (big) g.camRig.addShake(0.8);
    if (this.carrying && big) this.drop(false);
    g.npcs.onBark(this.pos, radius, big, mega);
    g.nanku.onBark(this.pos, big);
  }

  // ---------- くわえる・はなす ----------
  interact() {
    const g = this.game;
    if (g.nanku.canTalk(this.pos)) {
      g.nanku.talk();
      return;
    }
    if (this.carrying) {
      this.drop(false);
      return;
    }
    const it = g.items.findNear(this.mouthWorld(), this.pos.y, 0.95);
    if (it) this.pickUp(it);
  }

  pickUp(it: WorldItem) {
    const g = this.game;
    const theft = g.items.pickUp(it);
    this.carrying = it;
    this.model.mouth.add(it.obj);
    it.obj.position.set(0, 0, 0);
    it.obj.rotation.set(0, Math.PI / 2, 0);
    g.audio.play('pickup', this.pos, 0.6);
    if (theft) g.karma.crime(theft === 'shrine' ? 'shrine' : 'steal', this.pos, it.def.name);
  }

  drop(throwIt: boolean) {
    const it = this.carrying;
    if (!it) return;
    this.carrying = null;
    const g = this.game;
    const p = this.mouthWorld();
    const f = this.forward;
    const v = throwIt ? f.multiplyScalar(7.5).add(new THREE.Vector3(0, 3.5, 0)).add(this.vel.clone().setY(0)) : f.multiplyScalar(0.6);
    g.items.drop(it, p, v);
    g.audio.play('drop', this.pos, 0.5);
    if (it.def.id === 'bomb' && it.fuse === null) {
      it.fuse = throwIt ? 2.2 : 3.5;
      g.audio.play('fuse', this.pos, 0.8);
      g.hud.popText(this.headWorld(), 'ジジジ…', '#ffb703', 22);
    }
  }

  /** 渡し終えた等で、くわえている物を消す */
  consumeCarried() {
    const it = this.carrying;
    if (!it) return null;
    this.carrying = null;
    this.game.items.remove(it);
    return it;
  }

  hurt(dmg: number, from: THREE.Vector3) {
    if (this.dead || this.hurtCd > 0 || this.driving) return;
    const g = this.game;
    this.hurtCd = 0.35;
    this.sinceHurt = 0;
    if (this.shieldT > 0) dmg *= 0.15;
    if (this.armor > 0) {
      const a = Math.min(this.armor, dmg * 0.75);
      this.armor -= a;
      dmg -= a;
    }
    this.hp -= dmg;
    const dir = this.pos.clone().sub(from).setY(0).normalize();
    this.vel.addScaledVector(dir, 6);
    this.vel.y = 4;
    g.audio.play('yelp', this.pos, 0.9);
    g.hud.flashDamage();
    g.camRig.addShake(0.4);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      if (this.carrying) this.drop(false);
      g.onPlayerDown();
    }
  }

  revive() {
    this.dead = false;
    this.hp = this.maxHp;
    this.sinceHurt = 99;
  }

  get hint(): string {
    const g = this.game;
    if (this.dead) return '';
    if (this.driving?.kind === 'jet') return `W/S 加速・減速　マウス 操縦　左クリック 機関砲　右クリック 少核弾頭　Space フレア　F 飛び降りる`;
    if (this.driving?.kind === 'heli') return `マウス 向き　W/S 前後　A/D 横　Space 上昇　Shift 下降　左クリック 機関砲　右クリック ミサイル　X フレア　F 降りる`;
    if (this.driving?.kind === 'balloon') return `W 上昇　S 下降　Space 前進　A/D 向き　F 降りる`;
    if (this.driving?.kind === 'tank') return `F: 降りる　W/S: 前進・後退　A/D: その場で旋回　マウス: 砲塔を向ける　左クリック: 主砲`;
    if (this.driving) return `F: 降りる（走行中は飛び降り）　W/S: アクセル・ブレーキ　A/D: ハンドル　Space: サイドブレーキ（ドリフト）　右クリック: クラクション`;
    const veh = g.traffic.nearest(this.pos, 1.6);
    if (veh) return `F: ${veh.spec.name}に乗る${veh.driver === 'npc' ? '（運転手を追い出す）' : ''}`;
    if (g.nanku.canTalk(this.pos)) return this.carrying ? `E: なんくに「${this.carrying.def.name}」をわたす` : 'E: なんくと話す';
    if (this.carrying) return this.carrying.def.id === 'bomb' ? 'Q: 爆弾を投げる（火がつく！）　E: 置く（3.5秒で爆発）' : `E: はなす　Q: なげる（${this.carrying.def.name}）`;
    const it = g.items.findNear(this.mouthWorld(), this.pos.y, 0.95);
    if (it) return `E / 左クリック: ${it.def.name}をくわえる${it.owner === 'shop' ? '（盗み）' : it.owner === 'shrine' ? '（お供え物）' : ''}`;
    return '';
  }

  get chargeLevel() {
    return clamp(this.charge / 0.75, 0, 1);
  }
}
