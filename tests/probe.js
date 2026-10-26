const path = require('path');
const root = path.join(__dirname, '..', 'js');
['util', 'physics', 'vehicles', 'levels', 'run'].forEach((f) => require(path.join(root, f + '.js')));
const FD = globalThis.FD, U = FD.Units, M = FD.M;
FD.buildLevels();
const makeBot = require('./bot.js');
if (process.env.BODYANY) FD.CRASH.bodyAny = +process.env.BODYANY;
const L = FD.LEVELS[+(process.argv[4] || 0)];
const spec = process.argv[2] || 'pickup';
const rs = L.info.rampStart;
const bot = makeBot(process.argv[3] === 'b' ? { boost: [rs - 150, rs + 300] } : {});
const run = new FD.Run(L, spec, {});
const dt = 1 / 120; let t = 0; const hist = [];
const T_END = +(process.env.TEND || 40);
while (t < T_END && run.state !== 'crashed' && run.state !== 'results') {
  const c = bot(run);
  run.step(dt, c); t += dt;
  const v = run.vehicle;
  hist.push([t, run.state, v.x / U.PPF, v.y / U.PPF, v.vx / U.PPF, v.vy / U.PPF, v.a * 57.3, v.w, v.wheelsOnGround, v.wheels.map((w) => (w.s / U.PPF).toFixed(2)).join('/')]);
  for (const e of run.out) if (e.type === 'impact' || e.type === 'touchdown' || e.type === 'crash') console.log(t.toFixed(2), e.type, e.kind || '', (e.speed || 0).toFixed(1), e.err !== undefined ? 'err ' + e.err.toFixed(2) : '');
  run.out.length = 0;
}
for (const h of hist.slice(-(+process.env.TAIL || 70)).filter((_, i) => i % (+process.env.EVERY || 5) === 0)) console.log(h[0].toFixed(2), h[1].padEnd(7), 'x', h[2].toFixed(0), 'y', h[3].toFixed(1), 'vx', h[4].toFixed(0), 'vy', h[5].toFixed(0), 'a', h[6].toFixed(0), 'w', h[7].toFixed(2), 'wg', h[8], 'susp', h[9]);
