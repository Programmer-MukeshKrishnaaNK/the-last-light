import * as THREE from 'three';
import { Box, Rng, boxFrom, mergeMeshes, std } from './util';
import { glowTexture, groundTexture, stoneTexture, windowTexture, woodTexture } from './textures';

export interface LampSpec {
  pos: THREE.Vector3;
  color: number;
  intensity: number;
  distance: number;
  /** 0..1 master multiplier, animated when the town powers up. */
  power: number;
  flicker: number;
  glow?: THREE.Sprite;
  pool?: THREE.Mesh;
  bulb?: THREE.MeshStandardMaterial;
}

/** Collects everything a built prop contributes back to the world. */
export class Builder {
  root = new THREE.Group();
  boxes: Box[] = [];
  windows: THREE.MeshStandardMaterial[] = [];
  lamps: LampSpec[] = [];
  floors: THREE.Mesh[] = [];

  add(o: THREE.Object3D) { this.root.add(o); return o; }
  collide(b: Box) { this.boxes.push(b); return b; }
}

export const MAT = {
  wood: () => new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.9 }),
  stone: () => new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95 }),
  road: () => new THREE.MeshStandardMaterial({ map: groundTexture(), color: 0x74777d, roughness: 0.7, metalness: 0.05 }),
  metal: (c = 0x2b2f36) => std(c, 0.4, 0.75),
  dark: (c = 0x15171c) => std(c, 0.9),
};

/** Warm window pane material. Intensity 0 = dark house. */
export function windowMaterial(tint = '#ffb45e', cols = 2, rows = 2) {
  const tex = windowTexture(tint, cols, rows);
  const m = new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0, color: 0x0b0d12, roughness: 0.25, metalness: 0.1,
  });
  return m;
}

function triPrism(w: number, h: number, d: number, mat: THREE.Material) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export interface HouseOpts {
  w?: number; d?: number; h?: number;
  color?: number; roofColor?: number; trim?: number;
  roof?: 'gable' | 'hip' | 'flat';
  porch?: boolean; balcony?: boolean; chimney?: boolean;
  facing?: number;      // yaw in radians; door faces -Z before rotation
  tint?: string; lit?: boolean;
}

export interface HouseResult {
  group: THREE.Group;
  boxes: Box[];
  windows: THREE.MeshStandardMaterial[];
  doorWorld: THREE.Vector3;
}

