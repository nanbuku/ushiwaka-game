import * as THREE from 'three';
import type { Assets } from '../assets/Assets';
import type { Physics } from '../core/Physics';
import { Rng } from '../core/Rng';
import { Batcher } from './Batcher';
import type { DestKind, Destruction } from './Destruction';
import { GEO, MAT, makeSign } from './Kit';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export type BoxKey = 'plain' | 'office' | 'house' | 'shop' | 'lamp' | 'neon' | 'glass' | 'slab';

/** 街のパーツを置くための道具箱。すべての物体はバッチ描画＋静的コライダーで作る */
export class WorldBuilder {
  batch = new Batcher();
  /** 個別メッシュ（看板など）の置き場 */
  extras = new THREE.Group();
  /** 壊せる物の登録先（街を作っている間だけ） */
  dest: Destruction | null = null;

  constructor(public physics: Physics, public rng: Rng, public assets: Assets) {
    const b = this.batch;
    b.define('plain', GEO.box, MAT.plain);
    b.define('slab', GEO.box, MAT.slab, false, true);
    b.define('office', GEO.box, MAT.office);
    b.define('house', GEO.box, MAT.house);
    b.define('shop', GEO.box, MAT.shop);
    b.define('lamp', GEO.box, MAT.lamp, false, false);
    b.define('neon', GEO.box, MAT.neon, false, false);
    b.define('glass', GEO.box, MAT.glass, false, false);
    b.define('roof', GEO.roof, MAT.plain);
    b.define('cyl', GEO.cyl, MAT.plain);
    b.define('cone', GEO.cone, MAT.flatShade);
    b.define('crown', GEO.crown, MAT.flatShade);
    b.define('sphere', GEO.sphere, MAT.plain);
    b.define('ground', GEO.flat, MAT.ground, false, true);
    b.define('road', GEO.flat, MAT.road, false, true);
    b.define('mark', GEO.flat, MAT.mark, false, true);
    b.define('disc', GEO.disc, MAT.ground, false, true);
    b.define('water', GEO.flat, MAT.water, false, true);
    b.define('waterDisc', GEO.disc, MAT.water, false, true);
  }

  /** ここから end() までに置いた物を、1つの「壊せる物」として登録する */
  begin(kind: DestKind, x: number, y: number, z: number, w: number, d: number, h: number, color: THREE.ColorRepresentation) {
    this.dest?.begin(kind, x, y, z, w, d, h, '#' + new THREE.Color(color).getHexString());
  }
  end() {
    this.dest?.end();
  }

