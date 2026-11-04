import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G } from '../core/Physics';
import { clamp, rand } from '../core/Rng';
import { ARMED, type HumanKind } from '../npc/Human';
import type { NPC } from '../npc/NPC';
import { Vehicle } from '../vehicles/Vehicle';
import type { VehicleKind } from '../vehicles/VehicleModel';
import { castShot } from './Guns';

/** その隊が出てくる通報レベル */
const MIN_LEVEL: Partial<Record<HumanKind, number>> = { police: 2, swat: 4, soldier: 5 };
/** 通報レベルごとの、歩いて来る隊員の数 */
const WANT_FOOT: Partial<Record<HumanKind, number>>[] = [{}, {}, { police: 2 }, { police: 3 }, { police: 2, swat: 4 }, { swat: 2, soldier: 5 }];
/** 通報レベルごとの、追ってくる車（種類・乗っている隊・人数） */
const WANT_CARS: [VehicleKind, HumanKind, number][][] = [[], [], [], [['police', 'police', 2], ['police', 'police', 2]], [['police', 'police', 2], ['van', 'swat', 3]], [['tank', 'soldier', 0], ['van', 'soldier', 3]]];
const DMG: Partial<Record<HumanKind, number>> = { police: 8, swat: 7, soldier: 11 };
const RANGE: Partial<Record<HumanKind, number>> = { police: 35, swat: 50, soldier: 70 };
export const FORCE_NAME = ['保健所', '保健所', '警察', '警察', 'SWAT', '防衛隊'];

interface Pursuer {
  v: Vehicle;
  crew: HumanKind;
  n: number;
  stuckT: number;
  revT: number;
  fireCd: number;
  sirenT: number;
}

interface Combat {
  spotT: number;
  cd: number;
  burst: number;
  seeT: number;
  see: boolean;
}

interface Shell {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Mesh;
  t: number;
}

/**
 * 通報レベルに応じた、現実的な出動の段階。
 * 1: 保健所（網）→ 2: 警察官（警告してから発砲）→ 3: パトカーで追跡
 * → 4: SWAT（装甲バン・連射）→ 5: 防衛隊（小銃・戦車）
 */
export class Responders {
  cars: Pursuer[] = [];
  private st = new Map<NPC, Combat>();
  private shells: Shell[] = [];
  private footT = 0;
  private carT = 0;
  private lastLevel = 0;

  constructor(private game: Game) {}

  minLevel(kind: HumanKind) {
    return MIN_LEVEL[kind] ?? 1;
  }

  /** 隊員から目標が見えているか（建物にさえぎられていないか）。0.3秒ごとに調べる */
  canSee(n: NPC, tgt: THREE.Vector3, dist: number) {
    const p = this.game.player;
    if (dist > 85 || p.dead || (p.playDead && !p.driving)) return false;
    const c = this.combat(n);
    c.seeT -= 1 / 60;
    if (c.seeT > 0) return c.see;
    c.seeT = 0.3;
    const from = n.headPos();
    const to = tgt.clone().setY(tgt.y + 0.5);
    const dir = to.clone().sub(from);
    const d = dir.length();
    const hit = this.game.physics.raycast(from, dir.normalize(), d - 0.5, G.STATIC);
    c.see = !hit;
    return c.see;
  }

  private combat(n: NPC): Combat {
    let c = this.st.get(n);
    if (!c) this.st.set(n, (c = { spotT: 0, cd: rand.range(0.5, 1.5), burst: 0, seeT: 0, see: false }));
    return c;
  }

