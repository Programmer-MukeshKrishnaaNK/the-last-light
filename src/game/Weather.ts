import * as THREE from 'three';
import { glowTexture, rainTexture } from './textures';
import { damp, lerp } from './util';

/** Rain box that follows the player, plus drifting fog motes and distant lightning. */
export class Weather {
  group = new THREE.Group();
  private rain: THREE.Points;
  private rainVel: Float32Array;
  private motes: THREE.Points;
  private lightning: THREE.DirectionalLight;
  private nextStrike = 14;
  private strike = 0;
  private splash: THREE.Points;
  private splashLife: Float32Array;
  intensity = 1;
  private target = 1;
  private readonly area = 46;
  private readonly top = 26;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);

    const n = 3600;
    const pos = new Float32Array(n * 3);
    this.rainVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.area * 2;
      pos[i * 3 + 1] = Math.random() * this.top;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.area * 2;
      this.rainVel[i] = 22 + Math.random() * 16;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({
      map: rainTexture(), color: 0xa9c4e0, size: 0.5, transparent: true, opacity: 0.4,
      depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    }));
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    // splash pops where drops land
    const sn = 260;
    const spos = new Float32Array(sn * 3);
    this.splashLife = new Float32Array(sn);
    for (let i = 0; i < sn; i++) this.splashLife[i] = Math.random();
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
    this.splash = new THREE.Points(sgeo, new THREE.PointsMaterial({
      map: glowTexture(), color: 0x9fbcd8, size: 0.16, transparent: true, opacity: 0.2,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.splash.frustumCulled = false;
    this.group.add(this.splash);

    // slow fog motes for depth
    const mn = 420;
    const mpos = new Float32Array(mn * 3);
    for (let i = 0; i < mn; i++) {
      mpos[i * 3] = (Math.random() - 0.5) * 90;
      mpos[i * 3 + 1] = Math.random() * 9;
      mpos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
    this.motes = new THREE.Points(mgeo, new THREE.PointsMaterial({
      map: rainTexture(), color: 0x9fb8d0, size: 0.5, transparent: true, opacity: 0.09,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    this.lightning = new THREE.DirectionalLight(0xcfe0ff, 0);
    this.lightning.position.set(-80, 60, -160);
    scene.add(this.lightning);
  }

  setIntensity(v: number) { this.target = v; }

  update(dt: number, t: number, focus: THREE.Vector3, onThunder?: () => void) {
    this.intensity = lerp(this.intensity, this.target, damp(dt, 0.7));
    const rm = this.rain.material as THREE.PointsMaterial;
    rm.opacity = 0.4 * this.intensity;
    (this.splash.material as THREE.PointsMaterial).opacity = 0.2 * this.intensity;
    (this.motes.material as THREE.PointsMaterial).opacity = 0.09 * Math.max(0.25, this.intensity);
    this.rain.visible = this.intensity > 0.02;
    this.splash.visible = this.intensity > 0.02;

    this.group.position.set(focus.x, 0, focus.z);

    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      const a = p.array as Float32Array;
      const wind = Math.sin(t * 0.3) * 2.2 + 1.4;
      for (let i = 0; i < this.rainVel.length; i++) {
        const j = i * 3;
        a[j + 1] -= this.rainVel[i] * dt;
        a[j] += wind * dt;
        if (a[j + 1] < -2) {
          a[j + 1] = this.top;
          a[j] = (Math.random() - 0.5) * this.area * 2;
          a[j + 2] = (Math.random() - 0.5) * this.area * 2;
        }
        if (a[j] > this.area) a[j] -= this.area * 2;
      }
      p.needsUpdate = true;

      const sp = this.splash.geometry.attributes.position as THREE.BufferAttribute;
      const sa = sp.array as Float32Array;
      for (let i = 0; i < this.splashLife.length; i++) {
        this.splashLife[i] -= dt * 2.6;
        const j = i * 3;
        if (this.splashLife[i] <= 0) {
          this.splashLife[i] = 0.3 + Math.random() * 0.4;
          sa[j] = (Math.random() - 0.5) * 26;
          sa[j + 1] = 0.05;
          sa[j + 2] = (Math.random() - 0.5) * 26;
        } else {
          sa[j + 1] += dt * 1.1;
        }
      }
      sp.needsUpdate = true;
    }

    const mp = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const ma = mp.array as Float32Array;
    for (let i = 0; i < ma.length; i += 3) {
      ma[i] += Math.sin(t * 0.2 + i) * dt * 0.35;
      ma[i + 1] += dt * 0.12;
      if (ma[i + 1] > 9) ma[i + 1] = 0;
    }
    mp.needsUpdate = true;

    // distant lightning
    this.nextStrike -= dt * this.intensity;
    if (this.nextStrike <= 0) {
      this.nextStrike = 18 + Math.random() * 26;
      this.strike = 1;
      onThunder?.();
    }
    if (this.strike > 0) {
      this.strike -= dt * 3.2;
      const f = Math.max(0, this.strike);
      this.lightning.intensity = (Math.random() > 0.5 ? f * f * 2.6 : f * 0.4) * this.intensity;
    } else {
      this.lightning.intensity = 0;
    }
  }
}
