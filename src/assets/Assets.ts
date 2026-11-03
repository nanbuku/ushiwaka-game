import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/** モデルを構成するメッシュ1つ分（バッチ描画用） */
export interface ModelPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  matrix: THREE.Matrix4;
  name: string;
}

export interface ModelData {
  key: string;
  parts: ModelPart[];
  box: THREE.Box3;
  size: THREE.Vector3;
  center: THREE.Vector3;
}

export interface CharacterBase {
  mesh: THREE.Group;
  height: number;
  clips: { idle?: THREE.AnimationClip; run?: THREE.AnimationClip; jump?: THREE.AnimationClip };
  skins: Map<string, HTMLImageElement>;
}

/** ゲームで使う Kenney モデルの一覧（public/models 以下） */
export const MODEL_KEYS = [
  ...'abcdefghijklmnopqrstu'.split('').map((c) => `suburban/building-type-${c}`),
  'suburban/planter',
  ...'abcdefghijklmn'.split('').map((c) => `commercial/building-${c}`),
  ...'abcde'.split('').map((c) => `commercial/building-skyscraper-${c}`),
  'roads/light-square',
  'roads/light-curved',
  'roads/traffic-light',
  'roads/dumpster',
  'roads/construction-cone',
  'cars/sedan',
  'cars/taxi',
  'cars/van',
  'cars/truck',
  'cars/suv',
  'cars/police',
  'cars/ambulance',
  'cars/delivery',
  'cars/garbage-truck',
  'nature/tree_default',
  'nature/tree_oak',
  'nature/tree_fat',
  'nature/tree_detailed',
  'nature/tree_pineTallA',
  'nature/tree_pineRoundC',
  'nature/plant_bushLarge',
  'nature/plant_bushDetailed',
  'nature/flower_redA',
  'nature/flower_purpleA',
  'nature/flower_yellowA',
  'nature/rock_largeA',
  'nature/rock_tallB',
  'nature/crops_wheatStageB',
  'nature/crops_cornStageC',
  'nature/fence_simple',
  'food/apple',
  'food/banana',
  'food/tomato',
  'food/fish',
  'food/loaf',
  'food/meat-raw',
  'food/rice-ball',
  'food/burger',
  'food/ice-cream',
  'food/dim-sum',
  'food/carrot',
  'furniture/bedSingle',
  'furniture/loungeSofa',
  'furniture/televisionModern',
  'furniture/cabinetTelevision',
  'furniture/kitchenFridge',
  'furniture/kitchenCabinet',
  'furniture/kitchenSink',
  'furniture/kitchenStove',
  'furniture/tableCoffee',
  'furniture/desk',
  'furniture/chairDesk',
  'furniture/laptop',
  'furniture/bookcaseOpen',
  'furniture/bear',
  'furniture/rugRound',
  'furniture/pottedPlant',
  'furniture/lampRoundFloor',
  'furniture/books',
  'furniture/plantSmall1',
];

const SKINS = ['humanMaleA', 'humanFemaleA', 'skaterMaleA', 'skaterFemaleA', 'criminalMaleA', 'cyborgFemaleA'];

/**
 * Kenney 素材の読み込みと管理。
 * 読み込めなかったモデルは get() が undefined を返すので、呼び出し側はコードで作った見た目に切り替える。
 */
export class Assets {
  models = new Map<string, ModelData>();
  character: CharacterBase | null = null;
  private matCache = new Map<string, THREE.Material>();
  private tintCache = new Map<string, THREE.Material>();
  private variantCache = new Map<string, THREE.Material>();

  /**
   * 色違いのマテリアル（住宅の屋根の色を変える）。
   * 住宅キットのカラーマップの緑のマスだけ色相を変えたテクスチャを作る。
   */
  variant(mat: THREE.Material, idx: number) {
    const sm = mat as THREE.MeshStandardMaterial;
    if (!idx || !sm.map || !sm.map.image) return mat;
    const k = `${mat.uuid}|${idx}`;
    let m = this.variantCache.get(k);
    if (m) return m;
    const img = sm.map.image as HTMLImageElement;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const W = img.width;
    const H = img.height;
    const d = ctx.getImageData(0, Math.round(H * 0.25), Math.round(W * 0.125), Math.round(H * 0.25));
    const target = [
      [0, 0, 0],
      [6, 0.62, 0.95],
      [212, 0.38, 0.9],
      [24, 0.42, 0.72],
      [220, 0.06, 0.62],
    ][idx];
    const col = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    for (let i = 0; i < d.data.length; i += 4) {
      col.setRGB(d.data[i] / 255, d.data[i + 1] / 255, d.data[i + 2] / 255);
      col.getHSL(hsl);
      col.setHSL(target[0] / 360, Math.min(1, hsl.s * target[1]), Math.min(1, hsl.l * target[2]));
      d.data[i] = col.r * 255;
      d.data[i + 1] = col.g * 255;
      d.data[i + 2] = col.b * 255;
    }
    ctx.putImageData(d, 0, Math.round(H * 0.25));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = sm.map.flipY;
    tex.anisotropy = 4;
    const nm = sm.clone();
    nm.map = tex;
    this.variantCache.set(k, nm);
    return nm;
  }

  get ready() {
    return this.models.size > 0;
  }

  get(key: string) {
    return this.models.get(key);
  }

