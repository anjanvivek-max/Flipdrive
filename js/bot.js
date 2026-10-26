/* FlipDrive: EV Chaos - bot.js
 * A small autopilot used for the title-screen attract mode and by the headless tests.
 * Throttle held, boost on request, and slope-matching air control (with optional flips).
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});
  const U = FD.Units, M = FD.M;

  FD.makeBot = function (o) {
    o = o || {};
    return function (run) {
      const v = run.vehicle, xf = v.x / U.PPF;
      const c = { throttle: 1, brake: 0, rot: 0, boost: false };
      if (o.boost && xf > o.boost[0] && xf < o.boost[1]) c.boost = true;
      if (o.boostAlways) c.boost = true;
      const inAir = v.wheelsOnGround === 0 && v.airTime > 0.1 && !(v.amphibious && v.wet > 0.3);
      if (inAir) {
        const hit = run.world.terrain.rayCast(v.x, v.y, 0, -1, U.len(900));
        const h = hit ? (v.y - hit.y) / U.PPF : 999;
        let tgt = Math.atan2(v.vy, v.vx);
        if (hit && h < (o.slopeH || 140)) {
          const th = Math.atan2(-hit.nx, hit.ny);
          const k = M.clamp((h - 30) / 110, 0, 1); // blend velocity -> slope as the ground nears
          tgt = M.lerp(th, tgt, k);
        }
        const rot = v.a - run.launchA;
        if (o.flip && run.flipsCredited < o.flip && Math.abs(rot) < o.flip * 6.28 - 0.5 && run.airDur > 0.3 && h > 120) c.rot = o.dir || 1;
        else {
          const err = M.wrapPi(tgt - v.a);
          c.rot = M.clamp(3.2 * err - 0.8 * v.w, -1, 1);
        }
      }
      return c;
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
