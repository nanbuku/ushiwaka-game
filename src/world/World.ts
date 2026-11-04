import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Rng } from '../core/Rng';
import { WorldBuilder } from './Builder';
import { buildOutskirts, EDGE, terrainHeight, WORLD } from './Outskirts';
import { buildFrontier, desertHeight, islandHeight, isOcean, type Platform } from './Frontier';

const OCEAN = { x: 0, z: 0, rx: 1e6, rz: 1e6, y: 0.05 };
import { buildDistrictLot } from './districts';
import { computeLots, computeRoads, districtAt, HALF, inRect, LINES, ROAD, type District, type Lot, type Rect, type RoadKind, type RoadSeg } from './Layout';
import { NavGraph } from './Navigation';
import type { VehicleKind } from '../vehicles/VehicleModel';
import type { WeaponId } from '../gameplay/Weapons';

export interface StaticSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  kind: 'clerk' | 'sitter';
  district: District;
}

export interface Animated {
  update(dt: number): void;
}

const GROUND_COLOR: Record<District, string> = {
  town: '#86a861',
  city: '#b7b3aa',
  downtown: '#aca59f',
  civic: '#bdb59f',
  riverside: '#9b9a8a',
  park: '#7cb25a',
  amusement: '#e6d6bd',
  countryHill: '#7fae58',
  countryField: '#8bb862',
  mountain: '#76a052',
  airport: '#a9aba5',
  highrise: '#b9b8b2',
  lake: '#86b35e',
  desert: '#e3cf9b',
  ocean: '#2f74ad',
  snow: '#76a052',
};

/** 街全体（地面・道路・建物・経路グラフ）を作って保持する */
export class World {
  lots: Lot[] = [];
  roads: RoadSeg[] = [];
  nav = new NavGraph();
  root = new THREE.Group();
  b!: WorldBuilder;
  rng = new Rng(20261102);
  spawn = new THREE.Vector3(0, 1, 0);
  spawnYaw = Math.PI;
  nankuSpot = new THREE.Vector3();
  nankuYaw = 0;
  homeArea: Rect = { x0: 0, x1: 0, z0: 0, z1: 0 };
  staticSpots: StaticSpot[] = [];
  /** 武器が落ちている場所 */
  weaponSpots: { id: WeaponId | 'vest'; x: number; y: number; z: number }[] = [];
  /** 乗れる乗り物の駐車場所 */
  vehicleSpots: { x: number; y: number; z: number; yaw: number; kind: VehicleKind }[] = [];
  animated: Animated[] = [];
  /** 水場（池など）: 入ると泳ぐ */
  waters: { x: number; z: number; rx: number; rz: number; y: number }[] = [];
  /** 屋内エリア（スーパーの中など）: 盗みの判定などに使う */
  zones: { name: string; rect: Rect }[] = [];
  /** ストーリーで使う場所（グレイハートタワーの前庭、河川敷の工場の中庭など） */
  landmarks: Record<string, THREE.Vector3> = {};
  /** 空母の甲板・坂など、高さの決まった場所 */
  platforms: Platform[] = [];

  constructor(public game: Game) {}

  get physics() {
    return this.game.physics;
  }

