import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Game } from '../core/Game';
import { G, groups, RAPIER } from '../core/Physics';
import { rand } from '../core/Rng';

export type ItemId =
  | 'apple'
  | 'banana'
  | 'tomato'
  | 'daikon'
  | 'fish'
  | 'bread'
  | 'flower'
  | 'meat'
  | 'manju'
  | 'onigiri'
  | 'burger'
  | 'wallet'
  | 'phone'
  | 'ball'
  | 'bone'
  | 'crepe'
  | 'cotton'
  | 'icecream';

export type Owner = 'none' | 'shop' | 'shrine' | 'person';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** 通常時の幸福度アップ量 */
  happy: number;
  /** 悪魔モード時の悪魔度アップ量 */
  devil: number;
  radius: number;
  category: 'food' | 'flower' | 'toy' | 'loot' | 'sweets';
}

export const ITEMS: Record<ItemId, ItemDef> = {
  apple: { id: 'apple', name: 'りんご', happy: 4, devil: 2, radius: 0.06, category: 'food' },
  banana: { id: 'banana', name: 'バナナ', happy: 3, devil: 2, radius: 0.07, category: 'food' },
  tomato: { id: 'tomato', name: 'トマト', happy: 3, devil: 2, radius: 0.05, category: 'food' },
  daikon: { id: 'daikon', name: 'だいこん', happy: 4, devil: 2, radius: 0.08, category: 'food' },
  fish: { id: 'fish', name: 'おさかな', happy: 4, devil: 3, radius: 0.07, category: 'food' },
  bread: { id: 'bread', name: 'パン', happy: 4, devil: 2, radius: 0.07, category: 'food' },
  flower: { id: 'flower', name: 'お花', happy: 6, devil: 1, radius: 0.06, category: 'flower' },
  meat: { id: 'meat', name: 'お肉', happy: 5, devil: 4, radius: 0.07, category: 'food' },
  manju: { id: 'manju', name: 'おまんじゅう', happy: 4, devil: 3, radius: 0.05, category: 'sweets' },
  onigiri: { id: 'onigiri', name: 'おにぎり', happy: 4, devil: 2, radius: 0.06, category: 'food' },
  burger: { id: 'burger', name: 'ハンバーガー', happy: 4, devil: 3, radius: 0.07, category: 'food' },
  wallet: { id: 'wallet', name: 'さいふ', happy: 2, devil: 8, radius: 0.06, category: 'loot' },
  phone: { id: 'phone', name: 'スマホ', happy: 2, devil: 7, radius: 0.06, category: 'loot' },
  ball: { id: 'ball', name: 'ボール', happy: 5, devil: 1, radius: 0.09, category: 'toy' },
  bone: { id: 'bone', name: 'ほね', happy: 3, devil: 3, radius: 0.07, category: 'toy' },
  crepe: { id: 'crepe', name: 'クレープ', happy: 6, devil: 3, radius: 0.06, category: 'sweets' },
  cotton: { id: 'cotton', name: 'わたあめ', happy: 6, devil: 3, radius: 0.08, category: 'sweets' },
  icecream: { id: 'icecream', name: 'ソフトクリーム', happy: 6, devil: 3, radius: 0.06, category: 'sweets' },
};

// ---------- 見た目（パーツを1つのジオメトリにまとめ、頂点カラーで塗る） ----------
type Part = [THREE.BufferGeometry, string, number, number, number, number?, number?, number?];

function build(parts: Part[]) {
  const geos = parts.map(([g, color, x, y, z, rx = 0, ry = 0, rz = 0]) => {
    const geo = (g.index ? g.toNonIndexed() : g.clone()) as THREE.BufferGeometry;
    geo.deleteAttribute('uv');
    geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    geo.translate(x, y, z);
    const c = new THREE.Color(color);
    const n = geo.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return geo;
  });
  return mergeGeometries(geos)!;
}

