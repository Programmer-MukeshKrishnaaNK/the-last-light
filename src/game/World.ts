import * as THREE from 'three';
import { Box, Rng, boxFrom, mergeMeshes, std } from './util';
import { glowTexture, sandTexture, stoneTexture, woodTexture } from './textures';
import {
  LampSpec, MAT, makeBench, makeBicycle, makeBin, makeBush, makeCrate, makeFence,
  makeFlowers, makeHouse, makeMailbox, makeRock, makeSign, makeStreetlight, makeTree,
  makeUtilityPole, windowMaterial,
} from './props';
import { makeOcean, makeSurf } from './Ocean';

export interface Zone {
  lamps: LampSpec[];
  windows: THREE.MeshStandardMaterial[];
  power: number;
  target: number;
}

/** A cylindrical wall the player can only cross through a doorway arc. */
export interface Ring {
  cx: number; cz: number; r: number;
  doorAngle: number; doorHalf: number; doorOpenBelowY: number;
  inside?: boolean;   // true = keeps player inside (central void)
}

export const P = {
  start: new THREE.Vector3(0, 0, 66),
  lantern: new THREE.Vector3(2.6, 0, 57),
  houseDoor: new THREE.Vector3(-8.6, 0, 34),
  houseInside: new THREE.Vector3(-16, 0, 32),
  station1: new THREE.Vector3(-9.2, 0, 41.5),
  table: new THREE.Vector3(-18.5, 0, 30.5),
  clock: new THREE.Vector3(-21.4, 0, 33.5),
  platform: new THREE.Vector3(0, 0.9, -44),
  station2: new THREE.Vector3(6.5, 0.9, -40),
  memory2: new THREE.Vector3(-4, 0.9, -48),
  beach: new THREE.Vector3(0, 0, -68),
  station3: new THREE.Vector3(4.2, 0, -73),
  pierEnd: new THREE.Vector3(0, 1.25, -108),
  lighthouse: new THREE.Vector3(0, 0, -122),
  lighthouseDoor: new THREE.Vector3(0, 0, -117),
  lampRoom: new THREE.Vector3(0, 25.05, -122),
};

const LH = { r: 4.3, h: 24 };
const LAMP_Y = 1.2 + LH.h;      // walkable floor level at the top of the tower

export class World {
  root = new THREE.Group();
  boxes: Box[] = [];
  rings: Ring[] = [];
  floors: THREE.Mesh[] = [];
  lamps: LampSpec[] = [];
  zones: Zone[] = [
    { lamps: [], windows: [], power: 0, target: 0 },
    { lamps: [], windows: [], power: 0, target: 0 },
    { lamps: [], windows: [], power: 0, target: 0 },
  ];
  sway: THREE.Object3D[] = [];
  /** Lifted during cinematics so the distant town still reads as lit. */
  glowBoost = 1;
  swingers: THREE.Object3D[] = [];
  ocean!: THREE.Mesh;
  surf!: THREE.Mesh;
  grassMats: THREE.Material[] = [];
  houseRoof = new THREE.Group();
  houseWindows!: THREE.MeshStandardMaterial;
  houseInteriorLight!: THREE.PointLight;
  clockHands!: { h: THREE.Mesh; m: THREE.Mesh };
  beamPivot = new THREE.Group();
  beamCone!: THREE.Mesh;
  beamLight!: THREE.SpotLight;
  lampGlow!: THREE.Sprite;
  lighthouseDoorMesh!: THREE.Mesh;
  private doorBox!: Box;
  townProps = new THREE.Group();
  blockers: THREE.Object3D[] = [];
  puddles: THREE.Mesh[] = [];
  private rng = new Rng(20250907);
  private ray = new THREE.Raycaster();
  private down = new THREE.Vector3(0, -1, 0);

  constructor(private scene: THREE.Scene) {
    this.scene.add(this.root);
    this.root.add(this.townProps);
    this.blockers.push(this.townProps);
  }

