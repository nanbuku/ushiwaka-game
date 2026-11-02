import type { Rng } from '../core/Rng';
import type { District, Lot } from './Layout';

export interface NavNode {
  id: number;
  x: number;
  y: number;
  z: number;
  links: number[];
  corner: boolean;
  district: District;
  /** 歩道の幅（横ずれの許容量） */
  width: number;
}

/** 歩行者用の経路グラフ（区画の周りの歩道＋横断歩道） */
export class NavGraph {
  nodes: NavNode[] = [];

  add(x: number, y: number, z: number, corner: boolean, district: District, width: number) {
    const n: NavNode = { id: this.nodes.length, x, y, z, links: [], corner, district, width };
    this.nodes.push(n);
    return n;
  }

  link(a: NavNode, b: NavNode) {
    if (a === b || a.links.includes(b.id)) return;
    a.links.push(b.id);
    b.links.push(a.id);
  }

  buildFromLots(lots: Lot[]) {
    const corners: NavNode[] = [];
    for (const lot of lots) {
      let xL: number, xR: number, zN: number, zS: number, width: number;
      if (lot.raised) {
        xL = lot.x0 + Math.max(lot.sw.w, 1.5) / 2;
        xR = lot.x1 - Math.max(lot.sw.e, 1.5) / 2;
        zN = lot.z0 + Math.max(lot.sw.n, 1.5) / 2;
        zS = lot.z1 - Math.max(lot.sw.s, 1.5) / 2;
        width = Math.min(lot.sw.n || 3, lot.sw.w || 3);
      } else {
        xL = lot.x0 + 1;
        xR = lot.x1 - 1;
        zN = lot.z0 + 1;
        zS = lot.z1 - 1;
        width = 1.2;
      }
      const pts: [number, number][] = [
        [xL, zN],
        [xR, zN],
        [xR, zS],
        [xL, zS],
      ];
      const loop: NavNode[] = [];
      for (let i = 0; i < 4; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[(i + 1) % 4];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / 22));
        for (let k = 0; k < n; k++) {
          const t = k / n;
          const node = this.add(ax + (bx - ax) * t, lot.y, az + (bz - az) * t, k === 0, lot.district, width);
          loop.push(node);
          if (k === 0) corners.push(node);
        }
      }
      for (let i = 0; i < loop.length; i++) this.link(loop[i], loop[(i + 1) % loop.length]);
    }
    // 横断歩道: 道路をはさんで向かい合う角どうしをつなぐ
    for (let i = 0; i < corners.length; i++) {
      for (let j = i + 1; j < corners.length; j++) {
        const a = corners[i];
        const b = corners[j];
        const dx = Math.abs(a.x - b.x);
        const dz = Math.abs(a.z - b.z);
        if ((dx < 2.5 || dz < 2.5) && Math.hypot(dx, dz) < 21 && Math.hypot(dx, dz) > 3) this.link(a, b);
      }
    }
  }

  nearest(x: number, z: number): NavNode {
    let best = this.nodes[0];
    let bd = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** プレイヤーから minD〜maxD の距離にある経路上の地点をランダムに選ぶ */
  randomEdgeNear(px: number, pz: number, minD: number, maxD: number, rng: Rng): [NavNode, NavNode, number] | null {
    for (let tries = 0; tries < 40; tries++) {
      const a = this.nodes[Math.floor(rng.next() * this.nodes.length)];
      const da = Math.hypot(a.x - px, a.z - pz);
      if (da > maxD + 25 || da < minD - 25) continue;
      if (!a.links.length) continue;
      const b = this.nodes[rng.pick(a.links)];
      const t = rng.next();
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const d = Math.hypot(x - px, z - pz);
      if (d >= minD && d <= maxD) return [a, b, t];
    }
    return null;
  }
}
