/* FlipDrive: EV Chaos - util.js
 * Unit system + math helpers.
 *
 * Physics runs in "world units". One foot = Units.PPF world units (pixels at zoom 1).
 * Gravity is 32.2 ft/s^2 converted with the same scale, so changing PPF never changes
 * how the game plays (tests/headless.js verifies this invariance).
 *
 * Conversions (derived from F = m a, with mass kept in slugs):
 *   length, speed, accel : x PPF
 *   force (lbf)          : x PPF
 *   torque, inertia      : x PPF^2
 *   spring k, damper c   : unchanged (force / length scale identically)
 *   quadratic drag coeff : / PPF
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});

  const Units = {
    PPF: 8,
    G_FT: 32.2,
    RHO_WATER: 62.4, // lbf per cubic foot
    setPPF(v) { this.PPF = v; },
    len(ft) { return ft * this.PPF; },
    toFt(w) { return w / this.PPF; },
    force(lbf) { return lbf * this.PPF; },
    torque(lbfFt) { return lbfFt * this.PPF * this.PPF; },
    inertia(slugFt2) { return slugFt2 * this.PPF * this.PPF; },
    quad(c) { return c / this.PPF; },
    g() { return this.G_FT * this.PPF; },
    toMph(w) { return (w / this.PPF) * 0.681818; },
    toFtPerSec(w) { return w / this.PPF; }
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  // frame-rate independent exponential smoothing
  const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
  const rand = (a, b) => a + Math.random() * (b - a);
  const mulberry32 = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const mix = (c1, c2, t) => {
    // c = [r,g,b]
    return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
  };
  const rgb = (c, a) => (a === undefined ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')');

  // Safe localStorage wrapper (private mode, file:// quirks, etc.)
  const Store = {
    mem: {},
    get(key, fallback) {
      try {
        const v = root.localStorage && root.localStorage.getItem('flipdrive.' + key);
        if (v === null || v === undefined) return key in this.mem ? this.mem[key] : fallback;
        return JSON.parse(v);
      } catch (e) { return key in this.mem ? this.mem[key] : fallback; }
    },
    set(key, value) {
      this.mem[key] = value;
      try { root.localStorage && root.localStorage.setItem('flipdrive.' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  FD.Units = Units;
  FD.M = { clamp, lerp, invLerp, smooth, damp, wrapPi, rand, mulberry32, mix, rgb };
  FD.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
