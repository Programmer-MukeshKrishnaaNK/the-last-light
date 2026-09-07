import * as THREE from 'three';
import { AudioSys } from './Audio';
import { CameraRig } from './CameraRig';
import { Interaction } from './Interaction';
import { LightPool, SkyHandles, applyEnvironment, buildSky } from './Lighting';
import { Lantern, makePedestalLantern } from './Lantern';
import { MemoryScene } from './Memory';
import { Player } from './Player';
import { UI } from './UI';
import { Weather } from './Weather';
import { P, World } from './World';
import { MAT, makeBench, makeTree } from './props';
import { glowTexture, woodTexture } from './textures';
import { Rng, clamp, damp, std } from './util';

type State = 'boot' | 'intro' | 'play' | 'paused' | 'cinematic' | 'ended';

interface Timer { at: number; resolve: () => void }

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  world: World;
  player = new Player();
  cam: CameraRig;
  lantern = new Lantern();
  weather: Weather;
  ui = new UI();
  audio = new AudioSys();
  interact = new Interaction();
  lightPool: LightPool;
  sky: SkyHandles;

  state: State = 'boot';
  private keys = new Set<string>();
  private clock = new THREE.Clock();
  private time = 0;
  private timers: Timer[] = [];
  private rng = new Rng(4242);
  private frozen = false;
  private raf = 0;
  private morning?: THREE.Group;
  private walkers: { obj: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; speed: number; t: number }[] = [];
  private train?: THREE.Group;
  private trainX = 0;
  private trainActive = false;
  private mem1!: MemoryScene;
  private mem2!: MemoryScene;
  private mem3!: MemoryScene;
  private finaleMems: MemoryScene[] = [];
  private childFigure?: THREE.Group;
  private childT = 0;

  flags = { lantern: false, mem1: false, s1: false, mem2: false, s2: false, s3: false, read: false, placed: false };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.cam = new CameraRig(window.innerWidth / window.innerHeight);
    this.world = new World(this.scene);
    this.sky = buildSky(this.scene);
    this.lightPool = new LightPool(this.scene, 6);
    this.weather = new Weather(this.scene);

    applyEnvironment(this.renderer, this.scene, 'night');
    this.world.build();
    this.scene.add(this.player.root);
    this.player.setPosition(P.start, Math.PI);
    this.cam.yaw = 0;
    this.cam.snap(P.start);

    this.setupLantern();
    this.setupMemories();
    this.setupInteractions();
    this.buildTrain();
    this.bindInput();

    this.ui.setFade(1, 0.01);
  }

  // -------------------------------------------------------------- lifecycle

  boot() {
    this.ui.hideLoading();
    this.ui.showTitle(true);
    this.ui.showStart(true);
    this.state = 'intro';
    this.loop();
    this.ui.startBtn.onclick = () => this.beginGame();
    this.ui.resumeBtn.onclick = () => this.setPaused(false);
    this.ui.restartBtn.onclick = () => location.reload();
    this.ui.againBtn.onclick = () => location.reload();
  }

  private async beginGame() {
    if (this.state !== 'intro') return;
    this.audio.start();
    this.audio.setAmbience(1, 0.8, 0.35, 0, 4);
    this.audio.startMusic(110);
    this.audio.setMusic(0, 0.1);
    this.ui.showStart(false);
    this.ui.showReticle(true);
    this.requestLock();

    this.state = 'play';
    this.ui.setFade(0, 3.2);
    await this.wait(2.4);
    this.ui.showTitle(false);
    await this.wait(1.6);

    this.ui.showStory('The town went dark at 11:47.');
    await this.wait(4.2);
    this.ui.showStory(null);
    await this.wait(1.6);
    this.ui.showStory('Nobody knows why.');
    await this.wait(3.8);
    this.ui.showStory(null);
    await this.wait(1.6);
    this.ui.showStory('But the lighthouse is still calling.');
    await this.wait(4.2);
    this.ui.showStory(null);
    await this.wait(1.2);
    this.ui.setObjective('something is lying in the road', 6);
    this.audio.setMusic(0.35, 8);
  }

  private requestLock() {
    const c = this.renderer.domElement;
    if (document.pointerLockElement !== c) c.requestPointerLock?.();
  }

  private setPaused(on: boolean) {
    if (on && this.state === 'play') {
      this.state = 'paused';
      this.ui.showPause(true);
      document.exitPointerLock?.();
      this.audio.setMusic(0.05, 0.4);
    } else if (!on && this.state === 'paused') {
      this.state = 'play';
      this.ui.showPause(false);
      this.requestLock();
      this.audio.setMusic(this.musicLevel, 1.2);
    }
  }

  private musicLevel = 0.35;

  // ------------------------------------------------------------------ input

  private bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        this.setPaused(this.state === 'play');
        return;
      }
      this.keys.add(e.code);
      if (this.state !== 'play') return;
      if (e.code === 'KeyE') this.tryInteract();
      if (e.code === 'KeyF') this.toggleLantern();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      if (this.state === 'play') this.requestLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (this.state !== 'play') return;
      this.cam.look(e.movementX, e.movementY);
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.state === 'play' && this.flags.lantern) {
        // don't force a pause; just let the player click back in
      }
    });
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.cam.resize(window.innerWidth / window.innerHeight);
    });
    window.addEventListener('wheel', (e) => {
      if (this.state !== 'play') return;
      this.cam.targetDistance = clamp(this.cam.targetDistance + Math.sign(e.deltaY) * 0.5, 2.6, 8);
    }, { passive: true });
  }

  // ----------------------------------------------------------------- timers

  private wait(seconds: number) {
    return new Promise<void>((resolve) => this.timers.push({ at: this.time + seconds, resolve }));
  }

  private tickTimers() {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.time >= this.timers[i].at) {
        const t = this.timers.splice(i, 1)[0];
        t.resolve();
      }
    }
  }

  // ---------------------------------------------------------------- lantern

  private lanternBeacon = Lantern.beacon();

  private setupLantern() {
    this.lantern.group.position.copy(P.lantern);
    this.lantern.group.position.y = 0.06;
    this.lantern.group.rotation.z = 0.5;
    this.scene.add(this.lantern.group);
    this.lanternBeacon.position.copy(P.lantern).setY(0.5);
    this.scene.add(this.lanternBeacon);
  }

  private toggleLantern() {
    if (!this.lantern.held) return;
    const on = this.lantern.toggle();
    this.audio.lanternToggle(on);
  }

  private async pickUpLantern() {
    this.flags.lantern = true;
    this.lantern.held = true;
    this.lantern.on = true;
    this.scene.remove(this.lanternBeacon);
    this.lantern.group.position.set(0, 0, 0);
    this.lantern.group.rotation.set(0, 0, 0);
    this.player.handAnchor.add(this.lantern.group);
    this.audio.pickup();
    this.ui.setPrompt('F', 'lantern');

    await this.wait(1.8);
    // a window comes on somewhere up the street… and then thinks better of it
    this.world.zones[0].target = 0.5;
    this.audio.interact();
    await this.wait(1.7);
    this.world.zones[0].target = 0;
    await this.wait(2.0);
    this.ui.setObjective('the house up the street', 7);
  }

  // --------------------------------------------------------------- memories

  private setupMemories() {
    const T = P.table;
    this.mem1 = new MemoryScene([
      { pos: new THREE.Vector3(T.x, 0.05, T.z - 1.5), yaw: 0, scale: 1.02 },
      { pos: new THREE.Vector3(T.x, 0.05, T.z + 1.4), yaw: Math.PI, scale: 1.0 },
      { pos: new THREE.Vector3(T.x - 1.9, 0.05, T.z), yaw: Math.PI / 2, scale: 0.72 },
      { pos: new THREE.Vector3(T.x + 1.9, 0.05, T.z), yaw: -Math.PI / 2, scale: 0.62 },
    ], this.scene);
    this.mem1.holdTime = 7;

    this.mem2 = new MemoryScene([
      { pos: new THREE.Vector3(-3.5, 0.92, -48.4), yaw: Math.PI, scale: 1.02 },
    ], this.scene);
    this.mem2.holdTime = 9;
    this.mem2.maxOpacity = 0.6;

    // the whole town, watching
    const specs = [];
    const spots: [number, number][] = [
      [-8.5, 40], [-7.5, 30], [6, 24], [-5.5, 12], [6.5, 4], [-6, -6], [5.5, -16],
      [-9, 52], [8, 48], [0, 58], [-3, 66], [4, 34],
      [-10, -42], [9, -42], [0, -46],
      [-14, -66], [12, -68], [-6, -70], [7, -74], [-20, -64], [18, -62],
      [2.2, -84], [-2.2, -92], [2.2, -100],
    ];
    for (const [x, z] of spots) {
      const y = z < -38 && z > -52 ? 0.92 : z < -60 ? (Math.abs(x) < 2.6 && z < -70 ? 1.4 : -Math.min(1.5, (-z - 60) / 20)) : 0;
      specs.push({
        pos: new THREE.Vector3(x, y, z),
        yaw: Math.atan2(P.lighthouse.x - x, P.lighthouse.z - z),
        scale: 0.95 + Math.random() * 0.15,
      });
    }
    this.mem3 = new MemoryScene(specs, this.scene);
    this.mem3.holdTime = 2.4;
    this.mem3.maxOpacity = 0.62;

    // finale flashes, one per location
    const mk = (pts: [number, number, number][]) => new MemoryScene(
      pts.map(([x, y, z]) => ({
        pos: new THREE.Vector3(x, y, z), yaw: Math.random() * 6, scale: 0.85 + Math.random() * 0.3,
      })), this.scene);
    this.finaleMems = [
      mk([[P.table.x, 0.05, P.table.z - 1.4], [P.table.x, 0.05, P.table.z + 1.4], [P.table.x - 1.8, 0.05, P.table.z], [P.table.x + 1.8, 0.05, P.table.z]]),
      mk([[-4, 0.92, -42], [2, 0.92, -45], [7, 0.92, -41], [-8, 0.92, -47]]),
      mk([[-1.6, 1.4, -80], [1.6, 1.4, -92], [-9, -0.7, -74], [10, -0.9, -78]]),
      mk([[-4, 0, 30], [4, 0, 22], [-3, 0, 8], [5, 0, 46], [-6, 0, 56]]),
    ];
    for (const m of this.finaleMems) { m.holdTime = 5; m.maxOpacity = 0.55; }
  }

  // ----------------------------------------------------------- interactions

  private setupInteractions() {
    this.interact.add({
      id: 'lantern', pos: P.lantern.clone().setY(0.3), radius: 2.8,
      key: 'E', label: 'take the lantern', once: true,
      highlight: this.lanternBeacon,
      onUse: () => void this.pickUpLantern(),
    });

    // flavour: things that say something without saying anything
    this.addNote('newspaper', new THREE.Vector3(-4.4, 0.05, 61), 'A soaked newspaper. The date has run into the paper.', () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), std(0x9a9384, 0.95));
      m.rotation.set(-Math.PI / 2, 0, 0.6); m.position.set(-4.4, 0.04, 61);
      this.scene.add(m);
    });
    this.addNote('clock', P.clock.clone(), 'The hands stopped at 11:47.');
    this.addNote('drawing', new THREE.Vector3(-21.6, 0, 27.8), 'A child drew a tower. The light is coloured in very carefully.');
    this.addNote('ticket', new THREE.Vector3(3.6, 0.95, -46.6), 'A train ticket. It was never punched.', () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), std(0xbfb49c, 0.9));
      m.rotation.set(-Math.PI / 2, 0, 1.1); m.position.set(3.6, 0.93, -46.6);
      this.scene.add(m);
    });

    this.interact.add({
      id: 'mem1', pos: P.table.clone(), radius: 3.4,
      key: 'E', label: 'raise the lantern', once: true,
      enabled: () => this.lantern.held && this.lantern.on,
      onUse: () => void this.playMemory1(),
    });

    this.interact.add({
      id: 'station1', pos: P.station1.clone().setY(1.1), radius: 3.4,
      key: 'E', label: 'restore the light', once: true,
      enabled: () => this.flags.mem1,
      highlight: this.stationHalo(0),
      onUse: () => void this.activateStation(0),
    });

    this.interact.add({
      id: 'mem2', pos: P.memory2.clone(), radius: 4.2,
      key: 'E', label: 'raise the lantern', once: true,
      enabled: () => this.flags.s1 && this.lantern.held && this.lantern.on,
      onUse: () => void this.playMemory2(),
    });

    this.interact.add({
      id: 'station2', pos: P.station2.clone().setY(2.0), radius: 3.4,
      key: 'E', label: 'restore the light', once: true,
      enabled: () => this.flags.mem2,
      highlight: this.stationHalo(1),
      onUse: () => void this.activateStation(1),
    });

    this.interact.add({
      id: 'station3', pos: P.station3.clone().setY(1.1), radius: 3.4,
      key: 'E', label: 'restore the light', once: true,
      enabled: () => this.flags.s2,
      highlight: this.stationHalo(2),
      onUse: () => void this.activateStation(2),
    });

    // the lighthouse pedestal
    const ped = makePedestalLantern();
    ped.position.set(2.4, P.lampRoom.y + 0.5, 1.1);
    ped.scale.setScalar(1.25);
    this.world.lighthouseGroup.add(ped);
    const halo = Lantern.beacon();
    halo.scale.set(2.2, 2.2, 1);
    (halo.material as THREE.SpriteMaterial).color.setHex(0xbfd4ea);
    halo.position.copy(ped.position).setY(ped.position.y + 0.3);
    this.world.lighthouseGroup.add(halo);

    this.interact.add({
      id: 'inscription',
      pos: new THREE.Vector3(P.lighthouse.x + 2.4, P.lampRoom.y + 0.6, P.lighthouse.z + 1.1),
      radius: 3.0, key: 'E', label: 'read the inscription', once: true,
      enabled: () => this.flags.s3,
      highlight: halo,
      onUse: () => {
        this.flags.read = true;
        this.audio.interact();
        this.ui.say('"For whoever comes next."', 7);
        this.wait(3.5).then(() => this.ui.setObjective('the mechanism', 8));
      },
    });

    this.interact.add({
      id: 'mechanism',
      pos: new THREE.Vector3(P.lighthouse.x, P.lampRoom.y + 0.9, P.lighthouse.z),
      radius: 2.9, key: 'E', label: 'place the lantern', once: true,
      enabled: () => this.flags.read && this.lantern.held,
      onUse: () => void this.finale(),
    });
  }

  private stationHalo(i: number) {
    const s = Lantern.beacon();
    s.scale.set(2.0, 2.0, 1);
    const st = this.world.stations[i];
    s.position.set(0, 1.95, 0);
    st.group.add(s);
    (s.material as THREE.SpriteMaterial).color.setHex(0xffd7a0);
    return s;
  }

  private addNote(id: string, pos: THREE.Vector3, line: string, decorate?: () => void) {
    decorate?.();
    this.interact.add({
      id, pos, radius: 2.6, key: 'E', label: 'look', once: true,
      onUse: () => { this.audio.interact(); this.ui.say(line, 6); },
    });
  }

  private tryInteract() {
    const c = this.interact.current;
    if (!c) return;
    this.interact.use();
    this.ui.setPrompt(null);
  }

  // ------------------------------------------------------------- story beats

  private async playMemory1() {
    this.flags.mem1 = true;
    this.audio.memory();
    this.audio.setAmbience(0.35, 0.3, 0.1, 1.0, 2.0);
    this.mem1.play();
    this.world.houseInteriorLight.intensity = 0;
    await this.wait(1.0);
    // the room remembers being warm
    const light = this.world.houseInteriorLight;
    for (let i = 0; i < 40; i++) { light.intensity = i / 40 * 2.2; await this.wait(0.03); }
    await this.wait(6.5);
    for (let i = 40; i >= 0; i--) { light.intensity = i / 40 * 2.2; await this.wait(0.03); }
    this.world.setClock(11, 48);
    this.audio.interact();
    await this.wait(0.6);
    this.ui.say('11:48.', 4);
    this.audio.setAmbience(1, 0.8, 0.35, 0.25, 3);
    await this.wait(2.5);
    this.ui.setObjective('there is something in the garden', 7);
  }

  private async activateStation(i: number) {
    this.world.activateStation(i);
    this.audio.stationOn();
    this.cam.addShake(0.35);
    await this.wait(0.9);

    if (i === 0) {
      this.flags.s1 = true;
      this.world.zones[0].target = 1;
      this.weather.setIntensity(0.9);
      this.musicLevel = 0.5; this.audio.setMusic(this.musicLevel, 6);
      await this.wait(2.5);
      this.ui.setObjective('follow the light north', 8);
    } else if (i === 1) {
      this.flags.s2 = true;
      this.world.zones[1].target = 1;
      this.weather.setIntensity(0.62);
      this.musicLevel = 0.62; this.audio.setMusic(this.musicLevel, 6);
      this.audio.transposeMusic(98, 10);
      await this.wait(2.5);
      this.ui.setObjective('the shore', 8);
    } else {
      await this.beachReveal();
    }
  }

  private async playMemory2() {
    this.flags.mem2 = true;
    this.audio.memory();
    this.mem2.play();
    await this.wait(2.2);
    this.audio.train();
    this.trainActive = true;
    this.trainX = 70;
    await this.wait(3.4);
    this.cam.addShake(0.5);
    await this.wait(1.6);
    this.ui.setFade(0.92, 1.1);
    await this.wait(1.4);
    this.trainActive = false;
    if (this.train) this.train.visible = false;
    this.mem2.group.visible = false;
    this.ui.setFade(0, 2.2);
    await this.wait(2.6);
    this.ui.setObjective('the platform light', 7);
  }

  /** Station three: the whole town answers, once. */
  private async beachReveal() {
    this.flags.s3 = true;
    this.audio.swell();
    this.musicLevel = 0.8; this.audio.setMusic(this.musicLevel, 3);
    await this.wait(0.8);

    for (const z of this.world.zones) z.target = 1;
    this.weather.setIntensity(0.25);
    this.cam.addShake(0.5);
    await this.wait(1.1);
    this.mem3.play();
    await this.wait(3.4);

    // and then it stops
    for (const z of this.world.zones) z.target = 0;
    this.audio.setMusic(0.15, 2);
    this.weather.setIntensity(0.45);
    await this.wait(2.4);

    // only the lighthouse remains
    this.world.topLight.intensity = 2.2;
    this.world.lensMat.emissiveIntensity = 1.4;
    (this.world.lampGlow.material as THREE.SpriteMaterial).opacity = 0.28;
    (this.world.beamCone.material as THREE.MeshBasicMaterial).opacity = 0.08;
    this.world.beamLight.intensity = 3.4;
    this.beamMode = 'toPlayer';
    this.audio.mechanism();
    await this.wait(2.0);
    this.world.openLighthouseDoor();
    this.audio.interact();
    this.musicLevel = 0.55; this.audio.setMusic(this.musicLevel, 6);
    await this.wait(1.6);
    this.ui.setObjective('the lighthouse', 9);
  }

  private fogTarget = 0.0095;
  private beamMode: 'off' | 'toPlayer' | 'sweep' = 'off';
  private beamAngle = 0;

  private async finale() {
    this.flags.placed = true;
    this.state = 'cinematic';
    this.frozen = true;
    document.exitPointerLock?.();
    this.ui.setPrompt(null);
    this.ui.showReticle(false);

    // the lantern goes into the mechanism
    this.lantern.group.removeFromParent();
    this.world.lighthouseGroup.add(this.lantern.group);
    this.lantern.group.position.set(0, P.lampRoom.y + 1.15, 0);
    this.lantern.group.scale.setScalar(1.3);
    this.lantern.held = false;
    this.audio.mechanism();
    this.cam.addShake(0.6);

    // hold on the mechanism as it takes the light
    this.cam.cinematic = true;
    this.cam.cinematicPos.set(P.lighthouse.x + 3.2, P.lampRoom.y + 1.9, P.lighthouse.z + 3.4);
    this.cam.cinematicLook.set(P.lighthouse.x, P.lampRoom.y + 1.2, P.lighthouse.z);
    this.cam.camera.position.set(P.lighthouse.x + 3.2, P.lampRoom.y + 1.9, P.lighthouse.z + 3.4);

    await this.wait(3.4);
    this.world.lensMat.emissiveIntensity = 5.5;
    (this.world.lampGlow.material as THREE.SpriteMaterial).opacity = 0.75;
    this.world.topLight.intensity = 7;
    this.audio.swell();
    this.musicLevel = 1; this.audio.setMusic(1, 4);

    // shot 2 — outside the lamp room, watching the beam leave the tower
    this.cam.cinematicPos.set(P.lighthouse.x + 26, P.lampRoom.y + 5, P.lighthouse.z + 22);
    this.cam.cinematicLook.set(P.lighthouse.x, P.lampRoom.y + 0.5, P.lighthouse.z);
    this.fogTarget = 0.0042;
    (this.world.beamCone.material as THREE.MeshBasicMaterial).opacity = 0.3;
    this.world.beamLight.intensity = 5.5;
    this.world.glowBoost = 2.0;
    this.beamMode = 'sweep';
    this.beamAngle = Math.PI - 1.6;
    this.weather.setIntensity(0.12);

    await this.wait(5.0);

    // shot 3 — high over the town, the beam raking across it
    this.cam.cinematicPos.set(26, 42, 10);
    this.cam.cinematicLook.set(-3, 0, -58);
    await this.wait(3.0);

    // each sweep wakes a place up
    const beats: Array<[number, number]> = [[0, 0], [1, 1], [2, 2], [3, 0]];
    for (const [memIdx, zoneIdx] of beats) {
      this.finaleMems[memIdx].play();
      this.world.zones[zoneIdx].target = 1;
      this.audio.interact();
      await this.wait(2.6);
    }
    for (const z of this.world.zones) z.target = 1;
    await this.wait(2.2);

    // the beam comes back to the tower, and to whoever is standing in it
    this.cam.cinematicPos.set(P.lighthouse.x + 5, P.lampRoom.y + 2.5, P.lighthouse.z + 15);
    this.cam.cinematicLook.set(P.lighthouse.x, P.lampRoom.y + 1.3, P.lighthouse.z);
    await this.wait(3.2);

    this.ui.setFadeColor('#fff8ec');
    this.ui.setFade(1, 4.5);
    this.audio.setAmbience(0, 0, 0, 0, 4);
    this.audio.setMusic(0.5, 4);
    await this.wait(5.2);
    await this.ending();
  }

  // ----------------------------------------------------------------- ending

  private async ending() {
    // strip the night away
    this.weather.setIntensity(0);
    this.sky.setMood('dawn');
    applyEnvironment(this.renderer, this.scene, 'dawn');
    this.fogTarget = 0.0042;
    this.renderer.toneMappingExposure = 1.15;
    for (const z of this.world.zones) { z.target = 0; z.power = 0; }
    for (const l of this.world.lamps) l.power = 0;
    this.world.beamLight.intensity = 0;
    this.world.glowBoost = 1;
    (this.world.beamCone.material as THREE.MeshBasicMaterial).opacity = 0;
    this.world.lensMat.emissiveIntensity = 0;
    (this.world.lampGlow.material as THREE.SpriteMaterial).opacity = 0;
    this.world.topLight.intensity = 0;
    this.lantern.group.visible = false;
    this.beamMode = 'off';
    this.world.dryOut();
    this.buildMorning();

    this.cam.cinematic = false;
    this.cam.yaw = 0; this.cam.pitch = 0.06;
    this.player.setPosition(new THREE.Vector3(0, 0, 72), Math.PI);
    this.cam.snap(this.player.pos);
    this.frozen = false;
    this.state = 'play';
    this.ui.showReticle(false);

    this.audio.setAmbience(0, 0.35, 0.12, 0, 3);
    this.audio.transposeMusic(131, 8);
    this.audio.setMusic(0.55, 6);
    this.audio.birds();

    this.ui.setFade(0, 5);
    await this.wait(2.5);
    this.audio.birds();
    this.ui.setObjective('morning', 6);
    await this.wait(4);

    // a child walks past, carrying a lantern
    this.spawnChild();
    await this.wait(7);
    this.audio.birds();
    await this.wait(9);

    this.ui.setFadeColor('#000');
    this.ui.setFade(1, 5);
    this.audio.setMusic(0.3, 6);
    this.audio.setAmbience(0, 0, 0, 0, 5);
    await this.wait(5.4);
    this.state = 'ended';
    this.ui.showEnd();
  }

  private buildMorning() {
    const g = new THREE.Group();
    this.scene.add(g);
    this.morning = g;

    const skinMat = std(0x9c8f80, 0.9);
    const coatMats = [std(0x6a5a4c, 0.9), std(0x3f4a56, 0.9), std(0x5c4a52, 0.9), std(0x4a5a48, 0.9)];

    const person = (scale: number, coat: THREE.Material) => {
      const p = new THREE.Group();
      const b = (w: number, h: number, d: number, y: number, x = 0, m: THREE.Material = coat) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        mesh.position.set(x, y, 0); mesh.castShadow = true; p.add(mesh); return mesh;
      };
      b(0.42, 0.62, 0.26, 1.12);
      b(0.23, 0.26, 0.23, 1.58, 0, skinMat);
      b(0.24, 0.12, 0.25, 1.74, 0);
      const al = b(0.12, 0.5, 0.13, 1.14, -0.28);
      const ar = b(0.12, 0.5, 0.13, 1.14, 0.28);
      const ll = b(0.16, 0.8, 0.17, 0.4, -0.12, std(0x2f3138, 0.95));
      const lr = b(0.16, 0.8, 0.17, 0.4, 0.12, std(0x2f3138, 0.95));
      p.scale.setScalar(scale);
      p.userData.limbs = [al, ar, ll, lr];
      return p;
    };

    const routes: [number, number, number, number][] = [
      [-6.2, 58, -6.2, 8], [6.2, 12, 6.2, 62], [-6.2, 30, -6.2, -14], [6.2, 50, 6.2, 20],
    ];
    routes.forEach((r, i) => {
      const p = person(0.98 + (i % 2) * 0.06, coatMats[i % coatMats.length]);
      g.add(p);
      this.walkers.push({
        obj: p,
        from: new THREE.Vector3(r[0], 0.16, r[1]),
        to: new THREE.Vector3(r[2], 0.16, r[3]),
        speed: 1.1 + (i % 3) * 0.22,
        t: i * 0.23,
      });
    });

    // a couple of parked cars
    const car = (x: number, z: number, color: number, yaw: number) => {
      const c = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.75, 4.1), std(color, 0.42, 0.35));
      body.position.y = 0.72; body.castShadow = true; c.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.62, 2.0), std(0x1c2028, 0.2, 0.6));
      cab.position.set(0, 1.32, -0.15); c.add(cab);
      for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]] as [number, number][]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 12), std(0x15171a, 0.9));
        w.rotation.z = Math.PI / 2; w.position.set(wx, 0.36, wz); c.add(w);
      }
      c.position.set(x, 0.02, z); c.rotation.y = yaw;
      g.add(c);
    };
    car(-7.4, 44, 0x7e8a92, 0);
    car(7.4, 26, 0x8b6f5a, Math.PI);
    car(-7.4, 6, 0x5f6b78, 0);

    // washing lines, open windows, a town that woke up
    for (let i = 0; i < 6; i++) {
      const t = makeTree(this.rng, 1.1);
      t.position.set(this.rng.range(-1, 1) > 0 ? 24 : -24, 0, this.rng.range(-10, 60));
      g.add(t);
    }
    const bench = makeBench();
    bench.position.set(5.2, 0.16, 54); bench.rotation.y = -Math.PI / 2;
    g.add(bench);
  }

  private spawnChild() {
    const g = new THREE.Group();
    const coat = std(0xc48a4e, 0.9);
    const b = (w: number, h: number, d: number, y: number, x = 0, m: THREE.Material = coat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, 0); mesh.castShadow = true; g.add(mesh); return mesh;
    };
    b(0.36, 0.5, 0.22, 0.95);
    b(0.22, 0.24, 0.22, 1.32, 0, std(0xc2a184, 0.8));
    b(0.24, 0.11, 0.24, 1.45, 0, std(0x3a2a1e, 0.95));
    const armL = b(0.1, 0.4, 0.11, 0.98, -0.24);
    const armR = b(0.1, 0.4, 0.11, 0.98, 0.24);
    const legL = b(0.13, 0.6, 0.14, 0.32, -0.1, std(0x3b3f48, 0.95));
    const legR = b(0.13, 0.6, 0.14, 0.32, 0.1, std(0x3b3f48, 0.95));

    const lamp = makePedestalLantern();
    lamp.scale.setScalar(0.62);
    lamp.position.set(0.3, 0.5, 0.06);
    g.add(lamp);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({
      color: 0x2a1c0c, emissive: new THREE.Color(0xffb162), emissiveIntensity: 4,
    }));
    flame.position.set(0.3, 0.63, 0.06); g.add(flame);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffc98a, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(1.5, 1.5, 1); glow.position.copy(flame.position); g.add(glow);

    g.userData.limbs = [armL, armR, legL, legR];
    g.position.set(-6.2, 0.16, 84);
    this.scene.add(g);
    this.childFigure = g;
    this.childT = 0;
  }

  // ------------------------------------------------------------------ train

  private buildTrain() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 3.1, 2.9), std(0x2b3038, 0.6, 0.35));
    body.position.y = 2.0; g.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 2.7), std(0x232830, 0.55, 0.4));
    nose.position.set(-5.2, 1.9, 0); g.add(nose);
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x101820, emissive: new THREE.Color(0xffd6a0), emissiveIntensity: 1.4,
    });
    for (let i = 0; i < 5; i++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 3.0), winMat);
      w.position.set(-3 + i * 1.7, 2.6, 0); g.add(w);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshStandardMaterial({
      color: 0x2a2418, emissive: new THREE.Color(0xfff0d0), emissiveIntensity: 6,
    }));
    head.position.set(-6.0, 2.1, 0); g.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xfff0d0, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(16, 16, 1); glow.position.copy(head.position); g.add(glow);
    const light = new THREE.SpotLight(0xfff0d0, 40, 70, 0.4, 0.6, 1.2);
    light.position.copy(head.position);
    light.target.position.set(-40, 0, 0);
    g.add(light); g.add(light.target);

    g.position.set(70, 0.4, -54.5);
    g.visible = false;
    this.scene.add(g);
    this.train = g;
  }

  // ------------------------------------------------------------------- loop

  private loop = () => {
    // never leave more than one frame pending, even if something calls loop() directly
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
    const raw = Math.min(this.clock.getDelta(), 0.05);
    const dt = this.state === 'paused' ? 0 : raw;
    this.time += dt;
    this.tickTimers();

    if (dt > 0) this.step(dt);

    this.ui.update(raw);
    this.renderer.render(this.scene, this.cam.camera);
  };

  private step(dt: number) {
    const t = this.time;

    // movement input
    const mv = new THREE.Vector2(0, 0);
    if (this.state === 'play') {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mv.y -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mv.y += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mv.x -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mv.x += 1;
    }
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    this.player.update(dt, mv, this.cam.yaw, run, this.world, this.frozen);

    const inside = this.world.isInsideHouse(this.player.pos);
    this.world.setInsideHouse(inside, dt);

    this.cam.update(dt, this.player.pos, this.player.speed, this.world.blockers);

    // keep the moon's shadow box over the player so it stays crisp and cheap
    const md = this.sky.moonDir;
    this.sky.moon.position.set(
      this.player.pos.x + md.x * 90, this.player.pos.y + md.y * 90, this.player.pos.z + md.z * 90,
    );
    this.sky.moon.target.position.copy(this.player.pos);
    this.sky.moon.target.updateMatrixWorld();

    this.world.update(t, dt);
    this.lantern.update(dt, t, 1);
    this.weather.update(dt, t, this.player.pos, () => this.audio.thunder());
    const lightFocus = this.cam.cinematic ? this.cam.camera.position : this.player.pos;
    this.lightPool.update(this.world.lamps, lightFocus, t, dt, this.world.glowBoost);

    this.mem1.update(dt, t);
    this.mem2.update(dt, t);
    this.mem3.update(dt, t);
    for (const m of this.finaleMems) m.update(dt, t);

    this.audio.footsteps(dt, this.player.speed, inside);

    // interaction prompt
    if (this.state === 'play' && !this.frozen) {
      const c = this.interact.update(this.player.pos, t);
      if (c) this.ui.setPrompt(c.key, c.label);
    }

    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2) fog.density += (this.fogTarget - fog.density) * damp(dt, 0.5);

    this.updateBeam(dt, t);
    this.updateTrain(dt);
    this.updateMorning(dt, t);

    // proximity ambience: the sea gets louder as you approach it
    if (this.state === 'play' && this.flags.lantern) {
      const z = this.player.pos.z;
      const nearSea = clamp((-z + 20) / 90, 0, 1);
      const rain = this.weather.intensity;
      if (!this.morning) {
        this.audio.setAmbience(rain, 0.5 + nearSea * 0.4, 0.12 + nearSea * 0.85, inside ? 0.5 : 0, 2.5);
      }
    }
  }

  private updateBeam(dt: number, t: number) {
    if (this.beamMode === 'off') return;
    const pivot = this.world.beamPivot;
    if (this.beamMode === 'toPlayer') {
      const want = Math.atan2(this.player.pos.x - P.lighthouse.x, this.player.pos.z - P.lighthouse.z);
      let d = want - pivot.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      pivot.rotation.y += d * damp(dt, 1.1);
      pivot.rotation.x = -0.06;
    } else {
      this.beamAngle += dt * 0.17;
      pivot.rotation.y = this.beamAngle;
      pivot.rotation.x = -0.155 + Math.sin(t * 0.3) * 0.012;
    }
  }

  private updateTrain(dt: number) {
    if (!this.train) return;
    if (!this.trainActive) return;
    this.train.visible = true;
    this.trainX -= dt * 26;
    this.train.position.x = this.trainX;
    if (this.trainX < -80) { this.trainActive = false; this.train.visible = false; }
  }

  private updateMorning(dt: number, t: number) {
    if (!this.morning) return;
    for (const w of this.walkers) {
      w.t += dt * w.speed * 0.02;
      const k = w.t % 1;
      w.obj.position.lerpVectors(w.from, w.to, k);
      w.obj.rotation.y = Math.atan2(w.to.x - w.from.x, w.to.z - w.from.z);
      const limbs = w.obj.userData.limbs as THREE.Mesh[];
      const c = Math.sin(t * 5.2 + w.t * 40);
      limbs[0].rotation.x = c * 0.5; limbs[1].rotation.x = -c * 0.5;
      limbs[2].rotation.x = -c * 0.55; limbs[3].rotation.x = c * 0.55;
    }

    if (this.childFigure) {
      this.childT += dt;
      const c = this.childFigure;
      c.position.z = 84 - this.childT * 2.0;
      const dz = c.position.z - this.player.pos.z;
      // look at the player as they pass, then walk on
      const looking = Math.abs(dz) < 6;
      c.rotation.y = looking
        ? THREE.MathUtils.lerp(c.rotation.y, Math.atan2(this.player.pos.x - c.position.x, this.player.pos.z - c.position.z), damp(dt, 3))
        : THREE.MathUtils.lerp(c.rotation.y, Math.PI, damp(dt, 2));
      const limbs = c.userData.limbs as THREE.Mesh[];
      const s = Math.sin(t * 5.4);
      limbs[0].rotation.x = s * 0.4; limbs[1].rotation.x = -s * 0.15;
      limbs[2].rotation.x = -s * 0.6; limbs[3].rotation.x = s * 0.6;
      if (c.position.z < 42) { c.removeFromParent(); this.childFigure = undefined; }
    }
  }

  /** Jump the player somewhere — used by the QA pass and by the pause-free debug flow. */
  teleport(x: number, y: number, z: number) {
    this.player.setPosition(new THREE.Vector3(x, y, z), this.player.yaw);
    this.cam.snap(this.player.pos);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.audio.dispose();
    this.renderer.dispose();
  }
}

// keep the tree-shaker from dropping shared material helpers used by the world
void MAT; void woodTexture;
