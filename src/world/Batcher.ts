import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Group {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  cast: boolean;
  recv: boolean;
  chunks: Map<number, { mats: THREE.Matrix4[]; cols: (THREE.Color | null)[] }>;
}

const CHUNK = 200;

/**
 * 同じ形・同じマテリアルの大量の物体を InstancedMesh にまとめて描画負荷を下げる。
 * 視錐台カリングが効くよう、150m 四方のチャンクごとに分割する。
 */
export class Batcher {
  private groups = new Map<string, Group>();
  private merged = new Map<string, { mat: THREE.Material; cast: boolean; chunks: Map<number, THREE.BufferGeometry[]> }>();

  /** 形がバラバラなモデル（Kenney）は、同じマテリアルどうし1つのメッシュに結合して描く */
  addMerged(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, cast = true) {
    const sig = Object.keys(geo.attributes).sort().join(',') + (geo.index ? '|i' : '|n');
    const key = `${mat.uuid}|${sig}|${cast ? 1 : 0}`;
    let g = this.merged.get(key);
    if (!g) this.merged.set(key, (g = { mat, cast, chunks: new Map() }));
    const ci = Math.floor((m.elements[12] + 600) / CHUNK) * 1000 + Math.floor((m.elements[14] + 600) / CHUNK);
    let list = g.chunks.get(ci);
    if (!list) g.chunks.set(ci, (list = []));
    const c = geo.clone();
    c.applyMatrix4(m);
    list.push(c);
  }

  define(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, cast = true, recv = true) {
    this.groups.set(key, { geo, mat, cast, recv, chunks: new Map() });
  }

  has(key: string) {
    return this.groups.has(key);
  }

  add(key: string, m: THREE.Matrix4, color?: THREE.ColorRepresentation) {
    const g = this.groups.get(key);
    if (!g) throw new Error('Batcher: 未定義のキー ' + key);
    const x = m.elements[12];
    const z = m.elements[14];
    const ci = Math.floor((x + 600) / CHUNK) * 1000 + Math.floor((z + 600) / CHUNK);
    let c = g.chunks.get(ci);
    if (!c) g.chunks.set(ci, (c = { mats: [], cols: [] }));
    c.mats.push(m.clone());
    c.cols.push(color !== undefined ? new THREE.Color(color) : null);
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
      for (const list of g.chunks.values()) {
        const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
        if (!geo) {
          for (const one of list) {
            const mesh = new THREE.Mesh(one, g.mat);
            mesh.castShadow = g.cast;
            mesh.receiveShadow = true;
            parent.add(mesh);
            draws++;
          }
          continue;
        }
        if (geo !== list[0]) for (const one of list) one.dispose();
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, g.mat);
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
}
