import * as THREE from 'three';
import type { Game } from '../core/Game';
import { G } from '../core/Physics';
import { clamp, damp, rand } from '../core/Rng';
import { colorMat } from '../npc/Human';
import type { NPC } from '../npc/NPC';
import type { Vehicle } from '../vehicles/Vehicle';
import { castShot, Nukes, playerShotHit, Tracers } from './Guns';

export type WeaponId = 'bite' | 'bat' | 'chainsaw' | 'pistol' | 'smg' | 'rocket' | 'missile' | 'molotov' | 'c4' | 'nuke' | 'caltrops' | 'megaphone';

/** 持ち替えの順番（キー 1〜9, 0, -, ^） */
export const WEAPON_ORDER: WeaponId[] = ['bite', 'bat', 'chainsaw', 'pistol', 'smg', 'rocket', 'missile', 'molotov', 'c4', 'nuke', 'caltrops', 'megaphone'];
export const WEAPON_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
export const KEY_LABEL = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '^'];

/** 武器は一度拾えば無制限に使える */
export const WEAPONS: Record<WeaponId, { name: string; help: string }> = {
  bite: { name: '噛みつき', help: '左クリック: 噛みつく' },
  bat: { name: '金属バット', help: '左クリック: フルスイング（人を打ち飛ばす）' },
  chainsaw: { name: 'チェーンソー', help: '左クリック長押し: 切りつける' },
  pistol: { name: '拳銃', help: '左クリック: 画面の中央を撃つ' },
  smg: { name: 'マシンガン', help: '左クリック長押し: 連射' },
  rocket: { name: 'ロケット花火', help: '左クリック: 画面の中央に向けて発射（当たると爆発）' },
  missile: { name: '追尾ミサイル', help: '左クリック: 照準の近くの人・車を追いかけて大爆発' },
  molotov: { name: '火炎瓶', help: '左クリック: 投げる（火の海にする）' },
  c4: { name: 'リモコン爆弾', help: '左クリック: 設置（車の近くなら車に仕掛ける）　G: 全部まとめて起爆' },
  nuke: { name: '核爆弾', help: '左クリック: 足元に設置 → 10秒後に半径160mが消し飛ぶ。全力で逃げて！' },
  caltrops: { name: '撒菱（まきびし）', help: '左クリック: 足元にまく（踏んだ人はけが、車はパンク）' },
  megaphone: { name: '拡声器', help: '左クリック: 拡声器で大吠え（お年寄りはショック死）' },
};

/** 落ちている物は回復系だけ（ジャーキー・大きな骨・もふもふベスト） */
type PickId = 'heal' | 'bigheal' | 'vest';

interface Pickup {
  id: PickId;
  x: number;
  y: number;
  z: number;
  mesh: THREE.Group;
  active: boolean;
  respawn: number;
}

