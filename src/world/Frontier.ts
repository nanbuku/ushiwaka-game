import * as THREE from 'three';
import { G, groups, RAPIER } from '../core/Physics';
import type { VehicleKind } from '../vehicles/VehicleModel';
import { EDGE, WORLD } from './Outskirts';
import type { World } from './World';

const sm = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** 高さが決まった平らな場所（空母の甲板・坂）。乗り物の高さに使う */
export interface Platform {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h0: number;
  h1: number;
}

export const CARRIER = { x: 900, z: -150, hw: 30, hl: 140, h: 14 };
export const ISLE = { x: 1000, z: 300, r: 150 };
const RANGE = { x: -970, z: 460 };
const MESAS: [number, number, number, number][] = [
  [-820, -150, 45, 38],
  [-1000, 140, 60, 52],
  [-760, 560, 35, 30],
  [-1090, -230, 50, 46],
  [-900, 980, 70, 40],
  [-1110, 760, 40, 60],
  [-700, 900, 45, 34],
];

/** 砂漠の演習場・道路は平ら */
function desertFlat(x: number, z: number) {
  const bx = Math.max(0, Math.abs(x - RANGE.x) - 150);
  const bz = Math.max(0, Math.abs(z - RANGE.z) - 180);
  const range = 1 - sm(Math.hypot(bx, bz) / 30);
  const road1 = x > -990 ? 1 - sm(Math.max(0, Math.abs(z - 40) - 8) / 20) : 0;
  const road2 = z > 30 && z < 300 ? 1 - sm(Math.max(0, Math.abs(x - RANGE.x) - 8) / 20) : 0;
  return Math.max(range, road1, road2);
}

/** 西の砂漠（砂丘とテーブル状の岩山） */
export function desertHeight(x: number, z: number) {
  let h = 2.4 + 2.0 * Math.sin(x * 0.031 + Math.cos(z * 0.013) * 2) * Math.sin(z * 0.027) + 1.2 * Math.sin((x - z) * 0.05);
  for (const [mx, mz, r, mh] of MESAS) h = Math.max(h, mh * sm((r - Math.hypot(x - mx, z - mz)) / 9));
  h *= sm((-x - EDGE) / 60);
  return Math.max(0, h * (1 - desertFlat(x, z)));
}

/** 東の海に浮かぶ島 */
export function islandHeight(x: number, z: number) {
  const d = Math.hypot(x - ISLE.x, z - ISLE.z);
  if (d > ISLE.r) return 0;
  const k = 1 - d / ISLE.r;
  return Math.max(0, 26 * sm(k * 1.6) + 4 * Math.sin(x * 0.05) * k - 1.5);
}

/** 海（東と南）か */
export function isOcean(x: number, z: number) {
  if (x > 700 && z > -310) {
    if (Math.abs(z + 60) < 7 && x < 800) return false;
    if (islandHeight(x, z) > 0.3) return false;
    if (Math.abs(x - CARRIER.x) < CARRIER.hw + 1 && Math.abs(z - CARRIER.z) < CARRIER.hl + 1) return false;
    return true;
  }
  return z > 640 && x > -EDGE;
}

/** 高さを関数で決めた地形（当たり判定＋見た目）をつくる */
function heightPatch(w: World, x0: number, x1: number, z0: number, z1: number, step: number, fn: (x: number, z: number) => number, color: (h: number, x: number, z: number) => THREE.Color) {
  const W = x1 - x0;
  const D = z1 - z0;
  const nx = Math.round(W / step);
  const nz = Math.round(D / step);
  const heights = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nx; j++) for (let i = 0; i <= nz; i++) heights[j * (nz + 1) + i] = fn(x0 + (j / nx) * W, z0 + (i / nz) * D);
  w.physics.world.createCollider(RAPIER.ColliderDesc.heightfield(nz, nx, heights, { x: W, y: 1, z: D }).setTranslation(x0 + W / 2, 0, z0 + D / 2).setCollisionGroups(groups(G.STATIC, G.ALL)), w.physics.staticBody);
  const geo = new THREE.PlaneGeometry(W, D, nx, nz).rotateX(-Math.PI / 2).translate(x0 + W / 2, 0, z0 + D / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const cols: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = fn(x, z);
    pos.setY(i, h);
    const c = color(h, x, z);
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  mesh.receiveShadow = true;
  w.b.extras.add(mesh);
}

