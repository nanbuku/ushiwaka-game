import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 描いた物を、あとから消す（壊す）ための目印 */
export interface DrawHandle {
  kind: 'inst' | 'merged' | 'mesh';
  mesh?: THREE.Object3D;
  index?: number;
  start?: number;
  count?: number;
}

interface Group {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  cast: boolean;
  recv: boolean;
  chunks: Map<number, { mats: THREE.Matrix4[]; cols: (THREE.Color | null)[]; handles: DrawHandle[] }>;
}

const CHUNK = 200;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * 同じ形・同じマテリアルの大量の物体を InstancedMesh にまとめて描画負荷を下げる。
 * 視錐台カリングが効くよう、200m 四方のチャンクごとに分割する。
 * 追加するたびに DrawHandle を返し、あとで hide() で消せる（建物の破壊用）。
 */
export class Batcher {
  private groups = new Map<string, Group>();
  private merged = new Map<string, { mat: THREE.Material; cast: boolean; chunks: Map<number, { geos: THREE.BufferGeometry[]; handles: DrawHandle[] }> }>();
  /** 追加されるたびに呼ばれる（壊せる物の登録に使う） */
  onAdd?: (h: DrawHandle) => void;

  /** 形がバラバラなモデル（Kenney）は、同じマテリアルどうし1つのメッシュに結合して描く */
  addMerged(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, cast = true): DrawHandle {
    const sig = Object.keys(geo.attributes).sort().join(',') + (geo.index ? '|i' : '|n');
    const key = `${mat.uuid}|${sig}|${cast ? 1 : 0}`;
    let g = this.merged.get(key);
    if (!g) this.merged.set(key, (g = { mat, cast, chunks: new Map() }));
    const ci = Math.floor((m.elements[12] + 900) / CHUNK) * 1000 + Math.floor((m.elements[14] + 900) / CHUNK);
    let c = g.chunks.get(ci);
    if (!c) g.chunks.set(ci, (c = { geos: [], handles: [] }));
    const cl = geo.clone();
    cl.applyMatrix4(m);
    c.geos.push(cl);
    const h: DrawHandle = { kind: 'merged' };
    c.handles.push(h);
    this.onAdd?.(h);
    return h;
  }

  define(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, cast = true, recv = true) {
    this.groups.set(key, { geo, mat, cast, recv, chunks: new Map() });
  }

  has(key: string) {
    return this.groups.has(key);
  }

  add(key: string, m: THREE.Matrix4, color?: THREE.ColorRepresentation): DrawHandle {
    const g = this.groups.get(key);
    if (!g) throw new Error('Batcher: 未定義のキー ' + key);
    const x = m.elements[12];
    const z = m.elements[14];
    const ci = Math.floor((x + 900) / CHUNK) * 1000 + Math.floor((z + 900) / CHUNK);
    let c = g.chunks.get(ci);
    if (!c) g.chunks.set(ci, (c = { mats: [], cols: [], handles: [] }));
    c.mats.push(m.clone());
    c.cols.push(color !== undefined ? new THREE.Color(color) : null);
    const h: DrawHandle = { kind: 'inst' };
    c.handles.push(h);
    this.onAdd?.(h);
    return h;
  }

  build(parent: THREE.Object3D) {
    const white = new THREE.Color(1, 1, 1);
    let draws = 0;
    let instances = 0;
    for (const [key, g] of this.groups) {
      for (const c of g.chunks.values()) {
        if (!c.mats.length) continue;
        const im = new THREE.InstancedMesh(g.geo, g.mat, c.mats.length);
        const anyCol = c.cols.some((x) => x);
        for (let i = 0; i < c.mats.length; i++) {
          im.setMatrixAt(i, c.mats[i]);
          if (anyCol) im.setColorAt(i, c.cols[i] ?? white);
          c.handles[i].mesh = im;
          c.handles[i].index = i;
        }
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = g.cast;
        im.receiveShadow = g.recv;
        im.computeBoundingSphere();
        im.name = key;
        parent.add(im);
        draws++;
        instances += c.mats.length;
      }
      g.chunks.clear();
    }
    for (const g of this.merged.values()) {
      for (const c of g.chunks.values()) {
        const list = c.geos;
        const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
        if (!geo) {
          list.forEach((one, i) => {
            const mesh = new THREE.Mesh(one, g.mat);
            mesh.castShadow = g.cast;
            mesh.receiveShadow = true;
            parent.add(mesh);
            Object.assign(c.handles[i], { kind: 'mesh', mesh });
            draws++;
          });
          continue;
        }
        const mesh = new THREE.Mesh(geo, g.mat);
        let start = 0;
        list.forEach((one, i) => {
          const n = one.getAttribute('position').count;
          Object.assign(c.handles[i], { mesh, start, count: n });
          start += n;
        });
        if (geo !== list[0]) for (const one of list) one.dispose();
        geo.computeBoundingSphere();
        mesh.castShadow = g.cast;
        mesh.receiveShadow = true;
        parent.add(mesh);
        draws++;
        instances += list.length;
      }
      g.chunks.clear();
    }
    return { draws, instances };
  }

  /** 描いた物を消す（壊れた建物など） */
  static hide(h: DrawHandle) {
    if (!h.mesh) return;
    if (h.kind === 'inst') {
      const im = h.mesh as THREE.InstancedMesh;
      im.setMatrixAt(h.index!, ZERO);
      im.instanceMatrix.needsUpdate = true;
    } else if (h.kind === 'merged') {
      const pos = (h.mesh as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute;
      const s = h.start!;
      const x = pos.getX(s);
      const z = pos.getZ(s);
      for (let i = s; i < s + h.count!; i++) pos.setXYZ(i, x, -60, z);
      pos.needsUpdate = true;
    } else h.mesh.visible = false;
  }
}