  /** 隊員の射撃（NPC の 'armed' 状態から毎フレーム呼ばれる） */
  combatStep(n: NPC, sees: boolean, dist: number, dt: number) {
    const g = this.game;
    const c = this.combat(n);
    c.cd -= dt;
    if (!sees) {
      c.spotT = Math.max(0, c.spotT - dt);
      return;
    }
    c.spotT += dt;
    // 警察はまず警告する（いきなりは撃たない）
    if (n.kind === 'police' && c.spotT < 2.4) {
      if (c.spotT - dt <= 0) g.hud.popText(n.headPos(), rand.pick(['止まりなさい!', '動くな!', 'その犬を止めろ!']), '#9fc4ff', 22);
      if (c.spotT - dt < 1.4 && c.spotT >= 1.4) g.hud.popText(n.headPos(), '撃つぞ!', '#ff9f9f', 24);
      return;
    }
    if (c.cd > 0 || dist > (RANGE[n.kind] ?? 30)) return;
    this.fire(n, dist);
    if (n.kind === 'swat') {
      if (c.burst > 0) {
        c.burst--;
        c.cd = 0.11;
      } else {
        c.burst = 2;
        c.cd = rand.range(1.0, 1.5);
      }
    } else c.cd = n.kind === 'soldier' ? rand.range(0.8, 1.2) : rand.range(1.1, 1.8);
    if (rand.chance(0.15)) g.hud.popText(n.headPos(), rand.pick(n.kind === 'police' ? ['発砲許可!', '応援を!'] : n.kind === 'swat' ? ['制圧しろ!', '撃て!', '包囲しろ!'] : ['目標を排除せよ!', '撃てー!', '前進!']), '#ffffff', 18);
  }

  /** 1発撃つ。命中率は距離と、うしわかの速さで下がる */
  private fire(n: NPC, dist: number) {
    const g = this.game;
    const p = g.player;
    const from = n.headPos().setY(n.pos.y + n.height * 0.78);
    const aim = p.driving ? p.driving.pos.clone().setY(p.driving.pos.y + 0.9) : p.pos.clone().setY(p.pos.y + 0.35);
    const sp = p.driving ? Math.abs(p.driving.speed) : Math.hypot(p.vel.x, p.vel.z);
    let acc = (n.kind === 'soldier' ? 0.72 : n.kind === 'swat' ? 0.66 : 0.5) * clamp(1.15 - dist / 60, 0.25, 1) * clamp(1.15 - sp / 15, 0.2, 1);
    if (p.dashT > 0) acc *= 0.3;
    const dir = aim.sub(from);
    if (Math.random() > acc) {
      const m = 0.7 + dist * 0.05;
      dir.add(new THREE.Vector3(rand.range(-m, m), rand.range(-m * 0.4, m * 0.6), rand.range(-m, m)));
    }
    dir.normalize();
    const hit = castShot(g, from, dir, (RANGE[n.kind] ?? 30) + 15, { hitPlayer: true, npcFilter: (o) => !ARMED.includes(o.kind) && o !== n });
    g.weapons.tracers.add(from.clone().addScaledVector(dir, 0.5), hit.point, '#ffcf8a');
    g.audio.play('gun', n.pos, 0.7, n.kind === 'police' ? 1.1 : 0.9);
    const dmg = DMG[n.kind] ?? 8;
    if (hit.player) p.hurt(dmg, n.pos);
    else if (hit.vehicle) {
      hit.vehicle.hp -= dmg * (hit.vehicle.kind === 'tank' ? 0.03 : 0.35);
      g.fx.sparks(hit.point);
    } else if (hit.npc) hit.npc.bitten(dmg * 2.5, n.pos);
    else g.fx.sparks(hit.point);
  }

