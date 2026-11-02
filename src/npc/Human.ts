import * as THREE from 'three';
import { clamp, type Rng } from '../core/Rng';

export type HairStyle = 'short' | 'long' | 'bald' | 'bun' | 'ponytail' | 'cap';

export interface HumanLook {
  height: number;
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  shoes: string;
  skirt: boolean;
  hairStyle: HairStyle;
  hunch: number;
  child: boolean;
  backpack?: string;
  cane?: boolean;
  tie?: string;
  apron?: string;
  hat?: string;
}

export type HumanMode = 'idle' | 'walk' | 'run' | 'panic' | 'lie' | 'cower' | 'wave';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BALL = new THREE.SphereGeometry(0.5, 14, 10);
const CAP = new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const SKIRT = new THREE.CylinderGeometry(0.36, 0.5, 1, 12);
const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function colorMat(c: string, rough = 0.82) {
  const key = c + rough;
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = new THREE.MeshStandardMaterial({ color: c, roughness: rough })));
  return m;
}

function mesh(geo: THREE.BufferGeometry, color: string, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, colorMat(color));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** ブロック風の人間モデル（コードで組み立てる） */
export class HumanModel {
  root = new THREE.Group();
  body = new THREE.Group();
  torso = new THREE.Group();
  head = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  legL = new THREE.Group();
  legR = new THREE.Group();
  headTopY: number;
  torsoD: number;
  private phase = Math.random() * 6;
  private t = Math.random() * 10;
  fall = 0;
  fallDir = -1;
  kick = 0;
  hop = 0;
  private hipY: number;
  private hunch: number;

  constructor(public look: HumanLook) {
    const H = look.height;
    const child = look.child;
    const legLen = H * (child ? 0.4 : 0.46);
    const hipY = legLen + 0.04;
    const torsoH = H * (child ? 0.27 : 0.3);
    const headS = H * (child ? 0.2 : 0.135);
    const torsoW = H * (child ? 0.22 : 0.23);
    const torsoD = torsoW * 0.62;
    const armLen = H * (child ? 0.31 : 0.36);
    const armW = torsoW * 0.27;
    const legW = torsoW * 0.37;
    this.hipY = hipY;
    this.torsoD = torsoD;
    this.hunch = look.hunch;

    this.root.add(this.body);
    // 脚
    for (const [g, sx] of [
      [this.legL, 1],
      [this.legR, -1],
    ] as const) {
      g.position.set(sx * legW * 0.62, hipY, 0);
      g.add(mesh(BOX, look.skirt ? look.skin : look.bottom, legW, legLen, legW * 1.1, 0, -legLen / 2, 0));
      g.add(mesh(BOX, look.shoes, legW * 1.08, 0.075, legW * 1.75, 0, -legLen - 0.002, legW * 0.3));
      this.body.add(g);
    }
    if (look.skirt) this.body.add(mesh(SKIRT, look.bottom, torsoW * 1.1, legLen * 0.48, torsoD * 1.5, 0, hipY - legLen * 0.2, 0));
    else this.body.add(mesh(BOX, look.bottom, torsoW * 0.98, 0.12, torsoD * 1.02, 0, hipY, 0));

    // 胴体
    this.torso.position.set(0, hipY, 0);
    this.torso.rotation.x = look.hunch;
    this.body.add(this.torso);
    this.torso.add(mesh(BOX, look.top, torsoW, torsoH, torsoD, 0, torsoH / 2, 0));
    if (look.tie) this.torso.add(mesh(BOX, look.tie, torsoW * 0.12, torsoH * 0.6, 0.02, 0, torsoH * 0.62, torsoD / 2 + 0.01));
    if (look.apron) this.torso.add(mesh(BOX, look.apron, torsoW * 0.85, torsoH * 1.3, 0.025, 0, torsoH * 0.32, torsoD / 2 + 0.012));
    if (look.backpack) this.torso.add(mesh(BOX, look.backpack, torsoW * 0.9, torsoH * 0.75, torsoD * 0.8, 0, torsoH * 0.55, -torsoD * 0.85));

    // 腕
    for (const [g, sx] of [
      [this.armL, 1],
      [this.armR, -1],
    ] as const) {
      g.position.set(sx * (torsoW / 2 + armW / 2 + 0.005), torsoH - armW * 0.4, 0);
      g.add(mesh(BOX, look.top, armW, armLen * 0.86, armW * 1.05, 0, -armLen * 0.42, 0));
      g.add(mesh(BALL, look.skin, armW * 1.05, armW * 1.15, armW * 1.05, 0, -armLen * 0.9, 0));
      this.torso.add(g);
    }
    if (look.cane) {
      const cane = mesh(CYL, '#5a3d28', 0.03, H * 0.5, 0.03, 0, -armLen * 0.9 - H * 0.2, 0.05);
      this.armR.add(cane);
    }

    // 頭
    this.head.position.set(0, torsoH + H * 0.015, 0);
    this.head.rotation.x = -look.hunch * 0.7;
    this.torso.add(this.head);
    this.head.add(mesh(BALL, look.skin, headS * 0.9, headS, headS * 0.94, 0, headS / 2, 0));
    const eyeY = headS * 0.52;
    for (const sx of [-1, 1]) this.head.add(mesh(BOX, '#2a2220', headS * 0.09, headS * 0.12, 0.02, sx * headS * 0.2, eyeY, headS * 0.45));
    const hairCap = () => mesh(CAP, look.hair, headS * 0.98, headS * 1.02, headS * 1.0, 0, headS * 0.5, -headS * 0.03);
    switch (look.hairStyle) {
      case 'short':
        this.head.add(hairCap());
        break;
      case 'long':
        this.head.add(hairCap());
        this.head.add(mesh(BOX, look.hair, headS * 0.92, headS * 1.25, headS * 0.28, 0, headS * 0.18, -headS * 0.38));
        break;
      case 'bun':
        this.head.add(hairCap());
        this.head.add(mesh(BALL, look.hair, headS * 0.42, headS * 0.42, headS * 0.42, 0, headS * 1.02, -headS * 0.22));
        break;
      case 'ponytail':
        this.head.add(hairCap());
        this.head.add(mesh(BOX, look.hair, headS * 0.22, headS * 0.7, headS * 0.22, 0, headS * 0.35, -headS * 0.55));
        break;
      case 'cap':
        this.head.add(mesh(CAP, look.hat ?? '#3355aa', headS * 1.02, headS * 1.04, headS * 1.02, 0, headS * 0.55, 0));
        this.head.add(mesh(BOX, look.hat ?? '#3355aa', headS * 0.8, 0.02, headS * 0.5, 0, headS * 0.62, headS * 0.55));
        break;
      case 'bald':
        this.head.add(mesh(BOX, look.hair, headS * 0.95, headS * 0.25, headS * 0.7, 0, headS * 0.45, -headS * 0.15));
        break;
    }
    this.headTopY = hipY + torsoH + H * 0.015 + headS;
  }

