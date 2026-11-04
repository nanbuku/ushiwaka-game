import * as THREE from 'three';

export interface FurUniforms {
  uFurLen: { value: number };
  uShells: { value: number };
  uDensity: { value: number };
  uGravity: { value: THREE.Vector3 };
}

/**
 * シェル法によるもふもふの毛。
 * 同じジオメトリを InstancedMesh で何層も重ね、層ごとに法線方向へ押し出して
 * ハッシュノイズで毛の先を抜く。gl_InstanceID を層番号として使う。
 */
export function furMaterial(color: THREE.ColorRepresentation, furLen: number, shells: number, density: number) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.97, metalness: 0, emissive: color, emissiveIntensity: 0.1 });
  const uniforms: FurUniforms = {
    uFurLen: { value: furLen },
    uShells: { value: shells },
    uDensity: { value: density },
    uGravity: { value: new THREE.Vector3(0, -0.35, 0) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFurLen; uniform float uShells; uniform float uDensity; uniform vec3 uGravity;
        varying vec3 vFurPos; varying float vShell;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float shellF = float(gl_InstanceID) / uShells;
        vShell = shellF;
        vFurPos = position * uDensity;
        transformed += objectNormal * (shellF * uFurLen) + uGravity * (shellF * shellF * uFurLen);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFurPos; varying float vShell;
        float furHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vShell > 0.001) {
          vec3 cell = floor(vFurPos);
          vec3 lp = fract(vFurPos) - 0.5;
          float h = furHash(cell);
          float len = 0.55 + 0.45 * h;
          if (vShell > len) discard;
          float r = length(lp);
          if (r > (1.0 - vShell / len * 0.65) * 0.6 + 0.14) discard;
        }
        diffuseColor.rgb *= mix(0.74, 1.08, vShell);`,
      );
  };
  m.customProgramCacheKey = () => 'fur-shell';
  return { material: m, uniforms };
}

/** 影だけを落とす透明マテリアル */
export const shadowOnlyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