/** A stylized two-storey coastal house. Everything is built facing -Z, then yawed. */
export function makeHouse(o: HouseOpts, rng: Rng): HouseResult {
  const w = o.w ?? 8, d = o.d ?? 7, h = o.h ?? 5.4;
  const g = new THREE.Group();
  const wallMat = std(o.color ?? 0x6d6155, 0.92);
  const roofMat = std(o.roofColor ?? 0x2c2a30, 0.85);
  const trimMat = std(o.trim ?? 0x3a3129, 0.8);
  const winMat = windowMaterial(o.tint ?? '#ffb45e');
  const windows: THREE.MeshStandardMaterial[] = [winMat];

  // foundation + walls
  g.add(box(w + 0.5, 0.55, d + 0.5, MAT.stone(), 0, 0.27, 0));
  g.add(box(w, h, d, wallMat, 0, h / 2 + 0.5, 0));

  // roof
  if (o.roof === 'flat') {
    g.add(box(w + 0.7, 0.4, d + 0.7, roofMat, 0, h + 0.72, 0));
    g.add(box(w + 0.8, 0.5, 0.25, trimMat, 0, h + 1.05, -(d + 0.7) / 2));
  } else if (o.roof === 'hip') {
    const r = new THREE.Mesh(new THREE.ConeGeometry((w + 1.2) * 0.72, 2.6, 4), roofMat);
    r.rotation.y = Math.PI / 4; r.position.y = h + 1.85; r.castShadow = true;
    g.add(r);
  } else {
    const p = triPrism(w + 1.0, 2.7, d + 0.9, roofMat);
    p.position.y = h + 0.5;
    g.add(p);
  }

  if (o.chimney) {
    g.add(box(0.9, 2.2, 0.9, MAT.stone(), w * 0.3, h + 1.7, d * 0.2));
  }

  // windows: front (-Z) and sides
  const winGeo = new THREE.PlaneGeometry(1.3, 1.6);
  const frameMat = trimMat;
  const place = (x: number, y: number, z: number, ry: number) => {
    const pane = new THREE.Mesh(winGeo, winMat);
    pane.position.set(x, y, z); pane.rotation.y = ry;
    g.add(pane);
    const f = box(1.55, 1.85, 0.14, frameMat, x, y, z);
    f.rotation.y = ry; f.position.add(new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(-0.06));
    g.add(f);
  };
  const fz = -d / 2 - 0.03;
  place(-w * 0.28, 3.9, fz, Math.PI);
  place(w * 0.28, 3.9, fz, Math.PI);
  place(w * 0.3, 2.0, fz, Math.PI);
  place(-w / 2 - 0.03, 3.9, 0.6, -Math.PI / 2);
  place(w / 2 + 0.03, 3.9, -0.9, Math.PI / 2);
  place(0, 3.9, d / 2 + 0.03, 0);

  // door
  const doorMat = std(0x4b3524, 0.75);
  g.add(box(1.35, 2.35, 0.16, doorMat, -w * 0.28, 1.68, fz - 0.05));
  g.add(box(1.6, 2.6, 0.1, trimMat, -w * 0.28, 1.8, fz - 0.13));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), MAT.metal(0x8a7448));
  knob.position.set(-w * 0.28 + 0.45, 1.6, fz - 0.16); g.add(knob);

  // porch
  if (o.porch) {
    const pd = 2.2;
    g.add(box(w * 0.8, 0.3, pd, MAT.wood(), 0, 0.62, -d / 2 - pd / 2));
    for (const px of [-w * 0.35, w * 0.35]) {
      g.add(box(0.22, 2.9, 0.22, trimMat, px, 2.2, -d / 2 - pd + 0.2));
    }
    g.add(box(w * 0.85, 0.28, pd + 0.3, roofMat, 0, 3.7, -d / 2 - pd / 2 + 0.1));
    // railing
    for (let i = 0; i < 5; i++) {
      g.add(box(0.1, 0.85, 0.1, trimMat, -w * 0.34 + (i * w * 0.68) / 4, 1.2, -d / 2 - pd + 0.15));
    }
  }

  if (o.balcony) {
    g.add(box(w * 0.5, 0.18, 1.2, MAT.wood(), w * 0.2, 5.0, -d / 2 - 0.55));
    for (let i = 0; i < 6; i++) {
      g.add(box(0.08, 0.7, 0.08, trimMat, w * 0.2 - w * 0.24 + (i * w * 0.48) / 5, 5.4, -d / 2 - 1.1));
    }
    g.add(box(w * 0.5, 0.08, 0.08, trimMat, w * 0.2, 5.78, -d / 2 - 1.1));
  }

  // gutter / drainpipe detail
  g.add(box(0.14, h, 0.14, trimMat, w / 2 - 0.2, h / 2 + 0.5, -d / 2 + 0.2));

  // a little vegetation hugging the wall
  for (let i = 0; i < 3; i++) {
    const b = makeBush(rng);
    b.position.set(rng.range(-w * 0.4, w * 0.4), 0, -d / 2 - rng.range(0.4, 1.1));
    g.add(b);
  }

  const yaw = o.facing ?? 0;
  g.rotation.y = yaw;

  const doorLocal = new THREE.Vector3(-w * 0.28, 0, -d / 2 - (o.porch ? 2.4 : 0.8));
  const doorWorld = doorLocal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

  // collision: axis-aligned bound of the rotated footprint (houses are placed on axis)
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const bw = w * c + d * s, bd = w * s + d * c;
  const boxes: Box[] = [boxFrom(0, 0, bw, bd)];
  return { group: g, boxes, windows, doorWorld };
}