  build() {
    this.buildTerrain();
    this.buildStreet();
    this.buildHouses();
    this.buildEnterableHouse();
    this.buildStationArea();
    this.buildBeach();
    this.buildLighthouse();
    this.buildGrass();
    // glows and particles must never block the camera ray
    const noHit = () => {};
    this.root.traverse((o) => {
      if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints) o.raycast = noHit;
    });
    // small props don't earn their place in the shadow pass
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow || !m.geometry) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const r = m.geometry.boundingSphere!.radius * Math.max(m.scale.x, m.scale.y, m.scale.z);
      if (r < 0.75) m.castShadow = false;
    });
  }

  // ---------------------------------------------------------------- terrain

  private buildTerrain() {
    const tex = sandTexture();
    const g = new THREE.PlaneGeometry(320, 152, 64, 32);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.terrainHeight(x, z) - 0.02);
    }
    g.computeVertexNormals();
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(34, 34);
    const dirt = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: t, color: 0x5a5648, roughness: 0.92,
    }));
    dirt.position.z = 8;
    dirt.receiveShadow = true;
    this.root.add(dirt);

    this.ocean = makeOcean();
    this.ocean.position.set(0, -1.6, -230);
    this.root.add(this.ocean);

    this.surf = makeSurf();
    this.surf.position.set(0, -0.72, -88);
    this.root.add(this.surf);

    // distant headland silhouettes so the horizon is not empty
    for (let i = 0; i < 9; i++) {
      const r = makeRock(this.rng, this.rng.range(6, 14));
      r.position.set(this.rng.range(-190, 190), -2, -this.rng.range(150, 260));
      r.castShadow = false;
      this.root.add(r);
    }
  }

  /** Flat town, then a gentle slope down into the sea. */
  terrainHeight(_x: number, _z: number) {
    return 0;
  }

  private buildStreet() {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 108), MAT.road());
    (road.material as THREE.MeshStandardMaterial).map!.repeat.set(2, 24);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.012, 22);
    road.receiveShadow = true;
    this.root.add(road);

    const walkMat = std(0x2a2c31, 0.85);
    for (const x of [-5.4, 5.4]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 108), walkMat);
      w.position.set(x, 0.08, 22);
      w.receiveShadow = true;
      this.root.add(w);
      this.floors.push(w);
    }
    // centre dashes
    const dashMat = new THREE.MeshStandardMaterial({ color: 0x4e4a3c, roughness: 0.8 });
    const dashes: THREE.Mesh[] = [];
    for (let z = 70; z > -28; z -= 6) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 2.2), dashMat);
      d.rotation.x = -Math.PI / 2; d.position.set(0, 0.02, z);
      dashes.push(d);
    }
    this.root.add(mergeMeshes(dashes, dashMat));

    // puddles — wet, specular, they catch every light
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x232c38, roughness: 0.07, metalness: 0.22,
    });
    const puddleParts: THREE.Mesh[] = [];
    for (let i = 0; i < 26; i++) {
      const s = this.rng.range(0.9, 2.2);
      const p = new THREE.Mesh(new THREE.CircleGeometry(s, 12), puddleMat);
      p.rotation.x = -Math.PI / 2;
      p.scale.y = this.rng.range(0.5, 1);
      p.position.set(this.rng.range(-4.4, 4.4), 0.026, this.rng.range(-52, 74));
      puddleParts.push(p);
    }
    const puddleMesh = mergeMeshes(puddleParts, puddleMat);
    this.root.add(puddleMesh);
    this.puddles.push(puddleMesh);

    // streetlights down the road
    const lampZ = [64, 52, 40, 28, 16, 4, -8, -20];
    lampZ.forEach((z, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const l = makeStreetlight(this.lamps);
      l.position.set(side * 5.6, 0, z);
      l.rotation.y = side < 0 ? 0 : Math.PI;
      this.townProps.add(l);
      this.boxes.push(boxFrom(side * 5.6, z, 0.6, 0.6));
      const spec = this.lamps[this.lamps.length - 1];
      spec.pos.applyMatrix4(l.matrixWorld.copy(l.matrix));
      // zone 0 = near the house, zone 1 = mid street, zone 2 = the rest
      const zone = z > 32 ? 0 : z > -2 ? 1 : 2;
      this.zones[zone].lamps.push(spec);
    });

    // utility poles + wires
    for (let z = 60; z > -30; z -= 22) {
      const p = makeUtilityPole();
      p.position.set(8.4, 0, z);
      this.townProps.add(p);
      this.boxes.push(boxFrom(8.4, z, 0.5, 0.5));
    }
    const wireMat = new THREE.LineBasicMaterial({ color: 0x0a0c10 });
    for (const y of [7.6, 6.9]) {
      for (let z = 60; z > -30; z -= 22) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          pts.push(new THREE.Vector3(8.4, y - Math.sin(t * Math.PI) * 0.55, z - t * 22));
        }
        this.root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
      }
    }

    // street furniture
    const bench = makeBench(); bench.position.set(5.2, 0.16, 30); bench.rotation.y = -Math.PI / 2;
    this.townProps.add(bench); this.boxes.push(boxFrom(5.2, 30, 1, 2));
    const bench2 = makeBench(); bench2.position.set(-5.2, 0.16, 8); bench2.rotation.y = Math.PI / 2;
    this.townProps.add(bench2); this.boxes.push(boxFrom(-5.2, 8, 1, 2));

    for (const [x, z] of [[5.4, 46], [-5.4, 20], [5.4, -6]] as [number, number][]) {
      const b = makeBin(); b.position.set(x, 0.16, z); this.townProps.add(b);
      this.boxes.push(boxFrom(x, z, 0.8, 0.8));
    }

    const bike = makeBicycle(); bike.position.set(-5.9, 0.16, 44); bike.rotation.y = 0.4;
    this.townProps.add(bike);

    const sign = makeSign('street'); sign.position.set(5.9, 0.16, 58); this.townProps.add(sign);
    const sign2 = makeSign('street'); sign2.position.set(-5.9, 0.16, 2); this.townProps.add(sign2);

    // hanging shop sign that swings in the wind
    const hang = makeSign('station', true);
    hang.position.set(11.2, 3.6, 22);
    hang.rotation.y = -Math.PI / 2;
    this.townProps.add(hang);
    hang.traverse((o) => { if (o.userData.swing) this.swingers.push(o); });
  }

  // ---------------------------------------------------------------- houses

  private buildHouses() {
    const specs: Array<[number, number, number, Parameters<typeof makeHouse>[0]]> = [
      [-15, 52, Math.PI / 2, { w: 9, d: 8, color: 0x5d5f63, roofColor: 0x2a2b31, roof: 'gable', porch: true, chimney: true, tint: '#ffb45e' }],
      [15, 46, -Math.PI / 2, { w: 8, d: 9, color: 0x6b5b4b, roofColor: 0x33291f, roof: 'hip', balcony: true, tint: '#ffc98a' }],
      [-15, 16, Math.PI / 2, { w: 8.5, d: 7.5, color: 0x4f5a5c, roofColor: 0x252a2e, roof: 'gable', chimney: true, tint: '#ff9f5c' }],
      [15, 30, -Math.PI / 2, { w: 9, d: 8, color: 0x74695c, roofColor: 0x2e2721, roof: 'gable', porch: true, tint: '#ffb45e' }],
      [15, 14, -Math.PI / 2, { w: 8, d: 8, color: 0x565c66, roofColor: 0x22252c, roof: 'flat', balcony: true, tint: '#ffd39c' }],
      [-15, 2, Math.PI / 2, { w: 9.5, d: 8, color: 0x60564c, roofColor: 0x2b2620, roof: 'gable', porch: true, chimney: true, tint: '#ffab6a' }],
      [15, -2, -Math.PI / 2, { w: 8, d: 8.5, color: 0x4a5158, roofColor: 0x262a30, roof: 'hip', tint: '#ffbe78' }],
    ];

    specs.forEach(([x, z, yaw, opt], i) => {
      const h = makeHouse({ ...opt, facing: yaw }, this.rng);
      h.group.position.set(x, 0, z);
      this.townProps.add(h.group);
      for (const b of h.boxes) {
        this.boxes.push({ minX: b.minX + x, maxX: b.maxX + x, minZ: b.minZ + z, maxZ: b.maxZ + z });
      }
      const zone = z > 32 ? 0 : z > -2 ? 1 : 2;
      this.zones[zone].windows.push(...h.windows);

      // yard dressing
      const side = Math.sign(x);
      const f = makeFence(7.5, this.rng);
      f.position.set(x - side * 6.6, 0, z);
      f.rotation.y = Math.PI / 2;
      this.townProps.add(f);

      if (i % 2 === 0) {
        const t = makeTree(this.rng, this.rng.range(0.85, 1.25));
        t.position.set(x - side * 7.6, 0, z + this.rng.range(-5, 5));
        this.townProps.add(t);
        this.boxes.push(boxFrom(t.position.x, t.position.z, 0.7, 0.7));
        this.sway.push(t);
      }
      const mb = makeMailbox();
      mb.position.set(x - side * 7.4, 0.16, z - 3.2);
      this.townProps.add(mb);
      if (i % 3 === 0) {
        const fl = makeFlowers(this.rng);
        fl.position.set(x - side * 6.2, 0, z + 2.6);
        this.townProps.add(fl);
      }
      if (i === 3) {
        const c = makeCrate(this.rng); c.position.set(x - side * 6.9, 0.3, z + 3.4);
        this.townProps.add(c);
      }
    });

    // trees lining the far side
    for (let i = 0; i < 14; i++) {
      const x = (i % 2 === 0 ? -1 : 1) * this.rng.range(22, 30);
      const z = this.rng.range(-24, 70);
      const t = makeTree(this.rng, this.rng.range(0.9, 1.4));
      t.position.set(x, 0, z);
      this.townProps.add(t);
      this.sway.push(t);
    }
    for (let i = 0; i < 26; i++) {
      const b = makeBush(this.rng);
      b.position.set(this.rng.range(-30, 30), 0, this.rng.range(-26, 72));
      if (Math.abs(b.position.x) < 8) continue;
      this.townProps.add(b);
    }
  }

  // ------------------------------------------------------ the enterable house

  private buildEnterableHouse() {
    const g = new THREE.Group();
    const O = P.houseInside;
    g.position.copy(O);
    this.root.add(g);
    this.blockers.push(g);

    const W = 12, D = 11, H = 4.3, T = 0.32;
    const wallMat = std(0x6a5f52, 0.94);
    const innerMat = std(0x7a6d5c, 0.95);
    const floorMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.72, metalness: 0.05 });
    const fm = (floorMat.map as THREE.Texture).clone(); fm.needsUpdate = true; fm.repeat.set(4, 4);
    floorMat.map = fm;

    // foundation + floor
    const found = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.4, D + 0.6), MAT.stone());
    found.position.y = -0.2; found.receiveShadow = true; g.add(found);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D), floorMat);
    floor.position.y = 0.02; floor.receiveShadow = true; g.add(floor);
    this.floors.push(floor);

    const winMat = windowMaterial('#ffb45e');
    this.zones[0].windows.push(winMat);
    this.houseWindows = winMat;

    const wall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
      const inner = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, h - 0.02, d - 0.02), innerMat);
      inner.position.copy(m.position); inner.scale.multiplyScalar(0.999);
      g.add(m);
      void inner;
      return m;
    };

    // -X, -Z, +Z walls solid; +X wall has the doorway
    wall(T, H, D, -W / 2, H / 2, 0);
    wall(W, H, T, 0, H / 2, -D / 2);
    wall(W, H, T, 0, H / 2, D / 2);
    wall(T, H, 3.4, W / 2, H / 2, -D / 2 + 1.7);
    wall(T, H, 4.4, W / 2, H / 2, D / 2 - 2.2);
    wall(T, 1.5, 2.2, W / 2, H - 0.75, 0.15);   // lintel over the door

    this.boxes.push(
      { minX: O.x - W / 2 - T, maxX: O.x - W / 2 + T, minZ: O.z - D / 2, maxZ: O.z + D / 2 },
      { minX: O.x - W / 2, maxX: O.x + W / 2, minZ: O.z - D / 2 - T, maxZ: O.z - D / 2 + T },
      { minX: O.x - W / 2, maxX: O.x + W / 2, minZ: O.z + D / 2 - T, maxZ: O.z + D / 2 + T },
      { minX: O.x + W / 2 - T, maxX: O.x + W / 2 + T, minZ: O.z - D / 2, maxZ: O.z - D / 2 + 3.4 },
      { minX: O.x + W / 2 - T, maxX: O.x + W / 2 + T, minZ: O.z + D / 2 - 4.4, maxZ: O.z + D / 2 },
    );

    // doorway trim + open door
    const trim = std(0x3c3026, 0.85);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.5, 0.16), trim).translateX(W / 2 + 0.05).translateY(1.25).translateZ(-1.1));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.5, 0.16), trim).translateX(W / 2 + 0.05).translateY(1.25).translateZ(1.3));
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 1.5), std(0x4b3524, 0.75));
    door.position.set(W / 2 + 0.6, 1.2, -1.6);
    door.rotation.y = -1.1;
    g.add(door);

    // exterior windows
    const paneGeo = new THREE.PlaneGeometry(1.5, 1.7);
    const putWindow = (x: number, z: number, ry: number) => {
      const p = new THREE.Mesh(paneGeo, winMat);
      p.position.set(x, 2.3, z); p.rotation.y = ry; g.add(p);
      const p2 = new THREE.Mesh(paneGeo, winMat);
      p2.position.set(x - Math.sin(ry) * 0.34, 2.3, z - Math.cos(ry) * 0.34);
      p2.rotation.y = ry + Math.PI; g.add(p2);
      const f = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.95, 0.12), trim);
      f.position.set(x, 2.3, z); f.rotation.y = ry; g.add(f);
    };
    putWindow(W / 2 + 0.17, 3.4, Math.PI / 2);
    putWindow(-W / 2 - 0.17, -1.5, -Math.PI / 2);
    putWindow(-W / 2 - 0.17, 2.6, -Math.PI / 2);
    putWindow(2.5, -D / 2 - 0.17, Math.PI);
    putWindow(-3.5, D / 2 + 0.17, 0);

    // roof (hidden while the player is inside)
    const roofMat = std(0x2c2a30, 0.86);
    const shape = new THREE.Shape();
    shape.moveTo(-(W + 1.2) / 2, 0); shape.lineTo((W + 1.2) / 2, 0); shape.lineTo(0, 3.0); shape.closePath();
    const rgeo = new THREE.ExtrudeGeometry(shape, { depth: D + 1.2, bevelEnabled: false });
    rgeo.translate(0, 0, -(D + 1.2) / 2);
    const roof = new THREE.Mesh(rgeo, roofMat);
    roof.position.y = H; roof.castShadow = true;
    this.houseRoof.add(roof);
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), MAT.stone());
    chim.position.set(-3, H + 2.2, -3); this.houseRoof.add(chim);
    g.add(this.houseRoof);

    // porch outside the door
    const porch = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 5), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.9 }));
    porch.position.set(W / 2 + 1.3, 0.15, 0); porch.receiveShadow = true;
    g.add(porch); this.floors.push(porch);
    for (const z of [-2.2, 2.2]) {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.0, 0.2), trim).translateX(W / 2 + 2.4).translateY(1.6).translateZ(z));
    }
    const canopyShape = new THREE.Shape();
    canopyShape.moveTo(-1.7, 0); canopyShape.lineTo(1.7, 0); canopyShape.lineTo(0, 0.85); canopyShape.closePath();
    const canopyGeo = new THREE.ExtrudeGeometry(canopyShape, { depth: 5.4, bevelEnabled: false });
    canopyGeo.rotateY(Math.PI / 2);
    canopyGeo.translate(0, 0, 2.7);
    const canopy = new THREE.Mesh(canopyGeo, roofMat);
    canopy.position.set(W / 2 + 1.4, 3.1, 0); canopy.castShadow = true; g.add(canopy);

    // ---- interior dressing
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 4.2), std(0x4a2f2c, 0.98));
    rug.rotation.x = -Math.PI / 2; rug.position.set(-1.8, 0.09, -1.2); g.add(rug);

    // dining table + chairs
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 1.7), MAT.wood());
    tableTop.position.set(-2.5, 0.82, -1.5); tableTop.castShadow = true; g.add(tableTop);
    for (const [cx, cz] of [[-3.7, -2.2], [-1.3, -2.2], [-3.7, -0.8], [-1.3, -0.8]] as [number, number][]) {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.76, 0.12), MAT.wood()).translateX(cx).translateY(0.38).translateZ(cz));
    }
    this.boxes.push(boxFrom(O.x - 2.5, O.z - 1.5, 3.1, 1.9));
    const chair = (x: number, z: number, ry: number) => {
      const c = new THREE.Group();
      c.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), MAT.wood()).translateY(0.46));
      c.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.07), MAT.wood()).translateY(0.82).translateZ(-0.22));
      for (const [ox, oz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as [number, number][]) {
        c.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.06), MAT.wood()).translateX(ox).translateY(0.23).translateZ(oz));
      }
      c.position.set(x, 0.05, z); c.rotation.y = ry;
      g.add(c);
    };
    chair(-2.5, -2.9, 0); chair(-2.5, -0.1, Math.PI); chair(-4.4, -1.5, Math.PI / 2); chair(-0.6, -1.5, -Math.PI / 2);

    // a cup and a plate left on the table
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.16, 10), std(0xa9a094, 0.5));
    cup.position.set(-1.7, 0.96, -1.2); g.add(cup);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 14), std(0xb4aca0, 0.45));
    plate.position.set(-3.2, 0.9, -1.7); g.add(plate);

    // bookshelf
    const shelf = new THREE.Group();
    shelf.add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.4, 0.4), MAT.wood()).translateY(1.2));
    const bookMat = std(0x5a4a44, 0.92);
    const books: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      for (let b = 0; b < 9; b++) {
        const bk = new THREE.Mesh(new THREE.BoxGeometry(0.11, this.rng.range(0.26, 0.38), 0.26), bookMat);
        bk.position.set(-0.78 + b * 0.18, 0.5 + i * 0.72 + 0.16, 0.06);
        books.push(bk);
      }
    }
    shelf.add(mergeMeshes(books, bookMat));
    shelf.position.set(-5.0, 0, 3.6); shelf.rotation.y = Math.PI / 2;
    g.add(shelf);
    this.boxes.push(boxFrom(O.x - 5.0, O.z + 3.6, 0.9, 2.1));

    // sofa
    const sofa = new THREE.Group();
    sofa.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.0), std(0x3d4550, 0.98)).translateY(0.4));
    sofa.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.28), std(0x39414b, 0.98)).translateY(0.75).translateZ(-0.4));
    sofa.position.set(0.5, 0, 3.8); sofa.rotation.y = Math.PI;
    g.add(sofa);
    this.boxes.push(boxFrom(O.x + 0.5, O.z + 3.8, 2.8, 1.3));

    // the clock, stopped
    const clockG = new THREE.Group();
    clockG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 20), MAT.wood()).rotateX(Math.PI / 2));
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.52, 24), std(0xd9cfbc, 0.6));
    face.position.z = 0.09; clockG.add(face);
    const handMat = std(0x14100c, 0.6);
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.02), handMat);
    hh.position.set(0, 0, 0.11); clockG.add(hh);
    const mh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.44, 0.02), handMat);
    mh.position.set(0, 0, 0.12); clockG.add(mh);
    for (let i = 0; i < 12; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.01), handMat);
      const a = (i / 12) * Math.PI * 2;
      tick.position.set(Math.sin(a) * 0.44, Math.cos(a) * 0.44, 0.1);
      tick.rotation.z = -a;
      clockG.add(tick);
    }
    clockG.position.set(-W / 2 + 0.22, 2.6, 1.5);
    clockG.rotation.y = Math.PI / 2;
    g.add(clockG);
    this.clockHands = { h: hh, m: mh };
    this.setClock(11, 47);

    // framed photographs
    for (const [px, pz, ry] of [[-W / 2 + 0.2, -2.0, Math.PI / 2], [-W / 2 + 0.2, -3.4, Math.PI / 2], [1.2, -D / 2 + 0.2, 0]] as [number, number, number][]) {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.06), MAT.wood());
      fr.position.set(px, 2.5, pz); fr.rotation.y = ry;
      const im = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.38), std(0x8a8072, 0.8));
      im.position.copy(fr.position); im.rotation.y = ry;
      im.position.add(new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(0.04));
      g.add(fr); g.add(im);
    }

    // child's corner: small bed and toys
    const bed = new THREE.Group();
    bed.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 1.9), MAT.wood()).translateY(0.3));
    bed.add(new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.16, 1.8), std(0x5c6470, 0.98)).translateY(0.52));
    bed.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.16, 0.4), std(0xbfb6a6, 0.95)).translateY(0.6).translateZ(-0.68));
    bed.position.set(-4.6, 0, -4.0);
    g.add(bed);
    this.boxes.push(boxFrom(O.x - 4.6, O.z - 4.0, 1.3, 2.1));
    for (let i = 0; i < 5; i++) {
      const toy = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22),
        std(this.rng.pick([0xa85f4a, 0x4a6ba8, 0xa8974a]), 0.9));
      toy.position.set(this.rng.range(-3.6, -2.2), 0.16, this.rng.range(-4.6, -3.2));
      toy.rotation.y = this.rng.range(0, 3);
      g.add(toy);
    }
    // a child's drawing pinned to the wall
    const draw = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.66), std(0xd8cdb6, 0.9));
    draw.position.set(-W / 2 + 0.19, 1.9, -4.2); draw.rotation.y = Math.PI / 2;
    g.add(draw);
    // shoes by the door
    for (const dz of [-0.2, 0.15]) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.34), std(0x2b241d, 0.95));
      sh.position.set(W / 2 - 1.0, 0.13, dz); g.add(sh);
    }
    // hallway: coat hooks, a side table, a broken umbrella
    const hookRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 1.5), trim);
    hookRail.position.set(W / 2 - 0.5, 2.1, 3.6); g.add(hookRail);
    for (let i = 0; i < 3; i++) {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), MAT.metal(0x6a5c3e))
        .translateX(W / 2 - 0.62).translateY(2.02).translateZ(3.1 + i * 0.5));
    }
    const coat = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.42), std(0x3d4b5c, 0.95));
    coat.position.set(W / 2 - 0.66, 1.45, 3.35); g.add(coat);
    const sideTop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 1.1), MAT.wood());
    sideTop.position.set(W / 2 - 0.6, 0.85, 1.2); g.add(sideTop);
    for (const [sx, sz] of [[-0.18, -0.45], [0.18, -0.45], [-0.18, 0.45], [0.18, 0.45]] as [number, number][]) {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.82, 0.06), MAT.wood())
        .translateX(W / 2 - 0.6 + sx).translateY(0.41).translateZ(1.2 + sz));
    }
    const keys = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.14), MAT.metal(0x8a7448));
    keys.position.set(W / 2 - 0.6, 0.91, 1.0); g.add(keys);
    const brolly = new THREE.Group();
    brolly.add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.0, 6), MAT.metal(0x3a3f46)));
    const brollyTop = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 7), std(0x2c3540, 0.9));
    brollyTop.position.y = 0.55; brolly.add(brollyTop);
    brolly.position.set(W / 2 - 0.75, 0.55, 2.2); brolly.rotation.z = 0.22; g.add(brolly);
    // a standing lamp in the corner of the living room
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.06, 12), MAT.metal(0x4a4238))
      .translateX(-4.6).translateY(0.05).translateZ(4.4));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), MAT.metal(0x4a4238))
      .translateX(-4.6).translateY(0.8).translateZ(4.4));
    const shadeH = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.42, 12, 1, true), winMat);
    shadeH.position.set(-4.6, 1.72, 4.4);
    (shadeH.material as THREE.Material).side = THREE.DoubleSide;
    g.add(shadeH);

    this.houseInteriorLight = new THREE.PointLight(0xffb267, 0, 14, 2);
    this.houseInteriorLight.position.set(-1.5, 3.4, 0);
    g.add(this.houseInteriorLight);

    // light station 1 in the front garden
    this.addLightStation(P.station1, 0);

    // garden dressing outside
    const fence = makeFence(9, this.rng);
    fence.position.set(O.x + 8.2, 0, O.z);
    fence.rotation.y = Math.PI / 2;
    this.townProps.add(fence);
    const tree = makeTree(this.rng, 1.3);
    tree.position.set(O.x + 1, 0, O.z - 8.4);
    this.townProps.add(tree); this.sway.push(tree);
    const fl = makeFlowers(this.rng); fl.position.set(O.x + 7.2, 0, O.z + 3); this.townProps.add(fl);
    const mb = makeMailbox(); mb.position.set(O.x + 8.0, 0, O.z - 3.4); this.townProps.add(mb);
  }

  private teaseLevel = 0;
  /** One window, in one house, for a second and a half. */
  teaseWindow(level: number) {
    this.teaseLevel = level;
  }

  /** The rain stops, and the street dries. */
  dryOut() {
    for (const p of this.puddles) p.visible = false;
    for (const m of [this.surf]) (m.material as THREE.MeshBasicMaterial).opacity = 0.1;
  }

  setClock(h: number, m: number) {
    this.clockHands.h.rotation.z = -((h % 12) + m / 60) * (Math.PI * 2) / 12;
    this.clockHands.h.position.set(Math.sin(-this.clockHands.h.rotation.z) * 0.15, Math.cos(this.clockHands.h.rotation.z) * 0.15, 0.11);
    this.clockHands.m.rotation.z = -(m / 60) * Math.PI * 2;
    this.clockHands.m.position.set(Math.sin(-this.clockHands.m.rotation.z) * 0.22, Math.cos(this.clockHands.m.rotation.z) * 0.22, 0.12);
  }

  // ---------------------------------------------------------- train station

  private buildStationArea() {
    const g = new THREE.Group();
    this.root.add(g);
    this.blockers.push(g);

    const platMat = new THREE.MeshStandardMaterial({ color: 0x33353b, roughness: 0.45, metalness: 0.15 });
    const plat = new THREE.Mesh(new THREE.BoxGeometry(26, 0.9, 13), platMat);
    plat.position.set(0, 0.45, -44);
    plat.receiveShadow = true;
    g.add(plat);
    this.floors.push(plat);
    // yellow safety line
    const line = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.35), std(0x8a7a3a, 0.6));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.92, -49.4);
    g.add(line);

    // ramp up from the street
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(7, 0.9, 4.6), platMat);
    ramp.position.set(0, 0.45, -35.4);
    ramp.rotation.x = -0.19;
    ramp.receiveShadow = true;
    g.add(ramp);
    this.floors.push(ramp);

    // wet reflective sheen on the platform
    const wet = new THREE.Mesh(new THREE.PlaneGeometry(25, 12), new THREE.MeshStandardMaterial({
      color: 0x172029, roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.5,
    }));
    wet.rotation.x = -Math.PI / 2; wet.position.set(0, 0.915, -44);
    g.add(wet);

    // canopy
    const postMat = MAT.metal(0x2a2e35);
    for (const x of [-9, -3, 3, 9]) {
      for (const z of [-40.5, -47]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.8, 8), postMat);
        p.position.set(x, 2.8, z); p.castShadow = true; g.add(p);
        this.boxes.push(boxFrom(x, z, 0.5, 0.5));
      }
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(22, 0.28, 9.5), std(0x23262c, 0.7));
    roof.position.set(0, 4.85, -43.8); roof.castShadow = true; g.add(roof);
    for (let i = 0; i < 6; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.4, 9.5), postMat);
      beam.position.set(-9 + i * 3.6, 4.6, -43.8); g.add(beam);
    }

    // hanging platform lamps
    for (const x of [-7, 0, 7]) {
      const l = makeStreetlight(this.lamps, 0xffd2a0);
      l.scale.set(0.001, 0.001, 0.001);
      const spec = this.lamps[this.lamps.length - 1];
      spec.pos.set(x, 4.3, -43.8);
      spec.intensity = 11; spec.distance = 15;
      this.zones[1].lamps.push(spec);
      g.add(l);
      // visible fixture
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.5, 10, 1, true), MAT.metal(0x2b3038));
      shade.position.set(x, 4.35, -43.8); shade.material.side = THREE.DoubleSide; g.add(shade);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 5), postMat).translateX(x).translateY(4.66).translateZ(-43.8));
      const bulbMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, emissive: new THREE.Color(0xffd2a0), emissiveIntensity: 0 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), bulbMat);
      bulb.position.set(x, 4.14, -43.8); g.add(bulb);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xffd2a0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.set(3.6, 3.6, 1); glow.position.set(x, 4.14, -43.8); g.add(glow);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({
        map: glowTexture(), color: 0xffd2a0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.94, -43.8); g.add(pool);
      spec.glow = glow; spec.pool = pool; spec.bulb = bulbMat;
    }

    // benches, signs, luggage
    for (const x of [-6, 6]) {
      const b = makeBench(); b.position.set(x, 0.9, -41.6); g.add(b);
      this.boxes.push(boxFrom(x, -41.6, 2, 1.2));
    }
    const stationSign = makeSign('station');
    stationSign.position.set(-11, 0.9, -41); g.add(stationSign);
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 0.14), std(0x2a3037, 0.6));
    board.position.set(9.5, 3.0, -40.4); g.add(board);
    const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.05), new THREE.MeshStandardMaterial({
      color: 0x0e1319, emissive: new THREE.Color(0x2c4358), emissiveIntensity: 0.35, roughness: 0.5,
    }));
    boardFace.position.set(9.5, 3.0, -40.32); g.add(boardFace);
    const rowMat = new THREE.MeshStandardMaterial({
      color: 0x0d1116, emissive: new THREE.Color(0x7f8f9c), emissiveIntensity: 0.5, roughness: 0.6,
    });
    for (let i = 0; i < 4; i++) {
      const row = new THREE.Mesh(new THREE.PlaneGeometry(2.2 - i * 0.2, 0.09), rowMat);
      row.position.set(9.1 - i * 0.06, 3.35 - i * 0.22, -40.3); g.add(row);
    }
    for (let i = 0; i < 3; i++) {
      const c = makeCrate(this.rng);
      c.position.set(this.rng.range(8, 11), 0.9 + 0.3, this.rng.range(-47, -43));
      g.add(c);
    }
    const bin = makeBin(); bin.position.set(-9.6, 0.9, -46.5); g.add(bin);

    // an abandoned umbrella
    const um = new THREE.Group();
    um.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), MAT.metal(0x3a3f46)));
    const canopyU = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.3, 8), std(0x2c3540, 0.9));
    canopyU.position.y = 0.5; um.add(canopyU);
    um.position.set(4.2, 1.2, -47.4); um.rotation.z = 1.35; g.add(um);

    // rails
    const railMat = MAT.metal(0x545a60);
    const sleeperMat = std(0x2f281f, 0.96);
    const ballast = new THREE.Mesh(new THREE.BoxGeometry(120, 0.3, 6), std(0x33322c, 0.98));
    ballast.position.set(0, 0.14, -54.5); ballast.receiveShadow = true; g.add(ballast);
    for (const z of [-53.2, -55.8]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(120, 0.16, 0.14), railMat);
      r.position.set(0, 0.36, z); g.add(r);
    }
    const sleepers: THREE.Mesh[] = [];
    for (let x = -58; x < 58; x += 1.7) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 3.4), sleeperMat);
      sl.position.set(x, 0.28, -54.5); sleepers.push(sl);
    }
    g.add(mergeMeshes(sleepers, sleeperMat));

    // signal
    const sig = new THREE.Group();
    sig.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 4.4, 7), MAT.metal(0x2c3138)).translateY(2.2));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.0, 0.3), std(0x1c2026, 0.6));
    head.position.y = 4.4; sig.add(head);
    const redMat = new THREE.MeshStandardMaterial({ color: 0x2a0a0a, emissive: new THREE.Color(0xff3820), emissiveIntensity: 1.6 });
    const redLamp = new THREE.Mesh(new THREE.CircleGeometry(0.13, 10), redMat);
    redLamp.position.set(0, 4.6, 0.17); sig.add(redLamp);
    sig.position.set(-14, 0, -51.5); g.add(sig);

    // level crossing to reach the shore
    const cross = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 8), std(0x35363a, 0.85));
    cross.position.set(17, 0.2, -54.5); g.add(cross);
    this.floors.push(cross);

    this.addLightStation(P.station2, 1);
  }

  // ------------------------------------------------------------------ beach

  private buildBeach() {
    const g = new THREE.Group();
    this.root.add(g);

    const t = sandTexture().clone(); t.needsUpdate = true; t.repeat.set(14, 8);
    const geo = new THREE.PlaneGeometry(180, 60, 90, 30);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const k = THREE.MathUtils.clamp((z + 30) / 60, 0, 1); // 0 at far edge
      pos.setY(i, -1.5 * (1 - k) + Math.sin(pos.getX(i) * 0.3) * 0.06);
    }
    geo.computeVertexNormals();
    const sand = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, color: 0x7a6d56, roughness: 0.88 }));
    sand.position.set(0, 0, -75);
    sand.receiveShadow = true;
    g.add(sand);
    this.floors.push(sand);

    // wet sand strip, mirror-ish
    const wet = new THREE.Mesh(new THREE.PlaneGeometry(180, 16), new THREE.MeshStandardMaterial({
      color: 0x1a222c, roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.6,
    }));
    wet.rotation.x = -Math.PI / 2; wet.position.set(0, -0.82, -90);
    g.add(wet);

    // rocks and sea grass
    for (let i = 0; i < 30; i++) {
      const r = makeRock(this.rng, this.rng.range(0.5, 2.2));
      const x = this.rng.range(-70, 70);
      if (Math.abs(x) < 7) continue;
      r.position.set(x, this.rng.range(-1.0, -0.1), this.rng.range(-95, -62));
      g.add(r);
    }
    for (let i = 0; i < 10; i++) {
      const b = makeBush(this.rng);
      b.position.set(this.rng.range(-60, 60), -0.1, this.rng.range(-64, -58));
      b.scale.setScalar(0.8);
      g.add(b);
    }
    for (let i = 0; i < 4; i++) {
      const c = makeCrate(this.rng);
      c.position.set(this.rng.range(-12, 14), -0.4, this.rng.range(-72, -66));
      g.add(c);
    }
    // driftwood
    for (let i = 0; i < 7; i++) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, this.rng.range(1.2, 2.8), 6), MAT.wood());
      d.rotation.set(Math.PI / 2, this.rng.range(0, 3), this.rng.range(0, 3));
      d.position.set(this.rng.range(-40, 40), -0.7, this.rng.range(-88, -76));
      g.add(d);
    }

    // ---- pier
    const pierMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.88 });
    const pm = (pierMat.map as THREE.Texture).clone(); pm.needsUpdate = true; pm.repeat.set(2, 18);
    pierMat.map = pm;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 44), pierMat);
    deck.position.set(0, 1.25, -90);
    deck.receiveShadow = true; deck.castShadow = true;
    g.add(deck); this.floors.push(deck);

    // approach ramp from the sand
    const app = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 8), pierMat);
    app.position.set(0, 0.55, -66.4);
    app.rotation.x = 0.2;
    g.add(app); this.floors.push(app);

    const pierWood = MAT.wood();
    const pierParts: THREE.Mesh[] = [];
    for (let z = -69; z > -111; z -= 4) {
      for (const x of [-2.1, 2.1]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.5, 7), pierWood);
        pile.position.set(x, -0.9, z);
        pierParts.push(pile);
      }
      for (const x of [-2.35, 2.35]) {
        pierParts.push(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), pierWood)
          .translateX(x).translateY(1.9).translateZ(z) as THREE.Mesh);
      }
    }
    for (const x of [-2.35, 2.35]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 44), pierWood);
      rail.position.set(x, 2.36, -90); pierParts.push(rail);
      this.boxes.push({ minX: x - 0.4, maxX: x + 0.4, minZ: -112, maxZ: -68 });
    }
    g.add(mergeMeshes(pierParts, pierWood, true));

    // pier lamps
    for (const z of [-76, -88, -100]) {
      const spec: LampSpec = {
        pos: new THREE.Vector3(0, 3.2, z), color: 0xffb877, intensity: 8, distance: 13,
        power: 0, flicker: Math.random() * 9,
      };
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 6), MAT.metal(0x2a2e35));
      post.position.set(2.3, 2.6, z); g.add(post);
      const bulbMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, emissive: new THREE.Color(0xffb877), emissiveIntensity: 0 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bulbMat);
      bulb.position.set(2.3, 3.9, z); g.add(bulb);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xffb877, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.set(3.4, 3.4, 1); glow.position.copy(bulb.position); g.add(glow);
      spec.pos.copy(bulb.position);
      spec.glow = glow; spec.bulb = bulbMat;
      this.lamps.push(spec);
      this.zones[2].lamps.push(spec);
    }

    this.addLightStation(P.station3, 2);
  }

  // ------------------------------------------------------------- lighthouse

  private buildLighthouse() {
    const g = new THREE.Group();
    g.position.copy(P.lighthouse);
    this.root.add(g);
    this.blockers.push(g);
    this.lighthouseGroup = g;

    // rock the tower stands on
    const base = new THREE.Mesh(new THREE.CylinderGeometry(13, 17, 5, 12, 1), std(0x33322e, 0.98));
    base.position.y = -1.6; base.receiveShadow = true; base.castShadow = true;
    g.add(base);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(12.6, 12.6, 0.4, 24), std(0x3a3833, 0.95));
    cap.position.y = 1.0; cap.receiveShadow = true;
    g.add(cap); this.floors.push(cap);
    for (let i = 0; i < 14; i++) {
      const r = makeRock(this.rng, this.rng.range(1, 3));
      const a = this.rng.range(0, Math.PI * 2);
      r.position.set(Math.sin(a) * this.rng.range(11, 16), this.rng.range(-1, 0.8), Math.cos(a) * this.rng.range(11, 16));
      g.add(r);
    }
    // connect the pier to the rock
    const link = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 8), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.9 }));
    link.position.set(0, 1.25, 10);
    g.add(link); this.floors.push(link);
    const stepMat = std(0x3a3833, 0.95);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 1.2), stepMat);
      s.position.set(0, 1.2 - i * 0.07, 5.6 - i * 1.2);
      g.add(s); this.floors.push(s);
    }

    const stone = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.9 });
    const sm = (stone.map as THREE.Texture).clone(); sm.needsUpdate = true; sm.repeat.set(4, 7);
    stone.map = sm;
    const stoneIn = new THREE.MeshStandardMaterial({ map: sm, roughness: 0.95, side: THREE.BackSide, color: 0x8f8578 });

    const doorArc = 0.42;   // half-angle of the doorway, facing +Z
    // lower shell with the doorway gap
    const lowH = 4.2;
    const outLow = new THREE.Mesh(new THREE.CylinderGeometry(LH.r, LH.r + 0.5, lowH, 40, 1, true, doorArc, Math.PI * 2 - doorArc * 2), stone);
    outLow.position.y = 1.2 + lowH / 2; outLow.castShadow = true; g.add(outLow);
    const inLow = new THREE.Mesh(new THREE.CylinderGeometry(LH.r - 0.45, LH.r - 0.05, lowH, 40, 1, true, doorArc, Math.PI * 2 - doorArc * 2), stoneIn);
    inLow.position.y = 1.2 + lowH / 2; g.add(inLow);

    // upper shell
    const upH = LH.h - lowH;
    const out = new THREE.Mesh(new THREE.CylinderGeometry(LH.r - 0.7, LH.r, upH, 40, 1, true), stone);
    out.position.y = 1.2 + lowH + upH / 2; out.castShadow = true; g.add(out);
    const inn = new THREE.Mesh(new THREE.CylinderGeometry(LH.r - 1.1, LH.r - 0.45, upH, 40, 1, true), stoneIn);
    inn.position.y = 1.2 + lowH + upH / 2; g.add(inn);

    // painted band
    const band = new THREE.Mesh(new THREE.CylinderGeometry(LH.r - 0.28, LH.r - 0.18, 3.2, 40, 1, true), std(0x8d3a33, 0.85));
    band.position.y = 1.2 + 13; g.add(band);

    this.rings.push({ cx: P.lighthouse.x, cz: P.lighthouse.z, r: LH.r - 0.55, doorAngle: 0, doorHalf: 0.34, doorOpenBelowY: 3.6 });
    this.rings.push({ cx: P.lighthouse.x, cz: P.lighthouse.z, r: 1.55, doorAngle: 0, doorHalf: 0, doorOpenBelowY: -99, inside: true });

    // door, closed until the third station is lit
    const doorGeo = new THREE.BoxGeometry(2.6, 3.1, 0.28);
    this.lighthouseDoorMesh = new THREE.Mesh(doorGeo, new THREE.MeshStandardMaterial({
      map: woodTexture(), roughness: 0.85, color: 0x6a5641,
    }));
    this.lighthouseDoorMesh.position.set(0, 2.7, LH.r - 0.1);
    g.add(this.lighthouseDoorMesh);
    this.doorBox = boxFrom(P.lighthouse.x, P.lighthouse.z + LH.r - 0.1, 3.0, 0.9);
    this.boxes.push(this.doorBox);

    // ---- spiral ramp
    const turns = 3.0, segs = 340, rIn = 1.55, rOut = LH.r - 0.55;
    const rampTop = LAMP_Y - 0.15;
    const aRise = 0.82 * turns * Math.PI * 2;          // climbing ends here
    const aMax = turns * Math.PI * 2 + 3.42;           // then a full flat landing ring
    const rampY = (a: number) => 1.35 + Math.min(1, a / aRise) * (rampTop - 1.35);
    const vs: number[] = [], ns: number[] = [], uvs: number[] = [], idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = t * aMax;
      const y = rampY(a);
      vs.push(Math.sin(a) * rIn, y, Math.cos(a) * rIn);
      vs.push(Math.sin(a) * rOut, y, Math.cos(a) * rOut);
      ns.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, t * 26, 1, t * 26);
      if (i < segs) {
        const b = i * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const rampGeo = new THREE.BufferGeometry();
    rampGeo.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3));
    rampGeo.setAttribute('normal', new THREE.Float32BufferAttribute(ns, 3));
    rampGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    rampGeo.setIndex(idx);
    const rampMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.9, side: THREE.DoubleSide });
    const ramp = new THREE.Mesh(rampGeo, rampMat);
    ramp.receiveShadow = true;
    g.add(ramp);
    this.floors.push(ramp);

    // central column + railing posts
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, LH.h, 14), std(0x4a453d, 0.95));
    col.position.y = 1.2 + LH.h / 2; g.add(col);
    const postMatLh = MAT.metal(0x52585f);
    const rampPosts: THREE.Mesh[] = [];
    for (let i = 0; i <= 34; i++) {
      const a = (i / 34) * aMax;
      const y = rampY(a);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.92, 5), postMatLh);
      p.position.set(Math.sin(a) * (rIn + 0.12), y + 0.46, Math.cos(a) * (rIn + 0.12));
      rampPosts.push(p);
    }
    g.add(mergeMeshes(rampPosts, postMatLh));

    // small windows up the tower
    const winMat = windowMaterial('#ffce93', 1, 2);
    this.zones[2].windows.push(winMat);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * turns * Math.PI * 2 + 1.2;
      const y = 4 + i * 3.6;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.3), winMat);
      w.position.set(Math.sin(a) * (LH.r - 0.05), y, Math.cos(a) * (LH.r - 0.05));
      w.lookAt(new THREE.Vector3(Math.sin(a) * 40, y, Math.cos(a) * 40));
      g.add(w);
    }

    // ---- lamp room
    const gallery = new THREE.Mesh(new THREE.RingGeometry(LH.r - 0.75, 5.0, 32), MAT.metal(0x35393f));
    gallery.rotation.x = -Math.PI / 2;
    gallery.position.y = LAMP_Y - 0.16; (gallery.material as THREE.Material).side = THREE.DoubleSide;
    g.add(gallery);
    const galleryLip = new THREE.Mesh(new THREE.CylinderGeometry(5.0, 5.0, 0.3, 32, 1, true), MAT.metal(0x2f3339));
    galleryLip.position.y = LAMP_Y - 0.3; (galleryLip.material as THREE.Material).side = THREE.DoubleSide;
    g.add(galleryLip);
    // cap over the central column, level with the landing
    const colCap = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.22, 20), MAT.metal(0x3c4046));
    colCap.position.y = LAMP_Y - 0.26; g.add(colCap);
    this.floors.push(colCap);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 5), MAT.metal(0x3a3f46))
        .translateX(Math.sin(a) * 4.85).translateY(LAMP_Y + 0.4).translateZ(Math.cos(a) * 4.85));
    }
    const glassRing = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 3.4, 16, 1, true), new THREE.MeshStandardMaterial({
      color: 0x8fb6d8, transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0.5, side: THREE.DoubleSide,
    }));
    glassRing.position.y = LAMP_Y + 1.9; g.add(glassRing);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.4, 0.12), MAT.metal(0x2e3239))
        .translateX(Math.sin(a) * 3.2).translateY(LAMP_Y + 1.9).translateZ(Math.cos(a) * 3.2));
    }
    const capRoof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 2.2, 16), MAT.metal(0x2c3037));
    capRoof.position.y = LAMP_Y + 4.4; g.add(capRoof);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), MAT.metal(0x6a5d3c)).translateY(LAMP_Y + 5.7));

    // the mechanism the player repairs
    const mech = new THREE.Group();
    mech.add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 0.5, 12), MAT.metal(0x4a4238)));
    mech.add(new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 6, 20), MAT.metal(0x6a5c3e)).translateY(0.5).rotateX(Math.PI / 2));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      mech.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), MAT.metal(0x5a5040))
        .translateX(Math.sin(a) * 0.85).translateY(1.1).translateZ(Math.cos(a) * 0.85));
    }
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1e, emissive: new THREE.Color(0xffcf94), emissiveIntensity: 0,
      roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85,
    });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 14), lensMat);
    lens.position.y = 1.5; mech.add(lens);
    mech.position.set(0, LAMP_Y - 0.15, 0);
    g.add(mech);
    this.lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffcf94, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.lampGlow.scale.set(26, 26, 1);
    this.lampGlow.position.set(0, LAMP_Y + 1.35, 0);
    g.add(this.lampGlow);
    (mech.userData as { lens: THREE.MeshStandardMaterial }).lens = lensMat;
    this.lensMat = lensMat;

    // the old lantern waiting at the top, with its inscription plate
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.62), std(0x4b4d52, 0.9));
    plinth.position.set(2.4, LAMP_Y + 0.22, 1.1); plinth.castShadow = true; g.add(plinth);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), std(0x8d7c52, 0.45, 0.6));
    plate.position.set(2.4, LAMP_Y + 0.3, 1.42); g.add(plate);

    // the sweeping beam
    this.beamPivot.position.set(0, LAMP_Y + 1.35, 0);
    g.add(this.beamPivot);
    const beamGeo = new THREE.ConeGeometry(11, 190, 24, 1, true);
    beamGeo.translate(0, -95, 0);
    beamGeo.rotateX(Math.PI / 2);
    this.beamCone = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: 0xffca8a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    this.beamPivot.add(this.beamCone);
    this.beamLight = new THREE.SpotLight(0xffcf9a, 0, 320, 0.095, 0.65, 0.0);
    this.beamLight.position.set(0, 0, 0);
    this.beamLight.target.position.set(0, -6, -100);
    this.beamPivot.add(this.beamLight);
    this.beamPivot.add(this.beamLight.target);

    // top-of-tower warm light
    this.topLight = new THREE.PointLight(0xffbb77, 0, 20, 2);
    this.topLight.position.set(0, LAMP_Y + 0.9, 0);
    g.add(this.topLight);
  }

  lighthouseGroup!: THREE.Group;
  lensMat!: THREE.MeshStandardMaterial;
  topLight!: THREE.PointLight;

  openLighthouseDoor() {
    const i = this.boxes.indexOf(this.doorBox);
    if (i >= 0) this.boxes.splice(i, 1);
    this.lighthouseDoorMesh.userData.opening = true;
  }

  // -------------------------------------------------------- light stations

  stations: Array<{ group: THREE.Group; lens: THREE.MeshStandardMaterial; glow: THREE.Sprite; light: THREE.PointLight; on: boolean; level: number }> = [];

  private addLightStation(pos: THREE.Vector3, index: number) {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.scale.setScalar(0.85);
    this.root.add(g);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 1.0), MAT.stone()).translateY(0.12));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 1.5, 8), MAT.metal(0x3b4048));
    body.position.y = 0.95; body.castShadow = true; g.add(body);
    for (let i = 0; i < 3; i++) {
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 5, 12), MAT.metal(0x565c66))
        .translateY(0.5 + i * 0.45).rotateX(Math.PI / 2));
    }
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x14161a, emissive: new THREE.Color(0xffc07a), emissiveIntensity: 0,
      roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.92,
    });
    const lens = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), lensMat);
    lens.position.y = 1.95; g.add(lens);
    // open cage: bars, not a wall, so the lens can actually be seen
    const cageMat = MAT.metal(0x4a505a);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), cageMat)
        .translateX(Math.sin(a) * 0.4).translateY(1.95).translateZ(Math.cos(a) * 0.4));
    }
    for (const ry of [1.52, 2.38]) {
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 5, 12), cageMat)
        .translateY(ry).rotateX(Math.PI / 2));
    }
    g.add(new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.35, 8), MAT.metal(0x353a42)).translateY(2.55));
    // lever
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), MAT.metal(0x6a5c3e));
    lever.position.set(0.42, 1.1, 0); lever.rotation.z = -0.9; g.add(lever);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffc07a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(5, 5, 1); glow.position.y = 1.95; g.add(glow);

    const light = new THREE.PointLight(0xffc07a, 0, 16, 2);
    light.position.y = 1.95; g.add(light);

    this.boxes.push(boxFrom(pos.x, pos.z, 1.1, 1.1));
    this.stations[index] = { group: g, lens: lensMat, glow, light, on: false, level: 0 };
  }

  activateStation(i: number) {
    const s = this.stations[i];
    if (s) s.on = true;
  }

  // ------------------------------------------------------------------ grass

  private buildGrass() {
    const blade = new THREE.PlaneGeometry(0.075, 0.5);
    blade.translate(0, 0.275, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x38492c, roughness: 1, side: THREE.DoubleSide,
    });
    const uni = { uTime: { value: 0 } };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uni.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float wy = max(position.y, 0.0);
          float ph = instanceMatrix[3][0] * 0.6 + instanceMatrix[3][2] * 0.4;
          transformed.x += sin(uTime * 1.7 + ph) * 0.13 * wy;
          transformed.z += cos(uTime * 1.3 + ph * 1.3) * 0.09 * wy;`);
    };
    mat.userData.uni = uni;
    this.grassMats.push(mat);

    const count = 4200;
    const im = new THREE.InstancedMesh(blade, mat, count);
    const d = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < count * 3 && n < count; i++) {
      const x = this.rng.range(-42, 42);
      const z = this.rng.range(-62, 76);
      if (Math.abs(x) < 7.2 && z > -34) continue;           // keep the road clear
      if (Math.abs(x) < 14 && z < -34 && z > -58) continue;  // keep the platform clear
      const y = z < -58 ? -0.2 : 0;
      d.position.set(x, y, z);
      d.rotation.set(0, this.rng.range(0, Math.PI), this.rng.range(-0.16, 0.16));
      d.scale.setScalar(this.rng.range(0.7, 1.6));
      d.updateMatrix();
      im.setMatrixAt(n++, d.matrix);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    this.root.add(im);
  }

  // ----------------------------------------------------------------- update

  private tmpV = new THREE.Vector3();

  update(t: number, dt: number) {
    (this.ocean.userData.uniforms as { uTime: { value: number } }).uTime.value = t;
    for (const m of this.grassMats) {
      (m.userData.uni as { uTime: { value: number } }).uTime.value = t;
    }
    (this.surf.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.07 * Math.sin(t * 0.6);
    this.surf.position.z = -88 + Math.sin(t * 0.35) * 2.2;

    // wind sway
    for (const tr of this.sway) {
      tr.rotation.z = Math.sin(t * 0.8 + tr.position.x * 0.3) * 0.018;
      tr.rotation.x = Math.cos(t * 0.62 + tr.position.z * 0.2) * 0.014;
    }
    for (const s of this.swingers) {
      s.rotation.x = Math.sin(t * 1.5 + s.position.x) * 0.09;
    }

    // zone power ramps
    for (const z of this.zones) {
      z.power += (z.target - z.power) * Math.min(1, dt * 1.1);
      for (const l of z.lamps) l.power = z.power;
      for (const w of z.windows) w.emissiveIntensity = z.power * 1.5 * this.glowBoost;
    }
    if (this.teaseLevel > 0) {
      this.houseWindows.emissiveIntensity = Math.max(this.houseWindows.emissiveIntensity, this.teaseLevel);
    }

    // stations
    for (const s of this.stations) {
      if (!s) continue;
      const target = s.on ? 1 : 0;
      s.level += (target - s.level) * Math.min(1, dt * 1.6);
      const flick = 0.9 + 0.1 * Math.sin(t * 5 + s.group.position.x);
      const v = s.level * flick;
      s.lens.emissiveIntensity = v * 5;
      (s.glow.material as THREE.SpriteMaterial).opacity = v * 0.62;
      s.glow.scale.setScalar(4.6 + v * 1.6);
      s.light.intensity = v * 11;
    }

    // lighthouse door swings open
    const d = this.lighthouseDoorMesh;
    if (d.userData.opening) {
      d.rotation.y = THREE.MathUtils.lerp(d.rotation.y, -1.35, Math.min(1, dt * 1.2));
      d.position.x = THREE.MathUtils.lerp(d.position.x, -1.15, Math.min(1, dt * 1.2));
      d.position.z = THREE.MathUtils.lerp(d.position.z, LH.r - 1.1, Math.min(1, dt * 1.2));
    }
    void this.tmpV;
  }

  /** Roof fades away while the player is inside so the interior stays readable. */
  setInsideHouse(inside: boolean, dt: number) {
    const target = inside ? 0 : 1;
    this.houseRoof.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m) return;
      m.transparent = true;
      m.opacity += (target - m.opacity) * Math.min(1, dt * 5);
      m.depthWrite = m.opacity > 0.6;
      (o as THREE.Mesh).visible = m.opacity > 0.02;
    });
  }

  isInsideHouse(p: THREE.Vector3) {
    const O = P.houseInside;
    return Math.abs(p.x - O.x) < 6.2 && Math.abs(p.z - O.z) < 5.8;
  }

  // ------------------------------------------------------------- collision

  groundHeight(x: number, z: number, from: number): number {
    this.ray.set(new THREE.Vector3(x, from + 1.4, z), this.down);
    this.ray.far = 5.5;
    const hits = this.ray.intersectObjects(this.floors, false);
    if (hits.length) return hits[0].point.y;
    // outdoor terrain: town is flat, the shore slopes into the sea
    if (z < -60) {
      const k = THREE.MathUtils.clamp((-z - 60) / 30, 0, 1);
      return -1.5 * k;
    }
    return 0;
  }

  resolve(pos: THREE.Vector3, radius: number) {
    for (const b of this.boxes) {
      const cx = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
      const cz = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        // inside the box: push out along the shallowest axis
        const opts = [
          [b.minX - radius - pos.x, 0], [b.maxX + radius - pos.x, 0],
          [0, b.minZ - radius - pos.z], [0, b.maxZ + radius - pos.z],
        ];
        opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
        pos.x += opts[0][0]; pos.z += opts[0][1];
      }
    }

    for (const r of this.rings) {
      const dx = pos.x - r.cx, dz = pos.z - r.cz;
      const dist = Math.hypot(dx, dz) || 1e-5;
      if (r.inside) {
        if (dist < r.r + radius) {
          const k = (r.r + radius) / dist;
          pos.x = r.cx + dx * k; pos.z = r.cz + dz * k;
        }
        continue;
      }
      const diff = Math.abs(dist - r.r);
      if (diff > radius) continue;
      const ang = Math.atan2(dx, dz);
      let da = Math.abs(ang - r.doorAngle);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < r.doorHalf && pos.y < r.doorOpenBelowY) continue;
      const target = dist > r.r ? r.r + radius : r.r - radius;
      pos.x = r.cx + (dx / dist) * target;
      pos.z = r.cz + (dz / dist) * target;
    }

    // the sea: past the surf you can only go along the pier, and only onto the rock
    if (pos.z < -95) {
      if (pos.z > -111) {
        pos.x = THREE.MathUtils.clamp(pos.x, -2.4, 2.4);
      } else {
        const lx = pos.x - P.lighthouse.x, lz = pos.z - P.lighthouse.z;
        const ld = Math.hypot(lx, lz) || 1e-5;
        if (ld > 11.6 && Math.abs(pos.x) > 2.4) {
          pos.x = P.lighthouse.x + (lx / ld) * 11.6;
          pos.z = P.lighthouse.z + (lz / ld) * 11.6;
        }
      }
    }
    pos.x = THREE.MathUtils.clamp(pos.x, -46, 46);
    pos.z = THREE.MathUtils.clamp(pos.z, -134, 78);
  }
}
