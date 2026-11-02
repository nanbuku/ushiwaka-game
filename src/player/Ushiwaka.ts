import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G, groups, RAPIER } from '../core/Physics';
import { angleDiff, clamp, damp, rand } from '../core/Rng';
import type { WorldItem } from '../gameplay/Items';
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
    if (this.sinceHurt > 5 && !this.dead) this.hp = Math.min(this.maxHp, this.hp + dt * 5);

    // ---------- 運転中 ----------
    if (this.driving) {
      const v = this.driving;
      if (canAct && inp.pressed('KeyF') && Math.abs(v.speed) < 8) {
        this.exitVehicle();
      } else {
        v.drive(dt);
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
        this.syncModel(dt, 0);
        return;
      }
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
    const maxSpeed = this.swimming ? 2.4 : running ? 8.6 : 3.8;
    const k = damp(this.grounded || this.swimming ? 14 : 3.5, dt);
    this.vel.x += (dx * maxSpeed - this.vel.x) * k;
    this.vel.z += (dz * maxSpeed - this.vel.z) * k;

    // ---------- ジャンプと重力 ----------
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (canAct && inp.pressed('Space') && this.coyote > 0) {
      this.vel.y = 7.1;
      this.coyote = 0;
      this.grounded = false;
      g.audio.play(this.swimming ? 'splash' : 'jump', this.pos, 0.6);
      if (this.swimming) g.fx.splash(this.pos);
    }
    this.vel.y = Math.max(this.vel.y - 26 * dt, -30);

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
      if (inp.mousePressed(0)) this.bite();
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

  exitVehicle() {
    const v = this.driving;
    if (!v) return;
    const g = this.game;
    this.driving = null;
    g.traffic.unboard(v);
    const side = v.spec.halfW + 0.55;
    const p = new THREE.Vector3(v.pos.x + Math.cos(v.yaw) * side, v.pos.y + 0.3, v.pos.z - Math.sin(v.yaw) * side);
    this.teleport(p, v.yaw);
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
      down: this.dead,
      sit: !!this.driving,
    });
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
    g.audio.play('chomp', this.pos, 0.5);
  }

  // ---------- 吠える ----------
  bark(big: boolean) {
    if (this.barkCd > 0) return;
    const g = this.game;
    this.barkCd = big ? 1.4 : 0.45;
    this.barkT = 0;
    this.barkBig = big;
    const radius = big ? 15 : 7.5;
    g.audio.play(big ? 'bigbark' : 'bark', this.pos, big ? 1 : 0.85, rand.range(0.95, 1.08));
    const head = this.headWorld();
    g.fx.shockwave(head, radius, big);
    g.hud.popText(head.clone().add(new THREE.Vector3(0, 0.4, 0)), big ? 'ワオオオォン!!' : rand.pick(['ワン!', 'ワンッ!', 'キャン!']), big ? '#ff3b6b' : '#ffffff', big ? 40 : 28);
    if (big) g.camRig.addShake(0.8);
    if (this.carrying && big) this.drop(false);
    g.npcs.onBark(this.pos, radius, big);
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
    if (this.driving) return 'F: 降りる　W/S: アクセル・ブレーキ　A/D: ハンドル　Space: サイドブレーキ　右クリック: クラクション';
    const veh = g.traffic.nearest(this.pos, 1.6);
    if (veh) return `F: ${veh.kind === 'scooter' ? 'スクーター' : veh.kind === 'catcherVan' ? '保健所の車' : '車'}に乗る${veh.driver === 'npc' ? '（運転手を追い出す）' : ''}`;
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