  update(dt: number) {
    const g = this.game;
    const lv = g.heat.level;
    if (lv !== this.lastLevel) {
      if (lv > this.lastLevel && lv >= 2) {
        const msg = ['', '', '警察が出動した！ 撃ってくるので気をつけて（Z: 死んだふり／X: シールド）', 'パトカーが追ってくる！', 'SWAT が出動した！', '防衛隊が出動した！ 戦車の砲撃に注意！'][lv];
        g.hud.toast(msg, 'bad', 5);
      }
      if (lv < 3) this.releaseCars();
      this.lastLevel = lv;
    }
    for (const [n] of this.st) if (!n.alive) this.st.delete(n);
    this.updateShells(dt);
    if (g.capture.active || g.player.dead) return;
    // 歩いて来る隊員
    this.footT -= dt;
    if (this.footT <= 0) {
      this.footT = 1.2;
      const want = WANT_FOOT[lv] ?? {};
      for (const kind of ARMED) {
        const have = g.npcs.list.filter((n) => n.kind === kind && n.alive && n.state === 'armed').length;
        if (have < (want[kind] ?? 0)) {
          this.spawnFoot(kind);
          break;
        }
      }
    }
    // 車（パトカー・装甲バン・戦車）
    this.cars = this.cars.filter((c) => !c.v.dead && !c.v.wrecked);
    this.carT -= dt;
    if (this.carT <= 0) {
      this.carT = 2.5;
      const want = WANT_CARS[lv] ?? [];
      const count = new Map<VehicleKind, number>();
      for (const c of this.cars) count.set(c.v.kind, (count.get(c.v.kind) ?? 0) + 1);
      for (const [kind, crew, n] of want) {
        const left = count.get(kind) ?? 0;
        if (left > 0) count.set(kind, left - 1);
        else {
          this.spawnCar(kind, crew, n);
          break;
        }
      }
    }
    for (const c of this.cars) this.drivePursuer(c, dt);
  }

  private spawnFoot(kind: HumanKind) {
    const g = this.game;
    const p = g.player.pos;
    const pick = g.world.nav.randomEdgeNear(p.x, p.z, 38, 70, rand);
    if (!pick) return;
    const [a, b, t] = pick;
    const n = g.npcs.create(kind, a.x + (b.x - a.x) * t, a.y, a.z + (b.z - a.z) * t);
    n.state = 'armed';
  }