const S = (r: number, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 12, 8).scale(sx, sy, sz);
const B = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const CY = (r: number, h: number, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg);
const CO = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);

const FLOWER_COLORS = ['#ff6fa5', '#ffd23f', '#ff8c42', '#b388ff', '#ff4d6d', '#ffffff', '#6ec6ff'];

function itemGeometry(id: ItemId, variant: number): THREE.BufferGeometry {
  switch (id) {
    case 'apple':
      return build([
        [S(0.06), '#d22b2b', 0, 0.06, 0],
        [CY(0.006, 0.035), '#6b4a2a', 0, 0.125, 0],
        [B(0.03, 0.004, 0.015), '#4caf50', 0.015, 0.13, 0, 0, 0, 0.4],
      ]);
    case 'banana':
      return build([
        [new THREE.TorusGeometry(0.075, 0.02, 6, 10, Math.PI * 0.7), '#f7d43a', 0, 0.02, 0, Math.PI / 2, 0, 0],
        [new THREE.TorusGeometry(0.075, 0.02, 6, 10, Math.PI * 0.7), '#f2c82a', 0.02, 0.045, 0.01, Math.PI / 2, 0, 0.2],
      ]);
    case 'tomato':
      return build([
        [S(0.05, 1, 0.85, 1), '#e8402a', 0, 0.043, 0],
        [CO(0.025, 0.02, 5), '#3f8f3f', 0, 0.09, 0],
      ]);
    case 'daikon':
      return build([
        [CO(0.04, 0.3, 10), '#f6f3ea', 0, 0.04, 0, 0, 0, Math.PI / 2],
        [CO(0.03, 0.12, 5), '#4caf50', 0.19, 0.06, 0.015, 0, 0, -Math.PI / 2.4],
        [CO(0.03, 0.12, 5), '#5cbf60', 0.19, 0.05, -0.02, 0, 0, -Math.PI / 2],
      ]);
    case 'fish':
      return build([
        [S(0.05, 0.75, 0.7, 2.4), '#8fa9c4', 0, 0.035, 0],
        [CO(0.04, 0.06, 4), '#6f89a4', 0, 0.035, -0.135, Math.PI / 2, 0, Math.PI / 4],
        [S(0.008), '#111111', 0.025, 0.045, 0.09],
      ]);
    case 'bread':
      return build([
        [S(0.06, 1.4, 0.7, 0.9), '#c98b45', 0, 0.04, 0],
        [S(0.05, 1.3, 0.35, 0.75), '#e2b070', 0, 0.065, 0],
      ]);
    case 'flower': {
      const col = FLOWER_COLORS[variant % FLOWER_COLORS.length];
      const parts: Part[] = [
        [CY(0.006, 0.2), '#3e8e41', 0, 0.1, 0],
        [B(0.04, 0.004, 0.018), '#4caf50', 0.02, 0.08, 0, 0, 0, 0.5],
        [S(0.018), '#ffd54f', 0, 0.205, 0],
      ];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        parts.push([S(0.022, 1, 0.5, 1), col, Math.cos(a) * 0.028, 0.203, Math.sin(a) * 0.028]);
      }
      return build(parts);
    }
    case 'meat':
      return build([
        [S(0.07, 1.2, 0.45, 0.9), '#d9606a', 0, 0.035, 0],
        [S(0.05, 1.0, 0.3, 0.7), '#f2a7a7', 0.01, 0.05, 0],
        [CY(0.012, 0.09), '#f4efe2', -0.1, 0.03, 0, 0, 0, Math.PI / 2],
        [S(0.018), '#f4efe2', -0.15, 0.03, 0],
      ]);
    case 'manju':
      return build([
        [S(0.05, 1, 0.65, 1), '#f3e6cf', 0, 0.033, 0],
        [S(0.012), '#b0644a', 0, 0.065, 0],
      ]);
    case 'onigiri':
      return build([
        [CO(0.065, 0.11, 3), '#fafafa', 0, 0.055, 0, Math.PI / 2, 0, 0],
        [B(0.05, 0.05, 0.045), '#1e2a1e', 0, 0.025, 0.0],
      ]);
    case 'burger':
      return build([
        [CY(0.055, 0.025, 12), '#d39a52', 0, 0.013, 0],
        [CY(0.058, 0.02, 12), '#5a3420', 0, 0.035, 0],
        [CY(0.062, 0.006, 12), '#7bc043', 0, 0.048, 0],
        [S(0.056, 1, 0.55, 1), '#e0a35a', 0, 0.052, 0],
      ]);
    case 'wallet':
      return build([
        [B(0.11, 0.025, 0.075), '#6b3f22', 0, 0.013, 0],
        [B(0.112, 0.004, 0.02), '#d4af37', 0, 0.027, 0.02],
      ]);
    case 'phone':
      return build([
        [B(0.075, 0.012, 0.15), '#1a1a1a', 0, 0.006, 0],
        [B(0.065, 0.002, 0.13), '#3b6ea8', 0, 0.013, 0],
      ]);
    case 'ball':
      return build([
        [S(0.09), '#e8433a', 0, 0.09, 0],
        [new THREE.TorusGeometry(0.09, 0.012, 6, 20), '#ffffff', 0, 0.09, 0],
      ]);
    case 'bone':
      return build([
        [CY(0.016, 0.16), '#f4efe2', 0, 0.025, 0, 0, 0, Math.PI / 2],
        [S(0.022), '#f4efe2', 0.085, 0.025, 0.018],
        [S(0.022), '#f4efe2', 0.085, 0.025, -0.018],
        [S(0.022), '#f4efe2', -0.085, 0.025, 0.018],
        [S(0.022), '#f4efe2', -0.085, 0.025, -0.018],
      ]);
    case 'crepe':
      return build([
        [CO(0.045, 0.15, 10), '#e7c38a', 0, 0.075, 0, Math.PI, 0, 0],
        [S(0.042), '#fffaf0', 0, 0.16, 0],
        [S(0.016), '#e53950', 0.02, 0.19, 0.01],
      ]);
    case 'cotton':
      return build([
        [CY(0.005, 0.2), '#f5f5f5', 0, 0.1, 0],
        [S(0.075, 1, 1.1, 1), '#ffb6d9', 0, 0.24, 0],
      ]);
    case 'icecream':
      return build([
        [CO(0.035, 0.11, 10), '#d9a35b', 0, 0.055, 0, Math.PI, 0, 0],
        [S(0.036), '#fffaf3', 0, 0.12, 0],
        [S(0.026), '#fffaf3', 0, 0.155, 0],
        [S(0.014), '#fffaf3', 0, 0.18, 0],
      ]);
  }
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const ITEM_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });

