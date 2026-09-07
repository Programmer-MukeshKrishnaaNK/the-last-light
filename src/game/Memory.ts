import * as THREE from 'three';
import { damp } from './util';

/** A translucent figure from the town's past. Deliberately featureless. */
export function makeGhost(scale = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xbcd8f0, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const b = (w: number, h: number, d: number, y: number, x = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  b(0.42, 0.62, 0.26, 1.12);                 // torso
  b(0.23, 0.26, 0.23, 1.58);                 // head
  b(0.12, 0.5, 0.13, 1.14, -0.28);           // arms
  b(0.12, 0.5, 0.13, 1.14, 0.28);
  b(0.16, 0.78, 0.17, 0.4, -0.12);           // legs
  b(0.16, 0.78, 0.17, 0.4, 0.12);
  g.scale.setScalar(scale);
  g.userData.mat = mat;
  return g;
}

export interface GhostSpec {
  pos: THREE.Vector3;
  yaw?: number;
  scale?: number;
  sway?: number;
}

/** A group of ghosts that fade in together, hold, then fade out. */
export class MemoryScene {
  group = new THREE.Group();
  private mats: THREE.MeshBasicMaterial[] = [];
  private ghosts: THREE.Group[] = [];
  private phase: 'idle' | 'in' | 'hold' | 'out' = 'idle';
  private timer = 0;
  private level = 0;
  holdTime = 6;
  maxOpacity = 0.5;
  onEnd?: () => void;

  constructor(specs: GhostSpec[], parent: THREE.Object3D) {
    for (const s of specs) {
      const gh = makeGhost(s.scale ?? 1);
      gh.position.copy(s.pos);
      gh.rotation.y = s.yaw ?? 0;
      gh.userData.sway = s.sway ?? Math.random() * 6;
      this.group.add(gh);
      this.ghosts.push(gh);
      this.mats.push(gh.userData.mat as THREE.MeshBasicMaterial);
    }
    this.group.visible = false;
    parent.add(this.group);
  }

  play() {
    this.phase = 'in';
    this.timer = 0;
    this.group.visible = true;
  }

  get active() { return this.phase !== 'idle'; }

  update(dt: number, t: number) {
    if (this.phase === 'idle') return;
    this.timer += dt;
    if (this.phase === 'in') {
      this.level += damp(dt, 1.1) * (1 - this.level);
      if (this.timer > 2.2) { this.phase = 'hold'; this.timer = 0; }
    } else if (this.phase === 'hold') {
      if (this.timer > this.holdTime) { this.phase = 'out'; this.timer = 0; }
    } else if (this.phase === 'out') {
      this.level += damp(dt, 1.3) * (0 - this.level);
      if (this.timer > 2.6) {
        this.phase = 'idle';
        this.level = 0;
        this.group.visible = false;
        this.onEnd?.();
      }
    }
    for (const m of this.mats) m.opacity = this.level * this.maxOpacity;
    for (const g of this.ghosts) {
      const s = g.userData.sway as number;
      g.position.y += Math.sin(t * 1.4 + s) * 0.0008;
      g.rotation.z = Math.sin(t * 0.9 + s) * 0.02;
      g.children.forEach((c, i) => {
        if (i >= 2 && i <= 3) c.rotation.x = Math.sin(t * 1.8 + s + i) * 0.18;
      });
    }
  }
}
