import * as THREE from 'three';
import { LampSpec } from './props';
import { moonTexture } from './textures';
import { damp, lerp } from './util';

/**
 * The town has far more lamps than a browser can afford as real lights, so
 * every lamp is drawn with emissive geometry + a glow sprite + a ground pool,
 * and only the handful nearest the player get an actual PointLight.
 */
export class LightPool {
  private lights: THREE.PointLight[] = [];
  constructor(scene: THREE.Scene, count = 6) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffc27a, 0, 18, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
  }

  update(lamps: LampSpec[], focus: THREE.Vector3, t: number, dt: number, boost = 1) {
    // animate glow/pool/bulb for every lamp (cheap, no light cost)
    for (const l of lamps) {
      const flick = 0.86 + 0.14 * Math.sin(t * 7.3 + l.flicker) * Math.sin(t * 2.1 + l.flicker * 3);
      const v = l.power * flick;
      if (l.bulb) l.bulb.emissiveIntensity = v * 3.4;
      if (l.glow) (l.glow.material as THREE.SpriteMaterial).opacity = Math.min(1, v * 0.55 * boost);
      if (l.pool) (l.pool.material as THREE.MeshBasicMaterial).opacity = Math.min(1, v * 0.34 * boost);
    }

    const active = lamps.filter((l) => l.power > 0.02);
    active.sort((a, b) => a.pos.distanceToSquared(focus) - b.pos.distanceToSquared(focus));
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i];
      const spec = active[i];
      if (!spec || spec.pos.distanceToSquared(focus) > 46 * 46) {
        L.intensity = lerp(L.intensity, 0, damp(dt, 6));
        continue;
      }
      L.position.copy(spec.pos);
      L.color.setHex(spec.color);
      L.distance = spec.distance;
      const flick = 0.85 + 0.15 * Math.sin(t * 7.3 + spec.flicker);
      L.intensity = lerp(L.intensity, spec.intensity * spec.power * flick, damp(dt, 8));
    }
  }
}

/** A tiny equirect gradient used as an IBL environment: gives wet surfaces
 *  something to reflect and lifts the whole scene out of pure black. */
function envTexture(mood: 'night' | 'dawn') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 128);
  if (mood === 'dawn') {
    g.addColorStop(0, '#8fb0d4'); g.addColorStop(0.5, '#dfe6ea'); g.addColorStop(0.62, '#e8c9a0'); g.addColorStop(1, '#6d6250');
  } else {
    g.addColorStop(0, '#16233c'); g.addColorStop(0.45, '#2b4468'); g.addColorStop(0.58, '#3c587d'); g.addColorStop(1, '#0a0e15');
  }
  x.fillStyle = g; x.fillRect(0, 0, 256, 128);
  if (mood === 'night') {
    const m = x.createRadialGradient(70, 48, 0, 70, 48, 24);
    m.addColorStop(0, 'rgba(200,220,255,0.95)');
    m.addColorStop(1, 'rgba(200,220,255,0)');
    x.fillStyle = m; x.fillRect(44, 22, 52, 52);
  }
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function applyEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, mood: 'night' | 'dawn') {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = envTexture(mood);
  const rt = pmrem.fromEquirectangular(tex);
  const old = scene.environment;
  scene.environment = rt.texture;
  scene.environmentIntensity = mood === 'dawn' ? 1.0 : 0.4;
  tex.dispose();
  pmrem.dispose();
  old?.dispose();
}

export interface SkyHandles {
  moonDir: THREE.Vector3;
  moon: THREE.DirectionalLight;
  ambient: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
  sky: THREE.Mesh;
  moonDisc: THREE.Sprite;
  stars: THREE.Points;
  setMood: (mood: 'night' | 'dawn') => void;
}

export function buildSky(scene: THREE.Scene): SkyHandles {
  const skyGeo = new THREE.SphereGeometry(600, 32, 20);
  const uniforms = {
    top: { value: new THREE.Color(0x080e1c) },
    mid: { value: new THREE.Color(0x1b2c49) },
    bot: { value: new THREE.Color(0x3b5473) },
    off: { value: 0.06 },
  };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform float off;
      varying vec3 vP;
      void main(){
        float h = clamp(normalize(vP).y * 0.5 + 0.5 + off, 0.0, 1.0);
        vec3 c = h > 0.55 ? mix(mid, top, (h-0.55)/0.45) : mix(bot, mid, h/0.55);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // stars
  const starCount = 900;
  const pos = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(500);
    v.y = Math.abs(v.y) * 0.85 + 40;
    pos.set([v.x, v.y, v.z], i * 3);
    sizes[i] = Math.random() * 2.4 + 0.6;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xd8e4ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  stars.frustumCulled = false;
  scene.add(stars);

  const moonDir = new THREE.Vector3(-0.3, 0.24, -1).normalize();
  const moon = new THREE.DirectionalLight(0xa8c6f5, 1.5);
  moon.position.copy(moonDir).multiplyScalar(120);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  // the shadow box follows the player, so it only ever renders nearby geometry
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 200;
  const s = 42;
  moon.shadow.camera.left = -s; moon.shadow.camera.right = s;
  moon.shadow.camera.top = s; moon.shadow.camera.bottom = -s;
  moon.shadow.bias = -0.0009;
  moon.shadow.normalBias = 0.04;
  scene.add(moon);
  scene.add(moon.target);

  const fill = new THREE.DirectionalLight(0x3c5c8c, 0.7);
  fill.position.set(30, 20, 40);
  scene.add(fill);

  const ambient = new THREE.HemisphereLight(0x3a5580, 0x14181f, 0.8);
  scene.add(ambient);

  const moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: moonTexture(), color: 0xdfe9ff, transparent: true, opacity: 0.95, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  moonDisc.position.copy(moonDir).multiplyScalar(420);
  moonDisc.scale.set(70, 70, 1);
  scene.add(moonDisc);

  const setMood = (mood: 'night' | 'dawn') => {
    if (mood === 'dawn') {
      uniforms.top.value.setHex(0x4d6f9e);
      uniforms.mid.value.setHex(0x9db3c8);
      uniforms.bot.value.setHex(0xe6c39a);
      moon.color.setHex(0xfff0d8); moon.intensity = 2.4;
      moonDir.set(0.42, 0.52, 0.74).normalize();
      ambient.color.setHex(0x9fb8d4); ambient.groundColor.setHex(0x6b6350); ambient.intensity = 1.5;
      fill.color.setHex(0xffd9a8); fill.intensity = 0.9;
      (stars.material as THREE.PointsMaterial).opacity = 0;
      (moonDisc.material as THREE.SpriteMaterial).opacity = 0;
      scene.fog = new THREE.FogExp2(0xc6d6e2, 0.0042);
    } else {
      uniforms.top.value.setHex(0x080e1c);
      uniforms.mid.value.setHex(0x1b2c49);
      uniforms.bot.value.setHex(0x3b5473);
      moon.color.setHex(0xa8c6f5); moon.intensity = 1.5;
      moonDir.set(-0.3, 0.24, -1).normalize();
      ambient.color.setHex(0x3a5580); ambient.groundColor.setHex(0x14181f); ambient.intensity = 0.8;
      fill.color.setHex(0x3c5c8c); fill.intensity = 0.7;
      (stars.material as THREE.PointsMaterial).opacity = 0.55;
      (moonDisc.material as THREE.SpriteMaterial).opacity = 0.9;
      scene.fog = new THREE.FogExp2(0x18293f, 0.0095);
    }
  };
  setMood('night');
  return { moonDir, moon, ambient, fill, sky, moonDisc, stars, setMood };
}
