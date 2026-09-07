import * as THREE from 'three';
import { World } from './World';
import { clamp, damp, lerp, std } from './util';

const SKIN = 0xc2a184;
const HOOD = 0x3d4b5c;
const HOOD_DK = 0x334051;
const PANTS = 0x2f3138;
const SHOE = 0x1b1c20;
const HAIR = 0x241a14;

export class Player {
  root = new THREE.Group();
  body = new THREE.Group();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = Math.PI;          // facing
  speed = 0;
  running = false;
  moving = false;
  height = 1.72;
  radius = 0.42;
  handAnchor = new THREE.Group();

  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private forearmL = new THREE.Group();
  private forearmR = new THREE.Group();
  private shinL = new THREE.Group();
  private shinR = new THREE.Group();
  private cycle = 0;
  private targetYaw = Math.PI;

  constructor() {
    this.root.add(this.body);
    this.build();
  }

  private build() {
    const skin = std(SKIN, 0.75);
    const hood = std(HOOD, 0.92);
    const hoodDk = std(HOOD_DK, 0.92);
    const pants = std(PANTS, 0.95);
    const shoe = std(SHOE, 0.7);
    const hair = std(HAIR, 0.95);

    const b = (w: number, h: number, d: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.castShadow = true;
      return mesh;
    };

    // hips at y=0.88, everything hangs off it
    this.hips.position.y = 0.86;
    this.body.add(this.hips);

    // pelvis
    const pelvis = b(0.36, 0.22, 0.24, pants);
    pelvis.position.y = -0.04;
    this.hips.add(pelvis);

    // chest / jacket
    this.chest.position.y = 0.08;
    this.hips.add(this.chest);
    const torso = b(0.44, 0.52, 0.28, hood);
    torso.position.y = 0.26;
    this.chest.add(torso);
    // zip line + pocket, so the jacket reads as a jacket
    const zip = b(0.03, 0.44, 0.02, hoodDk);
    zip.position.set(0, 0.26, 0.145); this.chest.add(zip);
    const pocket = b(0.3, 0.11, 0.03, hoodDk);
    pocket.position.set(0, 0.09, 0.15); this.chest.add(pocket);
    // shoulders
    const shoulders = b(0.5, 0.16, 0.3, hood);
    shoulders.position.y = 0.5; this.chest.add(shoulders);
    // hood bunched at the neck
    const hoodBack = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.65), hoodDk);
    hoodBack.position.set(0, 0.53, -0.13);
    hoodBack.rotation.x = 2.4;
    hoodBack.castShadow = true;
    this.chest.add(hoodBack);

    // neck + head
    this.head.position.y = 0.6;
    this.chest.add(this.head);
    const neck = b(0.12, 0.08, 0.12, skin);
    neck.position.y = 0.02; this.head.add(neck);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), skin);
    skull.position.y = 0.19; skull.castShadow = true;
    this.head.add(skull);
    const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.26), hair);
    hairTop.position.y = 0.28; this.head.add(hairTop);
    const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.09), hair);
    hairBack.position.set(0, 0.18, -0.1); this.head.add(hairBack);
    // fringe
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.06), hair);
    fringe.position.set(0, 0.25, 0.11); this.head.add(fringe);

    // arms
    const makeArm = (side: number, upper: THREE.Group, fore: THREE.Group) => {
      upper.position.set(side * 0.28, 0.46, 0);
      this.chest.add(upper);
      const u = b(0.13, 0.28, 0.14, hood);
      u.position.y = -0.14; upper.add(u);
      fore.position.y = -0.28;
      upper.add(fore);
      const f = b(0.115, 0.26, 0.125, hood);
      f.position.y = -0.13; fore.add(f);
      const hand = b(0.11, 0.12, 0.11, skin);
      hand.position.y = -0.31; fore.add(hand);
    };
    makeArm(-1, this.armL, this.forearmL);
    makeArm(1, this.armR, this.forearmR);
    this.forearmR.add(this.handAnchor);
    this.handAnchor.position.set(0.02, -0.36, 0.06);

    // legs
    const makeLeg = (side: number, thigh: THREE.Group, shin: THREE.Group) => {
      thigh.position.set(side * 0.12, -0.12, 0);
      this.hips.add(thigh);
      const t = b(0.16, 0.38, 0.18, pants);
      t.position.y = -0.19; thigh.add(t);
      shin.position.y = -0.38;
      thigh.add(shin);
      const s = b(0.14, 0.36, 0.16, pants);
      s.position.y = -0.18; shin.add(s);
      const foot = b(0.15, 0.1, 0.27, shoe);
      foot.position.set(0, -0.4, 0.05); shin.add(foot);
    };
    makeLeg(-1, this.legL, this.shinL);
    makeLeg(1, this.legR, this.shinR);

    // soft contact shadow so the character never looks like it's floating
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.root.add(blob);
  }

  setPosition(v: THREE.Vector3, yaw = Math.PI) {
    this.pos.copy(v);
    this.root.position.copy(v);
    this.yaw = this.targetYaw = yaw;
    this.body.rotation.y = yaw;
    this.vel.set(0, 0, 0);
  }

  /**
   * @param input local move direction in camera space (x = strafe, z = forward)
   */
  update(dt: number, input: THREE.Vector2, camYaw: number, run: boolean, world: World, frozen: boolean) {
    const wish = new THREE.Vector3(input.x, 0, input.y);
    const len = wish.length();
    if (len > 1) wish.divideScalar(len);
    if (frozen) wish.set(0, 0, 0);
    wish.applyAxisAngle(new THREE.Vector3(0, 1, 0), camYaw);

    this.running = run && wish.lengthSq() > 0.01;
    const maxSpeed = this.running ? 5.4 : 2.35;
    const accel = wish.lengthSq() > 0.001 ? 12 : 14;

    const desired = wish.multiplyScalar(maxSpeed);
    this.vel.x = lerp(this.vel.x, desired.x, damp(dt, accel));
    this.vel.z = lerp(this.vel.z, desired.z, damp(dt, accel));

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    world.resolve(this.pos, this.radius);

    const gh = world.groundHeight(this.pos.x, this.pos.z, this.pos.y);
    this.pos.y = lerp(this.pos.y, gh, damp(dt, 14));

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.moving = this.speed > 0.25;

    if (this.moving) this.targetYaw = Math.atan2(this.vel.x, this.vel.z);
    let d = this.targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * damp(dt, 11);

    this.root.position.copy(this.pos);
    this.body.rotation.y = this.yaw;

    this.animate(dt);
  }

  private animate(dt: number) {
    const s = this.speed;
    const stride = clamp(s / 5.4, 0, 1);
    const rate = s > 0.25 ? 2.0 + s * 1.35 : 0;
    this.cycle += rate * dt;

    const c = Math.sin(this.cycle);
    const c2 = Math.sin(this.cycle * 2);
    const amp = 0.22 + stride * 0.66;

    // legs
    this.legL.rotation.x = c * amp;
    this.legR.rotation.x = -c * amp;
    this.shinL.rotation.x = Math.max(0, -Math.sin(this.cycle - 0.7)) * (0.35 + stride * 0.75);
    this.shinR.rotation.x = Math.max(0, -Math.sin(this.cycle + Math.PI - 0.7)) * (0.35 + stride * 0.75);

    // arms swing opposite; the lantern hand stays a bit calmer
    this.armL.rotation.x = -c * amp * 0.95;
    this.armR.rotation.x = c * amp * 0.45;
    this.armL.rotation.z = 0.07;
    this.armR.rotation.z = -0.12 - stride * 0.1;
    this.forearmL.rotation.x = -0.25 - Math.max(0, c) * 0.4;
    this.forearmR.rotation.x = -0.55 - stride * 0.25;

    // body bob + lean
    const idle = Math.sin(performance.now() * 0.0016) * 0.012;
    this.hips.position.y = 0.86 + Math.abs(c2) * 0.045 * stride + idle;
    this.hips.rotation.z = c * 0.035 * stride;
    this.chest.rotation.x = 0.03 + stride * 0.13;
    this.chest.rotation.y = -c * 0.09 * stride;
    this.head.rotation.x = -0.02 - stride * 0.08 + idle * 2;
    this.head.rotation.y = c * 0.05 * stride;

    // breathing when standing still
    if (s < 0.25) {
      const br = Math.sin(performance.now() * 0.0021) * 0.02;
      this.chest.scale.set(1 + br * 0.4, 1 + br, 1 + br * 0.4);
    } else {
      this.chest.scale.setScalar(1);
    }
  }

  /** World-space eye position, used for interaction rays and audio. */
  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.55, this.pos.z);
  }
}