  private spawnCar(kind: VehicleKind, crew: HumanKind, n: number) {
    const g = this.game;
    const p = g.player.pos;
    const lanes = g.traffic.lanes;
    for (let tries = 0; tries < 25; tries++) {
      const lane = rand.pick(lanes);
      const t = rand.range(0, lane.len);
      const x = lane.sx + lane.fx * t;
      const z = lane.sz + lane.fz * t;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < 70 || d > 130) continue;
      if (g.traffic.list.some((o) => Math.hypot(o.pos.x - x, o.pos.z - z) < 8)) continue;
      const v = new Vehicle(g, kind, x, lane.y, z, Math.atan2(lane.fx, lane.fz));
      v.external = true;
      v.persistent = true;
      g.traffic.list.push(v);
      this.cars.push({ v, crew, n, stuckT: 0, revT: 0, fireCd: 4, sirenT: 0 });
      return;
    }
  }

  /** 追跡をやめた車は、その場に乗り捨てられる */
  private releaseCars() {
    for (const c of this.cars) {
      c.v.external = false;
      c.v.driver = 'none';
    }
    this.cars = [];
  }

  private drivePursuer(c: Pursuer, dt: number) {
    const g = this.game;
    const v = c.v;
    const pl = g.player;
    const tgt = pl.driving ? pl.driving.pos : pl.pos;
    const dx = tgt.x - v.pos.x;
    const dz = tgt.z - v.pos.z;
    const d = Math.hypot(dx, dz);
    let diff = Math.atan2(dx, dz) - v.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const tank = v.kind === 'tank';
    let thr = 1;
    let st = clamp(diff * 2.2, -1, 1);
    if (c.revT > 0) {
      c.revT -= dt;
      thr = -1;
      st = -st;
    } else {
      if (Math.abs(diff) > 1.5 && d < 35) thr = 0.35;
      if (tank) thr = d > 55 ? 1 : d < 28 ? -0.6 : 0;
      else if (d < 13) thr = -0.6;
      if (Math.abs(v.speed) < 1 && thr > 0) c.stuckT += dt;
      else c.stuckT = 0;
      if (c.stuckT > 1.8) {
        c.revT = 1.4;
        c.stuckT = 0;
      }
    }
    v.drive(dt, { thr, st, hand: false });
    v.sync(dt);
    // サイレン
    c.sirenT -= dt;
    if (!tank && c.sirenT <= 0 && d < 110) {
      c.sirenT = 1.25;
      g.audio.play('siren', v.pos, 0.55);
    }
    if (tank) {
      this.tankAim(c, tgt, d, dt);
      return;
    }
    // 近くに着いたら隊員が降りてくる
    if (d < 18 && Math.abs(v.speed) < 4) {
      const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
      for (let i = 0; i < c.n; i++) {
        const s = (i % 2 === 0 ? 1 : -1) * (v.spec.halfW + 0.7);
        const nn = g.npcs.create(c.crew, v.pos.x + side.x * s - Math.sin(v.yaw) * i * 0.8, v.pos.y, v.pos.z + side.z * s - Math.cos(v.yaw) * i * 0.8);
        nn.state = 'armed';
      }
      v.external = false;
      v.driver = 'none';
      v.speed = 0;
      c.n = 0;
      this.cars = this.cars.filter((o) => o !== c);
    }
  }

  /** 防衛隊の戦車：砲塔を向けて、ときどき砲撃（着弾地点は少しずれる） */
  private tankAim(c: Pursuer, tgt: THREE.Vector3, d: number, dt: number) {
    const g = this.game;
    const v = c.v;
    const m = v.model;
    if (!m.turret || !m.barrel || !m.muzzle) return;
    let rel = Math.atan2(tgt.x - v.pos.x, tgt.z - v.pos.z) - v.yaw - m.turret.rotation.y;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    m.turret.rotation.y += clamp(rel, -1.0 * dt, 1.0 * dt);
    m.barrel.position.z += (1.8 - m.barrel.position.z) * Math.min(1, dt * 5);
    c.fireCd -= dt;
    if (c.fireCd > 0 || d > 90 || Math.abs(rel) > 0.15) return;
    if (!this.canSeeFrom(v.pos.clone().setY(v.pos.y + 2.4), tgt)) return;
    c.fireCd = rand.range(4.5, 6.5);
    m.barrel.updateWorldMatrix(true, true);
    const mp = new THREE.Vector3();
    m.muzzle.getWorldPosition(mp);
    const aim = tgt.clone().add(new THREE.Vector3(rand.range(-5, 5), 0.3, rand.range(-5, 5)));
    const vel = aim.sub(mp).normalize().multiplyScalar(90);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd166' }));
    mesh.position.copy(mp);
    g.scene.add(mesh);
    this.shells.push({ pos: mp.clone(), vel, mesh, t: 0 });
    m.barrel.position.z = 1.2;
    g.audio.play('cannon', mp, 1);
    for (let k = 0; k < 3; k++) g.fx.smoke(mp.clone(), false);
    g.hud.popText(mp.clone().setY(mp.y + 1), 'ドォン!', '#ffd166', 26);
  }

  private canSeeFrom(from: THREE.Vector3, tgt: THREE.Vector3) {
    const to = tgt.clone().setY(tgt.y + 0.6);
    const dir = to.clone().sub(from);
    const d = dir.length();
    return !this.game.physics.raycast(from, dir.normalize(), d - 1, G.STATIC);
  }

  private updateShells(dt: number) {
    const g = this.game;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      const prev = s.pos.clone();
      s.vel.y -= 3 * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      s.mesh.lookAt(s.pos.clone().add(s.vel));
      const step = s.pos.clone().sub(prev);
      const len = step.length();
      let hit = s.t > 4 || s.pos.y <= g.world.groundHeight(s.pos.x, s.pos.z);
      if (!hit && len > 0) {
        const r = g.physics.raycast(prev, step.normalize(), len, G.STATIC | G.VEHICLE);
        if (r) {
          hit = true;
          s.pos.copy(r.point);
        }
      }
      if (!hit && s.pos.distanceTo(g.player.pos) < 1.2) hit = true;
      if (hit) {
        g.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        this.shells.splice(i, 1);
        g.explode(s.pos, false, 1.3);
      }
    }
  }

  /** 捕まった・倒れたときなど：全員引き上げる */
  reset() {
    this.releaseCars();
    for (const n of this.game.npcs.list) if (n.state === 'armed') n.state = 'walk';
  }
}
