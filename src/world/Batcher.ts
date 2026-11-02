import * as THREE from 'three';

interface Group {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  cast: boolean;
  recv: boolean;
  chunks: Map<number, { mats: THREE.Matrix4[]; cols: (THREE.Color | null)[] }>;
}

const CHUNK = 150;

/**
 * 同じ形・同じマテリアルの大量の物体を InstancedMesh にまとめて描画負荷を下げる。
 * 視錐台カリングが効くよう、150m 四方のチャンクごとに分割する。
 */
export class Batcher {
  private groups = new Map<string, Group>();

  define(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, cast = true, recv = true) {
    this.groups.set(key, { geo, mat, cast, recv, chunks: new Map() });
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
    return { draws, instances };
  }
}
