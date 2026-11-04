import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G, type RAPIER } from '../core/Physics';
import { clamp, rand } from '../core/Rng';
import type { NPC } from '../npc/NPC';
import type { Vehicle } from '../vehicles/Vehicle';

export interface ShotHit {
  point: THREE.Vector3;
  dist: number;
  npc: NPC | null;
  vehicle: Vehicle | null;
  player: boolean;
  collider: RAPIER.Collider | null;
}

export interface ShotOpt {
  /** この当たり判定は無視する（自分の乗り物など） */
  exclude?: RAPIER.Collider;
  /** うしわかにも当たる（敵の弾） */
  hitPlayer?: boolean;
  /** 当たる人を絞る */
  npcFilter?: (n: NPC) => boolean;
}

/**
 * 弾を1発撃ったときに何に当たるかを調べる（見えない光線で判定する）。
 * 建物・車は物理の光線、人とうしわかは縦長の円柱として計算する。
 */
export function castShot(g: Game, origin: THREE.Vector3, dir: THREE.Vector3, range: number, opt: ShotOpt = {}): ShotHit {
  const r = g.physics.raycast(origin, dir, range, G.STATIC | G.VEHICLE, opt.exclude);
  let dist = r ? r.dist : range;
  let collider = r ? r.collider : null;
  let npc: NPC | null = null;
  let player = false;
  const hh = dir.x * dir.x + dir.z * dir.z;
  const test = (px: number, py: number, pz: number, rad: number, height: number) => {
    if (hh < 1e-4) return -1;
    const cx = px - origin.x;
    const cz = pz - origin.z;
    const t = (cx * dir.x + cz * dir.z) / hh;
    if (t <= 0 || t >= dist) return -1;
    const ex = cx - dir.x * t;
    const ez = cz - dir.z * t;
    if (ex * ex + ez * ez > rad * rad) return -1;
    const y = origin.y + dir.y * t;
    if (y < py - 0.05 || y > py + height) return -1;
    return t;
  };
  for (const n of g.npcs.list) {
    if (!n.alive || (opt.npcFilter && !opt.npcFilter(n))) continue;
    const t = test(n.pos.x, n.pos.y, n.pos.z, n.radius + 0.12, n.height + 0.1);
    if (t > 0) {
      dist = t;
      npc = n;
      collider = null;
    }
  }
  const p = g.player;
  if (opt.hitPlayer && !p.driving && !p.dead) {
    const t = test(p.pos.x, p.pos.y, p.pos.z, 0.42, 0.75);
    if (t > 0) {
      dist = t;
      player = true;
      npc = null;
      collider = null;
    }
  }
  let vehicle: Vehicle | null = null;
  if (collider) for (const v of g.traffic.list) if (v.collider.handle === collider.handle) vehicle = v;
  return { point: origin.clone().addScaledVector(dir, dist), dist, npc, vehicle, player, collider };
}

/** 弾の通り道（一瞬だけ光る筋） */
export class Tracers {
  private list: { line: THREE.Line; t: number; life: number }[] = [];

  constructor(private scene: THREE.Scene) {}

  add(a: THREE.Vector3, b: THREE.Vector3, color = '#ffe08a', life = 0.06) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    this.scene.add(line);
    this.list.push({ line, t: life, life });
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const l = this.list[i];
      l.t -= dt;
      (l.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, l.t / l.life);
      if (l.t <= 0) {
        this.scene.remove(l.line);
        l.line.geometry.dispose();
        (l.line.material as THREE.Material).dispose();
        this.list.splice(i, 1);
      }
    }
  }
}

