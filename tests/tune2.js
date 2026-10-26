// Explore launch speeds / ranges for runway length options
const path = require('path');
const root = path.join(__dirname, '..', 'js');
['util', 'physics', 'vehicles', 'levels'].forEach((f) => require(path.join(root, f + '.js')));
const FD = globalThis.FD, U = FD.Units, T = FD.LevelTools;
function launchLevel(rampStart, deg, R, straight) {
  const runway = [[-320, 60, 'road'], [rampStart, 60, 'road']];
  const arc = T.curve(rampStart, 60, 0, deg, R, 'ramp');
  const e = T.endOf(arc);
  const st = T.line(e.x, e.y, deg, straight, 'ramp');
  const launch = T.join(runway, arc, st);
  return { waterY: 0, ground: [{ pts: launch }, { pts: [[T.endOf(launch).x, -400], [4000, -400]] }], platforms: [], lip: T.endOf(launch) };
}
function run(specId, L, boostAt, speedScale) {
  const v = new FD.Vehicle(FD.VEHICLE_SPECS[specId]);
  const w = new FD.World(L, v);
  v.reset(0, 60 * U.PPF + v.restHeight() + 2, 0, 0, 0);
  const dt = 1 / 120; let t = 0, lip = null; const arc = [];
  for (let i = 0; i < 120 * 40; i++) {
    const th = speedScale && !lip ? (v.speed / U.PPF > speedScale ? 0 : 1) : 1;
    w.step(dt, { throttle: th, boost: boostAt !== null && v.x / U.PPF > boostAt });
    t += dt;
    const x = v.x / U.PPF, y = v.y / U.PPF;
    if (!lip && x > L.lip.x) lip = { t, spd: v.speed / U.PPF, vx: v.vx / U.PPF, vy: v.vy / U.PPF };
    if (lip) arc.push([x, y, v.vx / U.PPF, v.vy / U.PPF]);
    if (lip && y < 0) break;
  }
  return { lip, arc, t };
}
const rampStart = +process.argv[2] || 800;
const L = launchLevel(rampStart, 36, 200, 40);
console.log('lip', L.lip);
for (const id of ['pickup', 'suv']) {
  for (const [name, boostAt, cap] of [['plain', null, 0], ['boost@ramp', rampStart - 120, 0], ['85%', null, 0.85]]) {
    const r = run(id, L, boostAt, cap ? (FD.VEHICLE_SPECS[id].motor.vmax * cap) : 0);
    const a = r.arc; const end = a[a.length - 1];
    const at = (xx) => { const p = a.find((q) => q[0] >= xx); return p ? p[1].toFixed(0) : '-'; };
    console.log(id.padEnd(6), name.padEnd(11), 'lipSpd', r.lip.spd.toFixed(1), 'vy', r.lip.vy.toFixed(1), 'landX', end[0].toFixed(0), 'range', (end[0] - L.lip.x).toFixed(0), 'y@+200', at(L.lip.x + 200), 'y@+300', at(L.lip.x + 300), 'y@+400', at(L.lip.x + 400), 'y@+500', at(L.lip.x + 500), 'T', (a.length / 120).toFixed(1));
  }
}
