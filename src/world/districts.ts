import * as THREE from 'three';
import type { ItemId } from '../gameplay/Items';
import { WorldBuilder } from './Builder';
import { rectsOverlap, usable, type Lot, type Rect } from './Layout';
import type { World } from './World';
import type { VehicleKind } from '../vehicles/VehicleModel';
import type { WeaponId } from '../gameplay/Weapons';

function vehicle(w: World, x: number, y: number, z: number, yaw: number, kind: VehicleKind) {
  w.vehicleSpots.push({ x, y, z, yaw, kind });
}

function weapon(w: World, id: WeaponId, x: number, y: number, z: number) {
  w.weaponSpots.push({ id, x, y, z });
}

const WALLS = ['#f3ead8', '#e8dcc6', '#f5f1ea', '#d9cbb3', '#cfd8dc', '#f0e0d0', '#e4d4c0', '#c9d3cf', '#efe6da'];
const ROOFS = ['#8e3b32', '#3e4a5c', '#5a4a3c', '#2f5d50', '#6b2f2f', '#4a5560', '#44403c'];
const BLD = ['#c9c5bc', '#b8c2c8', '#d8d2c4', '#a9b4ba', '#cfc6b5', '#9fa9b0', '#e0dbd0', '#bcc6c2'];
const POP = ['#e8a87c', '#d4a5a5', '#a5c4d4', '#c3b1e1', '#f2d388', '#9ed8b8', '#f4a3a3', '#b5d99c', '#f0c27a'];
const CARS = ['#d8d8d8', '#2b2b2b', '#b02a2a', '#2a4fb0', '#e8e2d0', '#4a6b45', '#8a8f96'];

const L = WorldBuilder.local;

export function buildDistrictLot(w: World, lot: Lot) {
  switch (lot.district) {
    case 'town':
      return buildTown(w, lot);
    case 'city':
      return buildCity(w, lot);
    case 'downtown':
      return buildDowntown(w, lot);
    case 'civic':
      return buildCivic(w, lot);
    case 'riverside':
      return buildRiverside(w, lot);
    case 'park':
      return buildPark(w, lot);
    case 'amusement':
      return buildAmusement(w, lot);
    default:
      return buildCountry(w, lot);
  }
}

function item(w: World, id: ItemId, x: number, y: number, z: number, owner: 'none' | 'shop' | 'shrine' = 'none') {
  w.game.items.spawn(id, x, y, z, owner, w.rng.range(0, Math.PI * 2));
}

/** Kenney のビルを置く。置いたら実寸を返す */
function kenneyBuilding(w: World, x: number, z: number, y: number, bw: number, bd: number, h: number, rot: number, tallOk = true) {
  const b = w.b;
  const tall = tallOk && h > 24;
  const pool = (tall ? 'abcde'.split('').map((c) => `commercial/building-skyscraper-${c}`) : 'abcdefghijklmn'.split('').map((c) => `commercial/building-${c}`)).filter((k) => b.hasModel(k));
  if (!pool.length) return null;
  const aspect = bw / bd;
  const ranked = pool
    .map((k) => {
      const s = b.modelSize(k)!;
      return { k, diff: Math.abs(Math.log(s.x / s.z / aspect)) + w.rng.range(0, 0.35) };
    })
    .sort((p, q) => p.diff - q.diff);
  const key = ranked[0].k;
  const size = b.modelSize(key)!;
  const s = Math.min(bw / size.x, bd / size.z);
  const ky = Math.max(tall ? 0.75 : 0.85, Math.min(tall ? 2.2 : 1.35, h / (size.y * s)));
  return b.model(key, x, y, z, rot, [s, s * ky, s]);
}

// =====================================================================
// 住宅の並べ方
// =====================================================================
interface Slot {
  edge: 'n' | 's' | 'w' | 'e';
  cx: number;
  cz: number;
  rot: number;
  len: number;
  nx: number;
  nz: number;
}

function edgeSlots(a: Rect, depth: number, slotLen: number): Slot[] {
  const out: Slot[] = [];
  const mk = (edge: Slot['edge'], x0: number, z0: number, x1: number, z1: number, rot: number, nx: number, nz: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.floor(len / slotLen));
    const sl = len / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      out.push({ edge, cx: x0 + (x1 - x0) * t, cz: z0 + (z1 - z0) * t, rot, len: sl, nx, nz });
    }
  };
  mk('s', a.x0, a.z1, a.x1, a.z1, 0, 0, -1);
  mk('n', a.x0, a.z0, a.x1, a.z0, Math.PI, 0, 1);
  mk('w', a.x0, a.z0 + depth, a.x0, a.z1 - depth, -Math.PI / 2, 1, 0);
  mk('e', a.x1, a.z0 + depth, a.x1, a.z1 - depth, Math.PI / 2, -1, 0);
  return out;
}

