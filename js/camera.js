/* FlipDrive: EV Chaos - camera.js
 * Cinematic tracking camera. It only reads the simulation; nothing here feeds back into physics.
 *   - smooth tracking with speed look-ahead
 *   - low, tilted framing on ramp approaches
 *   - launch zoom punch, then a pullback sized to keep the car AND the predicted landing in view
 *   - trauma-based impact shake
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});
  const U = FD.Units, M = FD.M;

  /** Ballistic prediction of where a body leaving the ground now would land. Returns world-space point or null. */
  function predictLanding(terrain, x, y, vx, vy, waterY) {
    const g = U.g();
    let px = x, py = y, pvx = vx, pvy = vy;
    const dt = 0.05;
    for (let i = 0; i < 240; i++) {
      const nx = px + pvx * dt, ny = py + pvy * dt - 0.5 * g * dt * dt;
      pvy -= g * dt;
      if (pvy < 0) {
        const hit = terrain.rayCast(px, py, nx - px, ny - py, 1);
        if (hit) return { x: hit.x, y: hit.y, ground: true };
        if (waterY > -1e5 && ny < waterY) return { x: nx, y: waterY, ground: false };
      }
      px = nx; py = ny;
    }
    return null;
  }

  class Camera {
    constructor() {
      this.x = 0; this.y = 0; this.zoom = 1; this.roll = 0;
      this.viewFt = 70; // visible height in feet
      this.trauma = 0;
      this.punch = 0;
      this.shakeX = 0; this.shakeY = 0; this.shakeR = 0;
      this.t = 0;
      this.landing = null;
      this.mode = 'follow';
      this.rampBlend = 0; this.airBlend = 0;
      this.settled = false;
    }
    addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }
    snap() { this.settled = false; this.trauma = 0; this.punch = 0; }

    /**
     * s: {x,y,vx,vy (world units), state, airDur, terrain, waterY, aspect, shakeScale, cinematic}
     */
    update(dt, s) {
      this.t += dt;
      const PPF = U.PPF;
      const speedFt = Math.hypot(s.vx, s.vy) / PPF;
      const inAir = s.state === 'air';
      const onRamp = s.state === 'ramp';
      this.rampBlend = M.damp(this.rampBlend, onRamp ? 1 : 0, 3, dt);
      this.airBlend = M.damp(this.airBlend, inAir ? 1 : 0, inAir ? 2.2 : 1.6, dt);

      // altitude above whatever is below the car
      let alt = 0;
      if (s.terrain) {
        const h = s.terrain.heightAt(s.x, s.y + U.len(2));
        alt = h === null ? 400 : Math.max(0, (s.y - h) / PPF);
        if (s.waterY > -1e5 && (h === null || h < s.waterY)) alt = Math.max(0, (s.y - s.waterY) / PPF);
      }
      this.alt = alt;

      // landing prediction while airborne
      if (inAir && s.terrain) {
        this.predT = (this.predT || 0) - dt;
        if (this.predT <= 0) { this.predT = 0.12; this.landing = predictLanding(s.terrain, s.x, s.y, s.vx, s.vy, s.waterY); }
      } else if (!inAir) { this.landing = null; }

      /* ---- target view height (ft) ---- */
      let view = 66 + Math.min(26, speedFt * 0.12);
      view = M.lerp(view, 52, this.rampBlend * 0.9);       // closer, more dramatic on the ramp
      let airView = 66 + Math.min(150, alt * 0.55) + Math.min(60, (s.airDur || 0) * 18);
      if (this.landing) {
        const dx = Math.abs(this.landing.x - s.x) / PPF;
        const needW = dx * 1.45 + 70;                          // keep car and landing zone both inside the frame
        airView = Math.max(airView, needW / Math.max(0.6, s.aspect));
        const dy = Math.abs(this.landing.y - s.y) / PPF;
        airView = Math.max(airView, dy * 1.5 + 40);
      }
      view = M.lerp(view, Math.min(airView, 420), this.airBlend);
      if (s.state === 'crashed') view = M.lerp(view, 48, 0.7);
      if (s.state === 'title') view = s.titleView || 90;
      // launch punch: a short zoom-in as the car leaves the lip, released into the pullback
      this.punch = Math.max(0, this.punch - dt * 1.4);
      view *= 1 - 0.12 * this.punch;
      this.viewFt = M.damp(this.viewFt, view, inAir ? 2.4 : 3.2, dt);

      /* ---- target position ---- */
      const look = s.state === 'crashed' ? 0 : M.clamp(s.vx / PPF, -150, 180) * 0.42;
      let tx = s.x + U.len(look);
      let ty = s.y + U.len(this.viewFt * 0.08);
      if (onRamp || this.rampBlend > 0.05) ty -= U.len(this.viewFt * 0.20) * this.rampBlend; // low angle: car sits high in frame
      if (this.landing && this.airBlend > 0.05) {
        const w = 0.55 * this.airBlend;
        tx = M.lerp(tx, (s.x + this.landing.x) / 2, w);
        ty = M.lerp(ty, (s.y + this.landing.y) / 2 + U.len(this.viewFt * 0.06), w);
      } else if (inAir && alt > 40) {
        ty -= U.len(Math.min(40, alt * 0.2));
      }
      if (!this.settled) { this.x = tx; this.y = ty; this.settled = true; }
      const lam = s.state === 'title' ? 1.2 : inAir ? 2.8 : 5;
      this.x = M.damp(this.x, tx, lam, dt);
      this.y = M.damp(this.y, ty, lam * 0.9, dt);

      /* ---- roll: lean into the ramp for a low-angle feel ---- */
      const rollTarget = -0.055 * this.rampBlend + (s.state === 'title' ? -0.02 : 0);
      this.roll = M.damp(this.roll, rollTarget, 3, dt);

      /* ---- shake ---- */
      this.trauma = Math.max(0, this.trauma - dt * 1.5);
      const k = this.trauma * this.trauma * (s.shakeScale === undefined ? 1 : s.shakeScale);
      const tt = this.t * 38;
      this.shakeX = k * 22 * (Math.sin(tt * 1.3) + Math.sin(tt * 2.9 + 1.7) * 0.5);
      this.shakeY = k * 18 * (Math.sin(tt * 1.7 + 0.5) + Math.sin(tt * 3.3) * 0.5);
      this.shakeR = k * 0.025 * Math.sin(tt * 1.1 + 2.1);
    }

    /** zoom for a given canvas pixel height */
    pxZoom(h) { return h / (this.viewFt * U.PPF); }
  }

  FD.Camera = Camera;
  FD.predictLanding = predictLanding;
})(typeof window !== 'undefined' ? window : globalThis);