/**
 * さらに外側の大きなエリア（約2.4km 四方）。
 * 北: 雪をかぶった高い山々（山頂に電波塔） 東: 砂浜と海、島の研究所、空母
 * 西: 砂漠（岩山・演習場・ゴーストタウン） 南: 大海原
 */
export function buildFrontier(w: World) {
  const b = w.b;
  const rng = w.rng;
  const veh = (x: number, y: number, z: number, yaw: number, kind: VehicleKind) => w.vehicleSpots.push({ x, y, z, yaw, kind });
  const sand = new THREE.Color('#e3cf9b');
  const sandDark = new THREE.Color('#c9a96e');
  const rock = new THREE.Color('#b0714a');
  const grass = new THREE.Color('#6f9c4c');

  // ---------- 東: 砂浜と海 ----------
  b.flat('ground', 670, 0.012, 165, 60, 950, '#e2d3a6');
  b.flat('water', 950, 0.05, 445, 500, 1510, '#2f74ad');
  b.flat('water', 30, 0.05, 920, 1340, 560, '#2f74ad');
  for (let k = 0; k < 40; k++) b.tree(rng.range(645, 690), rng.range(-300, 630), 0, rng.range(1, 1.5), 'round');
  // 島（グレイハート第二研究所と灯台）
  heightPatch(w, ISLE.x - ISLE.r, ISLE.x + ISLE.r, ISLE.z - ISLE.r, ISLE.z + ISLE.r, 5, islandHeight, (h) => (h < 2.5 ? sand.clone() : grass.clone().lerp(new THREE.Color('#4f7a3a'), Math.min(1, h / 30))));
  const top = islandHeight(ISLE.x, ISLE.z);
  b.building(ISLE.x, ISLE.z, top - 0.5, 34, 26, 12, '#4d535c', 0, 'office');
  b.sign('グレイハート 第二研究所', ISLE.x, top + 9, ISLE.z + 13.1, 0, 14, 1.6, '#2a2d33', '#d8d8e0', true);
  b.cyl(ISLE.x + 118, islandHeight(ISLE.x + 118, ISLE.z - 40), ISLE.z - 40, 2.2, 24, '#f4f4f4');
  b.box('lamp', ISLE.x + 118, islandHeight(ISLE.x + 118, ISLE.z - 40) + 24, ISLE.z - 40, 3, 2.5, 3, '#fff2b0', 0, false);
  for (let k = 0; k < 30; k++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(40, 110);
    const x = ISLE.x + Math.cos(a) * r;
    const z = ISLE.z + Math.sin(a) * r;
    b.tree(x, z, islandHeight(x, z) - 0.2, rng.range(1, 1.4), 'round');
  }
  veh(ISLE.x - 30, top, ISLE.z - 25, 0, 'heli');
  // 空母（甲板の高さ 14m、浜からの道と坂で上がれる）
  const C = CARRIER;
  b.box('plain', C.x, 0, C.z, C.hw * 2, C.h, C.hl * 2, '#5c636b');
  b.flat('road', C.x, C.h + 0.02, C.z, C.hw * 2 - 4, C.hl * 2 - 4, '#3d4148');
  for (let z = C.z - C.hl + 10; z < C.z + C.hl - 10; z += 20) b.flat('mark', C.x - 6, C.h + 0.04, z, 0.8, 10, '#ffffff');
  b.flat('mark', C.x - 6, C.h + 0.04, C.z, 0.5, C.hl * 2 - 8, '#ffd23f');
  b.box('plain', C.x + 22, C.h, C.z + 40, 10, 18, 26, '#6b737b');
  b.box('glass', C.x + 22, C.h + 13, C.z + 40, 10.4, 2.5, 26.4, '#9fc6e0', 0, false);
  b.sign('空母 しらゆき', C.x + 16.9, C.h + 9, C.z + 40, -Math.PI / 2, 10, 1.6, '#2a2d33', '#ffffff', true);
  w.platforms.push({ x0: C.x - C.hw, x1: C.x + C.hw, z0: C.z - C.hl, z1: C.z + C.hl, h0: C.h, h1: C.h });
  // 坂（x 800→870 で 0→14m）と、浜からの道
  const len = Math.hypot(70, C.h);
  const ang = Math.atan2(C.h, 70);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang);
  const rc = new THREE.Vector3(835 + 0.4 * Math.sin(ang), C.h / 2 - 0.4 * Math.cos(ang), -60);
  w.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, 0.4, 7).setTranslation(rc.x, rc.y, rc.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(groups(G.STATIC, G.ALL)), w.physics.staticBody);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, 14), new THREE.MeshStandardMaterial({ color: '#6b6e75', roughness: 0.8 }));
  ramp.position.copy(rc);
  ramp.quaternion.copy(q);
  ramp.receiveShadow = true;
  b.extras.add(ramp);
  w.platforms.push({ x0: 800, x1: 870, z0: -67, z1: -53, h0: 0, h1: C.h });
  b.flat('road', 750, 0.07, -60, 100, 14, '#6b6e75');
  for (const [x, z] of [[888, -250], [905, -222], [888, -194]]) veh(x, C.h, z, 0, 'jet');
  veh(912, C.h, -110, Math.PI, 'heli');
  w.landmarks.carrier = new THREE.Vector3(C.x, C.h, C.z);
  w.landmarks.island = new THREE.Vector3(ISLE.x, top, ISLE.z);

  // ---------- 西: 砂漠 ----------
  const X0 = -WORLD;
  const X1 = -EDGE;
  heightPatch(w, X0, X1, -310, WORLD, 6, desertHeight, (h, x, z) => {
    if (desertFlat(x, z) > 0.7 && h < 1) return new THREE.Color('#bda57a');
    return sand.clone().lerp(sandDark, Math.min(1, h / 6)).lerp(rock, sm((h - 8) / 10));
  });
  b.flat('road', -805, 0.04, 40, 330, 14, '#6a6258');
  b.flat('road', RANGE.x, 0.04, 165, 14, 250, '#6a6258');
  // 防衛隊の演習場（爆撃目標・掩体・監視塔）
  b.flat('ground', RANGE.x, 0.03, RANGE.z, 300, 360, '#bda57a');
  for (const [tx, tz] of [[-1040, 380], [-900, 560], [-980, 620]]) {
    for (let r = 4; r >= 1; r--) b.disc(tx, 0.04 + (5 - r) * 0.004, tz, r * 6, r * 6, r % 2 ? '#d62828' : '#f4f1de');
  }
  for (let k = 0; k < 6; k++) b.building(-1080 + k * 40, 300, 0, 14, 10, 4, '#8d8577', 0, 'house');
  for (const [x, z] of [[-1100, 620], [-840, 300]]) {
    b.cyl(x, 0, z, 0.3, 10, '#5a5048');
    b.box('plain', x, 10, z, 4, 3, 4, '#6b5f52');
  }
  veh(-930, 0, 330, 0, 'tank');
  veh(-1000, 0, 330, 0, 'tank');
  veh(-880, 0, 420, Math.PI / 2, 'heli');
  b.sign('防衛隊 西部演習場', RANGE.x, 3, 284, 0, 12, 1.5, '#4f5a38', '#ffffff', true);
  // ゴーストタウン
  for (let k = 0; k < 10; k++) {
    const x = -1000 + (k % 5) * 26;
    const z = -60 + Math.floor(k / 5) * 34;
    b.building(x, z, desertHeight(x, z) - 0.3, rng.range(10, 16), rng.range(9, 13), rng.range(4, 8), rng.pick(['#c9a97a', '#b8946a', '#d6bf94']), 0, 'house');
  }
  // サボテン
  for (let k = 0; k < 160; k++) {
    const x = rng.range(X0 + 10, X1 - 20);
    const z = rng.range(-300, WORLD - 10);
    const h = desertHeight(x, z);
    if (h > 7 || desertFlat(x, z) > 0.3) continue;
    const s = rng.range(0.7, 1.3);
    b.cyl(x, h - 0.2, z, 0.32 * s, 3.4 * s, '#4f7d3a');
    if (rng.chance(0.6)) b.cyl(x + 0.5 * s, h + 1.4 * s, z, 0.2 * s, 1.3 * s, '#4f7d3a', false);
  }
  w.landmarks.range = new THREE.Vector3(RANGE.x, 0, RANGE.z);

  // ---------- 北: 雪山の頂上に電波塔 ----------
  let best = { x: 0, z: -1000, h: 0 };
  for (let x = -1100; x <= 1100; x += 25) for (let z = -1150; z <= -700; z += 25) {
    const h = w.groundHeight(x, z);
    if (h > best.h) best = { x, z, h };
  }
  b.cyl(best.x, best.h - 1, best.z, 0.7, 34, '#d0d0d0');
  b.box('lamp', best.x, best.h + 33, best.z, 1.2, 1.2, 1.2, '#ff3030', 0, false);
  b.box('plain', best.x + 6, best.h - 0.5, best.z, 8, 4, 6, '#a7a39b');
  veh(best.x - 10, best.h, best.z + 8, 0, 'heli');
  w.landmarks.summit = new THREE.Vector3(best.x, best.h, best.z);
}

