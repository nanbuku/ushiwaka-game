import * as THREE from 'three';
import type { Game } from '../core/Game';
import { rand } from '../core/Rng';
import type { District } from '../world/Layout';
import type { StaticSpot } from '../world/World';
import { HumanModel, makeLook, type HumanKind } from './Human';
import { NPC } from './NPC';

const DENSITY: Record<District, number> = {
  town: 16,
  city: 26,
  downtown: 28,
  civic: 16,
  park: 16,
  amusement: 26,
  countryHill: 6,
  countryField: 7,
  riverside: 10,
};

const MIX: Record<District, Partial<Record<HumanKind, number>>> = {
  town: { man: 22, woman: 30, child: 16, elderly: 26, office: 6 },
  city: { office: 55, man: 20, woman: 20, elderly: 5 },
  downtown: { man: 36, woman: 40, office: 14, child: 5, elderly: 5 },
  civic: { child: 38, elderly: 22, man: 20, woman: 20 },
  park: { child: 30, elderly: 30, woman: 22, man: 18 },
  amusement: { child: 36, woman: 30, man: 30, elderly: 4 },
  countryHill: { elderly: 60, man: 25, woman: 15 },
  countryField: { elderly: 60, man: 25, woman: 15 },
  riverside: { man: 60, office: 15, woman: 25 },
};

/** 通行人の生成・削除と、うしわかとのやりとり */
export class NPCManager {
  list: NPC[] = [];
  private spawnT = 0;
  private staticNpc = new Map<StaticSpot, NPC | null>();
  private v = new THREE.Vector3();

  constructor(private game: Game) {}

  get aliveCount() {
    return this.list.filter((n) => n.alive).length;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player.pos;
    const district = g.world.district(p.x, p.z);
    const target = DENSITY[district];
    this.spawnT -= dt;
    const roaming = this.list.filter((n) => n.alive && !n.home).length;
    if (this.spawnT <= 0 && roaming < target) {
      this.spawnRoamer(district);
      this.spawnT = 0.2;
    }
    // 店員など持ち場のある人
    for (const spot of g.world.staticSpots) {
      const d = Math.hypot(spot.x - p.x, spot.z - p.z);
      const cur = this.staticNpc.get(spot) ?? null;
      if (!cur && d < 75 && d > 20) {
        const n = this.create('clerk', spot.x, spot.y, spot.z);
        n.home = { x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw };
        n.yaw = spot.yaw;
        n.state = 'idle';
        this.staticNpc.set(spot, n);
      }
    }
    for (const n of this.list) n.update(dt);
    // 遠くの人は消す
    let corpses = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i];
      const d = Math.hypot(n.pos.x - p.x, n.pos.z - p.z);
      if (!n.alive) corpses++;
      const far = n.alive ? d > 125 : d > 95 || corpses > 30;
      if (far) {
        n.dispose();
        this.list.splice(i, 1);
        for (const [spot, sn] of this.staticNpc) if (sn === n) this.staticNpc.set(spot, null);
      }
    }
  }

  private create(kind: HumanKind, x: number, y: number, z: number) {
    const model = new HumanModel(makeLook(kind, rand));
    const n = new NPC(this.game, kind, model, x, y, z);
    this.list.push(n);
    return n;
  }

  private spawnRoamer(district: District) {
    const g = this.game;
    const p = g.player.pos;
    const pick = g.world.nav.randomEdgeNear(p.x, p.z, 30, 85, rand);
    if (!pick) return;
    const [a, b, t] = pick;
    const d = g.world.district(a.x, a.z);
    const kind = rand.weighted(MIX[d] ?? MIX[district]);
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const n = this.create(kind, x, a.y, z);
    n.setPath(a, b);
    n.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** うしわかの正面にいる噛める相手 */
  findBiteTarget(pos: THREE.Vector3, yaw: number, range: number): NPC | null {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let best: NPC | null = null;
    let bd = Infinity;
    for (const n of this.list) {
      if (!n.alive) continue;
      const dx = n.pos.x - pos.x;
      const dz = n.pos.z - pos.z;
      const d = Math.hypot(dx, dz) - n.radius;
      if (d > range || Math.abs(n.pos.y - pos.y) > 1.2) continue;
      const dot = (dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz));
      if (dot < 0.25 && d > 0.25) continue;
      const score = d - dot * 0.5;
      if (score < bd) {
        bd = score;
        best = n;
      }
    }
    return best;
  }

  playerBites(n: NPC) {
    const g = this.game;
    const kind = n.kind;
    const res = n.bitten(rand.range(24, 34), g.player.pos);
    g.audio.play('bite', n.pos, 0.9);
    g.hud.popText(n.pos.clone().add(this.v.set(0, 0.9, 0)), 'ガブッ', '#ff3b3b', 30);
    g.camRig.addShake(0.25);
    if (res === 'corpse') return;
    g.karma.crime(res === 'kill' ? 'kill' : 'bite', n.pos, kind);
    this.panicAround(n.pos, res === 'kill' ? 26 : 16, n);
  }

  onBark(pos: THREE.Vector3, radius: number, big: boolean) {
    let fainted = 0;
    for (const n of this.list) {
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
      if (d > radius) continue;
      if (n.barked(d, radius, big, pos)) fainted++;
    }
    if (fainted) this.game.karma.crime('faint', pos, `${fainted}人`, fainted);
  }

  /** 事件を目撃した人たちが逃げ出す */
  panicAround(pos: THREE.Vector3, radius: number, except?: NPC) {
    for (const n of this.list) {
      if (n === except || !n.conscious) continue;
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
      if (d < radius) n.scare(pos, rand.range(0.2, 0.7));
    }
  }

  /** 近くにいる意識のある人の数（目撃者） */
  witnesses(pos: THREE.Vector3, radius: number) {
    let c = 0;
    for (const n of this.list) if (n.conscious && Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z) < radius) c++;
    return c;
  }
}
