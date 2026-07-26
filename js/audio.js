// Sentezlenmiş ses — hiç dosya yok, hepsi WebAudio ile üretiliyor.
// Tek dosyalık pakete sığması ve anında çalması için böyle.

export const sfx = {
  ctx: null,
  on: true,
  master: null,
  lastTick: 0,
  lastSiege: 0,

  // tarayıcılar sesi ancak bir kullanıcı hareketinden sonra açar
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.on = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.28;
    this.master.connect(this.ctx.destination);
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  tone(freq, dur, { type = 'sine', gain = 1, slide = 0, delay = 0 } = {}) {
    if (!this.on || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },

  noise(dur, { gain = 1, freq = 800, delay = 0 } = {}) {
    if (!this.on || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  },

  // --- oyun sesleri ---

  ui() { this.tone(880, 0.045, { type: 'triangle', gain: 0.4 }); },

  attack() {
    this.noise(0.22, { gain: 0.7, freq: 500 });
    this.tone(110, 0.24, { type: 'sine', gain: 0.9, slide: -45 });
  },

  // toprak ele geçirilirken; sık çağrılır, kendi içinde seyreltilir
  capture(streak, now) {
    if (now - this.lastTick < 55) return;
    this.lastTick = now;
    const p = Math.min(streak, 24) / 24;
    this.tone(520 + p * 460, 0.05, { type: 'square', gain: 0.1 + p * 0.09 });
  },

  // Kuşatma sürerken alçak bir uğultu: halka doldukça perde yükselir. Yeni
  // mekanikte hücreler tek tek değil topluca düştüğü için arada sessizlik
  // oluyordu — bu, cephenin "çalıştığını" duyurur.
  siege(p, now) {
    if (now - this.lastSiege < 190) return;
    this.lastSiege = now;
    this.tone(150 + p * 190, 0.13, { type: 'sine', gain: 0.035 + p * 0.03 });
  },

  // Halka düştü: tok bir vuruş, art arda düşen halkalarda perde yükselir.
  ring(k) {
    const p = Math.min(k, 6) / 6;
    this.tone(88, 0.16, { type: 'sine', gain: 0.3 });
    this.tone(300 + p * 220, 0.12, { type: 'triangle', gain: 0.16, delay: 0.03 });
  },

  // arazi geliri yattı — 10 tikte bir
  income() {
    this.tone(784, 0.11, { type: 'triangle', gain: 0.22 });
    this.tone(1047, 0.16, { type: 'triangle', gain: 0.18, delay: 0.07 });
  },

  ally() {
    [523, 659, 784].forEach((f, i) =>
      this.tone(f, 0.3, { type: 'triangle', gain: 0.35, delay: i * 0.06 }));
  },

  betray() {
    this.tone(300, 0.45, { type: 'sawtooth', gain: 0.3, slide: -140 });
    this.noise(0.3, { gain: 0.35, freq: 300 });
  },

  death() {
    [440, 349, 262].forEach((f, i) =>
      this.tone(f, 0.4, { type: 'triangle', gain: 0.4, delay: i * 0.11 }));
  },

  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.9, { type: 'triangle', gain: 0.45, delay: i * 0.13 }));
  },

  lose() {
    [330, 262, 196, 147].forEach((f, i) =>
      this.tone(f, 1.0, { type: 'sawtooth', gain: 0.3, delay: i * 0.17 }));
  },
};