function slotRect(s: Slot, depth: number): Rect {
  const tx = Math.abs(s.nz);
  const tz = Math.abs(s.nx);
  const xs = [s.cx - (tx * s.len) / 2, s.cx + (tx * s.len) / 2, s.cx - (tx * s.len) / 2 + s.nx * depth, s.cx + (tx * s.len) / 2 + s.nx * depth];
  const zs = [s.cz - (tz * s.len) / 2, s.cz + (tz * s.len) / 2, s.cz - (tz * s.len) / 2 + s.nz * depth, s.cz + (tz * s.len) / 2 + s.nz * depth];
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

/** 区画の外周に家を並べる */
function residential(w: World, lot: Lot, a: Rect, reserved: Rect[], special?: (s: Slot) => boolean) {
  const depth = 15;
  for (const s of edgeSlots(a, depth, 13)) {
    if (special?.(s)) continue;
    if (reserved.some((r) => rectsOverlap(r, slotRect(s, depth), 0.5))) continue;
    placeHouse(w, lot, s);
  }
}

function placeHouse(w: World, lot: Lot, s: Slot) {
  const { rng, b } = w;
  const y = lot.y;
  const hw = Math.min(11, Math.max(6.5, s.len - rng.range(2.5, 4)));
  const hd = rng.range(7, 9);
  const set = rng.range(2.6, 3.6);
  const hx = s.cx + s.nx * (set + hd / 2);
  const hz = s.cz + s.nz * (set + hd / 2);
  b.house(hx, hz, y, hw, hd, s.rot, rng.pick(WALLS), rng.pick(ROOFS), rng.chance(0.45) ? 2 : 1);
  const zf = hd / 2 + set - 0.25;
  const door = b.hasModel('suburban/building-type-a') ? 0 : hw * 0.22;
  const fence = rng.pick(['block', 'hedge', 'none', 'block', 'low'] as const);
  if (fence !== 'none') {
    const h = fence === 'block' ? 1.15 : fence === 'hedge' ? 1.0 : 0.6;
    const col = fence === 'hedge' ? '#4f8a3c' : fence === 'low' ? '#e9e5dc' : '#b8b2a6';
    const segs: [number, number][] = [
      [-s.len / 2 + 0.2, door - 0.9],
      [door + 0.9, s.len / 2 - 0.2],
    ];
    for (const [l0, l1] of segs) {
      if (l1 - l0 < 0.3) continue;
      const [x1, z1] = L(hx, hz, s.rot, l0, zf);
      const [x2, z2] = L(hx, hz, s.rot, l1, zf);
      b.wall(x1, z1, x2, z2, y, h, fence === 'hedge' ? 0.6 : 0.15, col);
    }
  }
  if (rng.chance(0.4)) {
    const [fx, fz] = L(hx, hz, s.rot, rng.range(-s.len / 2 + 1.2, door - 1.4), zf - 1.0);
    item(w, 'flower', fx, y, fz);
  }
  if (rng.chance(0.3)) {
    const [tx, tz] = L(hx, hz, s.rot, (rng.chance(0.5) ? -1 : 1) * (hw / 2 + 0.8), hd / 2 - 0.5);
    b.tree(tx, tz, y, rng.range(0.7, 1.0), rng.chance(0.25) ? 'sakura' : 'round');
  }
  if (rng.chance(0.12)) {
    const [vx, vz] = L(hx, hz, s.rot, -s.len / 2 + 1.2, zf + 0.75);
    b.vending(vx, vz, y, s.rot, rng.pick(['#c8202a', '#1f5fae', '#f4f4f4', '#2e8b57']));
  }
}

// =====================================================================
// ひだまり町（中央）
// =====================================================================
function buildTown(w: World, lot: Lot) {
  const a = usable(lot);
  if (lot.cx0 === -100 && lot.cz0 === -100) return townHome(w, lot, a);
  if (lot.cx0 === 0 && lot.cz0 === -100) return townShops(w, lot, a);
  if (lot.cx0 === -100 && lot.cz0 === 0) return townPlayground(w, lot, a);
  return townKonbini(w, lot, a);
}

/** なんくの家がある区画 */
function townHome(w: World, lot: Lot, a: Rect) {
  const { b, rng } = w;
  const y = lot.y;
  const slots = edgeSlots(a, 15, 13).filter((s) => s.edge === 's');
  let best = slots[0];
  for (const s of slots) if (Math.abs(s.cx + 40) < Math.abs(best.cx + 40)) best = s;

  residential(w, lot, a, [{ x0: a.x0 + 16, x1: a.x1 - 16, z0: a.z0 + 16, z1: a.z1 - 16 }], (s) => {
    if (s !== best && !(s.edge === best.edge && Math.abs(s.cx - best.cx) < 0.01)) return false;
    nankuHouse(w, lot, s);
    return true;
  });

  // 中庭: アパートと月極駐車場
  const cx = (a.x0 + a.x1) / 2;
  const cz = (a.z0 + a.z1) / 2;
  b.building(cx - 10, cz - 6, y, 22, 10, 6.2, '#e9dfcf', 0, 'house');
  b.box('plain', cx - 10, y + 6.2, cz - 6, 22.4, 0.3, 10.4, '#6e6a64', 0, false);
  b.sign('コーポ ひだまり', cx - 10, y + 5.3, cz - 0.98, 0, 4, 0.7, '#f7f2e8', '#6b4f3a');
  b.flat('ground', cx + 8, y + 0.006, cz + 10, 22, 14, '#5b5d61');
  for (let i = 0; i < 4; i++) {
    b.flat('mark', cx - 1.5 + i * 5, y + 0.012, cz + 10, 0.12, 5, '#eeeeee');
    if (i === 1) vehicle(w, cx + 1 + i * 5, y, cz + 10, 0, 'sedan');
    else if (rng.chance(0.65)) b.parkedCar(cx + 1 + i * 5, cz + 10, y, rng.chance(0.5) ? 0 : Math.PI, rng.pick(CARS));
  }
  for (let i = 0; i < 6; i++) b.tree(cx + rng.range(-22, 22), cz - 20 + rng.range(-3, 3), y, rng.range(0.8, 1.1));
}

function nankuHouse(w: World, lot: Lot, s: Slot) {
  const { b } = w;
  const y = lot.y;
  const hw = 10;
  const hd = 8.5;
  const set = 3.4;
  const H = 2.9;
  const T = 0.16;
  const rot = s.rot;
  const hx = s.cx + s.nx * (set + hd / 2);
  const hz = s.cz + s.nz * (set + hd / 2);
  const at = (lx: number, lz: number) => L(hx, hz, rot, lx, lz);
  const put = (key: 'plain' | 'house', lx: number, ly: number, lz: number, sw: number, sh: number, sd: number, color: string, collide = true) => {
    const [x, z] = at(lx, lz);
    b.box(key, x, y + ly, z, sw, sh, sd, color, rot, collide);
  };
  const wallC = '#fff3e3';
  // 床・壁（玄関は local x 1.6〜2.8 が開いている）
  const [fx0, fz0] = at(0, 0);
  b.flat('ground', fx0, y + 0.012, fz0, hw - 0.2, hd - 0.2, '#c9a27a', rot);
  put('house', 0, 0, -hd / 2 + T / 2, hw, H, T, wallC);
  put('house', -hw / 2 + T / 2, 0, 0, T, H, hd, wallC);
  put('house', hw / 2 - T / 2, 0, 0, T, H, hd, wallC);
  const dl = 1.6;
  const dr = 2.8;
  put('house', (-hw / 2 + dl) / 2, 0, hd / 2 - T / 2, dl + hw / 2, H, T, wallC);
  put('house', (dr + hw / 2) / 2, 0, hd / 2 - T / 2, hw / 2 - dr, H, T, wallC);
  put('house', (dl + dr) / 2, 2.15, hd / 2 - T / 2, dr - dl, H - 2.15, T, wallC);
  // 間仕切り（左が寝室、右がリビング）
  put('plain', 0.5, 0, (-hd / 2 - 0.7) / 2, 0.12, H, hd / 2 - 0.7, '#f4ebe0');
  put('plain', 0.5, 0, (0.7 + hd / 2) / 2, 0.12, H, hd / 2 - 0.7, '#f4ebe0');
  // 天井と屋根
  put('plain', 0, H, 0, hw + 0.1, 0.14, hd + 0.1, '#f7f2ea');
  b.batch.add('roof', WorldBuilder.mat(fx0, y + H + 0.14, fz0, rot, hw + 0.7, 1.3 + hw * 0.08, hd + 0.7), '#c65b4e');
  put('plain', 2.2, 0, hd / 2 + 0.6, 1.8, 0.1, 1.1, '#b9b2a6', false);

  // --- 家具（Kenney の家具があれば使う） ---
  const furn = (key: string, lx: number, lz: number, ly: number, frot: number, width: number, collide = true) => {
    if (!b.hasModel(key)) return null;
    const size = b.modelSize(key)!;
    const [x, z] = at(lx, lz);
    return b.model(key, x, y + ly, z, rot + frot, width / size.x, { collide: collide ? 'box' : 'none' });
  };
  const tvTex = w.game.news.texture;
  // リビング：テレビ（ニュースが映る）・ソファ・ちゃぶ台・キッチン
  const cab = furn('furniture/cabinetTelevision', 4.6, -1.6, 0, -Math.PI / 2, 1.6);
  const cabH = cab ? cab.h : 0.5;
  if (!cab) put('plain', 4.55, 0, -1.6, 0.5, 0.5, 1.6, '#6b4a32');
  const tv = furn('furniture/televisionModern', 4.68, -1.6, cabH, -Math.PI / 2, 1.3, false);
  if (!tv) put('plain', 4.66, cabH, -1.6, 0.1, 0.82, 1.42, '#1a1a1a', false);
  const screenH = tv ? tv.h * 0.72 : 0.73;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.18, screenH), new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false }));
  const [sx, sz] = at(tv ? 4.68 - tv.d / 2 - 0.012 : 4.6, -1.6);
  screen.position.set(sx, y + cabH + (tv ? tv.h * 0.56 : 0.41), sz);
  screen.rotation.y = rot - Math.PI / 2;
  b.extras.add(screen);
  if (!furn('furniture/loungeSofa', 2.0, -1.6, 0, Math.PI / 2, 2.1)) {
    put('plain', 2.0, 0, -1.6, 0.9, 0.42, 2.0, '#e07a8f');
    put('plain', 1.6, 0.42, -1.6, 0.22, 0.45, 2.0, '#d0687d', false);
  }
  if (!furn('furniture/tableCoffee', 3.3, -1.6, 0, Math.PI / 2, 1.1)) {
    const [cx, cz] = at(3.3, -1.6);
    b.cyl(cx, y, cz, 0.45, 0.33, '#a0784f');
  }
  if (!furn('furniture/rugRound', 3.0, -1.6, 0.016, 0, 2.8, false)) {
    const [rx, rz] = at(3.0, -1.6);
    b.flat('ground', rx, y + 0.016, rz, 3.0, 2.6, '#f4c6d4', rot);
  }
  const kitchen = ['furniture/kitchenCabinet', 'furniture/kitchenSink', 'furniture/kitchenStove'];
  if (kitchen.every((k) => b.hasModel(k))) {
    kitchen.forEach((k, i) => furn(k, 1.5 + i * 0.85, -hd / 2 + 0.42, 0, 0, 0.85));
    furn('furniture/kitchenFridge', 4.35, -hd / 2 + 0.45, 0, 0, 0.85);
  } else {
    put('plain', 2.6, 0, -hd / 2 + 0.45, 3.0, 0.9, 0.6, '#efe9df');
    put('plain', 4.4, 0, -hd / 2 + 0.45, 0.75, 1.75, 0.65, '#f5f5f5');
  }
  furn('furniture/pottedPlant', 4.5, 3.4, 0, 0, 0.55);
  furn('furniture/lampRoundFloor', 1.05, -3.2, 0, 0, 0.45);
  const [ex, ez] = at(2.2, hd / 2 - 0.8);
  b.flat('ground', ex, y + 0.018, ez, 1.6, 1.2, '#a7a39b', rot);
  put('plain', 3.6, 0, hd / 2 - 0.45, 1.0, 0.6, 0.35, '#8a6a4a');
  // 寝室：ベッド（くまのぬいぐるみ）・机・本棚
  const bed = furn('furniture/bedSingle', -3.7, -2.6, 0, 0, 1.15);
  if (!bed) {
    put('plain', -3.7, 0, -2.6, 1.5, 0.42, 2.2, '#f2efe9');
    put('plain', -3.7, 0.42, -2.3, 1.45, 0.12, 1.6, '#f6b5c8', false);
    put('plain', -3.7, 0.42, -3.4, 1.0, 0.14, 0.4, '#ffffff', false);
  }
  furn('furniture/bear', -3.75, -3.15, bed ? bed.h * 0.75 : 0.55, 0, 0.42, false);
  const desk = furn('furniture/desk', -1.1, -hd / 2 + 0.45, 0, 0, 1.3);
  if (!desk) put('plain', -1.1, 0, -hd / 2 + 0.45, 1.3, 0.72, 0.6, '#c8a27a');
  if (!furn('furniture/laptop', -1.1, -hd / 2 + 0.5, desk ? desk.h : 0.72, 0, 0.42, false)) put('plain', -1.1, 0.72, -hd / 2 + 0.45, 0.45, 0.03, 0.32, '#333333', false);
  if (!furn('furniture/chairDesk', -1.1, -hd / 2 + 1.25, 0, Math.PI, 0.55)) put('plain', -1.1, 0, -hd / 2 + 1.2, 0.45, 0.45, 0.45, '#8a6a4a');
  const shelf = furn('furniture/bookcaseOpen', -4.6, 1.4, 0, Math.PI / 2, 1.0);
  if (!shelf) {
    put('plain', -4.65, 0, 1.4, 0.45, 1.4, 1.8, '#d9c3a5');
    ['#c89f73', '#ffffff', '#f7c6d9', '#9ec9ff'].forEach((c, i) => {
      const [tx, tz] = at(-4.65, 0.75 + i * 0.45);
      b.sphere(tx, y + 1.62, tz, 0.17, c);
    });
  } else {
    furn('furniture/books', -4.6, 1.4, shelf.h * 0.52, Math.PI / 2, 0.5, false);
    furn('furniture/plantSmall1', -4.6, 1.25, shelf.h, Math.PI / 2, 0.25, false);
  }
  put('plain', -4.5, 0, 3.3, 0.7, 1.9, 1.3, '#bfa58a');
  const light = new THREE.PointLight('#ffe8c8', 4, 14, 1);
  const [lx, lz] = at(0.5, 0);
  light.position.set(lx, y + 2.5, lz);
  b.extras.add(light);
  w.zones.push({ name: 'home', rect: { x0: Math.min(at(-hw / 2, -hd / 2)[0], at(hw / 2, hd / 2)[0]), x1: Math.max(at(-hw / 2, -hd / 2)[0], at(hw / 2, hd / 2)[0]), z0: Math.min(at(-hw / 2, -hd / 2)[1], at(hw / 2, hd / 2)[1]), z1: Math.max(at(-hw / 2, -hd / 2)[1], at(hw / 2, hd / 2)[1]) } });

  // 芝生の庭と白い柵（うしわかなら飛び越えられる）
  const [gx, gz] = at(0, hd / 2 + set / 2);
  b.flat('ground', gx, y + 0.004, gz, s.len - 0.4, set, '#93c86c', rot);
  const zf = hd / 2 + set - 0.2;
  for (const [l0, l1] of [
    [-s.len / 2 + 0.2, 1.4],
    [3.2, s.len / 2 - 0.2],
  ] as const) {
    const [x1, z1] = at(l0, zf);
    const [x2, z2] = at(l1, zf);
    b.wall(x1, z1, x2, z2, y, 0.62, 0.1, '#ffffff');
  }
  const [px, pz] = at(4.4, zf + 0.06);
  b.box('plain', px, y, pz, 0.12, 1.1, 0.12, '#7a5a40', rot);
  const [nx0, nz0] = at(4.4, zf + 0.14);
  b.sign('なんく', nx0, y + 0.95, nz0, rot, 0.7, 0.28, '#fffaf0', '#b04a5a');
  for (let i = 0; i < 4; i++) {
    const [fx, fz] = at(-4 + i * 1.1, hd / 2 + 0.6);
    item(w, 'flower', fx, y, fz);
  }
  const [tx, tz] = at(-hw / 2 - 0.9, hd / 2 - 0.2);
  b.tree(tx, tz, y, 0.9, 'sakura');

  const [nx, nz] = at(3.7, hd / 2 + 1.4);
  w.nankuSpot.set(nx, y, nz);
  w.nankuYaw = rot;
  const [spx, spz] = at(3.7, hd / 2 + 2.6);
  w.spawn.set(spx, y + 0.5, spz);
  w.spawnYaw = rot + Math.PI;
  const r1 = at(-s.len / 2, -hd / 2);
  const r2 = at(s.len / 2, hd / 2 + set);
  w.homeArea = { x0: Math.min(r1[0], r2[0]), x1: Math.max(r1[0], r2[0]), z0: Math.min(r1[1], r2[1]), z1: Math.max(r1[1], r2[1]) };
}

