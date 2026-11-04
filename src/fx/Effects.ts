import * as THREE from 'three';
import type { Game } from '../core/Game';
import { rand } from '../core/Rng';

export interface StarsHandle {
  group: THREE.Group;
  anchor: THREE.Vector3;
}

const MAXP = 900;
const MAXD = 90;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** ふんわりした粒（炎・煙）。カメラの方を向く板にぼかしの画像を貼る */
class Soft {
  mesh: THREE.InstancedMesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private grow: Float32Array;
  private col: Float32Array;
  private i = 0;
  private c = new THREE.Color();

  constructor(scene: THREE.Scene, private additive: boolean, private max: number) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d')!;
    const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      opacity: additive ? 1 : 0.5,
      toneMapped: !additive,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 5 : 4;
    for (let k = 0; k < max; k++) {
      this.mesh.setMatrixAt(k, ZERO);
      this.mesh.setColorAt(k, this.c.set(0, 0, 0));
    }
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    scene.add(this.mesh);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.ColorRepresentation, size: number, life: number, grow: number) {
    const k = this.i;
    this.i = (this.i + 1) % this.max;
    this.pos.set([x, y, z], k * 3);
    this.vel.set([vx, vy, vz], k * 3);
    this.life[k] = this.maxLife[k] = life;
    this.size[k] = size;
    this.grow[k] = grow;
    this.c.set(color);
    this.col.set([this.c.r, this.c.g, this.c.b], k * 3);
  }

  update(dt: number, q: THREE.Quaternion) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        this.mesh.setMatrixAt(k, ZERO);
        continue;
      }
      const j = k * 3;
      this.vel[j] *= 1 - dt * 0.8;
      this.vel[j + 2] *= 1 - dt * 0.8;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const f = this.life[k] / this.maxLife[k];
      const age = this.maxLife[k] - this.life[k];
      let s = this.size[k] + this.grow[k] * age;
      if (this.additive) {
        const fade = f * f;
        this.mesh.setColorAt(k, this.c.setRGB(this.col[j] * fade, this.col[j + 1] * fade, this.col[j + 2] * fade));
      } else {
        s *= Math.min(1, f * 2.5);
        this.mesh.setColorAt(k, this.c.setRGB(this.col[j], this.col[j + 1], this.col[j + 2]));
      }
      _m.compose(_p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]), q, _s.set(s, s, s));
      this.mesh.setMatrixAt(k, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** 血しぶき・衝撃波・星・水しぶきなどの演出 */
export class Effects {
  private fire!: Soft;
  private smokeSoft!: Soft;
  private parts: THREE.InstancedMesh;
  private px = new Float32Array(MAXP * 3);
  private pv = new Float32Array(MAXP * 3);
  private life = new Float32Array(MAXP);
  private size = new Float32Array(MAXP);
  private ground = new Float32Array(MAXP);
  private grav = new Float32Array(MAXP);
  private flags = new Uint8Array(MAXP); // 1=地面に貼り付く 2=貼り付き済み
  private pi = 0;

  private decals: THREE.InstancedMesh;
  private dpos: THREE.Vector3[] = [];
  private drad = new Float32Array(MAXD);
  private dtarget = new Float32Array(MAXD);
  private drot = new Float32Array(MAXD);
  private di = 0;

  private rings: { mesh: THREE.Mesh; t: number; dur: number; r: number }[] = [];
  private stars: (StarsHandle & { t: number })[] = [];
  private starGeo = new THREE.OctahedronGeometry(0.07, 0);
  private starMat = new THREE.MeshBasicMaterial({ color: '#ffe14d' });

  constructor(private game: Game) {
    this.fire = new Soft(game.scene, true, 500);
    this.smokeSoft = new Soft(game.scene, false, 300);
    this.parts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.35 }), MAXP);
    this.parts.frustumCulled = false;
    for (let i = 0; i < MAXP; i++) {
      this.parts.setMatrixAt(i, ZERO);
      this.parts.setColorAt(i, new THREE.Color('#8a0a0a'));
    }
    game.scene.add(this.parts);

    const dgeo = new THREE.CircleGeometry(1, 22).rotateX(-Math.PI / 2);
    const pos = dgeo.getAttribute('position');
    for (let i = 1; i < pos.count; i++) {
      const k = 0.75 + Math.random() * 0.35;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    this.decals = new THREE.InstancedMesh(
      dgeo,
      new THREE.MeshStandardMaterial({ color: '#5a0306', roughness: 0.15, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
      MAXD,
    );
    this.decals.frustumCulled = false;
    this.decals.receiveShadow = true;
    for (let i = 0; i < MAXD; i++) {
      this.decals.setMatrixAt(i, ZERO);
      this.dpos.push(new THREE.Vector3());
    }
    game.scene.add(this.decals);

    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 56).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.visible = false;
      game.scene.add(mesh);
      this.rings.push({ mesh, t: 9, dur: 0.5, r: 1 });
    }
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.ColorRepresentation, size: number, life: number, grav: number, groundY: number, stick: boolean) {
    const i = this.pi;
    this.pi = (this.pi + 1) % MAXP;
    this.px[i * 3] = x;
    this.px[i * 3 + 1] = y;
    this.px[i * 3 + 2] = z;
    this.pv[i * 3] = vx;
    this.pv[i * 3 + 1] = vy;
    this.pv[i * 3 + 2] = vz;
    this.life[i] = life;
    this.size[i] = size;
    this.grav[i] = grav;
    this.ground[i] = groundY;
    this.flags[i] = stick ? 1 : 0;
    this.parts.setColorAt(i, _tmpC.set(color));
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;
  }

  bloodSpray(pos: THREE.Vector3, dir: THREE.Vector3, n: number, groundY: number) {
    for (let k = 0; k < n; k++) {
      const sp = rand.range(1.2, 4.2);
      this.emit(
        pos.x,
        pos.y,
        pos.z,
        dir.x * sp + rand.range(-1.4, 1.4),
        rand.range(0.8, 3.8),
        dir.z * sp + rand.range(-1.4, 1.4),
        rand.pick(['#8a0a0a', '#a30d12', '#6e0508', '#b5121b']),
        rand.range(0.025, 0.06),
        rand.range(8, 14),
        -18,
        groundY + 0.012,
        true,
      );
    }
    for (let k = 0; k < 2; k++) {
      this.decal(new THREE.Vector3(pos.x + dir.x * rand.range(0.3, 1.2) + rand.range(-0.3, 0.3), groundY, pos.z + dir.z * rand.range(0.3, 1.2) + rand.range(-0.3, 0.3)), rand.range(0.12, 0.28), 0.05);
    }
  }

  bloodPool(pos: THREE.Vector3, scale: number) {
    this.decal(pos, rand.range(0.75, 1.0) * scale, 0.05);
  }

  private decal(pos: THREE.Vector3, target: number, start: number) {
    const i = this.di;
    this.di = (this.di + 1) % MAXD;
    this.dpos[i].set(pos.x, pos.y + 0.014 + i * 0.00005, pos.z);
    this.drad[i] = start;
    this.dtarget[i] = target;
    this.drot[i] = rand.range(0, Math.PI * 2);
  }

  splash(pos: THREE.Vector3) {
    for (let k = 0; k < 24; k++) {
      const a = rand.range(0, Math.PI * 2);
      const s = rand.range(0.6, 2.2);
      this.emit(pos.x, pos.y + 0.1, pos.z, Math.cos(a) * s, rand.range(2, 4.5), Math.sin(a) * s, rand.pick(['#e8f6ff', '#bfe3ff', '#ffffff']), rand.range(0.03, 0.06), 0.9, -16, -99, false);
    }
  }

  private fireballs: { mesh: THREE.Mesh; t: number }[] = [];

  fuseSpark(pos: THREE.Vector3) {
    this.emit(pos.x, pos.y, pos.z, rand.range(-0.6, 0.6), rand.range(0.5, 1.5), rand.range(-0.6, 0.6), rand.pick(['#ffd166', '#ffffff', '#ff9f1c']), 0.018, 0.3, -6, -99, false);
  }

  explosion(pos: THREE.Vector3, groundY: number, scale = 1) {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 1, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), mat);
    mesh.position.copy(pos);
    mesh.userData.scale = scale;
    this.game.scene.add(mesh);
    this.fireballs.push({ mesh, t: 0 });
    for (let k = 0; k < 70; k++) {
      const a = rand.range(0, Math.PI * 2);
      const e = rand.range(0.1, 1.4);
      const s = rand.range(3, 11);
      this.emit(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s, rand.pick(['#ff7b00', '#ffb703', '#ffd166', '#e85d04', '#ffffff']), rand.range(0.06, 0.16), rand.range(0.4, 0.9), -9, -99, false);
    }

    for (let k = 0; k < 26; k++) {
      const a = rand.range(0, Math.PI * 2);
      const r = rand.range(0, 2.6);
      this.emit(pos.x + Math.cos(a) * r, groundY + 0.5, pos.z + Math.sin(a) * r, 0, -1, 0, '#1b1b1b', rand.range(0.35, 0.7), 30, -20, groundY + 0.015, true);
    }
    this.ring(new THREE.Vector3(pos.x, groundY + 0.2, pos.z), 9 * scale, 0.5, '#ffe8c0', 0.8);
    for (let k = 0; k < 40; k++) {
      const a = rand.range(0, Math.PI * 2);
      const s = rand.range(1, 6) * scale;
      this.fire.emit(pos.x, pos.y + 0.4, pos.z, Math.cos(a) * s, rand.range(1, 6), Math.sin(a) * s, rand.pick(['#ff7b00', '#ffb703', '#ffd166', '#ff5400']), rand.range(1.0, 2.2) * scale, rand.range(0.4, 0.9), 1.2);
    }
    for (let k = 0; k < 26; k++) {
      const a = rand.range(0, Math.PI * 2);
      const s = rand.range(0.5, 3) * scale;
      this.smokeSoft.emit(pos.x, pos.y + 0.8, pos.z, Math.cos(a) * s, rand.range(1.5, 4), Math.sin(a) * s, rand.pick(['#2f2f2f', '#4a4a4a', '#5e5e5e']), rand.range(1.2, 2.0) * scale, rand.range(2.5, 4.5), 1.4);
    }
  }

  flame(pos: THREE.Vector3, size: number) {
    this.fire.emit(pos.x, pos.y, pos.z, rand.range(-0.25, 0.25), rand.range(1.3, 2.6), rand.range(-0.25, 0.25), rand.pick(['#ff7b00', '#ffb703', '#ff9a1f', '#e85d04']), rand.range(0.3, 0.55) * size, rand.range(0.35, 0.7), 0.2, );
    if (Math.random() < 0.2) this.smokeSoft.emit(pos.x, pos.y + 0.6, pos.z, rand.range(-0.2, 0.2), rand.range(1, 1.8), rand.range(-0.2, 0.2), rand.pick(['#3a3a3a', '#4a4a4a']), rand.range(0.4, 0.6) * size, rand.range(1.2, 2), 0.6);
  }

  bloodDrip(pos: THREE.Vector3) {
    this.emit(pos.x + rand.range(-0.15, 0.15), pos.y + 0.3, pos.z + rand.range(-0.15, 0.15), 0, -0.5, 0, rand.pick(['#8a0a0a', '#6e0508']), rand.range(0.03, 0.06), 10, -15, pos.y + 0.013, true);
  }

  skid(pos: THREE.Vector3) {
    this.emit(pos.x + rand.range(-0.6, 0.6), pos.y + 0.2, pos.z + rand.range(-0.6, 0.6), 0, -1, 0, '#1e1e1e', rand.range(0.18, 0.28), 12, -20, pos.y + 0.012, true);
    if (Math.random() < 0.4) this.emit(pos.x, pos.y + 0.2, pos.z, rand.range(-0.5, 0.5), rand.range(0.5, 1.2), rand.range(-0.5, 0.5), '#cfcfcf', rand.range(0.12, 0.2), 0.8, 0.5, -99, false);
  }

  smoke(pos: THREE.Vector3, dark: boolean) {
    this.smokeSoft.emit(pos.x + rand.range(-0.2, 0.2), pos.y, pos.z + rand.range(-0.2, 0.2), rand.range(-0.3, 0.3), rand.range(1.2, 2.2), rand.range(-0.3, 0.3), dark ? rand.pick(['#2a2a2a', '#353535', '#1f1f1f']) : rand.pick(['#a0a0a0', '#b8b8b8']), rand.range(0.45, 0.7), rand.range(1.4, 2.4), 0.9);
    if (dark && Math.random() < 0.4) this.fire.emit(pos.x, pos.y - 0.2, pos.z, rand.range(-0.3, 0.3), rand.range(0.8, 1.6), rand.range(-0.3, 0.3), rand.pick(['#ff7b00', '#ffb703']), rand.range(0.3, 0.5), 0.5, 0.2);
  }

  sparks(pos: THREE.Vector3) {
    for (let k = 0; k < 18; k++) {
      this.emit(pos.x, pos.y + 0.6, pos.z, rand.range(-4, 4), rand.range(1, 5), rand.range(-4, 4), rand.pick(['#ffd166', '#ffb703', '#ffffff']), rand.range(0.02, 0.04), 0.5, -14, -99, false);
    }
  }

  ripple(pos: THREE.Vector3) {
    this.ring(new THREE.Vector3(pos.x, pos.y + 0.08, pos.z), 0.8, 0.7, '#e8f6ff', 0.6);
  }

  hearts(pos: THREE.Vector3) {
    for (let k = 0; k < 14; k++) {
      this.emit(pos.x + rand.range(-0.3, 0.3), pos.y, pos.z + rand.range(-0.3, 0.3), rand.range(-0.4, 0.4), rand.range(0.6, 1.4), rand.range(-0.4, 0.4), rand.pick(['#ff6fa5', '#ff9ec7', '#ff4d8d']), rand.range(0.05, 0.08), 1.4, 0.4, -99, false);
    }
  }

  shockwave(pos: THREE.Vector3, radius: number, big: boolean) {
    this.ring(pos.clone(), radius, big ? 0.55 : 0.35, big ? '#ff4d8d' : '#ffffff', big ? 0.75 : 0.55);
    if (big) this.ring(pos.clone().setY(pos.y - 0.3), radius * 0.7, 0.45, '#ffd166', 0.6);
  }

  private ring(pos: THREE.Vector3, radius: number, dur: number, color: string, opacity: number) {
    const r = this.rings.find((x) => x.t >= x.dur) ?? this.rings[0];
    r.t = 0;
    r.dur = dur;
    r.r = radius;
    r.mesh.position.copy(pos);
    r.mesh.visible = true;
    const m = r.mesh.material as THREE.MeshBasicMaterial;
    m.color.set(color);
    m.userData.opacity = opacity;
  }

  addStars(): StarsHandle {
    const group = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(this.starGeo, this.starMat);
      group.add(s);
    }
    this.game.scene.add(group);
    const h = { group, anchor: new THREE.Vector3(), t: rand.range(0, 6) };
    this.stars.push(h);
    return h;
  }

  removeStars(h: StarsHandle) {
    this.game.scene.remove(h.group);
    const i = this.stars.indexOf(h as StarsHandle & { t: number });
    if (i >= 0) this.stars.splice(i, 1);
  }

  update(dt: number) {
    const cq = this.game.camera.quaternion;
    this.fire.update(dt, cq);
    this.smokeSoft.update(dt, cq);
    // 粒子
    for (let i = 0; i < MAXP; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.parts.setMatrixAt(i, ZERO);
        continue;
      }
      const j = i * 3;
      const s = this.size[i];
      if (this.flags[i] === 2) {
        const fade = Math.min(1, this.life[i] / 2);
        _m.compose(_p.set(this.px[j], this.px[j + 1], this.px[j + 2]), _q.identity(), _s.set(s * 1.8 * fade, 0.004, s * 1.8 * fade));
        this.parts.setMatrixAt(i, _m);
        continue;
      }
      this.pv[j + 1] += this.grav[i] * dt;
      this.px[j] += this.pv[j] * dt;
      this.px[j + 1] += this.pv[j + 1] * dt;
      this.px[j + 2] += this.pv[j + 2] * dt;
      if (this.px[j + 1] < this.ground[i]) {
        if (this.flags[i] === 1) {
          this.px[j + 1] = this.ground[i];
          this.flags[i] = 2;
        } else this.life[i] = Math.min(this.life[i], 0.05);
      }
      const shrink = Math.min(1, this.life[i] * 3);
      _m.compose(_p.set(this.px[j], this.px[j + 1], this.px[j + 2]), _q.setFromEuler(_e.set(this.life[i] * 7, this.life[i] * 5, 0)), _s.setScalar(s * shrink));
      this.parts.setMatrixAt(i, _m);
    }
    this.parts.instanceMatrix.needsUpdate = true;

    // 血だまり
    for (let i = 0; i < MAXD; i++) {
      if (this.dtarget[i] <= 0) continue;
      this.drad[i] += (this.dtarget[i] - this.drad[i]) * Math.min(1, dt * 0.9);
      const r = this.drad[i];
      _m.compose(this.dpos[i], _q.setFromEuler(_e.set(0, this.drot[i], 0)), _s.set(r, 1, r * 0.85));
      this.decals.setMatrixAt(i, _m);
    }
    this.decals.instanceMatrix.needsUpdate = true;

    // 衝撃波の輪
    for (const r of this.rings) {
      if (r.t >= r.dur) {
        r.mesh.visible = false;
        continue;
      }
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(0.2 + r.r * e);
      const m = r.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = (m.userData.opacity ?? 0.6) * (1 - k);
    }

    // 爆発の火の玉
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.t += dt;
      const k = f.t / 0.6;
      f.mesh.scale.setScalar((0.5 + Math.sqrt(Math.min(1, k)) * 4.5) * (f.mesh.userData.scale ?? 1));
      const m = f.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, 1 - k);
      m.color.setRGB(1, 0.75 - k * 0.5, 0.35 - k * 0.3);
      if (k >= 1) {
        this.game.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        m.dispose();
        this.fireballs.splice(i, 1);
      }
    }

    // 気絶の星
    for (const h of this.stars) {
      h.t += dt;
      h.group.position.copy(h.anchor).add(_p.set(0, 0.32, 0));
      h.group.children.forEach((c, i) => {
        const a = h.t * 3 + (i / 3) * Math.PI * 2;
        c.position.set(Math.cos(a) * 0.25, Math.sin(h.t * 5 + i) * 0.04, Math.sin(a) * 0.25);
        c.rotation.y = h.t * 4;
      });
    }
  }
}

const _tmpC = new THREE.Color();
