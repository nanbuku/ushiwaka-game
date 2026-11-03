import * as THREE from 'three';
import type { Assets } from '../assets/Assets';
import { colorMat } from '../npc/Human';
import { makeSign } from '../world/Kit';

export type VehicleKind = 'sedan' | 'taxi' | 'van' | 'truck' | 'scooter' | 'catcherVan';

export interface VehicleSpec {
  halfW: number;
  halfL: number;
  height: number;
  maxSpeed: number;
  accel: number;
  turn: number;
  wheelR: number;
  seat: [number, number, number];
  bike: boolean;
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  sedan: { halfW: 0.9, halfL: 2.15, height: 1.45, maxSpeed: 24, accel: 9, turn: 2.6, wheelR: 0.33, seat: [-0.38, 0.55, 0.15], bike: false },
  taxi: { halfW: 0.9, halfL: 2.2, height: 1.5, maxSpeed: 24, accel: 9, turn: 2.6, wheelR: 0.33, seat: [-0.38, 0.55, 0.15], bike: false },
  van: { halfW: 0.95, halfL: 2.4, height: 2.0, maxSpeed: 20, accel: 7, turn: 2.8, wheelR: 0.35, seat: [-0.42, 0.75, 1.1], bike: false },
  catcherVan: { halfW: 0.95, halfL: 2.4, height: 2.0, maxSpeed: 21, accel: 7.5, turn: 2.8, wheelR: 0.35, seat: [-0.42, 0.75, 1.1], bike: false },
  truck: { halfW: 0.75, halfL: 1.7, height: 1.75, maxSpeed: 19, accel: 7, turn: 3.0, wheelR: 0.28, seat: [-0.32, 0.7, 0.9], bike: false },
  scooter: { halfW: 0.32, halfL: 0.9, height: 1.15, maxSpeed: 22, accel: 11, turn: 3.4, wheelR: 0.24, seat: [0, 0.62, -0.15], bike: true },
};

const CAR_COLORS = ['#e8e8e8', '#2b2b2b', '#b02a2a', '#2a4fb0', '#e8e2d0', '#4a6b45', '#8a8f96', '#f2a541', '#6d4c8f'];

const box = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, mat?: THREE.Material) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat ?? colorMat(color, 0.45));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

const glassMat = new THREE.MeshStandardMaterial({ color: '#a8d4f0', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false });
const headMat = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff2c0', emissiveIntensity: 0.6 });
const tailMat = new THREE.MeshStandardMaterial({ color: '#ff3030', emissive: '#ff1010', emissiveIntensity: 0.5 });
const tireMat = new THREE.MeshStandardMaterial({ color: '#161616', roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: '#c8c8c8', roughness: 0.3, metalness: 0.8 });
const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 14).rotateZ(Math.PI / 2);

const KENNEY: Partial<Record<VehicleKind, string[]>> = {
  sedan: ['cars/sedan', 'cars/suv', 'cars/sedan'],
  taxi: ['cars/taxi'],
  van: ['cars/van', 'cars/delivery'],
  truck: ['cars/truck'],
  catcherVan: ['cars/ambulance'],
};
const KSCALE = 1.35;

/** 乗り物の見た目。Kenney の車があればそれを使い、なければコードで組み立てる。前はローカル +z */
export class VehicleModel {
  root = new THREE.Group();
  body = new THREE.Group();
  wheels: THREE.Group[] = [];
  frontWheels: THREE.Group[] = [];
  seat = new THREE.Object3D();
  color: string;
  spec: VehicleSpec;

