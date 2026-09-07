import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Tiny deterministic RNG so the town looks the same every playthrough. */
export class Rng {
  private s: number;
  constructor(seed = 1337) { this.s = seed >>> 0; }
  next(): number {
    this.s ^= this.s << 13; this.s >>>= 0;
    this.s ^= this.s >> 17;
    this.s ^= this.s << 5; this.s >>>= 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number) { return a + this.next() * (b - a); }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent damping factor. */
export const damp = (dt: number, rate: number) => 1 - Math.exp(-rate * dt);
export const smoothstep = (t: number) => t * t * (3 - 2 * t);

export function std(color: number, rough = 0.85, metal = 0.0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

export function emissive(color: number, intensity = 1) {
  return new THREE.MeshStandardMaterial({
    color: 0x120c06, emissive: new THREE.Color(color), emissiveIntensity: intensity,
    roughness: 0.5, metalness: 0,
  });
}

/** Axis-aligned collision volume in world space. */
export interface Box { minX: number; maxX: number; minZ: number; maxZ: number; top?: number }

export function boxFrom(cx: number, cz: number, w: number, d: number, top?: number): Box {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top };
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

/**
 * Bake a pile of static meshes down to one draw call. They must already be
 * positioned in the parent's space and share a material.
 */
export function mergeMeshes(meshes: THREE.Mesh[], material: THREE.Material, cast = false) {
  const geos = meshes.map((m) => {
    m.updateMatrix();
    return m.geometry.clone().applyMatrix4(m.matrix);
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged ?? geos[0], material);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}
