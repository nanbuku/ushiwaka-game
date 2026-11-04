import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

/** 衝突グループ（ビットフラグ） */
export const G = {
  STATIC: 0x0001,
  PLAYER: 0x0002,
  NPC: 0x0004,
  ITEM: 0x0008,
  VEHICLE: 0x0010,
  DEBRIS: 0x0020,
  ALL: 0xffff,
} as const;

/** Rapier の collision groups 値を作る（上位16bit=所属, 下位16bit=衝突対象） */
export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
export function quatY(rotY: number) {
  _q.setFromAxisAngle(_up, rotY);
  return { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
}

export interface RayHit {
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: RAPIER.Collider;
}

export class Physics {
  world!: RAPIER.World;
  /** 地形・建物などの静的コライダーをまとめてぶら下げる固定ボディ */
  staticBody!: RAPIER.RigidBody;
  /** 静的コライダーが作られるたびに呼ばれる（壊せる物の登録に使う） */
  onStatic?: (c: RAPIER.Collider) => void;

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  staticBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(x, y, z)
      .setRotation(quatY(rotY))
      .setCollisionGroups(groups(G.STATIC, G.ALL));
    const c = this.world.createCollider(desc, this.staticBody);
    this.onStatic?.(c);
    return c;
  }

  staticCylinder(x: number, y: number, z: number, halfH: number, r: number) {
    const desc = RAPIER.ColliderDesc.cylinder(halfH, r)
      .setTranslation(x, y, z)
      .setCollisionGroups(groups(G.STATIC, G.ALL));
    const c = this.world.createCollider(desc, this.staticBody);
    this.onStatic?.(c);
    return c;
  }

  step(dt: number) {
    this.world.timestep = dt;
    this.world.step();
  }

  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    mask: number = G.STATIC,
    exclude?: RAPIER.Collider,
  ): RayHit | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, groups(G.ALL, mask), exclude);
    if (!hit) return null;
    const h = hit as unknown as { timeOfImpact?: number; toi?: number };
    const t = h.timeOfImpact ?? h.toi ?? 0;
    return {
      dist: t,
      point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
    };
  }
}