  /** 頭の位置（ワールド座標） */
  headWorld(out = new THREE.Vector3()) {
    this.head.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.head.matrixWorld);
  }

  animate(dt: number, mode: HumanMode, speed: number) {
    this.t += dt;
    const child = this.look.child;
    this.phase += dt * speed * (child ? 6.5 : 4.6);
    const s = Math.sin(this.phase);
    let legA = 0;
    let armA = 0;
    let lean = 0;
    let armUp = 0;
    switch (mode) {
      case 'walk':
        legA = 0.5;
        armA = 0.38;
        break;
      case 'run':
        legA = 0.95;
        armA = 0.9;
        lean = 0.18;
        break;
      case 'panic':
        legA = 0.95;
        lean = 0.1;
        armUp = 1;
        break;
      case 'cower':
        armUp = 0.7;
        lean = 0.25;
        break;
      case 'wave':
        break;
    }
    const k = Math.min(1, dt * 14);
    this.legL.rotation.x += (s * legA - this.legL.rotation.x) * k;
    this.legR.rotation.x += (-s * legA - this.kick * 1.4 - this.legR.rotation.x) * Math.min(1, dt * 20);
    let aL = -s * armA;
    let aR = s * armA;
    if (armUp > 0) {
      aL = -2.75 + Math.sin(this.t * 17) * 0.35;
      aR = -2.75 + Math.cos(this.t * 15) * 0.35;
    }
    if (mode === 'wave') aR = -2.6 + Math.sin(this.t * 9) * 0.4;
    if (mode === 'lie') {
      aL = -1.2;
      aR = -1.5;
    }
    this.armL.rotation.x += (aL - this.armL.rotation.x) * k;
    this.armR.rotation.x += (aR - this.armR.rotation.x) * k;
    this.armL.rotation.z = mode === 'lie' ? 0.6 : 0;
    this.armR.rotation.z = mode === 'lie' ? -0.6 : 0;
    this.torso.rotation.x = this.hunch + lean;

    // 倒れる
    const targetFall = mode === 'lie' ? 1 : 0;
    this.fall += (targetFall - this.fall) * Math.min(1, dt * (targetFall ? 7 : 4));
    const f = clamp(this.fall, 0, 1);
    this.body.rotation.x = this.fallDir * (Math.PI / 2) * f;
    this.body.position.y = this.torsoD * 0.55 * f + this.hop;
    this.hop = Math.max(0, this.hop - dt * 1.8);
  }
}

