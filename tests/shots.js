// Plays a level with the autopilot inside the real page and grabs screenshots at interesting moments.
const { chromium } = require('playwright');
const OUT = process.argv[2], LV = +(process.argv[3] || 0), VEH = process.argv[4] || 'pickup', OPT = process.argv[5] || '{}';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
  await p.addInitScript(() => { localStorage.setItem('flipdrive.save', JSON.stringify({ tutorialSeen: true, vehicle: 'pickup', level: 0, susp: 1, best: {}, records: {} })); });
  await p.goto('http://127.0.0.1:8137/index.html');
  await p.waitForTimeout(500);
  await p.evaluate(([lv, veh, opt]) => {
    const A = FD.App; const o = JSON.parse(opt);
    const L = FD.LEVELS[lv];
    if (o.boost === 'ramp') o.boost = [L.info.rampStart - 150, L.info.rampStart + 300];
    A.startRun(lv, veh);
    A.debugBot = FD.makeBot(o);
  }, [LV, VEH, OPT]);
  const seen = {}; let n = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 70000) {
    const s = await p.evaluate(() => { const r = FD.App.run, v = r.vehicle; return { st: r.state, alt: FD.App.cam.alt || 0, vy: v.vy / FD.Units.PPF, ts: FD.App.timeScale, wet: v.wet, x: v.x / FD.Units.PPF, screen: FD.App.screen, air: r.airDur }; });
    let key = s.st;
    if (s.st === 'air' && s.air > 1.0 && Math.abs(s.vy) < 25) key = 'apex';
    if (s.st === 'air' && s.air > 0.5 && s.vy > 40) key = 'climb';
    if (s.wet > 0.4) key = 'water';
    if (!seen[key] && n < 14) { seen[key] = 1; n++; await p.screenshot({ path: `${OUT}/L${LV}_${VEH}_${n}_${key}.png` }); console.log('shot', n, key, JSON.stringify(s)); }
    if (s.screen === 'results' || s.screen === 'crash') { await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/L${LV}_${VEH}_end_${s.screen}.png` }); console.log('END', s.screen); break; }
    await p.waitForTimeout(120);
  }
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})();
