// Teleports a vehicle above the sea and watches what the water does (buoyancy, splash, sinking, respawn).
const { chromium } = require('playwright');
const OUT = process.argv[2], VEH = process.argv[3] || 'suv';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await p.addInitScript(() => { localStorage.setItem('flipdrive.save', JSON.stringify({ tutorialSeen: true, vehicle: 'pickup', level: 0, susp: 1, best: {}, records: {} })); });
  await p.goto('http://127.0.0.1:8137/index.html');
  await p.waitForTimeout(400);
  await p.evaluate((veh) => {
    const A = FD.App, U = FD.Units;
    A.startRun(0, veh);
    const r = A.run, L = r.level.info.L;
    r.count = 0.01;
    A.debugBot = () => ({ throttle: A.thr || 0, brake: 0, rot: 0, boost: false });
    setTimeout(() => {
      const v = r.vehicle;
      v.reset(U.len(L + 40), U.len(34), -0.15, U.len(48), U.len(6));
      r.groundAngle = 0;
    }, 600);
  }, VEH);
  const log = [];
  const t0 = Date.now(); let shot = 0;
  while (Date.now() - t0 < 9000) {
    const s = await p.evaluate(() => { const r = FD.App.run, v = r.vehicle, U = FD.Units; return { t: +r.world.time.toFixed(2), st: r.state, wet: +v.wet.toFixed(2), yft: +(v.y / U.PPF).toFixed(1), vyft: +(v.vy / U.PPF).toFixed(1), sub: +v.submergedTime.toFixed(2), reason: r.reason, scr: FD.App.screen, floats: v.wet > 0.3 && Math.abs(v.vy) / U.PPF < 3 }; });
    log.push(s);
    const el = Date.now() - t0;
    if (el > 900 && shot < 7 && el > 900 + shot * 650) { shot++; await p.screenshot({ path: `${OUT}/W_${VEH}_${shot}.png` }); }
    if (s.scr === 'crash') { await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/W_${VEH}_crash.png` }); break; }
    if (el > 5000 && VEH === 'suv') await p.evaluate(() => { FD.App.thr = 1; });
    await p.waitForTimeout(100);
  }
  const every = log.filter((_, i) => i % 6 === 0);
  console.log(every.map((s) => JSON.stringify(s)).join('\n'));
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})();