  build() {
    const t0 = performance.now();
    this.lots = computeLots();
    this.roads = computeRoads();
    this.b = new WorldBuilder(this.game.physics, this.rng, this.game.assets);
    // 家・ビル・木などを「壊せる物」として登録する
    const dest = this.game.destruction;
    this.b.dest = dest;
    this.b.batch.onAdd = (h) => dest.addHandle(h);
    this.game.physics.onStatic = (c) => dest.addCollider(c);
    this.buildGround();
    this.buildRoads();
    for (const lot of this.lots) {
      this.buildLotBase(lot);
      buildDistrictLot(this, lot);
    }
    this.buildBorders();
    buildOutskirts(this);
    buildFrontier(this);
    this.buildTrafficLights();
    if (this.wirePts.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(this.wirePts, 3));
      this.root.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#202020' })));
    }
    this.nav.buildFromLots(this.lots);
    const stats = this.b.finish(this.root);
    this.game.physics.onStatic = undefined;
    this.b.batch.onAdd = undefined;
    this.b.dest = null;
    this.game.scene.add(this.root);
    console.info(`[world] built in ${(performance.now() - t0).toFixed(0)}ms`, stats, 'nav nodes', this.nav.nodes.length);
  }

  update(dt: number) {
    for (const a of this.animated) a.update(dt);
  }

  lotAt(x: number, z: number): Lot | null {
    for (const l of this.lots) if (x >= l.cx0 && x < l.cx1 && z >= l.cz0 && z < l.cz1) return l;
    return null;
  }

  /** 地面の高さ（歩道付き区画の上は 0.15） */
  groundHeight(x: number, z: number) {
    for (const p of this.platforms) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return p.h0 + ((p.h1 - p.h0) * (x - p.x0)) / (p.x1 - p.x0);
    if (z < -305) return terrainHeight(x, z);
    if (x < -EDGE) return desertHeight(x, z);
    if (x > EDGE || z > EDGE) return islandHeight(x, z);
    const l = this.lotAt(x, z);
    if (l && l.raised && x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return l.y;
    return 0;
  }

  waterAt(x: number, z: number) {
    if ((Math.abs(x) > EDGE || z > 584) && isOcean(x, z)) return OCEAN;
    for (const w of this.waters) {
      const dx = (x - w.x) / w.rx;
      const dz = (z - w.z) / w.rz;
      if (dx * dx + dz * dz < 0.92) return w;
    }
    return null;
  }

  zoneAt(x: number, z: number) {
    for (const zn of this.zones) if (inRect(zn.rect, x, z)) return zn.name;
    return null;
  }

  district(x: number, z: number) {
    return districtAt(x, z);
  }

  // ---------- 地面 ----------
  private buildGround() {
    const b = this.b;
    b.flat('ground', 0, -0.02, 0, 3000, 3000, '#76a052');
    this.game.physics.staticBox(0, -1, 0, 1500, 1, 1500);
  }

  private buildLotBase(lot: Lot) {
    const b = this.b;
    const cx = (lot.x0 + lot.x1) / 2;
    const cz = (lot.z0 + lot.z1) / 2;
    const w = lot.x1 - lot.x0;
    const d = lot.z1 - lot.z0;
    if (lot.raised) {
      // 歩道（縁石込みの台）＋内側の地面
      b.box('slab', cx, 0, cz, w, lot.y, d, '#bdb8ae', 0, false);
      this.game.physics.staticBox(cx, lot.y / 2, cz, w / 2, lot.y / 2, d / 2);
      const ix0 = lot.x0 + lot.sw.w;
      const ix1 = lot.x1 - lot.sw.e;
      const iz0 = lot.z0 + lot.sw.n;
      const iz1 = lot.z1 - lot.sw.s;
      b.flat('ground', (ix0 + ix1) / 2, lot.y + 0.002, (iz0 + iz1) / 2, ix1 - ix0, iz1 - iz0, GROUND_COLOR[lot.district]);
      // 歩道の目地
      this.sidewalkDetails(lot);
    } else {
      b.flat('ground', cx, 0.004, cz, w, d, GROUND_COLOR[lot.district]);
    }
  }

  private sidewalkDetails(lot: Lot) {
    const b = this.b;
    const y = lot.y;
    const lampKinds = new Set<RoadKind>(['avenue', 'street']);
    const sides: { k: RoadKind; sw: number; pts: [number, number, number, number]; rot: number }[] = [
      { k: lot.kinds.n, sw: lot.sw.n, pts: [lot.x0, lot.z0 + 0.45, lot.x1, lot.z0 + 0.45], rot: Math.PI },
      { k: lot.kinds.s, sw: lot.sw.s, pts: [lot.x0, lot.z1 - 0.45, lot.x1, lot.z1 - 0.45], rot: 0 },
      { k: lot.kinds.w, sw: lot.sw.w, pts: [lot.x0 + 0.45, lot.z0, lot.x0 + 0.45, lot.z1], rot: -Math.PI / 2 },
      { k: lot.kinds.e, sw: lot.sw.e, pts: [lot.x1 - 0.45, lot.z0, lot.x1 - 0.45, lot.z1], rot: Math.PI / 2 },
    ];
    for (const s of sides) {
      if (!lampKinds.has(s.k) || s.sw <= 0) continue;
      const line: [number, number, number][] = [];
      const [x0, z0, x1, z1] = s.pts;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.floor(len / 28);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        if (lot.district === 'town' || lot.district === 'civic' || lot.district === 'riverside') {
          if (i % 2 === 0) {
            b.pole(x, z, y, s.rot + Math.PI / 2);
            line.push([x, y, z]);
          }
          else b.lamp(x, z, y, s.rot);
        } else b.lamp(x, z, y, s.rot);
      }
      // 電柱どうしを電線でつなぐ（たるませる）
      for (let k = 0; k + 1 < line.length; k++) this.addWire(line[k], line[k + 1]);
    }
  }

  private wirePts: number[] = [];
  private addWire(a: [number, number, number], b2: [number, number, number]) {
    const dx = b2[0] - a[0];
    const dz = b2[2] - a[2];
    const len = Math.hypot(dx, dz);
    const px = -dz / len;
    const pz = dx / len;
    for (const [off, h] of [
      [0.7, 8.38],
      [-0.7, 8.38],
      [0.15, 7.62],
    ] as const) {
      const N = 10;
      for (let i = 0; i < N; i++) {
        for (const t of [i / N, (i + 1) / N]) {
          const sag = 4 * t * (1 - t) * (0.6 + len * 0.012);
          this.wirePts.push(a[0] + dx * t + px * off, a[1] + h - sag, a[2] + dz * t + pz * off);
        }
      }
    }
  }

  // ---------- 道路 ----------
  /** 交差点で交わる道路の最大幅（横断歩道の位置決め用） */
  private crossHW(axis: 'h' | 'v', x: number, z: number) {
    // axis は「今描いている道路」の向き。交差する側の道路を調べる
    let hw = 0;
    let sw = 0;
    for (const r of this.roads) {
      if (r.axis === axis) continue;
      if (axis === 'h' && r.line === x && (r.a === z || r.b === z)) {
        hw = Math.max(hw, ROAD[r.kind].hw);
        sw = Math.max(sw, ROAD[r.kind].sw);
      }
      if (axis === 'v' && r.line === z && (r.a === x || r.b === x)) {
        hw = Math.max(hw, ROAD[r.kind].hw);
        sw = Math.max(sw, ROAD[r.kind].sw);
      }
    }
    return { hw, sw };
  }

  private buildRoads() {
    const b = this.b;
    for (const r of this.roads) {
      const { hw } = ROAD[r.kind];
      const len = r.b - r.a;
      const mid = (r.a + r.b) / 2;
      const rot = r.axis === 'h' ? Math.PI / 2 : 0; // 'flat' の d 方向を道路の向きに
      const [x, z] = r.axis === 'h' ? [mid, r.line] : [r.line, mid];
      const color = r.kind === 'rural' ? '#8d8673' : '#62656c';
      b.flat('road', x, 0.006, z, hw * 2, len + hw * 2, color, rot);
      if (r.kind === 'rural') continue;

      // 交差点付近の余白
      const startP = r.axis === 'h' ? this.crossHW('h', r.a, r.line) : this.crossHW('v', r.line, r.a);
      const endP = r.axis === 'h' ? this.crossHW('h', r.b, r.line) : this.crossHW('v', r.line, r.b);
      const m0 = startP.hw + startP.sw + 4.5;
      const m1 = endP.hw + endP.sw + 4.5;
      const s0 = r.a + m0;
      const s1 = r.b - m1;
      const put = (along: number, across: number, w: number, l: number, col: string) => {
        const [px, pz] = r.axis === 'h' ? [along, r.line + across] : [r.line + across, along];
        b.flat('mark', px, 0.012, pz, w, l, col, rot);
      };
      if (r.kind === 'avenue') {
        put((s0 + s1) / 2, -0.18, 0.14, s1 - s0, '#e5c04a');
        put((s0 + s1) / 2, 0.18, 0.14, s1 - s0, '#e5c04a');
        for (const off of [-3.5, 3.5]) for (let t = s0; t < s1 - 3; t += 8) put(t + 1.5, off, 0.14, 3, '#efefef');
      } else {
        for (let t = s0; t < s1 - 3; t += 7) put(t + 1.5, 0, 0.14, 3, '#efefef');
      }
      // 端の白線
      put((s0 + s1) / 2, -hw + 0.4, 0.14, s1 - s0, '#d8d8d8');
      put((s0 + s1) / 2, hw - 0.4, 0.14, s1 - s0, '#d8d8d8');
      // 横断歩道（しま模様）
      for (const [end, p, dir] of [
        [r.a, startP, 1],
        [r.b, endP, -1],
      ] as const) {
        if (p.hw === 0) continue;
        const center = end + dir * (p.hw + Math.max(p.sw, 1.5) / 2);
        for (let a = -hw + 0.6; a <= hw - 0.6; a += 0.95) put(center, a, 0.48, 3.2, '#f2f2f2');
      }
    }
  }

  /** 大通りの交差点に信号機を立てる */
  private buildTrafficLights() {
    const b = this.b;
    if (!b.hasModel('roads/traffic-light')) return;
    const size = b.modelSize('roads/traffic-light')!;
    const s = 4.4 / size.y;
    const hwAt = (axis: 'h' | 'v', X: number, Z: number) => {
      let hw = 0;
      let avenue = false;
      for (const r of this.roads) {
        if (r.axis !== axis) continue;
        const along = axis === 'h' ? X : Z;
        const line = axis === 'h' ? Z : X;
        if (r.line === line && (r.a === along || r.b === along)) {
          hw = Math.max(hw, ROAD[r.kind].hw);
          if (r.kind === 'avenue') avenue = true;
        }
      }
      return { hw, avenue };
    };
    for (const X of LINES) {
      for (const Z of LINES) {
        const h = hwAt('h', X, Z);
        const v = hwAt('v', X, Z);
        if (!(h.avenue || v.avenue) || h.hw === 0 || v.hw === 0) continue;
        for (const [sx, sz] of [
          [1, 1],
          [-1, 1],
          [1, -1],
          [-1, -1],
        ]) {
          const px = X + sx * (v.hw + 1.1);
          const pz = Z + sz * (h.hw + 1.1);
          if (Math.abs(px) > HALF || Math.abs(pz) > HALF) continue;
          const y = this.groundHeight(px, pz);
          b.model('roads/traffic-light', px, y, pz, Math.atan2(X - px, Z - pz), s, { collide: 'none' });
          this.game.physics.staticCylinder(px, y + 1.5, pz, 1.5, 0.12);
        }
      }
    }
  }

  private buildBorders() {
    const b = this.b;
    const rng = this.rng;
    // 見えない壁
    const W = WORLD + 2;
    this.game.physics.staticBox(0, 150, -W, W + 10, 300, 1);
    this.game.physics.staticBox(0, 150, W, W + 10, 300, 1);
    this.game.physics.staticBox(-W, 150, 0, 1, 300, W + 10);
    this.game.physics.staticBox(W, 150, 0, 1, 300, W + 10);
    // 遠景の山
    for (let i = 0; i < 46; i++) {
      const ang = (i / 46) * Math.PI * 2 + rng.range(-0.05, 0.05);
      const r = rng.range(1750, 1950);
      const h = rng.range(220, 420);
      const s = rng.range(420, 640);
      b.batch.add('cone', WorldBuilder.mat(Math.cos(ang) * r, -2, Math.sin(ang) * r, rng.range(0, 6), s, h, s), rng.pick(['#4f7a52', '#5b8459', '#46704c', '#6b8a64']));
    }
    void LINES;
  }
}
