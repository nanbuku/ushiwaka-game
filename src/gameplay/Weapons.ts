import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G } from '../core/Physics';
import { clamp, rand } from '../core/Rng';
import { colorMat } from '../npc/Human';
import type { NPC } from '../npc/NPC';
import type { Vehicle } from '../vehicles/Vehicle';

export type WeaponId = 'bite' | 'bat' | 'chainsaw' | 'rocket' | 'molotov' | 'caltrops' | 'c4' | 'megaphone';

export const WEAPON_ORDER: WeaponId[] = ['bite', 'bat', 'chainsaw', 'rocket', 'molotov', 'caltrops', 'c4', 'megaphone'];

export const WEAPONS: Record<WeaponId, { name: string; pickup: number; max: number; help: string }> = {
  bite: { name: '噛みつき', pickup: Infinity, max: Infinity, help: '左クリック: 噛みつく' },
  bat: { name: '金属バット', pickup: Infinity, max: Infinity, help: '左クリック: フルスイング（人を打ち飛ばす）' },
  chainsaw: { name: 'チェーンソー', pickup: Infinity, max: Infinity, help: '左クリック長押し: 切りつける' },
  rocket: { name: 'ロケット花火', pickup: 6, max: 24, help: '左クリック: 画面の中央に向けて発射（当たると爆発）' },
  molotov: { name: '火炎瓶', pickup: 3, max: 12, help: '左クリック: 投げる（火の海にする）' },
  caltrops: { name: '撒菱（まきびし）', pickup: 3, max: 12, help: '左クリック: 足元にまく（踏んだ人はけが、車はパンク）' },
  c4: { name: 'リモコン爆弾', pickup: 4, max: 8, help: '左クリック: 設置（車の近くなら車に仕掛ける）　G: 全部まとめて起爆' },
  megaphone: { name: '拡声器', pickup: 15, max: 30, help: '左クリック: 拡声器で大吠え（お年寄りはショック死）' },
};

interface Pickup {
  id: WeaponId;
  x: number;
  y: number;
  z: number;
  mesh: THREE.Group;
  active: boolean;
  respawn: number;
}

interface Projectile {
  kind: 'rocket' | 'molotov';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Object3D;
  t: number;
}

interface Fire {
  x: number;
  y: number;
  z: number;
  r: number;
  t: number;
}

interface Field {
  x: number;
  y: number;
  z: number;
  r: number;
  t: number;
  mesh: THREE.InstancedMesh;
}

interface Charge {
  mesh: THREE.Group;
  light: THREE.Mesh;
  vehicle: Vehicle | null;
  offset: THREE.Vector3;
  pos: THREE.Vector3;
  fuse: number;
}

// ---------- 武器の見た目（口にくわえる／落ちているもの） ----------
function weaponModel(id: WeaponId): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, mat?: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat ?? colorMat(color, 0.4));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const metal = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 0.85, roughness: 0.25 });
  switch (id) {
    case 'bat':
      add(new THREE.CylinderGeometry(0.035, 0.02, 0.8, 10), '', 0, 0, 0, 0, 0, Math.PI / 2, metal);
      add(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 8), '#222222', -0.42, 0, 0, 0, 0, Math.PI / 2);
      break;
    case 'chainsaw':
      add(new THREE.BoxGeometry(0.16, 0.14, 0.22), '#f28c28', 0, 0, -0.05);
      add(new THREE.BoxGeometry(0.03, 0.07, 0.48), '', 0, -0.01, 0.28, 0, 0, 0, metal);
      add(new THREE.BoxGeometry(0.035, 0.085, 0.5), '#333333', 0, -0.01, 0.28);
      break;
    case 'rocket':
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 10), '#d62828', 0, 0, 0.1, Math.PI / 2);
      add(new THREE.ConeGeometry(0.035, 0.1, 10), '#ffd166', 0, 0, 0.4, Math.PI / 2);
      add(new THREE.BoxGeometry(0.12, 0.01, 0.06), '#f4f4f4', 0, 0, -0.12);
      break;
    case 'molotov':
      add(new THREE.CylinderGeometry(0.035, 0.04, 0.16, 10), '#3c7a3c', 0, 0, 0, Math.PI / 2, 0, 0, new THREE.MeshStandardMaterial({ color: '#3c7a3c', roughness: 0.1, transparent: true, opacity: 0.85 }));
      add(new THREE.CylinderGeometry(0.014, 0.018, 0.06, 8), '#3c7a3c', 0, 0, 0.11, Math.PI / 2);
      add(new THREE.BoxGeometry(0.03, 0.03, 0.06), '#e9e2cf', 0, 0, 0.16);
      break;
    case 'caltrops':
      add(new THREE.SphereGeometry(0.07, 10, 8), '#7a5a3a', 0, 0, 0);
      add(new THREE.TetrahedronGeometry(0.03), '', 0.02, 0.07, 0, 0, 0, 0, metal);
      break;
    case 'c4':
      add(new THREE.BoxGeometry(0.1, 0.05, 0.14), '#2a2a2a', 0, 0, 0);
      add(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), '#111111', 0.03, 0.08, -0.04);
      add(new THREE.BoxGeometry(0.03, 0.012, 0.03), '#ff2a2a', -0.02, 0.03, 0.03, 0, 0, 0, new THREE.MeshBasicMaterial({ color: '#ff2a2a' }));
      break;
    case 'megaphone':
      add(new THREE.CylinderGeometry(0.03, 0.09, 0.24, 12, 1, true), '#f4f4f4', 0, 0, 0.08, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), '#d62828', 0, -0.06, -0.04);
      break;
    default:
      break;
  }
  return g;
}

