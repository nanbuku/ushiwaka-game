import * as THREE from 'three';

/** 夜の度合い（0=昼, 1=夜）。窓や街灯のマテリアルで共有する */
export const nightUniform = { value: 0 };

function makePrism() {
  // 切妻屋根: 底面 x[-.5,.5] z[-.5,.5] y=0、棟は x 方向（y=1, z=0）
  const p = [
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0,
    -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** 単位ジオメトリ（底面が y=0） */
export const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0),
  cone: new THREE.ConeGeometry(0.5, 1, 8).translate(0, 0.5, 0),
  crown: new THREE.IcosahedronGeometry(0.5, 1).translate(0, 0.5, 0),
  sphere: new THREE.SphereGeometry(0.5, 14, 10).translate(0, 0.5, 0),
  flat: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(0.5, 28).rotateX(-Math.PI / 2),
  roof: makePrism(),
};

type FacadeKind = 'office' | 'house' | 'shop';

/** 窓をシェーダーで描く建物用マテリアル（ワールド座標基準なのでどんな大きさでも窓の間隔が揃う） */
function facade(kind: FacadeKind) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.0 });
  const cfg = {
    office: { W: '2.6', H: '3.4', X0: '0.12', X1: '0.88', Y0: '0.22', Y1: '0.86', START: '0.4' },
    house: { W: '3.3', H: '2.8', X0: '0.32', X1: '0.68', Y0: '0.36', Y1: '0.74', START: '0.3' },
    shop: { W: '2.8', H: '3.2', X0: '0.25', X1: '0.75', Y0: '0.35', Y1: '0.78', START: '3.2' },
  }[kind];
  m.defines = {
    WIN_W: cfg.W,
    WIN_H: cfg.H,
    WIN_X0: cfg.X0,
    WIN_X1: cfg.X1,
    WIN_Y0: cfg.Y0,
    WIN_Y1: cfg.Y1,
    WIN_START: cfg.START,
    ...(kind === 'shop' ? { SHOP_FRONT: '' } : {}),
  };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFWorld;\nvarying vec3 vFNormal;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 fw = vec4(transformed, 1.0);
        vec3 fn = objectNormal;
        #ifdef USE_INSTANCING
          fw = instanceMatrix * fw;
          fn = mat3(instanceMatrix) * fn;
        #endif
        fw = modelMatrix * fw;
        vFWorld = fw.xyz;
        vFNormal = normalize(mat3(modelMatrix) * fn);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        varying vec3 vFWorld;
        varying vec3 vFNormal;
        float fhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float isWin = 0.0;
        vec2 wcell = vec2(0.0);
        float wallSide = step(abs(vFNormal.y), 0.5);
        if (wallSide > 0.5) {
          float u = abs(vFNormal.x) > 0.5 ? vFWorld.z : vFWorld.x;
          float v = vFWorld.y;
          vec2 g = vec2(u / WIN_W, (v - WIN_START) / WIN_H);
          wcell = floor(g) + floor(vFWorld.xz / 9.0) * 17.0;
          vec2 f = fract(g);
          isWin = step(WIN_X0, f.x) * step(f.x, WIN_X1) * step(WIN_Y0, f.y) * step(f.y, WIN_Y1) * step(WIN_START, v);
          #ifdef SHOP_FRONT
            float front = step(0.35, v) * step(v, 2.7) * step(0.06, fract(u / 4.0)) * step(fract(u / 4.0), 0.94);
            isWin = max(isWin, front);
            wcell += front * 3.0;
          #endif
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.4, 0.5), isWin);
        } else {
          diffuseColor.rgb *= 0.78;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, isWin);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float lit = step(0.6, fhash(wcell));
        totalEmissiveRadiance += vec3(1.0, 0.76, 0.42) * isWin * lit * uNight * 0.75;`,
      );
  };
  m.customProgramCacheKey = () => 'facade-' + kind;
  return m;
}

const NOISE_GLSL = `
  float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), u.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int k = 0; k < 4; k++) { v += a * gn(p); p *= 2.03; a *= 0.5; } return v; }
