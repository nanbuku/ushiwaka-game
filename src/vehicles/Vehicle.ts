import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G, groups, quatY, RAPIER } from '../core/Physics';
import { clamp, damp, rand } from '../core/Rng';
import { BREAK_SPEED } from '../world/Destruction';
import { VehicleModel, type VehicleKind, type VehicleSpec } from './VehicleModel';

export interface Lane {
  id: number;
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  fx: number;
  fz: number;
  len: number;
  cruise: number;
  startKey: string;
  endKey: string;
  segId: number;
  y: number;
}

export interface Turn {
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  len: number;
  u: number;
  next: Lane;
}

export interface AIState {
  lane: Lane;
  t: number;
  turn: Turn | null;
}

/** 運転の入力（アクセル -1〜1、ハンドル -1〜1、サイドブレーキ） */
export interface DriveInput {
  thr: number;
  st: number;
  hand: boolean;
}

/** 車体の当たり判定を地面からこの高さだけ浮かせる（縁石や段差で止まらないように） */
const CLEAR = 0.32;
const _v = new THREE.Vector3();

/** 車・バイクなど。AI（交通）でもプレイヤー（うしわか）でも運転できる */
export class Vehicle {
  model: VehicleModel;
  spec: VehicleSpec;
  pos = new THREE.Vector3();
  yaw = 0;
  /** 前向きの速度（後退はマイナス） */
  speed = 0;
  /** 横すべりの速度（ドリフト） */
  slip = 0;
  steer = 0;
  yawRate = 0;
  hp = 100;
  driver: 'none' | 'npc' | 'player' = 'none';
  /** 最後にプレイヤーが運転してからの秒数（無人の暴走車の責任判定） */
  playerT = 999;
  ai: AIState | null = null;
  /** 駐車スポット由来（遠くに行っても消さない） */
  persistent = false;
  /** よそ見運転（うしわかに気づかない） */
  distracted = Math.random() < 0.3;
  brakeT = 0;
  honkCd = 0;
  dead = false;
  /** 警察などが外から運転している（交通の処理では動かさない） */
  external = false;
  /** 撒菱でパンクした */
  flat = false;
  burnT = -1;
  private body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private cc: RAPIER.KinematicCharacterController;
  private lean = 0;
  /** 吹っ飛んでいる／ひっくり返った（運転できない） */
  wrecked = false;
  /** 爆発で黒こげ */
  charred = false;
  private wreckV: THREE.Vector3 | null = null;
  private spinX = 0;
  private spinZ = 0;
  private smokeT = 0;

