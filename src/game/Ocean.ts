import * as THREE from 'three';

/** Big animated water plane. Waves are done in the vertex shader so it stays cheap. */
export function makeOcean() {
  const geo = new THREE.PlaneGeometry(900, 700, 120, 90);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0b1826, roughness: 0.14, metalness: 0.62,
  });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        float wav(vec2 p){
          return sin(p.x * 0.11 + uTime * 0.75) * 0.34
               + sin(p.y * 0.17 - uTime * 0.55) * 0.26
               + sin((p.x + p.y) * 0.061 + uTime * 0.33) * 0.42;
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y += wav(transformed.xz);
        `)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        {
          float e = 1.2;
          float hL = wav(position.xz + vec2(-e, 0.0));
          float hR = wav(position.xz + vec2( e, 0.0));
          float hD = wav(position.xz + vec2(0.0, -e));
          float hU = wav(position.xz + vec2(0.0,  e));
          objectNormal = normalize(vec3(hL - hR, 2.0 * e, hD - hU));
        }`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

/** Thin foam line where the water meets the sand. */
export function makeSurf() {
  const geo = new THREE.PlaneGeometry(240, 14, 60, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x9fc0d8, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}