const SHOPS: { name: string; wall: string; awning: string; items: ItemId[] }[] = [
  { name: '八百屋 やおよし', wall: '#f3e6c8', awning: '#3f8f4f', items: ['apple', 'banana', 'tomato', 'daikon'] },
  { name: '魚屋 うおまさ', wall: '#e3edf2', awning: '#2f6fa8', items: ['fish', 'fish', 'fish'] },
  { name: 'パン工房 こむぎ', wall: '#f5e3cc', awning: '#c8873f', items: ['bread', 'bread', 'bread'] },
  { name: '花屋 はなことば', wall: '#fbe9ef', awning: '#e07aa0', items: ['flower', 'flower', 'flower', 'flower'] },
  { name: '肉のたかだ', wall: '#f4e1dc', awning: '#b8433a', items: ['meat', 'meat', 'meat'] },
  { name: '和菓子 もちづき', wall: '#efe7f3', awning: '#8a6a9a', items: ['manju', 'manju', 'manju'] },
  { name: '喫茶 ねこまど', wall: '#e9dccb', awning: '#6b4a3a', items: [] },
  { name: '本屋 しおり堂', wall: '#e2e6ec', awning: '#3a5a7a', items: [] },
  { name: 'くすりのハト', wall: '#e0f2f1', awning: '#2a9d9d', items: [] },
];

/** 商店街とスーパー */
function townShops(w: World, lot: Lot, a: Rect) {
  const { b, rng } = w;
  const y = lot.y;
  // --- 商店街（西側、道路に向かって並ぶ） ---
  const fx = a.x0 + 2.6;
  SHOPS.forEach((sh, i) => {
    const zc = a.z0 + 5 + 8 * (i + 0.5);
    const rot = -Math.PI / 2;
    b.building(fx + 5, zc, y, 7.6, 10, 6.4, sh.wall, rot, 'shop');
    b.box('plain', fx - 0.7, y + 2.85, zc, 1.4, 0.18, 7.6, sh.awning, 0, false);
    b.box('plain', fx - 1.38, y + 2.55, zc, 0.06, 0.3, 7.6, sh.awning, 0, false);
    b.sign(sh.name, fx - 0.04, y + 3.85, zc, rot, 6.2, 1.0, '#fffdf6', '#3b2f2a');
    if (sh.items.length) {
      b.box('plain', fx - 1.5, y, zc - 0.8, 1.0, 0.8, 3.6, '#8a6a4a', 0);
      sh.items.forEach((id, k) => item(w, id, fx - 1.5, y + 0.8, zc - 2.2 + k * (2.8 / Math.max(1, sh.items.length - 1)), 'shop'));
      w.staticSpots.push({ x: fx - 0.7, y, z: zc + 2.4, yaw: rot, kind: 'clerk', district: 'town' });
    }
  });

  // --- スーパー まるなか（中に入れる） ---
  const sx0 = 36;
  const sx1 = 74;
  const sz0 = -72;
  const sz1 = -44;
  const H = 5.2;
  const T = 0.3;
  const mx = (sx0 + sx1) / 2;
  const mz = (sz0 + sz1) / 2;
  const W = sx1 - sx0;
  const D = sz1 - sz0;
  const wallC = '#ece6da';
  b.flat('ground', mx, y + 0.008, mz, W, D, '#efebe4');
  b.box('plain', mx, y, sz0 + T / 2, W, H, T, wallC);
  b.box('plain', sx0 + T / 2, y, mz, T, H, D, wallC);
  b.box('plain', sx1 - T / 2, y, mz, T, H, D, wallC);
  const gap = 7;
  const segW = (W - gap) / 2;
  b.box('glass', sx0 + segW / 2, y, sz1 - T / 2, segW, 3.2, T, '#a8d4f0');
  b.box('glass', sx1 - segW / 2, y, sz1 - T / 2, segW, 3.2, T, '#a8d4f0');
  b.box('plain', mx, y + 3.2, sz1 - T / 2, W, H - 3.2, T + 0.02, '#d23c3c', 0, false);
  b.box('plain', mx, y + H, mz, W + 0.6, 0.35, D + 0.6, '#b7b2a8');
  b.sign('スーパー まるなか', mx, y + 4.2, sz1 + 0.03, 0, 11, 1.5, '#d23c3c', '#ffffff', true);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) b.box('neon', sx0 + 6 + i * 9, y + H - 0.12, sz0 + 6 + k * 8, 4, 0.08, 0.6, '#ffffff', 0, false);
  w.zones.push({ name: 'supermarket', rect: { x0: sx0, x1: sx1, z0: sz0, z1: sz1 } });
  for (const lx of [mx - 9, mx + 9]) {
    const light = new THREE.PointLight('#fff4e0', 7, 26, 1);
    light.position.set(lx, y + H - 0.6, mz);
    b.extras.add(light);
  }

  // 棚（下段の商品はうしわかでも届く）
  const rows: ItemId[] = ['bread', 'banana', 'apple', 'tomato', 'manju'];
  rows.forEach((id, r) => {
    const z = sz0 + 4.5 + r * 4;
    const x0 = sx0 + 4;
    const x1 = sx1 - 9;
    const len = x1 - x0;
    const cx = (x0 + x1) / 2;
    b.box('plain', cx, y, z, len, 1.75, 0.9, '#f4f2ee');
    for (const side of [-1, 1]) {
      b.box('plain', cx, y + 0.42, z + side * 0.55, len, 0.05, 0.25, '#d9d5cc', 0, false);
      for (let k = 0; k < 5; k++) item(w, id, x0 + 1.5 + k * ((len - 3) / 4), y + 0.47, z + side * 0.56, 'shop');
      for (let k = 0; k < 7; k++) b.box('plain', x0 + 1 + k * (len / 7), y + 1.0, z + side * 0.5, 1.2, 0.5, 0.06, rng.pick(POP), 0, false);
    }
  });
  // 精肉・鮮魚の冷蔵ケース（東の壁ぎわ）
  b.box('plain', sx1 - 2, y, mz - 2, 1.4, 0.75, 18, '#dfe8ee');
  b.box('lamp', sx1 - 2.6, y + 0.76, mz - 2, 0.3, 0.05, 18, '#ffffff', 0, false);
  for (let k = 0; k < 6; k++) item(w, k % 2 ? 'fish' : 'meat', sx1 - 2, y + 0.75, mz - 10 + k * 3.2, 'shop');
  // 入口の青果台とレジ
  for (const [tx, id] of [
    [sx0 + 4, 'apple'],
    [sx0 + 9, 'banana'],
  ] as const) {
    b.box('plain', tx, y, sz1 - 3.2, 3.6, 0.8, 1.6, '#9a7350');
    for (let k = 0; k < 4; k++) item(w, id, tx - 1.2 + k * 0.8, y + 0.8, sz1 - 3.2 + (k % 2 ? 0.35 : -0.35), 'shop');
  }
  for (const rx of [sx1 - 14, sx1 - 9]) {
    b.box('plain', rx, y, sz1 - 4.2, 0.9, 0.95, 2.6, '#c9c2b4');
    w.staticSpots.push({ x: rx + 1.1, y, z: sz1 - 4.2, yaw: -Math.PI / 2, kind: 'clerk', district: 'town' });
  }

  // 駐車場
  b.flat('ground', 55, y + 0.006, -26, 42, 30, '#55575c');
  for (let i = 0; i < 8; i++) {
    b.flat('mark', 37 + i * 5, y + 0.012, -33, 0.12, 6, '#f0f0f0');
    if (i < 7 && rng.chance(0.55)) {
      if (i % 3 === 0) vehicle(w, 39.5 + i * 5, y, -33, Math.PI, rng.pick(['sedan', 'van', 'truck'] as const));
      else b.parkedCar(39.5 + i * 5, -33, y, Math.PI, rng.pick(CARS));
    }
  }
  b.cyl(36, y, -14, 0.06, 1.0, '#333333');

  // 北側の家並み・東側の小さなビル
  for (let i = 0; i < 4; i++) placeHouse(w, lot, { edge: 'n', cx: 30 + i * 14, cz: a.z0, rot: Math.PI, len: 13, nx: 0, nz: 1 });
  for (let i = 0; i < 4; i++) {
    const z = a.z0 + 20 + i * 15;
    if (!kenneyBuilding(w, a.x1 - 6, z, y, 12, 12, rng.range(9, 15), Math.PI / 2, false)) b.building(a.x1 - 6, z, y, 12, 12, rng.range(9, 15), rng.pick(BLD), Math.PI / 2, 'office');
  }
}

