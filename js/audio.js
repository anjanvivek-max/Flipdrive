/* FlipDrive: EV Chaos - audio.js
 * All sound is synthesised with the Web Audio API, so there are no asset files to go missing.
 *   engine : sawtooth drone + rising electric whine
 *   wind, tyres, water wake : filtered noise beds driven by the simulation
 *   one-shots : impacts, launch bass hit, landing chimes, splashes, rings, countdown, fanfare
 *   music : a small generative synthwave loop (optional)
 * If the browser has no Web Audio the module silently turns into no-ops.
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});
  const M = FD.M;

  const A = {
    ok: false,
    started: false,
    ctx: null,
    vol: { master: 0.8, sfx: 0.9, music: 0.45 },
    muted: false,
    musicOn: true,
    slow: 0,
    _beds: null,
    _music: null,

    loadSettings() {
      const s = FD.Store.get('audio', null);
      if (s) {
        this.vol.master = M.clamp(+s.master, 0, 1); this.vol.sfx = M.clamp(+s.sfx, 0, 1); this.vol.music = M.clamp(+s.music, 0, 1);
        this.muted = !!s.muted; this.musicOn = s.musicOn !== false;
      }
    },
    saveSettings() { FD.Store.set('audio', { master: this.vol.master, sfx: this.vol.sfx, music: this.vol.music, muted: this.muted, musicOn: this.musicOn }); },

    /** Must be called from a user gesture. Safe to call repeatedly. */
    init() {
      if (this.started) { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); return; }
      this.started = true;
      try {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return;
        const ctx = (this.ctx = new AC());
        this.master = ctx.createGain();
        this.sfx = ctx.createGain();
        this.musicBus = ctx.createGain();
        this.musicFilter = ctx.createBiquadFilter();
        this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 18000;
        this.comp = ctx.createDynamicsCompressor();
        this.comp.threshold.value = -14; this.comp.ratio.value = 5; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
        this.sfx.connect(this.master);
        this.musicBus.connect(this.musicFilter); this.musicFilter.connect(this.master);
        this.master.connect(this.comp); this.comp.connect(ctx.destination);
        // 2 s of white noise, looped by the beds and sliced by the one-shots
        const len = ctx.sampleRate * 2;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        let b0 = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + 0.03 * w; d[i] = w * 0.7 + b0 * 2.2; }
        this.ok = true;
        this.applyVolumes();
        this.buildBeds();
        this.startMusic();
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) { this.ok = false; }
    },

    applyVolumes() {
      if (!this.ok) return;
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol.master, t, 0.03);
      this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.03);
      this.musicBus.gain.setTargetAtTime(this.musicOn ? this.vol.music * 0.5 : 0, t, 0.05);
    },
    setVolume(kind, v) { this.vol[kind] = M.clamp(v, 0, 1); this.applyVolumes(); this.saveSettings(); },
    setMuted(m) { this.muted = !!m; this.applyVolumes(); this.saveSettings(); },
    toggleMute() { this.setMuted(!this.muted); return this.muted; },
    setMusic(on) { this.musicOn = !!on; this.applyVolumes(); this.saveSettings(); },

    /* ------------------------------------------------------------ beds */
    buildBeds() {
      const ctx = this.ctx;
      const mk = (type, freq) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; return o; };
      const beds = (this._beds = {});
      // engine
      beds.eng = { saw: mk('sawtooth', 60), sub: mk('triangle', 30), whine: mk('sine', 300), whine2: mk('square', 600) };
      beds.engLP = ctx.createBiquadFilter(); beds.engLP.type = 'lowpass'; beds.engLP.frequency.value = 500; beds.engLP.Q.value = 2;
      beds.engGain = ctx.createGain(); beds.engGain.gain.value = 0;
      beds.whGain = ctx.createGain(); beds.whGain.gain.value = 0;
      beds.wh2Gain = ctx.createGain(); beds.wh2Gain.gain.value = 0;
      beds.eng.saw.connect(beds.engLP); beds.eng.sub.connect(beds.engLP);
      beds.engLP.connect(beds.engGain); beds.engGain.connect(this.sfx);
      beds.eng.whine.connect(beds.whGain); beds.whGain.connect(this.sfx);
      beds.eng.whine2.connect(beds.wh2Gain); beds.wh2Gain.connect(this.sfx);
      Object.values(beds.eng).forEach((o) => o.start());
      const loopNoise = (type, f, q) => {
        const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
        const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q || 0.7;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(flt); flt.connect(g); g.connect(this.sfx); src.start();
        return { src, flt, g };
      };
      beds.wind = loopNoise('bandpass', 700, 0.5);
      beds.tire = loopNoise('bandpass', 1600, 1.4);
      beds.water = loopNoise('lowpass', 900, 0.8);
      beds.rumble = loopNoise('lowpass', 160, 0.7);
    },

    /** s: {speedN, throttle, boosting, air, skid, wet, active, rumble} - called every frame. */
    update(s) {
      if (!this.ok) return;
      const t = this.ctx.currentTime, b = this._beds, on = s.active ? 1 : 0;
      const sp = M.clamp(s.speedN, 0, 1.4);
      const thr = s.throttle || 0;
      const load = s.air ? 0.25 : 1;
      const base = 38 + sp * 130 + (s.boosting ? 22 : 0);
      b.eng.saw.frequency.setTargetAtTime(base, t, 0.06);
      b.eng.sub.frequency.setTargetAtTime(base * 0.5, t, 0.06);
      b.eng.whine.frequency.setTargetAtTime(240 + sp * 1500 + (s.boosting ? 260 : 0), t, 0.05);
      b.eng.whine2.frequency.setTargetAtTime(480 + sp * 2900, t, 0.05);
      b.engLP.frequency.setTargetAtTime(260 + sp * 1000 + thr * 450, t, 0.08);
      b.engGain.gain.setTargetAtTime(on * (0.045 + 0.075 * thr * load + 0.02 * sp), t, 0.08);
      b.whGain.gain.setTargetAtTime(on * (0.012 + 0.04 * Math.min(1, sp * 1.2) * (0.35 + 0.65 * thr)), t, 0.08);
      b.wh2Gain.gain.setTargetAtTime(on * 0.004 * Math.min(1, sp * 1.3), t, 0.08);
      b.wind.g.gain.setTargetAtTime(on * M.clamp((sp - 0.15) * 0.5, 0, 0.5) * (s.air ? 1.35 : 0.8), t, 0.1);
      b.wind.flt.frequency.setTargetAtTime(500 + sp * 1800, t, 0.1);
      b.tire.g.gain.setTargetAtTime(on * (s.skid || 0) * 0.16, t, 0.04);
      b.water.g.gain.setTargetAtTime(on * (s.wet || 0) * M.clamp(sp * 1.5, 0.15, 1) * 0.32, t, 0.08);
      b.rumble.g.gain.setTargetAtTime(on * (s.rumble || 0) * 0.35, t, 0.05);
      // cinematic slow motion: muffle the music and drop the engine
      this.musicFilter.frequency.setTargetAtTime(M.lerp(18000, 520, this.slow), t, 0.12);
    },
    silence() { this.update({ speedN: 0, throttle: 0, active: false }); },

    /* ------------------------------------------------------ one-shots */
    _g(gain, t, dur, attack) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + (attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(this.sfx);
      return g;
    },
    burst(dur, type, f0, f1, gain, q, delay) {
      if (!this.ok) return;
      const ctx = this.ctx, t = ctx.currentTime + (delay || 0);
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.Q.value = q || 0.8;
      flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      const g = this._g(gain, t, dur, 0.006);
      src.connect(flt); flt.connect(g);
      src.start(t, Math.random() * 1.2, dur + 0.05);
    },
    tone(type, f0, f1, dur, gain, delay, attack) {
      if (!this.ok) return;
      const ctx = this.ctx, t = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = this._g(gain, t, dur, attack);
      o.connect(g); o.start(t); o.stop(t + dur + 0.05);
    },
    impact(strength) {
      if (!this.ok) return; const s = M.clamp(strength, 0.05, 1);
      this.tone('sine', 150, 38, 0.28 + s * 0.3, 0.6 * s + 0.1);
      this.burst(0.12 + s * 0.2, 'bandpass', 2400, 400, 0.5 * s + 0.05, 0.9);
      if (s > 0.3) this.tone('square', 210 + Math.random() * 60, 90, 0.12, 0.08 * s);
    },
    launch(strength) {
      if (!this.ok) return; const s = M.clamp(strength, 0.3, 1);
      this.tone('sine', 95, 26, 1.1, 0.95 * s);
      this.tone('triangle', 190, 50, 0.5, 0.25 * s);
      this.burst(0.9, 'bandpass', 180, 3000, 0.4 * s, 0.7);
    },
    whoosh() { this.burst(0.35, 'bandpass', 500, 2600, 0.22, 1.2); },
    landing(grade) {
      if (!this.ok) return;
      if (grade === 'perfect') { [660, 880, 1320, 1760].forEach((f, i) => this.tone('sine', f, f, 0.5, 0.2, i * 0.07)); }
      else if (grade === 'good') { [660, 990].forEach((f, i) => this.tone('sine', f, f, 0.4, 0.16, i * 0.08)); }
      else this.tone('triangle', 130, 60, 0.3, 0.2);
    },
    splash(strength) {
      if (!this.ok) return; const s = M.clamp(strength, 0.1, 1);
      this.burst(0.5 + s * 0.8, 'lowpass', 3800, 260, 0.6 * s + 0.1, 0.6);
      this.burst(0.3, 'highpass', 4000, 6000, 0.12 * s, 0.7);
      this.tone('sine', 120, 45, 0.5, 0.5 * s);
      for (let i = 0; i < 4; i++) this.tone('sine', 400 + Math.random() * 500, 160, 0.09, 0.04 * s, 0.12 + i * 0.09 + Math.random() * 0.05);
    },
    ring(n) { const f = 880 * Math.pow(1.0595, Math.min(12, (n || 1) - 1)); this.tone('sine', f, f * 1.5, 0.22, 0.2); this.tone('triangle', f * 2, f * 2, 0.16, 0.06, 0.04); },
    tick(n) { this.tone('square', 440, 440, 0.16, 0.12); },
    go() { this.tone('square', 880, 880, 0.5, 0.14); this.tone('sawtooth', 220, 440, 0.4, 0.1); },
    checkpoint() { this.tone('sine', 660, 660, 0.2, 0.18); this.tone('sine', 990, 990, 0.3, 0.18, 0.12); },
    crash() { this.tone('sine', 90, 28, 1.0, 0.9); this.burst(0.7, 'lowpass', 2600, 160, 0.6, 0.6); this.burst(0.25, 'highpass', 3000, 6000, 0.25, 0.8, 0.02); },
    stunt() { this.tone('triangle', 520, 780, 0.12, 0.1); },
    finish() { [523, 659, 784, 1047].forEach((f, i) => { this.tone('sawtooth', f, f, 0.9, 0.08, i * 0.12); this.tone('sine', f * 2, f * 2, 0.9, 0.05, i * 0.12); }); },
    click() { this.tone('square', 600, 420, 0.06, 0.07); },

    /* --------------------------------------------------------- music */
    startMusic() {
      if (!this.ok || this._music) return;
      const ctx = this.ctx;
      const bpm = 98, spb = 60 / bpm, step = spb / 4;
      const rootHz = 55; // A1
      // Am F C G, one bar each: semitone offsets from A
      const prog = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
      const rootsOf = [0, -4, 3, -2];
      const hz = (semi, oct) => rootHz * Math.pow(2, (semi + 12 * oct) / 12);
      const m = (this._music = { next: ctx.currentTime + 0.1, i: 0, id: null });
      const note = (type, f, t, dur, gain, dest, cutoff) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        let node = o;
        if (cutoff) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; o.connect(lp); node = lp; }
        node.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
      };
      const schedule = () => {
        while (m.next < ctx.currentTime + 0.25) {
          const s = m.i % 64, bar = Math.floor(s / 16) % 4, k = s % 16, t = m.next;
          const chord = prog[bar];
          if (k % 4 === 0) { // kick
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
            const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
            o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.22);
          }
          if (k % 4 === 2) { // hat
            const src = ctx.createBufferSource(); src.buffer = this.noise;
            const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
            const g = ctx.createGain(); g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
            src.connect(hp); hp.connect(g); g.connect(this.musicBus); src.start(t, Math.random(), 0.06);
          }
          if (k === 4 || k === 12) { // snare
            const src = ctx.createBufferSource(); src.buffer = this.noise;
            const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.6;
            const g = ctx.createGain(); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
            src.connect(bp); bp.connect(g); g.connect(this.musicBus); src.start(t, Math.random(), 0.18);
          }
          // off-beat bass
          if (k % 2 === 0 && k % 4 !== 0 || k === 0) note('sawtooth', hz(rootsOf[bar], 1), t, step * 1.8, 0.2, this.musicBus, 520);
          // arpeggio
          const idx = [0, 1, 2, 1, 2, 1, 0, 1, 2, 1, 2, 1, 0, 2, 1, 2][k];
          note('square', hz(chord[idx], 3), t, step * 0.9, 0.05, this.musicBus, 2400);
          // pad on bar start
          if (k === 0) chord.forEach((semi) => { note('sawtooth', hz(semi, 2), t, spb * 4 * 0.96, 0.035, this.musicBus, 900); note('sawtooth', hz(semi, 2) * 1.006, t, spb * 4 * 0.96, 0.03, this.musicBus, 900); });
          m.next += step; m.i++;
        }
      };
      m.id = root.setInterval(schedule, 60);
    }
  };

  FD.Audio = A;
})(typeof window !== 'undefined' ? window : globalThis);