function getGeometry(id: ItemId, variant: number) {
  const key = `${id}:${id === 'flower' ? variant : 0}`;
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = itemGeometry(id, variant)));
  return g;
}

interface Slot {
  id: ItemId;
  x: number;
  y: number;
  z: number;
  rot: number;
  owner: Owner;
  taken: boolean;
  timer: number;
}

export class WorldItem {
  body: RAPIER.RigidBody | null = null;
  state: 'world' | 'carried' | 'gone' = 'world';
  stolen = false;
  /** 最初に置かれていた場所（なんくの家の花かどうかの判定などに使う） */
  origin = new THREE.Vector3();
  constructor(
    public def: ItemDef,
    public obj: THREE.Mesh,
    public owner: Owner,
    public slot: Slot | null,
  ) {}
}

/** 拾える物の管理（盗みの判定・お店の品の補充） */
export class ItemSystem {
  list: WorldItem[] = [];
  /** ワールド生成中は true（置いた場所を記録して、取られたら後で補充する） */
  recording = false;
  private slots: Slot[] = [];
  private root = new THREE.Group();

  constructor(private game: Game) {
    game.scene.add(this.root);
  }

  spawn(id: ItemId, x: number, y: number, z: number, owner: Owner = 'none', rot = 0): WorldItem {
    let slot: Slot | null = null;
    if (this.recording) {
      slot = { id, x, y, z, rot, owner, taken: false, timer: 0 };
      this.slots.push(slot);
    }
    return this.place(id, x, y, z, owner, rot, slot);
  }