/** 児童公園とマンションのある区画 */
function townPlayground(w: World, lot: Lot, a: Rect) {
  const { b, rng } = w;
  const y = lot.y;
  const inner = { x0: a.x0 + 16, x1: a.x1 - 16, z0: a.z0 + 16, z1: a.z1 - 16 };
  residential(w, lot, a, [inner]);
  // マンション
  b.building(inner.x0 + 13, inner.z0 + 8, y, 24, 12, 15, '#e6e0d6', 0, 'office');
  b.sign('ひだまりハイツ', inner.x0 + 13, y + 2.4, inner.z0 + 14.05, 0, 5, 0.8, '#ffffff', '#555555');
  // 児童公園
  const px = inner.x1 - 15;
  const pz = (inner.z0 + inner.z1) / 2 + 4;
  b.flat('ground', px, y + 0.006, pz, 26, 30, '#c9b48e');
  playground(w, px, pz, y);
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    b.tree(px + Math.cos(ang) * 15, pz + Math.sin(ang) * 17, y, rng.range(0.8, 1.1), i % 3 === 0 ? 'sakura' : 'round');
  }
  item(w, 'ball', px + 3, y, pz + 4);
  for (let i = 0; i < 3; i++) item(w, 'flower', px - 8 + i, y, pz - 11);
}

/** コンビニと神社のある区画 */
function townKonbini(w: World, lot: Lot, a: Rect) {
  const { b, rng } = w;
  const y = lot.y;
  // コンビニ
  const kx = a.x0 + 11;
  const kz = a.z0 + 12;
  b.building(kx, kz, y, 16, 11, 4.4, '#f7f7f4', Math.PI, 'shop');
  b.box('plain', kx, y + 3.6, kz - 5.55, 16, 0.8, 0.1, '#3aa55c', 0, false);
  b.sign('ハッピーマート', kx, y + 4.0, kz - 5.62, Math.PI, 6, 0.75, '#ffffff', '#2f8f4f', true);
  b.box('plain', kx + 5, y, kz - 7, 1.6, 0.85, 0.8, '#d0e6f5');
  item(w, 'onigiri', kx + 4.5, y + 0.85, kz - 7, 'shop');
  item(w, 'onigiri', kx + 5.2, y + 0.85, kz - 7, 'shop');
  item(w, 'burger', kx + 5.6, y + 0.85, kz - 6.8, 'shop');
  w.staticSpots.push({ x: kx + 3.2, y, z: kz - 6.6, yaw: Math.PI, kind: 'clerk', district: 'town' });
  b.vending(kx - 7, kz - 6.2, y, Math.PI, '#c8202a');
  b.vending(kx - 5.8, kz - 6.2, y, Math.PI, '#1f5fae');
  b.trashcan(kx - 3.8, kz - 6.4, y);
  vehicle(w, kx - 2, y, kz - 8.6, Math.PI / 2, 'scooter');
  vehicle(w, kx + 1, y, kz - 8.6, Math.PI / 2, 'bicycle');
  vehicle(w, kx + 2.2, y, kz - 8.6, Math.PI / 2, 'bicycle');

  // 神社
  const sx = a.x0 + 52;
  const shrine = { x0: sx - 15, x1: sx + 15, z0: a.z1 - 50, z1: a.z1 + 1 };
  b.flat('ground', sx, y + 0.006, (shrine.z0 + shrine.z1) / 2, 30, shrine.z1 - shrine.z0, '#cdbf9d');
  b.flat('ground', sx, y + 0.01, a.z1 - 20, 3, 40, '#b5a98e');
  // 鳥居
  const tz = a.z1 - 4;
  for (const dx of [-2.3, 2.3]) b.cyl(sx + dx, y, tz, 0.22, 5.2, '#d23a2a');
  b.box('plain', sx, y + 4.6, tz, 6.6, 0.4, 0.5, '#d23a2a', 0, false);
  b.box('plain', sx, y + 5.25, tz, 7.6, 0.35, 0.6, '#2b2b2b', 0, false);
  // 社殿
  const hz = shrine.z0 + 9;
  b.box('plain', sx, y, hz, 8, 0.8, 7, '#8f8a80');
  b.box('plain', sx, y + 0.8, hz, 6, 3.2, 5, '#a8432e');
  b.batch.add('roof', WorldBuilder.mat(sx, y + 4, hz, 0, 8, 2.4, 7), '#3b3b3b');
  b.box('plain', sx, y + 0.8, hz + 3.4, 1.6, 0.9, 0.9, '#6b4a2a');
  for (let k = 0; k < 3; k++) item(w, 'manju', sx - 0.5 + k * 0.5, y + 1.7, hz + 3.4, 'shrine');
  weapon(w, 'caltrops', sx + 3, y, hz + 5);
  for (const dx of [-5, 5]) {
    b.box('plain', sx + dx, y, hz + 8, 0.6, 1.4, 0.6, '#9a958c');
    b.box('lamp', sx + dx, y + 1.4, hz + 8, 0.5, 0.35, 0.5, '#fff6d8', 0, false);
  }
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? -1 : 1;
    b.tree(sx + side * rng.range(7, 13), rng.range(shrine.z0 + 2, shrine.z1 - 6), y, rng.range(0.9, 1.3), rng.chance(0.3) ? 'sakura' : 'pine');
  }
  residential(w, lot, a, [shrine, { x0: a.x0, x1: a.x0 + 22, z0: a.z0, z1: a.z0 + 22 }]);
}

function playground(w: World, px: number, pz: number, y: number) {
  const b = w.b;
  // すべり台
  b.box('plain', px - 6, y, pz - 6, 1.6, 1.8, 1.6, '#e85d5d');
  b.box('plain', px - 6, y + 1.8, pz - 6, 1.8, 0.1, 1.8, '#f2c94c', 0, false);
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 3.6), new THREE.MeshStandardMaterial({ color: '#4aa3df', roughness: 0.4 }));
  slide.position.set(px - 6, y + 1.0, pz - 3.6);
  slide.rotation.x = 0.5;
  slide.castShadow = true;
  b.extras.add(slide);
  // ブランコ
  for (const dx of [-1.6, 1.6]) {
    b.cyl(px + 4 + dx, y, pz - 6, 0.07, 2.6, '#3d7ea6', false);
  }
  b.box('plain', px + 4, y + 2.55, pz - 6, 3.4, 0.12, 0.12, '#3d7ea6', 0, false);
  for (const dx of [-0.7, 0.7]) b.box('plain', px + 4 + dx, y + 0.5, pz - 6, 0.6, 0.06, 0.3, '#8a5a36', 0, false);
  w.physics.staticBox(px + 4, y + 1.3, pz - 6, 1.7, 1.3, 0.2);
  // 砂場
  b.flat('ground', px + 4, y + 0.02, pz + 5, 4, 4, '#e2cf9a');
  b.wall(px + 2, pz + 3, px + 6, pz + 3, y, 0.25, 0.2, '#c8c0b0');
  b.wall(px + 2, pz + 7, px + 6, pz + 7, y, 0.25, 0.2, '#c8c0b0');
  // ジャングルジム
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) b.cyl(px - 6 + i * 1.1, y, pz + 4 + k * 1.1, 0.05, 2.2, '#f2994a', false);
  for (const h of [0.7, 1.4, 2.1]) {
    b.box('plain', px - 4.9, y + h, pz + 5.1, 2.3, 0.06, 0.06, '#f2994a', 0, false);
    b.box('plain', px - 4.9, y + h, pz + 5.1, 0.06, 0.06, 2.3, '#f2994a', 0, false);
  }
  w.physics.staticBox(px - 4.9, y + 1.1, pz + 5.1, 1.2, 1.1, 1.2);
  b.bench(px, pz + 10, y, Math.PI);
  b.bench(px - 4, pz + 10, y, Math.PI);
}