`;

/**
 * 平らな色だけの地面はゲームっぽく見えるので、ワールド座標のノイズで
 * 汚れ・ムラ・目地を描く（テクスチャ画像なしで、どんな大きさでも模様の細かさが揃う）
 */
function surface(mat: THREE.MeshStandardMaterial, kind: 'ground' | 'road' | 'slab') {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSWorld;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 sw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          sw = instanceMatrix * sw;
        #endif
        vSWorld = (modelMatrix * sw).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSWorld;\n' + NOISE_GLSL)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 wp = vSWorld.xz;
        ${
          kind === 'road'
            ? `float grain = gh(floor(wp * 18.0));
               float patchy = fbm(wp * 0.12);
               float crack = 1.0 - smoothstep(0.0, 0.02, abs(gn(wp * 0.7) - 0.5)) * step(0.6, gn(wp * 0.21));
               diffuseColor.rgb *= (0.86 + grain * 0.1 + (patchy - 0.5) * 0.28) * mix(1.0, 0.72, 1.0 - crack);`
            : kind === 'slab'
              ? `vec2 t = fract(wp / 0.6);
                 float joint = step(t.x, 0.03) + step(t.y, 0.03);
                 float stain = fbm(wp * 0.3);
                 diffuseColor.rgb *= (0.93 + (stain - 0.5) * 0.18 + gh(floor(wp / 0.6)) * 0.05) * (1.0 - min(joint, 1.0) * 0.18);`
              : `float big = fbm(wp * 0.045);
                 float small = gn(wp * 2.3);
                 diffuseColor.rgb *= 0.84 + big * 0.26 + (small - 0.5) * 0.1;
                 if (diffuseColor.g > diffuseColor.r * 1.08) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.06, 0.72), smoothstep(0.52, 0.78, big) * 0.55);`
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'surface-' + kind;
  return mat;
}

const offsetMat = (factor: number, rough = 0.95) =>
  new THREE.MeshStandardMaterial({
    roughness: rough,
    polygonOffset: true,
    polygonOffsetFactor: factor,
    polygonOffsetUnits: factor,
  });

export const MAT = {
  plain: new THREE.MeshStandardMaterial({ roughness: 0.88 }),
  flatShade: new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
  ground: surface(offsetMat(-1), 'ground'),
  road: surface(offsetMat(-2), 'road'),
  slab: surface(new THREE.MeshStandardMaterial({ roughness: 0.9 }), 'slab'),
  mark: offsetMat(-4, 0.8),
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffd28a, emissiveIntensity: 0.0, roughness: 0.5 }),
  neon: new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xa8d4f0, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.32 }),
  water: new THREE.MeshStandardMaterial({ color: 0x4a90c8, roughness: 0.22, metalness: 0.0, transparent: true, opacity: 0.84 }),
  office: facade('office'),
  house: facade('house'),
  shop: facade('shop'),
};

/** 夜の明るさをマテリアルへ反映 */
export function applyNight(n: number) {
  nightUniform.value = n;
  MAT.lamp.emissiveIntensity = n * 3.0;
  MAT.neon.emissiveIntensity = 0.35 + n * 1.6;
}

// ---------- 看板（Canvasテクスチャ） ----------
const signCache = new Map<string, THREE.Texture>();
export function signTexture(text: string, bg: string, fg: string, w = 512, h = 128, font = 'bold') {
  const key = `${text}|${bg}|${fg}|${w}|${h}`;
  const cached = signCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  let size = Math.floor(h * 0.62);
  ctx.font = `${font} ${size}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif`;
  while (ctx.measureText(text).width > w * 0.9 && size > 10) {
    size -= 2;
    ctx.font = `${font} ${size}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  signCache.set(key, tex);
  return tex;
}

/** テクスチャ付きの看板メッシュ */
export function makeSign(text: string, w: number, h: number, bg = '#ffffff', fg = '#333333', glow = false) {
  const tex = signTexture(text, bg, fg, 512, Math.max(64, Math.round((512 * h) / w)));
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.6,
    emissive: glow ? 0xffffff : 0x000000,
    emissiveMap: glow ? tex : null,
    emissiveIntensity: glow ? 0.6 : 0,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  if (glow) glowSigns.push(mat);
  return mesh;
}
export const glowSigns: THREE.MeshStandardMaterial[] = [];
