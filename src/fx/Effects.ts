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

/** 血しぶき・衝撃波・星・水しぶきなどの演出 */
export class Effects {
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
