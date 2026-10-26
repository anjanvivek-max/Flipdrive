/* FlipDrive: EV Chaos - levels.js
 * Level definitions. All geometry is authored in feet (y up, sea level = waterY) and converted
 * to world units by Terrain. Ground pieces are solid heightfields (solid below the surface).
 *
 * Level fields
 *   ground      [{pts:[[x,y,tag],...]}]   solid pieces, x strictly increasing
 *   platforms   [{x,y,w,h,surf}]          floating slabs (y = top surface)
 *   checkpoints [{x,y,label}]             respawn points (x,y = ground contact, feet)
 *   rings       [{x,y,r}]                 collectibles (feet)
 *   crossings   [{x0,x1,label}]           water/gap crossings that award a bonus when completed
 *   finishX     finish line
 *   killY       falling below this (ft) wrecks the vehicle (levels without water)
 *   theme       drives the renderer palette and scenery
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});
  const D2R = Math.PI / 180;

  /** Smooth curve: slope angle goes th0 -> th1 (deg) with radius R (ft). Returns [x,y,tag] points. */
  function curve(x0, y0, th0, th1, R, tag, stepDeg) {
    stepDeg = stepDeg || 2;
    const pts = [];
    const n = Math.max(1, Math.ceil(Math.abs(th1 - th0) / stepDeg));
    let x = x0, y = y0;
    for (let i = 0; i < n; i++) {
      pts.push([x, y, tag]);
      const a0 = (th0 + (th1 - th0) * (i / n)) * D2R, a1 = (th0 + (th1 - th0) * ((i + 1) / n)) * D2R;
      const am = (a0 + a1) / 2, ds = Math.abs(a1 - a0) * R;
      x += Math.cos(am) * ds; y += Math.sin(am) * ds;
    }
    pts.push([x, y, tag]);
    return pts;
  }
  /** Straight run from (x0,y0) at slope th (deg) for len ft. */
  function line(x0, y0, th, len, tag) {
    return [[x0, y0, tag], [x0 + Math.cos(th * D2R) * len, y0 + Math.sin(th * D2R) * len, tag]];
  }
  function join(...parts) {
    const out = [];
    for (const p of parts) {
      for (const pt of p) {
        const last = out[out.length - 1];
        if (last && Math.abs(last[0] - pt[0]) < 1e-6 && Math.abs(last[1] - pt[1]) < 1e-6) { last[2] = pt[2] || last[2]; continue; }
        out.push(pt.slice());
      }
    }
    return out;
  }
  function endOf(pts) { const p = pts[pts.length - 1]; return { x: p[0], y: p[1] }; }
  /** Flat run from the end of the previous point list. */
  function flat(from, len, tag) { return [[from.x, from.y, tag], [from.x + len, from.y, tag]]; }

  FD.LevelTools = { curve, line, join, endOf, flat };
  FD.LEVELS = [];

  /* ------------------------------------------------------------------
   * LEVEL 1: SUNSET BAY MEGA RAMP
   * Start deck -> runway -> mega ramp -> ocean gap -> landing island -> kicker ->
   * second ocean gap with floating platforms -> far beach -> finish.
   * The island has a gentle beach on its front face so a short jump can be survived by the
   * amphibious SUV (it swims in and drives out) while the pickup sinks.
   * ------------------------------------------------------------------ */
  function buildLevel1() {
    const platY = 60, rampStart = 800, rampDeg = 36, rampR = 200, rampStraight = 40;
    const sea = -40;
    const runway = [[-320, platY, 'road'], [rampStart, platY, 'road']];
    const arc = curve(rampStart, platY, 0, rampDeg, rampR, 'ramp');
    const e1 = endOf(arc);
    const st = line(e1.x, e1.y, rampDeg, rampStraight, 'ramp');
    const launch = join(runway, arc, st);
    const lip = endOf(launch);
    const L = lip.x;

    // landing island: beach face rising out of the sea, crest, long descending bowl, deck, kicker
    const beachFoot = L + 150;
    const crest = { x: L + 380, y: 100 };
    // beach face rises at ~26 degrees, rounded over the crest (radius 120 ft) into the -34 degree landing bowl
    const faceDeg = Math.atan2(crest.y - sea, crest.x - beachFoot) / D2R;
    const crestArc = curve(0, 0, faceDeg, -34, 120, 'sand');
    const ce = endOf(crestArc);
    // shift so the arc is centred on the crest point (tangent lines meet there)
    const tanLen = 120 * Math.tan((faceDeg + 34) * D2R / 2);
    const arcStart = [crest.x - Math.cos(faceDeg * D2R) * tanLen, crest.y - Math.sin(faceDeg * D2R) * tanLen];
    const crestPts = curve(arcStart[0], arcStart[1], faceDeg, -34, 120, 'sand');
    const bowlTop = join([[beachFoot, sea, 'sand']], crestPts);
    const bt = endOf(bowlTop);
    const bowl = curve(bt.x, bt.y, -34, 0, 300, 'ramp');
    const bowlEnd = endOf(bowl);
    const deck1 = flat(bowlEnd, 520, 'road');
    const d1e = endOf(deck1);
    const kick = curve(d1e.x, d1e.y, 0, 10, 60, 'ramp');
    const island = join(bowlTop, bowl, deck1, kick);
    const islandEnd = endOf(island);

    // second gap: floating steel platforms bridge it
    const G = islandEnd.x;
    const floatX = [G + 16, G + 94, G + 172, G + 250], floatW = 70;
    const floats = floatX.map((fx, i) => ({
      pts: [[fx, 3, 'steel'], [fx + 5, 7, 'steel'], [fx + floatW - 5, 7, 'steel'], [fx + floatW, 3, 'steel']], name: 'float' + (i + 1), plat: true
    }));
    // far beach rises out of the sea at 30 degrees, then a long finish deck
    const farFoot = G + 270;
    const farTop = { x: farFoot + (7 - sea) / Math.tan(16 * D2R), y: 7 };
    const farBeach = [[farFoot, sea, 'sand'], [farTop.x, farTop.y, 'sand']];
    const farDeck = flat({ x: farTop.x, y: farTop.y }, 900, 'road');
    const farPts = join(farBeach, farDeck);
    const finishX = farTop.x + 520;

    // collectible rings: along the mega-jump arc (between the plain and boosted trajectories), over the
    // island, on the platforms and on the far shore
    const rings = [
      { x: 200, y: platY + 6 }, { x: 420, y: platY + 6 }, { x: 640, y: platY + 6 },
      { x: L + 120, y: lip.y + 78 }, { x: L + 230, y: lip.y + 92 }, { x: L + 335, y: lip.y + 80 },
      { x: L + 440, y: lip.y + 38 }, { x: L + 540, y: 30 },
      { x: bowlEnd.x + 160, y: bowlEnd.y + 6 }, { x: bowlEnd.x + 320, y: bowlEnd.y + 6 },
      { x: G + 51, y: 22 }, { x: G + 129, y: 22 }, { x: G + 207, y: 22 }, { x: G + 285, y: 22 },
      { x: farTop.x + 160, y: farTop.y + 6 }, { x: farTop.x + 320, y: farTop.y + 6 }
    ].map((r) => ({ x: r.x, y: r.y, r: 9 }));

    return {
      id: 'coastal', name: 'SUNSET BAY MEGA RAMP', blurb: 'One giant ramp. A wide ocean. A long way down.',
      theme: 'sunset', waterY: 0, killY: null,
      start: { x: 0, y: platY },
      ground: [
        { pts: launch, name: 'megaramp' },
        { pts: [[lip.x, sea, 'rock'], [beachFoot + 2, sea, 'rock']], name: 'seabed1' },
        { pts: island, name: 'island' },
        { pts: [[islandEnd.x, sea, 'rock'], [farFoot + 2, sea, 'rock']], name: 'seabed2' },
        { pts: farPts, name: 'farshore' },
        ...floats
      ],
      platforms: [],
      checkpoints: [
        { x: bowlEnd.x + 90, y: bowlEnd.y, label: 'LANDING ISLAND' },
        { x: farTop.x + 90, y: farTop.y, label: 'FAR SHORE' }
      ],
      crossings: [
        { x0: lip.x - 10, x1: bowlEnd.x - 40, label: 'MEGA JUMP' },
        { x0: islandEnd.x - 30, x1: farTop.x - 20, label: 'SECOND CROSSING' }
      ],
      finishX,
      rings,
      info: { lip, L, crest, island: bowlEnd, G, farTop, rampStart }
    };
  }

  /* ------------------------------------------------------------------
   * LEVEL 2: NEON ROOFTOPS
   * Three skyscraper roofs with big gaps. No water: miss the roof and you wreck.
   * ------------------------------------------------------------------ */
  function buildLevel2() {
    const yA = 220, rampStartA = 560;
    const arcA = curve(rampStartA, yA, 0, 24, 140, 'ramp');
    const eA = endOf(arcA);
    const stA = line(eA.x, eA.y, 24, 20, 'ramp');
    const roofA = join([[-320, yA, 'roof'], [rampStartA, yA, 'roof']], arcA, stA);
    const lipA = endOf(roofA);

    const gap1 = 300, yB = 150, lenB = 640;
    const bx0 = lipA.x + gap1;
    const arcB = curve(bx0 + lenB - 260, yB, 0, 18, 110, 'ramp');
    const eB = endOf(arcB);
    const stB = line(eB.x, eB.y, 18, 14, 'ramp');
    const roofB = join([[bx0, yB, 'roof'], [bx0 + lenB - 260, yB, 'roof']], arcB, stB);
    const lipB = endOf(roofB);

    const gap2 = 270, yC = 90, lenC = 1100;
    const cx0 = lipB.x + gap2;
    const roofC = [[cx0, yC, 'roof'], [cx0 + lenC, yC, 'roof']];

    const rings = [
      { x: lipA.x + 110, y: lipA.y + 52 }, { x: lipA.x + 215, y: lipA.y + 62 },
      { x: bx0 + 150, y: yB + 6 }, { x: bx0 + 300, y: yB + 6 },
      { x: lipB.x + 120, y: lipB.y + 56 }, { x: lipB.x + 250, y: lipB.y + 58 },
      { x: cx0 + 200, y: yC + 6 }, { x: cx0 + 400, y: yC + 6 }, { x: cx0 + 600, y: yC + 6 }
    ].map((r) => ({ x: r.x, y: r.y, r: 9 }));

    return {
      id: 'rooftops', name: 'NEON ROOFTOPS', blurb: 'Three towers, two gaps, zero water to catch you.',
      theme: 'city', waterY: null, killY: -60,
      start: { x: 0, y: yA },
      ground: [{ pts: roofA, name: 'roofA' }, { pts: roofB, name: 'roofB' }, { pts: roofC, name: 'roofC' }],
      platforms: [],
      checkpoints: [
        { x: bx0 + 300, y: yB, label: 'TOWER B' },
        { x: cx0 + 120, y: yC, label: 'TOWER C' }
      ],
      crossings: [
        { x0: lipA.x - 10, x1: bx0 + 30, label: 'FIRST GAP' },
        { x0: lipB.x - 10, x1: cx0 + 30, label: 'SECOND GAP' }
      ],
      finishX: cx0 + 800,
      rings,
      info: { lipA, lipB, bx0, cx0 }
    };
  }

  /* ------------------------------------------------------------------
   * LEVEL 3: RED CANYON RUN
   * Dirt runways, cliff edges and three canyons that get wider.
   * ------------------------------------------------------------------ */
  function buildLevel3() {
    const y0 = 80;
    const pieces = [];
    const rings = [];
    let x = -320;
    let cur = { x, y: y0 };
    const gaps = [{ gap: 230, drop: 30 }, { gap: 295, drop: 45 }, { gap: 345, drop: 60 }];
    const cps = [];
    const crossings = [];
    const deg = [16, 20, 24];
    for (let i = 0; i < gaps.length; i++) {
      const runLen = i === 0 ? 700 : 560;
      const run = flat(cur, runLen, 'dirt');
      const re = endOf(run);
      const arc = curve(re.x, re.y, 0, deg[i], 100, 'ramp');
      const ae = endOf(arc);
      const st = line(ae.x, ae.y, deg[i], 14, 'ramp');
      const piece = join(run, arc, st);
      const lip = endOf(piece);
      pieces.push({ pts: piece, name: 'mesa' + (i + 1) });
      const landX = lip.x + gaps[i].gap;
      const landY = cur.y - gaps[i].drop;
      rings.push({ x: lip.x + gaps[i].gap * 0.35, y: lip.y + 46 }, { x: lip.x + gaps[i].gap * 0.7, y: lip.y + 52 });
      crossings.push({ x0: lip.x - 10, x1: landX + 20, label: 'CANYON ' + (i + 1) });
      cur = { x: landX, y: landY };
      cps.push({ x: landX + 260, y: landY, label: 'MESA ' + (i + 2) });
    }
    const finalRun = flat(cur, 1300, 'dirt');
    pieces.push({ pts: finalRun, name: 'finalmesa' });
    const fe = endOf(finalRun);
    rings.push({ x: cur.x + 420, y: cur.y + 6 }, { x: cur.x + 640, y: cur.y + 6 }, { x: 300, y: y0 + 6 });
    return {
      id: 'canyon', name: 'RED CANYON RUN', blurb: 'Dirt, dust and three canyons that keep getting wider.',
      theme: 'canyon', waterY: null, killY: -140,
      start: { x: 0, y: y0 },
      ground: pieces, platforms: [],
      checkpoints: cps.slice(0, 2),
      crossings,
      finishX: fe.x - 500,
      rings: rings.map((r) => ({ x: r.x, y: r.y, r: 9 })),
      info: {}
    };
  }

  /* ------------------------------------------------------------------
   * LEVEL 4: FLOOD ESCAPE
   * The sea is rising. Climb the valley road, jump the washouts and stay above the water.
   * The pickup sinks once the flood reaches it; the amphibious SUV just floats on.
   * ------------------------------------------------------------------ */
  function buildLevel4() {
    const slope = 0.06; // overall rise
    const y0 = 20;
    const pts = [];
    const cps = [], crossings = [], rings = [];
    let x = -320, y = y0;
    const segs = [];
    // helper: ascending road for len ft following the overall slope
    const road = (len) => { const p = [[x, y, 'road'], [x + len, y + len * slope, 'road']]; x += len; y += len * slope; return p; };
    const parts = [];
    parts.push(road(760));
    const washouts = [{ gap: 170, depth: 90 }, { gap: 250, depth: 110 }, { gap: 330, depth: 130 }];
    const ground = [];
    let cur = join(...parts);
    for (let i = 0; i < washouts.length; i++) {
      const arc = curve(x, y, Math.atan(slope) / D2R, 20, 90, 'ramp');
      const ae = endOf(arc);
      const st = line(ae.x, ae.y, 20, 12, 'ramp');
      const piece = join(cur, arc, st);
      const lip = endOf(piece);
      ground.push({ pts: piece, name: 'ridge' + (i + 1) });
      const landX = lip.x + washouts[i].gap;
      const landY = lip.y - washouts[i].depth * 0.5;
      rings.push({ x: lip.x + washouts[i].gap * 0.4, y: lip.y + 40 }, { x: lip.x + washouts[i].gap * 0.75, y: lip.y + 36 });
      crossings.push({ x0: lip.x - 10, x1: landX + 20, label: 'WASHOUT ' + (i + 1) });
      // ravine floor
      ground.push({ pts: [[lip.x + 2, landY - washouts[i].depth, 'rock'], [landX - 2, landY - washouts[i].depth, 'rock']], name: 'ravine' + (i + 1) });
      x = landX; y = landY;
      cur = [[x, y, 'road'], [x + 620, y + 620 * slope, 'road']];
      x += 620; y += 620 * slope;
      if (i < 2) cps.push({ x: landX + 200, y: y - 420 * slope, label: 'HIGH GROUND ' + (i + 1) });
    }
    ground.push({ pts: join(cur, [[x + 1200, y + 1200 * slope, 'road']]), name: 'summit' });
    const finishX = x + 700;
    rings.push({ x: 300, y: y0 + 6 + 300 * slope }, { x: 560, y: y0 + 6 + 560 * slope });
    return {
      id: 'flood', name: 'FLOOD ESCAPE', blurb: 'The sea is rising. Climb, jump, and keep your wheels dry.',
      theme: 'flood', waterY: -60, waterRise: 2.6, waterDelay: 4, killY: null,
      start: { x: 0, y: y0 },
      ground, platforms: [],
      checkpoints: cps,
      crossings,
      finishX,
      rings: rings.map((r) => ({ x: r.x, y: r.y, r: 9 })),
      info: {}
    };
  }

  FD.buildLevels = function () {
    FD.LEVELS = [buildLevel1(), buildLevel2(), buildLevel3(), buildLevel4()];
    return FD.LEVELS;
  };
  FD.buildLevel1 = buildLevel1;
})(typeof window !== 'undefined' ? window : globalThis);
