import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Assets, CharacterBase } from '../assets/Assets';
import { clamp } from '../core/Rng';
import { colorMat, HumanModel, type HumanLook, type HumanMode } from './Human';

/** HumanModel と KenneyHuman の共通の形 */
export interface HumanLike {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Object3D;
  look: HumanLook;
  fall: number;
  fallDir: number;
  kick: number;
  hop: number;
  headWorld(out?: THREE.Vector3): THREE.Vector3;
  animate(dt: number, mode: HumanMode, speed: number): void;
}

const texCache = new Map<string, THREE.Texture>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** 肌（Kenney のスキン）の服と髪の色を塗り替えたテクスチャを作る */
function skinTexture(base: CharacterBase, skin: string, look: HumanLook, recolor: boolean) {
  const key = recolor ? `${skin}|${look.top}|${look.bottom}|${look.hair}` : skin;
  const hit = texCache.get(key);
  if (hit) return hit;
  const img = base.skins.get(skin) ?? base.skins.values().next().value!;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  if (recolor) {
    const W = img.width;
    const H = img.height;
    const d = ctx.getImageData(0, 0, W, H);
    const top = new THREE.Color(look.top);
    const bottom = new THREE.Color(look.bottom);
    const hair = new THREE.Color(look.hair);
    const sx = W / 256;
    const sy = H / 256;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = d.data[i] / 255;
        const g = d.data[i + 1] / 255;
        const b = d.data[i + 2] / 255;
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        const skinLike = r > g && g > b && r - b > 0.16 && r > 0.55;
        let tint: THREE.Color | null = null;
        let k = 1.15;
        if (x < 150 * sx && y >= 118 * sy && !skinLike) tint = top;
        else if (x >= 150 * sx && y >= 190 * sy) {
          tint = bottom;
          k = 1.6;
        } else if (y < 112 * sy && lum < 0.36 && !skinLike) {
          tint = hair;
          k = 2.4;
        }
        if (tint) {
          const f = Math.min(1.25, lum * k);
          d.data[i] = Math.min(255, tint.r * f * 255);
          d.data[i + 1] = Math.min(255, tint.g * f * 255);
          d.data[i + 2] = Math.min(255, tint.b * f * 255);
        }
      }
    }
    ctx.putImageData(d, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

function skinMaterial(tex: THREE.Texture) {
  let m = matCache.get(tex.uuid);
  if (!m) matCache.set(tex.uuid, (m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })));
  return m;
}

const box = (w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), colorMat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Kenney のアニメーション付きキャラクター（見た目は HumanModel と同じ使い方） */
export class KenneyHuman implements HumanLike {
  root = new THREE.Group();
  body = new THREE.Group();
  /** 頭の位置について動く（帽子・角などを付ける） */
  head = new THREE.Group();
  private hand = new THREE.Group();
  private chest = new THREE.Group();
  fall = 0;
  fallDir = -1;
  kick = 0;
  hop = 0;
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction | null;
  private run: THREE.AnimationAction | null;
  private current: 'idle' | 'run' = 'idle';
  private bones: Record<string, THREE.Bone> = {};
  private char: THREE.Object3D;
  private t = Math.random() * 10;
  private hunch: number;

