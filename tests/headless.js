// Headless gameplay tests: bots drive every level with both vehicles using FD.Run.
const path = require('path');
const root = path.join(__dirname, '..', 'js');
['util', 'physics', 'vehicles', 'levels', 'run'].forEach((f) => require(path.join(root, f + '.js')));
const FD = globalThis.FD, U = FD.Units, M = FD.M;
FD.buildLevels();

const makeBot = require('./bot.js');

function sim(levelIdx, spec, opt, verbose) {
  const L = FD.LEVELS[levelIdx];
  const run = new FD.Run(L, spec, {});
  const bot = makeBot(opt);
  const dt = FD.PHYS.STEP;
  const log = [];
  let maxT = 120, t = 0, respawns = 0;
  while (t < maxT && run.state !== 'results') {
    const c = bot(run);
    run.step(dt, c);
    t += dt;
    for (const e of run.out) {
      if (['stunt', 'crash', 'checkpoint', 'landing', 'launch', 'finish', 'respawn', 'touchdown'].includes(e.type)) log.push([t.toFixed(1), e.type, e.text || e.reason || e.label || e.grade || (e.speed ? e.speed.toFixed(0) : ''), e.pts !== undefined ? e.pts : '', e.err !== undefined ? e.err.toFixed(2) : ''].join(' '));
    }
    run.out.length = 0;
    if (run.state === 'crashed' && run.crashT > 0.8) {
      if (opt.respawn && respawns < 3) { run.respawn(false); respawns++; } else break;
    }
  }
  const v = run.vehicle;
  const res = `L${levelIdx + 1} ${spec.padEnd(6)} ${JSON.stringify(opt).padEnd(48)} -> ${run.state.padEnd(8)} x=${(v.x / U.PPF).toFixed(0)}/${L.finishX.toFixed(0)} t=${run.time.toFixed(1)} score=${run.scoreTotal()} flips=${run.best.flips} rings=${run.best.ringsGot}/${L.rings.length} reason=${run.reason}`;
  console.log(res);
  if (verbose) console.log(log.map((s) => '    ' + s).join('\n'));
  return run;
}

const args = process.argv.slice(2);
const lv = args[0] !== undefined ? +args[0] : -1;
const verbose = args.includes('-v');
const I = FD.LEVELS.map((l, i) => i);
for (const li of (lv >= 0 ? [lv] : I)) {
  const L = FD.LEVELS[li];
  for (const spec of ['pickup', 'suv']) {
    const rs = li === 0 ? L.info.rampStart : 0;
    const strategies = li === 0
      ? [{}, { boost: [rs - 150, rs + 300] }, { boost: [rs - 150, rs + 300], flip: 1 }, { boost: [rs - 150, rs + 300], flip: 1, dir: -1 }]
      : [{}, { boostAlways: true }, { boostAlways: true, flip: 1 }];
    for (const s of strategies) sim(li, spec, s, verbose);
  }
}