// =====================================================================
// オフィス街・繁華街など（周囲にビルを並べる汎用ロジック）
// =====================================================================
function perimeterBuildings(
  w: World,
  lot: Lot,
  a: Rect,
  opt: { hMin: number; hMax: number; dMin: number; dMax: number; wMin: number; wMax: number; colors: string[]; style: 'office' | 'shop'; signs?: string[] },
) {
  const { b, rng } = w;
  const y = lot.y;
  const edges = [
    { x0: a.x0, z0: a.z1, x1: a.x1, z1: a.z1, rot: 0, nx: 0, nz: -1, skip: 0 },
    { x0: a.x0, z0: a.z0, x1: a.x1, z1: a.z0, rot: Math.PI, nx: 0, nz: 1, skip: 0 },
    { x0: a.x0, z0: a.z0, x1: a.x0, z1: a.z1, rot: -Math.PI / 2, nx: 1, nz: 0, skip: opt.dMax },
    { x0: a.x1, z0: a.z0, x1: a.x1, z1: a.z1, rot: Math.PI / 2, nx: -1, nz: 0, skip: opt.dMax },
  ];
  for (const e of edges) {
    const len = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
    const tx = (e.x1 - e.x0) / len;
    const tz = (e.z1 - e.z0) / len;
    let t = e.skip + rng.range(0, 3);
    while (t < len - e.skip - opt.wMin) {
      const bw = Math.min(rng.range(opt.wMin, opt.wMax), len - e.skip - t);
      if (bw < opt.wMin * 0.7) break;
      const bd = rng.range(opt.dMin, opt.dMax);
      const h = rng.range(opt.hMin, opt.hMax);
      const set = rng.range(0.5, 2);
      const cx = e.x0 + tx * (t + bw / 2) + e.nx * (set + bd / 2);
      const cz = e.z0 + tz * (t + bw / 2) + e.nz * (set + bd / 2);
      const placed = kenneyBuilding(w, cx, cz, y, bw, bd, h, e.rot, opt.style === 'office');
      if (!placed) b.building(cx, cz, y, bw, bd, h, rng.pick(opt.colors), e.rot, opt.style);
      const fd = placed ? placed.d : bd;
      const fh = placed ? placed.h : h;
      if (opt.signs && rng.chance(0.55) && fh > 6) {
        const [sx, sz] = L(cx, cz, e.rot, 0, fd / 2 + 0.08);
        const txt = rng.pick(opt.signs);
        b.sign(txt, sx, y + rng.range(Math.min(4.5, fh - 1.5), Math.min(fh - 1, 9)), sz, e.rot, Math.min(bw * 0.6, 5.5), 1.0, rng.pick(['#1b1b2f', '#2b0f2f', '#0f2b2f', '#3a1010']), rng.pick(['#ff5fa2', '#5ff2ff', '#ffe066', '#7dff7a', '#ff8a3d']), true);
      }
      t += bw + rng.range(2, 6);
    }
  }
}

function plaza(w: World, lot: Lot, r: Rect, sakura = false) {
  const { b, rng } = w;
  const y = lot.y;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  b.flat('ground', cx, y + 0.006, cz, r.x1 - r.x0, r.z1 - r.z0, '#d4cfc4');
  for (let i = 0; i < 10; i++) b.tree(rng.range(r.x0 + 3, r.x1 - 3), rng.range(r.z0 + 3, r.z1 - 3), y, rng.range(0.9, 1.2), sakura && rng.chance(0.5) ? 'sakura' : 'round');
  for (let i = 0; i < 5; i++) b.bench(rng.range(r.x0 + 4, r.x1 - 4), rng.range(r.z0 + 4, r.z1 - 4), y, rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]));
  b.disc(cx, y + 0.02, cz, 4, 4, '#9a958c');
  b.disc(cx, y + 0.35, cz, 3.4, 3.4, '#5fa3d8', true);
  w.physics.staticCylinder(cx, y + 0.2, cz, 0.2, 4);
}

function buildCity(w: World, lot: Lot) {
  const a = usable(lot);
  const { b, rng } = w;
  perimeterBuildings(w, lot, a, { hMin: 18, hMax: 70, dMin: 14, dMax: 22, wMin: 14, wMax: 28, colors: BLD, style: 'office' });
  const inner = { x0: a.x0 + 26, x1: a.x1 - 26, z0: a.z0 + 26, z1: a.z1 - 26 };
  if (lot.cx0 === 100 && lot.cz0 === 0) {
    // ひだまり駅
    const cx = (inner.x0 + inner.x1) / 2;
    const cz = (inner.z0 + inner.z1) / 2;
    b.building(cx, cz, lot.y, 34, 14, 9, '#d9d4c7', 0, 'shop');
    b.sign('ひだまり駅', cx, lot.y + 7.4, cz + 7.05, 0, 9, 1.4, '#1f4e8c', '#ffffff', true);
    b.flat('ground', cx, lot.y + 0.006, cz + 14, 34, 12, '#cfcac0');
    for (let i = 0; i < 3; i++) vehicle(w, cx - 10 + i * 6, lot.y, cz + 16, Math.PI / 2, 'taxi');
    for (let i = 0; i < 4; i++) vehicle(w, cx + 8 + i * 1.1, lot.y, cz + 10, 0, 'bicycle');
    vehicle(w, cx + 14, lot.y, cz + 10, 0, 'motorbike');
  } else if (lot.cx0 === 200 && lot.cz0 === -100) {
    plaza(w, lot, inner, true);
    weapon(w, 'c4', (inner.x0 + inner.x1) / 2 + 6, lot.y, (inner.z0 + inner.z1) / 2);
  } else if (rng.chance(0.5)) {
    plaza(w, lot, inner, true);
  } else {
    const cx = (inner.x0 + inner.x1) / 2;
    const cz = (inner.z0 + inner.z1) / 2;
    b.building(cx, cz, lot.y, inner.x1 - inner.x0 - 6, inner.z1 - inner.z0 - 6, rng.range(60, 110), rng.pick(['#9fb3c4', '#7f93a6', '#b9c4cc']), 0, 'office');
  }
}

const DT_SIGNS = ['カラオケ ポチ', 'ラーメン わんこ', 'ゲームセンター', '焼肉 にくきゅう', '居酒屋 しっぽ', 'ネットカフェ', 'ボウリング', 'ドラッグストア', 'ファミレス ハウンド', 'カフェ もふもふ'];

function buildDowntown(w: World, lot: Lot) {
  const a = usable(lot);
  const { b } = w;
  perimeterBuildings(w, lot, a, { hMin: 9, hMax: 30, dMin: 12, dMax: 18, wMin: 9, wMax: 18, colors: [...POP, ...BLD], style: 'shop', signs: DT_SIGNS });
  const inner = { x0: a.x0 + 22, x1: a.x1 - 22, z0: a.z0 + 22, z1: a.z1 - 22 };
  if (lot.cx0 === 200 && lot.cz0 === 200) {
    const cx = (inner.x0 + inner.x1) / 2;
    const cz = (inner.z0 + inner.z1) / 2;
    b.building(cx, cz, lot.y, inner.x1 - inner.x0 - 4, inner.z1 - inner.z0 - 4, 18, '#efe7da', 0, 'shop');
    b.sign('ショッピングモール ワンダフル', cx, lot.y + 15, inner.z1 - 1.95, 0, 20, 2.2, '#ff6f91', '#ffffff', true);
    vehicle(w, inner.x0 - 6, lot.y, inner.z1 + 6, Math.PI / 2, 'sports');
    vehicle(w, inner.x0 + 2, lot.y, inner.z1 + 6, Math.PI / 2, 'sports');
    vehicle(w, inner.x0 + 9, lot.y, inner.z1 + 6, 0, 'motorbike');
    vehicle(w, inner.x0 + 10.5, lot.y, inner.z1 + 6, 0, 'motorbike');
  } else if (lot.cx0 === 100 && lot.cz0 === 100) {
    plaza(w, lot, inner);
    // 花火屋（爆弾が買える…というか盗める）
    const fx = (inner.x0 + inner.x1) / 2;
    const fz = inner.z0 + 4;
    w.b.box('plain', fx, lot.y, fz, 5, 1.0, 2.2, '#3a2a1a');
    w.b.box('plain', fx, lot.y + 2.6, fz, 5.6, 0.25, 2.8, '#d62828', 0, false);
    for (const dx of [-2.6, 2.6]) w.b.cyl(fx + dx, lot.y, fz + 1.2, 0.06, 2.6, '#222222', false);
    w.b.sign('花火・火薬 ドカン堂', fx, lot.y + 3.1, fz + 1.42, 0, 4.6, 0.75, '#d62828', '#ffe066', true);
    for (let k = 0; k < 4; k++) item(w, 'bomb', fx - 1.8 + k * 1.2, lot.y + 1.0, fz + 0.5, 'shop');
    weapon(w, 'rocket', fx - 3.5, lot.y, fz + 2.2);
    weapon(w, 'molotov', fx + 3.5, lot.y, fz + 2.2);
    w.staticSpots.push({ x: fx + 2.2, y: lot.y, z: fz - 1.6, yaw: 0, kind: 'clerk', district: 'downtown' });
  } else {
    plaza(w, lot, inner);
  }
}