  constructor(public kind: VehicleKind, colorSeed = Math.random(), assets?: Assets) {
    this.spec = SPECS[kind];
    const keys = (KENNEY[kind] ?? []).filter((k) => assets?.get(k));
    if (assets && keys.length) {
      this.color = '#ffffff';
      this.buildKenney(assets, keys[Math.floor(colorSeed * keys.length)]);
      return;
    }
    const s = SPECS[kind];
    this.root.add(this.body);
    this.color = kind === 'taxi' ? '#f2b705' : kind === 'catcherVan' ? '#f4f4f0' : CAR_COLORS[Math.floor(colorSeed * CAR_COLORS.length)];
    const c = this.color;
    const W = s.halfW * 2;
    const Lh = s.halfL;
    const r = s.wheelR;
    switch (kind) {
      case 'sedan':
      case 'taxi': {
        this.body.add(box(W, 0.6, Lh * 2, c, 0, r + 0.25, 0));
        this.body.add(box(W * 0.86, 0.52, Lh * 1.0, c, 0, r + 0.8, -0.2, glassMat));
        this.body.add(box(W * 0.84, 0.06, Lh * 0.96, c, 0, r + 1.09, -0.2));
        if (kind === 'taxi') {
          const sign = makeSign('タクシー', 0.7, 0.24, '#ffffff', '#1d3c78', true);
          sign.position.set(0, r + 1.26, -0.2);
          this.body.add(box(0.75, 0.26, 0.3, '#ffffff', 0, r + 1.25, -0.2), sign);
          sign.position.z = -0.04;
        }
        break;
      }
      case 'van':
      case 'catcherVan': {
        this.body.add(box(W, 0.8, Lh * 2, c, 0, r + 0.43, 0));
        this.body.add(box(W, 0.65, Lh * 2 - 1.6, c, 0, r + 1.15, -0.8));
        this.body.add(box(W * 0.98, 0.6, 1.55, c, 0, r + 1.13, Lh - 0.78, glassMat));
        this.body.add(box(W, 0.08, Lh * 2, c, 0, r + 1.5, 0));
        if (kind === 'catcherVan') {
          for (const sx of [-1, 1]) {
            this.body.add(box(0.03, 0.25, Lh * 2, '#2e7d32', sx * (s.halfW + 0.02), r + 0.55, 0));
            const sign = makeSign('保健所', 1.6, 0.4, '#f4f4f0', '#2e7d32');
            sign.position.set(sx * (s.halfW + 0.03), r + 0.85, -0.6);
            sign.rotation.y = (sx * Math.PI) / 2;
            this.body.add(sign);
          }
          this.body.add(box(0.5, 0.15, 0.25, '#ff3030', 0, r + 1.55, 0.6, tailMat));
        }
        break;
      }
      case 'truck': {
        // 軽トラ
        this.body.add(box(W, 0.35, Lh * 2, c, 0, r + 0.2, 0));
        this.body.add(box(W, 0.5, 1.25, c, 0, r + 0.6, Lh - 0.62));
        this.body.add(box(W * 0.98, 0.45, 1.2, c, 0, r + 1.07, Lh - 0.62, glassMat));
        this.body.add(box(W, 0.06, 1.25, c, 0, r + 1.32, Lh - 0.62));
        for (const sx of [-1, 1]) this.body.add(box(0.06, 0.32, Lh * 2 - 1.3, c, sx * (s.halfW - 0.03), r + 0.52, -0.62));
        this.body.add(box(W, 0.32, 0.06, c, 0, r + 0.52, -Lh + 0.03));
        break;
      }
      case 'scooter': {
        this.body.add(box(0.36, 0.22, 1.4, c, 0, r + 0.12, 0));
        this.body.add(box(0.34, 0.12, 0.6, '#222222', 0, r + 0.42, -0.15));
        this.body.add(box(0.3, 0.7, 0.12, c, 0, r + 0.45, 0.62));
        this.body.add(box(0.7, 0.05, 0.05, '#333333', 0, r + 0.85, 0.62));
        break;
      }
    }
    // ライト
    if (kind !== 'scooter') {
      for (const sx of [-1, 1]) {
        this.body.add(box(0.28, 0.14, 0.04, '#fff', sx * (s.halfW - 0.25), r + 0.38, Lh + 0.01, headMat));
        this.body.add(box(0.26, 0.12, 0.04, '#f00', sx * (s.halfW - 0.24), r + 0.38, -Lh - 0.01, tailMat));
      }
    } else this.body.add(box(0.14, 0.12, 0.05, '#fff', 0, r + 0.75, 0.7, headMat));
    // タイヤ
    const wPos: [number, number][] = s.bike
      ? [
          [0, Lh - 0.2],
          [0, -Lh + 0.2],
        ]
      : [
          [-s.halfW + 0.12, Lh - 0.65],
          [s.halfW - 0.12, Lh - 0.65],
          [-s.halfW + 0.12, -Lh + 0.65],
          [s.halfW - 0.12, -Lh + 0.65],
        ];
    wPos.forEach(([x, z], i) => {
      const g = new THREE.Group();
      g.position.set(x, r, z);
      const tire = new THREE.Mesh(wheelGeo, tireMat);
      tire.scale.set(s.bike ? 0.12 : 0.22, r, r);
      tire.castShadow = true;
      const rim = new THREE.Mesh(wheelGeo, rimMat);
      rim.scale.set(s.bike ? 0.13 : 0.23, r * 0.55, r * 0.55);
      const spin = new THREE.Group();
      spin.add(tire, rim);
      g.add(spin);
      this.root.add(g);
      this.wheels.push(g);
      if (z > 0) this.frontWheels.push(g);
      void i;
    });
    this.seat.position.set(...s.seat);
    this.body.add(this.seat);
  }

