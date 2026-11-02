import * as THREE from 'three';

export type Sfx =
  | 'bark'
  | 'bigbark'
  | 'bite'
  | 'chomp'
  | 'scream_m'
  | 'scream_f'
  | 'scream_child'
  | 'scream_old'
  | 'pickup'
  | 'drop'
  | 'steal'
  | 'faint'
  | 'death'
  | 'yelp'
  | 'kick'
  | 'happy'
  | 'evil'
  | 'click'
  | 'splash'
  | 'jump'
  | 'horn'
  | 'crash'
  | 'boom'
  | 'fuse';

/** WebAudio で効果音をその場で合成する（素材ファイル不要） */
export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private lx = 0;
  private lz = 0;
  private lyaw = 0;
  volume = 0.55;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** カメラ位置と向き（yaw）をリスナーとして設定 */
  setListener(pos: THREE.Vector3, camYaw: number) {
    this.lx = pos.x;
    this.lz = pos.z;
    this.lyaw = camYaw;
  }

  play(name: Sfx, pos?: THREE.Vector3, vol = 1, pitch = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    let gain = vol;
    let pan = 0;
    if (pos) {
      const dx = pos.x - this.lx;
      const dz = pos.z - this.lz;
      const d = Math.hypot(dx, dz);
      gain *= Math.max(0, 1 - d / 50) ** 1.5;
      if (gain < 0.01) return;
      const c = Math.cos(this.lyaw);
      const s = Math.sin(this.lyaw);
      pan = Math.max(-1, Math.min(1, (dx * c - dz * s) / Math.max(d, 2)));
    }
    const t = ctx.currentTime + 0.005;
    const out = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan * 0.8;
    out.connect(p).connect(this.master);
    out.gain.value = gain;
    const P = pitch;
    switch (name) {
      case 'bark':
        this.voice(out, t, 'sawtooth', 720 * P, 430 * P, 0.15, 0.9, 1500 * P);
        this.noiseHit(out, t, 0.04, 'bandpass', 2400, 0.35);
        break;
      case 'bigbark': {
        const ws = this.distortion(out, 30);
        this.voice(ws, t, 'sawtooth', 520 * P, 240 * P, 0.42, 1.0, 1100 * P);
        this.voice(ws, t, 'square', 260 * P, 120 * P, 0.42, 0.5, 900 * P);
        this.noiseHit(out, t, 0.12, 'lowpass', 900, 0.6);
        this.echo(out, t, 0.18, 0.35);
        break;
      }
      case 'bite':
        this.noiseHit(out, t, 0.06, 'highpass', 1800, 0.7);
        this.tone(out, t, 'square', 220, 70, 0.07, 0.4);
        break;
      case 'chomp':
        this.noiseHit(out, t, 0.04, 'highpass', 2500, 0.3);
        break;
      case 'scream_m':
        this.scream(out, t, 260 * P, 0.75);
        break;
      case 'scream_f':
        this.scream(out, t, 470 * P, 0.8);
        break;
      case 'scream_child':
        this.scream(out, t, 640 * P, 0.7);
        break;
      case 'scream_old':
        this.scream(out, t, 330 * P, 0.9, 10);
        break;
      case 'pickup':
        this.tone(out, t, 'sine', 660, 990, 0.09, 0.5);
        break;
      case 'drop':
        this.tone(out, t, 'sine', 240, 110, 0.09, 0.5);
        break;
      case 'steal':
        this.tone(out, t, 'triangle', 988, 988, 0.08, 0.45);
        this.tone(out, t + 0.09, 'triangle', 1319, 1319, 0.16, 0.45);
        break;
      case 'faint':
        this.tone(out, t, 'sine', 1500, 160, 0.75, 0.45);
        this.tone(out, t + 0.7, 'triangle', 90, 50, 0.15, 0.6);
        break;
      case 'death':
        this.tone(out, t, 'sine', 110, 38, 0.35, 0.9);
        this.noiseHit(out, t, 0.2, 'lowpass', 600, 0.6);
        break;
      case 'yelp':
        this.voice(out, t, 'sawtooth', 1500 * P, 900 * P, 0.14, 0.7, 2200);
        break;
      case 'kick':
        this.tone(out, t, 'sine', 150, 55, 0.12, 0.9);
        this.noiseHit(out, t, 0.05, 'lowpass', 1200, 0.5);
        break;
      case 'happy':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(out, t + i * 0.085, 'sine', f, f, 0.16, 0.35));
        break;
      case 'evil':
        this.tone(out, t, 'sawtooth', 110, 104, 0.9, 0.25, 600);
        this.tone(out, t, 'sawtooth', 116.5, 110, 0.9, 0.25, 600);
        this.tone(out, t + 0.15, 'sine', 55, 52, 0.8, 0.5);
        break;
      case 'click':
        this.tone(out, t, 'sine', 1100, 1100, 0.03, 0.25);
        break;
      case 'splash':
        this.noiseHit(out, t, 0.25, 'bandpass', 900, 0.5);
        break;
      case 'jump':
        this.tone(out, t, 'sine', 300, 520, 0.1, 0.18);
        break;
      case 'horn':
        this.tone(out, t, 'square', 392, 392, 0.32, 0.22, 1400);
        this.tone(out, t, 'square', 494, 494, 0.32, 0.22, 1400);
        break;
      case 'crash':
        this.noiseHit(out, t, 0.35, 'lowpass', 1800, 0.9);
        this.tone(out, t, 'sine', 120, 40, 0.3, 0.9);
        this.noiseHit(out, t + 0.05, 0.25, 'highpass', 3000, 0.4);
        break;
      case 'boom': {
        const ws = this.distortion(out, 20);
        this.noiseHit(ws, t, 1.4, 'lowpass', 700, 1.0);
        this.tone(ws, t, 'sine', 90, 25, 1.2, 1.0);
        this.noiseHit(out, t, 0.3, 'highpass', 2500, 0.5);
        break;
      }
      case 'fuse':
        this.noiseHit(out, t, 0.5, 'highpass', 5000, 0.25);
        break;
    }
  }

  // ---------- エンジン音（運転中ずっと鳴る） ----------
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; lp: BiquadFilterNode } | null = null;
  engineOn() {
    const ctx = this.ctx;
    if (!ctx || this.engine) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 45;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 22.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    osc.connect(lp);
    osc2.connect(lp);
    lp.connect(gain).connect(this.master);
    osc.start();
    osc2.start();
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.3);
    this.engine = { osc, osc2, gain, lp };
  }
  engineSet(speed01: number) {
    if (!this.engine || !this.ctx) return;
    const f = 45 + speed01 * 130;
    const t = this.ctx.currentTime;
    this.engine.osc.frequency.setTargetAtTime(f, t, 0.08);
    this.engine.osc2.frequency.setTargetAtTime(f / 2, t, 0.08);
    this.engine.lp.frequency.setTargetAtTime(350 + speed01 * 900, t, 0.1);
  }
  engineOff() {
    if (!this.engine || !this.ctx) return;
    const e = this.engine;
    this.engine = null;
    e.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
    e.osc.stop(this.ctx.currentTime + 0.35);
    e.osc2.stop(this.ctx.currentTime + 0.35);
  }

  // ---------- 合成部品 ----------
  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, lp?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.005, dur);
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      o.connect(f).connect(g);
    } else o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** 声っぽい音（フォルマント風バンドパス） */
  private voice(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, formant: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = formant;
    bp.Q.value = 1.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = formant * 2.2;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.008, dur);
    o.connect(bp).connect(g);
    o.connect(lp).connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private scream(dest: AudioNode, t: number, base: number, dur: number, vibHz = 7) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.45, t + dur * 0.25);
    o.frequency.linearRampToValueAtTime(base * 0.9, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = vibHz;
    const lfoG = ctx.createGain();
    lfoG.gain.value = base * 0.06;
    lfo.connect(lfoG).connect(o.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 900;
    f1.Q.value = 2;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 2400;
    f2.Q.value = 3;
    const g = ctx.createGain();
    this.env(g, t, 0.9, 0.03, dur);
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(dest);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
  }

  private noiseHit(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, peak: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.003, dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private distortion(dest: AudioNode, amount: number) {
    const ctx = this.ctx!;
    const ws = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 2 - 1;
      curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
    }
    ws.curve = curve;
    ws.connect(dest);
    return ws;
  }

  private echo(dest: AudioNode, t: number, delay: number, fb: number) {
    const ctx = this.ctx!;
    const d = ctx.createDelay(1);
    d.delayTime.value = delay;
    const g = ctx.createGain();
    g.gain.setValueAtTime(fb, t);
    g.gain.linearRampToValueAtTime(0, t + 1.2);
    dest.connect(d).connect(g).connect(this.master);
  }
}