// =====================================================================
// 学校・病院・保健所
// =====================================================================
function buildCivic(w: World, lot: Lot) {
  const a = usable(lot);
  const { b, rng } = w;
  const y = lot.y;
  const cx = (a.x0 + a.x1) / 2;
  const cz = (a.z0 + a.z1) / 2;
  if (lot.cx0 === -100 && lot.cz0 === 100) {
    // ひだまり小学校
    b.flat('ground', cx, y + 0.006, cz + 12, a.x1 - a.x0 - 6, 46, '#c8a878');
    b.building(cx, a.z0 + 12, y, 60, 14, 12, '#f1ede3', 0, 'office');
    b.box('plain', cx + 20, y + 12, a.z0 + 12, 4, 3, 4, '#f1ede3', 0, false);
    b.sign('ひだまり小学校', cx, y + 9.5, a.z0 + 19.05, 0, 10, 1.4, '#ffffff', '#2f4f6f');
    b.building(a.x0 + 14, cz + 16, y, 18, 24, 9, '#d9e2e8', 0, 'house');
    b.wall(a.x0 + 1, a.z1 - 1, a.x1 - 1, a.z1 - 1, y, 1.6, 0.1, '#7d8b8f');
    for (const gx of [cx - 12, cx + 12]) {
      b.cyl(gx, y, cz + 30, 0.08, 3, '#eeeeee', false);
      b.box('plain', gx, y + 2.2, cz + 30, 0.1, 1, 3, '#eeeeee', 0, false);
    }
    for (let i = 0; i < 8; i++) b.tree(a.x0 + 4 + i * 10, a.z1 - 4, y, 1.0, 'sakura');
    for (let i = 0; i < 6; i++) vehicle(w, a.x1 - 6 - i * 1.0, y, a.z0 + 24, Math.PI / 2, 'bicycle');
    weapon(w, 'bat', cx - 12, y, cz + 26);
    weapon(w, 'megaphone', cx + 18, y, a.z0 + 21);
  } else if (lot.cx0 === 0 && lot.cz0 === 100) {
    // ひだまり総合病院
    b.building(cx, cz - 8, y, 40, 22, 28, '#f4f6f7', 0, 'office');
    b.sign('ひだまり総合病院', cx, y + 24, cz + 3.05, 0, 14, 1.8, '#ffffff', '#2d6a9f');
    b.box('plain', cx + 16, y + 28, cz - 8, 3, 3, 0.4, '#e53935', 0, false);
    b.box('plain', cx + 16, y + 29, cz - 8, 1, 1, 0.42, '#ffffff', 0, false);
    b.flat('ground', cx, y + 0.006, cz + 18, 50, 22, '#55575c');
    for (let i = 0; i < 6; i++) if (rng.chance(0.6)) b.parkedCar(cx - 18 + i * 6, cz + 18, y, 0, rng.pick(CARS));
    vehicle(w, cx + 22, y, cz + 6, Math.PI / 2, 'ambulance');
    vehicle(w, cx + 22, y, cz + 12, Math.PI / 2, 'ambulance');
    vehicle(w, cx - 24, y, cz + 8, Math.PI / 2, 'firetruck');
  } else if (lot.cx0 === -100 && lot.cz0 === 200) {
    // 保健所
    b.building(cx - 6, cz - 10, y, 34, 18, 12, '#e7eadf', 0, 'office');
    b.sign('ひだまり保健所', cx - 6, y + 9, cz - 0.95, 0, 10, 1.5, '#ffffff', '#2e7d32');
    b.sign('動物管理センター', cx - 6, y + 2.8, cz - 0.95, 0, 6, 0.7, '#2e7d32', '#ffffff');
    b.flat('ground', cx, y + 0.006, cz + 20, 60, 24, '#55575c');
    for (let i = 0; i < 4; i++) vehicle(w, cx - 15 + i * 7, y, cz + 22, 0, 'catcherVan');
    // 檻（捕まったら入れられる場所）
    const kx = cx + 26;
    const kz = cz - 14;
    b.flat('ground', kx, y + 0.01, kz, 8, 8, '#9e9e9e');
    for (let i = 0; i <= 8; i++) {
      b.cyl(kx - 4 + i, y, kz - 4, 0.04, 2.2, '#5a5a5a', false);
      b.cyl(kx - 4 + i, y, kz + 4, 0.04, 2.2, '#5a5a5a', false);
      b.cyl(kx - 4, y, kz - 4 + i, 0.04, 2.2, '#5a5a5a', false);
    }
    b.box('plain', kx, y + 2.2, kz, 8.2, 0.1, 8.2, '#6a6a6a', 0, false);
    w.physics.staticBox(kx, y + 1.1, kz - 4, 4, 1.1, 0.1);
    w.physics.staticBox(kx, y + 1.1, kz + 4, 4, 1.1, 0.1);
    w.physics.staticBox(kx - 4, y + 1.1, kz, 0.1, 1.1, 4);
    w.physics.staticBox(kx + 4, y + 1.1, kz, 0.1, 1.1, 4);
    w.physics.staticBox(kx, y + 2.25, kz, 4.1, 0.1, 4.1);
    w.zones.push({ name: 'pound', rect: { x0: kx - 4, x1: kx + 4, z0: kz - 4, z1: kz + 4 } });
  } else {
    // 交番と図書館＋住宅
    b.building(a.x0 + 8, a.z0 + 7, y, 9, 8, 6, '#f0efe9', Math.PI, 'house');
    b.sign('交番', a.x0 + 8, y + 4.6, a.z0 + 2.94, Math.PI, 2.4, 0.7, '#ffffff', '#1d3c78');
    b.box('lamp', a.x0 + 8, y + 5.4, a.z0 + 2.9, 0.4, 0.4, 0.2, '#ff3b3b', Math.PI, false);
    vehicle(w, a.x0 + 16, y, a.z0 + 6, 0, 'police');
    weapon(w, 'megaphone', a.x0 + 12, y, a.z0 + 2);
    vehicle(w, a.x0 + 3, y, a.z0 + 14, Math.PI / 2, 'bicycle');
    b.building(cx + 8, cz, y, 28, 20, 10, '#d8cbb5', 0, 'office');
    b.sign('ひだまり図書館', cx + 8, y + 7.5, cz + 10.05, 0, 8, 1.1, '#ffffff', '#5a4632');
    residential(w, lot, a, [{ x0: a.x0, x1: a.x0 + 18, z0: a.z0, z1: a.z0 + 18 }, { x0: cx - 8, x1: cx + 24, z0: cz - 12, z1: cz + 12 }]);
  }
}

// =====================================================================
// 河川敷・工場
// =====================================================================
function buildRiverside(w: World, lot: Lot) {
  const a = usable(lot);
  const { b, rng } = w;
  const y = lot.y;
  const cx = (a.x0 + a.x1) / 2;
  const cz = (a.z0 + a.z1) / 2;
  if (lot.cz0 === 200) {
    // 川沿いの土手と川
    b.flat('ground', cx, y + 0.006, cz, a.x1 - a.x0, a.z1 - a.z0, '#7fae58');
    b.flat('water', cx, y + 0.05, cz + 8, a.x1 - a.x0, 26, '#4a8fc4');
    w.waters.push({ x: cx, z: cz + 8, rx: (a.x1 - a.x0) / 2 + 2, rz: 13.5, y: y + 0.05 });
    for (let i = 0; i < 18; i++) b.tree(rng.range(a.x0 + 2, a.x1 - 2), cz - rng.range(10, 30), y, rng.range(0.8, 1.2));
    for (let i = 0; i < 6; i++) b.bench(a.x0 + 8 + i * 14, cz - 7, y, 0);
    item(w, 'bone', cx - 10, y, cz - 12);
    item(w, 'ball', cx + 12, y, cz - 9);
  } else {
    // 工場・倉庫
    for (let i = 0; i < 3; i++) {
      const bx = a.x0 + 16 + i * 28;
      b.building(bx, cz - 12, y, 22, 30, rng.range(8, 13), rng.pick(['#9fb0bc', '#b8b3a5', '#8c9aa5']), 0, 'house');
      b.batch.add('roof', WorldBuilder.mat(bx, y + 12.5, cz - 12, Math.PI / 2, 30.5, 2.5, 22.5), '#6c7a86');
    }
    b.cyl(a.x1 - 10, y, a.z0 + 10, 1.2, 28, '#b33a2a');
    vehicle(w, cx, y, cz + 26, 0, 'garbage');
    b.cyl(a.x1 - 16, y, a.z0 + 10, 1.0, 22, '#d8d8d8');
    b.flat('ground', cx, y + 0.006, cz + 24, a.x1 - a.x0 - 4, 26, '#8d8f93');
    for (let i = 0; i < 5; i++) b.box('plain', a.x0 + 10 + i * 13, y, cz + 26, 6, 2.6, 2.4, rng.pick(['#3d6b9a', '#a63d3d', '#5c8a3d', '#c99a2e']), 0);
    if (lot.cx0 === -200) {
      // 危険物倉庫の前に爆弾の木箱
      b.box('plain', a.x0 + 12, y, cz + 18, 2.4, 0.8, 1.6, '#8a6a3a');
      b.sign('危険物', a.x0 + 12, y + 0.5, cz + 18.82, 0, 1.4, 0.35, '#ffd400', '#111111');
      for (let k = 0; k < 3; k++) item(w, 'bomb', a.x0 + 11.2 + k * 0.8, y + 0.8, cz + 18, 'shop');
      weapon(w, 'c4', a.x0 + 16, y, cz + 18);
      weapon(w, 'chainsaw', a.x0 + 22, y, cz + 18);
      weapon(w, 'molotov', a.x0 + 28, y, cz + 18);
    }
  }
}