/** うしわかの弾が当たったときの処理 */
export function playerShotHit(g: Game, hit: ShotHit, dmg: number, from: THREE.Vector3) {
  const n = hit.npc;
  if (n) {
    const wasAlive = n.alive;
    const r = n.bitten(dmg, from);
    if (wasAlive && r === 'kill') {
      g.karma.crime('kill', n.pos, n.kind, 1, 'gun');
      g.npcs.panicAround(n.pos, 35, n);
    } else if (r === 'bite') {
      g.karma.crime('shoot', n.pos, n.kind);
      g.npcs.panicAround(n.pos, 30, n);
    }
    return;
  }
  g.fx.sparks(hit.point);
  if (hit.vehicle) {
    hit.vehicle.hp -= dmg * (hit.vehicle.kind === 'tank' ? 0.02 : 0.12);
    return;
  }
  if (hit.collider && g.story.onShot(hit.collider.handle, dmg)) return;
  if (hit.collider && g.airforce.onShot(hit.collider.handle, dmg)) return;
  if (hit.collider) {
    const o = g.destruction.byCollider(hit.collider.handle);
    if (o) g.destruction.damage(o, dmg * 0.3, from, true, true);
  }
}

// =====================================================================
// 核爆弾
// =====================================================================
const NUKE_R = 165;
const NUKE_TIME = 2.4;
const FUSE = 10;

/** 置いてから10秒で起爆。巨大な火の玉と衝撃波が街を消し飛ばす */
export class Nukes {
  device: { mesh: THREE.Group; light: THREE.Mesh; pos: THREE.Vector3; t: number; beep: number } | null = null;
  cooldown = 0;
  private blasts: {
    pos: THREE.Vector3;
    t: number;
    r: number;
    scale: number;
    hitPlayer: boolean;
    kills: number;
    wrecks: number;
    group: THREE.Group;
    fireball: THREE.Mesh;
    stem: THREE.Mesh;
    cap: THREE.Mesh;
    ring: THREE.Mesh;
  }[] = [];
  private flash: HTMLDivElement;
  private flashA = 0;
  private scorches: THREE.Mesh[] = [];

  constructor(private game: Game) {
    this.flash = document.createElement('div');
    this.flash.style.cssText = 'position:fixed;inset:0;background:#fffbe8;opacity:0;pointer-events:none;z-index:40;transition:none';
    document.body.appendChild(this.flash);
  }

  get active() {
    return !!this.device;
  }

