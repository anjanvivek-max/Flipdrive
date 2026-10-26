/* FlipDrive: EV Chaos - main.js
 * Application shell:
 *   - fixed 1/120 s physics accumulator driven by requestAnimationFrame (render interpolates)
 *   - controlled slow motion = scaling how much real time feeds the accumulator; the step never changes
 *   - screen/overlay flow (title, garage, levels, settings, pause, crash, results, tutorial)
 *   - turns Run events into audio, particles, camera shake and HUD notifications
 *   - saves best scores, records, settings and the selected vehicle/level in localStorage
 */
(function (root) {
  'use strict';
  const FD = root.FD;
  const U = FD.Units, M = FD.M, A = FD.Audio, Input = FD.Input, Store = FD.Store;
  const STEP = FD.PHYS.STEP;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const BASE_SCREENS = ['title', 'garage', 'levels', 'settings'];

  const DEFAULT_SETTINGS = { quality: 'auto', cinematic: true, shake: 1, showState: true, touch: 'auto' };
  const DEFAULT_SAVE = { vehicle: 'pickup', level: 0, susp: 1, tutorialSeen: false, best: {}, records: { longestAir: 0, mostFlips: 0, topMph: 0, rings: 0, runs: 0 } };

  const TUTORIAL = [
    { h: 'DRIVE', body: '<p>Hold <kbd>W</kbd> / <kbd>&uarr;</kbd> to accelerate, <kbd>S</kbd> / <kbd>&darr;</kbd> to brake and reverse. Tap <kbd>Space</kbd> for boost.</p><p class="m">On a phone use the big buttons: GAS, BRAKE, BOOST and the two tilt buttons.</p>' },
    { h: 'LAUNCH', body: '<p>The giant ramp is your launch pad. Keep the throttle down, hit it fast and save your boost for the lip.</p><p>Collect the golden rings and pass checkpoints &mdash; a wreck respawns you at the last one.</p>' },
    { h: 'FLIP &amp; LAND', body: '<p>In the air, <kbd>A</kbd> / <kbd>&larr;</kbd> pitches the nose <b>up</b> (backflip), <kbd>D</kbd> / <kbd>&rarr;</kbd> pitches it <b>down</b> (front flip).</p><p>Line your wheels up with the ground for a PERFECT landing. Land on the roof and you wreck.</p>' },
    { h: 'WATER', body: '<p>The <b>Voltra Shard</b> pickup sinks. The <b>Aurelia Tiderunner</b> SUV floats and swims &mdash; steer with gas/brake, climb out on the far shore. Press <kbd>C</kbd> to change its suspension.</p><p><kbd>R</kbd> restarts &middot; <kbd>Esc</kbd> pauses &middot; <kbd>M</kbd> mutes.</p>' }
  ];

  const App = {
    save: null, settings: null,
    screen: 'title', backTo: 'title',
    mode: 'attract', // attract | play
    run: null, levelIdx: 0, vehicleId: 'pickup',
    bot: null, debugBot: null, attractFlip: false,
    acc: 0, timeScale: 1, slowUntil: 0, slowScale: 1,
    last: 0, frameN: 0, ftSum: 0, autoLow: false,
    cin: 0, flash: 0, scoreShown: 0,
    tutStep: 0, tutReturn: 'none',
    sawTouch: false,
    shownResults: false, resultsAnim: null,
    chainShown: -1, hudCache: {},
    previews: {},

    /* ====================================================== boot */
    init() {
      FD.buildLevels();
      this.settings = Object.assign({}, DEFAULT_SETTINGS, Store.get('settings', {}));
      this.save = Object.assign({}, DEFAULT_SAVE, Store.get('save', {}));
      this.save.records = Object.assign({}, DEFAULT_SAVE.records, this.save.records || {});
      this.save.best = this.save.best || {};
      if (!FD.VEHICLE_SPECS[this.save.vehicle]) this.save.vehicle = 'pickup';
      if (!(this.save.level >= 0 && this.save.level < FD.LEVELS.length)) this.save.level = 0;
      this.vehicleId = this.save.vehicle; this.levelIdx = this.save.level;
      this.coarse = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);

      this.canvas = $('game');
      this.renderer = new FD.Renderer(this.canvas);
      this.cam = new FD.Camera();
      this.fx = new FD.Fx();
      A.loadSettings();

      for (const id in FD.VEHICLE_SPECS) {
        const veh = new FD.Vehicle(FD.VEHICLE_SPECS[id]);
        if (id === 'suv') veh.setSuspension(this.save.susp);
        this.previews[id] = veh;
      }
      this.buildGarage();
      this.buildLevels();
      this.bindUI();
      this.bindSettings();
      Input.init($('touch'));
      Input.on('restart', () => this.onRestart());
      Input.on('pause', () => this.onPause());
      Input.on('suspension', () => this.cycleSuspension());
      Input.on('mute', () => { const m = A.toggleMute(); $('setMute').checked = m; this.toast(m ? 'SOUND OFF' : 'SOUND ON'); });
      Input.on('confirm', () => this.onConfirm());

      const unlock = () => { A.init(); };
      ['pointerdown', 'keydown', 'touchstart'].forEach((e) => root.addEventListener(e, unlock, { passive: true }));
      root.addEventListener('touchstart', () => { this.sawTouch = true; }, { passive: true, once: true });
      root.addEventListener('resize', () => this.resize());
      root.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
      if (root.visualViewport) root.visualViewport.addEventListener('resize', () => this.resize());
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'play' && this.screen === 'none') this.pause(); });
      document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && b.blur) b.blur(); }, true);
      this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      this.applyQuality();
      this.resize();
      this.startAttract();
      this.show('title');
      this.last = performance.now();
      root.requestAnimationFrame((t) => this.frame(t));
    },

    quality() { return this.settings.quality === 'auto' ? (this.autoLow ? 'low' : 'high') : this.settings.quality; },
    applyQuality() {
      const low = this.quality() === 'low';
      this.fx.quality = low ? 0.4 : 1;
      this.renderer.quality = low ? 0 : 1;
      if (this.canvas) this.resize();
    },
    resize() {
      const vv = root.visualViewport;
      const cw = Math.max(1, Math.round(vv ? vv.width : root.innerWidth)), ch = Math.max(1, Math.round(vv ? vv.height : root.innerHeight));
      const cap = this.quality() === 'low' ? 1 : (this.coarse || this.sawTouch ? 1.5 : 2);
      const dpr = Math.min(root.devicePixelRatio || 1, cap);
      const w = Math.max(2, Math.round(cw * dpr)), h = Math.max(2, Math.round(ch * dpr));
      if (w !== this.renderer.W || h !== this.renderer.H) this.renderer.resize(w, h);
    },

    /* ================================================== screens */
    show(name) {
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
      this.screen = name;
      if (name && name !== 'none') { const el = $(name); if (el) el.classList.add('active'); }
      if (name === 'title') this.updateSelectedLine();
      if (name === 'levels') this.refreshLevels();
      if (name === 'garage') this.refreshGarage();
      if (name === 'settings') this.syncSettings();
      Input.enabled = this.mode === 'play' && (name === 'none' || name === 'crash' || name === 'results');
      if (!Input.enabled) Input.clearTouch();
    },
    nav(name) {
      this.backTo = this.screen === 'none' ? 'title' : this.screen;
      this.show(name);
    },
    goBack() { this.show(this.backTo || 'title'); },
    isFrozen() {
      if (this.mode !== 'play') return false;
      return this.screen === 'pause' || this.screen === 'tutorial' || (this.screen === 'settings' && this.backTo === 'pause');
    },
    stateName() { return this.mode === 'play' && this.run ? this.run.state : 'title'; },
    toast(msg) {
      const t = $('toast'); t.textContent = msg; t.classList.add('show');
      clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove('show'), 1500);
    },

    /* ===================================================== runs */
    startRun(levelIdx, vehicleId) {
      this.levelIdx = levelIdx; this.vehicleId = vehicleId;
      this.save.level = levelIdx; this.save.vehicle = vehicleId; this.persist();
      const level = FD.LEVELS[levelIdx];
      this.mode = 'play';
      this.run = new FD.Run(level, vehicleId, { susp: this.save.susp });
      const b = this.save.best[level.id] && this.save.best[level.id][vehicleId];
      this.run._bestAtStart = b ? b.score : 0;
      this.run._best = b || null;
      this.resetView(level);
      this.buildProgress();
      this.shownResults = false; this.hudCache = {}; this.scoreShown = 0; this.chainShown = -1;
      $('notes').innerHTML = ''; $('countdown').className = ''; $('banner').className = '';
      $('hud').classList.remove('hidden');
      $('suspChip').classList.toggle('hidden', !this.run.vehicle.amphibious);
      this.updateSuspChip();
      this.show('none');
      if (!this.save.tutorialSeen) this.openTutorial('none');
    },
    resetView(level) {
      this.renderer.setLevel(level);
      this.cam.snap(); this.cam.landing = null;
      this.fx.clear();
      this.acc = 0; this.timeScale = 1; this.cin = 0; this.flash = 0; this.slowUntil = 0;
      this.renderer.trail.length = 0;
    },
    startAttract() {
      const lv = FD.LEVELS[0];
      this.attractFlip = !this.attractFlip;
      const rs = lv.info.rampStart;
      this.run = new FD.Run(lv, this.attractFlip ? 'suv' : 'pickup', { susp: 1 });
      this.run.count = 0.4; this.run.countLen = 0.4;
      this.bot = FD.makeBot(this.attractFlip ? { boost: [rs - 150, rs + 300], flip: 1, dir: -1 } : { boost: [rs - 150, rs + 300], flip: 1 });
      this.mode = 'attract';
      this.resetView(lv);
      $('hud').classList.add('hidden');
      this.attractT = 0;
    },
    quitToMenu(screen) {
      this.startAttract();
      A.silence();
      this.backTo = 'title';
      this.show(screen || 'title');
    },
    restartLevel() { this.startRun(this.levelIdx, this.vehicleId); },
    retry() {
      const r = this.run;
      if (!r) return;
      r.respawn(false);
      this.cam.snap(); this.fx.clear(); this.renderer.trail.length = 0; this.acc = 0;
      r._committed = false;
      this.show('none');
    },
    pause() { if (this.mode === 'play' && this.screen === 'none') { A.silence(); this.show('pause'); } },
    resume() { if (this.screen === 'pause') { this.last = performance.now(); this.show('none'); } },
    nextLevel() {
      const n = this.levelIdx + 1;
      if (n < FD.LEVELS.length) this.startRun(n, this.vehicleId); else this.startRun(0, this.vehicleId);
    },
    persist() { Store.set('save', this.save); },
    persistSettings() { Store.set('settings', this.settings); },

    onRestart() {
      if (this.mode !== 'play' || this.screen === 'tutorial' || this.screen === 'settings') return;
      this.restartLevel();
    },
    onPause() {
      if (this.mode === 'attract') { if (this.screen !== 'title') this.goBack(); return; }
      switch (this.screen) {
        case 'none': this.pause(); break;
        case 'pause': this.resume(); break;
        case 'settings': this.goBack(); break;
        default: break;
      }
    },
    onConfirm() {
      const ae = document.activeElement;
      if (ae && ae.tagName === 'BUTTON') return; // focused button handles Enter itself
      switch (this.screen) {
        case 'title': this.$play(); break;
        case 'pause': this.resume(); break;
        case 'crash': this.retry(); break;
        case 'results': this.nextLevel(); break;
        case 'tutorial': $('tutNext').click(); break;
        default: break;
      }
    },
    $play() { this.startRun(this.levelIdx, this.vehicleId); },
    cycleSuspension() {
      if (this.mode !== 'play' || !this.run || !this.run.vehicle.amphibious || this.isFrozen()) return;
      const name = this.run.vehicle.cycleSuspension();
      this.save.susp = this.run.vehicle.suspIndex; this.persist();
      if (this.previews.suv) this.previews.suv.setSuspension(this.save.susp);
      this.updateSuspChip();
      this.toast('SUSPENSION: ' + name);
    },
    updateSuspChip() {
      const v = this.run && this.run.vehicle;
      if (v && v.amphibious) $('suspChip').textContent = 'SUSPENSION ' + v.suspName + ' [C]';
    },

    /* ================================================== tutorial */
    openTutorial(ret) {
      this.tutStep = 0; this.tutReturn = ret || 'none';
      this.backTo = this.screen;
      this.show('tutorial');
      this.renderTutorial();
    },
    renderTutorial() {
      const s = TUTORIAL[this.tutStep];
      $('tutBody').innerHTML = '<h3>' + s.h + '</h3>' + s.body;
      $('tutDots').innerHTML = TUTORIAL.map((_, i) => '<i class="' + (i === this.tutStep ? 'on' : '') + '"></i>').join('');
      $('tutNext').textContent = this.tutStep === TUTORIAL.length - 1 ? 'LET’S GO' : 'NEXT';
    },
    closeTutorial() {
      this.save.tutorialSeen = true; this.persist();
      this.last = performance.now();
      this.show(this.tutReturn === 'title' ? 'title' : 'none');
    },

    /* ================================================== UI build */
    buildGarage() {
      const host = $('garageCards');
      host.innerHTML = '';
      for (const id of Object.keys(FD.VEHICLE_SPECS)) {
        const sp = FD.VEHICLE_SPECS[id];
        const card = document.createElement('div');
        card.className = 'card'; card.dataset.id = id;
        const bars = [['SPEED', sp.stats.speed], ['ACCEL', sp.stats.accel], ['FLIP', sp.stats.flip], ['WATER', sp.stats.water]]
          .map((b) => '<span>' + b[0] + '</span><div class="bar"><i style="width:' + Math.round(b[1] * 100) + '%"></i></div>').join('');
        card.innerHTML = '<canvas width="480" height="270"></canvas><div class="body"><h3>' + sp.name + '</h3><p>' + sp.tagline + ' <small>' + sp.stats.mass + '</small></p>' +
          '<div class="bars">' + bars + '</div>' +
          (sp.suspModes.length > 1 ? '<div class="seg" data-susp>' + sp.suspModes.map((m, i) => '<button data-i="' + i + '">' + m.name + '</button>').join('') + '</div>' : '') +
          '<button class="btn" data-select>SELECT</button></div>';
        host.appendChild(card);
        card.querySelector('[data-select]').addEventListener('click', () => { this.selectVehicle(id); A.click(); });
        card.querySelectorAll('[data-susp] button').forEach((b) => b.addEventListener('click', () => {
          this.save.susp = +b.dataset.i; this.persist(); this.previews[id].setSuspension(this.save.susp); this.refreshGarage(); A.click();
        }));
        card.querySelector('canvas').addEventListener('click', () => this.selectVehicle(id));
      }
    },
    selectVehicle(id) { this.vehicleId = id; this.save.vehicle = id; this.persist(); this.refreshGarage(); this.updateSelectedLine(); this.refreshLevels(); },
    refreshGarage() {
      document.querySelectorAll('#garageCards .card').forEach((c) => {
        const sel = c.dataset.id === this.vehicleId;
        c.classList.toggle('selected', sel);
        c.querySelector('[data-select]').textContent = sel ? 'SELECTED ✓' : 'SELECT';
        c.querySelectorAll('[data-susp] button').forEach((b) => b.classList.toggle('on', +b.dataset.i === this.save.susp));
      });
    },
    buildLevels() {
      const host = $('levelCards');
      host.innerHTML = '';
      FD.LEVELS.forEach((lv, i) => {
        const card = document.createElement('div');
        card.className = 'card'; card.dataset.i = i;
        card.innerHTML = '<div class="thumb ' + lv.theme + '" data-n="' + (i + 1) + '"></div><div class="body"><h3>' + lv.name + '</h3><p>' + lv.blurb + '</p><div class="best-line" data-best></div><button class="btn primary" data-play>PLAY</button></div>';
        host.appendChild(card);
        card.querySelector('[data-play]').addEventListener('click', () => { A.init(); this.levelIdx = i; this.startRun(i, this.vehicleId); });
        card.querySelector('.thumb').addEventListener('click', () => { this.levelIdx = i; this.save.level = i; this.persist(); this.refreshLevels(); });
      });
    },
    refreshLevels() {
      const sp = FD.VEHICLE_SPECS[this.vehicleId];
      $('levelVehicleLine').innerHTML = 'VEHICLE: <b>' + sp.name + '</b> &mdash; change it in the Garage';
      document.querySelectorAll('#levelCards .card').forEach((c, i) => {
        const lv = FD.LEVELS[i];
        c.classList.toggle('selected', i === this.levelIdx);
        const b = this.save.best[lv.id] && this.save.best[lv.id][this.vehicleId];
        c.querySelector('[data-best]').innerHTML = b ? 'BEST <b>' + fmt(b.score) + '</b>' + (b.time ? ' &middot; ' + b.time.toFixed(1) + 's' : '') + ' &middot; RINGS ' + b.rings + '/' + lv.rings.length : 'NO RUN YET &middot; ' + lv.rings.length + ' RINGS';
      });
    },
    updateSelectedLine() {
      const sp = FD.VEHICLE_SPECS[this.vehicleId], lv = FD.LEVELS[this.levelIdx];
      $('selectedLine').innerHTML = 'VEHICLE <b>' + sp.name + '</b> &nbsp;&middot;&nbsp; LEVEL <b>' + lv.name + '</b>';
    },

    bindUI() {
      const on = (id, fn) => $(id).addEventListener('click', () => { A.init(); A.click(); fn(); });
      on('btnPlay', () => this.$play());
      on('btnGarage', () => this.nav('garage'));
      on('btnLevels', () => this.nav('levels'));
      on('btnSettings', () => this.nav('settings'));
      on('btnHow', () => this.openTutorial('title'));
      document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { A.click(); this.goBack(); }));
      on('gPlay', () => this.$play());
      on('btnPause', () => this.pause());
      on('pResume', () => this.resume());
      on('pRestart', () => this.restartLevel());
      on('pGarage', () => this.quitToMenu('garage'));
      on('pLevels', () => this.quitToMenu('levels'));
      on('pSettings', () => { this.backTo = 'pause'; this.show('settings'); });
      on('pQuit', () => this.quitToMenu('title'));
      on('cRetry', () => this.retry());
      on('cRestart', () => this.restartLevel());
      on('cGarage', () => this.quitToMenu('garage'));
      on('cQuit', () => this.quitToMenu('title'));
      on('rNext', () => this.nextLevel());
      on('rRetry', () => this.restartLevel());
      on('rGarage', () => this.quitToMenu('garage'));
      on('rLevels', () => this.quitToMenu('levels'));
      on('rQuit', () => this.quitToMenu('title'));
      $('tutNext').addEventListener('click', () => {
        A.init(); A.click();
        if (this.tutStep < TUTORIAL.length - 1) { this.tutStep++; this.renderTutorial(); } else this.closeTutorial();
      });
      $('tutSkip').addEventListener('click', () => { A.click(); this.closeTutorial(); });
    },

    bindSettings() {
      const s = this.settings;
      const vol = (id, kind) => $(id).addEventListener('input', (e) => A.setVolume(kind, e.target.value / 100));
      vol('setMaster', 'master'); vol('setSfx', 'sfx'); vol('setMusic', 'music');
      $('setMute').addEventListener('change', (e) => A.setMuted(e.target.checked));
      $('setMusicOn').addEventListener('change', (e) => A.setMusic(e.target.checked));
      $('setCinematic').addEventListener('change', (e) => { s.cinematic = e.target.checked; this.persistSettings(); });
      $('setShake').addEventListener('input', (e) => { s.shake = e.target.value / 100; this.persistSettings(); });
      $('setQuality').addEventListener('change', (e) => { s.quality = e.target.value; this.autoLow = false; this.persistSettings(); this.applyQuality(); });
      $('setTouch').addEventListener('change', (e) => { s.touch = e.target.value; this.persistSettings(); });
      $('setState').addEventListener('change', (e) => { s.showState = e.target.checked; this.persistSettings(); });
      $('btnReset').addEventListener('click', () => {
        if (!root.confirm('Reset all best scores, records and settings?')) return;
        try { Object.keys(root.localStorage).filter((k) => k.indexOf('flipdrive.') === 0).forEach((k) => root.localStorage.removeItem(k)); } catch (e) { /* ignore */ }
        Store.mem = {};
        this.save = JSON.parse(JSON.stringify(DEFAULT_SAVE));
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
        this.bindSettingsRefresh();
        this.persist(); this.persistSettings();
        this.toast('SAVED DATA RESET');
      });
    },
    bindSettingsRefresh() { this.syncSettings(); this.applyQuality(); this.refreshGarage(); this.refreshLevels(); },
    syncSettings() {
      const s = this.settings;
      $('setMaster').value = Math.round(A.vol.master * 100);
      $('setSfx').value = Math.round(A.vol.sfx * 100);
      $('setMusic').value = Math.round(A.vol.music * 100);
      $('setMute').checked = A.muted;
      $('setMusicOn').checked = A.musicOn;
      $('setCinematic').checked = s.cinematic;
      $('setShake').value = Math.round(s.shake * 100);
      $('setQuality').value = s.quality;
      $('setTouch').value = s.touch;
      $('setState').checked = s.showState;
    },

    buildProgress() {
      const p = $('progress');
      p.querySelectorAll('.cp').forEach((n) => n.remove());
      const lv = this.run.level, span = lv.finishX - lv.start.x;
      this.cpEls = lv.checkpoints.map((cp) => {
        const d = document.createElement('span'); d.className = 'cp';
        d.style.left = M.clamp((cp.x - lv.start.x) / span, 0, 1) * 100 + '%';
        p.appendChild(d); return d;
      });
    },

    /* =================================================== main loop */
    control() {
      if (this.debugBot && this.mode === 'play') return this.debugBot(this.run);
      if (this.mode === 'attract') return this.bot(this.run);
      return Input.sample();
    },

    targetTimeScale() {
      const r = this.run, v = r.vehicle;
      if (!this.settings.cinematic) return 1;
      let t = 1;
      if (r.state === 'air' && r.airDur > 0.9 && (this.cam.alt || 0) > 45 && Math.abs(v.vy) / U.PPF < 14) t = 0.45;
      if (performance.now() < this.slowUntil) t = Math.min(t, this.slowScale);
      return t;
    },

    frame(now) {
      root.requestAnimationFrame((t) => this.frame(t));
      let dtReal = (now - this.last) / 1000; this.last = now;
      if (!(dtReal > 0)) dtReal = 1 / 60;
      dtReal = Math.min(dtReal, 0.1);
      const r = this.run, W = this.renderer.W, H = this.renderer.H;

      // adaptive quality (auto mode): drop to low if the device is struggling
      if (this.settings.quality === 'auto' && !this.autoLow && !document.hidden) {
        this.ftSum += dtReal; this.frameN++;
        if (this.frameN >= 120) { if (this.ftSum / this.frameN > 1 / 34) { this.autoLow = true; this.applyQuality(); } this.ftSum = 0; this.frameN = 0; }
      }

      const frozen = this.isFrozen();
      let dtSim = 0, steps = 0;
      if (!frozen) {
        const target = this.targetTimeScale();
        this.timeScale = M.damp(this.timeScale, target, target < this.timeScale ? 9 : 4, dtReal);
        if (Math.abs(this.timeScale - target) < 0.01) this.timeScale = target;
        dtSim = dtReal * this.timeScale;
        this.acc += dtSim;
        const ctl = this.control();
        while (this.acc >= STEP && steps < FD.PHYS.MAX_STEPS_PER_FRAME) {
          r.step(STEP, ctl);
          this.acc -= STEP; steps++;
        }
        if (steps >= FD.PHYS.MAX_STEPS_PER_FRAME) this.acc = 0;
        this.ctl = ctl;
      }
      const alpha = M.clamp(this.acc / STEP, 0, 1);
      const v = r.vehicle;
      const pose = v.pose(alpha);

      if (!frozen) {
        this.processEvents();
        this.emitContinuous(dtSim, ctlOrZero(this.ctl));
        this.fx.update(dtSim, r.world.waterY, r.world.terrain);
        this.flash = Math.max(0, this.flash - dtReal * 2.2);
        this.flowChecks(dtReal);
      }
      this.cam.update(frozen ? 0 : dtReal, {
        x: pose.x, y: pose.y, vx: v.vx, vy: v.vy, state: r.state, airDur: r.airDur, terrain: r.world.terrain,
        waterY: r.world.waterY, aspect: W / H, shakeScale: this.settings.shake, cinematic: this.settings.cinematic
      });

      // letterbox target
      let cinT = 0;
      if (this.settings.cinematic) {
        if (this.mode === 'attract') cinT = 0.65;
        else if (r.state === 'air' && r.airDur > 0.6 && (this.cam.alt || 0) > 40) cinT = 1;
      }
      this.cin = M.damp(this.cin, cinT, 3, dtReal);

      this.renderer.frame({
        run: r, cam: this.cam, fx: this.fx, alpha, dtReal: frozen ? 0 : dtReal, cin: this.cin, flash: this.flash,
        attract: this.mode === 'attract', speedFx: this.mode === 'attract' ? 0.6 : 1
      });

      if (this.mode === 'play') this.updateHud(dtReal);
      this.updateTouchVisibility();
      this.updateAudio(frozen);
      if (this.screen === 'garage') {
        const t = now / 1000;
        document.querySelectorAll('#garageCards .card').forEach((c) => this.renderer.drawPreview(c.querySelector('canvas'), this.previews[c.dataset.id], t));
      }
    },

    /* ----------------------------------------------- game flow checks */
    flowChecks(dtReal) {
      const r = this.run;
      if (this.mode === 'attract') {
        this.attractT += dtReal;
        if ((r.state === 'crashed' && r.crashT > 1.2) || (r.state === 'results' && r.stateTime > 2.5) || this.attractT > 70) this.startAttract();
        return;
      }
      if (r.state === 'crashed' && r.crashT > 1.15 && this.screen === 'none') this.showCrash();
      else if (this.screen === 'crash' && r.state !== 'crashed') this.show('none');
      if (r.state === 'results' && r.stateTime > 1.7 && !this.shownResults && this.screen === 'none') this.showResults();
    },

    commit(finished) {
      const r = this.run;
      if (!r || r._committed) return null;
      r._committed = true;
      const lv = r.level, vid = this.vehicleId;
      const bests = (this.save.best[lv.id] = this.save.best[lv.id] || {});
      const cur = bests[vid] || { score: 0, time: 0, dist: 0, flips: 0, rings: 0, finished: false };
      const score = r.scoreTotal();
      bests[vid] = {
        score: Math.max(cur.score, score),
        time: finished ? (cur.time ? Math.min(cur.time, r.time) : r.time) : cur.time,
        dist: Math.max(cur.dist || 0, r.maxX - r.startX),
        flips: Math.max(cur.flips || 0, r.best.maxFlips),
        rings: Math.max(cur.rings || 0, r.best.ringsGot),
        finished: !!(cur.finished || finished)
      };
      const rec = this.save.records;
      rec.longestAir = Math.max(rec.longestAir || 0, r.best.maxAirT);
      rec.mostFlips = Math.max(rec.mostFlips || 0, r.best.maxFlips);
      rec.topMph = Math.max(rec.topMph || 0, r.best.topMph);
      rec.rings = (rec.rings || 0) + r.best.ringsGot;
      if (finished) rec.runs = (rec.runs || 0) + 1;
      this.persist();
      return { isBest: score > r._bestAtStart && score > 0, score };
    },

    showCrash() {
      const r = this.run;
      this.commit(false);
      $('crashReason').textContent = r.reason || 'CRASH';
      $('crashScore').textContent = fmt(r.scoreTotal());
      $('crashRings').textContent = r.best.ringsGot + '/' + r.rings.length;
      $('cRetryNote').textContent = r.lastCp ? 'from checkpoint' : 'from start';
      this.show('crash');
    },

    showResults() {
      const r = this.run;
      this.shownResults = true;
      const res = this.commit(true) || { isBest: false, score: r.scoreTotal() };
      const total = r.scoreTotal(), sc = r.score;
      $('resKicker').textContent = FD.VEHICLE_SPECS[this.vehicleId].name;
      $('resTitle').textContent = r.level.name;
      $('resNew').classList.toggle('hidden', !res.isBest);
      const rows = [['Flips & stunts', sc.stunts], ['Airtime', sc.air], ['Landings', sc.landing], ['Rings', sc.rings], ['Crossings', sc.water], ['Distance', sc.distance], ['Time bonus', sc.time]];
      $('resTable').innerHTML = rows.map((x) => '<tr><td>' + x[0] + '</td><td>' + fmt(x[1]) + '</td></tr>').join('');
      const b = r.best;
      const grid = [['TIME', r.time.toFixed(1) + 's'], ['TOP SPEED', Math.round(b.topMph) + ' mph'], ['BEST AIR', b.maxAirT.toFixed(1) + 's'], ['FLIPS', b.flips], ['RINGS', b.ringsGot + '/' + r.rings.length], ['PERFECT', b.perfect]];
      $('resGrid').innerHTML = grid.map((x) => '<div>' + x[0] + '<b>' + x[1] + '</b></div>').join('');
      const last = this.levelIdx >= FD.LEVELS.length - 1;
      $('rNext').firstChild.nodeValue = last ? 'PLAY AGAIN ' : 'NEXT LEVEL ';
      this.show('results');
      // count-up
      const el = $('resScore'); const t0 = performance.now();
      const tick = () => {
        const k = M.clamp((performance.now() - t0) / 1200, 0, 1);
        el.textContent = fmt(total * (1 - Math.pow(1 - k, 3)));
        if (k < 1 && this.screen === 'results') root.requestAnimationFrame(tick); else el.textContent = fmt(total);
      };
      tick();
    },

    /* --------------------------------------------- events -> fx/audio */
    processEvents() {
      const r = this.run, out = r.out, v = r.vehicle, PPF = U.PPF, play = this.mode === 'play';
      const cam = this.cam, fx = this.fx;
      for (let i = 0; i < out.length; i++) {
        const e = out[i];
        switch (e.type) {
          case 'tick': if (play) { this.countdownShow(String(e.n), false); A.tick(e.n); } break;
          case 'go': if (play) { this.countdownShow('GO!', true); A.go(); } break;
          case 'launch': {
            const s = M.clamp(e.speed / 110, 0.3, 1);
            cam.punch = 1; cam.addTrauma(0.3 * s + 0.1);
            A.launch(s); A.whoosh();
            if (e.ramp) this.slowUntil = 0;
            break;
          }
          case 'impact': {
            const s = M.clamp(e.speed / 70, 0.04, 1);
            if (e.kind === 'wheel') {
              if (e.speed > 8) { fx.dust(e.x, e.y, e.nx, e.ny, e.speed * 0.8, 6 + 14 * s, e.tag); A.impact(s * 0.5); cam.addTrauma(s * 0.35); }
            } else {
              fx.sparks(e.x, e.y, e.nx, e.ny, e.speed * 0.9, 8 + 26 * s);
              fx.dust(e.x, e.y, e.nx, e.ny, e.speed * 0.6, 6 + 10 * s, e.tag);
              if (e.speed > 18) fx.debris(e.x, e.y, v.vx, v.vy, 4 + 12 * s);
              A.impact(s); cam.addTrauma(0.25 + s * 0.6);
            }
            break;
          }
          case 'splash': {
            fx.splash(e.x, e.y, e.strength, e.vx);
            A.splash(e.strength); cam.addTrauma(e.strength * 0.45);
            break;
          }
          case 'touchdown': if (play && e.kind === 'ground') { /* handled by impacts */ } break;
          case 'landing': {
            A.landing(e.grade);
            if (e.grade === 'perfect') { this.flash = 0.7; fx.ringBurst(v.x, v.y + U.len(2)); }
            break;
          }
          case 'ring': {
            fx.ringBurst(e.x * PPF, e.y * PPF); A.ring(e.n); break;
          }
          case 'checkpoint': {
            if (play) { this.banner('CHECKPOINT — ' + e.label); A.checkpoint(); const k = r.checkpoints.findIndex((c) => c.label === e.label); if (this.cpEls && this.cpEls[k]) this.cpEls[k].classList.add('on'); }
            break;
          }
          case 'stunt': {
            if (!play) break;
            if (e.kind === 'flip' || e.pts > 0 || e.kind === 'sloppy') this.note(e.text, e.kind, e.pts, e.mult);
            if (e.kind === 'flip') cam.addTrauma(0.12);
            if (e.pts > 0 && e.kind !== 'ring') A.stunt();
            break;
          }
          case 'crash': {
            A.crash(); cam.addTrauma(1);
            fx.debris(e.x, e.y, v.vx, v.vy, 36);
            fx.sparks(e.x, e.y, 0, 1, 60, 30);
            this.slowUntil = performance.now() + 750; this.slowScale = 0.3;
            break;
          }
          case 'respawn': {
            this.cam.snap(); this.fx.clear(); this.renderer.trail.length = 0; this.acc = 0;
            if (play) { $('notes').innerHTML = ''; if (e.checkpoint) this.banner('RESPAWN'); }
            break;
          }
          case 'finish': {
            if (play) { A.finish(); fx.confetti(v.x + U.len(60), v.y); fx.confetti(v.x - U.len(10), v.y); this.banner('FINISH!'); cam.addTrauma(0.2); }
            break;
          }
          default: break;
        }
      }
      out.length = 0;
    },

    emitContinuous(dt, ctl) {
      if (dt <= 0) return;
      const r = this.run, v = r.vehicle, w = r.world, fx = this.fx, PPF = U.PPF;
      const spdFt = v.speed / PPF;
      const q = fx.quality;
      // dust + tyre smoke from the wheels
      for (const wh of v.wheels) {
        if (!wh.contact) continue;
        const surf = FD.SURFACES[wh.tag] || FD.SURFACES.road;
        if (spdFt > 22 && surf.dust > 0.05 && !wh.wet && Math.random() < dt * 34 * surf.dust * q) fx.dust(wh.hx, wh.hy, wh.nx, wh.ny, spdFt * 0.5, 1, wh.tag);
        if (wh.skid > 0.18 && Math.random() < dt * 60 * q) fx.smoke(wh.hx, wh.hy, v.vx, v.vy, 1);
        if (wh.skid > 0.5 && Math.random() < dt * 30 * q) fx.sparks(wh.hx, wh.hy, wh.nx, wh.ny, 14, 1);
      }
      // scraping hull / roof
      if (v.roofContact && spdFt > 8 && Math.random() < dt * 90 * q) { const p = v.toWorld(U.len(-1), U.len(v.spec.roofY + 0.9)); fx.sparks(p.x, p.y, 0, 1, spdFt * 0.4, 2); }
      if (v.bodyContact && spdFt > 8 && Math.random() < dt * 70 * q) { const p = v.toWorld(0, U.len(-1.8)); fx.sparks(p.x, p.y, 0, 1, spdFt * 0.3, 2); }
      // boost: cold energy trail from the rear
      if (v.boosting) {
        const p = v.toWorld(U.len(-9.0), U.len(0.1));
        fx.boost(p.x, p.y, -Math.cos(v.a), -Math.sin(v.a), spdFt);
      }
      // water: wake, bubbles
      if (w.waterY > -1e5 && v.wet > 0.12) {
        if (spdFt > 7 && Math.random() < dt * 70 * q) fx.wake(v.x - Math.cos(v.a) * U.len(2), w.waterY, v.vx / PPF, 1);
        if (v.depthCom > U.len(1.0) && Math.random() < dt * 14 * q) fx.bubble(v.x + (Math.random() - 0.5) * U.len(10), v.y + U.len(1));
      }
    },

    /* ------------------------------------------------------- HUD */
    setText(id, text) { if (this.hudCache[id] !== text) { this.hudCache[id] = text; $(id).textContent = text; } },
    updateHud(dtReal) {
      const r = this.run, v = r.vehicle;
      this.setText('speedVal', String(Math.round(U.toMph(v.speed))));
      this.scoreShown = M.damp(this.scoreShown, r.scoreTotal(), 8, dtReal);
      if (Math.abs(this.scoreShown - r.scoreTotal()) < 1) this.scoreShown = r.scoreTotal();
      this.setText('score', fmt(this.scoreShown));
      this.setText('dist', fmt(Math.max(0, r.maxX - r.startX)));
      this.setText('ringCount', r.best.ringsGot + '/' + r.rings.length);
      const best = r._best ? r._best.score : 0;
      this.setText('bestScore', fmt(Math.max(best, r.scoreTotal())));
      const bb = $('boostBar');
      const bw = Math.round(v.boost * 100) + '%';
      if (this.hudCache.boost !== bw) { this.hudCache.boost = bw; bb.firstElementChild.style.width = bw; bb.classList.toggle('low', v.boost < 0.2); }
      const st = r.state;
      const chip = $('stateChip');
      chip.style.display = this.settings.showState ? '' : 'none';
      this.setText('stateChip', st.toUpperCase());
      const cs = r.chain > 0 ? 'COMBO x' + r.mult().toFixed(1) : '';
      this.setText('chain', cs);
      const pw = (r.progress() * 100).toFixed(1) + '%';
      if (this.hudCache.prog !== pw) { this.hudCache.prog = pw; $('progress').firstElementChild.style.width = pw; }
      const rm = $('rotMeter');
      if (st === 'air' && r.airDur > 0.3) {
        rm.classList.remove('hidden');
        const rot = Math.abs(v.a - r.launchA) / (Math.PI * 2);
        this.setText('rotVal', rot.toFixed(1));
      } else rm.classList.add('hidden');
    },
    note(text, kind, pts, mult) {
      const host = $('notes');
      const d = document.createElement('div');
      d.className = 'note ' + (kind || 'info');
      d.innerHTML = text + (pts > 0 ? '<b>+' + fmt(pts) + (mult > 1 ? ' x' + mult.toFixed(1) : '') + '</b>' : '');
      d.addEventListener('animationend', () => d.remove());
      host.appendChild(d);
      while (host.children.length > 5) host.firstChild.remove();
    },
    banner(text) {
      const b = $('banner'); b.textContent = text;
      b.className = ''; void b.offsetWidth; b.className = 'show';
    },
    countdownShow(text, go) {
      const c = $('countdown'); c.textContent = text;
      c.className = ''; void c.offsetWidth; c.className = 'pop' + (go ? ' go' : '');
    },
    updateTouchVisibility() {
      const s = this.settings.touch;
      const want = this.mode === 'play' && this.screen === 'none' && (s === 'on' || (s === 'auto' && (this.coarse || this.sawTouch)));
      const el = $('touch');
      if (want === el.classList.contains('hidden')) el.classList.toggle('hidden', !want);
    },

    /* ------------------------------------------------------ audio */
    updateAudio(frozen) {
      if (!A.ok) return;
      const r = this.run, v = r.vehicle;
      A.slow = M.clamp((1 - this.timeScale) / 0.55, 0, 1);
      const active = this.mode === 'play' && !frozen && this.screen !== 'tutorial' && r.state !== 'results';
      if (!active) { A.silence(); return; }
      let skid = 0;
      for (const w of v.wheels) skid = Math.max(skid, w.skid);
      const ctl = this.ctl || { throttle: 0 };
      const gs = v.wheelsOnGround > 0;
      A.update({
        speedN: (v.speed / U.PPF) / v.spec.motor.vmax, throttle: ctl.throttle || 0, boosting: v.boosting,
        air: !gs, skid, wet: v.wet, active: r.state !== 'crashed', rumble: gs ? Math.min(1, v.speed / U.PPF / 110) * 0.5 : 0
      });
    }
  };

  function ctlOrZero(c) { return c || { throttle: 0, brake: 0, rot: 0, boost: false }; }

  FD.App = App;
  const boot = () => { try { App.init(); } catch (err) { console.error(err); const t = document.getElementById('toast'); if (t) { t.textContent = 'Startup error: ' + err.message; t.classList.add('show'); } } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
