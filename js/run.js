/* FlipDrive: EV Chaos - run.js
 * One attempt at a level: owns the World + Vehicle, the gameplay state machine
 * (count, drive, ramp, air, landed, crashed, results - "title" lives in the app shell),
 * stunt scoring, rings, checkpoints, crossings and crash detection.
 * No DOM, no rendering: the app and the headless tests both drive it with fixed timesteps.
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});
  const U = FD.Units, M = FD.M;
  const TWO_PI = Math.PI * 2;
  const ZERO = { throttle: 0, brake: 0, rot: 0, boost: false };

  FD.STATES = ['title', 'count', 'drive', 'ramp', 'air', 'landed', 'crashed', 'results'];

  FD.CRASH = { roof: 14, bodyTilted: 28, bodyAny: 190, tilt: 0.95, roofTime: 0.7 };
  const ORD = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];

  class Run {
    /**
     * level: a level definition (feet). specId: 'pickup' | 'suv'.
     * opts.susp: suspension mode index (SUV).
     */
    constructor(level, specId, opts) {
      opts = opts || {};
      this.level = level;
      this.spec = FD.VEHICLE_SPECS[specId];
      this.vehicle = new FD.Vehicle(this.spec);
      if (opts.susp !== undefined) this.vehicle.setSuspension(opts.susp);
      this.world = new FD.World(level, this.vehicle);
      this.out = []; // events for the app (audio, fx, UI); the app drains it
      this.state = 'count';
      this.stateTime = 0;
      this.time = 0; // drive clock (s)
      this.crossings = level.crossings.map((c) => ({ ...c, left: false, done: false }));
      this.rings = level.rings.map((r) => ({ ...r, got: false, t: 0 }));
      this.checkpoints = level.checkpoints.map((c) => ({ ...c, reached: false, time: 0 }));
      this.lastCp = null;
      this.score = { stunts: 0, air: 0, rings: 0, distance: 0, water: 0, landing: 0, time: 0 };
      this.chain = 0;
      this.best = { maxAirT: 0, maxFlips: 0, topMph: 0, flips: 0, ringsGot: 0, perfect: 0, crashes: 0, crossings: 0 };
      this.maxX = 0;
      this.startX = level.start.x;
      this.swim = 0;
      this.flipsCredited = 0; this.pendingFlipPts = 0; this.launchA = 0; this.airDur = 0;
      this.freeT = 0; this.peakY = 0; // free-flight clock (no wheel contact AND not in water) + apex height
      this.landEval = null; this.landedT = 0;
      this.reason = '';
      this.crashT = 0;
      this.respawns = 0;
      this.count = 3; this.lastTick = null;
      this.placeAt(level.start.x, level.start.y, 0);
      this.beginCount(3);
    }

    /* ------------------------------------------------------------ helpers */
    emit(e) { this.out.push(e); }
    mult() { return Math.min(4, 1 + 0.5 * this.chain); }
    scoreTotal() { const s = this.score; return Math.round(s.stunts + s.air + s.rings + s.distance + s.water + s.landing + s.time); }
    progress() { return M.clamp((this.vehicle.x / U.PPF - this.startX) / (this.level.finishX - this.startX), 0, 1); }
    setState(s) { if (this.state !== s) { this.prevState = this.state; this.state = s; this.stateTime = 0; this.emit({ type: 'state', state: s, from: this.prevState }); } }

    placeAt(xFt, yFt, a, vxFt) {
      const v = this.vehicle;
      const xw = U.len(xFt);
      const h = this.world.terrain.heightAt(xw, U.len(yFt + 60));
      const y = (h === null ? U.len(yFt) : h) + v.restHeight() + U.len(0.6);
      v.reset(xw, y, a || 0, U.len(vxFt || 0), 0);
      v.canDrive = true;
    }

    beginCount(sec) {
      this.count = sec; this.lastTick = null; this.countLen = sec;
      this.state = 'count'; this.stateTime = 0;
      this.emit({ type: 'state', state: 'count', from: this.prevState || '' });
    }

    /** Respawn at the last checkpoint (or the start). Keeps score, drops the chain. */
    respawn(fullRestart) {
      const cp = fullRestart ? null : this.lastCp;
      const v = this.vehicle;
      const px = cp ? cp.x : this.level.start.x;
      const py = cp ? cp.y : this.level.start.y;
      this.placeAt(px, py, 0, 0);
      v.boost = 1;
      if (cp) this.world.time = cp.time + 2;
      else this.world.time = 0;
      this.world.updateWater();
      this.world.events.length = 0;
      this.chain = 0;
      this.flipsCredited = 0; this.pendingFlipPts = 0; this.airDur = 0; this.landEval = null; this.landedT = 0; this.freeT = 0;
      this.swim = 0;
      for (const c of this.crossings) c.left = false;
      this.respawns++;
      this.reason = '';
      this.beginCount(cp ? 1.2 : 3);
      this.emit({ type: 'respawn', x: px, y: py, checkpoint: !!cp });
    }

    crash(reason) {
      if (this.state === 'crashed' || this.state === 'results' || this.state === 'count') return;
      const v = this.vehicle;
      this.reason = reason;
      this.crashT = 0;
      this.chain = 0;
      this.pendingFlipPts = 0;
      this.best.crashes++;
      v.canDrive = false;
      this.setState('crashed');
      this.emit({ type: 'crash', reason, x: v.x, y: v.y, speed: v.speed / U.PPF });
    }

    award(key, pts, text, kind, useMult) {
      const m = useMult === false ? 1 : this.mult();
      const p = Math.round(pts * m);
      this.score[key] += p;
      this.emit({ type: 'stunt', text, pts: p, kind, mult: m });
      return p;
    }

    /* ---------------------------------------------------------- main step */
    step(dt, ctl) {
      const v = this.vehicle, w = this.world;
      const st = this.state;
      let c = ctl || ZERO;
      if (st === 'count' || st === 'crashed') c = ZERO;
      else if (st === 'results') c = { throttle: 0, brake: 0.7, rot: 0, boost: false };
      v.canDrive = !(st === 'count' || st === 'crashed' || st === 'results');
      const t0 = w.time;
      w.step(dt, c);
      if (st === 'count') w.time = t0;
      this.stateTime += dt;

      // pass physics events along and analyse impacts
      let impactBad = false;
      for (const e of w.events) {
        this.emit(e);
        if (e.type === 'impact') {
          if (e.kind === 'roof' && e.speed > FD.CRASH.roof) this.pendingCrash = 'ROOF IMPACT';
          else if (e.kind === 'body') {
            const th = Math.atan2(-e.nx, e.ny);
            const tilt = Math.abs(M.wrapPi(this.vehicle.a - th));
            if (e.speed > FD.CRASH.bodyAny || (tilt > FD.CRASH.tilt && e.speed > FD.CRASH.bodyTilted)) this.pendingCrash = 'HEAVY IMPACT';
          }
          if (e.kind === 'roof' && e.speed > 6) impactBad = true;
          else if (e.kind === 'body' && e.speed > 12 && Math.abs(M.wrapPi(this.vehicle.a - Math.atan2(-e.nx, e.ny))) > 0.6) impactBad = true;
        }
      }
      w.events.length = 0;
      if (impactBad && this.landEval) this.landEval.bad = true;
      this.update(dt, c);
    }

    update(dt, c) {
      const v = this.vehicle, w = this.world, PPF = U.PPF;
      const xf = v.x / PPF, yf = v.y / PPF;
      let st = this.state;

      if (st === 'count') {
        this.count -= dt;
        const n = Math.ceil(this.count);
        if (n !== this.lastTick && n > 0) { this.lastTick = n; this.emit({ type: 'tick', n, total: this.countLen }); }
        if (this.count <= 0) { this.state = 'drive'; this.stateTime = 0; this.emit({ type: 'state', state: 'drive', from: 'count' }); this.emit({ type: 'go' }); }
        return;
      }
      if (st === 'crashed') { this.crashT += dt; return; }
      if (st === 'results') return;

      this.time += dt;
      if (xf > this.maxX) this.maxX = xf;
      this.score.distance = Math.max(0, (this.maxX - this.startX)) * 0.5;
      const mph = U.toMph(v.speed);
      if (mph > this.best.topMph) this.best.topMph = mph;

      /* ---- crash conditions ---- */
      if (this.pendingCrash) { const r = this.pendingCrash; this.pendingCrash = null; this.crash(r); return; }
      const upAngle = Math.cos(v.a - (this.groundAngle || 0));
      if (v.roofTime > FD.CRASH.roofTime) { this.crash('ROOF IMPACT'); return; }
      if (v.wheelsOnGround > 0 && upAngle < -0.25) { this.upsideT = (this.upsideT || 0) + dt; } else this.upsideT = 0;
      if (this.upsideT > 1.0) { this.crash('FLIPPED OVER'); return; }
      if (this.level.killY !== null && this.level.killY !== undefined && yf < this.level.killY) { this.crash('FELL OFF THE CITY'); return; }
      if (!v.amphibious && v.submergedTime > 1.0) { this.crash('SUNK'); return; }
      if (v.amphibious && v.submergedTime > 3.0) { this.crash('SUNK'); return; }

      /* ---- swimming bookkeeping ---- */
      if (v.amphibious && v.inWater && v.wheelsOnGround === 0) this.swim += dt;
      else if (v.wheelsOnGround > 0 && !v.inWater) { /* keep swim until crossing bonus reads it */ }

      /* ---- ground angle ---- */
      let n = 0, ang = 0, onRamp = false;
      for (const wh of v.wheels) {
        if (wh.contact) { ang += Math.atan2(-wh.nx, wh.ny); n++; if (wh.tag === 'ramp') onRamp = true; }
      }
      const grounded = n > 0;
      if (grounded) this.groundAngle = ang / n;
      const gAng = this.groundAngle || 0;

      /* ---- rings ---- */
      for (const r of this.rings) {
        if (r.got) continue;
        if (Math.hypot(xf - r.x, yf - r.y) < r.r + 6.5) {
          r.got = true; r.t = 0; this.best.ringsGot++;
          this.score.rings += 250;
          this.emit({ type: 'ring', x: r.x, y: r.y, n: this.best.ringsGot });
          this.emit({ type: 'stunt', text: 'RING', pts: 250, kind: 'ring', mult: 1 });
        }
      }

      /* ---- checkpoints ---- */
      if (grounded) {
        for (const cp of this.checkpoints) {
          if (!cp.reached && xf > cp.x) {
            cp.reached = true; cp.time = w.time;
            this.lastCp = cp;
            this.emit({ type: 'checkpoint', label: cp.label, x: cp.x, y: cp.y });
          }
        }
      }

      /* ---- crossings ---- */
      if (grounded) {
        for (const cr of this.crossings) {
          if (cr.done) continue;
          if (xf <= cr.x0) cr.left = true;
          else if (cr.left && xf > cr.x1) {
            cr.done = true; this.best.crossings++;
            let pts = 1500;
            if (this.swim > 1.2) { pts += 2500; this.emit({ type: 'stunt', text: 'SWIM BONUS', pts: 0, kind: 'water' }); }
            this.award('water', pts, cr.label + ' COMPLETE', 'water');
            this.chain++;
            this.swim = 0;
          }
        }
      }

      /* ---- finish ---- */
      if (xf > this.level.finishX && grounded && this.state !== 'crashed') {
        const par = this.level.par || this.level.finishX / 62;
        this.score.time = Math.max(0, Math.round((par - this.time) * 60));
        this.setState('results');
        this.emit({ type: 'finish', time: this.time });
        return;
      }

      /* ---- state machine: ground / ramp / air / landed ---- */
      // free flight = no wheel contact and not floating/swimming. Water supports the vehicle, so a bobbing SUV is never 'airborne'.
      if (v.wheelsOnGround === 0 && v.wet < 0.12) this.freeT += dt; else this.freeT = 0;
      const airborne = this.freeT > 0.12;
      if (st === 'air') {
        // accumulate rotation + credit flips
        this.airDur += dt;
        if (v.y > this.peakY) this.peakY = v.y;
        const rot = v.a - this.launchA;
        const flips = Math.floor((Math.abs(rot) + 0.7) / TWO_PI);
        if (flips > this.flipsCredited) {
          this.flipsCredited = flips;
          this.best.flips++;
          const dir = rot > 0 ? 'BACKFLIP' : 'FRONT FLIP';
          const text = flips === 1 ? dir : (ORD[flips] || (flips + 'X')) + ' ' + dir;
          this.pendingFlipPts += 500 * flips;
          this.emit({ type: 'flip', n: flips, dir: rot > 0 ? 'back' : 'front', text });
          this.emit({ type: 'stunt', text, pts: 500 * flips, kind: 'flip', pending: true, mult: this.mult() });
        }
        if (this.airDur > this.best.maxAirT) this.best.maxAirT = this.airDur;
        if (flips > this.best.maxFlips) this.best.maxFlips = flips;
        if (v.wheelsOnGround > 0) this.touchdown('ground', gAng);
        else if (v.amphibious && v.wet > 0.45) this.touchdown('water', 0);
      } else if (airborne) {
        // leaving the ground (bank a pending landing first if we bounce)
        if (this.landEval) { this.landEval.t = 1; this.resolveLanding(0); }
        const fromState = st;
        this.launchA = v.a; this.flipsCredited = 0; this.pendingFlipPts = 0; this.airDur = this.freeT; this.peakY = v.y;
        this.setState('air');
        if (v.speed / PPF > 30 && (fromState === 'ramp' || fromState === 'drive' || fromState === 'landed')) {
          this.emit({ type: 'launch', speed: v.speed / PPF, vy: v.vy / PPF, ramp: fromState === 'ramp' });
        }
      } else if (st === 'landed') {
        this.landedT += dt;
        this.resolveLanding(dt);
        if (this.landedT > 1.0) this.setState(onRamp && gAng > 0.1 ? 'ramp' : 'drive');
      } else {
        const wantRamp = onRamp && gAng > 0.1;
        if (wantRamp && st !== 'ramp') this.setState('ramp');
        else if (!wantRamp && st === 'ramp') this.setState('drive');
        if (this.landEval) this.resolveLanding(dt);
      }
    }

    touchdown(kind, gAng) {
      const v = this.vehicle;
      const dur = this.airDur;
      this.airDur = 0;
      // small hops / water bobbing are not stunts: need real airtime AND a real drop from the apex
      const drop = (this.peakY - v.y) / U.PPF;
      if (this.flipsCredited === 0 && (dur < 0.45 || drop < 8)) { this.setState(kind === 'water' ? 'drive' : 'drive'); return; }
      const err = Math.abs(M.wrapPi(v.a - gAng));
      this.landEval = { kind, err, t: 0, bad: false, dur, vy: v.vy / U.PPF, flips: this.flipsCredited, pending: this.pendingFlipPts };
      this.landedT = 0;
      this.setState('landed');
      this.emit({ type: 'touchdown', kind, err, dur, vy: v.vy / U.PPF, speed: v.speed / U.PPF });
    }

    resolveLanding(dt) {
      const e = this.landEval;
      if (!e) return;
      e.t += dt;
      if (e.t < 0.5) return;
      this.landEval = null;
      if (this.state === 'crashed') return;
      let grade;
      const limitPerfect = e.kind === 'water' ? 0.45 : 0.21, limitGood = e.kind === 'water' ? 0.8 : 0.45;
      if (!e.bad && e.err < limitPerfect) grade = 'perfect';
      else if (!e.bad && e.err < limitGood) grade = 'good';
      else grade = 'sloppy';
      const parts = [];
      if (e.pending > 0) { this.pendingFlipPts = 0; this.award('stunts', e.pending, 'FLIP' + (e.flips > 1 ? 'S' : '') + ' BANKED', 'flip'); parts.push('flip'); }
      if (e.dur > 1.0) {
        const air = Math.round((e.dur - 0.8) * 150);
        if (air > 0) { this.award('air', air, 'AIRTIME ' + e.dur.toFixed(1) + 's', 'air'); parts.push('air'); }
      }
      if (grade === 'perfect') {
        this.award('landing', 1000, e.kind === 'water' ? 'PERFECT SPLASHDOWN' : 'PERFECT LANDING', 'land');
        this.best.perfect++;
        this.chain++;
      } else if (grade === 'good') {
        this.award('landing', 400, 'GOOD LANDING', 'land');
        this.chain++;
      } else {
        if (e.dur > 1.0 || e.flips > 0) this.emit({ type: 'stunt', text: 'SLOPPY LANDING', pts: 0, kind: 'sloppy' });
        this.chain = 0;
      }
      this.emit({ type: 'landing', grade, err: e.err, chain: this.chain, mult: this.mult() });
    }
  }

  FD.Run = Run;
})(typeof window !== 'undefined' ? window : globalThis);