// =====================================================================
// みどり公園
// =====================================================================
function buildPark(w: World, lot: Lot) {
  const a = usable(lot);
  const { b, rng } = w;
  const y = lot.y;
  const cx = (a.x0 + a.x1) / 2;
  const cz = (a.z0 + a.z1) / 2;
  // 池
  const px = cx - 20;
  const pz = cz - 5;
  const prx = 34;
  const prz = 22;
  b.disc(px, y + 0.004, pz, prx + 2, prz + 2, '#b8b09a');
  b.disc(px, y + 0.1, pz, prx, prz, '#3f86c6', true);
  w.waters.push({ x: px, z: pz, rx: prx, rz: prz, y: y + 0.1 });
  for (let i = 0; i < 64; i++) {
    const ang = (i / 64) * Math.PI * 2;
    b.box('plain', px + Math.cos(ang) * (prx + 1), y, pz + Math.sin(ang) * (prz + 1), 1.4, 0.35, 0.9, '#9a958c', -ang, false);
  }
  // 池をめぐる散歩道
  const ringR = 1.45;
  for (let i = 0; i < 72; i++) {
    const ang = (i / 72) * Math.PI * 2;
    const x = px + Math.cos(ang) * prx * ringR;
    const z = pz + Math.sin(ang) * prz * ringR * 1.25;
    b.flat('ground', x, y + 0.008, z, 3.2, 4.2, '#d8c9a3', -ang);
    if (i % 9 === 0) b.bench(px + Math.cos(ang) * (prx * ringR - 3), pz + Math.sin(ang) * (prz * ringR * 1.25 - 3), y, Math.atan2(-Math.cos(ang), -Math.sin(ang)));
    if (i % 6 === 3) b.lamp(px + Math.cos(ang) * (prx * ringR + 2.4), pz + Math.sin(ang) * (prz * ringR * 1.25 + 2.4), y, Math.atan2(-Math.cos(ang), -Math.sin(ang)));
  }
  // 入口からの道
  b.flat('ground', cx, y + 0.008, (pz + prz * ringR * 1.25 + a.z1) / 2, 4, a.z1 - (pz + prz * ringR * 1.25), '#d8c9a3');
  b.flat('ground', (a.x0 + px - prx * ringR) / 2, y + 0.008, pz, px - prx * ringR - a.x0, 4, '#d8c9a3');
  // 噴水広場（南口）
  b.disc(cx, y + 0.01, a.z1 - 14, 9, 9, '#d6cfc0');
  b.disc(cx, y + 0.45, a.z1 - 14, 4, 4, '#5fa3d8', true);
  w.physics.staticCylinder(cx, y + 0.25, a.z1 - 14, 0.25, 4.2);
  b.cyl(cx, y, a.z1 - 14, 0.5, 2.2, '#c9c2b4', false);
  b.sign('みどり公園', cx, y + 2.6, a.z1 - 2, 0, 5, 1.0, '#3f6b3a', '#ffffff');
  vehicle(w, cx + 5, y, a.z1 - 3, Math.PI / 2, 'bicycle');
  vehicle(w, cx + 6.2, y, a.z1 - 3, Math.PI / 2, 'bicycle');
  // 花壇
  for (let k = 0; k < 2; k++) {
    const fx = cx + (k ? 12 : -12);
    b.flat('ground', fx, y + 0.01, a.z1 - 10, 8, 3, '#6b4f3a');
    for (let i = 0; i < 6; i++) item(w, 'flower', fx - 3 + i * 1.2, y, a.z1 - 10 + (i % 2 ? 0.6 : -0.6));
  }
  // 遊具
  playground(w, cx + 55, cz + 40, y);
  item(w, 'ball', cx + 52, y, cz + 46);
  weapon(w, 'bat', cx + 47, y, cz + 46);
  item(w, 'bone', cx + 40, y, cz - 50);
  // 公衆トイレ
  b.building(a.x0 + 12, a.z1 - 14, y, 8, 6, 3.4, '#d9cfc0', 0, 'house');
  // 木々
  let placed = 0;
  for (let tries = 0; tries < 900 && placed < 190; tries++) {
    const x = rng.range(a.x0 + 3, a.x1 - 3);
    const z = rng.range(a.z0 + 3, a.z1 - 3);
    const ex = (x - px) / (prx * ringR);
    const ez = (z - pz) / (prz * ringR * 1.25);
    const e = Math.hypot(ex, ez);
    if (e < 1.12 && e > 0.88) continue;
    if (e < 0.88) continue;
    if (Math.abs(x - cx) < 4 && z > pz) continue;
    if (Math.abs(z - pz) < 4 && x < px) continue;
    if (Math.hypot(x - cx, z - (a.z1 - 14)) < 13) continue;
    if (Math.hypot(x - (cx + 55), z - (cz + 40)) < 14) continue;
    if (x < a.x0 + 20 && z > a.z1 - 22) continue;
    const near = e < 1.4;
    b.tree(x, z, y, rng.range(0.9, 1.5), near && rng.chance(0.6) ? 'sakura' : rng.chance(0.15) ? 'pine' : 'round');
    placed++;
  }
}

// =====================================================================
// わくわくランド（遊園地）
// =====================================================================
function buildAmusement(w: World, lot: Lot) {
  const a = usable(lot);
  const { b, rng } = w;
  const y = lot.y;
  const cx = (a.x0 + a.x1) / 2;
  // 外周の柵と入場ゲート
  const gate = cx;
  b.wall(a.x0 + 1, a.z0 + 1, a.x1 - 1, a.z0 + 1, y, 2.2, 0.2, '#f4a3c4');
  b.wall(a.x0 + 1, a.z0 + 1, a.x0 + 1, a.z1 - 1, y, 2.2, 0.2, '#a3d8f4');
  b.wall(a.x1 - 1, a.z0 + 1, a.x1 - 1, a.z1 - 1, y, 2.2, 0.2, '#a3d8f4');
  b.wall(a.x0 + 1, a.z1 - 1, gate - 7, a.z1 - 1, y, 2.2, 0.2, '#f4a3c4');
  b.wall(gate + 7, a.z1 - 1, a.x1 - 1, a.z1 - 1, y, 2.2, 0.2, '#f4a3c4');
  for (const dx of [-7.5, 7.5]) {
    b.box('plain', gate + dx, y, a.z1 - 1, 1.6, 8, 1.6, '#ff8fb1');
    b.sphere(gate + dx, y + 9.2, a.z1 - 1, 1.2, '#ffd166');
  }
  b.box('plain', gate, y + 6.6, a.z1 - 1, 16, 1.6, 0.8, '#7b5cd6', 0, false);
  b.sign('わくわくランド', gate, y + 7.4, a.z1 - 0.55, 0, 13, 1.5, '#7b5cd6', '#fff6a8', true);

  // 観覧車
  ferrisWheel(w, a.x1 - 40, a.z0 + 45, y);
  // メリーゴーラウンド
  carousel(w, a.x0 + 45, (a.z0 + a.z1) / 2 + 20, y);
  // お化け屋敷（お城）
  const hx = a.x0 + 40;
  const hz = a.z0 + 35;
  b.building(hx, hz, y, 26, 18, 10, '#6d5a8a', 0, 'house');
  for (const [dx, dz] of [
    [-13, -9],
    [13, -9],
    [-13, 9],
    [13, 9],
  ]) {
    b.cyl(hx + dx, y, hz + dz, 2, 14, '#5a4a75');
    b.batch.add('cone', WorldBuilder.mat(hx + dx, y + 14, hz + dz, 0, 5, 5, 5), '#3b2f52');
  }
  b.sign('おばけやしき', hx, y + 7.5, hz + 9.05, 0, 8, 1.2, '#1a1028', '#c6ff7a', true);
  // ゴーカート場（コーンで囲った広場にカートが並ぶ）
  const kx0 = a.x1 - 70;
  const kz0 = a.z1 - 34;
  b.flat('ground', kx0, y + 0.008, kz0, 44, 22, '#4b4e55');
  for (let i = 0; i < 5; i++) vehicle(w, kx0 - 16 + i * 3, y, kz0 + 6, 0, 'kart');
  for (let i = 0; i < 18; i++) {
    const t = (i / 18) * Math.PI * 2;
    const cxk = kx0 + Math.cos(t) * 13;
    const czk = kz0 + Math.sin(t) * 5;
    if (b.hasModel('cars/cone')) b.model('cars/cone', cxk, y, czk, 0, 0.9, { collide: 'none' });
  }
  b.sign('ゴーカート', kx0, y + 3, kz0 - 11.5, 0, 5, 1.0, '#ff5d5d', '#ffffff', true);
  // ジェットコースター（見た目だけ。フェーズ4で乗れるように）
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    const x = cx + 10 + Math.cos(t) * 46;
    const z = a.z0 + 70 + Math.sin(t) * 22;
    const h = 6 + Math.sin(t * 3) * 4 + (t > Math.PI ? 6 : 0);
    if (i % 2 === 0) b.cyl(x, y, z, 0.25, h, '#d9d9d9', true);
    b.box('plain', x, y + h, z, 2.2, 0.35, 7.6, '#e63946', -t, false);
  }
  // 屋台
  const stalls: { name: string; color: string; id: ItemId }[] = [
    { name: 'クレープ', color: '#ff9ec7', id: 'crepe' },
    { name: 'わたあめ', color: '#9ec9ff', id: 'cotton' },
    { name: 'ソフトクリーム', color: '#fff1a8', id: 'icecream' },
    { name: 'ホットドッグ', color: '#ffb36b', id: 'burger' },
  ];
  stalls.forEach((s, i) => {
    const sx = gate - 30 + i * 20;
    const sz = a.z1 - 22;
    b.box('plain', sx, y, sz, 4.4, 1.0, 2.4, '#f7f1e6');
    b.box('plain', sx, y + 2.5, sz, 4.8, 0.2, 2.8, s.color, 0, false);
    for (const dx of [-2.1, 2.1]) b.cyl(sx + dx, y, sz + 1.1, 0.06, 2.5, '#ffffff', false);
    b.sign(s.name, sx, y + 2.95, sz + 1.42, 0, 3.6, 0.7, s.color, '#5a2a3a');
    for (let k = 0; k < 3; k++) item(w, s.id, sx - 1.2 + k * 1.2, y + 1.0, sz + 0.7, 'shop');
    w.staticSpots.push({ x: sx + 1.6, y, z: sz - 1.9, yaw: 0, kind: 'clerk', district: 'amusement' });
  });
  // 木・ベンチ・風船
  for (let i = 0; i < 40; i++) {
    const x = rng.range(a.x0 + 6, a.x1 - 6);
    const z = rng.range(a.z0 + 6, a.z1 - 6);
    if (Math.hypot(x - (a.x1 - 40), z - (a.z0 + 45)) < 30) continue;
    if (Math.hypot((x - (cx + 10)) / 52, (z - (a.z0 + 70)) / 28) < 1.15) continue;
    b.tree(x, z, y, rng.range(0.7, 1.0), rng.chance(0.5) ? 'sakura' : 'round');
  }
  for (let i = 0; i < 10; i++) b.bench(gate - 45 + i * 10, a.z1 - 34, y, 0);
  for (let i = 0; i < 24; i++) b.lamp(a.x0 + 10 + i * 7.5, a.z1 - 30, y, 0);
}

