// Quick tuning harness: runway + ramp launch and free-flight landing for each vehicle.
const path = require('path');
const root = path.join(__dirname, '..', 'js');
['util', 'physics', 'vehicles', 'levels'].forEach((f) => require(path.join(root, f + '.js')));
const FD = globalThis.FD, U = FD.Units;

const P = { rampStart: 650, rampDeg: 36, rampR: 200, rampStraight: 40, beachX: 1500, beachY: -12, crestRun: 160, backDeg: 28, backLen: 120, deckLen: 800 };
const B = FD.buildCoastal(P);
const level = {
  waterY: 0,
  ground: [
    { pts: B.launchPiece || [] }
  ]
};
// rebuild pieces manually
const lvl = FD.buildCoastal(P);
level.ground = [
  { pts: (function () { const T = FD.LevelTools; return null; })() }
];

function makeLevel(P) {
  const T = FD.LevelTools;
  const platY = 60;
  const runway = [[-320, platY, 'road'], [P.rampStart, platY, 'road']];
  const arcPts = T.curve(P.rampStart, platY, 0, P.rampDeg, P.rampR, 'ramp');
  const e1 = T.endOf(arcPts);
  const straight = T.line(e1.x, e1.y, P.rampDeg, P.rampStraight, 'ramp');
  const launch = T.join(runway, arcPts, straight);
  const lip = T.endOf(launch);
  const out = FD.buildCoastal(P);
  return {
    waterY: 0,
    ground: [
      { pts: launch },
      { pts: [[lip.x, -140], [P.beachX, -140]] },
      { pts: out.landingPiece }
    ],
    platforms: [],
    lip, out
  };
}

function run(specId, opts) {
  opts = opts || {};
  const level = makeLevel(P);
  const v = new FD.Vehicle(FD.VEHICLE_SPECS[specId]);
  const world = new FD.World(level, v);
  const y0 = 60 * U.PPF + v.restHeight() + 2;
  v.reset(0, y0, 0, 0, 0);
  const dt = 1 / 120;
  let t = 0, lipInfo = null, log = [];
  let maxSpeed = 0;
  for (let i = 0; i < 120 * 40; i++) {
    const ctl = { throttle: 1, brake: 0, rot: opts.rotFn ? opts.rotFn(t, v, world) : 0, boost: opts.boost && t > 2 };
    world.step(dt, ctl);
    t += dt;
    maxSpeed = Math.max(maxSpeed, v.speed);
    const xft = v.x / U.PPF, yft = v.y / U.PPF;
    if (!lipInfo && xft > level.lip.x) {
      lipInfo = { t, speedFt: v.speed / U.PPF, vx: v.vx / U.PPF, vy: v.vy / U.PPF, ang: v.a * 57.3, w: v.w, y: yft };
    }
    if (i % 60 === 0 && opts.verbose) log.push([t.toFixed(1), xft.toFixed(0), yft.toFixed(1), (v.speed / U.PPF).toFixed(1), (v.a * 57.3).toFixed(1), v.wheelsOnGround]);
    // stop if landed (ground contact after lip) or in water for a while
    if (lipInfo && v.wheelsOnGround > 0 && t > lipInfo.t + 1) break;
    if (lipInfo && v.y < -5 * U.PPF) break;
  }
  return { t, x: v.x / U.PPF, y: v.y / U.PPF, ang: v.a * 57.3, lipInfo, maxSpeed: maxSpeed / U.PPF, log, events: world.events.filter((e) => e.type !== 'impact').length };
}

for (const id of ['pickup', 'suv']) {
  for (const boost of [false, true]) {
    const r = run(id, { boost, verbose: false });
    console.log(id, boost ? 'BOOST' : 'plain', JSON.stringify({ lip: r.lipInfo, endX: r.x.toFixed(0), endY: r.y.toFixed(1), ang: r.ang.toFixed(1), t: r.t.toFixed(1), maxSpeed: r.maxSpeed.toFixed(1) }));
  }
}
const r = run('pickup', { verbose: true });
console.log(r.log.map((l) => l.join(' ')).join('\n'));