  private buildKenney(assets: Assets, key: string) {
    const md = assets.get(key)!;
    const k = KSCALE;
    const inner = new THREE.Group();
    inner.scale.setScalar(k);
    this.root.add(this.body);
    this.body.add(inner);
    let wheelR = 0.33;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    for (const p of md.parts) {
      const mesh = new THREE.Mesh(p.geo, p.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (p.name.startsWith('wheel')) {
        p.matrix.decompose(pos, quat, scl);
        p.geo.computeBoundingBox();
        const bb = p.geo.boundingBox!;
        const c = bb.getCenter(new THREE.Vector3()).multiply(scl).applyQuaternion(quat);
        wheelR = ((bb.max.y - bb.min.y) * scl.y * k) / 2;
        const pivot = new THREE.Group();
        pivot.position.copy(pos).add(c);
        const spin = new THREE.Group();
        mesh.quaternion.copy(quat);
        mesh.scale.copy(scl);
        mesh.position.copy(c).negate();
        spin.add(mesh);
        pivot.add(spin);
        inner.add(pivot);
        this.wheels.push(pivot);
        if (pos.z > 0) this.frontWheels.push(pivot);
      } else {
        mesh.applyMatrix4(p.matrix);
        inner.add(mesh);
      }
    }
    const base = SPECS[this.kind];
    const halfW = (md.size.x * k) / 2;
    const halfL = (md.size.z * k) / 2;
    const height = md.size.y * k;
    this.spec = { ...base, halfW, halfL, height, wheelR, seat: [-halfW * 0.32, height * 0.36, halfL * 0.02] };
    this.seat.position.set(...this.spec.seat);
    this.root.add(this.seat);
    if (this.kind === 'catcherVan') {
      for (const sx of [-1, 1]) {
        const sign = makeSign('保健所', 1.5, 0.38, '#f4f4f0', '#2e7d32');
        sign.position.set(sx * (halfW + 0.03), height * 0.5, -halfL * 0.2);
        sign.rotation.y = (sx * Math.PI) / 2;
        this.root.add(sign);
      }
    }
  }

  animate(speed: number, steer: number, dt: number, lean = 0) {
    const r = this.spec.wheelR;
    for (const w of this.wheels) w.children[0].rotation.x += (speed / Math.max(r, 0.1)) * dt;
    for (const w of this.frontWheels) w.rotation.y = steer;
    this.body.rotation.z = lean;
    if (this.spec.bike) for (const w of this.wheels) w.rotation.z = lean;
  }
}
