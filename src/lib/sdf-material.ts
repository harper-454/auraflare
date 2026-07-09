/**
 * Shared mesh material for the SDF pipeline — both polygonizer backends
 * (CPU marching-tets in sdf-compiler.ts, WGSL kernel in sdf-gpu.ts) route
 * through this factory so texturing and PBR upgrades apply uniformly.
 *
 * SDF marching-tets meshes have NO UV coordinates, so classic texture mapping
 * is impossible. Triplanar projection solves this in the shader: the albedo is
 * sampled three times along the world axes and blended by the surface normal,
 * which is exactly the standard technique for UV-less/procedural geometry.
 * The projection lives in MeshStandardMaterial via onBeforeCompile, so all of
 * three.js's PBR lighting (env maps, metalness/roughness) keeps working.
 *
 * Export caveat: glTF has no triplanar shader, so `.glb` export carries the
 * per-vertex part colors, not the projected texture. Baking the projection to
 * a UV atlas (xatlas-web) is the known follow-up for textured export.
 */
import * as THREE from 'three';
import { getTexturePack, type MaterialFamily } from './pbr-textures';

export interface SDFMaterialOpts {
  metalness?: number;
  roughness?: number;
}

/** Base material shared by the CPU and GPU polygonizers: per-vertex part colors + PBR knobs. */
export function makeSDFMaterial(opts: SDFMaterialOpts = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: opts.metalness ?? 0.15,
    roughness: opts.roughness ?? 0.55,
    side: THREE.DoubleSide,
    envMapIntensity: 1.1,
  });
}

export interface TriplanarOpts {
  /** World units per texture tile. Models fit in [-1.2, 1.2], so ~1.5 wraps once per side. */
  scale?: number;
  /** Normal-weight exponent — higher = crisper axis transitions, less smearing on slopes. */
  sharpness?: number;
  /** 0 = pure vertex part colors, 1 = fully textured. Texture is tinted by part color either way. */
  mix?: number;
  /** Optional roughness map, triplanar-sampled with the same projection (green channel). */
  roughnessTexture?: THREE.Texture;
}

/**
 * A MeshStandardMaterial whose albedo is triplanar-projected from `texture`.
 * The projected texel is modulated by the per-vertex part color so a textured
 * snowman still reads snow-white body / orange nose rather than uniform wrap.
 */
export function makeTriplanarMaterial(
  texture: THREE.Texture,
  base: SDFMaterialOpts = {},
  opts: TriplanarOpts = {},
): THREE.MeshStandardMaterial {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const roughTex = opts.roughnessTexture ?? null;
  if (roughTex) {
    roughTex.wrapS = THREE.RepeatWrapping;
    roughTex.wrapT = THREE.RepeatWrapping;
  }

  const mat = makeSDFMaterial(base);
  const uniforms: Record<string, { value: unknown }> = {
    uTriMap: { value: texture },
    uTriScale: { value: opts.scale ?? 1.5 },
    uTriSharp: { value: opts.sharpness ?? 4.0 },
    uTriMix: { value: opts.mix ?? 0.85 },
  };
  if (roughTex) uniforms.uTriRough = { value: roughTex };

  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;',
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vTriPos = (modelMatrix * vec4(position, 1.0)).xyz;',
          'vTriNrm = normalize(mat3(modelMatrix) * normal);',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uTriMap;
uniform float uTriScale;
uniform float uTriSharp;
uniform float uTriMix;
varying vec3 vTriPos;
varying vec3 vTriNrm;
vec3 triplanar(sampler2D map, vec3 p, vec3 n, float scale, float sharp) {
  vec3 w = pow(abs(n), vec3(sharp));
  w /= (w.x + w.y + w.z);
  vec3 sx = texture2D(map, p.zy / scale).rgb;
  vec3 sy = texture2D(map, p.xz / scale).rgb;
  vec3 sz = texture2D(map, p.xy / scale).rgb;
  return sx * w.x + sy * w.y + sz * w.z;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 tri = triplanar(uTriMap, vTriPos, vTriNrm, uTriScale, uTriSharp);
  // Tint the texture by the part color (kept partially lifted so dark parts
  // don't null the texture), then blend against the untextured base.
  vec3 tinted = tri * (0.35 + 0.65 * diffuseColor.rgb);
  diffuseColor.rgb = mix(diffuseColor.rgb, tinted, uTriMix);
}`,
      );
    if (roughTex) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uTriRough;')
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
{
  // Same projection as the albedo — material.roughness acts as the factor.
  roughnessFactor *= triplanar(uTriRough, vTriPos, vTriNrm, uTriScale, uTriSharp).g;
}`,
        );
    }
  };
  // three caches shader programs per-material-type; the injected chunks change
  // the program, so give it a distinct cache key or an untextured
  // MeshStandardMaterial elsewhere in the scene would reuse the wrong program.
  mat.customProgramCacheKey = () => (roughTex ? 'sdf-triplanar-v2-rough' : 'sdf-triplanar-v1');
  return mat;
}

/**
 * Dress every mesh in a group in a procedural PBR family (wood grain, brushed
 * metal, cloth weave, plastic, stone, dirt) — triplanar albedo + roughness,
 * tinted by the per-vertex part colors so painted parts keep their identity.
 */
export function applyFamilyToGroup(
  group: THREE.Group,
  family: MaterialFamily,
  base: SDFMaterialOpts = {},
): void {
  const pack = getTexturePack(family);
  const mat = makeTriplanarMaterial(pack.map, {
    metalness: base.metalness ?? pack.metalness,
    roughness: base.roughness ?? pack.roughness,
  }, {
    scale: pack.scale,
    mix: 0.9,
    roughnessTexture: pack.roughnessMap,
  });
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      (mesh.material as THREE.Material)?.dispose();
      mesh.material = mat;
    }
  });
}

/** Swap every mesh in a generated group onto one triplanar-textured material. */
export function applyTriplanarToGroup(
  group: THREE.Group,
  texture: THREE.Texture,
  base?: SDFMaterialOpts,
  opts?: TriplanarOpts,
): void {
  const mat = makeTriplanarMaterial(texture, base, opts);
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      (mesh.material as THREE.Material)?.dispose();
      mesh.material = mat;
    }
  });
}

/** Load an image URL (same-origin /api/media/… or an object URL) as a texture. */
export async function loadTexture(url: string): Promise<THREE.Texture> {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
