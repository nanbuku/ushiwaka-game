import * as THREE from 'three';
import { G, groups, RAPIER } from '../core/Physics';
import type { VehicleKind } from '../vehicles/VehicleModel';
import type { WeaponId } from '../gameplay/Weapons';
import type { World } from './World';

/** 拡張したマップの端（見えない壁）。元の町は ±300m */
export const EDGE = 640;
/** ここより北が山岳地帯 */
const MT_Z = -310;

const sm = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** 平らにする範囲（秘密基地の谷・山道）への近さ 0〜1 */
function flatness(x: number, z: number) {
  const bx = Math.max(0, Math.abs(x) - 175);
  const bz = Math.max(0, Math.abs(z + 500) - 95);
  const base = 1 - sm(Math.hypot(bx, bz) / 40);
  const road = z > -430 ? 1 - sm(Math.max(0, Math.abs(x) - 12) / 25) : 0;
  return Math.max(base, road);
}

/** 山岳地帯の地面の高さ（それ以外は 0） */
export function terrainHeight(x: number, z: number) {
  if (z > MT_Z) return 0;
  const t = sm((MT_Z - z) / 110);
  const n = Math.sin(x * 0.011) * Math.cos(z * 0.013) + 0.6 * Math.sin(x * 0.027 + 1.3) * Math.sin(z * 0.021 + 0.7) + 0.3 * Math.sin((x + z) * 0.05);
  const h = t * (36 + 26 * n + 0.1 * (MT_Z - z));
  return Math.max(0, h * (1 - flatness(x, z)));
}

export type OutDistrict = 'mountain' | 'airport' | 'highrise' | 'lake';

/** 元の町の外側の地区 */
export function outDistrict(x: number, z: number): OutDistrict | null {
  if (Math.abs(x) <= 300 && Math.abs(z) <= 300) return null;
  if (z < -300) return 'mountain';
  if (z > 300) return 'airport';
  return x > 0 ? 'highrise' : 'lake';
}

/**
 * 町の外側の4つのエリアを作る。
 * 北: 山岳地帯（起伏のある地形・山道・秘密基地と滑走路） 南: 空港と港
 * 東: 超高層ビル街 西: 湖とゴルフ場
 */
