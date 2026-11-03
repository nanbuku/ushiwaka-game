import * as THREE from 'three';
import type { Game } from '../core/Game';
import { clamp, rand } from '../core/Rng';
import { makeLook } from '../npc/Human';
import { createHuman } from '../npc/KenneyHuman';
import { NPC } from '../npc/NPC';
import { ROAD, type RoadSeg } from '../world/Layout';
import { Vehicle, type Lane } from './Vehicle';
import type { VehicleKind } from './VehicleModel';

const key = (x: number, z: number) => `${x},${z}`;
const TRAFFIC_KINDS: Partial<Record<VehicleKind, number>> = { sedan: 60, taxi: 15, van: 12, truck: 8, scooter: 5 };

/** 交通（走る車）と駐車中の乗り物、乗り降り、ひき逃げの判定 */
export class Traffic {
  list: Vehicle[] = [];
  lanes: Lane[] = [];
  private lanesFrom = new Map<string, Lane[]>();
  private spawnT = 0;
  private spotVehicles = new Map<number, Vehicle | null>();

  constructor(private game: Game) {
    this.buildLanes(game.world.roads);
  }

  private crossHW(roads: RoadSeg[], axis: 'h' | 'v', x: number, z: number) {
    let hw = 0;
    for (const r of roads) {
      if (r.axis === axis) continue;
      if (axis === 'h' && r.line === x && (r.a === z || r.b === z)) hw = Math.max(hw, ROAD[r.kind].hw);
      if (axis === 'v' && r.line === z && (r.a === x || r.b === x)) hw = Math.max(hw, ROAD[r.kind].hw);
    }
    return hw;
  }

  private buildLanes(roads: RoadSeg[]) {
    roads.forEach((r, segId) => {
      const lo = ROAD[r.kind].hw * 0.48;
      const cruise = r.kind === 'avenue' ? 12 : r.kind === 'street' ? 9 : 8;
      for (const dir of [1, -1]) {
        const a = dir > 0 ? r.a : r.b;
        const b = dir > 0 ? r.b : r.a;
        const [ax, az] = r.axis === 'h' ? [a, r.line] : [r.line, a];
        const [bx, bz] = r.axis === 'h' ? [b, r.line] : [r.line, b];
        const fx = Math.sign(bx - ax);
        const fz = Math.sign(bz - az);
        const lx = fz;
        const lz = -fx;
        const mA = (r.axis === 'h' ? this.crossHW(roads, 'h', ax, az) : this.crossHW(roads, 'v', ax, az)) + 1.5;
        const mB = (r.axis === 'h' ? this.crossHW(roads, 'h', bx, bz) : this.crossHW(roads, 'v', bx, bz)) + 1.5;
        const lane: Lane = {
          id: this.lanes.length,
          sx: ax + fx * mA + lx * lo,
          sz: az + fz * mA + lz * lo,
          ex: bx - fx * mB + lx * lo,
          ez: bz - fz * mB + lz * lo,
          fx,
          fz,
          len: Math.abs(b - a) - mA - mB,
          cruise,
          startKey: key(ax, az),
          endKey: key(bx, bz),
          segId,
          y: 0.02,
        };
        this.lanes.push(lane);
        const arr = this.lanesFrom.get(lane.startKey) ?? [];
        arr.push(lane);
        this.lanesFrom.set(lane.startKey, arr);
      }
    });
  }

  get playerVehicle() {
    return this.game.player.driving;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player.pos;
    // 駐車スポット
    g.world.vehicleSpots.forEach((s, i) => {
      const cur = this.spotVehicles.get(i) ?? null;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (!cur && d < 110 && d > 25) {
        const v = new Vehicle(g, s.kind, s.x, s.y, s.z, s.yaw);
        v.persistent = true;
        this.list.push(v);
        this.spotVehicles.set(i, v);
      }
    });
    // 交通の生成
    const district = g.world.district(p.x, p.z);
    const target = district === 'countryHill' || district === 'countryField' ? 4 : district === 'park' || district === 'amusement' ? 7 : 12;
    const moving = this.list.filter((v) => v.ai).length;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && moving < target) {
      this.spawnT = 0.5;
      this.spawnTraffic();
    }

    for (const v of this.list) {
      if (v.driver === 'player') continue;
      if (v.wrecked) {
        v.updateWreck(dt);
        v.sync(0);
      } else if (v.ai) this.stepAI(v, dt);
      else {
        v.speed *= 1 - Math.min(1, dt * 2);
        v.sync(dt);
      }
    }
    this.collisions();

