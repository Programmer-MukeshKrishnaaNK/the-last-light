/**
 * Everything is synthesised with the Web Audio API — no external assets, so
 * audio can never block the build or fail to load.
 */
export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private rainGain!: GainNode;
  private windGain!: GainNode;
  private oceanGain!: GainNode;
  private roomGain!: GainNode;
  private musicGain!: GainNode;
  private musicVoices: { osc: OscillatorNode; gain: GainNode }[] = [];
  private noiseBuf!: AudioBuffer;
  private stepTimer = 0;
  private stepFlip = 0;
  ready = false;

  start() {
    if (this.ready) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 3;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.0555179;
      b1 = 0.963 * b1 + w * 0.0750759;
      b2 = 0.570 * b2 + w * 0.1538520;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }

    this.rainGain = this.layer(1600, 'bandpass', 0.0, 1.1);
    this.windGain = this.layer(380, 'lowpass', 0.0, 0.9, 0.06, 0.09);
    this.oceanGain = this.layer(520, 'lowpass', 0.0, 1.0, 0.11, 0.22);
    this.roomGain = this.layer(700, 'lowpass', 0.0, 0.7);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);

    this.ready = true;
  }

  private layer(freq: number, type: BiquadFilterType, gain: number, q: number, lfoRate = 0, lfoDepth = 0) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    if (lfoRate > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lg = ctx.createGain();
      lg.gain.value = lfoDepth;
      lfo.connect(lg); lg.connect(g.gain);
      lfo.start();
    }
    return g;
  }

  private ramp(node: GainNode | undefined, v: number, time = 1.6) {
    if (!node || !this.ctx) return;
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(node.gain.value, t);
    node.gain.linearRampToValueAtTime(v, t + time);
  }

  setAmbience(rain: number, wind: number, ocean: number, room: number, time = 2.5) {
    this.ramp(this.rainGain, rain * 0.5, time);
    this.ramp(this.windGain, wind * 0.55, time);
    this.ramp(this.oceanGain, ocean * 0.5, time);
    this.ramp(this.roomGain, room * 0.28, time);
  }

  setMusic(level: number, time = 4) { this.ramp(this.musicGain, level * 0.16, time); }

  /** A slow, breathing chord. Called once; volume is what changes per chapter. */
  startMusic(root = 110) {
    if (!this.ctx || this.musicVoices.length) return;
    const ctx = this.ctx;
    const ratios = [1, 1.5, 2, 2.9966, 4.5];
    ratios.forEach((r, i) => {
      const osc = ctx.createOscillator();
      osc.type = i > 2 ? 'sine' : 'triangle';
      osc.frequency.value = root * r;
      osc.detune.value = (i - 2) * 5;
      const g = ctx.createGain();
      g.gain.value = 0.34 / (i + 1.4);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 900;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.017;
      const lg = ctx.createGain();
      lg.gain.value = 0.16 / (i + 1.4);
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      osc.connect(f); f.connect(g); g.connect(this.musicGain);
      osc.start();
      this.musicVoices.push({ osc, gain: g });
    });
  }

  transposeMusic(root: number, time = 6) {
    if (!this.ctx) return;
    const ratios = [1, 1.5, 2, 2.9966, 4.5];
    this.musicVoices.forEach((v, i) => {
      v.osc.frequency.linearRampToValueAtTime(root * ratios[i], this.ctx!.currentTime + time);
    });
  }

  private burst(o: {
    freq: number; type?: OscillatorType; dur: number; vol: number;
    slideTo?: number; delay?: number;
  }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(o.vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
  }

  private noiseHit(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  footsteps(dt: number, speed: number, indoors: boolean) {
    if (!this.ready || speed < 0.4) { this.stepTimer = 0.18; return; }
    this.stepTimer -= dt * (0.9 + speed * 0.42);
    if (this.stepTimer > 0) return;
    this.stepTimer = 0.5;
    this.stepFlip ^= 1;
    const v = Math.min(0.16, 0.05 + speed * 0.018);
    this.noiseHit(0.14, v, indoors ? 900 : 1500 + this.stepFlip * 260, 'lowpass');
    if (!indoors) this.noiseHit(0.09, v * 0.5, 3200, 'highpass');
  }

  interact() { this.burst({ freq: 620, type: 'triangle', dur: 0.35, vol: 0.09, slideTo: 900 }); }
  lanternToggle(on: boolean) {
    this.burst({ freq: on ? 300 : 520, type: 'sine', dur: 0.5, vol: 0.1, slideTo: on ? 700 : 220 });
    this.noiseHit(0.2, 0.05, 2400, 'highpass');
  }
  pickup() {
    this.burst({ freq: 392, type: 'sine', dur: 1.4, vol: 0.11 });
    this.burst({ freq: 587, type: 'sine', dur: 1.8, vol: 0.08, delay: 0.16 });
    this.burst({ freq: 784, type: 'sine', dur: 2.4, vol: 0.06, delay: 0.34 });
  }
  memory() {
    this.burst({ freq: 330, type: 'sine', dur: 3.4, vol: 0.07 });
    this.burst({ freq: 495, type: 'sine', dur: 3.0, vol: 0.05, delay: 0.5 });
    this.noiseHit(2.4, 0.03, 500, 'lowpass');
  }
  stationOn() {
    this.noiseHit(0.5, 0.1, 1400, 'lowpass');
    this.burst({ freq: 160, type: 'sawtooth', dur: 1.2, vol: 0.07, slideTo: 320 });
    this.burst({ freq: 523, type: 'sine', dur: 2.6, vol: 0.09, delay: 0.28 });
    this.burst({ freq: 659, type: 'sine', dur: 3.2, vol: 0.07, delay: 0.55 });
  }
  thunder() {
    this.noiseHit(3.2, 0.16, 220, 'lowpass', 0.9);
    this.burst({ freq: 58, type: 'sine', dur: 2.6, vol: 0.1, delay: 0.95 });
  }
  train() {
    this.noiseHit(7.0, 0.22, 700, 'lowpass');
    this.burst({ freq: 220, type: 'sawtooth', dur: 2.2, vol: 0.05, delay: 1.6 });
    this.burst({ freq: 165, type: 'sawtooth', dur: 2.4, vol: 0.05, delay: 1.6 });
  }
  mechanism() {
    this.noiseHit(4.5, 0.1, 380, 'lowpass');
    this.burst({ freq: 82, type: 'sawtooth', dur: 3.4, vol: 0.09, slideTo: 164 });
    this.burst({ freq: 330, type: 'triangle', dur: 5.0, vol: 0.07, delay: 1.2 });
  }
  swell() {
    this.burst({ freq: 262, type: 'sine', dur: 6, vol: 0.1 });
    this.burst({ freq: 392, type: 'sine', dur: 6, vol: 0.08, delay: 0.4 });
    this.burst({ freq: 523, type: 'sine', dur: 7, vol: 0.07, delay: 0.9 });
    this.burst({ freq: 784, type: 'sine', dur: 8, vol: 0.05, delay: 1.5 });
  }
  birds() {
    for (let i = 0; i < 7; i++) {
      const f = 1800 + Math.random() * 1600;
      this.burst({ freq: f, type: 'sine', dur: 0.12, vol: 0.03, slideTo: f * 1.4, delay: Math.random() * 6 });
    }
  }
  dispose() { this.ctx?.close(); this.ctx = null; this.ready = false; }
}