export function buildOutskirts(w: World) {
  const b = w.b;
  const rng = w.rng;
  const veh = (x: number, z: number, yaw: number, kind: VehicleKind) => w.vehicleSpots.push({ x, y: terrainHeight(x, z), z, yaw, kind });
  const wep = (id: WeaponId | 'vest', x: number, z: number) => w.weaponSpots.push({ id, x, y: 0, z });

  // ---------- 北: 山岳地帯 ----------
  const W = EDGE * 2;
  const D = EDGE + MT_Z;
  const nx = 256;
  const nz = 66;
  const heights = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nx; j++) for (let i = 0; i <= nz; i++) heights[j * (nz + 1) + i] = terrainHeight(-EDGE + (j / nx) * W, -EDGE + (i / nz) * D);
  const zc = -EDGE + D / 2;
  w.physics.world.createCollider(RAPIER.ColliderDesc.heightfield(nz, nx, heights, { x: W, y: 1, z: D }).setTranslation(0, 0, zc).setCollisionGroups(groups(G.STATIC, G.ALL)), w.physics.staticBody);
  const geo = new THREE.PlaneGeometry(W, D, nx, nz).rotateX(-Math.PI / 2).translate(0, 0, zc);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const cols: number[] = [];
  const grass = new THREE.Color('#6f9c4c');
  const dark = new THREE.Color('#4f7a3a');
  const rock = new THREE.Color('#8a857a');
  const snow = new THREE.Color('#eef1f4');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    c.copy(grass).lerp(dark, sm(h / 25)).lerp(rock, sm((h - 30) / 25)).lerp(snow, sm((h - 85) / 15));
    if (flatness(x, z) > 0.6 && h < 1) c.set('#8f8c80');
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  terrain.receiveShadow = true;
  b.extras.add(terrain);
  for (let k = 0; k < 170; k++) {
    const x = rng.range(-EDGE + 10, EDGE - 10);
    const z = rng.range(-EDGE + 10, MT_Z - 15);
    if (flatness(x, z) > 0.15) continue;
    b.tree(x, z, terrainHeight(x, z) - 0.3, rng.range(1.1, 1.8), 'pine');
  }
  // 山道（町の北の道から基地へ）
  b.flat('road', 0, 0.03, -365, 14, 110, '#55585e');
  // グレイハートの秘密基地（谷の中）と滑走路
  b.flat('ground', 0, 0.02, -500, 350, 190, '#8d8f86');
  b.flat('road', 0, 0.04, -545, 330, 34, '#3c3e44');
  for (let x = -150; x <= 150; x += 22) b.flat('mark', x, 0.05, -545, 10, 0.9, '#ffffff');
  for (const hx of [-125, -70, 80]) b.building(hx, -450, 0, 40, 28, 13, '#6f7a6a', 0, 'house');
  b.cyl(150, 0, -470, 2.6, 22, '#9aa3a8');
  b.box('glass', 150, 22, -470, 8, 4, 8, '#9fc6e0', 0, false);
  for (const [x1, z1, x2, z2] of [[-176, -406, -16, -406], [16, -406, 176, -406], [-176, -406, -176, -596], [176, -406, 176, -596], [-176, -596, 176, -596]]) b.wall(x1, z1, x2, z2, 0, 3.2, 0.3, '#7d7f80');
  b.sign('グレイハート 秘密基地　関係者以外立入禁止', 0, 4.2, -405.5, 0, 16, 1.3, '#2a2d33', '#ffd23f', true);
  veh(-70, -545, Math.PI / 2, 'jet');
  veh(-20, -522, Math.PI / 2, 'jet');
  veh(40, -522, Math.PI / 2, 'jet');
  veh(-150, -500, 0, 'tank');
  wep('missile', 110, -470);
  wep('vest', 118, -470);
  w.landmarks.base = new THREE.Vector3(0, 0, -500);

  // ---------- 南: ひだまり空港と港 ----------
  b.flat('road', 0, 0.03, 370, 14, 140, '#55585e');
  b.flat('ground', 0, 0.02, 470, 760, 250, '#a9aba5');
  b.flat('road', 0, 0.04, 525, 600, 48, '#3a3c42');
  for (let x = -270; x <= 270; x += 30) b.flat('mark', x, 0.05, 525, 14, 1, '#ffffff');
  for (const ez of [502.5, 547.5]) b.flat('mark', 0, 0.05, ez, 600, 0.8, '#f2f2f2');
  b.flat('road', 0, 0.04, 455, 560, 18, '#4a4c52');
  b.building(-150, 362, 0, 160, 28, 17, '#d5dde3', 0, 'office');
  b.sign('ひだまり空港　HIDAMARI AIRPORT', -150, 13.5, 376.1, 0, 30, 2.4, '#1f4e8c', '#ffffff', true);
  b.cyl(120, 0, 372, 3.2, 32, '#e8e8e8');
  b.box('glass', 120, 32, 372, 10, 4.5, 10, '#9fc6e0', 0, false);
  b.building(290, 385, 0, 70, 44, 17, '#8a949c', 0, 'house');
  // 旅客機（飾り）
  const plane = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.4 });
  const blue = new THREE.MeshStandardMaterial({ color: '#2f6db5', roughness: 0.5 });
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    plane.add(mesh);
    return mesh;
  };
  add(new THREE.CylinderGeometry(2.4, 2.4, 34, 18).rotateZ(Math.PI / 2), white, 0, 3.8, 0);
  add(new THREE.SphereGeometry(2.4, 18, 12).scale(1.6, 1, 1), white, 17, 3.8, 0);
  add(new THREE.ConeGeometry(2.4, 7, 18).rotateZ(Math.PI / 2), white, -20.5, 4.2, 0);
  add(new THREE.BoxGeometry(7, 0.4, 36), white, 1, 3, 0);
  add(new THREE.BoxGeometry(5, 7, 0.4), blue, -21, 8, 0);
  add(new THREE.BoxGeometry(3, 0.3, 12), white, -21, 5, 0);
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(1, 1, 4, 14).rotateZ(Math.PI / 2), blue, 2, 2, s * 8);
  plane.position.set(-40, 0, 420);
  b.extras.add(plane);
  w.physics.staticBox(-40, 3.8, 420, 18, 2.4, 2.4);
  veh(140, 470, -Math.PI / 2, 'jet');
  veh(175, 470, -Math.PI / 2, 'jet');
  veh(-330, 400, 0, 'balloon');
  veh(-350, 425, 0, 'balloon');
  veh(-305, 430, 0, 'balloon');
  // 港
  b.flat('water', 0, 0.05, 612, W, 56, '#3f7fb3');
  w.waters.push({ x: 0, z: 612, rx: EDGE + 20, rz: 30, y: 0.05 });
  for (let k = 0; k < 14; k++) b.box('plain', 200 + (k % 7) * 7, (k >= 7 ? 2.6 : 0), 578, 6, 2.6, 2.4, rng.pick(['#3d6b9a', '#a63d3d', '#5c8a3d', '#c99a2e', '#7a4fa3']));
  b.box('plain', -200, 0, 590, 10, 0.5, 40, '#8a6a4a');
  w.landmarks.airport = new THREE.Vector3(0, 0, 470);

  // ---------- 東: 超高層ビル街 ----------
  b.flat('ground', 470, 0.02, 0, 300, 600, '#b9b8b2');
  for (const ax of [330, 410, 490, 570]) b.flat('road', ax, 0.03, 0, 18, 600, '#55585e');
  for (const az of [-200, -100, 0, 100, 200]) b.flat('road', 480, 0.03, az, 320, 18, '#55585e');
  const GLASS = ['#7f93a6', '#9fb3c4', '#5f7387', '#b9c4cc', '#6d7d8f', '#8aa0b4'];
  for (const bx of [370, 450, 530, 605]) {
    for (let bz = -250; bz <= 250; bz += 100) {
      const bw = bx === 605 ? 40 : 56;
      const h = rng.range(60, bz === -50 || bz === 50 ? 230 : 160);
      b.building(bx, bz, 0, bw, 76, h, rng.pick(GLASS), 0, 'office');
    }
  }
  for (let z = -280; z <= 280; z += 40) {
    b.lamp(320, z, 0, -Math.PI / 2);
    b.lamp(500, z, 0, Math.PI / 2);
  }
  b.sign('超高層ビル街', 330, 6, -290, 0, 10, 1.5, '#1b1b2f', '#5ff2ff', true);

  // ---------- 西: 湖とゴルフ場 ----------
  b.disc(-475, 0.02, 0, 122, 182, '#d8c9a0');
  b.disc(-475, 0.04, 0, 110, 170, '#4a8fc4', true);
  w.waters.push({ x: -475, z: 0, rx: 112, rz: 172, y: 0.04 });
  b.building(-350, -20, 0, 12, 10, 4.5, '#a0785a', Math.PI / 2, 'house');
  b.box('plain', -366, 0, -20, 18, 0.4, 3, '#8a6a4a');
  for (const [gx, gz] of [[-420, -250], [-560, -240], [-400, 250], [-570, 255]]) {
    b.disc(gx, 0.03, gz, 14, 10, '#8fd16e');
    b.cyl(gx + 3, 0, gz, 0.05, 3, '#f4f4f4', false);
    b.box('plain', gx + 3.5, 2.4, gz, 1, 0.6, 0.05, '#e63946', 0, false);
  }
  for (let k = 0; k < 90; k++) {
    const ang = rng.range(0, Math.PI * 2);
    const x = -475 + Math.cos(ang) * rng.range(135, 160);
    const z = Math.sin(ang) * rng.range(195, 290);
    if (Math.abs(x) < 315 || Math.abs(x) > EDGE - 8 || Math.abs(z) > 295) continue;
    b.tree(x, z, 0, rng.range(1, 1.6), rng.pick(['round', 'round', 'sakura', 'pine'] as const));
  }
  veh(-340, 60, 0, 'balloon');
  w.landmarks.lake = new THREE.Vector3(-475, 0, 0);
}