const _v = new THREE.Vector3();

/** うしわかの武器庫（拾う・持ち替える・攻撃・設置した罠の管理） */
export class Arsenal {
  ammo: Record<WeaponId, number> = { bite: Infinity, bat: 0, chainsaw: 0, rocket: 0, molotov: 0, caltrops: 0, c4: 0, megaphone: 0 };
  current: WeaponId = 'bite';
  pickups: Pickup[] = [];
  charges: Charge[] = [];
  private projectiles: Projectile[] = [];
  private fires: Fire[] = [];
  private fields: Field[] = [];
  private held = new Map<WeaponId, THREE.Group>();
  private cd = 0;
  private sawing = 0;
  private sawFx = 0;
  private pending: { t: number; pos: THREE.Vector3; scale: number }[] = [];
  private spikeGeo = new THREE.TetrahedronGeometry(0.06);
  private spikeMat = new THREE.MeshStandardMaterial({ color: '#8d9096', metalness: 0.8, roughness: 0.3 });
  private beepT = 0;

  constructor(private game: Game) {}

  /** ワールドの武器置き場から拾える武器を並べる */
  init() {
    for (const s of this.game.world.weaponSpots) {
      const mesh = new THREE.Group();
      const m = weaponModel(s.id);
      m.scale.setScalar(1.7);
      m.position.y = 0.45;
      mesh.add(m);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.6, depthWrite: false }));
      ring.position.y = 0.03;
      mesh.add(ring);
      mesh.position.set(s.x, s.y, s.z);
      this.game.scene.add(mesh);
      this.pickups.push({ id: s.id, x: s.x, y: s.y, z: s.z, mesh, active: true, respawn: 0 });
    }
  }

  get owned() {
    return WEAPON_ORDER.filter((w) => this.ammo[w] > 0);
  }

  give(id: WeaponId) {
    const def = WEAPONS[id];
    const had = this.ammo[id] > 0;
    this.ammo[id] = Math.min(def.max, this.ammo[id] + def.pickup);
    const g = this.game;
    g.audio.play('pickup', g.player.pos, 0.9, 0.8);
    g.hud.toast(had ? `${def.name}を補充した（${this.ammoText(id)}）` : `${def.name}を手に入れた！　数字キー ${WEAPON_ORDER.indexOf(id) + 1} / R で持ち替え`, 'good', 4);
    if (!had) this.select(id);
  }

  ammoText(id: WeaponId) {
    const a = this.ammo[id];
    return a === Infinity ? '∞' : `${a}`;
  }

  select(id: WeaponId) {
    if (this.ammo[id] <= 0) return;
    this.current = id;
    this.stopSaw();
    this.refreshHeld();
    this.game.hud.toast(`${WEAPONS[id].name}　${WEAPONS[id].help}`, 'info', 3);
  }

  cycle() {
    const own = this.owned;
    const i = own.indexOf(this.current);
    this.select(own[(i + 1) % own.length]);
  }

  /** 口にくわえている武器の見た目を更新 */
  refreshHeld() {
    const p = this.game.player;
    for (const [id, m] of this.held) m.visible = id === this.current && !p.carrying && !p.driving;
    if (this.current !== 'bite' && !this.held.has(this.current)) {
      const m = weaponModel(this.current);
      if (this.current === 'bat') m.position.set(0.1, 0.02, 0.02);
      if (this.current === 'chainsaw') m.position.set(0, 0, 0.05);
      p.model.mouth.add(m);
      this.held.set(this.current, m);
      m.visible = !p.carrying && !p.driving;
    }
  }

  private use(id: WeaponId) {
    if (this.ammo[id] !== Infinity) this.ammo[id]--;
    if (this.ammo[id] <= 0) {
      this.game.hud.toast(`${WEAPONS[id].name}がなくなった`, 'info', 2.5);
      this.current = 'bite';
      this.refreshHeld();
    }
  }

  // ---------- 攻撃 ----------
  /** 左クリック（押した瞬間） */
  attackPressed() {
    const g = this.game;
    const p = g.player;
    if (this.cd > 0) return;
    const id = this.current;
    const head = p.headWorld();
    switch (id) {
      case 'bat':
        this.cd = 0.55;
        p.swing();
        this.batSwing();
        break;
      case 'rocket': {
        this.cd = 0.45;
        const dir = this.aimDir();
        const mesh = weaponModel('rocket');
        mesh.lookAt(dir);
        this.projectiles.push({ kind: 'rocket', pos: head.clone().add(dir.clone().multiplyScalar(0.4)), vel: dir.multiplyScalar(34), mesh, t: 0 });
        g.scene.add(mesh);
        g.audio.play('whistle', p.pos, 0.9);
        this.use('rocket');
        break;
      }
      case 'molotov': {
        this.cd = 0.7;
        const dir = this.aimDir();
        const v = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(12).add(new THREE.Vector3(0, 5.5 + Math.max(0, dir.y) * 8, 0));
        const mesh = weaponModel('molotov');
        this.projectiles.push({ kind: 'molotov', pos: head.clone(), vel: v, mesh, t: 0 });
        g.scene.add(mesh);
        g.audio.play('jump', p.pos, 0.6);
        this.use('molotov');
        break;
      }
      case 'caltrops':
        this.cd = 0.4;
        this.scatter();
        this.use('caltrops');
        break;
      case 'c4':
        this.cd = 0.35;
        this.placeCharge();
        break;
      case 'megaphone':
        this.cd = 1.2;
        p.bark(true, true);
        this.use('megaphone');
        break;
      default:
        break;
    }
  }

  /** 左クリック長押し中（チェーンソー） */
  attackHeld(dt: number) {
    if (this.current !== 'chainsaw') return;
    const g = this.game;
    const p = g.player;
    if (this.sawing <= 0) g.audio.sawOn();
    this.sawing = 0.15;
    g.camRig.addShake(0.12);
    const targets = this.inFront(1.45, 0.25, 3);
    this.sawFx -= dt;
    for (const n of targets) {
      const wasAlive = n.alive;
      if (!wasAlive) continue;
      n.hp -= 120 * dt;
      if (this.sawFx < 0) {
        g.fx.bloodSpray(n.pos.clone().setY(n.pos.y + 0.6 + Math.random() * 0.6), p.forward, 14, n.pos.y);
        n.scare(p.pos, 0.1);
      }
      if (n.hp <= 0) {
        n.hp = 1;
        n.bitten(999, p.pos);
        g.karma.crime('kill', n.pos, n.kind, 1, 'saw');
        g.fx.bloodPool(n.pos.clone(), 1.3);
        g.hud.popText(n.headPos(), 'ギャアアア!!', '#ff3b3b', 30);
        g.npcs.panicAround(n.pos, 30, n);
      }
    }
    for (const v of g.traffic.list) {
      if (v === p.driving || v.wrecked) continue;
      if (v.contains(p.mouthWorld(), 0.5)) {
        v.hp -= 30 * dt;
        if (this.sawFx < 0) g.fx.sparks(p.mouthWorld());
      }
    }
    if (this.sawFx < 0) this.sawFx = 0.08;
  }

  private stopSaw() {
    if (this.sawing > 0) this.game.audio.sawOff();
    this.sawing = 0;
  }

  /** 画面の中央方向（カメラの向き） */
  private aimDir() {
    const g = this.game;
    const d = new THREE.Vector3();
    g.camera.getWorldDirection(d);
    d.y = clamp(d.y + 0.08, -0.25, 0.6);
    return d.normalize();
  }

  /** うしわかの正面にいる人 */
  private inFront(range: number, minDot: number, max: number): NPC[] {
    const g = this.game;
    const p = g.player;
    const f = p.forward;
    const list: { n: NPC; d: number }[] = [];
    for (const n of g.npcs.list) {
      const dx = n.pos.x - p.pos.x;
      const dz = n.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) - n.radius;
      if (d > range || Math.abs(n.pos.y - p.pos.y) > 1.3) continue;
      const dot = (dx * f.x + dz * f.z) / Math.max(0.01, Math.hypot(dx, dz));
      if (dot < minDot && d > 0.3) continue;
      list.push({ n, d });
    }
    return list.sort((a, b) => a.d - b.d).slice(0, max).map((x) => x.n);
  }

  private batSwing() {
    const g = this.game;
    const p = g.player;
    g.audio.play('whoosh', p.pos, 0.7);
    const hits = this.inFront(1.9, 0.15, 2).filter((n) => n.alive);
    for (const n of hits) {
      const dir = n.pos.clone().sub(p.pos).setY(0).normalize();
      n.fling(dir.multiplyScalar(rand.range(13, 18)).add(new THREE.Vector3(0, rand.range(7, 10), 0)));
      g.fx.bloodSpray(n.pos.clone().setY(n.pos.y + 1), dir, 18, n.pos.y);
      g.karma.crime('kill', n.pos, n.kind, 1, 'bat');
      g.npcs.panicAround(n.pos, 25, n);
    }
    if (hits.length) {
      g.audio.play('bat', p.pos, 1);
      g.hud.popText(p.headWorld().add(new THREE.Vector3(0, 0.6, 0)), rand.pick(['カキーン!!', 'ホームラン!!', 'ドゴォッ!!']), '#ffd166', 38);
      g.camRig.addShake(0.5);
      return;
    }
    for (const v of g.traffic.list) {
      if (v === p.driving || v.wrecked || !v.contains(p.mouthWorld().add(p.forward.multiplyScalar(0.4)), 0.4)) continue;
      v.hp -= 18;
      g.audio.play('crash', v.pos, 0.5);
      g.fx.sparks(p.mouthWorld());
      g.hud.popText(p.headWorld(), 'ガンッ!', '#ffffff', 26);
      if (v.ai) {
        v.brakeT = 2;
        g.audio.play('horn', v.pos, 0.6);
      }
      return;
    }
  }

  private scatter() {
    const g = this.game;
    const p = g.player;
    const c = p.pos.clone().add(p.forward.multiplyScalar(-0.6));
    const gy = g.world.groundHeight(c.x, c.z);
    const n = 42;
    const mesh = new THREE.InstancedMesh(this.spikeGeo, this.spikeMat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const a = rand.range(0, Math.PI * 2);
      const r = Math.sqrt(rand.next()) * 1.9;
      q.setFromEuler(new THREE.Euler(rand.range(0, 6), rand.range(0, 6), rand.range(0, 6)));
      m.compose(new THREE.Vector3(c.x + Math.cos(a) * r, gy + 0.04, c.z + Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    g.scene.add(mesh);
    this.fields.push({ x: c.x, y: gy, z: c.z, r: 1.9, t: 90, mesh });
    g.audio.play('drop', p.pos, 0.8, 1.6);
    g.hud.popText(p.headWorld(), 'ジャラッ', '#c9ccd2', 22);
  }

  private placeCharge() {
    const g = this.game;
    const p = g.player;
    if (this.charges.length >= 8) {
      g.hud.toast('これ以上は仕掛けられない（G で起爆）', 'info', 2);
      return;
    }
    let vehicle: Vehicle | null = null;
    for (const v of g.traffic.list) if (!v.wrecked && v !== p.driving && v.contains(p.pos, 1.2)) vehicle = v;
    const mesh = weaponModel('c4');
    mesh.scale.setScalar(1.4);
    const light = mesh.children[2] as THREE.Mesh;
    const pos = p.pos.clone();
    pos.y = g.world.groundHeight(pos.x, pos.z) + 0.04;
    const offset = new THREE.Vector3();
    if (vehicle) {
      offset.set(0, vehicle.spec.height * 0.6, 0);
      vehicle.model.root.add(mesh);
      mesh.position.copy(offset);
      g.hud.toast(`${vehicle.spec.name}に爆弾を仕掛けた（${this.charges.length + 1}/8）`, 'evil', 3);
    } else {
      mesh.position.copy(pos);
      g.scene.add(mesh);
      g.hud.toast(`爆弾を設置した（${this.charges.length + 1}/8）　G で起爆`, 'evil', 2.5);
    }
    this.charges.push({ mesh, light, vehicle, offset, pos, fuse: -1 });
    g.audio.play('beep', p.pos, 0.6);
    this.use('c4');
  }

  /** 仕掛けた爆弾をまとめて起爆 */
  detonate() {
    const g = this.game;
    if (!this.charges.length) return;
    g.audio.play('beep', g.player.pos, 0.8, 1.6);
    g.hud.toast(`起爆！（${this.charges.length}個）`, 'evil', 2);
    this.charges.forEach((c, i) => (c.fuse = 0.25 + i * 0.12));
  }

  /** 爆発に巻き込まれた爆弾は連鎖して爆発する。近くの人に火がつく */
  onExplosion(pos: THREE.Vector3, R: number) {
    for (const c of this.charges) if (c.fuse < 0 && this.chargePos(c).distanceTo(pos) < R * 0.9) c.fuse = 0.15;
    for (const n of this.game.npcs.list) {
      if (n.alive && Math.random() < 0.5 && Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z) < R * 1.3) n.ignite(true);
    }
    if (Math.random() < 0.6) this.addFire(pos.x, pos.z, R * 0.45, 5);
  }

  private chargePos(c: Charge) {
    if (c.vehicle) return c.vehicle.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
    return c.pos.clone();
  }

  addFire(x: number, z: number, r: number, t: number) {
    this.fires.push({ x, y: this.game.world.groundHeight(x, z), z, r, t });
  }

  // ---------- 毎フレーム ----------
  update(dt: number) {
    const g = this.game;
    const p = g.player;
    this.cd -= dt;
    if (this.sawing > 0) {
      this.sawing -= dt;
      if (this.sawing <= 0) g.audio.sawOff();
    }
    // 拾う
    for (const k of this.pickups) {
      if (!k.active) {
        k.respawn -= dt;
        if (k.respawn < 0 && Math.hypot(k.x - p.pos.x, k.z - p.pos.z) > 30) {
          k.active = true;
          k.mesh.visible = true;
        }
        continue;
      }
      k.mesh.rotation.y += dt * 1.6;
      k.mesh.children[0].position.y = 0.45 + Math.sin(performance.now() * 0.003 + k.x) * 0.08;
      if (!p.driving && Math.hypot(k.x - p.pos.x, k.z - p.pos.z) < 1.1 && Math.abs(k.y - p.pos.y) < 1.2) {
        k.active = false;
        k.respawn = 120;
        k.mesh.visible = false;
        this.give(k.id);
      }
    }
    this.refreshHeld();

    // 飛んでいくもの
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      const prev = pr.pos.clone();
      pr.vel.y -= (pr.kind === 'rocket' ? 2 : 18) * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos);
      if (pr.kind === 'rocket') {
        pr.mesh.lookAt(_v.copy(pr.pos).add(pr.vel));
        g.fx.sparks(pr.pos);
      } else pr.mesh.rotation.x += dt * 12;
      let hit = pr.t > (pr.kind === 'rocket' ? 3 : 4);
      const step = pr.pos.clone().sub(prev);
      const len = step.length();
      if (!hit && len > 0) {
        const r = g.physics.raycast(prev, step.normalize(), len, G.STATIC | G.VEHICLE, p.driving?.collider);
        if (r) {
          hit = true;
          pr.pos.copy(r.point);
        }
      }
      if (!hit && pr.pos.y <= g.world.groundHeight(pr.pos.x, pr.pos.z)) hit = true;
      if (!hit && pr.kind === 'rocket') {
        for (const n of g.npcs.list) if (n.alive && Math.hypot(n.pos.x - pr.pos.x, n.pos.z - pr.pos.z) < 0.7 && pr.pos.y - n.pos.y < n.height) hit = true;
      }
      if (hit) {
        g.scene.remove(pr.mesh);
        this.projectiles.splice(i, 1);
        if (pr.kind === 'rocket') g.explode(pr.pos, true, 0.8);
        else {
          g.audio.play('glass', pr.pos, 1);
          g.audio.play('boom', pr.pos, 0.35, 1.8);
          this.addFire(pr.pos.x, pr.pos.z, 3.2, 10);
          for (const n of g.npcs.list) if (n.alive && Math.hypot(n.pos.x - pr.pos.x, n.pos.z - pr.pos.z) < 3.4) n.ignite(true);
          g.npcs.panicAround(pr.pos, 25);
          g.karma.crime('bomb', pr.pos);
        }
      }
    }

    // 火の海
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      if (f.t < 0) {
        this.fires.splice(i, 1);
        continue;
      }
      const n = Math.ceil(f.r * f.r * 7 * dt * 10);
      for (let k = 0; k < n; k++) {
        const a = rand.range(0, Math.PI * 2);
        const r = Math.sqrt(rand.next()) * f.r;
        g.fx.flame(new THREE.Vector3(f.x + Math.cos(a) * r, f.y + 0.05, f.z + Math.sin(a) * r), 1.4 * Math.min(1, f.t / 2 + 0.3));
      }
      for (const npc of g.npcs.list) if (npc.alive && Math.hypot(npc.pos.x - f.x, npc.pos.z - f.z) < f.r) npc.ignite(true);
      for (const v of g.traffic.list) if (!v.wrecked && Math.hypot(v.pos.x - f.x, v.pos.z - f.z) < f.r + 1) v.hp -= 14 * dt;
      if (!p.driving && Math.hypot(p.pos.x - f.x, p.pos.z - f.z) < f.r) p.hurt(14, new THREE.Vector3(f.x, f.y, f.z));
    }

    // 撒菱
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const fl = this.fields[i];
      fl.t -= dt;
      if (fl.t < 0) {
        g.scene.remove(fl.mesh);
        fl.mesh.dispose();
        this.fields.splice(i, 1);
        continue;
      }
      for (const n of g.npcs.list) {
        if (!n.alive || Math.hypot(n.pos.x - fl.x, n.pos.z - fl.z) > fl.r) continue;
        const r = n.stepOnSpikes(true);
        if (r) g.karma.crime(r === 2 ? 'kill' : 'bite', n.pos, n.kind, 1, 'spikes');
      }
      for (const v of g.traffic.list) {
        if (v.wrecked || v.flat || Math.abs(v.speed) < 2) continue;
        if (Math.hypot(v.pos.x - fl.x, v.pos.z - fl.z) < fl.r + v.spec.halfW) {
          v.puncture();
          if (v === p.driving) g.hud.toast('パンクした！', 'bad', 2);
        }
      }
    }

    // 仕掛けた爆弾（点滅・起爆）
    this.beepT -= dt;
    const blink = Math.floor(performance.now() / 350) % 2 === 0;
    for (let i = this.charges.length - 1; i >= 0; i--) {
      const c = this.charges[i];
      c.light.visible = blink || c.fuse >= 0;
      if (c.vehicle && (c.vehicle.dead || c.vehicle.wrecked) && c.fuse < 0) c.fuse = 0.1;
      if (c.fuse >= 0) {
        c.fuse -= dt;
        if (c.fuse < 0) {
          const at = this.chargePos(c);
          c.mesh.parent?.remove(c.mesh);
          this.charges.splice(i, 1);
          g.explode(at, true, 1.15);
        }
      }
    }
    if (this.charges.length && this.beepT < 0) {
      this.beepT = 1.5;
      const near = this.charges.some((c) => this.chargePos(c).distanceTo(p.pos) < 12);
      if (near) g.audio.play('beep', p.pos, 0.15);
    }
  }

  /** HUD 用の情報 */
  get hud() {
    return {
      current: this.current,
      name: WEAPONS[this.current].name,
      ammo: this.ammoText(this.current),
      owned: this.owned.map((w) => ({ id: w, key: WEAPON_ORDER.indexOf(w) + 1, name: WEAPONS[w].name, ammo: this.ammoText(w) })),
      charges: this.charges.length,
      aim: this.current === 'rocket' || this.current === 'molotov',
    };
  }
}
