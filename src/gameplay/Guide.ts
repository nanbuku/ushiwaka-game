import * as THREE from 'three';
import type { Game } from '../core/Game';
import { DISTRICT_LABEL, type District } from '../world/Layout';

export interface Target {
  x: number;
  y: number;
  z: number;
  label: string;
}

const CENTER: Record<District, [number, number]> = {
  countryHill: [-200, -200],
  park: [0, -200],
  amusement: [200, -200],
  countryField: [-200, 0],
  town: [0, 0],
  city: [200, 0],
  riverside: [-200, 200],
  civic: [0, 200],
  downtown: [200, 200],
};

/**
 * おつかいの案内。対象が実際にある場所を調べて、
 * ミニマップ・地図・画面上の矢印・3D の目印で示す。
 */
export class Guide {
  targets: Target[] = [];
  /** 一番近い目的地 */
  best: (Target & { dist: number }) | null = null;
  note = '';
  private marker = new THREE.Group();
  private t = 0;
  private refresh = 0;

  constructor(private game: Game) {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffd23f', depthTest: false, transparent: true, opacity: 0.95 });
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), mat);
    diamond.scale.set(0.8, 1.3, 0.8);
    diamond.renderOrder = 999;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 30, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.y = 15;
    this.marker.add(diamond, beam);
    this.marker.visible = false;
    game.scene.add(this.marker);
  }

  /** 今のおつかいの目的地を探す */
  private compute(): Target[] {
    const g = this.game;
    const r = g.requests;
    const c = r.current;
    this.note = '';
    if (!c) return [];
    if (r.complete) return [{ x: g.nanku.pos.x, y: g.nanku.pos.y, z: g.nanku.pos.z, label: 'なんくに報告' }];
    const p = g.player.pos;
    const byDist = (list: Target[]) => list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, 4);
    // 届け物: 実際に落ちている（置いてある）物を探す
    if (!c.crime) {
      if (g.player.carrying && r.matches(g.player.carrying)) return [{ x: g.nanku.pos.x, y: g.nanku.pos.y, z: g.nanku.pos.z, label: 'なんくに届ける' }];
      const found: Target[] = [];
      for (const it of g.items.list) {
        if (it.state !== 'world' || !r.matches(it)) continue;
        const o = it.obj.position;
        const d = g.world.district(o.x, o.z);
        found.push({ x: o.x, y: o.y, z: o.z, label: `${it.def.name}（${DISTRICT_LABEL[d]}）` });
      }
      if (!found.length) this.note = c.item === 'wallet' ? '通行人を気絶させると落とすことがある' : 'しばらくすると、お店や花壇にまた並ぶよ';
      return byDist(found);
    }
    // 悪事: 起こす場所
    if (c.district) {
      const [x, z] = CENTER[c.district];
      return [{ x, y: 0, z, label: DISTRICT_LABEL[c.district] }];
    }
    if (c.victim === 'office') {
      const [x, z] = CENTER.city;
      return [{ x, y: 0, z, label: 'オフィス街（会社員が多い）' }];
    }
    if (c.victim === 'clerk') {
      return byDist(g.world.staticSpots.filter((s) => s.kind === 'clerk').map((s) => ({ x: s.x, y: s.y, z: s.z, label: '店員さん' })));
    }
    if (c.victim === 'catcher') {
      const live = g.npcs.list.filter((n) => n.kind === 'catcher' && n.alive).map((n) => ({ x: n.pos.x, y: n.pos.y, z: n.pos.z, label: '保健所の職員' }));
      if (live.length) return byDist(live);
      const pound = g.world.zones.find((z) => z.name === 'pound');
      this.note = '悪いことをして通報されると、保健所の職員がやってくる';
      if (pound) return [{ x: (pound.rect.x0 + pound.rect.x1) / 2, y: 0, z: (pound.rect.z0 + pound.rect.z1) / 2, label: '保健所' }];
      return [];
    }
    if (c.crime === 'shrine') {
      return byDist(
        g.items.list.filter((it) => it.state === 'world' && it.owner === 'shrine').map((it) => ({ x: it.obj.position.x, y: it.obj.position.y, z: it.obj.position.z, label: 'お供え物（神社）' })),
      );
    }
    this.note = 'どこでもいい（人が多いのは繁華街・オフィス街）';
    return [];
  }

  update(dt: number) {
    const g = this.game;
    this.t += dt;
    this.refresh -= dt;
    if (this.refresh < 0) {
      this.refresh = 0.5;
      this.targets = this.compute();
    }
    const p = g.player.pos;
    let best: (Target & { dist: number }) | null = null;
    for (const t of this.targets) {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (!best || d < best.dist) best = { ...t, dist: d };
    }
    this.best = best;
    this.marker.visible = !!best && best.dist > 2.5;
    if (best) {
      this.marker.position.set(best.x, best.y + 2.2 + Math.sin(this.t * 3) * 0.2, best.z);
      this.marker.children[0].rotation.y += dt * 2;
      // 遠いほど目印を大きく
      const s = Math.min(4, Math.max(1, best.dist / 25));
      this.marker.children[0].scale.set(0.8 * s, 1.3 * s, 0.8 * s);
    }
  }

  /** 画面上の矢印の角度（カメラの向きに対する、目的地の方向） */
  arrowAngle() {
    const g = this.game;
    if (!this.best) return 0;
    const p = g.player.pos;
    const dx = this.best.x - p.x;
    const dz = this.best.z - p.z;
    // カメラの前方向 (-sin yaw, -cos yaw) を上とする
    const yaw = g.camRig.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
  }
}

export { CENTER as DISTRICT_CENTER };
void THREE;