/** 地図に外側のエリアを描く（1px = 1m、tx は座標→ピクセル） */
export function drawOutskirts(ctx: CanvasRenderingContext2D, tx: (v: number) => number) {
  for (let x = -EDGE; x < EDGE; x += 8) {
    for (let z = -EDGE; z < MT_Z; z += 8) {
      const h = terrainHeight(x + 4, z + 4);
      ctx.fillStyle = h < 2 ? '#8f8c80' : h < 30 ? '#7fa75c' : h < 80 ? '#9a9586' : '#e6e9ec';
      ctx.fillRect(tx(x), tx(z), 8, 8);
    }
  }
  ctx.fillStyle = '#3c3e44';
  ctx.fillRect(tx(-165), tx(-562), 330, 34);
  ctx.fillRect(tx(-300), tx(501), 600, 48);
  ctx.fillStyle = '#a9aba5';
  ctx.fillRect(tx(-380), tx(345), 760, 100);
  ctx.fillStyle = '#c9ccd2';
  ctx.fillRect(tx(320), tx(-300), EDGE - 320, 600);
  ctx.fillStyle = '#7f93a6';
  for (const bx of [370, 450, 530, 605]) for (let bz = -250; bz <= 250; bz += 100) ctx.fillRect(tx(bx - 25), tx(bz - 38), 50, 76);
  ctx.fillStyle = '#55585e';
  ctx.fillRect(tx(-7), tx(-420), 14, 120);
  ctx.fillRect(tx(-7), tx(300), 14, 140);
}