const SKINS = ['#f1d2b6', '#eac4a3', '#e2b894', '#d9a882', '#f3dcc6'];
const HAIRS = ['#1c1a19', '#2b211c', '#3d2b20', '#5a3c26', '#1a1a2a'];
const TOPS = ['#e8e4dc', '#4a6fa5', '#b5485d', '#5c8a5c', '#d9a441', '#7b5ea7', '#2f4f4f', '#e07a5f', '#f2cc8f', '#81b29a', '#ffffff', '#3d405b'];
const PASTEL = ['#f7c5cc', '#c9e4de', '#faedcb', '#c6def1', '#dbcdf0', '#f2c6de', '#fde2e4', '#e2ece9'];
const BOTTOMS = ['#2f3b52', '#3a3a3a', '#6b5b45', '#4a5a6a', '#c2b59b', '#1f2a44'];
const SHOES = ['#2a2a2a', '#f2f2f2', '#6b4a32', '#3b5ba5', '#a33'];

export type HumanKind = 'man' | 'woman' | 'child' | 'elderly' | 'office' | 'clerk';

export function makeLook(kind: HumanKind, rng: Rng): HumanLook {
  const base: HumanLook = {
    height: 1.7,
    skin: rng.pick(SKINS),
    hair: rng.pick(HAIRS),
    top: rng.pick(TOPS),
    bottom: rng.pick(BOTTOMS),
    shoes: rng.pick(SHOES),
    skirt: false,
    hairStyle: 'short',
    hunch: 0,
    child: false,
  };
  switch (kind) {
    case 'man':
      base.height = rng.range(1.66, 1.84);
      base.hairStyle = rng.chance(0.15) ? 'cap' : 'short';
      base.hat = rng.pick(['#2d3a8c', '#8c2d2d', '#2d2d2d']);
      break;
    case 'woman':
      base.height = rng.range(1.52, 1.68);
      base.hairStyle = rng.pick(['long', 'long', 'bun', 'ponytail', 'short']);
      base.top = rng.pick([...PASTEL, ...TOPS]);
      base.skirt = rng.chance(0.5);
      if (base.skirt) base.bottom = rng.pick(['#3d405b', '#b5485d', '#c2b59b', '#6b8fb5', '#2f2f2f']);
      break;
    case 'child':
      base.height = rng.range(1.05, 1.32);
      base.child = true;
      base.hairStyle = rng.pick(['short', 'short', 'ponytail', 'cap']);
      base.hat = '#f2d14a';
      base.top = rng.pick(['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#f783ac', '#ffffff']);
      base.bottom = rng.pick(['#1f2a44', '#3a3a3a', '#6b8fb5']);
      if (rng.chance(0.65)) base.backpack = rng.pick(['#c92a2a', '#212529', '#1c3d7a', '#a55eea']);
      break;
    case 'elderly':
      base.height = rng.range(1.48, 1.64);
      base.hair = rng.pick(['#d9d9d9', '#bfbfbf', '#eeeeee', '#9a9a9a']);
      base.hairStyle = rng.pick(['short', 'bun', 'bald']);
      base.hunch = rng.range(0.2, 0.42);
      base.cane = rng.chance(0.5);
      base.top = rng.pick(['#7a6a5a', '#8a7f6a', '#5a6a7a', '#a08a6a', '#6a5a6a', '#c9b79c']);
      base.bottom = rng.pick(['#4a4a4a', '#5a4a3a', '#3a3a4a']);
      break;
    case 'office':
      base.height = rng.range(1.62, 1.8);
      base.top = rng.pick(['#1f2a44', '#2b2b2b', '#4a4f57', '#24304a']);
      base.bottom = base.top;
      base.tie = rng.pick(['#b23a48', '#2f6db5', '#d9a441', '#3a7d44']);
      base.shoes = '#1a1a1a';
      base.hairStyle = rng.chance(0.2) ? 'long' : 'short';
      break;
    case 'clerk':
      base.height = rng.range(1.58, 1.78);
      base.top = '#f4f4f4';
      base.apron = rng.pick(['#2f8f4f', '#2f6fa8', '#c8873f', '#b8433a']);
      base.hairStyle = rng.pick(['short', 'bun', 'cap']);
      base.hat = '#ffffff';
      break;
  }
  return base;
}