  /** 足元に置く */
  place(pos: THREE.Vector3) {
    const g = this.game;
    if (this.device || this.cooldown > 0) {
      g.hud.toast(this.cooldown > 0 ? `核爆弾はまだ準備中（あと${Math.ceil(this.cooldown)}秒）` : '核爆弾はもう仕掛けてある！', 'info', 2);
      return false;
    }
    const mesh = new THREE.Group();
    const yellow = new THREE.MeshStandardMaterial({ color: '#e8c200', roughness: 0.5, metalness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.85, 18), yellow);
    body.position.y = 0.43;
    body.castShadow = true;
    mesh.add(body);
    for (const y of [0.2, 0.66]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.07, 18), black);
      band.position.y = y;
      mesh.add(band);
    }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff2020' }));
    light.position.y = 0.92;
    mesh.add(light);
    mesh.position.copy(pos);
    g.scene.add(mesh);
    this.device = { mesh, light, pos: pos.clone(), t: FUSE, beep: 0 };
    g.audio.play('beep', pos, 1, 0.7);
    g.hud.toast('☢ 核爆弾を仕掛けた！ 10秒で爆発する。全力で逃げて！（半径160mが消し飛ぶ）', 'evil', 5);
    g.npcs.panicAround(pos, 25);
    return true;
  }

  update(dt: number) {
    const g = this.game;
    this.cooldown -= dt;
    if (this.flashA > 0) {
      this.flashA = Math.max(0, this.flashA - dt * 0.55);
      this.flash.style.opacity = `${Math.min(1, this.flashA)}`;
    }
    const d = this.device;
    if (d) {
      d.t -= dt;
      d.beep -= dt;
      if (d.beep <= 0) {
        d.beep = Math.max(0.07, d.t * 0.1);
        g.audio.play('beep', d.pos, 1, d.t < 3 ? 1.3 : 1);
        d.light.visible = !d.light.visible;
      }
      if (d.t <= 0) {
        g.scene.remove(d.mesh);
        this.device = null;
        this.cooldown = 6;
        this.detonate(d.pos, 1);
      }
    }
    for (const b of [...this.blasts]) this.updateBlast(b, dt);
  }

  /** 核爆発（scale 1 = 核爆弾、0.75 = 戦闘機の少核弾頭） */
  detonate(pos: THREE.Vector3, scale = 1) {
    const g = this.game;
    const near = g.camera.position.distanceTo(pos);
    this.flashA = Math.max(this.flashA, Math.max(0.35, 1.6 * scale - near / 900));
    const gy = g.world.groundHeight(pos.x, pos.z);
    const group = new THREE.Group();
    group.position.set(pos.x, gy, pos.z);
    group.scale.setScalar(scale);
    const fireMat = new THREE.MeshBasicMaterial({ color: '#fff6d0', transparent: true, opacity: 1, depthWrite: false, fog: false });
    const fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), fireMat);
    const capGeo = new THREE.IcosahedronGeometry(1, 3);
    const cp = capGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      const k = 1 + Math.sin(cp.getX(i) * 9.1) * 0.08 + Math.sin(cp.getY(i) * 7.3 + cp.getZ(i) * 5.7) * 0.1;
      cp.setXYZ(i, cp.getX(i) * k, cp.getY(i) * k, cp.getZ(i) * k);
    }
    capGeo.computeVertexNormals();
    const smokeMat = new THREE.MeshStandardMaterial({ color: '#7a6a60', roughness: 1, emissive: '#ff6a1a', emissiveIntensity: 2.2, flatShading: true, transparent: true, opacity: 1, fog: false });
    const cap = new THREE.Mesh(capGeo, smokeMat);
    cap.scale.set(0.1, 0.1, 0.1);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1, 1, 18, 1, true), smokeMat);
    stem.scale.set(0.1, 0.1, 0.1);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e9dccb', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.y = 1.5;
    group.add(fireball, cap, stem, ring);
    g.scene.add(group);
    this.blasts.push({ pos: pos.clone().setY(gy), t: 0, r: 0, scale, hitPlayer: false, kills: 0, wrecks: 0, group, fireball, stem, cap, ring });
    const sc = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#17120f', transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    sc.position.set(pos.x, gy + 0.09, pos.z);
    sc.scale.setScalar(70 * scale);
    g.scene.add(sc);
    this.scorches.push(sc);
    if (this.scorches.length > 8) g.scene.remove(this.scorches.shift()!);
    g.audio.play('nuke', pos, 1, scale < 1 ? 1.15 : 1);
    g.story.onNuke(pos, scale);
    g.camRig.addShake(2.5 * scale);
    g.fx.explosion(pos.clone().setY(gy + 1), gy, 4 * scale);
    g.heat.value = Math.max(g.heat.value, 5.5);
    g.thrills.event('nuke', 1);
    if (near < 900) g.thrills.slowmo(1.6 * scale, 0.3);
  }

  private updateBlast(b: Nukes['blasts'][number], dt: number) {
    const g = this.game;
    b.t += dt;
    const t = b.t;
    const R = NUKE_R * b.scale;
    const prevR = b.r;
    b.r = R * Math.min(1, Math.pow(t / NUKE_TIME, 0.6));
    if (b.r > prevR) this.sweep(b, b.r);
    const fb = clamp(t / 1.1, 0, 1);
    b.fireball.scale.setScalar(4 + 36 * (1 - Math.pow(1 - fb, 3)));
    b.fireball.position.y = 10 + Math.max(0, t - 1) * 9;
    const fm = b.fireball.material as THREE.MeshBasicMaterial;
    fm.color.set(t < 0.6 ? '#fff6d0' : t < 2 ? '#ffb347' : '#ff6a2a');
    fm.opacity = clamp(1 - (t - 3) / 3, 0, 1);
    const rise = clamp(t / 9, 0, 1);
    const capY = 30 + 85 * (1 - Math.pow(1 - rise, 2));
    const capS = 14 + 32 * clamp(t / 6, 0, 1);
    b.cap.position.y = capY;
    b.cap.scale.set(capS * 1.25, capS * 0.62, capS * 1.25);
    b.cap.rotation.y += dt * 0.15;
    b.stem.scale.set(9 + rise * 4, capY, 9 + rise * 4);
    b.stem.position.y = capY / 2;
    const sm = b.cap.material as THREE.MeshStandardMaterial;
    sm.emissiveIntensity = Math.max(0, 2.2 - t * 0.28);
    sm.opacity = clamp(1 - (t - 22) / 8, 0, 1);
    b.ring.scale.set(b.r / b.scale, 1, b.r / b.scale);
    (b.ring.material as THREE.MeshBasicMaterial).opacity = clamp(0.85 * (1 - t / (NUKE_TIME + 1.5)), 0, 0.85);
    if (t < 9 && Math.random() < dt * 30) {
      const a = rand.range(0, Math.PI * 2);
      const rr = rand.range(0, capS) * b.scale;
      g.fx.smoke(new THREE.Vector3(b.pos.x + Math.cos(a) * rr, b.pos.y + capY * b.scale + rand.range(-capS * 0.3, capS * 0.3) * b.scale, b.pos.z + Math.sin(a) * rr), true);
    }
    if (t < NUKE_TIME + 0.2 && Math.random() < dt * 40) {
      const a = rand.range(0, Math.PI * 2);
      g.fx.smoke(new THREE.Vector3(b.pos.x + Math.cos(a) * b.r, b.pos.y + 1, b.pos.z + Math.sin(a) * b.r), false);
    }
    if (t > NUKE_TIME) b.hitPlayer = true;
    if (t > NUKE_TIME + 0.05 && (b.kills > 0 || b.wrecks > 0)) {
      const p = g.player.pos;
      if (b.wrecks) g.karma.crime('wreck', p, '', b.wrecks);
      if (b.kills) g.karma.crime('kill', p, '', b.kills, 'nuke');
      b.kills = 0;
      b.wrecks = 0;
    }
    if (t > 30) {
      g.scene.remove(b.group);
      b.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      this.blasts.splice(this.blasts.indexOf(b), 1);
    }
  }

  /** 衝撃波が半径 r まで届いた：その中の物をまとめて壊す */
  private sweep(b: Nukes['blasts'][number], r: number) {
    const g = this.game;
    const pos = b.pos;
    const R = NUKE_R * b.scale;
    for (const o of g.destruction.near(pos.x, pos.z, r)) {
      const isBld = o.kind === 'house' || o.kind === 'building' || o.kind === 'tower';
      if (isBld) b.wrecks++;
      g.destruction.destroy(o, pos, Math.hypot(o.x - pos.x, o.z - pos.z) < 45 && isBld, false, true);
    }
    for (const n of g.npcs.list) {
      if (!n.alive) continue;
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
      if (d > r) continue;
      const dir = n.pos.clone().sub(pos).setY(0).normalize();
      const k = 1 - d / R;
      n.fling(dir.multiplyScalar(10 + 26 * k).setY(4 + 14 * k));
      if (d < R * 0.75) n.char();
      b.kills++;
    }
    for (const v of g.traffic.list) {
      if (v.charred) continue;
      const d = v.pos.distanceTo(pos);
      if (d > r) continue;
      if (v === g.player.driving) g.player.exitVehicle();
      const dir = v.pos.clone().sub(pos).setY(0).normalize();
      const k = 1 - d / R;
      v.blast(dir.multiplyScalar(6 + 22 * k).setY(5 + 12 * k));
    }
    g.airforce.sweep(pos, r);
    const p = g.player;
    const dp = p.pos.distanceTo(pos);
    if (!b.hitPlayer && dp <= r) {
      b.hitPlayer = true;
      g.audio.play('boom', undefined, 1, 0.45);
      g.camRig.addShake(2.2 * b.scale);
      if (dp < 110 * b.scale) {
        if (p.driving) p.exitVehicle();
        p.hurt(dp < 40 * b.scale ? 9999 : 95 * (1 - (dp - 40 * b.scale) / (70 * b.scale)), pos);
        p.vel.add(p.pos.clone().sub(pos).setY(0).normalize().multiplyScalar(14).setY(9));
      }
    }
  }

  /** HUD に出す残り時間 */
  get note() {
    if (this.device) return `☢ 核爆弾 起爆まで <b>${Math.max(0, this.device.t).toFixed(1)}</b> 秒 ― 逃げて！`;
    return '';
  }
}