  private place(id: ItemId, x: number, y: number, z: number, owner: Owner, rot: number, slot: Slot | null) {
    const mesh = new THREE.Mesh(getGeometry(id, rand.int(0, 99)), ITEM_MAT);
    mesh.castShadow = true;
    mesh.position.set(x, y, z);
    mesh.rotation.y = rot;
    this.root.add(mesh);
    const it = new WorldItem(ITEMS[id], mesh, owner, slot);
    it.origin.set(x, y, z);
    this.list.push(it);
    return it;
  }

  findNear(mouth: THREE.Vector3, dogY: number, maxDist: number): WorldItem | null {
    let best: WorldItem | null = null;
    let bd = maxDist;
    for (const it of this.list) {
      if (it.state !== 'world') continue;
      const p = it.obj.position;
      const dy = p.y - dogY;
      if (dy < -0.5 || dy > 1.05) continue;
      const d = Math.hypot(p.x - mouth.x, p.z - mouth.z);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  /** 拾う。盗みなら持ち主の種類を返す */
  pickUp(it: WorldItem): Owner | null {
    let theft: Owner | null = null;
    if (it.owner !== 'none') {
      theft = it.owner;
      it.stolen = true;
      it.owner = 'none';
    }
    if (it.body) {
      this.game.physics.world.removeRigidBody(it.body);
      it.body = null;
    }
    if (it.slot) {
      it.slot.taken = true;
      it.slot.timer = rand.range(70, 120);
      it.slot = null;
    }
    it.state = 'carried';
    return theft;
  }

  drop(it: WorldItem, pos: THREE.Vector3, vel: THREE.Vector3) {
    const w = this.game.physics.world;
    if (it.body) w.removeRigidBody(it.body);
    const r = it.def.radius;
    it.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y + r, pos.z)
        .setLinvel(vel.x, vel.y, vel.z)
        .setAngularDamping(1.5)
        .setLinearDamping(0.3)
        .setCcdEnabled(true),
    );
    w.createCollider(
      RAPIER.ColliderDesc.ball(r).setDensity(0.6).setFriction(0.8).setRestitution(0.25).setCollisionGroups(groups(G.ITEM, G.STATIC | G.PLAYER | G.NPC | G.ITEM | G.VEHICLE)),
      it.body,
    );
    this.root.attach(it.obj);
    it.obj.position.copy(pos);
    it.state = 'world';
  }

  remove(it: WorldItem) {
    it.state = 'gone';
    it.obj.parent?.remove(it.obj);
    if (it.body) {
      this.game.physics.world.removeRigidBody(it.body);
      it.body = null;
    }
    const i = this.list.indexOf(it);
    if (i >= 0) this.list.splice(i, 1);
  }

  update(dt: number) {
    const tmpQ = new THREE.Quaternion();
    for (const it of this.list) {
      if (it.state !== 'world' || !it.body) continue;
      const t = it.body.translation();
      const r = it.body.rotation();
      tmpQ.set(r.x, r.y, r.z, r.w);
      it.obj.quaternion.copy(tmpQ);
      it.obj.position.set(t.x, t.y - it.def.radius, t.z);
      if (t.y < -10) this.remove(it);
    }
    // お店の品・花の補充
    const p = this.game.player.pos;
    for (const s of this.slots) {
      if (!s.taken) continue;
      s.timer -= dt;
      if (s.timer < 0 && Math.hypot(s.x - p.x, s.z - p.z) > 30) {
        s.taken = false;
        this.place(s.id, s.x, s.y, s.z, s.owner, s.rot, s);
      }
    }
  }
}