function ferrisWheel(w: World, x: number, z: number, y: number) {
  const b = w.b;
  const R = 22;
  const H = R + 6;
  for (const dz of [-2.5, 2.5]) {
    for (const dx of [-10, 10]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, Math.hypot(dx, H), 0.8), new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.6 }));
      leg.position.set(x + dx / 2, y + H / 2, z + dz);
      leg.rotation.z = Math.atan2(dx, H);
      leg.castShadow = true;
      b.extras.add(leg);
    }
  }
  w.physics.staticBox(x - 10, y + 3, z, 0.6, 3, 3);
  w.physics.staticBox(x + 10, y + 3, z, 0.6, 3, 3);
  const wheel = new THREE.Group();
  wheel.position.set(x, y + H, z);
  const ringMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, emissive: '#ff7ab8', emissiveIntensity: 0.2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 8, 64), ringMat);
  wheel.add(ring);
  const ring2 = ring.clone();
  ring2.scale.setScalar(0.6);
  wheel.add(ring2);
  const spokeGeo = new THREE.BoxGeometry(0.2, R * 2, 0.2);
  for (let i = 0; i < 8; i++) {
    const sp = new THREE.Mesh(spokeGeo, ringMat);
    sp.rotation.z = (i / 8) * Math.PI;
    wheel.add(sp);
  }
  const gondolas: THREE.Mesh[] = [];
  const cols = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#c77dff', '#ff9f1c'];
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const g = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.5 }));
    g.position.set(Math.cos(ang) * R, Math.sin(ang) * R - 1.4, 0);
    g.castShadow = true;
    wheel.add(g);
    gondolas.push(g);
  }
  w.b.extras.add(wheel);
  w.animated.push({
    update(dt: number) {
      wheel.rotation.z += dt * 0.06;
      for (const g of gondolas) g.rotation.z = -wheel.rotation.z;
    },
  });
}

function carousel(w: World, x: number, z: number, y: number) {
  const b = w.b;
  b.cyl(x, y, z, 9, 0.5, '#f7e1a1');
  b.cyl(x, y, z, 1.2, 6, '#ffb3c6', false);
  const top = new THREE.Group();
  top.position.set(x, y + 0.5, z);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(10, 3.2, 16), new THREE.MeshStandardMaterial({ color: '#ff8fab', roughness: 0.6, flatShading: true }));
  roof.position.y = 6.6;
  roof.castShadow = true;
  top.add(roof);
  const horseCols = ['#ffffff', '#ffe5ec', '#fff3b0', '#cdeac0'];
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5), new THREE.MeshStandardMaterial({ color: '#e0b84a', metalness: 0.6, roughness: 0.3 }));
    pole.position.set(Math.cos(ang) * 7, 2.6, Math.sin(ang) * 7);
    top.add(pole);
    const horse = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 1.6), new THREE.MeshStandardMaterial({ color: horseCols[i % 4], roughness: 0.5 }));
    horse.position.set(Math.cos(ang) * 7, 1.6, Math.sin(ang) * 7);
    horse.rotation.y = -ang;
    horse.castShadow = true;
    top.add(horse);
  }
  w.b.extras.add(top);
  let t = 0;
  w.animated.push({
    update(dt: number) {
      t += dt;
      top.rotation.y += dt * 0.35;
      top.children.forEach((c, i) => {
        if (i > 0 && i % 2 === 0) c.position.y = 1.6 + Math.sin(t * 2 + i) * 0.3;
      });
    },
  });
}

// =====================================================================
// 田舎（田園・山あい）
// =====================================================================
function buildCountry(w: World, lot: Lot) {
  const a = usable(lot);
  const { b, rng } = w;
  const y = lot.y;
  const hill = lot.district === 'countryHill';
  const cx = (a.x0 + a.x1) / 2;
  const cz = (a.z0 + a.z1) / 2;
  // 田んぼ・畑（区画の半分〜大部分）
  const fieldRect = { x0: a.x0 + 4, x1: hill ? cx : a.x1 - 4, z0: a.z0 + 4, z1: hill ? cz + 10 : a.z1 - 30 };
  const nx = Math.max(1, Math.floor((fieldRect.x1 - fieldRect.x0) / 22));
  const nz = Math.max(1, Math.floor((fieldRect.z1 - fieldRect.z0) / 20));
  const fw = (fieldRect.x1 - fieldRect.x0) / nx;
  const fd = (fieldRect.z1 - fieldRect.z0) / nz;
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const fx = fieldRect.x0 + fw * (i + 0.5);
      const fz = fieldRect.z0 + fd * (k + 0.5);
      const paddy = rng.chance(hill ? 0.3 : 0.7);
      b.flat('ground', fx, y + 0.01, fz, fw - 1.2, fd - 1.2, paddy ? '#79a86a' : '#8a6f4e');
      if (paddy) {
        b.flat('ground', fx, y + 0.03, fz, fw - 1.4, fd - 1.4, '#7aa595');
        for (let r = 0; r < Math.floor(fd / 1.6); r++) b.flat('mark', fx, y + 0.05, fz - fd / 2 + 1.2 + r * 1.6, fw - 2, 0.35, '#86b85a');
      } else {
        for (let r = 0; r < Math.floor(fw / 1.4); r++) b.flat('mark', fx - fw / 2 + 1.0 + r * 1.4, y + 0.05, fz, 0.5, fd - 2, '#5f9a3e');
      }
    }
  }
  // かかし
  const kx = rng.range(fieldRect.x0 + 5, fieldRect.x1 - 5);
  const kz = rng.range(fieldRect.z0 + 5, fieldRect.z1 - 5);
  b.cyl(kx, y, kz, 0.06, 1.8, '#7a5a3a', true);
  b.box('plain', kx, y + 1.3, kz, 1.6, 0.08, 0.08, '#7a5a3a', 0, false);
  b.box('plain', kx, y + 0.9, kz, 0.6, 0.6, 0.25, '#3f6fb0', 0, false);
  b.sphere(kx, y + 1.75, kz, 0.25, '#f1e3c6');
  b.batch.add('cone', WorldBuilder.mat(kx, y + 1.85, kz, 0, 0.9, 0.35, 0.9), '#d9b45a');

  // 農家
  const fx = hill ? a.x1 - 22 : cx + rng.range(-20, 20);
  const fz = hill ? cz - 12 : a.z1 - 16;
  b.house(fx, fz, y, 12, 9, rng.chance(0.5) ? 0 : Math.PI, '#d9c7a5', '#3b3b3b', 1);
  b.building(fx + 13, fz, y, 7, 8, 4.5, '#8a5a3a', 0, 'house');
  vehicle(w, fx + 13, y, fz + 8, Math.PI / 2, 'truck');
  vehicle(w, fx - 6, y, fz + 8, Math.PI / 2, rng.chance(0.6) ? 'tractor' : 'bicycle');
  b.tree(fx - 9, fz + 2, y, 1.1, 'round');
  for (let i = 0; i < 3; i++) b.sphere(fx - 9 + rng.range(-1, 1), y + 2.8 + rng.range(0, 1), fz + 2 + rng.range(-1, 1), 0.18, '#f28c28');
  // 無人販売所
  const vx = a.x0 + 3;
  const vz = cz + rng.range(-20, 20);
  b.box('plain', vx, y, vz, 1.2, 0.9, 2.4, '#a0784f');
  b.batch.add('roof', WorldBuilder.mat(vx, y + 2.0, vz, Math.PI / 2, 2.8, 0.6, 1.8), '#5a4632');
  for (const dz of [-1.1, 1.1]) b.cyl(vx, y, vz + dz, 0.05, 2.0, '#6b4a2a', false);
  b.sign('むじんはんばい 100円', vx + 0.62, y + 1.4, vz, Math.PI / 2, 1.8, 0.35, '#fffaf0', '#4a3a2a');
  item(w, 'daikon', vx, y + 0.9, vz - 0.6, 'shop');
  item(w, 'tomato', vx, y + 0.9, vz + 0.2, 'shop');
  item(w, 'tomato', vx, y + 0.9, vz + 0.7, 'shop');
  // 林
  const nTrees = hill ? 70 : 24;
  for (let i = 0; i < nTrees; i++) {
    const x = rng.range(a.x0 + 3, a.x1 - 3);
    const z = rng.range(a.z0 + 3, a.z1 - 3);
    if (x > fieldRect.x0 - 2 && x < fieldRect.x1 + 2 && z > fieldRect.z0 - 2 && z < fieldRect.z1 + 2) continue;
    if (Math.hypot(x - fx, z - fz) < 14) continue;
    b.tree(x, z, y, rng.range(1.0, 1.7), hill && rng.chance(0.6) ? 'pine' : 'round');
  }
  if (hill && rng.chance(0.5)) {
    // 小さな祠
    const sx = a.x0 + 12;
    const sz = a.z1 - 12;
    b.box('plain', sx, y, sz, 1.4, 1.2, 1.2, '#8a6a4a');
    b.batch.add('roof', WorldBuilder.mat(sx, y + 1.2, sz, 0, 1.9, 0.6, 1.6), '#3b3b3b');
    item(w, 'manju', sx, y + 0.62, sz + 0.75, 'shrine');
    weapon(w, 'caltrops', sx + 2, y, sz + 1.5);
  }
  if (lot.cx0 === -300 && lot.cz0 === -100) weapon(w, 'chainsaw', fx + 13, y, fz - 5);
}