/** 地図に描く */
export function drawFrontier(ctx: CanvasRenderingContext2D, tx: (v: number) => number) {
  ctx.fillStyle = '#3f86c4';
  ctx.fillRect(tx(700), tx(-310), WORLD - 700, WORLD + 310);
  ctx.fillRect(tx(-EDGE), tx(640), WORLD + EDGE, WORLD - 640);
  ctx.fillStyle = '#e2d3a6';
  ctx.fillRect(tx(640), tx(-310), 60, 950);
  for (let x = -WORLD; x < -EDGE; x += 8) {
    for (let z = -310; z < WORLD; z += 8) {
      const h = desertHeight(x + 4, z + 4);
      ctx.fillStyle = h < 1 ? '#d9c08e' : h < 8 ? '#e3cf9b' : '#b0714a';
      ctx.fillRect(tx(x), tx(z), 8, 8);
    }
  }
  for (let x = ISLE.x - ISLE.r; x < ISLE.x + ISLE.r; x += 6) {
    for (let z = ISLE.z - ISLE.r; z < ISLE.z + ISLE.r; z += 6) {
      const h = islandHeight(x, z);
      if (h <= 0.3) continue;
      ctx.fillStyle = h < 2.5 ? '#e3cf9b' : '#6f9c4c';
      ctx.fillRect(tx(x), tx(z), 6, 6);
    }
  }
  ctx.fillStyle = '#5c636b';
  ctx.fillRect(tx(CARRIER.x - CARRIER.hw), tx(CARRIER.z - CARRIER.hl), CARRIER.hw * 2, CARRIER.hl * 2);
  ctx.fillStyle = '#6a6258';
  ctx.fillRect(tx(-970), tx(33), 330, 14);
  ctx.fillRect(tx(RANGE.x - 7), tx(40), 14, 250);
  ctx.fillRect(tx(700), tx(-67), 100, 14);
}
