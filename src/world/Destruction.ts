import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G, groups, RAPIER } from '../core/Physics';
import { clamp, rand } from '../core/Rng';
import { Batcher, type DrawHandle } from './Batcher';

export type DestKind = 'house' | 'building' | 'tower' | 'tree' | 'lamp' | 'pole' | 'prop';

export interface Destructible {
  id: number;
  kind: DestKind;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  hp: number;
  color: string;
  handles: DrawHandle[];
  colliders: RAPIER.Collider[];
  alive: boolean;
  /** ストーリーの目標など（'drain' / 'cage' / 'engine'） */
  tag?: string;
}

const HP: Record<DestKind, number> = { house: 260, building: 750, tower: 2600, tree: 35, lamp: 22, pole: 45, prop: 30 };
/** 車でぶつかったときに壊れる速さ（m/s） */
export const BREAK_SPEED: Record<DestKind, number> = { house: 17, building: 26, tower: 999, tree: 9, lamp: 6, pole: 10, prop: 5 };

const CELL = 25;
const MAXD = 160;
const MAXR = 700;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * 壊せる物（家・ビル・木・街灯・電柱・小物）の管理。
 * 壊すと見た目と当たり判定を消し、がれき（物理で飛ぶ箱）と土ぼこりを出す。
 */
export class Destruction {
  list: Destructible[] = [];
  private grid = new Map<number, Destructible[]>();
  private byCol = new Map<number, Destructible>();
  private cur: Destructible | null = null;
  private depth = 0;
  private debris: { body: RAPIER.RigidBody; t: number; i: number; sx: number; sy: number; sz: number }[] = [];
  private dmesh: THREE.InstancedMesh;
  private dNext = 0;
  /** このフレームでプレイヤーが壊した建物の数（悪行はまとめて記録） */
  private wreckN = 0;
  private wreckPos = new THREE.Vector3();
  /** がれきの山（まとめて1回で描く） */
  private rubble: THREE.InstancedMesh;
  private rNext = 0;

