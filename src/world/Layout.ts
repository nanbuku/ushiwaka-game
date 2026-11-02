/**
 * 街全体のレイアウト定義。
 * 600m x 600m のマップを 200m 四方の 9 地区に分け、100m 間隔の碁盤目に道路を通す。
 *
 *          x: -300 ──── -100 ──── 100 ──── 300
 *  z:-300  ┌ 山あいの田舎 ┬ みどり公園 ┬ わくわくランド ┐
 *          │ countryHill │ park      │ amusement     │
 *  z:-100  ├ 田園地帯     ┼ ひだまり町 ┼ オフィス街     ┤
 *          │ countryField│ town      │ city          │
 *  z: 100  ├ 河川敷・工場 ┼ 学校・病院 ┼ 繁華街        ┤
 *          │ riverside   │ civic     │ downtown      │
 *  z: 300  └─────────────┴───────────┴───────────────┘
 */
export const LINES = [-300, -200, -100, 0, 100, 200, 300];
export const HALF = 300;

export type District =
  | 'countryHill'
  | 'park'
  | 'amusement'
  | 'countryField'
  | 'town'
  | 'city'
  | 'riverside'
  | 'civic'
  | 'downtown';

export const DISTRICT_GRID: District[][] = [
  ['countryHill', 'park', 'amusement'],
  ['countryField', 'town', 'city'],
  ['riverside', 'civic', 'downtown'],
];

export const DISTRICT_LABEL: Record<District, string> = {
  countryHill: '山あいの集落',
  park: 'みどり公園',
  amusement: 'わくわくランド',
  countryField: '田園地帯',
  town: 'ひだまり町',
  city: 'オフィス街',
  riverside: '河川敷・工場',
  civic: '学校・病院・保健所',
  downtown: '繁華街',
};

export function districtAt(x: number, z: number): District {
  const c = Math.max(0, Math.min(2, Math.floor((x + HALF) / 200)));
  const r = Math.max(0, Math.min(2, Math.floor((z + HALF) / 200)));
  return DISTRICT_GRID[r][c];
}

export type RoadKind = 'avenue' | 'street' | 'rural' | 'none';
/** hw = 車道の半幅, sw = 歩道幅 */
export const ROAD: Record<RoadKind, { hw: number; sw: number }> = {
  avenue: { hw: 7, sw: 4 },
  street: { hw: 4.5, sw: 3 },
  rural: { hw: 3, sw: 0 },
  none: { hw: 0, sw: 0 },
};

const RURAL = new Set<District>(['countryHill', 'countryField']);
const OPEN = new Set<District>(['park', 'amusement']);
export const isRural = (d: District) => RURAL.has(d);
export const isOpen = (d: District) => OPEN.has(d);

const inside = (x: number, z: number) => Math.abs(x) < HALF && Math.abs(z) < HALF;

/**
 * 道路セグメントの種類。
 * axis 'h' = x方向に走る道路（z=line）、'v' = z方向に走る道路（x=line）。a = セグメント始点（100m区間）。
 */
export function roadKind(axis: 'h' | 'v', line: number, a: number): RoadKind {
  const mid = a + 50;
  const p1: [number, number] = axis === 'h' ? [mid, line - 1] : [line - 1, mid];
  const p2: [number, number] = axis === 'h' ? [mid, line + 1] : [line + 1, mid];
  const in1 = inside(p1[0], p1[1]);
  const in2 = inside(p2[0], p2[1]);
  if (!in1 && !in2) return 'none';
  if (!in1 || !in2) {
    const d = in1 ? districtAt(p1[0], p1[1]) : districtAt(p2[0], p2[1]);
    return RURAL.has(d) ? 'rural' : 'street';
  }
  const d1 = districtAt(p1[0], p1[1]);
  const d2 = districtAt(p2[0], p2[1]);
  if (d1 === d2) {
    if (OPEN.has(d1)) return 'none';
    if (RURAL.has(d1)) return 'rural';
    return 'street';
  }
  if (RURAL.has(d1) && RURAL.has(d2)) return 'rural';
  return 'avenue';
}

export interface RoadSeg {
  axis: 'h' | 'v';
  line: number;
  a: number;
  b: number;
  kind: RoadKind;
}

export function computeRoads(): RoadSeg[] {
  const out: RoadSeg[] = [];
  for (const axis of ['h', 'v'] as const) {
    for (const line of LINES) {
      for (let i = 0; i < LINES.length - 1; i++) {
        const a = LINES[i];
        const kind = roadKind(axis, line, a);
        if (kind !== 'none') out.push({ axis, line, a, b: a + 100, kind });
      }
    }
  }
  return out;
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Lot extends Rect {
  id: number;
  district: District;
  /** 道路中心線で区切られたセル */
  cx0: number;
  cx1: number;
  cz0: number;
  cz1: number;
  /** 各辺の歩道幅 */
  sw: { n: number; s: number; w: number; e: number };
  kinds: { n: RoadKind; s: RoadKind; w: RoadKind; e: RoadKind };
  raised: boolean;
  /** 地面の高さ（歩道付きの区画は 0.15） */
  y: number;
}

/** 区画（道路に囲まれた土地）を計算。公園と遊園地は 200m 四方の1区画にまとめる */
export function computeLots(): Lot[] {
  const lots: Lot[] = [];
  for (let bz = 0; bz < 6; bz++) {
    for (let bx = 0; bx < 6; bx++) {
      const cx0 = LINES[bx];
      const cz0 = LINES[bz];
      const d = districtAt(cx0 + 50, cz0 + 50);
      let cx1 = cx0 + 100;
      let cz1 = cz0 + 100;
      if (OPEN.has(d)) {
        if (bx % 2 !== 0 || bz % 2 !== 0) continue;
        cx1 = cx0 + 200;
        cz1 = cz0 + 200;
      }
      const kn = roadKind('h', cz0, cx0);
      const ks = roadKind('h', cz1, cx0);
      const kw = roadKind('v', cx0, cz0);
      const ke = roadKind('v', cx1, cz0);
      const sw = { n: ROAD[kn].sw, s: ROAD[ks].sw, w: ROAD[kw].sw, e: ROAD[ke].sw };
      const raised = sw.n + sw.s + sw.w + sw.e > 0;
      lots.push({
        id: lots.length,
        district: d,
        cx0,
        cx1,
        cz0,
        cz1,
        x0: cx0 + ROAD[kw].hw,
        x1: cx1 - ROAD[ke].hw,
        z0: cz0 + ROAD[kn].hw,
        z1: cz1 - ROAD[ks].hw,
        sw,
        kinds: { n: kn, s: ks, w: kw, e: ke },
        raised,
        y: raised ? 0.15 : 0,
      });
    }
  }
  return lots;
}

/** 歩道を除いた、建物を置ける範囲 */
export function usable(lot: Lot): Rect {
  return { x0: lot.x0 + lot.sw.w, x1: lot.x1 - lot.sw.e, z0: lot.z0 + lot.sw.n, z1: lot.z1 - lot.sw.s };
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0) {
  return a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.z0 - pad < b.z1 && a.z1 + pad > b.z0;
}

export function inRect(r: Rect, x: number, z: number, pad = 0) {
  return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
}
