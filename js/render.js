/* FlipDrive: EV Chaos - render.js
 * Canvas renderer. Reads the simulation (Run / World / Vehicle / Camera / Fx) and draws it;
 * nothing here ever feeds back into physics.
 *   - themed sky, sun, clouds, stars and parallax silhouettes (ridges, skylines, mesas)
 *   - terrain: structure vs earth fill, hazard-striped ramps, strata, windows, columns
 *   - animated water with refraction tint, foam and sun glints
 *   - two original vehicle designs (faceted pickup, luxury amphibious SUV) with visible suspension
 *   - cinematic extras: ghost trail ("motion blur"), speed streaks, vignette, letterbox bars
 * All world drawing happens in a y-up transform (feet * PPF = world units).
 */
(function (root) {
  'use strict';
  const FD = (root.FD = root.FD || {});
  const U = FD.Units, M = FD.M;
  const TAU = Math.PI * 2;
  const rgb = M.rgb;

  /* ------------------------------------------------------------------ themes */
  const THEMES = {
    sunset: {
      sky: [[0, [22, 20, 66]], [0.42, [118, 50, 120]], [0.74, [238, 108, 92]], [1, [255, 188, 112]]],
      horizon: 0.6, sun: [255, 226, 170], sunX: 0.7, sunH: 0.1, stars: false, clouds: [255, 170, 150],
      layers: [
        { kind: 'ridge', f: 0.03, h: 0.2, off: 0, col: [130, 66, 126] },
        { kind: 'ridge', f: 0.07, h: 0.16, off: 0.005, col: [92, 46, 108] },
        { kind: 'ridge', f: 0.13, h: 0.1, off: 0.015, col: [58, 32, 82] }
      ],
      seaFar: [255, 160, 120], seaNear: [28, 38, 100],
      water: [[64, 176, 206], [10, 44, 96]],
      structure: [[84, 88, 108], [30, 32, 48]], earth: [[96, 70, 84], [36, 26, 46]], sand: [232, 196, 134]
    },
    city: {
      sky: [[0, [8, 6, 30]], [0.5, [50, 18, 86]], [0.82, [190, 52, 128]], [1, [255, 130, 120]]],
      horizon: 0.78, sun: null, stars: true, clouds: null,
      layers: [
        { kind: 'city', f: 0.04, h: 0.5, off: 0, col: [74, 34, 110], win: 0.08, neonA: [255, 70, 190], neonB: [60, 230, 255] },
        { kind: 'city', f: 0.09, h: 0.46, off: 0.02, col: [42, 22, 76], win: 0.18, neonA: [255, 70, 190], neonB: [60, 230, 255] },
        { kind: 'city', f: 0.17, h: 0.42, off: 0.05, col: [22, 12, 48], win: 0.28, neonA: [255, 70, 190], neonB: [60, 230, 255] }
      ],
      structure: [[62, 56, 98], [20, 16, 38]], earth: [[62, 56, 98], [20, 16, 38]], sand: [200, 180, 150]
    },
    canyon: {
      sky: [[0, [74, 122, 196]], [0.5, [170, 168, 200]], [0.8, [250, 184, 128]], [1, [255, 214, 150]]],
      horizon: 0.7, sun: [255, 244, 210], sunX: 0.28, sunH: 0.3, stars: false, clouds: [255, 235, 215],
      layers: [
        { kind: 'mesa', f: 0.04, h: 0.34, off: 0, col: [214, 138, 104] },
        { kind: 'mesa', f: 0.09, h: 0.3, off: 0.03, col: [178, 98, 72] },
        { kind: 'mesa', f: 0.16, h: 0.24, off: 0.06, col: [128, 66, 52] }
      ],
      structure: [[150, 92, 66], [58, 30, 28]], earth: [[176, 98, 62], [64, 32, 28]], sand: [216, 160, 104]
    },
    flood: {
      sky: [[0, [24, 32, 44]], [0.5, [58, 76, 88]], [0.85, [128, 144, 146]], [1, [170, 182, 176]]],
      horizon: 0.64, sun: null, stars: false, clouds: [38, 48, 58], rain: true,
      layers: [
        { kind: 'ridge', f: 0.03, h: 0.22, off: 0, col: [92, 112, 116] },
        { kind: 'ridge', f: 0.07, h: 0.18, off: 0.01, col: [64, 84, 90] },
        { kind: 'ridge', f: 0.13, h: 0.12, off: 0.02, col: [40, 58, 64] }
      ],
      seaFar: [140, 160, 156], seaNear: [24, 44, 50],
      water: [[104, 138, 130], [18, 44, 48]],
      structure: [[84, 88, 80], [30, 34, 32]], earth: [[88, 92, 70], [30, 34, 28]], sand: [190, 176, 140]
    }
  };

  const STRUCT_TAGS = { road: 1, ramp: 1, deck: 1, roof: 1, steel: 1 };
  const SURF = {
    road: [46, 50, 62], ramp: [70, 74, 90], deck: [60, 64, 78], roof: [58, 56, 84], steel: [214, 128, 40],
    rock: [88, 76, 84], dirt: [196, 112, 72]
  };

  function hash2(a, b) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function makeLayers(theme, seed) {
    const rnd = M.mulberry32(seed);
    const TILE = 2400;
    return theme.layers.map((L) => {
      const out = Object.assign({}, L, { tile: TILE, items: [] });
      if (L.kind === 'ridge') {
        const n = 56, ph = [rnd() * 6, rnd() * 6, rnd() * 6];
        for (let k = 0; k <= n; k++) {
          const u = (k / n) * TAU;
          out.items.push(M.clamp(0.5 + 0.26 * Math.sin(u * 2 + ph[0]) + 0.16 * Math.sin(u * 5 + ph[1]) + 0.09 * Math.sin(u * 11 + ph[2]), 0.05, 1));
        }
      } else if (L.kind === 'city') {
        let x = 0;
        while (x < TILE) {
          let w = 46 + rnd() * 100;
          if (x + w > TILE - 30) w = TILE - x;
          out.items.push({ x, w, h: 0.22 + rnd() * 0.78, ant: rnd() < 0.3, neon: rnd() < 0.2 ? (rnd() < 0.5 ? 0 : 1) : -1, seed: rnd() * 1000 | 0 });
          x += w + (rnd() < 0.25 ? 14 : 0);
        }
      } else if (L.kind === 'mesa') {
        let x = 0;
        while (x < TILE) {
          let w = 140 + rnd() * 260;
          if (x + w > TILE - 60) w = TILE - x;
          out.items.push({ x, w, h: 0.35 + rnd() * 0.65, cap: 0.55 + rnd() * 0.25 });
          x += w + rnd() * 80;
        }
      }
      return out;
    });
  }

  /* --------------------------------------------------------------- Renderer */
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.W = canvas.width; this.H = canvas.height;
      this.t = 0;
      this.theme = THEMES.sunset;
      this.layers = [];
      this.cy0 = null;
      this.trail = []; this.trailT = 0;
      this.quality = 1;
      this.vig = null;
      this.stars = [];
      this.clouds = [];
      this.shadowOn = true;
      this.makeVignette();
    }

    resize(w, h) {
      this.canvas.width = w; this.canvas.height = h;
      this.W = w; this.H = h;
      this.makeVignette();
    }

    makeVignette() {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 144;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(128, 72, 40, 128, 72, 150);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = grad; g.fillRect(0, 0, 256, 144);
      this.vig = c;
    }

    setLevel(level) {
      this.theme = THEMES[level.theme] || THEMES.sunset;
      this.layers = makeLayers(this.theme, 7 + level.id.length * 31);
      this.cy0 = null;
      this.trail.length = 0;
      const rnd = M.mulberry32(99);
      this.stars = [];
      for (let i = 0; i < 110; i++) this.stars.push({ x: rnd(), y: rnd() * 0.62, s: 0.6 + rnd() * 1.4, p: rnd() * 6 });
      this.clouds = [];
      for (let i = 0; i < 9; i++) this.clouds.push({ x: rnd() * 2400, y: 0.08 + rnd() * 0.32, w: 160 + rnd() * 340, h: 8 + rnd() * 16 });
      this.rain = [];
      for (let i = 0; i < 90; i++) this.rain.push({ x: rnd(), y: rnd(), l: 0.02 + rnd() * 0.04, s: 0.8 + rnd() * 0.8 });
    }

    /* ----------------------------------------------------------- background */
    drawBackground(cam, z, horizonY, hasWater, sunHide) {
      const ctx = this.ctx, W = this.W, H = this.H, th = this.theme, t = this.t;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const hf = M.clamp(horizonY / H, 0.15, 1);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      for (const st of th.sky) sky.addColorStop(M.clamp(st[0] * hf, 0, 1), rgb(st[1]));
      sky.addColorStop(1, rgb(th.sky[th.sky.length - 1][1]));
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

      const camFt = cam.x / U.PPF;
      const pxFt = H / 90;
      if (th.stars) {
        for (const s of this.stars) {
          const a = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.3 + s.p));
          ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.8).toFixed(2) + ')';
          ctx.fillRect(s.x * W, s.y * horizonY, s.s * H / 700, s.s * H / 700);
        }
      }
      // sun
      let sx = 0, sy = 0;
      if (th.sun) {
        sx = W * th.sunX - camFt * 0.02 * pxFt * 0.1;
        sy = horizonY - H * th.sunH + (cam.y - (this.cy0 || cam.y)) * z * 0.03;
        const R = H * 0.085;
        const glow = ctx.createRadialGradient(sx, sy, R * 0.2, sx, sy, R * 7);
        glow.addColorStop(0, rgb(th.sun, 0.55)); glow.addColorStop(0.25, rgb(th.sun, 0.18)); glow.addColorStop(1, rgb(th.sun, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
        const core = ctx.createRadialGradient(sx, sy, R * 0.1, sx, sy, R);
        core.addColorStop(0, 'rgba(255,255,240,1)'); core.addColorStop(0.8, rgb(th.sun, 1)); core.addColorStop(1, rgb(th.sun, 0.9));
        ctx.fillStyle = core; ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
      }
      // clouds
      if (th.clouds) {
        const tile = 2400 * (H / 900);
        const scroll = camFt * 0.02 * pxFt + t * 3;
        ctx.fillStyle = rgb(th.clouds, th.rain ? 0.5 : 0.28);
        for (const c of this.clouds) {
          for (let k = -1; k < 3; k++) {
            const x = ((c.x * H / 900 - scroll) % tile + tile) % tile + (k - 1) * tile;
            if (x < -c.w * 2 || x > W + c.w * 2) continue;
            ctx.beginPath(); ctx.ellipse(x, c.y * horizonY, c.w * H / 900, c.h * H / 900, 0, 0, TAU); ctx.fill();
          }
        }
      }
      // sea band (below horizon)
      if (hasWater) {
        const sea = ctx.createLinearGradient(0, horizonY, 0, H);
        sea.addColorStop(0, rgb(th.seaFar)); sea.addColorStop(1, rgb(th.seaNear));
        ctx.fillStyle = sea; ctx.fillRect(0, horizonY - 1, W, H - horizonY + 1);
        if (th.sun) {
          ctx.globalCompositeOperation = 'lighter';
          const n = this.quality > 0 ? 34 : 14;
          for (let i = 0; i < n; i++) {
            const u = i / n, y = horizonY + u * u * (H - horizonY) * 0.9 + 2;
            const wob = Math.sin(t * 1.8 + i * 1.7) * (6 + u * 40);
            const w = (14 + u * 160) * (H / 900) * (0.6 + 0.4 * Math.sin(t * 2.3 + i));
            ctx.fillStyle = rgb(th.sun, 0.34 * (1 - u * 0.75));
            ctx.fillRect(sx + wob - w / 2, y, w, Math.max(1.5, H * 0.003 * (1 + u * 2)));
          }
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      // parallax silhouettes
      const s = H / 900;
      for (const L of this.layers) {
        const tileW = L.tile * s;
        const scroll = camFt * L.f * pxFt;
        const baseY = horizonY + L.off * H + (cam.y - (this.cy0 || cam.y)) * z * L.f * 0.5;
        const bottom = hasWater ? baseY + 5 : H + 4;
        const x0 = -((scroll % tileW) + tileW) % tileW;
        ctx.fillStyle = rgb(L.col);
        for (let ox = x0 - tileW; ox < W + tileW; ox += tileW) {
          if (ox > W || ox + tileW < 0) continue;
          if (L.kind === 'ridge') {
            const n = L.items.length - 1;
            ctx.beginPath(); ctx.moveTo(ox, bottom);
            for (let k = 0; k <= n; k++) ctx.lineTo(ox + (k / n) * tileW, baseY - L.items[k] * L.h * H);
            ctx.lineTo(ox + tileW, bottom); ctx.closePath(); ctx.fill();
          } else if (L.kind === 'city') {
            for (const b of L.items) {
              const bx = ox + b.x * s, bw = b.w * s, top = baseY - b.h * L.h * H;
              if (bx > W || bx + bw < 0) continue;
              ctx.fillStyle = rgb(L.col);
              ctx.fillRect(bx, top, bw + 1, bottom - top);
              if (b.ant) { ctx.fillRect(bx + bw * 0.5 - 1, top - H * 0.04, 2.5 * s, H * 0.04); }
              if (this.quality > 0 && L.win > 0) {
                const cw = 11 * s, rh = 16 * s;
                for (let yy = top + rh * 0.6, iy = 0; yy < Math.min(bottom, baseY + H * 0.1) && iy < 40; yy += rh, iy++) {
                  for (let xx = bx + cw * 0.5, ix = 0; xx < bx + bw - cw && ix < 12; xx += cw * 1.5, ix++) {
                    if (hash2(b.seed + ix, iy) < L.win) {
                      ctx.fillStyle = hash2(ix, b.seed + iy) < 0.7 ? 'rgba(255,214,140,0.8)' : 'rgba(150,230,255,0.8)';
                      ctx.fillRect(xx, yy, cw * 0.62, rh * 0.5);
                    }
                  }
                }
              }
              if (b.neon >= 0) {
                const nc = b.neon === 0 ? L.neonA : L.neonB;
                const ny = top + (bottom - top) * 0.12, nh = H * 0.016;
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = rgb(nc, 0.18); ctx.fillRect(bx + bw * 0.1 - 6, ny - 6, bw * 0.8 + 12, nh + 12);
                ctx.fillStyle = rgb(nc, 0.9); ctx.fillRect(bx + bw * 0.1, ny, bw * 0.8, nh);
                ctx.globalCompositeOperation = 'source-over';
              }
            }
          } else if (L.kind === 'mesa') {
            for (const b of L.items) {
              const bx = ox + b.x * s, bw = b.w * s, top = baseY - b.h * L.h * H;
              if (bx > W || bx + bw < 0) continue;
              const capY = top + (baseY - top) * (1 - b.cap) * 0.5;
              ctx.beginPath();
              ctx.moveTo(bx - bw * 0.12, bottom);
              ctx.lineTo(bx + bw * 0.04, baseY - (baseY - top) * 0.45);
              ctx.lineTo(bx + bw * 0.1, capY);
              ctx.lineTo(bx + bw * 0.14, top);
              ctx.lineTo(bx + bw * 0.86, top);
              ctx.lineTo(bx + bw * 0.9, capY);
              ctx.lineTo(bx + bw * 0.96, baseY - (baseY - top) * 0.45);
              ctx.lineTo(bx + bw * 1.12, bottom);
              ctx.closePath(); ctx.fill();
            }
          }
        }
      }
    }

    /* -------------------------------------------------------------- terrain */
    drawTerrain(ctx, terrain, xl, xr, yb) {
      const th = this.theme, PPF = U.PPF;
      const city = th === THEMES.city;
      for (const p of terrain.pieces) {
        if (p.x1 < xl || p.x0 > xr) continue;
        const isFloat = p.name.indexOf('float') === 0;
        const i0 = this.segIdx(p, Math.max(xl, p.x0));
        let i1 = this.segIdx(p, Math.min(xr, p.x1));
        i1 = Math.min(p.segs.length - 1, i1 + 1);
        if (isFloat) { this.drawFloat(ctx, p); continue; }
        // group runs of same body style
        let gi = i0;
        while (gi <= i1) {
          const st = this.styleOf(p.segs[gi], th);
          let gj = gi;
          while (gj + 1 <= i1 && this.styleOf(p.segs[gj + 1], th) === st) gj++;
          this.drawGroup(ctx, p, gi, gj, st, yb, th, city);
          gi = gj + 1;
        }
        // surface strip
        for (let i = i0; i <= i1; i++) this.drawSurface(ctx, p.segs[i], th);
      }
    }

    segIdx(p, x) {
      const pts = p.pts;
      let lo = 0, hi = pts.length - 2;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid].x <= x) lo = mid; else hi = mid - 1; }
      return lo;
    }

    styleOf(seg, th) {
      if (th === THEMES.canyon || th === THEMES.flood) return 'e'; // natural ground: everything is earth
      return STRUCT_TAGS[seg.tag] ? 's' : 'e';
    }

    drawGroup(ctx, p, a, b, style, yb, th, city) {
      const segs = p.segs;
      const xs = segs[a].x0, xe = segs[b].x1;
      const pair = style === 's' ? th.structure : th.earth;
      let topY = -1e9;
      for (let i = a; i <= b; i++) topY = Math.max(topY, segs[i].y0, segs[i].y1);
      const g = ctx.createLinearGradient(0, topY, 0, topY - 220 * PPFv());
      g.addColorStop(0, rgb(pair[0])); g.addColorStop(1, rgb(pair[1]));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(xs - 1, yb);
      ctx.lineTo(xs - 1, segs[a].y0);
      for (let i = a; i <= b; i++) ctx.lineTo(segs[i].x1, segs[i].y1);
      ctx.lineTo(xe + 1, yb);
      ctx.closePath(); ctx.fill();
      const PPF = U.PPF;
      if (this.quality > 0) {
        if (style === 'e') {
          // strata lines parallel to the surface
          ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 0.7 * PPF;
          for (const d of [9, 21, 38, 62]) {
            ctx.beginPath(); ctx.moveTo(segs[a].x0, segs[a].y0 - d * PPF);
            for (let i = a; i <= b; i++) ctx.lineTo(segs[i].x1, segs[i].y1 - d * PPF);
            ctx.stroke();
          }
        } else {
          // columns + cross beams
          ctx.fillStyle = 'rgba(255,255,255,0.07)';
          const sp = 56 * PPF, cw = 5 * PPF;
          for (let x = Math.ceil(xs / sp) * sp; x < xe; x += sp) {
            const y = this.surfY(p, x);
            ctx.fillRect(x - cw / 2, yb, cw, y - 4 * PPF - yb);
            ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + cw / 2, yb, cw * 0.35, y - 4 * PPF - yb); ctx.fillStyle = 'rgba(255,255,255,0.07)';
          }
          if (city && segs[a].tag === 'roof') this.drawWindows(ctx, p, a, b, xs, xe, topY, yb);
        }
      }
    }

    drawWindows(ctx, p, a, b, xs, xe, topY, yb) {
      const PPF = U.PPF, cw = 4.2 * PPF, rh = 6.5 * PPF;
      const rows = Math.min(48, Math.floor((topY - yb) / rh));
      for (let iy = 0; iy < rows; iy++) {
        const y = topY - 6 * PPF - iy * rh;
        for (let x = Math.ceil(xs / (cw * 1.7)) * cw * 1.7, ix = 0; x < xe - cw; x += cw * 1.7, ix++) {
          const k = Math.round(x / (cw * 1.7));
          if (hash2(k, iy + 77) < 0.3) {
            ctx.fillStyle = hash2(k + 9, iy) < 0.7 ? 'rgba(255,208,130,0.72)' : 'rgba(140,226,255,0.72)';
            ctx.fillRect(x, y, cw * 0.62, rh * 0.5);
          }
        }
      }
    }

    surfY(p, x) { const s = p.segs[this.segIdx(p, x)]; return s.y0 + (s.y1 - s.y0) * ((x - s.x0) / (s.x1 - s.x0)); }

    drawSurface(ctx, s, th) {
      const PPF = U.PPF;
      let col;
      if (s.tag === 'sand') col = th.sand;
      else col = SURF[s.tag] || SURF.road;
      const thick = (s.tag === 'ramp' ? 2.2 : 1.6) * PPF;
      const ox = -s.nx * thick, oy = -s.ny * thick;
      if (s.tag === 'ramp') {
        const stripe = Math.floor(s.x0 / (14 * PPF)) % 2 === 0;
        col = stripe ? [236, 190, 52] : [40, 42, 52];
      } else if (s.tag === 'steel') {
        const stripe = Math.floor(s.x0 / (6 * PPF)) % 2 === 0;
        col = stripe ? [236, 150, 40] : [40, 42, 52];
      }
      ctx.fillStyle = rgb(col);
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1);
      ctx.lineTo(s.x1 + ox, s.y1 + oy); ctx.lineTo(s.x0 + ox, s.y0 + oy);
      ctx.closePath(); ctx.fill();
      // rim light on the very top edge
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 0.28 * PPF;
      ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
    }

    drawFloat(ctx, p) {
      const PPF = U.PPF;
      const pts = p.pts;
      let minY = 1e9;
      for (const q of pts) minY = Math.min(minY, q.y);
      const bot = minY - 7 * PPF;
      const grad = ctx.createLinearGradient(0, pts[1].y, 0, bot);
      grad.addColorStop(0, '#586072'); grad.addColorStop(1, '#232838');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x - 6 * PPF, bot); ctx.lineTo(pts[0].x + 6 * PPF, bot);
      ctx.closePath(); ctx.fill();
      for (let i = 0; i < p.segs.length; i++) this.drawSurface(ctx, p.segs[i], this.theme);
      // bollard lights
      const bx0 = pts[1].x + 2 * PPF, bx1 = pts[pts.length - 2].x - 2 * PPF;
      const on = Math.sin(this.t * 4 + pts[0].x * 0.01) > 0;
      for (const bx of [bx0, bx1]) {
        ctx.fillStyle = on ? '#ffb347' : '#7a5a2a';
        ctx.fillRect(bx - 0.5 * PPF, pts[1].y + 0.2 * PPF, 1 * PPF, 2.4 * PPF);
      }
    }

    /* --------------------------------------------------------------- water */
    drawWater(ctx, waterY, xl, xr, yb, cam) {
      const PPF = U.PPF, th = this.theme, t = this.t;
      if (!th.water) return;
      const g = ctx.createLinearGradient(0, waterY, 0, waterY - 170 * PPF);
      g.addColorStop(0, rgb(th.water[0], 0.62)); g.addColorStop(0.35, rgb(th.water[0], 0.74)); g.addColorStop(1, rgb(th.water[1], 0.94));
      const step = 6 * PPF;
      const x0 = Math.floor(xl / step) * step;
      const surf = (x) => waterY + PPF * (Math.sin(x / PPF * 0.045 + t * 1.5) * 0.5 + Math.sin(x / PPF * 0.11 - t * 2.2) * 0.26 + Math.sin(x / PPF * 0.017 + t * 0.7) * 0.6);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x0, yb);
      for (let x = x0; x <= xr + step; x += step) ctx.lineTo(x, surf(x));
      ctx.lineTo(xr + step, yb); ctx.closePath(); ctx.fill();
      // surface highlights
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.5 * PPF;
      ctx.beginPath();
      for (let x = x0; x <= xr + step; x += step) { const y = surf(x); if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.35 * PPF;
      ctx.beginPath();
      for (let x = x0; x <= xr + step; x += step) { const y = surf(x) - 2.2 * PPF - Math.sin(x / PPF * 0.08 + t) * 0.5 * PPF; if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
      if (this.quality > 0 && th.sun) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgb(th.sun, 0.35);
        for (let x = x0; x < xr; x += 38 * PPF) {
          const k = Math.floor(x / (38 * PPF));
          const tw = Math.max(0, Math.sin(t * 3 + k * 2.1));
          if (tw > 0.2) ctx.fillRect(x + hash2(k, 5) * 20 * PPF, surf(x) - 0.6 * PPF - hash2(k, 7) * 8 * PPF, (6 + hash2(k, 3) * 8) * PPF * tw, 0.35 * PPF);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    /* ------------------------------------------------------ world objects */
    drawRings(ctx, run) {
      const PPF = U.PPF, t = this.t;
      for (const r of run.rings) {
        if (r.got) continue;
        const x = r.x * PPF, y = r.y * PPF, R = r.r * PPF;
        const pulse = 1 + Math.sin(t * 4 + r.x * 0.05) * 0.04;
        ctx.globalCompositeOperation = 'lighter';
        const gl = ctx.createRadialGradient(x, y, R * 0.6, x, y, R * 1.9);
        gl.addColorStop(0, 'rgba(255,200,70,0.0)'); gl.addColorStop(0.5, 'rgba(255,200,70,0.22)'); gl.addColorStop(1, 'rgba(255,200,70,0)');
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, R * 1.9, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 1.5 * PPF;
        ctx.beginPath(); ctx.arc(x, y, R * pulse, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#fff2b0'; ctx.lineWidth = 0.5 * PPF;
        ctx.beginPath(); ctx.arc(x, y, R * pulse - 0.5 * PPF, t * 2, t * 2 + 1.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, R * pulse - 0.5 * PPF, t * 2 + Math.PI, t * 2 + Math.PI + 1.5); ctx.stroke();
      }
    }

    drawMarkers(ctx, run, terrain, xl, xr) {
      const PPF = U.PPF, t = this.t;
      for (const cp of run.checkpoints) {
        const x = cp.x * PPF;
        if (x < xl || x > xr) continue;
        const y = (terrain.heightAt(x, cp.y * PPF + 80 * PPF) || cp.y * PPF);
        ctx.fillStyle = '#d7dde8'; ctx.fillRect(x - 0.4 * PPF, y, 0.8 * PPF, 22 * PPF);
        const col = cp.reached ? '#3bffb0' : '#8b93a6';
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x + 0.4 * PPF, y + 21 * PPF);
        for (let i = 0; i <= 8; i++) ctx.lineTo(x + 0.4 * PPF + i * 1.6 * PPF, y + 21 * PPF - i * 0.12 * PPF + Math.sin(t * 5 + i * 0.7) * 0.5 * PPF);
        for (let i = 8; i >= 0; i--) ctx.lineTo(x + 0.4 * PPF + i * 1.6 * PPF, y + 15 * PPF - i * 0.12 * PPF + Math.sin(t * 5 + i * 0.7) * 0.5 * PPF);
        ctx.closePath(); ctx.fill();
      }
      const fx = run.level.finishX * PPF;
      if (fx > xl - 40 * PPF && fx < xr + 40 * PPF) {
        const y = terrain.heightAt(fx, 400 * PPF) || 0;
        const H = 36 * PPF;
        ctx.fillStyle = '#e9eef6'; ctx.fillRect(fx - 7 * PPF, y, 1 * PPF, H); ctx.fillRect(fx + 6 * PPF, y, 1 * PPF, H);
        const cs = 1.6 * PPF;
        for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#101218' : '#f4f6fa';
          ctx.fillRect(fx - 7 * PPF + i * cs * 0.9, y + H - (j + 1) * cs, cs * 0.9, cs);
        }
        ctx.save(); ctx.translate(fx, y + H + 3 * PPF); ctx.scale(1, -1);
        ctx.fillStyle = '#ffd34a'; ctx.font = '700 ' + (3.4 * PPF) + 'px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('FINISH', 0, 0); ctx.restore();
      }
    }

    drawLandingMarker(ctx, cam, run) {
      const L = cam.landing;
      if (!L || run.state !== 'air' || run.airDur < 0.35) return;
      const PPF = U.PPF, t = this.t;
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      const col = L.ground ? '255,255,255' : '120,225,255';
      ctx.save();
      ctx.translate(L.x, L.y);
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.35 + pulse * 0.35).toFixed(2) + ')';
      ctx.lineWidth = 0.45 * PPF;
      ctx.beginPath(); ctx.ellipse(0, 0.2 * PPF, (8 + pulse * 2) * PPF, 1.4 * PPF, 0, 0, TAU); ctx.stroke();
      const b = 5 * PPF + Math.sin(t * 5) * 1.2 * PPF;
      ctx.fillStyle = 'rgba(' + col + ',0.55)';
      ctx.beginPath(); ctx.moveTo(0, 2 * PPF + 0.0); ctx.lineTo(-2.4 * PPF, 2 * PPF + 3 * PPF); ctx.lineTo(2.4 * PPF, 2 * PPF + 3 * PPF); ctx.closePath();
      ctx.translate(0, b - 2 * PPF); ctx.fill();
      ctx.restore();
    }

    drawShadow(ctx, terrain, pose) {
      const PPF = U.PPF;
      const hit = terrain.rayCast(pose.x, pose.y, 0, -1, 260 * PPF);
      if (!hit) return;
      const h = (pose.y - hit.y) / PPF;
      const a = M.clamp(0.5 - h / 70, 0.06, 0.5);
      ctx_shadow(ctx, hit, a, 9.5 * PPF * (1 + h / 90), PPF);
    }

    /* ------------------------------------------------------------- vehicles */
    drawGhost(ctx, v, pose, alpha) {
      const S = U.PPF;
      ctx.save(); ctx.translate(pose.x, pose.y); ctx.rotate(pose.a); ctx.scale(S, S);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = v.spec.id === 'suv' ? '#46e0c0' : '#7fd9ff';
      ctx.beginPath();
      const h = v.spec.hull;
      ctx.moveTo(h[0][0], h[0][1]);
      for (let i = 1; i < h.length; i++) ctx.lineTo(h[i][0], h[i][1]);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    /** Draws a vehicle at world pose. Local drawing happens in feet. */
    drawVehicle(ctx, v, pose, o) {
      o = o || {};
      const sp = v.spec, S = U.PPF, suv = sp.id === 'suv';
      ctx.save();
      ctx.translate(pose.x, pose.y); ctx.rotate(pose.a); ctx.scale(S, S);
      const hull = sp.hull;
      const path = () => { ctx.beginPath(); ctx.moveTo(hull[0][0], hull[0][1]); for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1]); ctx.closePath(); };

      /* wheels (behind the body so the arches look cut-out) */
      const wheelData = v.wheels.map((w) => ({ x: w.x / S, hub: (w.mountY - w.s) / S, mount: w.mountY / S, r: w.r / S, spin: w.spin }));

      /* body base */
      const top = suv ? ['#8fe6d0', '#1a9c84', '#0a4a42', '#06292a'] : ['#f1f5fa', '#b5bfcc', '#7a8594', '#3c424e'];
      const bg = ctx.createLinearGradient(0, 3.5, 0, -1.9);
      bg.addColorStop(0, top[0]); bg.addColorStop(0.35, top[1]); bg.addColorStop(0.75, top[2]); bg.addColorStop(1, top[3]);
      path(); ctx.fillStyle = bg; ctx.fill();

      ctx.save(); path(); ctx.clip();
      // metallic sheen
      const sh = ctx.createLinearGradient(-9, 3.4, 9, -1);
      sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.3, 'rgba(255,255,255,0.34)'); sh.addColorStop(0.38, 'rgba(255,255,255,0)');
      sh.addColorStop(0.62, 'rgba(255,255,255,0.0)'); sh.addColorStop(0.7, 'rgba(255,255,255,0.16)'); sh.addColorStop(0.78, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh; ctx.fillRect(-10, -3, 20, 8);
      // wheel arches
      ctx.fillStyle = '#07090d';
      for (const w of wheelData) { ctx.beginPath(); ctx.arc(w.x, w.mount - 0.35, w.r + 0.42, 0, TAU); ctx.fill(); }
      // underbody
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(-10, -2.1, 20, 0.75);
      if (!suv) this.pickupDetail(ctx, v, o); else this.suvDetail(ctx, v, o);
      ctx.restore();

      /* wheels + visible suspension */
      for (const w of wheelData) this.drawWheel(ctx, w, suv);

      /* outline */
      path(); ctx.lineJoin = 'round'; ctx.lineWidth = 0.14; ctx.strokeStyle = 'rgba(8,10,16,0.9)'; ctx.stroke();

      /* lights (additive) */
      this.lights(ctx, v, suv, o);
      ctx.restore();
    }

    drawWheel(ctx, w, suv) {
      // coil-over strut (drawn behind the tyre top so it peeks out as the suspension moves)
      const r = w.r;
      ctx.save(); ctx.translate(w.x, w.hub);
      // tyre
      ctx.fillStyle = '#101216'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#23262e'; ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, TAU); ctx.fill();
      ctx.rotate(-w.spin);
      // tread marks
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 0.1;
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86); ctx.lineTo(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98); ctx.stroke(); }
      // rim
      const rim = ctx.createRadialGradient(-r * 0.15, r * 0.15, r * 0.05, 0, 0, r * 0.62);
      rim.addColorStop(0, '#f2f6fb'); rim.addColorStop(1, suv ? '#8c98a6' : '#7d8794');
      ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2a2e36'; ctx.lineWidth = suv ? 0.2 : 0.26;
      const n = suv ? 6 : 5;
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.16, Math.sin(a) * r * 0.16); ctx.lineTo(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58); ctx.stroke(); }
      ctx.fillStyle = suv ? '#e8c26a' : '#e8eef6'; ctx.beginPath(); ctx.arc(0, 0, r * 0.15, 0, TAU); ctx.fill();
      ctx.restore();
      // chrome shock + spring, anchored on the chassis, riding the hub
      const ax = w.x + 0.62, ay = w.mount + 0.5, bx = w.x + 0.15, by = w.hub + 0.1;
      ctx.strokeStyle = '#cfd6e2'; ctx.lineWidth = 0.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (bx - ax) * 0.45, ay + (by - ay) * 0.45); ctx.stroke();
      ctx.strokeStyle = suv ? '#e8c26a' : '#ff8a3d'; ctx.lineWidth = 0.17;
      ctx.beginPath(); ctx.moveTo(ax + (bx - ax) * 0.3, ay + (by - ay) * 0.3);
      const coils = 7, len = Math.hypot(bx - ax, by - ay) * 0.7;
      const dx = (bx - ax) / Math.hypot(bx - ax, by - ay), dy = (by - ay) / Math.hypot(bx - ax, by - ay);
      const px = -dy, py = dx;
      for (let i = 1; i <= coils; i++) {
        const u = (i / coils) * len + Math.hypot(bx - ax, by - ay) * 0.3;
        ctx.lineTo(ax + dx * u + px * (i % 2 ? 0.28 : -0.28), ay + dy * u + py * (i % 2 ? 0.28 : -0.28));
      }
      ctx.lineTo(bx, by); ctx.stroke();
      ctx.lineCap = 'butt';
    }

    pickupDetail(ctx, v, o) {
      // faceted planes
      ctx.fillStyle = 'rgba(20,26,38,0.20)';
      ctx.beginPath(); ctx.moveTo(-3.8, 3.35); ctx.lineTo(-9.25, 0.95); ctx.lineTo(-9.0, -0.4); ctx.lineTo(-3.4, -0.4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.beginPath(); ctx.moveTo(9.55, -0.9); ctx.lineTo(5.6, 0.55); ctx.lineTo(0.9, 3.35); ctx.lineTo(0.2, 3.35); ctx.lineTo(5.2, 0.2); ctx.lineTo(9.4, -1.15); ctx.closePath(); ctx.fill();
      // glass (cab)
      const gg = ctx.createLinearGradient(0, 3.2, 0, 0.9);
      gg.addColorStop(0, '#2b3a4e'); gg.addColorStop(1, '#0a0e16');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.moveTo(4.4, 0.98); ctx.lineTo(1.0, 3.0); ctx.lineTo(-3.2, 3.0); ctx.lineTo(-3.9, 0.98); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(160,210,255,0.22)';
      ctx.beginPath(); ctx.moveTo(3.2, 1.02); ctx.lineTo(1.5, 2.95); ctx.lineTo(0.2, 2.95); ctx.lineTo(1.9, 1.02); ctx.closePath(); ctx.fill();
      // door cut + belt line
      ctx.strokeStyle = 'rgba(10,14,22,0.55)'; ctx.lineWidth = 0.1;
      ctx.beginPath(); ctx.moveTo(-0.5, 0.96); ctx.lineTo(-0.5, -1.4); ctx.moveTo(-3.9, 0.96); ctx.lineTo(4.5, 0.96); ctx.stroke();
      // hard edge crease
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.1;
      ctx.beginPath(); ctx.moveTo(9.5, -0.9); ctx.lineTo(5.6, 0.55); ctx.lineTo(0.9, 3.35); ctx.lineTo(-3.8, 3.35); ctx.lineTo(-9.25, 0.95); ctx.stroke();
      // accent stripe
      ctx.strokeStyle = '#ff7a2f'; ctx.lineWidth = 0.22;
      ctx.beginPath(); ctx.moveTo(-8.8, -0.5); ctx.lineTo(9.2, -0.5); ctx.stroke();
      // charge port glyph
      ctx.fillStyle = '#ff7a2f'; ctx.fillRect(-1.4, -1.25, 1.6, 0.18);
    }

    suvDetail(ctx, v, o) {
      // greenhouse
      const gg = ctx.createLinearGradient(0, 3.3, 0, 1.3);
      gg.addColorStop(0, '#1c3a40'); gg.addColorStop(1, '#06161a');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.moveTo(4.85, 1.32); ctx.lineTo(3.55, 3.05); ctx.lineTo(0.35, 3.05); ctx.lineTo(0.35, 1.32); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-0.25, 1.32); ctx.lineTo(-0.25, 3.05); ctx.lineTo(-6.6, 3.12); ctx.lineTo(-7.7, 2.45); ctx.lineTo(-7.7, 1.32); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(190,240,255,0.18)';
      ctx.beginPath(); ctx.moveTo(3.0, 1.35); ctx.lineTo(2.0, 3.0); ctx.lineTo(1.0, 3.0); ctx.lineTo(2.0, 1.35); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-1.2, 1.35); ctx.lineTo(-1.2, 3.0); ctx.lineTo(-3.4, 3.05); ctx.lineTo(-2.4, 1.35); ctx.closePath(); ctx.fill();
      // roof rail + belt chrome
      ctx.strokeStyle = '#e8c26a'; ctx.lineWidth = 0.14;
      ctx.beginPath(); ctx.moveTo(-6.8, 3.62); ctx.lineTo(3.2, 3.52); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8.6, 1.22); ctx.lineTo(5.0, 1.22); ctx.stroke();
      // door shut lines
      ctx.strokeStyle = 'rgba(0,10,10,0.5)'; ctx.lineWidth = 0.1;
      ctx.beginPath(); ctx.moveTo(0.05, 1.2); ctx.lineTo(0.05, -1.5); ctx.moveTo(-5.0, 1.2); ctx.lineTo(-5.0, -1.5); ctx.stroke();
      // lower cladding
      ctx.fillStyle = 'rgba(8,16,16,0.5)'; ctx.fillRect(-9, -1.9, 18, 0.7);
      // amphibious thruster + waterline badge
      const swim = v.inWater;
      ctx.save(); ctx.translate(-8.2, -1.1);
      ctx.fillStyle = '#10181a'; ctx.beginPath(); ctx.arc(0, 0, 0.7, 0, TAU); ctx.fill();
      ctx.rotate(this.t * (swim ? 18 : 2));
      ctx.strokeStyle = '#7fe6d4'; ctx.lineWidth = 0.14;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0.62 * Math.cos(i * TAU / 3), 0.62 * Math.sin(i * TAU / 3)); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = '#e8c26a'; ctx.fillRect(2.6, -0.35, 2.2, 0.18);
    }

    lights(ctx, v, suv, o) {
      ctx.globalCompositeOperation = 'lighter';
      const boosting = v.boosting;
      if (!suv) {
        // front light bar + rear light bar
        ctx.strokeStyle = 'rgba(120,230,255,0.95)'; ctx.lineWidth = 0.18;
        ctx.beginPath(); ctx.moveTo(9.45, -0.55); ctx.lineTo(6.2, 0.38); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,230,255,0.25)'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(9.45, -0.55); ctx.lineTo(6.2, 0.38); ctx.stroke();
        ctx.strokeStyle = boosting ? 'rgba(255,90,60,1)' : 'rgba(255,50,50,0.8)'; ctx.lineWidth = 0.2;
        ctx.beginPath(); ctx.moveTo(-9.1, 0.78); ctx.lineTo(-9.0, -0.15); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,50,50,0.25)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(-9.1, 0.78); ctx.lineTo(-9.0, -0.15); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,236,190,0.95)'; ctx.fillRect(8.4, -0.15, 0.5, 0.55);
        ctx.fillStyle = 'rgba(255,236,190,0.25)'; ctx.beginPath(); ctx.arc(8.8, 0.1, 0.9, 0, TAU); ctx.fill();
        ctx.strokeStyle = boosting ? 'rgba(255,90,60,1)' : 'rgba(255,50,60,0.85)'; ctx.lineWidth = 0.22;
        ctx.beginPath(); ctx.moveTo(-8.85, 2.3); ctx.lineTo(-8.85, 0.2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,50,60,0.22)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-8.85, 2.3); ctx.lineTo(-8.85, 0.2); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    /* ----------------------------------------------------------- frame draw */
    /**
     * o: {run, cam, fx, alpha, cin (0..1 letterbox), speedFx (0..1), attract}
     */
    frame(o) {
      const { run, cam, fx, alpha } = o;
      const ctx = this.ctx, W = this.W, H = this.H;
      this.t += o.dtReal || 0.016;
      const v = run.vehicle, terrain = run.world.terrain, waterY = run.world.waterY;
      const hasWater = waterY > -1e5 && !!this.theme.water;
      const pose = v.pose(alpha);
      const aspect = W / H;
      const viewFt = Math.max(cam.viewFt, 100 / aspect);
      const z = H / (viewFt * U.PPF);
      const cx = cam.x, cy = cam.y;
      if (this.cy0 === null) this.cy0 = cy;
      const wsy = hasWater ? H / 2 + (cy - waterY) * z : 1e9;
      let horizonY = H * this.theme.horizon + (cy - this.cy0) * z * 0.04;
      if (hasWater) horizonY = Math.min(horizonY, wsy - 3);

      this.drawBackground(cam, z, horizonY, hasWater);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      const ks = H / 900;
      ctx.translate(W / 2 + cam.shakeX * ks + (o.attract ? W * 0.17 : 0), H / 2 + cam.shakeY * ks);
      ctx.rotate(cam.roll + cam.shakeR);
      ctx.scale(z, -z);
      ctx.translate(-cx, -cy);
      const hw = (W / 2) / z * 1.3 + 30 * U.PPF, hh = (H / 2) / z * 1.3 + 30 * U.PPF;
      const xl = cx - hw, xr = cx + hw, yb = cy - hh;

      this.drawTerrain(ctx, terrain, xl, xr, yb);
      this.drawMarkers(ctx, run, terrain, xl, xr);
      this.drawRings(ctx, run);
      if (fx) fx.draw(ctx, z, waterY, 'back');
      if (this.shadowOn) this.drawShadow(ctx, terrain, pose);

      // ghost trail ("motion blur")
      const spd = v.speed / U.PPF;
      this.trailT += o.dtReal || 0.016;
      if (this.trailT > 0.022) {
        this.trailT = 0;
        this.trail.push({ x: pose.x, y: pose.y, a: pose.a });
        if (this.trail.length > 5) this.trail.shift();
      }
      if (this.quality > 0 && !o.attractLite && (spd > 105 || v.boosting)) {
        const k = M.clamp((spd - 100) / 90, 0.2, 1);
        for (let i = 0; i < this.trail.length - 1; i++) this.drawGhost(ctx, v, this.trail[i], (i + 1) / this.trail.length * 0.12 * k);
      } else if (this.trail.length > 1 && spd < 80) this.trail.length = 0;

      this.drawVehicle(ctx, v, pose, o);
      if (hasWater) this.drawWater(ctx, waterY, xl, xr, yb, cam);
      if (fx) fx.draw(ctx, z, waterY, 'front');
      if (!o.attract) this.drawLandingMarker(ctx, cam, run);
      ctx.restore();

      /* ---- screen space ---- */
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // speed streaks
      const sf = M.clamp((spd - 70) / 110, 0, 1) * (o.speedFx === undefined ? 1 : o.speedFx);
      if (sf > 0.02 && this.quality > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.22 * sf).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, H * 0.0016);
        ctx.beginPath();
        const ang = Math.atan2(-v.vy, v.vx);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        for (let i = 0; i < 16; i++) {
          const r1 = hash2(i, 1), r2 = hash2(i, 2), r3 = hash2(i, 3);
          const len = (0.12 + r3 * 0.22) * W * sf;
          let px = ((r1 * 1.4 - this.t * (0.9 + r3 * 0.9) * (ca >= 0 ? 1 : -1)) % 1.4 + 1.4) % 1.4 * W - W * 0.2;
          const py = r2 * H;
          ctx.moveTo(px, py); ctx.lineTo(px - ca * len, py - sa * len);
        }
        ctx.stroke();
      }
      // rain
      if (this.theme.rain) {
        ctx.strokeStyle = 'rgba(200,220,230,0.28)'; ctx.lineWidth = Math.max(1, H * 0.0014);
        ctx.beginPath();
        for (const r of this.rain) {
          const y = ((r.y + this.t * r.s * 1.1) % 1) * H, x = ((r.x - (y / H) * 0.12) % 1 + 1) % 1 * W;
          ctx.moveTo(x, y); ctx.lineTo(x - H * r.l * 0.25, y + H * r.l);
        }
        ctx.stroke();
      }
      // vignette
      ctx.globalAlpha = 0.85; ctx.drawImage(this.vig, 0, 0, W, H); ctx.globalAlpha = 1;
      // letterbox bars
      if (o.cin > 0.01) {
        const bh = H * 0.06 * o.cin;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
      }
      // flash (white pulse on perfect landings / launch)
      if (o.flash > 0.01) { ctx.fillStyle = 'rgba(255,255,255,' + (o.flash * 0.35).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
    }

    /** Garage/title preview of a vehicle at rest. */
    drawPreview(canvas, vehicle, t) {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      const th = THEMES.sunset;
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#1c1646'); sky.addColorStop(0.6, '#8a3a7a'); sky.addColorStop(1, '#ff9a5c');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      const sunG = ctx.createRadialGradient(W * 0.75, H * 0.62, 4, W * 0.75, H * 0.62, H * 0.5);
      sunG.addColorStop(0, 'rgba(255,230,180,0.9)'); sunG.addColorStop(1, 'rgba(255,170,120,0)');
      ctx.fillStyle = sunG; ctx.fillRect(0, 0, W, H);
      // floor
      ctx.fillStyle = '#20182e'; ctx.fillRect(0, H * 0.78, W, H * 0.22);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, H * 0.78, W, 2);
      const S = U.PPF;
      const sc = W / (28 * S);
      const sp = vehicle.spec;
      const k = vehicle.mass * U.G_FT / 2 / vehicle.susp.k;
      for (const w of vehicle.wheels) { w.s = vehicle.susp.sMax - U.len(k) + Math.sin(t * 1.4) * 0.15 * S; w.spin = t * 1.2; }
      ctx.save();
      ctx.translate(W / 2, H * 0.78);
      ctx.scale(sc, -sc);
      const rest = vehicle.restHeight() - 0.0;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(0, 0, 10.5 * S, 1.2 * S, 0, 0, TAU); ctx.fill();
      this.drawVehicle(ctx, vehicle, { x: 0, y: rest + Math.sin(t * 1.4) * 0.05 * S, a: 0 }, {});
      ctx.restore();
    }
  }

  function PPFv() { return U.PPF; }

  function ctx_shadow(ctx, hit, a, rx, PPF) {
    ctx.save();
    ctx.translate(hit.x, hit.y + 0.15 * PPF);
    ctx.rotate(Math.atan2(-hit.nx, hit.ny));
    ctx.scale(1, 0.14);
    ctx.fillStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
    ctx.restore();
  }

  FD.Renderer = Renderer;
  FD.THEMES = THEMES;
})(typeof window !== 'undefined' ? window : globalThis);
