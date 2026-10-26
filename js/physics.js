/* FlipDrive: EV Chaos - physics.js
 * Terrain collision queries (heightfield pieces + floating slabs), the impulse contact
 * solver used by rigid bodies, and the World container that advances a simulation by a
 * fixed timestep. Everything here is independent of rendering and frame rate.
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});
  const U = FD.Units;

  FD.PHYS = {
    STEP: 1 / 120, // fixed physics timestep (s)
    MAX_STEPS_PER_FRAME: 12
  };

  // Surface properties (grip multiplier, whether the surface kicks up dust)
  FD.SURFACES = {
    road: { mu: 1.0, dust: 0.3 },
    ramp: { mu: 1.0, dust: 0.2 },
    deck: { mu: 0.95, dust: 0.2 },
    roof: { mu: 1.0, dust: 0.3 },
    sand: { mu: 0.7, dust: 1.0 },
    rock: { mu: 0.85, dust: 0.9 },
    dirt: { mu: 0.8, dust: 1.0 },
    steel: { mu: 0.9, dust: 0.1 }
  };

  /* ---------------------------------------------------------------- Terrain */
  class Terrain {
    /** level.ground: [{pts:[[x,y,tag?],...]}] in feet; level.platforms: [{x,y,w,h,surf?}] (y = top) */
    constructor(level) {
      this.pieces = [];
      this.slabs = [];
      for (const g of level.ground) {
        const pts = g.pts.map((p) => ({ x: U.len(p[0]), y: U.len(p[1]), tag: p[2] || g.surf || 'road' }));
        const segs = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          if (dx <= 0) throw new Error('Terrain piece must be strictly increasing in x');
          segs.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, nx: -dy / len, ny: dx / len, len, tag: a.tag });
        }
        this.pieces.push({ pts, segs, x0: pts[0].x, x1: pts[pts.length - 1].x, name: g.name || '' });
      }
      for (const p of level.platforms || []) {
        const s = {
          x0: U.len(p.x), x1: U.len(p.x + p.w), y1: U.len(p.y), y0: U.len(p.y - p.h), tag: p.surf || 'deck', name: p.name || ''
        };
        s.top = { x0: s.x0, y0: s.y1, x1: s.x1, y1: s.y1, nx: 0, ny: 1, len: s.x1 - s.x0, tag: s.tag };
        this.slabs.push(s);
      }
    }

    static segIndex(piece, x) {
      const pts = piece.pts;
      let lo = 0, hi = pts.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (pts[mid].x <= x) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    /** Ray against top faces only (ray must travel against the surface normal). */
    rayCast(ox, oy, dx, dy, maxT) {
      let bestT = maxT, best = null;
      const ex = ox + dx * maxT;
      const xa = Math.min(ox, ex), xb = Math.max(ox, ex);
      const test = (s) => {
        const sx = s.x1 - s.x0, sy = s.y1 - s.y0;
        const denom = dx * sy - dy * sx;
        if (Math.abs(denom) < 1e-9) return;
        if (dx * s.nx + dy * s.ny >= 0) return; // moving away from the face
        const ax = s.x0 - ox, ay = s.y0 - oy;
        const t = (ax * sy - ay * sx) / denom;
        const u = (ax * dy - ay * dx) / denom;
        if (t >= 0 && t < bestT && u >= 0 && u <= 1) { bestT = t; best = s; }
      };
      for (const p of this.pieces) {
        if (xb < p.x0 || xa > p.x1) continue;
        let i = Terrain.segIndex(p, Math.max(xa, p.x0));
        for (; i < p.segs.length; i++) {
          const s = p.segs[i];
          if (s.x0 > xb) break;
          test(s);
        }
      }
      for (const sl of this.slabs) {
        if (xb < sl.x0 || xa > sl.x1) continue;
        test(sl.top);
      }
      if (!best) return null;
      return { t: bestT, x: ox + dx * bestT, y: oy + dy * bestT, nx: best.nx, ny: best.ny, tag: best.tag };
    }

    /** Is the world point inside solid ground? Returns {depth,nx,ny,tag} or null. */
    solidContact(px, py) {
      let best = null;
      for (const p of this.pieces) {
        if (px < p.x0 || px > p.x1) continue;
        const s = p.segs[Terrain.segIndex(p, px)];
        const depthN = -((px - s.x0) * s.nx + (py - s.y0) * s.ny);
        if (depthN <= 0) continue;
        let depth = depthN, nx = s.nx, ny = s.ny, tag = s.tag;
        const dl = px - p.x0, dr = p.x1 - px;
        if (dl < depth && dl <= dr) { depth = dl; nx = -1; ny = 0; tag = 'rock'; }
        else if (dr < depth) { depth = dr; nx = 1; ny = 0; tag = 'rock'; }
        if (!best || depth < best.depth) best = { depth, nx, ny, tag };
      }
      for (const s of this.slabs) {
        if (px <= s.x0 || px >= s.x1 || py <= s.y0 || py >= s.y1) continue;
        const dT = s.y1 - py, dB = py - s.y0, dL = px - s.x0, dR = s.x1 - px;
        let depth = dT, nx = 0, ny = 1;
        if (dB < depth) { depth = dB; nx = 0; ny = -1; }
        if (dL < depth) { depth = dL; nx = -1; ny = 0; }
        if (dR < depth) { depth = dR; nx = 1; ny = 0; }
        if (!best || depth < best.depth) best = { depth, nx, ny, tag: s.tag };
      }
      return best;
    }

    /** Height of the highest surface below (x,yFrom); null if nothing there. */
    heightAt(x, yFrom) {
      const h = this.rayCast(x, yFrom, 0, -1, 1e7);
      return h ? h.y : null;
    }
  }

  /* ------------------------------------------------- Rigid body contact solver */
  /**
   * Sequential-impulse solver for point contacts on a single rigid body.
   * contacts: [{px,py,nx,ny,depth,mu,e,kind}] ; body: {x,y,vx,vy,w,invM,invI}
   * Returns nothing; fills c.vn0 (approach speed, positive = impacting) and c.jn.
   */
  function solveContacts(body, contacts, iterations, restThreshold) {
    const n = contacts.length;
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const c = contacts[i];
      c.rx = c.px - body.x; c.ry = c.py - body.y;
      const vpx = body.vx - body.w * c.ry, vpy = body.vy + body.w * c.rx;
      const vn = vpx * c.nx + vpy * c.ny;
      c.vn0 = -vn; // positive when approaching
      c.target = vn < -restThreshold ? -vn * c.e : 0; // desired separating speed
      const rn = c.rx * c.ny - c.ry * c.nx;
      c.kn = body.invM + rn * rn * body.invI;
      const tx = -c.ny, ty = c.nx;
      const rt = c.rx * ty - c.ry * tx;
      c.kt = body.invM + rt * rt * body.invI;
      c.jn = 0; c.jt = 0;
    }
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < n; i++) {
        const c = contacts[i];
        let vpx = body.vx - body.w * c.ry, vpy = body.vy + body.w * c.rx;
        const vn = vpx * c.nx + vpy * c.ny;
        let lam = (c.target - vn) / c.kn;
        const old = c.jn;
        c.jn = Math.max(old + lam, 0);
        lam = c.jn - old;
        if (lam !== 0) {
          const ix = c.nx * lam, iy = c.ny * lam;
          body.vx += ix * body.invM; body.vy += iy * body.invM;
          body.w += (c.rx * iy - c.ry * ix) * body.invI;
        }
        if (c.mu > 0) {
          vpx = body.vx - body.w * c.ry; vpy = body.vy + body.w * c.rx;
          const tx = -c.ny, ty = c.nx;
          const vt = vpx * tx + vpy * ty;
          let lt = -vt / c.kt;
          const maxF = c.mu * c.jn;
          const oldT = c.jt;
          c.jt = Math.max(-maxF, Math.min(maxF, oldT + lt));
          lt = c.jt - oldT;
          if (lt !== 0) {
            const ix = tx * lt, iy = ty * lt;
            body.vx += ix * body.invM; body.vy += iy * body.invM;
            body.w += (c.rx * iy - c.ry * ix) * body.invI;
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ World */
  class World {
    /**
     * level: level definition (feet). vehicle: FD.Vehicle instance.
     * Water surface may rise over time for flood levels.
     */
    constructor(level, vehicle) {
      this.level = level;
      this.terrain = new Terrain(level);
      this.vehicle = vehicle;
      this.time = 0;
      this.waterBase = level.waterY === undefined || level.waterY === null ? -1e6 : U.len(level.waterY);
      this.waterRise = level.waterRise ? U.len(level.waterRise) : 0; // world units / s
      this.waterDelay = level.waterDelay || 0;
      this.waterY = this.waterBase;
      this.events = [];
    }
    updateWater() {
      const t = Math.max(0, this.time - this.waterDelay);
      this.waterY = this.waterBase + this.waterRise * t;
    }
    step(dt, ctl) {
      this.updateWater();
      this.vehicle.step(dt, ctl, this);
      this.time += dt;
    }
  }

  FD.Terrain = Terrain;
  FD.World = World;
  FD.solveContacts = solveContacts;
})(typeof window !== 'undefined' ? window : globalThis);
