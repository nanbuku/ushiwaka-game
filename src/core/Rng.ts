/** 再現可能な乱数（mulberry32） */
export class Rng {
  private s: number;
  constructor(seed = 12345) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number) {
    return this.next() < p;
  }
  /** 重み付き選択: {キー: 重み} */
  weighted<K extends string>(table: Partial<Record<K, number>>): K {
    let total = 0;
    for (const k in table) total += table[k] ?? 0;
    let r = this.next() * total;
    for (const k in table) {
      r -= table[k] ?? 0;
      if (r <= 0) return k;
    }
    return Object.keys(table)[0] as K;
  }
}

/** 実行時のランダム（演出用） */
export const rand = new Rng((Date.now() ^ 0x5bd1e995) >>> 0);

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 角度差を -PI..PI に */
export const angleDiff = (a: number, b: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
/** フレームレート非依存の指数補間係数 */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
