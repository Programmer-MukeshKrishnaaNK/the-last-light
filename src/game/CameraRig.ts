import * as THREE from 'three';
import { clamp, damp, lerp } from './util';

/** Third-person orbit camera with damping, obstruction pull-in and a run FOV push. */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = 0.12;
  distance = 5.0;
  targetDistance = 5.0;
  height = 1.5;
  private current = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private baseFov = 58;
  private shake = 0;
  private bob = 0;
  cinematic = false;
  cinematicPos = new THREE.Vector3();
  cinematicLook = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.1, 800);
    this.camera.position.set(0, 4, 12);
    this.ray.camera = this.camera;
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0022;
    this.pitch = clamp(this.pitch + dy * 0.0018, -0.5, 0.85);
  }

  addShake(v: number) { this.shake = Math.min(1, this.shake + v); }

  update(dt: number, target: THREE.Vector3, speed: number, obstacles: THREE.Object3D[]) {
    if (this.cinematic) {
      this.camera.position.lerp(this.cinematicPos, damp(dt, 2.2));
      this.lookAt.lerp(this.cinematicLook, damp(dt, 2.2));
      this.camera.lookAt(this.lookAt);
      this.camera.fov = lerp(this.camera.fov, 42, damp(dt, 1.5));
      this.camera.updateProjectionMatrix();
      return;
    }

    const focus = new THREE.Vector3(target.x, target.y + this.height, target.z);
    this.lookAt.lerp(focus, damp(dt, 9));

    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch) + 0.28,
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();

    // pull in when something is between the camera and the player
    let dist = this.targetDistance;
    this.ray.set(this.lookAt, dir);
    this.ray.far = this.targetDistance + 0.6;
    const hits = this.ray.intersectObjects(obstacles, true);
    if (hits.length) dist = Math.max(1.35, hits[0].distance - 0.45);
    this.distance = lerp(this.distance, dist, damp(dt, dist < this.distance ? 22 : 5));

    const want = this.lookAt.clone().addScaledVector(dir, this.distance);
    this.current.lerp(want, damp(dt, 8));

    // gentle walk bob + rare shake
    this.bob += dt * (2.4 + speed * 1.3);
    const bobAmt = Math.min(speed / 5.4, 1) * 0.045;
    const shakeV = this.shake * 0.16;
    this.shake = Math.max(0, this.shake - dt * 1.4);

    this.camera.position.copy(this.current);
    this.camera.position.y += Math.sin(this.bob * 2) * bobAmt;
    this.camera.position.x += Math.sin(this.bob) * bobAmt * 0.5 + (Math.random() - 0.5) * shakeV;
    this.camera.position.z += (Math.random() - 0.5) * shakeV;

    this.camera.lookAt(this.lookAt.x, this.lookAt.y + Math.sin(this.bob) * bobAmt * 0.3, this.lookAt.z);

    const wantFov = this.baseFov + Math.min(speed / 5.4, 1) * 8;
    this.camera.fov = lerp(this.camera.fov, wantFov, damp(dt, 3));
    this.camera.updateProjectionMatrix();
  }

  snap(target: THREE.Vector3) {
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch) + 0.28,
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();
    this.lookAt.set(target.x, target.y + this.height, target.z);
    this.current.copy(this.lookAt).addScaledVector(dir, this.targetDistance);
    this.camera.position.copy(this.current);
    this.camera.lookAt(this.lookAt);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
