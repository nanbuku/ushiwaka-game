import * as THREE from 'three';
import { smoothstep } from '../core/Rng';
import { applyNight } from './Kit';

const C = (hex: number) => new THREE.Color(hex);
const PAL = {
  dayTop: C(0x3f8be0),
  dayHorizon: C(0xc4e4ff),
  nightTop: C(0x030714),
  nightHorizon: C(0x16213f),
  duskTop: C(0x4b5a9c),
  duskHorizon: C(0xff9a5c),
};

/** 空・太陽・昼夜サイクル（見た目だけ。ゲーム内容は変わらない） */
export class SkySystem {
  /** ゲーム内の時刻（0〜24） */
  hours = 9;
  /** 現実の何秒でゲーム内1日が過ぎるか */
  dayLengthSec = 24 * 60;
  sun = new THREE.DirectionalLight(0xffffff, 2.6);
  hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5c5244, 1.0);
  dome: THREE.Mesh;
  night = 0;
  fog: THREE.Fog;
  private sunDir = new THREE.Vector3();
  private uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };

  constructor(private scene: THREE.Scene) {
    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(2048, 2048);
    const cam = s.shadow.camera;
    cam.left = -45;
    cam.right = 45;
    cam.top = 45;
    cam.bottom = -45;
    cam.near = 1;
    cam.far = 260;
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.03;
    scene.add(s, s.target, this.hemi);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight; uniform float uTime;
        varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y); }
        float fbm2(vec2 p){ float v = 0.0; float a = 0.5; for (int k = 0; k < 5; k++) { v += a * n2(p); p *= 2.02; a *= 0.5; } return v; }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
          if (h < 0.0) col = mix(uHorizon, uHorizon * 0.55, clamp(-h * 5.0, 0.0, 1.0));
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 10.0) * 0.18) * (1.0 - uNight);
          vec3 moonDir = normalize(vec3(-uSunDir.x, -uSunDir.y, uSunDir.z));
          float md = max(dot(d, moonDir), 0.0);
          col += vec3(0.85, 0.9, 1.0) * (pow(md, 2200.0) * 3.0 + pow(md, 60.0) * 0.06) * uNight;
          if (h > 0.0) {
            vec3 cell = floor(d * 260.0);
            float st = step(0.9972, hash(cell));
            col += vec3(st) * uNight * smoothstep(0.0, 0.3, h) * 0.9;
          }
          // 流れる雲
          if (h > 0.0) {
            vec2 uv = d.xz / (h + 0.12) * 0.55 + vec2(uTime * 0.004, uTime * 0.0015);
            float c = smoothstep(0.5, 0.82, fbm2(uv * 1.6));
            float shade = fbm2(uv * 3.1 + 7.0);
            vec3 cloudCol = mix(vec3(1.0, 1.0, 1.0), vec3(0.72, 0.76, 0.84), shade * 0.7);
            cloudCol = mix(cloudCol, uHorizon * 0.9 + vec3(0.1), clamp(1.0 - h * 3.0, 0.0, 1.0) * 0.5);
            cloudCol *= mix(1.0, 0.18, uNight);
            col = mix(col, cloudCol, c * smoothstep(0.0, 0.18, h) * 0.9);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.fog = new THREE.Fog(0xc4e4ff, 110, 820);
    scene.fog = this.fog;
  }

  get clockText() {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt: number, focus: THREE.Vector3, camPos: THREE.Vector3) {
    this.hours = (this.hours + (dt * 24) / this.dayLengthSec) % 24;
    const a = ((this.hours - 6) / 12) * Math.PI;
    const sy = Math.sin(a);
    this.sunDir.set(Math.cos(a), sy * 0.92, 0.38).normalize();
    const day = smoothstep(-0.14, 0.22, sy);
    const dusk = Math.exp(-((sy / 0.2) ** 2));
    this.night = 1 - day;

    const top = new THREE.Color().copy(PAL.nightTop).lerp(PAL.dayTop, day).lerp(PAL.duskTop, dusk * 0.5);
    const hor = new THREE.Color().copy(PAL.nightHorizon).lerp(PAL.dayHorizon, day).lerp(PAL.duskHorizon, dusk * 0.7);
    this.uniforms.uTop.value.copy(top);
    this.uniforms.uHorizon.value.copy(hor);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uNight.value = this.night;
    this.uniforms.uTime.value += dt * 60;
    this.fog.color.copy(hor);

    // 太陽または月
    if (sy > -0.06) {
      this.sun.position.copy(this.sunDir).multiplyScalar(120).add(focus);
      this.sun.intensity = 2.7 * day + 0.25;
      this.sun.color.setRGB(1, 0.93 - dusk * 0.25, 0.85 - dusk * 0.45);
    } else {
      const moon = new THREE.Vector3(-this.sunDir.x, -this.sunDir.y, this.sunDir.z);
      this.sun.position.copy(moon).multiplyScalar(120).add(focus);
      this.sun.intensity = 0.45;
      this.sun.color.setRGB(0.62, 0.72, 1.0);
    }
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.hemi.intensity = 0.35 + 0.85 * day;
    this.hemi.color.copy(top).lerp(new THREE.Color(1, 1, 1), 0.55);

    this.dome.position.copy(camPos);
    applyNight(this.night);
  }
}