export function makeTree(rng: Rng, scale = 1) {
  const g = new THREE.Group();
  const barkMat = std(0x3a2f24, 0.95);
  const trunkH = rng.range(3.2, 5.0) * scale;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.34 * scale, trunkH, 7), barkMat);
  trunk.position.y = trunkH / 2; trunk.castShadow = true;
  g.add(trunk);
  const leafMat = std(0x30402c, 0.92);
  const blobs: THREE.Mesh[] = [];
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const r = rng.range(1.0, 1.8) * scale;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
    b.position.set(rng.range(-0.9, 0.9) * scale, trunkH + rng.range(-0.3, 1.3) * scale, rng.range(-0.9, 0.9) * scale);
    b.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    blobs.push(b);
  }
  const canopy = mergeMeshes(blobs, leafMat, true);
  g.add(canopy);
  // branches
  const branches: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * scale, 0.12 * scale, 1.6 * scale, 5), barkMat);
    br.position.set(rng.range(-0.4, 0.4) * scale, trunkH * 0.75, rng.range(-0.4, 0.4) * scale);
    br.rotation.z = rng.range(-0.9, 0.9); br.rotation.x = rng.range(-0.9, 0.9);
    branches.push(br);
  }
  g.add(mergeMeshes(branches, barkMat));
  g.userData.swayRoot = true;
  return g;
}

export function makeBush(rng: Rng) {
  const g = new THREE.Group();
  const mat = std(0x2a3826, 0.96);
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const r = rng.range(0.35, 0.7);
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    b.position.set(rng.range(-0.5, 0.5), r * 0.7, rng.range(-0.5, 0.5));
    b.castShadow = true;
    g.add(b);
  }
  return g;
}

export function makeFence(length: number, rng: Rng) {
  const mat = std(0x4a3f31, 0.95);
  const parts: THREE.Mesh[] = [];
  const n = Math.max(2, Math.round(length / 1.1));
  for (let i = 0; i <= n; i++) {
    const p = box(0.11, rng.range(1.0, 1.2), 0.11, mat, -length / 2 + (i * length) / n, 0.55, 0);
    p.rotation.z = rng.range(-0.05, 0.05);
    parts.push(p);
  }
  parts.push(box(length, 0.09, 0.07, mat, 0, 0.9, 0));
  parts.push(box(length, 0.09, 0.07, mat, 0, 0.5, 0));
  const g = new THREE.Group();
  g.add(mergeMeshes(parts, mat));
  return g;
}

export function makeStreetlight(lamps: LampSpec[], color = 0xffc27a) {
  const g = new THREE.Group();
  const mat = MAT.metal(0x22262c);
  g.add(box(0.4, 0.3, 0.4, MAT.stone(), 0, 0.15, 0));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 5.4, 8), mat);
  pole.position.y = 2.7; pole.castShadow = true; g.add(pole);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6), mat);
  arm.rotation.z = Math.PI / 2; arm.position.set(0.62, 5.3, 0); g.add(arm);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0x0c0c10, emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.3,
  });
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.2, 0.4, 8), mat);
  head.position.set(1.2, 5.18, 0); g.add(head);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), bulbMat);
  bulb.position.set(1.2, 4.98, 0); g.add(bulb);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.set(4.2, 4.2, 1); glow.position.set(1.2, 4.98, 0); g.add(glow);

  const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({
    map: glowTexture(), color, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(1.2, 0.03, 0); g.add(pool);

  lamps.push({
    pos: new THREE.Vector3(1.2, 4.98, 0), color, intensity: 9, distance: 16,
    power: 0, flicker: Math.random() * 10, glow, pool, bulb: bulbMat,
  });
  return g;
}

export function makeBench() {
  const g = new THREE.Group();
  const w = MAT.wood(), m = MAT.metal(0x30343b);
  for (let i = 0; i < 4; i++) g.add(box(1.9, 0.09, 0.13, w, 0, 0.55, -0.25 + i * 0.16));
  for (let i = 0; i < 3; i++) g.add(box(1.9, 0.09, 0.12, w, 0, 0.72 + i * 0.2, 0.28));
  for (const x of [-0.8, 0.8]) {
    g.add(box(0.1, 0.55, 0.1, m, x, 0.28, -0.2));
    g.add(box(0.1, 0.55, 0.1, m, x, 0.28, 0.25));
    g.add(box(0.1, 0.7, 0.1, m, x, 0.95, 0.3));
  }
  return g;
}

export function makeUtilityPole() {
  const g = new THREE.Group();
  const mat = std(0x3a3128, 0.95);
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 8.5, 7), mat);
  p.position.y = 4.25; p.castShadow = true; g.add(p);
  g.add(box(2.4, 0.14, 0.14, mat, 0, 7.6, 0));
  g.add(box(1.8, 0.12, 0.12, mat, 0, 6.9, 0));
  for (const x of [-1.05, -0.35, 0.35, 1.05]) {
    g.add(box(0.09, 0.24, 0.09, std(0x6c6a5e, 0.6), x, 7.78, 0));
  }
  return g;
}