  constructor(public look: HumanLook, base: CharacterBase, skin: string, recolor: boolean) {
    const ch = SkeletonUtils.clone(base.mesh);
    const s = look.height / base.height;
    ch.scale.setScalar(s);
    const mat = skinMaterial(skinTexture(base, skin, look, recolor));
    ch.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.material = mat;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
      }
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
    });
    this.char = ch;
    this.root.add(this.body);
    this.body.add(ch, this.head, this.hand, this.chest);
    this.mixer = new THREE.AnimationMixer(ch);
    this.idle = base.clips.idle ? this.mixer.clipAction(base.clips.idle) : null;
    this.run = base.clips.run ? this.mixer.clipAction(base.clips.run) : null;
    this.idle?.play();
    this.mixer.update(Math.random() * 2);
    this.hunch = look.hunch;
    this.addExtras();
  }

  private addExtras() {
    const L = this.look;
    const H = L.height / 1.7;
    if (L.hairStyle === 'cap' || L.hat) {
      if (L.hairStyle === 'cap') {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2 * H, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), colorMat(L.hat ?? '#3355aa'));
        cap.position.set(0, 0.23 * H, 0);
        cap.scale.set(1.12, 0.62, 1.12);
        cap.castShadow = true;
        const brim = box(0.3 * H, 0.025, 0.18 * H, L.hat ?? '#3355aa', 0, 0.24 * H, 0.2 * H);
        this.head.add(cap, brim);
      }
    }
    if (L.backpack) this.chest.add(box(0.3 * H, 0.32 * H, 0.16 * H, L.backpack, 0, -0.05 * H, -0.17 * H));
    if (L.tie) this.chest.add(box(0.05 * H, 0.22 * H, 0.02, L.tie, 0, -0.05 * H, 0.12 * H));
    if (L.apron) this.chest.add(box(0.3 * H, 0.42 * H, 0.02, L.apron, 0, -0.2 * H, 0.125 * H));
    if (L.cane) {
      const cane = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.85 * H, 6), colorMat('#5a3d28'));
      cane.position.set(0, -0.4 * H, 0.04);
      this.hand.add(cane);
    }
    if (L.gun) {
      const black = colorMat('#1b1b1e');
      const len = L.gun === 'rifle' ? 0.75 : 0.22;
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, len), black);
      g.position.set(0, -0.02, len / 2 - 0.04);
      this.hand.add(g);
    }
    if (L.net) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.5, 6), colorMat('#8a8a8a'));
      pole.rotation.x = Math.PI / 2;
      pole.position.set(0, 0, 0.7);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.018, 6, 18), colorMat('#5a5a5a'));
      ring.position.set(0, 0, 1.45);
      ring.rotation.x = Math.PI / 2;
      const net = new THREE.Mesh(
        new THREE.ConeGeometry(0.25, 0.42, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: '#dddddd', transparent: true, opacity: 0.55, side: THREE.DoubleSide, wireframe: true }),
      );
      net.position.set(0, -0.2, 1.45);
      net.rotation.x = Math.PI;
      this.hand.add(pole, ring, net);
    }
  }

  headWorld(out = new THREE.Vector3()) {
    this.head.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.head.matrixWorld);
  }

  private play(name: 'idle' | 'run') {
    if (this.current === name) return;
    const from = name === 'run' ? this.idle : this.run;
    const to = name === 'run' ? this.run : this.idle;
    if (!to) return;
    to.reset().play();
    if (from) to.crossFadeFrom(from, 0.25, false);
    this.current = name;
  }

  /** 骨をローカル軸まわりに追加で回す */
  private turn(name: string, x: number, y: number, z: number) {
    const b = this.bones[name];
    if (!b) return;
    _q.setFromEuler(_e.set(x, y, z));
    b.quaternion.multiply(_q);
  }

  animate(dt: number, mode: HumanMode, speed: number) {
    this.t += dt;
    const moving = mode === 'walk' || mode === 'run' || mode === 'panic';
    this.play(moving && speed > 0.1 ? 'run' : 'idle');
    if (this.run) this.run.timeScale = mode === 'walk' ? clamp(speed / 2.6, 0.35, 0.75) : clamp(speed / 4.6, 0.7, 1.4);
    this.mixer.update(dt);

    // 手続き的な上書き（腰の曲がり・両手を上げる・キック・手を振る）
    if (this.hunch > 0) this.turn('Spine', this.hunch, 0, 0);
    if (mode === 'panic' || mode === 'cower') {
      const w = Math.sin(this.t * 16) * 0.25;
      this.turn('LeftArm', 0, 0, mode === 'cower' ? -1.0 : -1.3 + w);
      this.turn('RightArm', 0, 0, mode === 'cower' ? 1.0 : 1.3 - w);
    }
    if (mode === 'wave') this.turn('RightArm', 0, 0, 1.4 + Math.sin(this.t * 9) * 0.35);
    if (this.kick > 0) this.turn('RightUpLeg', -this.kick * 1.3, 0, 0);
    if (mode === 'lie') {
      this.turn('LeftArm', 0, 0, -0.9);
      this.turn('RightArm', 0, 0, 0.9);
    }

    // 倒れる
    const targetFall = mode === 'lie' ? 1 : 0;
    this.fall += (targetFall - this.fall) * Math.min(1, dt * (targetFall ? 7 : 4));
    const f = clamp(this.fall, 0, 1);
    this.body.rotation.x = this.fallDir * (Math.PI / 2) * f;
    this.body.position.y = 0.16 * f + this.hop;
    this.hop = Math.max(0, this.hop - dt * 1.8);

    // 付属品を骨に合わせる
    this.char.updateMatrixWorld(true);
    this.body.updateMatrixWorld(true);
    this.follow('Head', this.head, false);
    this.follow('RightHand', this.hand, true);
    this.follow('UpperChest', this.chest, false);
  }

  private follow(bone: string, g: THREE.Object3D, rotate: boolean) {
    const b = this.bones[bone];
    if (!b) return;
    b.getWorldPosition(_v);
    this.body.worldToLocal(_v);
    g.position.copy(_v);
    if (rotate) {
      b.getWorldQuaternion(_q);
      this.body.getWorldQuaternion(_q2).invert();
      g.quaternion.copy(_q2.multiply(_q));
    }
  }
}

/** 見た目に合わせて Kenney キャラか、コードの人形を作る */
export function createHuman(assets: Assets, look: HumanLook, kind: string, seed = Math.random()): HumanLike {
  const base = assets.character;
  if (!base) return new HumanModel(look);
  const female = look.skirt || ['long', 'bun', 'ponytail'].includes(look.hairStyle);
  let skin = female ? 'humanFemaleA' : 'humanMaleA';
  let recolor = true;
  if (kind === 'man' && seed < 0.2) {
    skin = 'skaterMaleA';
    recolor = false;
  } else if (kind === 'man' && seed < 0.32) {
    skin = 'criminalMaleA';
    recolor = false;
  } else if (kind === 'woman' && seed < 0.25) {
    skin = 'skaterFemaleA';
    recolor = false;
  }
  if (!base.skins.has(skin)) {
    skin = 'humanMaleA';
    recolor = true;
  }
  return new KenneyHuman(look, base, skin, recolor);
}
