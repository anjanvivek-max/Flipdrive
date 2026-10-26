/* FlipDrive: EV Chaos - fx.js
 * Pooled particle system: dust, tyre smoke, sparks, debris shards, water drops, foam, mist,
 * wake rings, boost glow, ring bursts and confetti. Purely visual - never read by the simulation.
 * Positions/velocities are world units (1 ft = PPF units).
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});
  const U = FD.Units, M = FD.M;
  const MAX = 900;
  const TAU = Math.PI * 2;

  const DUST = { road: [196, 186, 200], ramp: [190, 184, 196], deck: [196, 186, 200], roof: [170, 170, 184], sand: [236, 204, 148], rock: [150, 130, 120], dirt: [190, 112, 72], steel: [180, 190, 200] };

  class Fx {
    constructor() {
      this.p = [];
      for (let i = 0; i < MAX; i++) this.p.push({ on: false });
      this.cursor = 0;
      this.quality = 1;
      this.count = 0;
    }
    clear() { for (const q of this.p) q.on = false; this.count = 0; }
    alloc() {
      for (let i = 0; i < MAX; i++) {
        const q = this.p[(this.cursor + i) % MAX];
        if (!q.on) { this.cursor = (this.cursor + i + 1) % MAX; q.on = true; return q; }
      }
      const q = this.p[this.cursor]; this.cursor = (this.cursor + 1) % MAX; q.on = true; return q; // recycle oldest
    }
    make(type, x, y, vx, vy, life, size, size1, color, a0, o) {
      const q = this.alloc();
      q.type = type; q.x = x; q.y = y; q.vx = vx; q.vy = vy; q.life = life; q.max = life;
      q.size = size; q.size1 = size1; q.c = color; q.a0 = a0;
      q.grav = 0; q.drag = 0; q.rot = Math.random() * TAU; q.vr = 0; q.water = false; q.add = false; q.bounce = 0; q.h = 0; q.delay = 0; q.screen = false;
      if (o) for (const k in o) q[k] = o[k];
      return q;
    }
    n(base) { return Math.max(1, Math.round(base * this.quality)); }

    /* ---------------------------------------------------------- emitters */
    dust(x, y, nx, ny, speedFt, amount, tag) {
      const c = DUST[tag] || DUST.road;
      const n = this.n(amount);
      for (let i = 0; i < n; i++) {
        const sp = U.len(speedFt) * (0.12 + Math.random() * 0.25);
        const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 1.3;
        this.make('soft', x, y, Math.cos(a) * sp - U.len(speedFt) * 0.08, Math.sin(a) * sp + U.len(4 + Math.random() * 6),
          0.5 + Math.random() * 0.7, U.len(0.7 + Math.random() * 0.8), U.len(2.8 + Math.random() * 2.6), c, 0.34, { drag: 1.6, grav: -U.g() * 0.04 });
      }
    }
    smoke(x, y, vx, vy, amount) {
      const n = this.n(amount);
      for (let i = 0; i < n; i++) {
        this.make('soft', x + (Math.random() - 0.5) * U.len(0.8), y, vx * 0.3 + (Math.random() - 0.5) * U.len(6), vy * 0.2 + U.len(3 + Math.random() * 6),
          0.7 + Math.random() * 0.9, U.len(0.9), U.len(3.6 + Math.random() * 2), [226, 226, 234], 0.3, { drag: 1.2, grav: -U.g() * 0.05 });
      }
    }
    sparks(x, y, nx, ny, speedFt, amount) {
      const n = this.n(amount);
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 2.0;
        const sp = U.len(speedFt) * (0.2 + Math.random() * 0.7);
        this.make('spark', x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + Math.random() * 0.5, U.len(0.2), U.len(0.1),
          Math.random() < 0.5 ? [255, 214, 120] : [255, 150, 60], 1, { grav: U.g() * 0.7, add: true, drag: 0.4 });
      }
    }
    debris(x, y, vx, vy, amount, colors) {
      const n = this.n(amount);
      colors = colors || [[168, 176, 186], [90, 98, 108], [220, 226, 232]];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = U.len(10 + Math.random() * 38);
        this.make('shard', x, y, vx * 0.45 + Math.cos(a) * sp, vy * 0.3 + Math.abs(Math.sin(a)) * sp + U.len(8),
          1.4 + Math.random() * 1.6, U.len(0.35 + Math.random() * 0.7), 0, colors[(Math.random() * colors.length) | 0], 1,
          { grav: U.g() * 0.9, vr: (Math.random() - 0.5) * 16, bounce: 0.35, drag: 0.15 });
      }
    }
    splash(x, y, strength, vxFt) {
      const s = M.clamp(strength, 0.1, 1);
      const nd = this.n(18 + 70 * s);
      for (let i = 0; i < nd; i++) {
        const a = (Math.PI / 2) + (Math.random() - 0.5) * 1.5;
        const sp = U.len((18 + Math.random() * 60) * (0.35 + s));
        this.make('drop', x + (Math.random() - 0.5) * U.len(12 * s), y, Math.cos(a) * sp + U.len(vxFt) * 0.35, Math.sin(a) * sp,
          0.9 + Math.random() * 1.1, U.len(0.35 + Math.random() * 0.45), 0, [214, 238, 255], 0.9, { grav: U.g() * 0.95, water: true });
      }
      const nm = this.n(8 + 22 * s);
      for (let i = 0; i < nm; i++) {
        this.make('soft', x + (Math.random() - 0.5) * U.len(18 * s), y + U.len(0.6), (Math.random() - 0.5) * U.len(30 * s) + U.len(vxFt) * 0.25, U.len(6 + Math.random() * 22 * s),
          0.8 + Math.random() * 1.0, U.len(2.4 + Math.random() * 2), U.len(6 + Math.random() * 8 * s), [226, 242, 255], 0.26, { drag: 1.5, grav: -U.g() * 0.05 });
      }
      for (let k = 0; k < 3; k++) this.make('ring', x, y, 0, 0, 1.3 + k * 0.3, U.len(2), U.len((16 + k * 10) * (0.5 + s)), [235, 248, 255], 0.55 - k * 0.12, { delay: k * 0.1 });
    }
    wake(x, y, vxFt, amount) {
      const n = this.n(amount);
      for (let i = 0; i < n; i++) {
        this.make('soft', x + (Math.random() - 0.5) * U.len(4), y + U.len(0.3), -U.len(vxFt) * (0.1 + Math.random() * 0.2), U.len(2 + Math.random() * 6),
          0.7 + Math.random() * 0.6, U.len(1.4), U.len(4.4 + Math.random() * 2.4), [240, 250, 255], 0.5, { drag: 1.0, grav: -U.g() * 0.02 });
      }
      if (Math.random() < 0.5 * this.quality) {
        this.make('drop', x, y, -U.len(vxFt) * 0.25 + (Math.random() - 0.5) * U.len(8), U.len(8 + Math.random() * 14), 0.7, U.len(0.3), 0, [214, 238, 255], 0.8, { grav: U.g(), water: true });
      }
    }
    bubble(x, y) {
      this.make('bubble', x, y, (Math.random() - 0.5) * U.len(4), U.len(6 + Math.random() * 8), 1.2, U.len(0.35 + Math.random() * 0.4), 0, [220, 245, 255], 0.6, { drag: 0.5 });
    }
    boost(x, y, dx, dy, speedFt) {
      const n = this.n(3);
      for (let i = 0; i < n; i++) {
        const sp = U.len(18 + Math.random() * 24);
        this.make('glow', x, y, dx * sp + (Math.random() - 0.5) * U.len(5) - U.len(speedFt) * 0.05, dy * sp + (Math.random() - 0.5) * U.len(5),
          0.22 + Math.random() * 0.2, U.len(0.9), U.len(0.1), Math.random() < 0.5 ? [90, 220, 255] : [220, 245, 255], 0.9, { add: true, drag: 1.8 });
      }
    }
    ringBurst(x, y) {
      const n = this.n(26);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, sp = U.len(26 + Math.random() * 26);
        this.make('spark', x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.55 + Math.random() * 0.3, U.len(0.25), U.len(0.1), Math.random() < 0.5 ? [255, 224, 120] : [90, 230, 255], 1, { add: true, grav: U.g() * 0.15, drag: 2.4 });
      }
      this.make('ring', x, y, 0, 0, 0.5, U.len(3), U.len(15), [255, 228, 140], 0.9, { screen: true });
    }
    confetti(x, y) {
      const cols = [[255, 122, 47], [59, 232, 255], [255, 210, 63], [93, 255, 176], [255, 69, 96]];
      const n = this.n(90);
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = U.len(30 + Math.random() * 70);
        this.make('shard', x + (Math.random() - 0.5) * U.len(40), y, Math.cos(a) * sp, Math.sin(a) * sp, 2.2 + Math.random() * 1.5, U.len(0.5 + Math.random() * 0.6), 0,
          cols[(Math.random() * cols.length) | 0], 1, { grav: U.g() * 0.28, vr: (Math.random() - 0.5) * 14, drag: 0.9 });
      }
    }

    /* ----------------------------------------------------------- update */
    update(dt, waterY, terrain) {
      let live = 0;
      const g = U.g();
      for (let i = 0; i < MAX; i++) {
        const q = this.p[i];
        if (!q.on) continue;
        if (q.delay > 0) { q.delay -= dt; continue; }
        q.life -= dt;
        if (q.life <= 0) { q.on = false; continue; }
        live++;
        if (q.drag) { const k = Math.exp(-q.drag * dt); q.vx *= k; q.vy *= k; }
        q.vy -= q.grav * dt;
        q.x += q.vx * dt; q.y += q.vy * dt;
        q.rot += q.vr * dt;
        if (q.water && q.y < waterY && q.vy < 0) {
          q.on = false;
          if (Math.random() < 0.18 * this.quality) this.make('ring', q.x, waterY, 0, 0, 0.5, U.len(0.4), U.len(2.6), [235, 248, 255], 0.5);
        }
        if (q.bounce && terrain && q.vy < 0) {
          const h = terrain.heightAt(q.x, q.y + U.len(4));
          if (h !== null && q.y < h) { q.y = h; q.vy = -q.vy * q.bounce; q.vx *= 0.7; q.vr *= 0.6; if (Math.abs(q.vy) < U.len(2)) { q.vy = 0; q.grav = 0; q.vx *= 0.9; } }
        }
      }
      this.count = live;
    }

    /* ------------------------------------------------------------- draw */
    /** Call inside the world transform (y up). zoom lets thin strokes stay visible. */
    draw(ctx, zoom, waterY, layer) {
      // layer 'back' = soft clouds and rings (behind the car); 'front' = everything else
      for (let i = 0; i < MAX; i++) {
        const q = this.p[i];
        if (!q.on || q.delay > 0) continue;
        const back = q.type === 'soft' || q.type === 'ring' || q.type === 'bubble';
        if (layer === 'back' ? !back : back) continue;
        const t = 1 - q.life / q.max; // 0 -> 1
        const c = q.c;
        const op = q.add ? 'lighter' : 'source-over';
        if (ctx.globalCompositeOperation !== op) ctx.globalCompositeOperation = op;
        switch (q.type) {
          case 'soft': {
            const r = M.lerp(q.size, q.size1, Math.sqrt(t));
            ctx.globalAlpha = q.a0 * (1 - t) * (1 - t * 0.4);
            ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
            ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.fill();
            break;
          }
          case 'spark': {
            ctx.globalAlpha = q.a0 * (1 - t);
            ctx.strokeStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
            ctx.lineWidth = Math.max(q.size, 1.4 / zoom);
            ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.04, q.y - q.vy * 0.04); ctx.stroke();
            break;
          }
          case 'shard': {
            ctx.globalAlpha = Math.min(1, q.life * 2);
            ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
            ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
            const s = q.size;
            ctx.beginPath(); ctx.moveTo(-s, -s * 0.5); ctx.lineTo(s * 1.2, -s * 0.2); ctx.lineTo(s * 0.2, s * 0.7); ctx.closePath(); ctx.fill();
            ctx.restore();
            break;
          }
          case 'drop': {
            ctx.globalAlpha = q.a0 * Math.min(1, q.life * 2.5);
            ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
            const sp = Math.hypot(q.vx, q.vy), s = q.size;
            ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(Math.atan2(q.vy, q.vx));
            ctx.beginPath(); ctx.ellipse(0, 0, s * (1 + Math.min(2.4, sp / U.len(40))), s * 0.7, 0, 0, TAU); ctx.fill();
            ctx.restore();
            break;
          }
          case 'ring': {
            const r = M.lerp(q.size, q.size1, 1 - (1 - t) * (1 - t));
            ctx.globalAlpha = q.a0 * (1 - t);
            ctx.strokeStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
            ctx.lineWidth = Math.max(U.len(0.35), 1.5 / zoom);
            ctx.beginPath();
            if (q.screen) ctx.arc(q.x, q.y, r, 0, TAU); else ctx.ellipse(q.x, q.y, r * 2.4, r * 0.3, 0, 0, TAU);
            ctx.stroke();
            break;
          }
          case 'bubble': {
            ctx.globalAlpha = q.a0 * (1 - t);
            ctx.strokeStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
            ctx.lineWidth = Math.max(U.len(0.12), 1 / zoom);
            ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, TAU); ctx.stroke();
            break;
          }
          case 'glow': {
            const r = M.lerp(q.size, q.size1, t);
            ctx.globalAlpha = q.a0 * (1 - t);
            ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
            ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.fill();
            break;
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  FD.Fx = Fx;
})(typeof window !== 'undefined' ? window : globalThis);