interface Projectile {
  kind: 'rocket' | 'molotov' | 'missile' | 'shell' | 'mininuke';
  /** ミサイルの最高速度（乗り物から撃つと、その乗り物より速い） */
  maxSpeed?: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Object3D;
  t: number;
  target?: NPC | Vehicle | null;
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
function weaponModel(id: WeaponId | PickId): THREE.Group {
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
    case 'pistol':
      add(new THREE.BoxGeometry(0.04, 0.06, 0.2), '#2a2a2e', 0, 0.02, 0.06);
      add(new THREE.BoxGeometry(0.035, 0.1, 0.05), '#3a2a20', 0, -0.04, -0.02, -0.25);
      break;
    case 'smg':
      add(new THREE.BoxGeometry(0.05, 0.08, 0.34), '#232326', 0, 0.02, 0.08);
      add(new THREE.CylinderGeometry(0.013, 0.013, 0.16, 8), '#111111', 0, 0.035, 0.32, Math.PI / 2);
      add(new THREE.BoxGeometry(0.03, 0.14, 0.05), '#111111', 0, -0.07, 0.1, 0.2);
      add(new THREE.BoxGeometry(0.035, 0.07, 0.12), '#3a3a3e', 0, 0.0, -0.14);
      break;
    case 'missile':
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.62, 12), '#5b6b3a', 0, 0.03, 0.08, Math.PI / 2);
      add(new THREE.ConeGeometry(0.05, 0.12, 10), '#d8d8d8', 0, 0.03, 0.44, Math.PI / 2);
      add(new THREE.BoxGeometry(0.03, 0.08, 0.05), '#222222', 0, -0.05, 0.02);
      break;
    case 'nuke':
      add(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 14), '#e8c200', 0, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.083, 0.083, 0.03, 14), '#111111', 0, 0, 0.05, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.083, 0.083, 0.03, 14), '#111111', 0, 0, -0.05, Math.PI / 2);
      break;
    case 'heal':
    case 'bigheal': {
      const s = id === 'bigheal' ? 1.6 : 1;
      const bone = id === 'bigheal' ? new THREE.MeshStandardMaterial({ color: '#ffd23f', metalness: 0.6, roughness: 0.3, emissive: '#7a5a00', emissiveIntensity: 0.4 }) : new THREE.MeshStandardMaterial({ color: '#f4ead6', roughness: 0.6 });
      add(new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.32 * s, 10), '', 0, 0, 0, 0, 0, Math.PI / 2, bone);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.SphereGeometry(0.06 * s, 10, 8), '', sx * 0.17 * s, 0, sz * 0.045 * s, 0, 0, 0, bone);
      break;
    }
    case 'vest':
      add(new THREE.BoxGeometry(0.34, 0.36, 0.14), '#f6f1e6', 0, 0, 0);
      add(new THREE.BoxGeometry(0.36, 0.06, 0.16), '#7aa6d6', 0, 0.08, 0);
      add(new THREE.BoxGeometry(0.36, 0.06, 0.16), '#7aa6d6', 0, -0.08, 0);
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
  /** 持っている武器（拾えば無制限に使える） */
  ammo: Record<WeaponId, number> = { bite: Infinity, bat: Infinity, chainsaw: Infinity, pistol: Infinity, smg: Infinity, rocket: Infinity, missile: Infinity, molotov: Infinity, c4: Infinity, nuke: Infinity, caltrops: Infinity, megaphone: Infinity };
  /** 銃の威力の倍率（ストーリーのごほうびで上がる） */
  power = 1;
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
  private gunT = 0;
  private tankCd = 0;
  tracers: Tracers;
  nukes: Nukes;

  constructor(private game: Game) {
    this.tracers = new Tracers(game.scene);
    this.nukes = new Nukes(game);
  }

  /** ワールドの武器置き場から拾える武器を並べる */
  init() {
    const g = this.game;
    const spots: { id: PickId; x: number; y: number; z: number }[] = [];
    // もと武器が置いてあった場所は、回復アイテムに
    for (const s of g.world.weaponSpots) spots.push({ id: s.id === 'vest' ? 'vest' : rand.chance(0.7) ? 'heal' : 'bigheal', x: s.x, y: s.y, z: s.z });
    // 町じゅうの歩道に多めに
    const nodes = g.world.nav.nodes;
    for (let k = 0; k < 120 && nodes.length; k++) {
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      spots.push({ id: k % 6 === 0 ? 'vest' : k % 3 === 0 ? 'bigheal' : 'heal', x: n.x + rand.range(-1.5, 1.5), y: n.y, z: n.z + rand.range(-1.5, 1.5) });
    }
    // 外のエリアにも
    const out: [number, number][] = [[-150, 455], [0, 455], [150, 455], [-100, -480], [60, -560], [410, -150], [410, 150], [490, 50], [-340, 100], [-340, -100], [670, -200], [670, 100], [670, 400], [900, -100], [905, -260], [1000, 330], [960, 260], [-970, 400], [-950, -40], [-805, 40], [-970, 200], [0, -330], [0, 380]];
    const lm = g.world.landmarks;
    for (const k of ['summit', 'base', 'airport', 'lake', 'range', 'island', 'carrier']) if (lm[k]) out.push([lm[k].x + 4, lm[k].z + 4]);
    out.forEach(([x, z], k) => spots.push({ id: k % 4 === 0 ? 'vest' : k % 2 ? 'bigheal' : 'heal', x, y: g.world.groundHeight(x, z), z }));
    for (const s of spots) {
      const mesh = new THREE.Group();
      const m = weaponModel(s.id);
      m.scale.setScalar(s.id === 'vest' ? 1.7 : 2.2);
      m.position.y = 0.45;
      mesh.add(m);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: s.id === 'vest' ? '#7aa6d6' : '#7dff7a', transparent: true, opacity: 0.6, depthWrite: false }));
      ring.position.y = 0.03;
      mesh.add(ring);
      mesh.position.set(s.x, s.y, s.z);
      g.scene.add(mesh);
      this.pickups.push({ id: s.id, x: s.x, y: s.y, z: s.z, mesh, active: true, respawn: 0 });
    }
  }

  get owned() {
    return WEAPON_ORDER.filter((w) => this.ammo[w] > 0);
  }

  give(id: WeaponId, quiet = false) {
    const def = WEAPONS[id];
    const had = this.ammo[id] > 0;
    this.ammo[id] = Infinity;
    const g = this.game;
    if (quiet || had) return;
    g.audio.play('pickup', g.player.pos, 0.9, 0.8);
    g.hud.toast(`${def.name}を手に入れた！（無制限）　キー ${KEY_LABEL[WEAPON_ORDER.indexOf(id)]} / R で持ち替え`, 'good', 4);
    this.select(id);
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

  private use(_id: WeaponId) {
    // 武器は無制限
  }

  /** 画面の中央へ向かう光線（カメラからうしわかの位置まで進めたところから） */
  private aimRay() {
    const g = this.game;
    const dir = new THREE.Vector3();
    g.camera.getWorldDirection(dir);
    const along = Math.max(0, g.player.pos.clone().sub(g.camera.position).dot(dir));
    return { origin: g.camera.position.clone().addScaledVector(dir, along + 0.4), dir };
  }

  /** 銃を1発撃つ */
  private fireGun(dmg: number, spread: number) {
    const g = this.game;
    const p = g.player;
    const { origin, dir } = this.aimRay();
    dir.x += rand.range(-spread, spread);
    dir.y += rand.range(-spread, spread);
    dir.z += rand.range(-spread, spread);
    dir.normalize();
    const hit = castShot(g, origin, dir, 160, { exclude: p.driving?.collider });
    const muzzle = p.mouthWorld().add(p.forward.multiplyScalar(0.3));
    this.tracers.add(muzzle, hit.point);
    g.fx.sparks(muzzle);
    g.audio.play('gun', p.pos, this.current === 'smg' ? 0.55 : 0.8, this.current === 'smg' ? 1.15 : 1);
    playerShotHit(g, hit, dmg * this.power, p.pos);
    // 撃てばまわりの人は逃げる
    if (Math.random() < 0.3) g.npcs.panicAround(p.pos, 25);
  }

  /** 照準の近くにいる、ミサイルの狙い */
  private lockTarget(): NPC | Vehicle | null {
    const g = this.game;
    const { origin, dir } = this.aimRay();
    let best: NPC | Vehicle | null = null;
    let bs = Math.cos(0.17);
    const check = (o: NPC | Vehicle, pos: THREE.Vector3) => {
      const to = pos.clone().sub(origin);
      const d = to.length();
      if (d > 220 || d < 3) return;
      const c = to.dot(dir) / d;
      if (c > bs) {
        bs = c;
        best = o;
      }
    };
    for (const n of g.npcs.list) if (n.alive) check(n, n.pos.clone().setY(n.pos.y + 1));
    for (const v of g.traffic.list) if (!v.wrecked && v !== g.player.driving) check(v, v.pos.clone().setY(v.pos.y + 1));
    const k = g.story.kaiju;
    if (k && k.alive) check(k as unknown as NPC, k.pos.clone().setY(k.pos.y + 8));
    for (const c of g.airforce.targets()) check(c as unknown as NPC, c.pos);
    const sh = g.skyships.ship;
    if (g.skyships.alive) check(sh as unknown as NPC, sh.pos);
    return best;
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
      case 'pistol':
        this.cd = 0.2;
        this.fireGun(75, 0.006);
        break;
      case 'smg':
        this.gunT = 0;
        break;
      case 'missile': {
        this.cd = 0.8;
        const { dir } = this.aimRay();
        // 足元の地面に撃ち込まないよう、ねらいが下を向きすぎていたら水平に近づける
        dir.y = Math.max(dir.y, -0.06);
        dir.normalize();
        const target = this.lockTarget();
        const mesh = weaponModel('missile');
        mesh.scale.setScalar(1.6);
        this.projectiles.push({ kind: 'missile', pos: head.clone().add(dir.clone().multiplyScalar(0.5)), vel: dir.clone().multiplyScalar(60).add(new THREE.Vector3(0, 3, 0)), mesh, t: 0, target, maxSpeed: 130 });
        g.scene.add(mesh);
        g.audio.play('whoosh', p.pos, 1, 0.6);
        g.audio.play('whistle', p.pos, 0.6, 0.5);
        if (target) g.hud.popText(head.clone().setY(head.y + 0.4), 'ロックオン!', '#ff5d5d', 20);
        break;
      }
      case 'nuke':
        this.cd = 1;
        this.nukes.place(new THREE.Vector3(p.pos.x, g.world.groundHeight(p.pos.x, p.pos.z), p.pos.z));
        break;
      default:
        break;
    }
  }

  /** 左クリック長押し中（チェーンソー・マシンガン） */
  attackHeld(dt: number) {
    if (this.current === 'smg') {
      this.gunT -= dt;
      while (this.gunT <= 0) {
        this.gunT += 0.085;
        this.fireGun(34, 0.022);
        this.game.camRig.addShake(0.05);
      }
      return;
    }
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
    const tip = p.mouthWorld().add(p.forward.multiplyScalar(0.6));
    if (!g.story.biteAt(tip, 90)) g.destruction.hitNear(tip, 1.3, 90, true);
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
    if (this.charges.length >= 20) {
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
      g.hud.toast(`${vehicle.spec.name}に爆弾を仕掛けた（${this.charges.length + 1}個目）`, 'evil', 3);
    } else {
      mesh.position.copy(pos);
      g.scene.add(mesh);
      g.hud.toast(`爆弾を設置した（${this.charges.length + 1}個目）　G で起爆`, 'evil', 2.5);
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
    this.tankCd -= dt;
    this.tracers.update(dt);
    this.nukes.update(dt);
    if (p.driving?.kind === 'tank') this.tankControl(dt, p.driving);
    if (p.driving?.kind === 'jet' || p.driving?.kind === 'heli') this.jetControl(dt, p.driving);
    if (this.sawing > 0) {
      this.sawing -= dt;
      if (this.sawing <= 0) g.audio.sawOff();
    }
    // 拾う
    for (const k of this.pickups) {
      if (!k.active) {
        k.respawn -= dt;
        if (k.respawn < 0 && Math.hypot(k.x - p.pos.x, k.z - p.pos.z) > 20) {
          k.active = true;
          k.mesh.visible = true;
        }
        continue;
      }
      k.mesh.rotation.y += dt * 1.6;
      k.mesh.children[0].position.y = 0.45 + Math.sin(performance.now() * 0.003 + k.x) * 0.08;
      if (!p.driving && Math.hypot(k.x - p.pos.x, k.z - p.pos.z) < 1.1 && Math.abs(k.y - p.pos.y) < 1.2) {
        if (k.id === 'vest') {
          if (p.armor >= p.maxArmor - 1) continue;
          p.armor = p.maxArmor;
          g.hud.popText(p.headWorld(), '防具 満タン!', '#9fc4ff', 22);
        } else {
          if (p.hp >= p.maxHp - 0.5 && (k.id === 'heal' || p.armor >= p.maxArmor - 1)) continue;
          p.hp = k.id === 'bigheal' ? p.maxHp : Math.min(p.maxHp, p.hp + p.maxHp * 0.45);
          if (k.id === 'bigheal') p.armor = Math.min(p.maxArmor, p.armor + 50);
          g.hud.popText(p.headWorld(), k.id === 'bigheal' ? '元気 全回復!' : '元気 回復!', '#7dff7a', 22);
        }
        g.audio.play('pickup', p.pos, 0.9, 0.8);
        k.active = false;
        k.respawn = 40;
        k.mesh.visible = false;
      }
    }
    this.refreshHeld();

    // 飛んでいくもの
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      const prev = pr.pos.clone();
      if (pr.kind === 'missile' || pr.kind === 'mininuke') this.steerMissile(pr, dt);
      else pr.vel.y -= (pr.kind === 'rocket' ? 2 : pr.kind === 'shell' ? 3 : 18) * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos);
      if (pr.kind === 'rocket') {
        pr.mesh.lookAt(_v.copy(pr.pos).add(pr.vel));
        g.fx.sparks(pr.pos);
      } else if (pr.kind === 'missile' || pr.kind === 'shell' || pr.kind === 'mininuke') {
        pr.mesh.lookAt(_v.copy(pr.pos).add(pr.vel));
        if (pr.kind !== 'shell') g.fx.smoke(pr.pos.clone(), pr.kind === 'mininuke');
      } else pr.mesh.rotation.x += dt * 12;
      let hit = pr.t > (pr.kind === 'rocket' ? 3 : pr.kind === 'molotov' ? 4 : 6);
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
      // 大きな的（怪獣・飛行船）は近づいたら当たり
      const big = pr.target as unknown as { pos: THREE.Vector3; hitR?: number } | null | undefined;
      if (!hit && big?.hitR && pr.pos.distanceTo(big.pos) < big.hitR) hit = true;
      if (!hit && pr.kind !== 'molotov') {
        for (const n of g.npcs.list) if (n.alive && Math.hypot(n.pos.x - pr.pos.x, n.pos.z - pr.pos.z) < (pr.kind === 'rocket' ? 0.7 : 1.1) && pr.pos.y - n.pos.y < n.height && pr.pos.y > n.pos.y - 0.3) hit = true;
      }
      if (hit) {
        g.scene.remove(pr.mesh);
        this.projectiles.splice(i, 1);
        // 撃ってすぐ（0.6秒以内）に目の前で当たった爆発では、うしわか自身は傷つかない
        const spare = pr.t < 0.6;
        if (pr.kind === 'rocket') g.explode(pr.pos, true, 0.8, spare);
        else if (pr.kind === 'missile') g.explode(pr.pos, true, 1.7, spare);
        else if (pr.kind === 'shell') g.explode(pr.pos, true, 2.1, spare);
        else if (pr.kind === 'mininuke') this.nukes.detonate(pr.pos.clone(), 0.75);
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

  /** ミサイルを狙いに向けて曲げる */
  private steerMissile(pr: Projectile, dt: number) {
    const speed = Math.min(pr.maxSpeed ?? 130, (pr.maxSpeed ? pr.maxSpeed * 0.7 : 60) + pr.t * 160);
    const t = pr.target;
    let want: THREE.Vector3 | null = null;
    if (t) {
      const alive = 'alive' in t ? t.alive || pr.t < 0.2 : !t.wrecked && !t.dead;
      if (alive) want = t.pos.clone().setY(t.pos.y + 0.9).sub(pr.pos).normalize();
      else pr.target = null;
    }
    if (want && pr.t > 0.15) {
      const cur = pr.vel.clone().normalize();
      cur.lerp(want, Math.min(1, dt * 5)).normalize();
      pr.vel.copy(cur.multiplyScalar(speed));
    } else pr.vel.setLength(speed);
  }

  /** 戦闘機：左クリック長押しで機関砲、右クリックで追尾ミサイル */
  private jetControl(dt: number, v: Vehicle) {
    const g = this.game;
    const inp = g.input;
    if (!inp.active || g.dialogue.busy || g.paused) return;
    const cp = Math.cos(v.pitch);
    const fwd = new THREE.Vector3(Math.sin(v.yaw) * cp, Math.sin(v.pitch), Math.cos(v.yaw) * cp);
    const nose = v.pos.clone().add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(fwd, 7.5);
    if (inp.mouseDown(0)) {
      this.gunT -= dt;
      while (this.gunT <= 0) {
        this.gunT += 0.06;
        const dir = fwd.clone().add(new THREE.Vector3(rand.range(-0.012, 0.012), rand.range(-0.012, 0.012), rand.range(-0.012, 0.012))).normalize();
        const hit = castShot(g, nose, dir, 320, { exclude: v.collider });
        this.tracers.add(nose, hit.point, '#ffe08a', 0.05);
        playerShotHit(g, hit, 45, v.pos);
        g.audio.play('gun', v.pos, 0.45, 1.3);
      }
    }
    if (inp.mousePressed(2) && this.cd <= 0) {
      // 戦闘機は少核弾頭、ヘリは追尾ミサイル。どちらも機体より速く飛ぶ
      const jet = v.kind === 'jet';
      this.cd = jet ? 3.5 : 0.7;
      const target = this.lockTarget();
      const mesh = weaponModel(jet ? 'nuke' : 'missile');
      mesh.scale.setScalar(jet ? 3 : 2);
      const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw)).multiplyScalar(rand.chance(0.5) ? 2.2 : -2.2);
      const sp = Math.max(jet ? 150 : 140, Math.abs(v.speed) + (jet ? 95 : 110));
      // 狙いは画面の中央（照準）の方向
      const aim = new THREE.Vector3();
      g.camera.getWorldDirection(aim);
      this.projectiles.push({ kind: jet ? 'mininuke' : 'missile', pos: v.pos.clone().add(side).setY(v.pos.y + 0.9), vel: aim.multiplyScalar(sp), mesh, t: 0.3, target, maxSpeed: sp });
      g.scene.add(mesh);
      g.audio.play('whoosh', v.pos, 1, jet ? 0.4 : 0.6);
      g.hud.popText(v.pos.clone().setY(v.pos.y + 3), jet ? (target ? '少核弾頭 ロックオン!' : '少核弾頭 発射!') : target ? 'ロックオン!' : '発射!', jet ? '#ffd23f' : '#ff5d5d', 22);
    }
  }

  /** 戦車：砲塔はマウスの向き、左クリックで主砲 */
  private tankControl(dt: number, v: Vehicle) {
    const g = this.game;
    const m = v.model;
    if (!m.turret || !m.barrel || !m.muzzle) return;
    const d = new THREE.Vector3();
    g.camera.getWorldDirection(d);
    let rel = Math.atan2(d.x, d.z) - v.yaw - m.turret.rotation.y;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    m.turret.rotation.y += clamp(rel, -1.6 * dt, 1.6 * dt);
    const pitchT = clamp(-Math.asin(clamp(d.y, -1, 1)) - 0.16, -0.42, 0.1);
    m.barrel.rotation.x += (pitchT - m.barrel.rotation.x) * damp(6, dt);
    m.barrel.position.z += (1.8 - m.barrel.position.z) * damp(5, dt);
    const inp = g.input;
    if (!inp.active || g.dialogue.busy || g.paused || !inp.mousePressed(0) || this.tankCd > 0) return;
    this.tankCd = 1.3;
    m.barrel.updateWorldMatrix(true, true);
    const mp = new THREE.Vector3();
    m.muzzle.getWorldPosition(mp);
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(m.barrel.getWorldQuaternion(new THREE.Quaternion()));
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd166' }));
    this.projectiles.push({ kind: 'shell', pos: mp.clone(), vel: dir.multiplyScalar(140), mesh, t: 0 });
    g.scene.add(mesh);
    m.barrel.position.z = 1.2;
    g.audio.play('cannon', mp, 1);
    g.camRig.addShake(0.7);
    for (let k = 0; k < 4; k++) g.fx.smoke(mp.clone().add(new THREE.Vector3(rand.range(-0.5, 0.5), rand.range(-0.3, 0.3), rand.range(-0.5, 0.5))), false);
    g.fx.sparks(mp);
    g.npcs.panicAround(mp, 40);
  }

  /** HUD 用の情報 */
  get hud() {
    const c4 = this.charges.length ? `仕掛けた爆弾 ${this.charges.length}個　<b>G</b> で起爆` : '';
    return {
      current: this.current,
      name: WEAPONS[this.current].name,
      ammo: this.ammoText(this.current),
      owned: this.owned.map((w) => ({ id: w, key: KEY_LABEL[WEAPON_ORDER.indexOf(w)], name: WEAPONS[w].name, ammo: this.ammoText(w) })),
      note: [c4, this.nukes.note].filter(Boolean).join('<br>'),
      aim: ['rocket', 'molotov', 'pistol', 'smg', 'missile'].includes(this.current),
    };
  }
}
