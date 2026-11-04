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

const WHITE = '#fefdfb';
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
  private headBaseZ = 0.25;
  private idleT = 0;
  private lie = 0;

  constructor() {
    // ビションフリーゼのぬいぐるみ: 真っ白で毛足が長く、まんまるの頭
    const long = furMaterial(WHITE, 0.046, SHELLS, 230);
    const mid = furMaterial(WHITE, 0.034, SHELLS, 250);
    const short = furMaterial('#fbf9f5', 0.018, 14, 270);
    this.furs.push(long.uniforms, mid.uniforms, short.uniforms);

    // 刺しゅうのような、つやの少ない灰色の目と鼻
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#3b3c42', roughness: 0.38, metalness: 0.05 });
    const noseMat = new THREE.MeshStandardMaterial({ color: '#5d5f66', roughness: 0.6 });
    const pink = new THREE.MeshStandardMaterial({ color: '#f5a3b0', roughness: 0.55 });
    const mouthDark = new THREE.MeshStandardMaterial({ color: '#8a4552', roughness: 0.7 });

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

    // 胴体（ぬいぐるみらしく、ころんと長め）
    part(ell(0.17, 0.15, 0.26), long, SHELLS, this.body, 0, 0.29, 0);
    part(ell(0.145, 0.135, 0.12), long, SHELLS, this.body, 0, 0.35, 0.15);

    // 頭（ぽんぽんのような丸い頭）
    this.headBaseZ = 0.25;
    this.head.position.set(0, 0.45, this.headBaseZ);
    this.body.add(this.head);
    part(ell(0.16, 0.15, 0.15), long, SHELLS, this.head, 0, 0.03, 0.0);
    part(ell(0.125, 0.085, 0.115), long, SHELLS, this.head, 0, 0.13, -0.01);
    // 口のまわりのふわふわと、短いマズル
    part(ell(0.11, 0.08, 0.07), mid, SHELLS, this.head, 0, -0.035, 0.09);
    part(ell(0.055, 0.045, 0.05, 16), short, 14, this.head, 0, -0.04, 0.135);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10), noseMat);
    nose.position.set(0, -0.024, 0.2);
    nose.scale.set(1.35, 0.85, 0.85);
    this.head.add(nose);
    // いつもちょこっと出ている舌
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.017, 0.009, 0.02), pink);
    tip.position.set(0, -0.066, 0.186);
    tip.rotation.x = 0.35;
    this.head.add(tip);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.023, 16, 12), eyeMat);
      eye.position.set(sx * 0.06, 0.02, 0.172);
      eye.scale.set(1, 1.1, 0.7);
      this.head.add(eye);
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 4), new THREE.MeshBasicMaterial({ color: '#d9dbe0' }));
      hl.position.set(sx * 0.06 + 0.007, 0.029, 0.187);
      this.head.add(hl);
      // 垂れた長い耳
      const ear = new THREE.Group();
      ear.position.set(sx * 0.135, 0.05, -0.01);
      ear.rotation.z = sx * 0.15;
      this.head.add(ear);
      part(ell(0.055, 0.1, 0.065, 14), long, SHELLS, ear, 0, -0.075, 0);
      this.ears.push(ear);
    }
    // 口（あご）
    this.jaw.position.set(0, -0.07, 0.09);
    this.head.add(this.jaw);
    part(ell(0.045, 0.02, 0.05, 14), short, 14, this.jaw, 0, -0.006, 0.045);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.04, 0.011, 0.048), mouthDark);
    inner.position.set(0, 0.011, 0.045);
    this.jaw.add(inner);
    this.tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.028, 0.01, 0.046), pink);
    this.tongue.position.set(0, 0.015, 0.06);
    this.jaw.add(this.tongue);
    this.mouth.position.set(0, -0.085, 0.21);
    this.head.add(this.mouth);

    // しっぽ（ふさふさで上向き）
    this.tail.position.set(0, 0.37, -0.23);
    this.body.add(this.tail);
    part(ell(0.07, 0.105, 0.075, 16), long, SHELLS, this.tail, 0, 0.08, -0.03);

    // 脚（短く太く、前足はまんまる）
    const legGeo = new THREE.CapsuleGeometry(0.05, 0.11, 4, 10);
    const pawGeo = ell(0.062, 0.046, 0.072, 12);
    const legPos: [number, number][] = [
      [0.09, 0.15],
      [-0.09, 0.15],
      [0.09, -0.15],
      [-0.09, -0.15],
    ];
    for (const [x, z] of legPos) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.22, z);
      this.body.add(leg);
      part(legGeo, mid, SHELLS, leg, 0, -0.085, 0);
      part(pawGeo, mid, SHELLS, leg, 0, -0.178, 0.018);
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

    // じっとしていると伏せる（元のぬいぐるみの姿）
    this.idleT = speed < 0.15 && s.grounded && !s.carrying && !s.down && !s.sit && s.charge < 0.01 && s.biteT > 1 && s.barkT > 1 ? this.idleT + dt : 0;
    this.lie += ((this.idleT > 5 ? 1 : 0) - this.lie) * Math.min(1, dt * (this.idleT > 5 ? 2.5 : 8));
    // 脚（トロット）
    const sw = Math.sin(this.phase);
    const pairs = [sw, -sw, -sw, sw];
    for (let i = 0; i < 4; i++) {
      let target = pairs[i] * amp;
      if (!s.grounded && !s.swim) target = i < 2 ? -0.75 : 0.65;
      if (s.down) target = i < 2 ? -1.2 : 1.2;
      if (s.sit) target = i < 2 ? 0.5 : -1.45;
      if (this.lie > 0.01) target = target * (1 - this.lie) + (i < 2 ? -1.35 : 1.35) * this.lie;
      this.legs[i].rotation.x += (target - this.legs[i].rotation.x) * Math.min(1, dt * 18);
    }

    // 胴体の上下・ため
    let bodyY = Math.abs(Math.sin(this.phase)) * 0.03 * amp;
    bodyY -= s.charge * 0.035;
    this.body.position.y = bodyY - this.lie * 0.1;
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
