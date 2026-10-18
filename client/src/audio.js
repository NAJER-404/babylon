// Web Audio API Procedural Synthesizer: Pre-Allocated Noise Buffers & Auto-Resume on User Interaction
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.volume = 0.5;
    this.isMuted = false;
    this.initialized = false;

    // Pre-allocated noise buffers (zero GC per shot)
    this.sniperNoiseBuffer = null;
    this.shortNoiseBuffer = null;

    this.setupAutoResume();
  }

  setupAutoResume() {
    // Browsers block AudioContext until first user interaction
    const resumeHandler = () => {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    };

    ['click', 'keydown', 'pointerdown'].forEach(evt => {
      window.addEventListener(evt, resumeHandler, { once: false, passive: true });
    });
  }

  init() {
    if (this.initialized && this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Pre-allocate shared noise buffers once during initialization
      this.sniperNoiseBuffer = this.generateNoiseBuffer(0.25);
      this.shortNoiseBuffer = this.generateNoiseBuffer(0.12);

      this.initialized = true;
    } catch (e) {
      console.warn('Web Audio API not supported or blocked:', e);
    }
  }

  generateNoiseBuffer(durationSec = 0.2) {
    if (!this.ctx) return null;
    const bufferSize = Math.floor(this.ctx.sampleRate * durationSec);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  getVolume() {
    return this.volume;
  }

  // Heavy .50 Cal Sniper Rifle Shot: Massive explosion, sub-bass kick & whip crack
  playSniperShot() {
    this.init();
    if (!this.ctx || this.volume <= 0 || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;

    // 1. Heavy blast noise from pre-allocated buffer
    if (this.sniperNoiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.sniperNoiseBuffer;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(3600, t);
      noiseFilter.frequency.exponentialRampToValueAtTime(350, t + 0.22);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(1.0, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.masterGain);

      noise.start(t);
      noise.stop(t + 0.25);
    }

    // 2. Heavy sub-bass earthquake kick
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.32);

    oscGain.gain.setValueAtTime(1.0, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.35);

    // 3. High sonic whip crack
    this.playTone(3800, 'sawtooth', 0.05, t, 0.45);
    this.playTone(1200, 'square', 0.08, t + 0.03, 0.3);
  }

  // Combat Knife Attack Whoosh
  playKnifeSwing() {
    this.init();
    if (!this.ctx || this.volume <= 0 || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;

    // Fast high-pitch whoosh
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.16);

    oscGain.gain.setValueAtTime(0.4, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.18);

    // Air friction hiss
    if (this.shortNoiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.shortNoiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, t);
      filter.Q.setValueAtTime(2.0, t);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      noise.start(t);
      noise.stop(t + 0.14);
    }
  }

  // Knife Impact Flesh / Metallic Slice
  playKnifeHit() {
    this.init();
    if (!this.ctx || this.volume <= 0 || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;
    this.playTone(450, 'sawtooth', 0.08, t, 0.5);
    this.playTone(180, 'sine', 0.14, t + 0.02, 0.6);
  }

  // Weapon Switch Gear Rustle
  playWeaponSwitch() {
    this.init();
    if (!this.ctx || this.volume <= 0 || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;
    this.playTone(950, 'triangle', 0.05, t, 0.25);
    this.playTone(1450, 'sine', 0.06, t + 0.08, 0.2);
  }

  // Alias for generic shot trigger
  playShot() {
    this.playSniperShot();
  }

  // Authentic 2.6-Second Bolt Action Sniper Reload Sequence
  playSniperReload() {
    this.init();
    if (!this.ctx || this.volume <= 0 || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;

    // T+0.15s: Bolt handle lift up
    this.playTone(1300, 'sawtooth', 0.05, t + 0.15, 0.4);
    this.playTone(850, 'sine', 0.06, t + 0.18, 0.3);

    // T+0.65s: Bolt drawn backward & empty casing ejects
    this.playTone(950, 'triangle', 0.06, t + 0.65, 0.35);
    this.playTone(2200, 'sawtooth', 0.04, t + 0.75, 0.25);

    // T+1.35s: Fresh .50 BMG round chambered
    this.playTone(600, 'sine', 0.08, t + 1.35, 0.4);
    this.playTone(1450, 'square', 0.04, t + 1.45, 0.35);

    // T+2.05s: Bolt pushed forward into battery & handle locked down
    this.playTone(1100, 'sawtooth', 0.06, t + 2.05, 0.45);
    this.playTone(450, 'triangle', 0.10, t + 2.12, 0.5);
  }

  playReload() {
    this.playSniperReload();
  }

  playHitMarker(isHeadshot = false) {
    this.init();
    if (!this.ctx || this.volume <= 0 || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;
    if (isHeadshot) {
      this.playTone(2800, 'triangle', 0.08, t, 0.4);
      this.playTone(4200, 'sine', 0.08, t, 0.3);
    } else {
      this.playTone(1800, 'sine', 0.06, t, 0.35);
    }
  }

  playHurt() {
    this.init();
    if (!this.ctx || this.volume <= 0 || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.15);

    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.18);
  }

  playDeath() {
    this.init();
    if (!this.ctx || this.volume <= 0 || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.8);

    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.85);
  }

  playRespawn() {
    this.init();
    if (!this.ctx || this.volume <= 0 || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(660, t + 0.3);

    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.35);
  }

  playClick() {
    this.init();
    if (!this.ctx || this.volume <= 0 || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;
    this.playTone(880, 'sine', 0.03, t, 0.2);
  }

  playTone(freq, type, duration, startTime, peakGain = 0.3) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(peakGain, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch (e) {}
  }
}
