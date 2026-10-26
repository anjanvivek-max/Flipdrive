const { chromium } = require('playwright');
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
  await p.goto('http://127.0.0.1:8137/index.html');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: OUT + '/01_title.png' });
  const st = await p.evaluate(() => ({ mode: FD.App.mode, screen: FD.App.screen, state: FD.App.stateName(), runState: FD.App.run.state, x: FD.App.run.vehicle.x / FD.Units.PPF }));
  console.log(JSON.stringify(st));
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})();
