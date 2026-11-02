import * as THREE from 'three';
import { clamp } from '../core/Rng';
import { furMaterial, shadowOnlyMaterial, type FurUniforms } from './Fur';

export interface DogAnimState {
  speed: number;
  grounded: boolean;
  vy: number;
  /** 噛みつきアニメの経過秒（大きいほど終了済み） */
  biteT: number;
  /** 吠えアニメの経過秒 */
  barkT: number;
  barkBig: boolean;
  /** 大吠えのため */
  charge: number;
  swim: boolean;
  happy: number;
  carrying: boolean;
  down: boolean;
  /** 乗り物に座っている */
  sit?: boolean;
}

const WHITE = '#fbf8f2';
const SHELLS = 20;

/** うしわか（元ぬいぐるみの白いもふもふ犬）の見た目とアニメーション */
export class DogModel {
  root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  private ears: THREE.Group[] = [];
  private tongue: THREE.Mesh;
  /** くわえた物を付ける場所 */
  mouth = new THREE.Object3D();
  private furs: FurUniforms[] = [];
  private phase = 0;
  private t = 0;
  private headBaseZ = 0.235;

  constructor() {
    const long = furMaterial(WHITE, 0.055, SHELLS, 150);
    const mid = furMaterial(WHITE, 0.035, SHELLS, 170);
    const short = furMaterial('#f6f1e8', 0.016, 12, 220);
    this.furs.push(long.uniforms, mid.uniforms, short.uniforms);

    const glossy = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.12, metalness: 0.1 });
    const pink = new THREE.MeshStandardMaterial({ color: '#f08a9a', roughness: 0.5 });
    const mouthDark = new THREE.MeshStandardMaterial({ color: '#7a2f3a', roughness: 0.7 });

    this.root.add(this.body);

    const ell = (rx: number, ry: number, rz: number, seg = 22) => new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)).scale(rx, ry, rz);
    const part = (geo: THREE.BufferGeometry, fur: { material: THREE.Material }, shells: number, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const im = new THREE.InstancedMesh(geo, fur.material, shells);
      im.position.set(x, y, z);
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = true;
      parent.add(im);
      const sh = new THREE.Mesh(geo, shadowOnlyMaterial);
      sh.position.set(x, y, z);
      sh.castShadow = true;
      parent.add(sh);
      return im;
    };

    // 胴体
    part(ell(0.17, 0.155, 0.25), long, SHELLS, this.body, 0, 0.3, 0);
    part(ell(0.14, 0.13, 0.12), long, SHELLS, this.body, 0, 0.36, 0.16);

    // 頭
    this.head.position.set(0, 0.44, this.headBaseZ);
    this.body.add(this.head);
    part(ell(0.14, 0.13, 0.135), long, SHELLS, this.head, 0, 0.02, 0.02);
    part(ell(0.068, 0.055, 0.075, 16), short, 12, this.head, 0, -0.035, 0.12);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), glossy);
    nose.position.set(0, -0.012, 0.195);
    nose.scale.set(1.15, 0.85, 0.9);
    this.head.add(nose);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), glossy);
      eye.position.set(sx * 0.056, 0.04, 0.122);
      this.head.add(eye);
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      hl.position.set(sx * 0.056 + 0.008, 0.05, 0.142);
      this.head.add(hl);
      const ear = new THREE.Group();
      ear.position.set(sx * 0.105, 0.075, 0.0);
      ear.rotation.z = sx * 0.55;
      this.head.add(ear);
      part(ell(0.04, 0.075, 0.055, 14), long, SHELLS, ear, 0, -0.05, 0);
      this.ears.push(ear);
    }
    // 口（あご）
    this.jaw.position.set(0, -0.065, 0.085);
    this.head.add(this.jaw);
    part(ell(0.05, 0.022, 0.062, 14), short, 12, this.jaw, 0, -0.006, 0.05);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.045, 0.012, 0.055), mouthDark);
    inner.position.set(0, 0.012, 0.05);
    this.jaw.add(inner);
    this.tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.03, 0.01, 0.05), pink);
    this.tongue.position.set(0, 0.016, 0.065);
    this.jaw.add(this.tongue);
    this.mouth.position.set(0, -0.075, 0.2);
    this.head.add(this.mouth);

    // 首輪と鈴
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 24), new THREE.MeshStandardMaterial({ color: '#d93a4a', roughness: 0.5 }));
    collar.position.set(0, 0.395, 0.17);
    collar.rotation.x = Math.PI / 2 + 0.5;
    this.body.add(collar);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.85, roughness: 0.25 }));
    bell.position.set(0, 0.315, 0.27);
    this.body.add(bell);
    // ぬいぐるみだった頃のタグ
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.006), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }));
    tag.position.set(0.16, 0.26, -0.17);
    tag.rotation.y = Math.PI / 2;
    tag.rotation.z = 0.25;
    this.body.add(tag);

    // しっぽ
    this.tail.position.set(0, 0.38, -0.22);
    this.body.add(this.tail);
    part(ell(0.075, 0.075, 0.085, 16), long, SHELLS, this.tail, 0, 0.05, -0.04);

    // 脚
    const legGeo = new THREE.CapsuleGeometry(0.046, 0.12, 4, 10);
    const pawGeo = ell(0.052, 0.04, 0.062, 12);
    const legPos: [number, number][] = [
      [0.088, 0.15],
      [-0.088, 0.15],
      [0.088, -0.15],
      [-0.088, -0.15],
    ];
    for (const [x, z] of legPos) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.22, z);
      this.body.add(leg);
      part(legGeo, mid, SHELLS, leg, 0, -0.09, 0);
      part(pawGeo, short, 12, leg, 0, -0.18, 0.012);
      this.legs.push(leg);
    }

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.Mesh).material !== shadowOnlyMaterial) {
        o.castShadow = true;
      }
    });
  }

  update(dt: number, s: DogAnimState) {
    this.t += dt;
    const t = this.t;
    const speed = s.speed;
    this.phase += dt * speed * (s.swim ? 5.5 : 3.3);
    const amp = clamp(speed / 3.5, 0, 1) * (s.swim ? 0.5 : 0.85);

    // 脚（トロット）
    const sw = Math.sin(this.phase);
    const pairs = [sw, -sw, -sw, sw];
    for (let i = 0; i < 4; i++) {
      let target = pairs[i] * amp;
      if (!s.grounded && !s.swim) target = i < 2 ? -0.75 : 0.65;
      if (s.down) target = i < 2 ? -1.2 : 1.2;
      if (s.sit) target = i < 2 ? 0.5 : -1.45;
      this.legs[i].rotation.x += (target - this.legs[i].rotation.x) * Math.min(1, dt * 18);
    }

    // 胴体の上下・ため
    let bodyY = Math.abs(Math.sin(this.phase)) * 0.03 * amp;
    bodyY -= s.charge * 0.035;
    this.body.position.y = bodyY;
    this.body.rotation.x = Math.sin(this.phase * 2) * 0.035 * amp + (s.grounded ? 0 : clamp(-s.vy * 0.04, -0.3, 0.3));
    this.body.scale.y = 1 + Math.sin(t * 3.2) * 0.012;
    this.body.position.x = s.charge > 0.05 ? Math.sin(t * 60) * 0.006 * s.charge : 0;
    this.root.rotation.z = s.down ? Math.PI / 2 : 0;
    if (s.sit) {
      this.body.rotation.x = -0.5;
      this.body.position.y = 0.06;
    }

    // 頭: 吠え・噛みつき
    const bdur = s.barkBig ? 0.7 : 0.32;
    const bark = s.barkT < bdur ? Math.sin((s.barkT / bdur) * Math.PI) : 0;
    const bp = s.biteT / 0.32;
    let jawOpen = 0;
    let lunge = 0;
    if (bp < 1) {
      jawOpen = bp < 0.45 ? bp / 0.45 : Math.max(0, 1 - (bp - 0.45) / 0.18);
      lunge = Math.sin(bp * Math.PI);
    }
    jawOpen = Math.max(jawOpen, bark * (s.barkBig ? 1 : 0.8));
    if (s.carrying) jawOpen = Math.max(jawOpen, 0.28);
    this.head.rotation.x = -0.42 * bark * (s.barkBig ? 1.3 : 1) + s.charge * 0.22 + Math.sin(t * 1.3) * 0.03;
    this.head.rotation.z = speed < 0.2 && !s.carrying ? Math.sin(t * 0.7) * 0.12 : 0;
    this.head.position.z = this.headBaseZ + 0.085 * lunge;
    this.jaw.rotation.x = 0.6 * jawOpen + (speed > 5 && !s.carrying ? 0.2 : 0);
    this.tongue.visible = jawOpen > 0.05 || speed > 5;

    // 耳・しっぽ
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const flop = Math.sin(this.phase + i) * 0.18 * amp + clamp(s.vy * 0.06, -0.3, 0.3) + bark * 0.3;
      this.ears[i].rotation.z = sx * (0.55 + flop);
    }
    const wagSpeed = 9 + s.happy * 9;
    this.tail.rotation.y = Math.sin(t * wagSpeed) * (0.3 + s.happy * 0.4);
    this.tail.rotation.x = -0.45;

    // 毛の重力（動きに合わせて少しなびく）
    for (const f of this.furs) f.uGravity.value.set(0, -0.35 - (s.swim ? 0.5 : 0), -clamp(speed * 0.06, 0, 0.5));
  }
}
