/* FlipDrive: EV Chaos - vehicles.js
 * Vehicle specifications (in feet / slugs / lbf) and the Vehicle rigid body:
 * raycast suspension, slip-based tires, electric motor curve, aero drag, air control torque,
 * buoyancy + water drag, hull collision and crash/impact reporting.
 * Both vehicles are original designs: a faceted stunt pickup and a luxury amphibious SUV.
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});
  const U = FD.Units;
  const M = FD.M;

  const SPECS = {
    pickup: {
      id: 'pickup',
      name: 'VOLTRA SHARD',
      tagline: 'Faceted stunt pickup. Brutal torque, built to flip.',
      amphibious: false,
      mass: 205, // slugs  (~6,600 lb)
      inertia: 7000, // slug ft^2
      hull: [[-9.0, -1.65], [9.4, -1.65], [9.55, -0.9], [5.6, 0.55], [0.9, 3.35], [-3.8, 3.35], [-9.25, 0.95]],
      roofY: 2.4,
      wheels: [
        { x: 5.9, r: 1.5, mountY: -0.55, drive: true },
        { x: -5.7, r: 1.5, mountY: -0.55, drive: true }
      ],
      suspModes: [{ name: 'STUNT', k: 7000, cc: 1050, cr: 1500, sMax: 1.3, sMin: 0.15 }],
      defaultSusp: 0,
      motor: { force: 6600, vmax: 140, boostForce: 1.5, boostVmax: 1.18, brake: 5200, vrev: 26 },
      tire: { mu: 1.15, slip0: 3.5 },
      air: { torque: 26000, groundTorque: 9000, maxSpin: 5.2, damp: 0.35 },
      aero: 0.045,
      water: { buoyScale: 1.0, flood: true, kq: 1.4, kl: 20, thrust: 0, trim: 0, volume: 106, rr: 1.5, rows: [-1.0, 1.4], cols: [-7, -3.5, 0, 3.5, 7] },
      stats: { speed: 0.9, accel: 0.95, flip: 0.95, water: 0.05, mass: '6,600 lb' }
    },
    suv: {
      id: 'suv',
      name: 'AURELIA TIDERUNNER',
      tagline: 'Luxury 4x4 that floats. Land it, swim it, climb out.',
      amphibious: true,
      mass: 236, // ~7,600 lb
      inertia: 7600,
      hull: [[-8.8, -1.9], [8.7, -1.9], [8.9, -0.9], [8.4, 0.5], [5.2, 1.1], [3.3, 3.3], [-7.2, 3.4], [-8.7, 2.9], [-8.9, -0.9]],
      roofY: 2.5,
      wheels: [
        { x: 5.7, r: 1.55, mountY: -0.5, drive: true },
        { x: -5.6, r: 1.55, mountY: -0.5, drive: true }
      ],
      suspModes: [
        { name: 'LOW', k: 9500, cc: 1500, cr: 2100, sMax: 1.15, sMin: 0.12 },
        { name: 'NORMAL', k: 6800, cc: 1150, cr: 1650, sMax: 1.5, sMin: 0.15 },
        { name: 'HIGH', k: 5000, cc: 900, cr: 1400, sMax: 1.9, sMin: 0.2 }
      ],
      defaultSusp: 1,
      motor: { force: 6000, vmax: 130, boostForce: 1.4, boostVmax: 1.15, brake: 5600, vrev: 24 },
      tire: { mu: 1.05, slip0: 3.5 },
      air: { torque: 21000, groundTorque: 7000, maxSpin: 4.4, damp: 0.5 },
      aero: 0.06,
      water: { buoyScale: 1.0, flood: false, kq: 1.65, kl: 25, heave: 900, thrust: 4300, trim: 15000, volume: 268, rr: 1.6, rows: [-1.2, 1.4], cols: [-7, -3.5, 0, 3.5, 7] },
      stats: { speed: 0.78, accel: 0.8, flip: 0.6, water: 1.0, mass: '7,600 lb' }
    }
  };

  const WHEEL_INERTIA = 22; // slug ft^2 (rotor + wheel, reflected)

  function subdivide(poly, maxLen) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / maxLen));
      for (let k = 0; k < n; k++) out.push([M.lerp(a[0], b[0], k / n), M.lerp(a[1], b[1], k / n)]);
    }
    return out;
  }

  class Vehicle {
    constructor(spec) {
      this.spec = spec;
      this.mass = spec.mass;
      this.invM = 1 / spec.mass;
      this.I = U.inertia(spec.inertia);
      this.invI = 1 / this.I;
      this.amphibious = !!spec.amphibious;
      const roofY = U.len(spec.roofY);
      this.hull = subdivide(spec.hull.map((p) => [U.len(p[0]), U.len(p[1])]), U.len(2.2)).map((p) => ({ x: p[0], y: p[1], roof: p[1] > roofY }));
      this.wheels = spec.wheels.map((w) => ({
        x: U.len(w.x), r: U.len(w.r), mountY: U.len(w.mountY), drive: w.drive,
        omega: 0, spin: 0, s: 0, contact: false, N: 0, slip: 0, hx: 0, hy: 0, nx: 0, ny: 1, tag: 'road', wet: false, skid: 0
      }));
      this.nDrive = this.wheels.filter((w) => w.drive).length;
      this.Iw = U.inertia(WHEEL_INERTIA);
      // water buoyancy spheres
      const wt = spec.water;
      this.spheres = [];
      for (const ly of wt.rows) for (const lx of wt.cols) this.spheres.push({ x: U.len(lx), y: U.len(ly), wx: 0, wy: 0, frac: 0 });
      this.sphereR = U.len(wt.rr);
      this.sphereV = wt.volume / this.spheres.length;
      this.suspIndex = spec.defaultSusp;
      this.setSuspension(this.suspIndex);
      this.boost = 1;
      this.reset(0, 0, 0, 0, 0);
    }

    setSuspension(i) {
      const m = this.spec.suspModes[i % this.spec.suspModes.length];
      this.suspIndex = i % this.spec.suspModes.length;
      this.suspName = m.name;
      this.susp = { k: m.k, cc: m.cc, cr: m.cr, sMax: U.len(m.sMax), sMin: U.len(m.sMin), kBump: m.k * 28 };
      for (const w of this.wheels) w.s = this.susp.sMax;
    }
    cycleSuspension() { if (this.spec.suspModes.length > 1) this.setSuspension(this.suspIndex + 1); return this.suspName; }

    /** COM height above flat ground when sitting at rest (world units). */
    restHeight() {
      const w = this.wheels[0];
      const compFt = (this.mass * U.G_FT / 2) / this.susp.k; // static compression per axle (ft)
      const sRest = this.susp.sMax - U.len(compFt);
      return -(w.mountY - sRest) + w.r; // hub is (mountY - sRest) below COM, plus tire radius
    }

    reset(x, y, a, vx, vy) {
      this.x = x; this.y = y; this.a = a; this.vx = vx; this.vy = vy; this.w = 0;
      this.px = x; this.py = y; this.pa = a;
      for (const w of this.wheels) {
        w.omega = vx / w.r * Math.cos(a); w.spin = 0; w.s = this.susp.sMax; w.contact = false; w.N = 0; w.slip = 0; w.skid = 0;
      }
      this.wheelsOnGround = 0;
      this.airTime = 0; this.groundTime = 0;
      this.roofContact = false; this.roofTime = 0; this.bodyContact = false;
      this.wet = 0; this.inWater = false; this.flood = 0; this.submergedTime = 0; this.splashCd = 0;
      this.boosting = false; this.boost = Math.max(this.boost, 0.6);
      this.speed = Math.hypot(vx, vy);
      this.lastTag = 'road';
      this.throttleOut = 0;
      this.depthCom = -1e6;
      this.impacts = [];
    }

    // world position of a local point
    toWorld(lx, ly, out) {
      const c = Math.cos(this.a), s = Math.sin(this.a);
      out = out || {};
      out.x = this.x + c * lx - s * ly;
      out.y = this.y + s * lx + c * ly;
      return out;
    }

    /** Render-time interpolated pose. */
    pose(alpha) {
      return {
        x: M.lerp(this.px, this.x, alpha),
        y: M.lerp(this.py, this.y, alpha),
        a: M.lerp(this.pa, this.a, alpha)
      };
    }

    step(dt, ctl, world) {
      const T = world.terrain;
      const sp = this.spec;
      const g = U.g();
      const PPF = U.PPF;
      this.px = this.x; this.py = this.y; this.pa = this.a;
      this.impacts.length = 0;

      const cs = Math.cos(this.a), sn = Math.sin(this.a);
      const fx = cs, fy = sn, ux = -sn, uy = cs;
      const m = this.mass;
      let Fx = 0, Fy = -m * g, Tq = 0;

      const throttle = ctl.throttle || 0, brake = ctl.brake || 0, rot = ctl.rot || 0;
      this.splashCd = Math.max(0, this.splashCd - dt);

      /* boost energy */
      const wantBoost = !!ctl.boost && this.boost > 0.02 && throttle > 0.1;
      this.boosting = wantBoost;
      if (wantBoost) this.boost = Math.max(0, this.boost - 0.26 * dt);
      else this.boost = Math.min(1, this.boost + 0.05 * dt);
      const mo = sp.motor;
      const forceMul = wantBoost ? mo.boostForce : 1;
      const vmaxW = U.len(mo.vmax) * (wantBoost ? mo.boostVmax : 1);
      const vrevW = U.len(mo.vrev);

      const vf = this.vx * fx + this.vy * fy;
      this.throttleOut = throttle;

      /* ---- wheels: suspension + tires ---- */
      let onGround = 0;
      const su = this.susp;
      for (let i = 0; i < this.wheels.length; i++) {
        const w = this.wheels[i];
        // mount point (world)
        const mx = this.x + cs * w.x - sn * w.mountY;
        const my = this.y + sn * w.x + cs * w.mountY;
        const hit = T.rayCast(mx, my, -ux, -uy, su.sMax + w.r * 3.4);
        let contact = false, sLen = su.sMax;
        let n1x = 0, n1y = 1;
        if (hit) {
          const cosT = Math.max(0.3, ux * hit.nx + uy * hit.ny);
          sLen = hit.t - w.r / cosT;
          if (sLen <= su.sMax) { contact = true; n1x = hit.nx; n1y = hit.ny; }
        }
        w.wet = false;
        let Fn = 0;
        if (contact) {
          onGround++;
          if (sLen < 0) sLen = 0;
          const cosT = Math.max(0.3, ux * n1x + uy * n1y);
          const px = hit.x, py = hit.y;
          const rx = px - this.x, ry = py - this.y;
          const mvx = this.vx - this.w * (my - this.y), mvy = this.vy + this.w * (mx - this.x);
          const dsdt = (mvx * n1x + mvy * n1y) / cosT;
          const comp = su.sMax - sLen;
          const travel = su.sMax - su.sMin;
          const ratio = Math.min(comp / travel, 1);
          let Fk = su.k * comp * (1 + 2.5 * ratio * ratio);
          if (sLen < su.sMin) Fk += su.kBump * (su.sMin - sLen);
          const vc = -dsdt;
          const Fd = (vc > 0 ? su.cc : su.cr) * vc;
          Fn = Math.max(0, Fk + Fd);
          // suspension force along chassis up
          const Fsx = ux * Fn, Fsy = uy * Fn;
          Fx += Fsx; Fy += Fsy; Tq += rx * Fsy - ry * Fsx;

          // tire traction along ground tangent
          let tx = n1y, ty = -n1x;
          if (tx * fx + ty * fy < 0) { tx = -tx; ty = -ty; }
          const surf = FD.SURFACES[hit.tag] || FD.SURFACES.road;
          let mu = sp.tire.mu * surf.mu;
          const hubY = hit.y + n1y * w.r;
          if (world.waterY > hubY) { mu *= 0.6; w.wet = true; }
          const Nload = Fn * Math.max(0, ux * n1x + uy * n1y);
          const muN = mu * Nload;
          const vpx = this.vx - this.w * ry, vpy = this.vy + this.w * rx;
          const vlong = vpx * tx + vpy * ty;
          const slip = w.omega * w.r - vlong;
          const slip0 = U.len(sp.tire.slip0);
          const Ft = muN * Math.tanh(slip / slip0);
          Fx += tx * Ft; Fy += ty * Ft; Tq += rx * ty * Ft - ry * tx * Ft;
          w.slip = slip; w.N = Nload; w.skid = Math.abs(Ft) >= muN * 0.93 && Math.abs(slip) > slip0 * 1.2 ? Math.min(1, Math.abs(slip) / (slip0 * 6)) : 0;
          w.hx = px; w.hy = py; w.nx = n1x; w.ny = n1y; w.tag = hit.tag;
          this.lastTag = hit.tag;
          w._Ft = Ft;
        } else { w.slip = 0; w.skid = 0; w.N = 0; w._Ft = 0; }
        w.contact = contact;
        w.sTarget = contact ? sLen : su.sMax;
        w.s += (w.sTarget - w.s) * Math.min(1, dt * (contact ? 60 : 14));
        w.bump = contact && sLen < su.sMin ? { depth: (su.sMin - sLen) * Math.max(0.3, ux * n1x + uy * n1y), x: hit.x, y: hit.y, nx: n1x, ny: n1y } : null;

        /* wheel spin dynamics */
        const nd = this.nDrive || 1;
        let Tdrive = 0;
        if (this.canDrive !== false) {
          if (w.drive) {
            const spd = Math.abs(w.omega) * w.r;
            if (throttle > 0) Tdrive += U.torque(mo.force * forceMul * throttle * (w.r / PPF) / nd) * M.clamp(1 - Math.pow(spd / vmaxW, 3), 0, 1);
            else if (brake > 0 && vf < 0.5 * PPF) Tdrive -= U.torque(mo.force * 0.5 * brake * (w.r / PPF) / nd) * M.clamp(1 - Math.pow(spd / vrevW, 3), 0, 1);
          }
        }
        let Tb = 0;
        if (brake > 0 && vf > 0.5 * PPF) {
          const Tmax = U.torque(mo.brake * (w.r / PPF) / this.wheels.length) * brake;
          const stop = Math.abs(w.omega) * this.Iw / dt;
          Tb = -Math.sign(w.omega) * Math.min(Tmax, stop);
        }
        const Tfric = contact ? -(w._Ft || 0) * w.r : 0;
        const Troll = -w.omega * U.torque(contact ? 10 : 3) / 100;
        w.omega += (Tdrive + Tb + Tfric + Troll) / this.Iw * dt;
        const wMax = vmaxW / w.r * 1.12;
        if (w.omega > wMax) w.omega = wMax;
        if (w.omega < -wMax) w.omega = -wMax;
        w.spin += w.omega * dt;
      }
      this.wheelsOnGround = onGround;
      if (onGround > 0) { this.airTime = 0; this.groundTime += dt; } else { this.airTime += dt; this.groundTime = 0; }

      /* ---- aero drag ---- */
      const spd = Math.hypot(this.vx, this.vy);
      this.speed = spd;
      const cdq = U.quad(sp.aero);
      Fx -= cdq * spd * this.vx;
      Fy -= cdq * spd * this.vy;

      /* ---- rotation control ---- */
      const a = sp.air;
      if (rot !== 0 && this.canDrive !== false) {
        let tq = onGround > 0 ? a.groundTorque : a.torque;
        if (this.wet > 0.3) tq = 0;
        if (Math.abs(this.w) > a.maxSpin && Math.sign(this.w) === Math.sign(rot)) tq = 0;
        Tq += rot * U.torque(tq);
      } else if (onGround === 0 && this.wet < 0.1) {
        Tq -= this.w * a.damp * this.I;
      }

      /* ---- water: buoyancy, drag, thrust ---- */
      let wetSum = 0;
      const wy = world.waterY;
      const wt = sp.water;
      const rhoW = U.RHO_WATER;
      let buoyScale = wt.buoyScale;
      if (wt.flood) buoyScale = M.lerp(wt.buoyScale, 0.12, M.clamp(this.flood, 0, 1));
      let anyWater = false;
      for (let i = 0; i < this.spheres.length; i++) {
        const s = this.spheres[i];
        s.wx = this.x + cs * s.x - sn * s.y;
        s.wy = this.y + sn * s.x + cs * s.y;
        const frac = M.clamp((wy - s.wy) / (2 * this.sphereR) + 0.5, 0, 1);
        s.frac = frac;
        if (frac <= 0) continue;
        anyWater = true;
        wetSum += frac;
        const rx = s.wx - this.x, ry = s.wy - this.y;
        const fb = rhoW * this.sphereV * frac * buoyScale * PPF;
        let pvx = this.vx - this.w * ry, pvy = this.vy + this.w * rx;
        const pvxF = pvx / PPF, pvyF = pvy / PPF;
        const pspd = Math.hypot(pvxF, pvyF);
        const dragK = (wt.kl + wt.kq * pspd) * frac * PPF;
        const fdx = -dragK * pvxF, fdy = -dragK * pvyF;
        const ffx = fdx, ffy = fb + fdy;
        Fx += ffx; Fy += ffy; Tq += rx * ffy - ry * ffx;
      }
      const wetFrac = wetSum / this.spheres.length;
      const prevWet = this.wet;
      this.wet = wetFrac;
      this.inWater = wetFrac > 0.12;
      this.depthCom = wy - this.y;
      if (anyWater) {
        // heave damping (lbf per ft/s == world force per world velocity): stops the hull popping out of the sea like a cork
        if (wt.heave) Fy -= wt.heave * this.vy * Math.min(1, wetFrac * 2);
        // extra angular damping in water keeps floating stable
        Tq -= this.w * this.I * 1.1 * Math.min(1, wetFrac * 2);
        if (this.amphibious && this.canDrive !== false) {
          const sub = M.clamp((wetFrac - 0.25) / 0.35, 0, 1);
          if (sub > 0) {
            let th = 0;
            if (throttle > 0) th = throttle; else if (brake > 0) th = -0.45 * brake;
            const F = U.force(wt.thrust) * th * sub * (wantBoost ? 1.25 : 1);
            const rx = -4.5 * PPF, ry = -0.8 * PPF;
            const wxo = cs * rx - sn * ry, wyo = sn * rx + cs * ry;
            Fx += fx * F; Fy += fy * F; Tq += wxo * fy * F - wyo * fx * F;
            Tq += rot * U.torque(wt.trim) * sub;
          }
        }
        if (wt.flood && wetFrac > 0.3) this.flood = Math.min(1, this.flood + dt / 2.4);
        // splash on entry
        if (prevWet < 0.06 && wetFrac >= 0.06 && this.splashCd <= 0) {
          const vyF = this.vy / PPF;
          const speedF = spd / PPF;
          if (speedF > 8) {
            this.splashCd = 0.3;
            world.events.push({ type: 'splash', x: this.x, y: wy, speed: speedF, vy: vyF, vx: this.vx / PPF, strength: M.clamp(speedF / 95, 0.1, 1) });
          }
        }
      } else if (wt.flood) {
        this.flood = Math.max(0, this.flood - dt * 0.2);
      }
      if (this.depthCom > U.len(2.0)) this.submergedTime += dt; else this.submergedTime = Math.max(0, this.submergedTime - dt);

      /* ---- integrate ---- */
      this.vx += Fx * this.invM * dt;
      this.vy += Fy * this.invM * dt;
      this.w += Tq * this.invI * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.a += this.w * dt;

      /* ---- collisions: hull points + hub bump stops vs terrain ---- */
      const contacts = [];
      const c2 = Math.cos(this.a), s2 = Math.sin(this.a);
      let roofContact = false, bodyContact = false;
      for (let i = 0; i < this.hull.length; i++) {
        const h = this.hull[i];
        const wx = this.x + c2 * h.x - s2 * h.y;
        const wy2 = this.y + s2 * h.x + c2 * h.y;
        const q = T.solidContact(wx, wy2);
        if (!q) continue;
        const surf = FD.SURFACES[q.tag] || FD.SURFACES.road;
        contacts.push({ px: wx, py: wy2, nx: q.nx, ny: q.ny, depth: q.depth, mu: (h.roof ? 0.45 : 0.1) * surf.mu, e: 0.2, kind: h.roof ? 'roof' : 'body', tag: q.tag });
        if (h.roof) roofContact = true; else bodyContact = true;
      }
      for (const w of this.wheels) {
        if (w.bump) contacts.push({ px: w.bump.x, py: w.bump.y, nx: w.bump.nx, ny: w.bump.ny, depth: w.bump.depth, mu: 0, e: 0.04, kind: 'wheel', tag: w.tag });
      }
      this.roofContact = roofContact;
      this.bodyContact = bodyContact;
      if (roofContact) this.roofTime += dt; else this.roofTime = Math.max(0, this.roofTime - dt * 2);

      if (contacts.length) {
        FD.solveContacts(this, contacts, 8, 3 * PPF);
        // positional projection (deepest first, few passes)
        for (let pass = 0; pass < 3; pass++) {
          let deepest = null, dd = U.len(0.01);
          const cc = Math.cos(this.a), ss = Math.sin(this.a);
          for (const c of contacts) {
            if (c.kind === 'wheel') { if (c.depth > dd) { dd = c.depth; deepest = c; } continue; }
          }
          for (const h of this.hull) {
            const wx = this.x + cc * h.x - ss * h.y, wy2 = this.y + ss * h.x + cc * h.y;
            const q = T.solidContact(wx, wy2);
            if (q && q.depth > dd) { dd = q.depth; deepest = q; }
          }
          if (!deepest) break;
          const k = pass === 0 ? 0.9 : 1.0;
          this.x += deepest.nx * dd * k;
          this.y += deepest.ny * dd * k;
        }
        const impactThreshold = 1.0 * PPF;
        for (const c of contacts) {
          if (c.vn0 > impactThreshold) {
            this.impacts.push({ kind: c.kind, speed: c.vn0, x: c.px, y: c.py, nx: c.nx, ny: c.ny, tag: c.tag });
          }
        }
        // resting damping to avoid endless micro-jitter of a wreck
        const sleepV = 0.4 * PPF;
        if (this.speed < sleepV && Math.abs(this.w) < 0.2) { this.vx *= 0.96; this.vy *= 0.96; this.w *= 0.9; }
      }
      for (const imp of this.impacts) world.events.push({ type: 'impact', kind: imp.kind, speed: imp.speed / PPF, x: imp.x, y: imp.y, nx: imp.nx, ny: imp.ny, tag: imp.tag });
    }
  }

  FD.VEHICLE_SPECS = SPECS;
  FD.Vehicle = Vehicle;
})(typeof window !== 'undefined' ? window : globalThis);