  async load(onProgress?: (done: number, total: number) => void) {
    const loader = new GLTFLoader();
    const total = MODEL_KEYS.length + 1;
    let done = 0;
    const tick = () => onProgress?.(++done, total);
    const carMap = await this.loadCarTexture();
    const queue = [...MODEL_KEYS];
    const worker = async () => {
      while (queue.length) {
        const key = queue.shift()!;
        try {
          const g = await loader.loadAsync(`models/${key}.glb`);
          this.models.set(key, this.extract(key, g.scene, carMap));
        } catch (e) {
          console.warn('[assets] モデルを読み込めませんでした', key, e);
        }
        tick();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    try {
      this.character = await this.loadCharacter();
    } catch (e) {
      console.warn('[assets] キャラクターを読み込めませんでした', e);
    }
    tick();
    console.info(`[assets] models ${this.models.size}/${MODEL_KEYS.length}, character ${this.character ? 'ok' : 'none'}`);
  }

  /** 車のテクスチャの窓の部分を透明にする（運転中のうしわかが見えるように） */
  private async loadCarTexture(): Promise<THREE.Texture | null> {
    try {
      const img = await new THREE.ImageLoader().loadAsync('models/cars/Textures/colormap.png');
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      // 窓ガラスのマス（x 32〜63, y 384〜511）
      const sx = Math.round((32 / 512) * img.width);
      const sy = Math.round((384 / 512) * img.height);
      const w = Math.round((32 / 512) * img.width);
      const h = Math.round((128 / 512) * img.height);
      const d = ctx.getImageData(sx, sy, w, h);
      for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = 0;
      ctx.putImageData(d, sx, sy);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      return tex;
    } catch {
      return null;
    }
  }

  private extract(key: string, root: THREE.Object3D, carMap: THREE.Texture | null): ModelData {
    root.updateMatrixWorld(true);
    const kit = key.split('/')[0];
    const parts: ModelPart[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = this.shared(kit, m.material as THREE.MeshStandardMaterial, carMap);
      parts.push({ geo: m.geometry, mat, matrix: m.matrixWorld.clone(), name: m.name });
    });
    const box = new THREE.Box3().setFromObject(root);
    return { key, parts, box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
  }

  /** キットごとに同じ名前のマテリアルを共有する（描画を軽くする） */
  private shared(kit: string, mat: THREE.MeshStandardMaterial, carMap: THREE.Texture | null) {
    const k = `${kit}/${mat.name}`;
    let m = this.matCache.get(k);
    if (!m) {
      const sm = mat;
      sm.roughness = Math.max(sm.roughness ?? 1, 0.55);
      sm.metalness = Math.min(sm.metalness ?? 0, 0.2);
      if (kit === 'cars' && carMap && sm.map) {
        sm.map = carMap;
        sm.alphaTest = 0.5;
        sm.side = THREE.DoubleSide;
      }
      if (sm.map) sm.map.anisotropy = 4;
      // 自然キットの葉は青緑なので、芝生に合う緑に
      if (kit === 'nature' && sm.name === 'leafsGreen') sm.color.set('#5f9e45');
      if (kit === 'nature' && sm.name === 'leafsDark') sm.color.set('#3d7238');
      if (kit === 'nature' && sm.name === 'grass') sm.color.set('#6aa84f');
      this.matCache.set(k, sm);
      m = sm;
    }
    return m;
  }

  /** 色を変えたマテリアル（桜の葉など） */
  tinted(mat: THREE.Material, color: THREE.ColorRepresentation) {
    const k = `${mat.uuid}|${new THREE.Color(color).getHexString()}`;
    let m = this.tintCache.get(k);
    if (!m) {
      const c = (mat as THREE.MeshStandardMaterial).clone();
      c.color = new THREE.Color(color);
      this.tintCache.set(k, c);
      m = c;
    }
    return m;
  }

  /** 1体分の個別メッシュを作る（乗り物・アイテム・家具など） */
  instance(key: string, tint?: Record<string, THREE.ColorRepresentation>): THREE.Group | null {
    const md = this.models.get(key);
    if (!md) return null;
    const g = new THREE.Group();
    for (const p of md.parts) {
      const mat = tint && tint[p.mat.name] ? this.tinted(p.mat, tint[p.mat.name]) : p.mat;
      const mesh = new THREE.Mesh(p.geo, mat);
      mesh.applyMatrix4(p.matrix);
      mesh.name = p.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }

  // ---------- キャラクター ----------
  private async loadCharacter(): Promise<CharacterBase> {
    const fbx = new FBXLoader();
    const [mesh, idle, run, jump] = await Promise.all([
      fbx.loadAsync('models/characters/characterMedium.fbx'),
      fbx.loadAsync('models/characters/anims/idle.fbx'),
      fbx.loadAsync('models/characters/anims/run.fbx'),
      fbx.loadAsync('models/characters/anims/jump.fbx'),
    ]);
    const pick = (g: THREE.Group, re: RegExp) => g.animations.find((a) => re.test(a.name)) ?? g.animations[g.animations.length - 1];
    const skins = new Map<string, HTMLImageElement>();
    await Promise.all(
      SKINS.map(async (s) => {
        try {
          skins.set(s, await new THREE.ImageLoader().loadAsync(`models/characters/skins/${s}.png`));
        } catch {
          /* なくても動く */
        }
      }),
    );
    const box = new THREE.Box3().setFromObject(mesh);
    return {
      mesh,
      height: box.max.y - box.min.y,
      clips: { idle: pick(idle, /idle/i), run: pick(run, /run/i), jump: pick(jump, /jump/i) },
      skins,
    };
  }
}