  constructor(
    private game: Game,
    public kind: VehicleKind,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ) {
    this.model = new VehicleModel(kind, Math.random(), game.assets);
    this.spec = this.model.spec;
    this.pos.set(x, y, z);
    this.yaw = yaw;
    const w = game.physics.world;
    const s = this.spec;
    const hh = Math.max(0.2, (s.height - CLEAR) / 2);
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z).setRotation(quatY(yaw)));
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.cuboid(s.halfW, hh, s.halfL)
        .setTranslation(0, CLEAR + hh, 0)
        .setCollisionGroups(groups(G.VEHICLE, G.STATIC | G.PLAYER | G.NPC | G.VEHICLE | G.ITEM)),
      this.body,
    );
    if (kind === 'tank') this.hp = 450;
    this.cc = w.createCharacterController(0.04);
    this.cc.setSlideEnabled(true);
    game.scene.add(this.model.root);
    this.sync(0);
  }

  get forward() {
    return _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** 重さのめやす（ぶつかったときにどちらが飛ぶか） */
  get mass() {
    const s = this.spec;
    return s.halfW * s.halfL * s.height * (this.kind === 'tank' ? 8 : s.bike ? 0.5 : 1);
  }

  get kmh() {
    return Math.round(Math.abs(this.speed) * 3.6);
  }

  /** 点 p が車体の範囲（pad だけ広げた）に入っているか */
  contains(p: THREE.Vector3, pad: number) {
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return Math.abs(lx) < this.spec.halfW + pad && Math.abs(lz) < this.spec.halfL + pad && Math.abs(p.y - this.pos.y) < 2;
  }

  /** プレイヤーの入力を読む */
  playerInput(): DriveInput {
    const g = this.game;
    const inp = g.input;
    if (!(inp.active && !g.dialogue.active && !g.paused)) return { thr: 0, st: 0, hand: false };
    return {
      thr: (inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0) - (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0),
      st: (inp.down('KeyA') ? 1 : 0) - (inp.down('KeyD') ? 1 : 0),
      hand: inp.down('Space'),
    };
  }

  /**
   * 運転（アーケード風の簡易物理）。ctl が null なら無人で惰性走行。
   * 曲がっても速度はほとんど落ちず、速いほどハンドルが効きにくい（タイヤのグリップで制限）。
   */
  drive(dt: number, ctl: DriveInput | null) {
    const s = this.spec;
    const thr = ctl?.thr ?? 0;
    const st = ctl?.st ?? 0;
    const hand = ctl?.hand ?? false;
    const sp = this.speed;
    const maxSpeed = s.maxSpeed * (this.flat ? 0.45 : 1) * (this.hp < 25 ? 0.7 : 1);
    if (thr > 0) {
      if (sp < -0.3) this.speed += s.brake * dt;
      else this.speed += s.accel * Math.max(0, 1 - (Math.max(0, sp) / maxSpeed) ** 2) * dt;
    } else if (thr < 0) {
      if (sp > 0.3) this.speed -= s.brake * dt;
      else this.speed = Math.max(-s.reverseMax, this.speed - s.accel * 0.55 * dt);
    } else {
      const drag = 0.9 + 0.0045 * sp * sp + (ctl ? 0 : 0.6);
      this.speed -= Math.sign(sp) * Math.min(Math.abs(sp), drag * dt);
    }
    if (hand) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 5 * dt);

    // ハンドル（速いほど切れ角が小さい）
    const v01 = clamp(Math.abs(this.speed) / s.maxSpeed, 0, 1);
    const steerMax = s.steerMax * (1 - v01 * 0.62);
    this.steer += (st * steerMax - this.steer) * damp(st !== 0 ? 7 : 10, dt);
    const wb = s.halfL * 1.35;
    let yawRate = (this.speed / wb) * Math.tan(this.steer);
    // グリップの限界（横方向の加速度 = 速度 × 角速度）
    const grip = s.grip * (hand ? 1.7 : 1) * (this.flat ? 0.6 : 1);
    const maxYaw = grip / Math.max(2.5, Math.abs(this.speed));
    yawRate = clamp(yawRate, -maxYaw, maxYaw);
    // 戦車はその場で旋回できる（キャタピラ）
    if (this.kind === 'tank') {
      yawRate = this.steer * 1.05;
      this.slip = 0;
    }
    if (this.flat) yawRate += Math.sin(performance.now() * 0.004) * 0.25 * v01;
    this.yawRate = yawRate;
    this.yaw += yawRate * dt;
    // ドリフト（サイドブレーキで横にすべる）
    this.slip += (-yawRate * this.speed * (hand ? 0.22 : 0.04)) * dt;
    this.slip *= Math.exp(-(hand ? 1.2 : 6) * dt);
    if (hand && Math.abs(this.slip) > 2.5 && Math.abs(this.speed) > 8 && Math.random() < dt * 20) this.game.fx.skid(this.pos);

    this.moveBy(dt);
    const leanT = s.bike ? clamp(-yawRate * Math.abs(this.speed) * 0.06, -0.6, 0.6) : clamp(-yawRate * this.speed * 0.006, -0.05, 0.05);
    this.lean += (leanT - this.lean) * damp(6, dt);
    if (this.driver === 'player') this.playerT = 0;
    else this.playerT += dt;
    this.damageEffects(dt);
  }

  private moveBy(dt: number) {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -fz;
    const rz = fx;
    const dx = (fx * this.speed + rx * this.slip) * dt;
    const dz = (fz * this.speed + rz * this.slip) * dt;
    this.cc.computeColliderMovement(this.collider, { x: dx, y: 0, z: dz }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.VEHICLE, G.STATIC | G.VEHICLE));
    const mv = this.cc.computedMovement();
    // ぶつかった物を壊す・はね飛ばす（突き抜けたら勢いが少し残る）
    let keep = -1;
    if (Math.abs(this.speed) > (this.kind === 'tank' ? 0.5 : 4)) {
      const n = this.cc.numComputedCollisions();
      for (let i = 0; i < n; i++) {
        const c = this.cc.computedCollision(i)?.collider;
        if (c) keep = Math.max(keep, this.hitThing(c, Math.abs(this.speed)));
      }
    }
    // ぶつかった分だけ速度を失う（壁に沿ってすべる成分は残る）
    const along = (mv.x * fx + mv.z * fz) / Math.max(dt, 1e-4);
    const lost = Math.abs(this.speed) - Math.abs(along);
    if (keep >= 0) this.speed *= keep;
    else if (Math.hypot(dx, dz) > 1e-3 && lost > 0.8) {
      if (lost > 6) this.crash(lost);
      this.speed = Math.sign(this.speed) * Math.max(0, Math.abs(along)) * (lost > 6 ? 0.6 : 1);
      this.slip *= 0.5;
    }
    const nx = this.pos.x + mv.x;
    const nz = this.pos.z + mv.z;
    const gy = this.game.world.groundHeight(nx, nz);
    this.pos.set(nx, this.pos.y + (gy - this.pos.y) * damp(14, dt), nz);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.body.setNextKinematicRotation(quatY(this.yaw));
  }

  /** ぶつかった相手を壊す／はね飛ばす。突き抜けたときは残る速さの割合、止められたら -1 */
  private hitThing(c: RAPIER.Collider, sp: number): number {
    const g = this.game;
    const tank = this.kind === 'tank';
    const byP = this.driver === 'player' || this.playerT < 10;
    const o = g.destruction.byCollider(c.handle);
    if (o) {
      if (sp < (tank ? 1.5 : BREAK_SPEED[o.kind])) {
        if (sp > 8) g.destruction.damage(o, sp * 3, this.pos, true, byP);
        return -1;
      }
      g.destruction.destroy(o, this.pos.clone().sub(this.forward.multiplyScalar(4 * Math.sign(this.speed || 1))), true, byP);
      const big = o.kind === 'house' || o.kind === 'building' || o.kind === 'tower';
      if (!tank) this.hp -= big ? 28 : 3;
      if (this.driver === 'player') g.camRig.addShake(big ? 1.1 : 0.25);
      return tank ? 0.92 : big ? 0.45 : 0.85;
    }
    for (const ov of g.traffic.list) {
      if (ov === this || ov.collider.handle !== c.handle || ov.wrecked) continue;
      let k = sp * Math.min(2.5, this.mass / ov.mass);
      if (tank) k = Math.max(k, 11);
      if (k < 10) return -1;
      const dir = ov.pos.clone().sub(this.pos).setY(0).normalize().multiplyScalar(0.6).add(this.forward.multiplyScalar(Math.sign(this.speed || 1))).normalize();
      ov.knock(dir.multiplyScalar(k * 0.9).setY(Math.min(15, 3 + k * 0.45)));
      if (!tank) this.hp -= k * 0.6;
      if (this.driver === 'player') g.camRig.addShake(0.6);
      return tank ? 0.95 : clamp(this.mass / (this.mass + ov.mass), 0.3, 0.85);
    }
    return -1;
  }

  /** 強くぶつけられて吹っ飛ぶ（着地して起きていればまた乗れる） */
  knock(vel: THREE.Vector3) {
    const g = this.game;
    if (this.driver === 'player') {
      this.speed = -this.speed * 0.3;
      this.hp -= vel.length() * 1.5;
      return;
    }
    this.hp -= vel.length() * 2;
    this.ai = null;
    this.driver = 'none';
    this.speed = 0;
    this.slip = 0;
    this.wreckV = vel.clone();
    this.spinX = (rand.next() - 0.5) * vel.length() * 0.5;
    this.spinZ = (rand.next() - 0.5) * vel.length() * 0.5;
    this.wrecked = true;
    g.audio.play('crash', this.pos, 1, 0.85);
    g.audio.play('glass', this.pos, 0.7);
    g.fx.sparks(this.pos.clone().setY(this.pos.y + 0.6));
  }

  private crash(lost: number) {
    const g = this.game;
    const k = clamp(lost / 18, 0, 1);
    this.hp -= lost * (this.spec.bike ? 2.2 : this.kind === 'tank' ? 0.15 : 1.6);
    g.audio.play('crash', this.pos, 0.4 + k * 0.6);
    if (this.driver === 'player') g.camRig.addShake(0.3 + k);
    g.fx.sparks(this.pos.clone().add(this.forward.clone().multiplyScalar(this.spec.halfL * Math.sign(this.speed || 1))));
    // バイク・自転車は勢いよくぶつかると投げ出される
    if (this.spec.bike && lost > 9 && this.driver === 'player') g.player.bailOut(true);
  }

  /** 壊れかけ → 煙 → 炎上して爆発 */
  private damageEffects(dt: number) {
    if (this.wrecked) return;
    const g = this.game;
    if (this.hp < 35) {
      this.smokeT -= dt;
      if (this.smokeT < 0) {
        this.smokeT = this.hp < 10 ? 0.05 : 0.15;
        g.fx.smoke(this.pos.clone().add(this.forward.clone().multiplyScalar(this.spec.halfL * 0.7)).setY(this.pos.y + this.spec.height * 0.8), this.hp < 10);
      }
    }
    if (this.hp <= 0 && this.burnT < 0) {
      this.burnT = 4;
      if (this.driver === 'player') g.hud.toast('車が燃えている！ すぐに降りて（F）！', 'bad', 4);
    }
    if (this.burnT >= 0) {
      this.burnT -= dt;
      if (this.burnT < 0) {
        this.burnT = -1;
        this.hp = 100;
        g.explode(this.pos.clone().setY(this.pos.y + 0.6), this.playerT < 15, this.kind === 'tank' ? 1.8 : 1);
        if (this.kind === 'tank') this.blast(new THREE.Vector3(0, 3, 0));
      }
    }
  }

  /** AI の位置を直接セット（車線に沿って動く） */
  place(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.body.setNextKinematicTranslation({ x, y, z });
    this.body.setNextKinematicRotation(quatY(yaw));
  }

  sync(dt: number) {
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    this.model.animate(this.speed, this.steer, dt, this.lean);
  }

  /** 撒菱を踏んだ */
  puncture() {
    if (this.flat) return;
    this.flat = true;
    this.game.audio.play('pop', this.pos, 0.9);
    this.game.fx.sparks(this.pos);
    if (this.ai) {
      this.brakeT = 3;
      this.speed *= 0.4;
    }
  }

  /** 爆風で吹っ飛ぶ（以後は動かない残骸） */
  blast(vel: THREE.Vector3) {
    this.ai = null;
    this.driver = 'none';
    this.speed = 0;
    this.slip = 0;
    this.burnT = -1;
    this.wreckV = vel.clone();
    this.spinX = (rand.next() - 0.5) * 6;
    this.spinZ = (rand.next() - 0.5) * 6;
    this.wrecked = true;
    if (!this.charred) {
      this.charred = true;
      this.model.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.material as THREE.MeshStandardMaterial).color) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(0.25);
          if ('emissiveIntensity' in mat) mat.emissiveIntensity = 0;
          m.material = mat;
        }
      });
    }
  }

  /** 吹っ飛び中の動き（Traffic から毎フレーム呼ぶ） */
  updateWreck(dt: number) {
    if (this.charred && Math.random() < dt * 6) this.game.fx.smoke(this.pos.clone().setY(this.pos.y + 1), true);
    if (!this.charred) this.damageEffects(dt);
    if (!this.wreckV) return;
    const v = this.wreckV;
    v.y -= 22 * dt;
    const g = this.game;
    const gy = g.world.groundHeight(this.pos.x, this.pos.z);
    let ny = this.pos.y + v.y * dt;
    this.model.body.rotation.x += this.spinX * dt;
    this.model.body.rotation.z += this.spinZ * dt;
    if (ny <= gy && v.y < 0) {
      ny = gy;
      if (Math.abs(v.y) > 4) {
        v.y *= -0.3;
        v.x *= 0.5;
        v.z *= 0.5;
        g.audio.play('crash', this.pos, 0.7);
      } else {
        this.wreckV = null;
        const b = this.model.body.rotation;
        b.z = Math.round(b.z / Math.PI) * Math.PI;
        b.x = Math.round(b.x / Math.PI) * Math.PI;
        // ひっくり返らずに着地したら、また運転できる
        if (!this.charred && Math.cos(b.x) * Math.cos(b.z) > 0) {
          b.x = 0;
          b.z = 0;
          this.wrecked = false;
        }
      }
    }
    this.place(this.pos.x + v.x * dt, ny, this.pos.z + v.z * dt, this.yaw);
  }

  seatWorld(out = new THREE.Vector3()) {
    this.model.seat.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.model.seat.matrixWorld);
  }

  dispose() {
    this.dead = true;
    this.game.scene.remove(this.model.root);
    this.game.physics.world.removeRigidBody(this.body);
    this.game.physics.world.removeCharacterController(this.cc);
  }
}
