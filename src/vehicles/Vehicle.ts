import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G, groups, quatY, RAPIER } from '../core/Physics';
import { clamp, damp } from '../core/Rng';
import { SPECS, VehicleModel, type VehicleKind, type VehicleSpec } from './VehicleModel';

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

const _v = new THREE.Vector3();

/** 車・スクーター。AI（交通）でもプレイヤー（うしわか）でも運転できる */
export class Vehicle {
  model: VehicleModel;
  spec: VehicleSpec;
  pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  steer = 0;
  vy = 0;
  driver: 'none' | 'npc' | 'player' = 'none';
  ai: AIState | null = null;
  /** 駐車スポット由来（遠くに行っても消さない） */
  persistent = false;
  /** よそ見運転（うしわかに気づかない） */
  distracted = Math.random() < 0.3;
  brakeT = 0;
  honkCd = 0;
  dead = false;
  private body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private cc: RAPIER.KinematicCharacterController;
  private lean = 0;
  /** 爆発で壊れた */
  wrecked = false;
  private wreckV: THREE.Vector3 | null = null;
  private spinX = 0;
  private spinZ = 0;

  constructor(
    private game: Game,
    public kind: VehicleKind,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ) {
    this.spec = SPECS[kind];
    this.model = new VehicleModel(kind);
    this.pos.set(x, y, z);
    this.yaw = yaw;
    const w = game.physics.world;
    const s = this.spec;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(x, y + s.height / 2 + 0.05, z)
        .setRotation(quatY(yaw)),
    );
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.cuboid(s.halfW, s.height / 2 - 0.05, s.halfL).setCollisionGroups(groups(G.VEHICLE, G.STATIC | G.PLAYER | G.NPC | G.VEHICLE | G.ITEM)),
      this.body,
    );
    this.cc = w.createCharacterController(0.03);
    this.cc.enableAutostep(0.25, 0.3, false);
    this.cc.enableSnapToGround(0.4);
    this.cc.setMaxSlopeClimbAngle((40 * Math.PI) / 180);
    game.scene.add(this.model.root);
    this.sync(0);
  }

  get forward() {
    return _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
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

  /** プレイヤーの運転 */
  drive(dt: number) {
    const g = this.game;
    const inp = g.input;
    const can = inp.active && !g.dialogue.active && !g.paused;
    const thr = can ? (inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0) - (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0) : 0;
    const st = can ? (inp.down('KeyA') ? 1 : 0) - (inp.down('KeyD') ? 1 : 0) : 0;
    const s = this.spec;
    if (thr > 0) this.speed += (this.speed < 0 ? 14 : s.accel * (1 - Math.max(0, this.speed) / s.maxSpeed)) * dt;
    else if (thr < 0) this.speed -= (this.speed > 0.5 ? 16 : s.accel * 0.6) * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), (1.5 + Math.abs(this.speed) * 0.12) * dt);
    if (can && inp.down('Space')) this.speed *= 1 - Math.min(1, 2.6 * dt);
    this.speed = clamp(this.speed, -7, s.maxSpeed);
    const maxSteer = 0.6 / (1 + Math.abs(this.speed) * 0.05);
    this.steer += (st * maxSteer - this.steer) * damp(8, dt);
    this.move(dt);
    const target = s.bike ? -this.steer * clamp(Math.abs(this.speed) / 10, 0, 1) * 0.9 : 0;
    this.lean += (target - this.lean) * damp(6, dt);
  }

  private move(dt: number) {
    const s = this.spec;
    const wb = s.halfL * 1.25;
    this.yaw += (this.speed / wb) * Math.tan(this.steer) * dt * (s.turn / 2.6);
    this.vy = Math.max(this.vy - 25 * dt, -30);
    const dx = Math.sin(this.yaw) * this.speed * dt;
    const dz = Math.cos(this.yaw) * this.speed * dt;
    this.body.setRotation(quatY(this.yaw), true);
    this.cc.computeColliderMovement(this.collider, { x: dx, y: this.vy * dt, z: dz }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.VEHICLE, G.STATIC | G.VEHICLE));
    const mv = this.cc.computedMovement();
    if (this.cc.computedGrounded() && this.vy < 0) this.vy = 0;
    const want = Math.hypot(dx, dz);
    const got = Math.hypot(mv.x, mv.z);
    if (want > 0.02 && got < want * 0.45) {
      const g = this.game;
      if (Math.abs(this.speed) > 7) {
        g.audio.play('crash', this.pos, Math.min(1, Math.abs(this.speed) / 18));
        g.camRig.addShake(Math.min(1, Math.abs(this.speed) / 15));
        g.fx.sparks(this.pos.clone().add(this.forward.clone().multiplyScalar(this.spec.halfL)));
      }
      this.speed *= Math.abs(this.speed) > 7 ? -0.2 : 0.4;
    }
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    this.pos.set(t.x + mv.x, t.y + mv.y - (s.height / 2 + 0.05), t.z + mv.z);
  }

  /** AI の位置を直接セット（車線に沿って動く） */
  place(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.body.setNextKinematicTranslation({ x, y: y + this.spec.height / 2 + 0.05, z });
    this.body.setRotation(quatY(yaw), true);
  }

  sync(dt: number) {
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    this.model.animate(this.speed, this.steer, dt, this.lean);
  }

  /** 爆風で吹っ飛ぶ（以後は動かない残骸） */
  blast(vel: THREE.Vector3) {
    this.ai = null;
    this.driver = 'none';
    this.speed = 0;
    this.wreckV = vel.clone();
    this.spinX = (Math.random() - 0.5) * 6;
    this.spinZ = (Math.random() - 0.5) * 6;
    if (!this.wrecked) {
      this.wrecked = true;
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
        const flip = Math.round(this.model.body.rotation.z / Math.PI) * Math.PI;
        this.model.body.rotation.z = flip;
        this.model.body.rotation.x = Math.round(this.model.body.rotation.x / Math.PI) * Math.PI;
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