  constructor(private game: Game) {
    this.dmesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAXD);
    this.dmesh.frustumCulled = false;
    this.dmesh.castShadow = true;
    for (let i = 0; i < MAXD; i++) {
      this.dmesh.setMatrixAt(i, ZERO);
      this.dmesh.setColorAt(i, new THREE.Color('#888888'));
    }
    game.scene.add(this.dmesh);
    this.rubble = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1, 7), new THREE.MeshStandardMaterial({ color: '#7d7468', roughness: 1, flatShading: true }), MAXR);
    this.rubble.frustumCulled = false;
    this.rubble.receiveShadow = true;
    this.rubble.count = 0;
    game.scene.add(this.rubble);
  }

  // ---------- 街を作るときの登録 ----------
  begin(kind: DestKind, x: number, y: number, z: number, w: number, d: number, h: number, color: string) {
    this.depth++;
    if (this.depth > 1) return;
    this.cur = { id: this.list.length, kind, x, y, z, w, d, h, hp: HP[kind], color, handles: [], colliders: [], alive: true };
  }

  /** 壊れたときに呼ばれる（ストーリーの目標の判定など） */
  onDestroyed?: (o: Destructible) => void;

  end(): Destructible | null {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth > 0 || !this.cur) return null;
    const o = this.cur;
    this.cur = null;
    if (!o.handles.length) return null;
    this.list.push(o);
    const r = Math.max(o.w, o.d) / 2;
    for (let cx = Math.floor((o.x - r) / CELL); cx <= Math.floor((o.x + r) / CELL); cx++) {
      for (let cz = Math.floor((o.z - r) / CELL); cz <= Math.floor((o.z + r) / CELL); cz++) {
        const k = cx * 10000 + cz;
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(o);
      }
    }
    for (const c of o.colliders) this.byCol.set(c.handle, o);
    return o;
  }

  /** 噛みつき・バットなど、すぐそばの物を叩く。当たったら true */
  hitNear(pos: THREE.Vector3, r: number, dmg: number, byPlayer: boolean) {
    let best: Destructible | null = null;
    let bd = r;
    for (const o of this.near(pos.x, pos.z, r)) {
      if (o.kind === 'house' || o.kind === 'building' || o.kind === 'tower') continue;
      const d = Math.hypot(o.x - pos.x, o.z - pos.z) - Math.max(o.w, o.d) / 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best) return false;
    this.game.fx.sparks(pos);
    this.game.audio.play('kick', pos, 0.7);
    this.damage(best, dmg, this.game.player.pos, true, byPlayer);
    return true;
  }

  addHandle(h: DrawHandle) {
    this.cur?.handles.push(h);
  }
  addCollider(c: RAPIER.Collider) {
    this.cur?.colliders.push(c);
  }
  addExtra(obj: THREE.Object3D) {
    this.cur?.handles.push({ kind: 'mesh', mesh: obj });
  }

  /** 看板などを、すぐ近くの建物に付ける（建物が壊れたら一緒に消える） */
  attach(obj: THREE.Object3D, x: number, z: number) {
    const h: DrawHandle = { kind: 'mesh', mesh: obj };
    if (this.cur) {
      this.cur.handles.push(h);
      return;
    }
    let best: Destructible | null = null;
    let bd = 1.2;
    for (const o of this.near(x, z, 1.2)) {
      if (o.kind !== 'house' && o.kind !== 'building' && o.kind !== 'tower') continue;
      const d = Math.hypot(o.x - x, o.z - z) - Math.max(o.w, o.d) / 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    best?.handles.push(h);
  }

  byCollider(handle: number) {
    const o = this.byCol.get(handle);
    return o && o.alive ? o : null;
  }

  near(x: number, z: number, r: number): Destructible[] {
    const out = new Set<Destructible>();
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        for (const o of this.grid.get(cx * 10000 + cz) ?? []) {
          if (!o.alive) continue;
          if (Math.hypot(o.x - x, o.z - z) - Math.max(o.w, o.d) / 2 < r) out.add(o);
        }
      }
    }
    return [...out];
  }

  // ---------- 壊す ----------
  damage(o: Destructible, amount: number, from: THREE.Vector3, debris = true, byPlayer = false) {
    if (!o.alive) return;
    o.hp -= amount;
    if (o.hp <= 0) this.destroy(o, from, debris, byPlayer);
  }

  /** 爆発などで、範囲の物にまとめてダメージ */
  damageArea(pos: THREE.Vector3, radius: number, dmg: number, debris = true, byPlayer = false) {
    for (const o of this.near(pos.x, pos.z, radius)) {
      const d = Math.max(0, Math.hypot(o.x - pos.x, o.z - pos.z) - Math.max(o.w, o.d) / 2);
      this.damage(o, dmg * (0.35 + 0.65 * (1 - clamp(d / radius, 0, 1))), pos, debris, byPlayer);
    }
  }

  destroy(o: Destructible, from: THREE.Vector3, withDebris = true, byPlayer = false, quiet = false) {
    if (!o.alive) return;
    const g = this.game;
    o.alive = false;
    this.onDestroyed?.(o);
    const isBld = o.kind === 'house' || o.kind === 'building' || o.kind === 'tower';
    if (byPlayer && isBld) {
      this.wreckN++;
      this.wreckPos.set(o.x, o.y, o.z);
    }
    for (const h of o.handles) Batcher.hide(h);
    for (const c of o.colliders) {
      this.byCol.delete(c.handle);
      g.physics.world.removeCollider(c, true);
    }
    const big = o.kind === 'house' || o.kind === 'building' || o.kind === 'tower';
    const size = Math.max(o.w, o.d, o.h);
    // 土ぼこり
    const nDust = quiet ? (big ? 2 : 0) : clamp(Math.round(size * 1.6), 4, big ? 36 : 8);
    for (let i = 0; i < nDust; i++) {
      g.fx.smoke(new THREE.Vector3(o.x + rand.range(-o.w / 2, o.w / 2), o.y + rand.range(0, o.h * 0.6), o.z + rand.range(-o.d / 2, o.d / 2)), false);
    }
    if (!quiet) g.audio.play('crash', new THREE.Vector3(o.x, o.y, o.z), big ? 1 : 0.6, big ? 0.6 : 1.1);
    if (big) {
      // がれきの山
      const sy = Math.min(o.h * 0.15, 3.5);
      _m.compose(_p.set(o.x, o.y + sy / 2 - 0.05, o.z), _q.setFromAxisAngle(_up, rand.range(0, 6)), _s.set(o.w * 0.9, sy, o.d * 0.9));
      const i = this.rNext;
      this.rNext = (this.rNext + 1) % MAXR;
      this.rubble.setMatrixAt(i, _m);
      this.rubble.count = Math.max(this.rubble.count, i + 1);
      this.rubble.instanceMatrix.needsUpdate = true;
      if (!quiet) {
        g.audio.play('boom', new THREE.Vector3(o.x, o.y, o.z), 0.5, 0.5);
        if (g.camera.position.distanceTo(_p) < 60) g.camRig.addShake(0.5);
        g.npcs.panicAround(_p.clone(), 30);
      }
    }
    if (withDebris) this.spawnDebris(o, from, clamp(Math.round(size * 1.5), 3, big ? 24 : 6));
  }

  private spawnDebris(o: Destructible, from: THREE.Vector3, n: number) {
    const w = this.game.physics.world;
    const base = new THREE.Color(o.color);
    for (let k = 0; k < n; k++) {
      // 古いがれきから使い回す
      if (this.debris.length >= MAXD) {
        const old = this.debris.shift()!;
        w.removeRigidBody(old.body);
        this.dmesh.setMatrixAt(old.i, ZERO);
      }
      const i = this.dNext;
      this.dNext = (this.dNext + 1) % MAXD;
      const s = Math.min(2.4, Math.max(0.25, Math.max(o.w, o.h) * rand.range(0.05, 0.16)));
      const sx = s * rand.range(0.6, 1.4);
      const sy = s * rand.range(0.3, 0.9);
      const sz = s * rand.range(0.6, 1.4);
      const px = o.x + rand.range(-o.w / 2, o.w / 2);
      const py = o.y + rand.range(0.3, Math.max(0.6, o.h * 0.8));
      const pz = o.z + rand.range(-o.d / 2, o.d / 2);
      const dir = new THREE.Vector3(px - from.x, 0, pz - from.z).normalize();
      const body = w.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(px, py, pz)
          .setLinvel(dir.x * rand.range(3, 10), rand.range(3, 9), dir.z * rand.range(3, 10))
          .setAngvel({ x: rand.range(-5, 5), y: rand.range(-5, 5), z: rand.range(-5, 5) }),
      );
      w.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setDensity(0.5).setFriction(0.9).setCollisionGroups(groups(G.DEBRIS, G.STATIC | G.DEBRIS)), body);
      this.dmesh.setColorAt(i, base.clone().multiplyScalar(rand.range(0.6, 1.05)));
      this.debris.push({ body, t: rand.range(12, 20), i, sx, sy, sz });
    }
    if (this.dmesh.instanceColor) this.dmesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    const w = this.game.physics.world;
    if (this.wreckN) {
      this.game.karma.crime('wreck', this.wreckPos, '', this.wreckN);
      this.wreckN = 0;
    }
    for (let k = this.debris.length - 1; k >= 0; k--) {
      const d = this.debris[k];
      d.t -= dt;
      if (d.t < 0) {
        w.removeRigidBody(d.body);
        this.dmesh.setMatrixAt(d.i, ZERO);
        this.debris.splice(k, 1);
        continue;
      }
      const t = d.body.translation();
      const r = d.body.rotation();
      const shrink = Math.min(1, d.t);
      _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s.set(d.sx * shrink, d.sy * shrink, d.sz * shrink));
      this.dmesh.setMatrixAt(d.i, _m);
    }
    this.dmesh.instanceMatrix.needsUpdate = true;
  }
}