export function makeBin() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.3, 0.95, 10), std(0x2a3a34, 0.85));
  body.position.y = 0.48; body.castShadow = true; g.add(body);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 10), std(0x1e2b26, 0.8));
  lid.position.y = 1.0; g.add(lid);
  return g;
}

export function makeBicycle() {
  const g = new THREE.Group();
  const m = MAT.metal(0x4a4038);
  const wheelGeo = new THREE.TorusGeometry(0.36, 0.045, 6, 16);
  for (const z of [-0.55, 0.55]) {
    const wme = new THREE.Mesh(wheelGeo, m);
    wme.position.set(0, 0.38, z); wme.rotation.y = Math.PI / 2; g.add(wme);
  }
  g.add(box(0.05, 0.05, 1.05, m, 0, 0.62, 0));
  g.add(box(0.05, 0.45, 0.05, m, 0, 0.72, -0.4));
  g.add(box(0.05, 0.35, 0.05, m, 0, 0.8, 0.45));
  g.add(box(0.05, 0.05, 0.45, std(0x241d18, 0.8), 0, 0.95, 0.45));
  g.add(box(0.42, 0.06, 0.06, m, 0, 0.95, -0.42));
  g.rotation.z = 0.28;
  return g;
}

export function makeSign(text: 'street' | 'station', hanging = false) {
  const g = new THREE.Group();
  const m = MAT.metal(0x363b42);
  if (hanging) {
    g.add(box(0.1, 0.1, 1.0, m, 0, 0, -0.5));
    const plate = box(1.9, 0.55, 0.07, std(0x22282e, 0.6), 0, -0.45, -0.95);
    plate.userData.swing = true;
    g.add(plate);
    g.add(box(0.05, 0.45, 0.05, m, -0.6, -0.22, -0.95));
    g.add(box(0.05, 0.45, 0.05, m, 0.6, -0.22, -0.95));
  } else {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6), m);
    pole.position.y = 1.3; g.add(pole);
    g.add(box(text === 'street' ? 1.5 : 2.2, 0.34, 0.06, std(0x2c3138, 0.5), 0, 2.4, 0));
  }
  return g;
}

export function makeMailbox() {
  const g = new THREE.Group();
  g.add(box(0.09, 1.0, 0.09, MAT.wood(), 0, 0.5, 0));
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.45, 8, 1, false, 0, Math.PI), MAT.metal(0x4e4438));
  b.rotation.z = Math.PI / 2; b.position.y = 1.08; g.add(b);
  g.add(box(0.32, 0.02, 0.45, MAT.metal(0x4e4438), 0, 0.92, 0));
  return g;
}

export function makeCrate(rng: Rng) {
  const s = rng.range(0.5, 0.85);
  const m = box(s, s, s, MAT.wood());
  m.rotation.y = rng.range(0, Math.PI);
  m.position.y = s / 2;
  return m;
}

export function makeRock(rng: Rng, scale = 1) {
  const r = new THREE.Mesh(
    new THREE.DodecahedronGeometry(rng.range(0.5, 1.5) * scale, 0),
    std(0x3c3a36, 0.98),
  );
  r.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
  r.scale.y *= rng.range(0.5, 0.9);
  r.castShadow = true; r.receiveShadow = true;
  return r;
}

export function makeFlowers(rng: Rng) {
  const g = new THREE.Group();
  const stem = std(0x27321f, 0.95);
  const colors = [0xd8b8c8, 0xe0d0a0, 0xc0c8d8];
  for (let i = 0; i < 7; i++) {
    const h = rng.range(0.3, 0.55);
    g.add(box(0.03, h, 0.03, stem, rng.range(-0.3, 0.3), h / 2, rng.range(-0.3, 0.3)));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), std(rng.pick(colors), 0.85));
    head.position.set(g.children[g.children.length - 1].position.x, h, g.children[g.children.length - 1].position.z);
    g.add(head);
  }
  return g;
}
