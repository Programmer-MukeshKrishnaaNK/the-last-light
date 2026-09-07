import * as THREE from 'three';
import { glowTexture } from './textures';
import { MAT } from './props';
import { damp, lerp, std } from './util';

/** The lantern: a mesh, a warm light, a glow and the dust that swims in it. */
export class Lantern {
  group = new THREE.Group();
  light: THREE.PointLight;
  glow: THREE.Sprite;
  private flameMat: THREE.MeshStandardMaterial;
  private glassMat: THREE.MeshStandardMaterial;
  private motes: THREE.Points;
  private moteBase: Float32Array;
  on = false;
  held = false;
  private level = 0;
  private t = 0;

  constructor() {
    const metal = MAT.metal(0x6b5c3f);
    const g = this.group;

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.06, 10), metal);
    g.add(base);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, 10), metal);
    top.position.y = 0.42; g.add(top);
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 5, 10), metal).translateY(0.52).rotateY(Math.PI / 2));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 5), metal).translateY(0.47));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.36, 0.022), metal)
        .translateX(Math.sin(a) * 0.125).translateY(0.21).translateZ(Math.cos(a) * 0.125));
    }

    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0x8a7a5c, transparent: true, opacity: 0.18, roughness: 0.08, metalness: 0.2,
      emissive: new THREE.Color(0xffb162), emissiveIntensity: 0,
    });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.135, 0.34, 10, 1, true), this.glassMat);
    glass.position.y = 0.21; glass.material.side = THREE.DoubleSide;
    g.add(glass);

    this.flameMat = new THREE.MeshStandardMaterial({
      color: 0x1a1208, emissive: new THREE.Color(0xffc275), emissiveIntensity: 0, roughness: 0.4,
    });
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 7), this.flameMat);
    flame.scale.y = 1.7; flame.position.y = 0.2;
    g.add(flame);

    this.light = new THREE.PointLight(0xffb162, 0, 17, 2.0);
    this.light.position.y = 0.21;
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.15;
    this.light.shadow.camera.far = 13;
    this.light.shadow.bias = -0.004;
    g.add(this.light);

    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffb162, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.glow.scale.set(3.2, 3.2, 1);
    this.glow.position.y = 0.21;
    g.add(this.glow);

    // dust motes that drift through the lantern light
    const n = 90;
    const pos = new Float32Array(n * 3);
    this.moteBase = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(Math.random() * 2.4 + 0.3);
      v.y = Math.abs(v.y) * 0.8 - 0.2;
      pos.set([v.x, v.y, v.z], i * 3);
      this.moteBase.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTexture(), color: 0xffd7a0, size: 0.09, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.motes.frustumCulled = false;
    g.add(this.motes);

    // ground-standing pose before pickup
    g.rotation.z = 0.12;
  }

  /** A duplicate for the pedestal at the top of the lighthouse. */
  static decorative() {
    const l = new Lantern();
    l.light.castShadow = false;
    l.light.intensity = 0;
    return l;
  }

  toggle() { if (this.held) this.on = !this.on; return this.on; }

  update(dt: number, t: number, boost = 1) {
    this.t += dt;
    const target = this.on ? 1 : 0;
    this.level = lerp(this.level, target, damp(dt, this.on ? 2.4 : 4.5));
    const flick = 0.88 + 0.12 * Math.sin(t * 9.1) * Math.sin(t * 3.3 + 1.7);
    const v = this.level * flick * boost;

    this.light.intensity = v * 13;
    this.light.distance = 15 + v * 5;
    this.flameMat.emissiveIntensity = v * 6;
    this.glassMat.emissiveIntensity = v * 1.1;
    this.glassMat.opacity = 0.16 + v * 0.22;
    (this.glow.material as THREE.SpriteMaterial).opacity = v * 0.62;
    this.glow.scale.setScalar(2.6 + v * 1.4 + Math.sin(t * 2.4) * 0.12);

    const pm = this.motes.material as THREE.PointsMaterial;
    pm.opacity = v * 0.5;
    if (v > 0.02) {
      const p = this.motes.geometry.attributes.position as THREE.BufferAttribute;
      const arr = p.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = this.moteBase[i] + Math.sin(this.t * 0.5 + i) * 0.28;
        arr[i + 1] = this.moteBase[i + 1] + ((this.t * 0.11 + i * 0.013) % 1.6) - 0.3;
        arr[i + 2] = this.moteBase[i + 2] + Math.cos(this.t * 0.42 + i * 1.3) * 0.28;
      }
      p.needsUpdate = true;
    }

    // gentle swing while carried
    if (this.held) {
      this.group.rotation.z = lerp(this.group.rotation.z, Math.sin(t * 2.1) * 0.06, damp(dt, 4));
      this.group.rotation.x = lerp(this.group.rotation.x, Math.sin(t * 1.6 + 1) * 0.05, damp(dt, 4));
    }
  }

  /** Small halo mesh used to draw the eye to the lantern before pickup. */
  static beacon() {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffc07a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    s.scale.set(3.6, 3.6, 1);
    return s;
  }
}

export function makePedestalLantern() {
  const g = new THREE.Group();
  const metal = MAT.metal(0x6b5c3f);
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.06, 10), metal));
  g.add(new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.12, 10), metal).translateY(0.44));
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.36, 10, 1, true), std(0x6a5f4a, 0.2, 0.3));
  glass.position.y = 0.22; (glass.material as THREE.Material).side = THREE.DoubleSide;
  (glass.material as THREE.MeshStandardMaterial).transparent = true;
  (glass.material as THREE.MeshStandardMaterial).opacity = 0.25;
  g.add(glass);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.38, 0.022), metal)
      .translateX(Math.sin(a) * 0.13).translateY(0.22).translateZ(Math.cos(a) * 0.13));
  }
  return g;
}