    // 遠くの車は消す
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      if (v.driver === 'player') continue;
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if (d > (v.persistent ? 220 : 170)) {
        v.dispose();
        this.list.splice(i, 1);
        for (const [k, sv] of this.spotVehicles) if (sv === v) this.spotVehicles.set(k, null);
      }
    }
  }

  private spawnTraffic() {
    const g = this.game;
    const p = g.player.pos;
    for (let tries = 0; tries < 20; tries++) {
      const lane = rand.pick(this.lanes);
      const t = rand.range(0, lane.len);
      const x = lane.sx + lane.fx * t;
      const z = lane.sz + lane.fz * t;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < 45 || d > 150) continue;
      if (this.list.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < 10)) continue;
      const kind = rand.weighted(TRAFFIC_KINDS);
      const v = new Vehicle(g, kind, x, lane.y, z, Math.atan2(lane.fx, lane.fz));
      v.driver = 'npc';
      v.ai = { lane, t, turn: null };
      v.speed = lane.cruise * 0.8;
      this.list.push(v);
      return;
    }
  }

  private stepAI(v: Vehicle, dt: number) {
    const g = this.game;
    const ai = v.ai!;
    const lane = ai.lane;
    v.brakeT -= dt;
    v.honkCd -= dt;
    // 前方の障害物
    let target = ai.turn ? 5.5 : lane.cruise;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const check = (x: number, z: number, near: number, stopDist: number) => {
      const dx = x - v.pos.x;
      const dz = z - v.pos.z;
      const along = dx * fx + dz * fz;
      const lat = Math.abs(dx * fz - dz * fx);
      if (along > 0 && along < near && lat < 1.7) return Math.max(0, (along - stopDist) * 1.6);
      return Infinity;
    };
    for (const o of this.list) if (o !== v) target = Math.min(target, check(o.pos.x, o.pos.z, 13, 6.5));
    for (const n of g.npcs.list) if (n.alive) target = Math.min(target, check(n.pos.x, n.pos.z, 9, 3));
    if (!g.player.driving && !v.distracted) {
      const t2 = check(g.player.pos.x, g.player.pos.z, 10, 3);
      if (t2 < target) {
        target = t2;
        if (v.honkCd < 0 && t2 < 3) {
          v.honkCd = 3;
          g.audio.play('horn', v.pos, 0.7);
          g.hud.popText(v.pos.clone().setY(v.pos.y + 2.2), rand.pick(['プップー!', 'あぶないっ!', 'こら犬!']), '#ffffff', 20);
        }
      }
    }
    if (v.brakeT > 0) target = 0;
    v.speed += clamp(target - v.speed, -14 * dt, 4 * dt);
    v.speed = Math.max(0, v.speed);

    const step = v.speed * dt;
    if (!ai.turn) {
      ai.t += step;
      if (ai.t >= lane.len) {
        const opts = (this.lanesFrom.get(lane.endKey) ?? []).filter((l) => l.segId !== lane.segId);
        const next = opts.length ? rand.pick(opts) : (this.lanesFrom.get(lane.endKey) ?? [lane])[0];
        const p0 = new THREE.Vector3(lane.ex, lane.y, lane.ez);
        const p2 = new THREE.Vector3(next.sx, next.y, next.sz);
        const straight = Math.abs(lane.fx * next.fx + lane.fz * next.fz) > 0.9;
        const proj = (p2.x - p0.x) * lane.fx + (p2.z - p0.z) * lane.fz;
        const p1 = straight ? p0.clone().lerp(p2, 0.5) : new THREE.Vector3(p0.x + lane.fx * proj, lane.y, p0.z + lane.fz * proj);
        ai.turn = { p0, p1, p2, len: Math.max(2, p0.distanceTo(p1) + p1.distanceTo(p2)), u: 0, next };
      } else {
        v.place(lane.sx + lane.fx * ai.t, lane.y, lane.sz + lane.fz * ai.t, Math.atan2(lane.fx, lane.fz));
      }
    }
    if (ai.turn) {
      const tr = ai.turn;
      tr.u = Math.min(1, tr.u + step / tr.len);
      const u = tr.u;
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const c = u * u;
      const x = a * tr.p0.x + b * tr.p1.x + c * tr.p2.x;
      const z = a * tr.p0.z + b * tr.p1.z + c * tr.p2.z;
      const dx = 2 * (1 - u) * (tr.p1.x - tr.p0.x) + 2 * u * (tr.p2.x - tr.p1.x);
      const dz = 2 * (1 - u) * (tr.p1.z - tr.p0.z) + 2 * u * (tr.p2.z - tr.p1.z);
      v.place(x, tr.p0.y, z, Math.atan2(dx, dz));
      if (tr.u >= 1) {
        ai.lane = tr.next;
        ai.t = 0;
        ai.turn = null;
      }
    }
    v.steer = 0;
    v.sync(dt);
  }

  /** 車と人・うしわかのぶつかり */
  private collisions() {
    const g = this.game;
    const pv = g.player.driving;
    for (const v of this.list) {
      const sp = Math.abs(v.speed);
      if (sp < 3) continue;
      // 人をはねる
      for (const n of g.npcs.list) {
        if (!n.alive || !v.contains(n.pos, n.radius + 0.1)) continue;
        const dir = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw)).multiplyScalar(Math.sign(v.speed));
        if (v === pv) {
          if (sp > 9) {
            n.fling(dir.multiplyScalar(sp * 0.7).add(new THREE.Vector3(rand.range(-2, 2), 5 + sp * 0.25, rand.range(-2, 2))));
            g.karma.crime('kill', n.pos, n.kind, 1, 'car');
            g.hud.popText(n.headPos(), rand.pick(['ドーン!', 'バーン!', 'ドカッ!']), '#ffd166', 34);
          } else if (n.conscious) {
            n.faint();
            g.karma.crime('faint', n.pos, '1人');
          }
          g.audio.play('kick', n.pos, 1);
          g.camRig.addShake(0.35);
          g.npcs.panicAround(n.pos, 20, n);
        } else if (n.conscious && n.state !== 'faint') {
          n.faint();
          v.brakeT = 2;
        }
      }
      // うしわかがはねられる
      if (v !== pv && !g.player.driving && !g.player.dead && v.contains(g.player.pos, 0.25)) {
        g.player.hurt(14 + sp * 2.5, v.pos);
        g.player.vel.add(new THREE.Vector3(Math.sin(v.yaw), 0.6, Math.cos(v.yaw)).multiplyScalar(sp * 0.6));
        v.brakeT = 2.5;
        g.audio.play('horn', v.pos, 0.8);
        g.hud.popText(g.player.headWorld(), 'キャイーン!', '#ffffff', 30);
      }
      // プレイヤーの車が他の車にぶつかる
      if (v === pv) {
        for (const o of this.list) {
          if (o === v || !o.ai) continue;
          if (Math.hypot(o.pos.x - v.pos.x, o.pos.z - v.pos.z) < v.spec.halfL + o.spec.halfL + 0.3 && o.brakeT < 0) {
            o.brakeT = 3;
            o.speed = 0;
            if (o.honkCd < 0) {
              o.honkCd = 2;
              g.audio.play('horn', o.pos, 0.9);
            }
          }
        }
      }
    }
  }

  /** 近くの乗れる乗り物 */
  nearest(pos: THREE.Vector3, maxDist: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = maxDist;
    for (const v of this.list) {
      if (v.driver === 'player' || Math.abs(v.speed) > 4 || v.wrecked) continue;
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) - Math.max(v.spec.halfW, 0.6);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  /** うしわかが乗り込む。運転手がいたら追い出す */
  board(v: Vehicle) {
    const g = this.game;
    if (v.driver === 'npc') {
      const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw)).multiplyScalar(-(v.spec.halfW + 0.8));
      const kind = rand.pick(['man', 'woman', 'office', 'elderly'] as const);
      const n = new NPC(g, kind, createHuman(g.assets, makeLook(kind, rand), kind), v.pos.x + side.x, v.pos.y, v.pos.z + side.z);
      g.npcs.list.push(n);
      n.scare(v.pos, 0.3);
      g.hud.popText(n.headPos(), rand.pick(['ちょっと!? 私の車!', '犬が運転してる!?', 'うそでしょ!?']), '#ffffff', 22);
      g.karma.crime('steal', v.pos, '車');
    } else if (v.persistent) {
      g.karma.crime('steal', v.pos, v.kind === 'scooter' ? 'スクーター' : '車');
    }
    v.ai = null;
    v.driver = 'player';
    v.speed = 0;
    g.audio.engineOn();
  }

  unboard(v: Vehicle) {
    v.driver = 'none';
    v.speed = 0;
    this.game.audio.engineOff();
  }
}
