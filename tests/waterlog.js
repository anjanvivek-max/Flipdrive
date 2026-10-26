const { chromium } = require('playwright');
const VEH = process.argv[2] || 'suv';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
  await p.addInitScript(() => { localStorage.setItem('flipdrive.save', JSON.stringify({ tutorialSeen: true, vehicle: 'pickup', level: 0, susp: 1, best: {}, records: {} })); });
  await p.goto('http://127.0.0.1:8137/index.html');
  await p.waitForTimeout(300);
  await p.evaluate((veh) => {
    const A = FD.App, U = FD.Units; window.LOG = [];
    A.startRun(0, veh);
    const r = A.run, L = r.level.info.L; r.count = 0.01;
    const orig = A.processEvents.bind(A);
    A.processEvents = function () { for (const e of this.run.out) if (['stunt', 'landing', 'touchdown', 'splash', 'crash', 'state'].includes(e.type)) window.LOG.push([+this.run.world.time.toFixed(2), e.type, e.text || e.grade || e.state || e.reason || '', e.pts !== undefined ? e.pts : ''].join(' ')); return orig(); };
    A.debugBot = () => ({ throttle: A.thr || 0, brake: 0, rot: 0, boost: false });
    setTimeout(() => { r.vehicle.reset(U.len(L + 40), U.len(34), -0.15, U.len(48), U.len(6)); r.groundAngle = 0; }, 400);
  }, VEH);
  await p.waitForTimeout(12000);
  console.log((await p.evaluate(() => window.LOG)).join('\n'));
  console.log('score', await p.evaluate(() => FD.App.run.scoreTotal()));
  await b.close();
})();