  static mat(x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number) {
    return _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, rotY), _s.set(sx, sy, sz));
  }

  /** ローカル座標(lx,lz)を、中心(x,z)・回転rotYでワールドへ */
  static local(x: number, z: number, rotY: number, lx: number, lz: number): [number, number] {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    return [x + lx * c + lz * s, z - lx * s + lz * c];
  }

  // ---------- Kenney モデル ----------
  /** モデルがあるか */
  hasModel(key: string) {
    return !!this.assets.get(key);
  }

  /**
   * モデルを置く。足元の中心が (x, y, z) に来るように置き、回転 rotY・拡大 scale。
   * collide: 'box' = 外形の箱、'none' = なし。戻り値は置いたときの実寸（なければ null）
   */
  model(key: string, x: number, y: number, z: number, rotY: number, scale: number | [number, number, number], opt: { collide?: 'box' | 'none'; tint?: Record<string, THREE.ColorRepresentation>; cast?: boolean; variant?: number } = {}) {
    const md = this.assets.get(key);
    if (!md) return null;
    const S: [number, number, number] = typeof scale === 'number' ? [scale, scale, scale] : scale;
    // 外形の中心が (x, z) に来るようにずらす
    const [ox, oz] = WorldBuilder.local(0, 0, rotY, md.center.x * S[0], md.center.z * S[2]);
    const px = x - ox;
    const pz = z - oz;
    const py = y - md.box.min.y * S[1];
    const base = WorldBuilder.mat(px, py, pz, rotY, S[0], S[1], S[2]).clone();
    for (const p of md.parts) {
      let mat = opt.tint && opt.tint[p.mat.name] ? this.assets.tinted(p.mat, opt.tint[p.mat.name]) : p.mat;
      if (opt.variant) mat = this.assets.variant(mat, opt.variant);
      this.batch.addMerged(p.geo, mat, base.clone().multiply(p.matrix), opt.cast ?? true);
    }
    const w = md.size.x * S[0];
    const h = md.size.y * S[1];
    const d = md.size.z * S[2];
    if (opt.collide !== 'none') this.physics.staticBox(x, y + h / 2, z, w / 2, h / 2, d / 2, rotY);
    return { w, h, d };
  }

  /** 幅 w・奥行き d に収まる等倍の拡大率 */
  fitScale(key: string, w: number, d: number) {
    const md = this.assets.get(key);
    if (!md) return 1;
    return Math.min(w / md.size.x, d / md.size.z);
  }

  modelSize(key: string) {
    return this.assets.get(key)?.size ?? null;
  }

  // ---------- 基本形 ----------
  box(key: BoxKey, x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, rotY = 0, collide = true) {
    this.batch.add(key, WorldBuilder.mat(x, y, z, rotY, w, h, d), color);
    if (collide) this.physics.staticBox(x, y + h / 2, z, w / 2, h / 2, d / 2, rotY);
  }

  cyl(x: number, y: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, collide = true) {
    this.batch.add('cyl', WorldBuilder.mat(x, y, z, 0, r * 2, h, r * 2), color);
    if (collide) this.physics.staticCylinder(x, y + h / 2, z, h / 2, r);
  }

  sphere(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation) {
    this.batch.add('sphere', WorldBuilder.mat(x, y - r, z, 0, r * 2, r * 2, r * 2), color);
  }

  flat(key: 'ground' | 'road' | 'mark' | 'water', x: number, y: number, z: number, w: number, d: number, color: THREE.ColorRepresentation, rotY = 0) {
    this.batch.add(key, WorldBuilder.mat(x, y, z, rotY, w, 1, d), color);
  }

  disc(x: number, y: number, z: number, rx: number, rz: number, color: THREE.ColorRepresentation, water = false) {
    this.batch.add(water ? 'waterDisc' : 'disc', WorldBuilder.mat(x, y, z, 0, rx * 2, 1, rz * 2), color);
  }

  /** 線分に沿った細長い箱（塀・柵・生け垣） */
  wall(x1: number, z1: number, x2: number, z2: number, y: number, h: number, t: number, color: THREE.ColorRepresentation, collide = true) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const rot = Math.atan2(dx, dz);
    this.box('plain', (x1 + x2) / 2, y, (z1 + z2) / 2, t, h, len, color, rot, collide);
  }

  // ---------- 建物 ----------
  building(x: number, z: number, y: number, w: number, d: number, h: number, color: THREE.ColorRepresentation, rotY = 0, style: 'office' | 'house' | 'shop' = 'office') {
    this.begin(h >= 45 ? 'tower' : style === 'house' && h < 8 ? 'house' : 'building', x, y, z, w, d, h, color);
    this.buildingInner(x, z, y, w, d, h, color, rotY, style);
    this.end();
  }

  private buildingInner(x: number, z: number, y: number, w: number, d: number, h: number, color: THREE.ColorRepresentation, rotY: number, style: 'office' | 'house' | 'shop') {
    this.box(style, x, y, z, w, h, d, color, rotY);
    if (style === 'office' && h > 12) {
      // 屋上の室外機など
      const n = this.rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const [ax, az] = WorldBuilder.local(x, z, rotY, this.rng.range(-w / 3, w / 3), this.rng.range(-d / 3, d / 3));
        this.box('plain', ax, y + h, az, this.rng.range(1.5, 3.5), this.rng.range(1, 2.2), this.rng.range(1.5, 3), '#9a9a96', rotY, false);
      }
    }
  }

  /** 一戸建て。正面はローカル +z。Kenney の住宅があればそれを使う */
  house(x: number, z: number, y: number, w: number, d: number, rotY: number, wall: THREE.ColorRepresentation, roof: THREE.ColorRepresentation, stories = 1) {
    this.begin('house', x, y, z, w, d, stories * 3.2, wall);
    this.houseInner(x, z, y, w, d, rotY, wall, roof, stories);
    this.end();
  }

  private houseInner(x: number, z: number, y: number, w: number, d: number, rotY: number, wall: THREE.ColorRepresentation, roof: THREE.ColorRepresentation, stories: number) {
    const variants = 'abcdefghijklmnopqrstu'.split('').map((c) => `suburban/building-type-${c}`).filter((k) => this.hasModel(k));
    if (variants.length) {
      const key = this.rng.pick(variants);
      const s = this.fitScale(key, w + 1, d + 1);
      this.model(key, x, y, z, rotY, s, { variant: this.rng.int(0, 4) });
      return;
    }
    const h = stories * 2.9;
    this.box('house', x, y, z, w, h, d, wall, rotY);
    this.batch.add('roof', WorldBuilder.mat(x, y + h, z, rotY, w + 0.7, 1.3 + w * 0.08, d + 0.7), roof);
    const [dx, dz] = WorldBuilder.local(x, z, rotY, w * 0.22, d / 2 + 0.04);
    this.box('plain', dx, y, dz, 1.0, 2.05, 0.08, '#5b4231', rotY, false);
    const [px, pz] = WorldBuilder.local(x, z, rotY, w * 0.22, d / 2 + 0.6);
    this.box('plain', px, y, pz, 1.6, 0.12, 1.1, '#b9b2a6', rotY, false);
  }

  // ---------- 小物 ----------
  tree(x: number, z: number, y: number, s = 1, kind: 'round' | 'pine' | 'sakura' | 'bush' = 'round') {
    this.begin(kind === 'bush' ? 'prop' : 'tree', x, y, z, 1.4 * s, 1.4 * s, kind === 'bush' ? 1 : 6 * s, kind === 'sakura' ? '#c98aa0' : '#5a7a3a');
    this.treeInner(x, z, y, s, kind);
    this.end();
  }

  private treeInner(x: number, z: number, y: number, s: number, kind: 'round' | 'pine' | 'sakura' | 'bush') {
    const rng = this.rng;
    if (this.kenneyTree(x, z, y, s, kind)) return;
    if (kind === 'bush') {
      this.batch.add('crown', WorldBuilder.mat(x, y, z, rng.range(0, 6), 1.4 * s, 1.0 * s, 1.4 * s), rng.pick(['#4e8a3a', '#5a9440', '#3f7a35']));
      this.physics.staticCylinder(x, y + 0.4 * s, z, 0.4 * s, 0.55 * s);
      return;
    }
    const trunkH = (kind === 'pine' ? 2.2 : 1.8) * s;
    this.cyl(x, y, z, 0.16 * s, trunkH + 0.4 * s, '#6b4a32', false);
    this.physics.staticCylinder(x, y + 1.2, z, 1.2, 0.2 * s);
    if (kind === 'pine') {
      const col = rng.pick(['#2f5e3a', '#335f34', '#2a5530']);
      this.batch.add('cone', WorldBuilder.mat(x, y + trunkH * 0.6, z, 0, 3.0 * s, 3.4 * s, 3.0 * s), col);
      this.batch.add('cone', WorldBuilder.mat(x, y + trunkH * 0.6 + 2.0 * s, z, 0, 2.2 * s, 2.8 * s, 2.2 * s), col);
    } else {
      const col = kind === 'sakura' ? rng.pick(['#f7c6d9', '#f4b6cc', '#fad3e1']) : rng.pick(['#5d9b45', '#4f8e3c', '#6aa84f', '#7bb35a']);
      const cs = rng.range(2.6, 3.4) * s;
      this.batch.add('crown', WorldBuilder.mat(x, y + trunkH * 0.75, z, rng.range(0, 6), cs, cs * 0.9, cs), col);
      if (rng.chance(0.6)) {
        const [ox, oz] = [rng.range(-0.8, 0.8) * s, rng.range(-0.8, 0.8) * s];
        this.batch.add('crown', WorldBuilder.mat(x + ox, y + trunkH * 0.75 + cs * 0.45, z + oz, rng.range(0, 6), cs * 0.7, cs * 0.65, cs * 0.7), col);
      }
    }
  }

  private kenneyTree(x: number, z: number, y: number, s: number, kind: 'round' | 'pine' | 'sakura' | 'bush') {
    const rng = this.rng;
    const pools: Record<string, string[]> = {
      round: ['nature/tree_default', 'nature/tree_oak', 'nature/tree_fat', 'nature/tree_detailed'],
      sakura: ['nature/tree_default', 'nature/tree_fat'],
      pine: ['nature/tree_pineTallA', 'nature/tree_pineRoundC'],
      bush: ['nature/plant_bushLarge', 'nature/plant_bushDetailed'],
    };
    const keys = pools[kind].filter((k) => this.hasModel(k));
    if (!keys.length) return false;
    const key = rng.pick(keys);
    const size = this.modelSize(key)!;
    const targetH = (kind === 'bush' ? 1.1 : kind === 'pine' ? 7.5 : 6.2) * s * rng.range(0.85, 1.15);
    const sc = targetH / size.y;
    const tint = kind === 'sakura' ? { leafsGreen: rng.pick(['#f7c6d9', '#f4b6cc', '#fad3e1']) } : undefined;
    this.model(key, x, y, z, rng.range(0, Math.PI * 2), sc, { collide: 'none', tint });
    if (kind === 'bush') this.physics.staticCylinder(x, y + 0.4 * s, z, 0.4 * s, 0.55 * s);
    else this.physics.staticCylinder(x, y + 1.2, z, 1.2, 0.22 * s);
    return true;
  }

  /** 街灯。腕はローカル +z 方向（道路側）へ伸びる */
  lamp(x: number, z: number, y: number, rotY: number) {
    this.begin('lamp', x, y, z, 0.6, 0.6, 5.5, '#55585e');
    this.lampInner(x, z, y, rotY);
    this.end();
  }

  private lampInner(x: number, z: number, y: number, rotY: number) {
    const lk = this.hasModel('roads/light-curved') ? 'roads/light-curved' : this.hasModel('roads/light-square') ? 'roads/light-square' : '';
    if (lk) {
      const sz = this.modelSize(lk)!;
      this.model(lk, x, y, z, rotY + Math.PI, 5.6 / sz.y, { collide: 'none' });
      this.physics.staticCylinder(x, y + 1.5, z, 1.5, 0.12);
      const [lx, lz] = WorldBuilder.local(x, z, rotY, 0, 1.3);
      this.box('lamp', lx, y + 5.35, lz, 0.3, 0.06, 0.5, '#fff6d8', rotY, false);
      return;
    }
    this.cyl(x, y, z, 0.09, 5.2, '#55585e', false);
    this.physics.staticCylinder(x, y + 1.5, z, 1.5, 0.12);
    const [ax, az] = WorldBuilder.local(x, z, rotY, 0, 0.7);
    this.box('plain', ax, y + 5.1, az, 0.12, 0.1, 1.5, '#55585e', rotY, false);
    const [lx, lz] = WorldBuilder.local(x, z, rotY, 0, 1.35);
    this.box('lamp', lx, y + 4.95, lz, 0.35, 0.14, 0.6, '#fff6d8', rotY, false);
  }

  /** 電柱 */
  pole(x: number, z: number, y: number, rotY: number) {
    this.begin('pole', x, y, z, 0.6, 0.6, 9.5, '#a7a39b');
    this.cyl(x, y, z, 0.15, 9.5, '#a7a39b', false);
    this.physics.staticCylinder(x, y + 1.5, z, 1.5, 0.17);
    this.box('plain', x, y + 8.4, z, 1.8, 0.12, 0.12, '#6e6a62', rotY, false);
    this.box('plain', x, y + 7.6, z, 0.35, 0.5, 0.35, '#7d7a72', rotY, false);
    this.end();
  }

  vending(x: number, z: number, y: number, rotY: number, color: THREE.ColorRepresentation) {
    this.begin('prop', x, y, z, 1, 0.8, 1.85, color);
    this.box('plain', x, y, z, 1.0, 1.85, 0.75, color, rotY);
    const [fx, fz] = WorldBuilder.local(x, z, rotY, 0, 0.38);
    this.box('lamp', fx, y + 1.0, fz, 0.8, 0.7, 0.02, '#ffffff', rotY, false);
    this.box('plain', fx, y + 0.3, fz, 0.6, 0.18, 0.04, '#222222', rotY, false);
    this.end();
  }

  bench(x: number, z: number, y: number, rotY: number) {
    this.begin('prop', x, y, z, 1.7, 0.5, 0.9, '#8a5a36');
    this.box('plain', x, y + 0.42, z, 1.7, 0.08, 0.48, '#8a5a36', rotY, false);
    const [bx, bz] = WorldBuilder.local(x, z, rotY, 0, -0.22);
    this.box('plain', bx, y + 0.5, bz, 1.7, 0.45, 0.06, '#8a5a36', rotY, false);
    for (const sx of [-0.7, 0.7]) {
      const [lx, lz] = WorldBuilder.local(x, z, rotY, sx, 0);
      this.box('plain', lx, y, lz, 0.08, 0.42, 0.45, '#3d3d3d', rotY, false);
    }
    this.physics.staticBox(x, y + 0.25, z, 0.85, 0.25, 0.25, rotY);
    this.end();
  }

  trashcan(x: number, z: number, y: number) {
    this.begin('prop', x, y, z, 0.6, 0.6, 0.85, '#4d6b55');
    this.cyl(x, y, z, 0.28, 0.85, '#4d6b55');
    this.end();
  }

  /** 駐車中の車（今は飾り。フェーズ3で運転可能に） */
  parkedCar(x: number, z: number, y: number, rotY: number, color: THREE.ColorRepresentation) {
    this.begin('prop', x, y, z, 1.8, 4.2, 1.5, color);
    this.box('plain', x, y + 0.3, z, 1.75, 0.65, 4.2, color, rotY, false);
    const [cx, cz] = WorldBuilder.local(x, z, rotY, 0, -0.25);
    this.box('glass', cx, y + 0.95, cz, 1.55, 0.55, 2.2, '#9fc6e0', rotY, false);
    this.box('plain', cx, y + 1.48, cz, 1.5, 0.06, 2.1, color, rotY, false);
    for (const [wx, wz] of [[-0.8, 1.35], [0.8, 1.35], [-0.8, -1.35], [0.8, -1.35]]) {
      const [tx, tz] = WorldBuilder.local(x, z, rotY, wx, wz);
      this.box('plain', tx, y, tz, 0.25, 0.62, 0.62, '#1b1b1b', rotY, false);
    }
    this.physics.staticBox(x, y + 0.75, z, 0.9, 0.75, 2.1, rotY);
    this.end();
  }

  /** 看板（個別メッシュ）。正面はローカル +z */
  sign(text: string, x: number, y: number, z: number, rotY: number, w: number, h: number, bg = '#ffffff', fg = '#333333', glow = false) {
    const m = makeSign(text, w, h, bg, fg, glow);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    this.extras.add(m);
    this.dest?.attach(m, x, z);
    return m;
  }

  finish(parent: THREE.Object3D) {
    const stats = this.batch.build(parent);
    parent.add(this.extras);
    return stats;
  }
}
