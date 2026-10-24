// Specimens: procedurally grown plants printed onto the page like cyanotype
// photograms, as if laid on the paper and left pale where they blocked the
// sun. The plant geometry is ported from Nonflowers by Lingdong Huang
// (MIT License, https://github.com/LingDong-/nonflowers); the rendering is
// redone as silhouettes: overlaps print paler, petals let some light through,
// raised flower heads print softer than leaves pressed flat.
//
// Any element with [data-specimen] gets a plant fitted inside it, drawn in
// the element's text colour. data-seed fixes the plant; without it each
// visit grows a new one. Any element with [data-specimen-field] is scattered
// with several, placed in its empty space (see field() below).
(() => {
  const { PI, sin, cos, abs, pow, floor, min, max } = Math;

  /* ---------- Randomness ---------- */

  // mulberry32: small, seedable
  function prng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // p5.js-style Perlin noise, which Nonflowers' shapes were tuned against:
  // roughly 0..1, four octaves
  function perlin(rand) {
    const SIZE = 4095, YWRAP = 16, ZWRAP = 256;
    const table = Float32Array.from({ length: SIZE + 1 }, () => rand());
    const ease = (t) => 0.5 * (1 - cos(t * PI));
    return (x, y = 0, z = 0) => {
      x = abs(x); y = abs(y); z = abs(z);
      let xi = floor(x), yi = floor(y), zi = floor(z);
      let xf = x - xi, yf = y - yi, zf = z - zi;
      let r = 0, amp = 0.5;
      for (let o = 0; o < 4; o++) {
        let of = xi + (yi << 4) + (zi << 8);
        const rx = ease(xf), ry = ease(yf);
        let n1 = table[of & SIZE];
        n1 += rx * (table[(of + 1) & SIZE] - n1);
        let n2 = table[(of + YWRAP) & SIZE];
        n2 += rx * (table[(of + YWRAP + 1) & SIZE] - n2);
        n1 += ry * (n2 - n1);
        of += ZWRAP;
        n2 = table[of & SIZE];
        n2 += rx * (table[(of + 1) & SIZE] - n2);
        let n3 = table[(of + YWRAP) & SIZE];
        n3 += rx * (table[(of + YWRAP + 1) & SIZE] - n3);
        n2 += ry * (n3 - n2);
        n1 += ease(zf) * (n2 - n1);
        r += n1 * amp;
        amp *= 0.5;
        xi <<= 1; xf *= 2; yi <<= 1; yf *= 2; zi <<= 1; zf *= 2;
        if (xf >= 1) { xi++; xf--; }
        if (yf >= 1) { yi++; yf--; }
        if (zf >= 1) { zi++; zf--; }
      }
      return r;
    };
  }

  const mapval = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));

  /* ---------- 3D helpers (orthographic: the print keeps x and y) ---------- */

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // Rotate about z, then x, then y (world axes), as Nonflowers does
  function euler(v, r) {
    let [x, y, z] = v;
    if (r[2]) { const c = cos(r[2]), s = sin(r[2]); [x, y] = [x * c - y * s, x * s + y * c]; }
    if (r[0]) { const c = cos(r[0]), s = sin(r[0]); [y, z] = [y * c - z * s, y * s + z * c]; }
    if (r[1]) { const c = cos(r[1]), s = sin(r[1]); [x, z] = [x * c + z * s, -x * s + z * c]; }
    return [x, y, z];
  }

  // Euler angles that point +z along the polyline at index i
  function heading(P, i) {
    if (i < 0) i += P.length;
    const d = sub(P[i], P[i - 1]);
    const m = Math.hypot(...d) || 1;
    return [Math.asin(-d[1] / m), Math.atan2(d[0], d[2]), 0];
  }

  /* ---------- Plant parts ---------- */

  // One generator per plant: geometry goes into two layers, foliage (pressed
  // flat, sharp) and flowers (raised, softer and translucent).
  function grower(rand) {
    const noise = perlin(rand);
    const between = (a, b) => mapval(rand(), 0, 1, a, b);
    const pick = (arr) => arr[floor(arr.length * rand())];
    const layers = { foliage: [], flowers: [] };

    // Walk a bending path of seg steps
    function walk(at, rot, len, seg, ben, each) {
      let disp = [0, 0, 0], crot = [0, 0, 0];
      const P = [at];
      for (let i = 0; i < seg; i++) {
        const p = i / (seg - 1);
        crot = add(crot, scale(ben(p), 1 / seg));
        disp = add(disp, euler(euler([0, 0, len / seg], crot), rot));
        P.push(add(at, disp));
        if (each) each(p, crot, add(at, disp));
      }
      return P;
    }

    // Outline either side of a polyline, wid(t) from it
    function tubify(P, wid) {
      const L = [], R = [];
      for (let i = 1; i < P.length - 1; i++) {
        const w = wid(i / P.length);
        const a1 = Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0]);
        const a2 = Math.atan2(P[i][1] - P[i + 1][1], P[i][0] - P[i + 1][0]);
        let a = (a1 + a2) / 2;
        if (a < a2) a += PI;
        L.push([P[i][0] + w * cos(a), P[i][1] + w * sin(a)]);
        R.push([P[i][0] - w * cos(a), P[i][1] - w * sin(a)]);
      }
      const l = P.length - 1;
      const a0 = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]) - PI / 2;
      const a1 = Math.atan2(P[l][1] - P[l - 1][1], P[l][0] - P[l - 1][0]) - PI / 2;
      const w0 = wid(0), w1 = wid(1);
      L.unshift([P[0][0] + w0 * cos(a0), P[0][1] + w0 * sin(a0)]);
      R.unshift([P[0][0] - w0 * cos(a0), P[0][1] - w0 * sin(a0)]);
      L.push([P[l][0] + w1 * cos(a1), P[l][1] + w1 * sin(a1)]);
      R.push([P[l][0] - w1 * cos(a1), P[l][1] - w1 * sin(a1)]);
      return [L, R];
    }

    function stem({ at = [0, 0, 0], rot = [PI / 2, 0, 0], len = 400, seg = 40,
                    wid = () => 6, ben = () => [between(-10, 10), 0, between(-5, 5)],
                    layer = "foliage", alpha = 0.9 }) {
      const P = walk(at, rot, len, seg, ben);
      const [L, R] = tubify(P, wid);
      layers[layer].push({ fill: [L.concat(R.reverse())], alpha });
      return P;
    }

    function leaf({ at = [0, 0, 0], rot = [PI / 2, 0, 0], len = 500, seg = 40,
                    wid = (x) => sin(x * PI) * 20, vei = [1, 3], flo = false,
                    ben = () => [between(-10, 10), 0, between(-5, 5)],
                    layer = "foliage", alpha = 0.8 }) {
      const orient = (v) => euler(v, rot);
      const P = [at], L = [at], R = [at];
      walk([0, 0, 0], rot, len, seg, ben, (p, crot, d) => {
        const w = wid(p);
        const disp = add(at, d);
        P.push(disp);
        L.push(add(disp, orient(euler([-w, 0, 0], crot))));
        R.push(add(disp, orient(euler([w, 0, 0], crot))));
      });
      // Each strip as its own quad; together they print as one blade
      const quads = [];
      for (let i = 1; i < P.length; i++) {
        quads.push([L[i], L[i - 1], P[i - 1], P[i]], [R[i], R[i - 1], P[i - 1], P[i]]);
      }
      const lines = [];
      if (vei[0] === 1) {
        // Parallel veins, as in grasses and lilies
        for (let j = 1; j < vei[1]; j++) {
          const t = j / vei[1];
          lines.push(L.map((l, i) => lerp(l, P[i], t)), R.map((r, i) => lerp(r, P[i], t)));
        }
      } else if (vei[0] === 2) {
        // Pinnate: ribs from the midrib out to the edge
        for (let i = 1; i < P.length - vei[1]; i += vei[2]) {
          lines.push([P[i], L[i + vei[1]]], [P[i], R[i + vei[1]]]);
        }
      }
      if (vei[0]) lines.push(P);
      layers[layer].push({ quads, alpha, lines, flo });
      return P;
    }

    // Petals, fanned around a flower head
    function bloom(at, rot, P) {
      const op = rand();
      for (let k = 0; k < P.flowerPetal; k++) {
        const r = [rot[0], rot[1], rot[2] + (k / P.flowerPetal) * PI * 2];
        const ben = (x) => [P.flowerOpenCurve(x, op), 0, 0];
        leaf({ at, rot: r, layer: "flowers", alpha: 0.42, flo: true, vei: [1, 3],
               len: P.flowerLength * between(0.7, 1.3) * P.flowerScale,
               wid: (x) => P.flowerScale * P.flowerShape(x) * P.flowerWidth, ben });
        if (P.innerLength > 0) {
          leaf({ at, rot: r, layer: "flowers", alpha: 0.55, vei: [0],
                 len: P.innerLength * between(0.8, 1.2),
                 wid: (x) => sin(x * PI) * P.innerWidth, ben });
        }
      }
    }

    // Nonflowers' genParams, minus colour
    function params() {
      const randint = (a, b) => floor(between(a, b));
      const P = {};
      const flowerMask = (x) => pow(sin(PI * x), 0.2);
      const leafMask = (x) => pow(sin(PI * x), 0.5);

      P.flowerChance = pick([between(0, 0.08), between(0, 0.03)]);
      P.leafChance = pick([0, between(0, 0.1), between(0, 0.1)]);
      P.leafType = pick([[1, randint(2, 5)], [2, randint(3, 7), randint(3, 8)], [2, randint(3, 7), randint(3, 8)]]);

      const flowerSeed = rand() * PI;
      const jagged = between(0.5, 8);
      P.flowerShape = (x) => noise(x * jagged, flowerSeed) * flowerMask(x);

      const leafJagged = between(0.1, 40);
      const pointy = between(0.5, 1.5);
      P.leafShape = pick([
        (x) => noise(x * leafJagged, flowerSeed) * leafMask(x),
        (x) => pow(sin(PI * x), pointy),
      ]);

      const c2 = [rand() * PI, between(5, 15)];
      const c4 = [rand() * 0.5, between(0.8, 1.2)];
      P.flowerOpenCurve = pick([
        (x, op) => (x < 0.1 ? 2 + op * c2[1] : noise(x * 10, c2[0])),
        (x, op) => (x < c4[0] ? 0 : 10 - x * mapval(op, 0, 1, 16, 20) * c4[1]),
      ]);

      P.leafLength = between(30, 100);
      P.flowerLength = between(5, 55);
      P.pedicelLength = between(5, 30);
      P.leafWidth = between(5, 30);
      P.flowerWidth = between(5, 30);
      P.stemWidth = between(2, 11);
      P.stemBend = between(2, 16);
      P.stemLength = between(300, 400);
      P.stemCount = pick([2, 3, 4, 5]);
      P.sheathLength = pick([0, between(50, 100)]);
      P.sheathWidth = between(5, 15);
      P.shootCount = between(1, 7);
      P.shootLength = between(50, 180);
      P.leafPosition = pick([1, 2]);
      P.flowerPetal = Math.round(mapval(P.flowerWidth, 5, 50, 10, 3));
      P.innerLength = min(between(0, 20), P.flowerLength * 0.8);
      P.innerWidth = min(pick([0, between(1, 8)]), P.flowerWidth * 0.8) || 4;
      P.branchWidth = between(0.4, 1.3);
      P.branchTwist = Math.round(between(2, 5));
      P.branchDepth = pick([3, 4]);
      P.branchFork = pick([4, 5, 6, 7]);
      return P;
    }

    // Herbaceous: stems from one root, a shoot cluster of flowers on each
    function herbal(P) {
      P.flowerScale = 1.5;
      for (let i = 0; i < P.stemCount; i++) {
        const S = stem({
          len: P.stemLength * between(0.7, 1.3),
          rot: [PI / 2, 0, between(-1, 1) * PI],
          wid: (x) => P.stemWidth * (pow(sin(x * PI / 2 + PI / 2), 0.5) * noise(x * 10) * 0.5 + 0.5),
          ben: (x) => [mapval(noise(x, i), 0, 1, -1, 1) * x * P.stemBend, 0,
                       mapval(noise(x, i + PI), 0, 1, -1, 1) * x * P.stemBend],
        });
        if (P.leafPosition === 2) {
          for (const at of S) {
            if (rand() < P.leafChance * 2) {
              leaf({ at, len: 2 * P.leafLength * between(0.8, 1.2), vei: P.leafType,
                     rot: [between(-1, 1) * PI, between(-1, 1) * PI, 0],
                     wid: (x) => 2 * P.leafShape(x) * P.leafWidth,
                     ben: (x) => [mapval(noise(x, i), 0, 1, -1, 1) * 5, 0, mapval(noise(x, i + PI), 0, 1, -1, 1) * 5] });
            }
          }
        }
        const tip = S[S.length - 1];
        const hr = heading(S, -1);
        if (P.sheathLength) {
          stem({ at: tip, rot: hr, len: P.sheathLength, alpha: 0.6, ben: () => [0, 0, 0],
                 wid: (x) => P.sheathWidth * (pow(sin(x * PI), 2) - x * 0.5 + 0.5) });
        }
        for (let j = 0; j < max(1, P.shootCount * between(0.5, 1.5)); j++) {
          const shoot = stem({ at: tip, rot: hr, len: P.shootLength * between(0.5, 1.5), wid: () => 2,
            ben: (x) => [mapval(noise(x, j), 0, 1, -1, 1) * x * 10, 0, mapval(noise(x, j + PI), 0, 1, -1, 1) * x * 10] });
          bloom(shoot[shoot.length - 1], [between(-1, 1) * PI, between(-1, 1) * PI, between(-1, 1) * PI], P);
        }
      }
      if (P.leafPosition === 1) {
        // Basal rosette
        for (let i = 0; i < P.leafChance * 100; i++) {
          leaf({ rot: [PI / 3, 0, between(-1, 1) * PI], vei: P.leafType,
                 len: 4 * P.leafLength * between(0.8, 1.2),
                 wid: (x) => 2 * P.leafShape(x) * P.leafWidth,
                 ben: (x) => [mapval(noise(x, i), 0, 1, -1, 1) * 10, 0, mapval(noise(x, i + PI), 0, 1, -1, 1) * 10] });
        }
      }
    }

    // Woody: a forking twig with leaves and small flowers along it
    function woody(P) {
      P.flowerScale = 1;
      const branches = [];
      (function branch({ at = [0, 0, 0], rot = [PI / 2, 0, 0], len = 400, seg = 40, wid = 1, twi = 5, dep = 3, frk = 4 }) {
        const joints = Array.from({ length: Math.ceil(twi) }, () => [floor(rand() * seg), between(-1, 1)]);
        const nearest = (x) => {
          let m = seg, j = 0;
          joints.forEach(([s], i) => { const n = abs(x * seg - s); if (n < m) { m = n; j = i; } });
          return [m, joints[j][1]];
        };
        const S = stem({
          at, rot, len, seg, alpha: 0.92,
          wid: (x) => (nearest(x)[0] < 1 ? wid * (3 + 5 * (1 - x)) : wid * (2 + 7 * (1 - x) * mapval(noise(x * 10), 0, 1, 0.5, 1))),
          ben: (x) => { const [m, j] = nearest(x); return m < 1 ? [0, j * 20, 0] : [0, between(-5, 5), 0]; },
        });
        branches.push(S);
        if (dep > 0 && wid > 0.1) {
          for (let i = 0; i < frk * rand(); i++) {
            const k = floor(between(1, S.length));
            const r = heading(S, max(1, k));
            branch({ at: S[k], seg, frk, dep: dep - 1, twi: twi * 0.7,
                     rot: r.map((v) => v + (between(-1, 1) * PI) / 6),
                     len: len * between(0.4, 0.6), wid: wid * between(0.4, 0.7) });
          }
        }
      })({ wid: P.branchWidth, twi: P.branchTwist, dep: P.branchDepth, frk: P.branchFork });

      branches.forEach((S, i) => {
        if (i / branches.length <= 0.1) return;
        for (const at of S) {
          if (rand() < P.leafChance) {
            leaf({ at, len: P.leafLength * between(0.8, 1.2), vei: P.leafType,
                   rot: [between(-1, 1) * PI, between(-1, 1) * PI, 0],
                   wid: (x) => P.leafShape(x) * P.leafWidth,
                   ben: (x) => [mapval(noise(x, i), 0, 1, -1, 1) * 5, 0, mapval(noise(x, i + PI), 0, 1, -1, 1) * 5] });
          }
          if (rand() < P.flowerChance) {
            const ped = stem({ at, rot: [between(-1, 1) * PI, between(-1, 1) * PI, 0], len: P.pedicelLength,
                               wid: (x) => sin(x * PI) * x * 2 + 1, ben: () => [0, 0, 0] });
            bloom(ped[ped.length - 1], heading(ped, -1), P);
          }
        }
      });
    }

    function plant() {
      const P = params();
      // A plant with nothing to show reads as a stray scribble: make sure
      // there is something leafy or in flower.
      if (rand() < 0.7) {
        P.flowerChance = max(P.flowerChance, 0.02);
        herbal(P);
      } else {
        P.leafChance = max(P.leafChance, 0.04);
        P.flowerChance = max(P.flowerChance, 0.015);
        woody(P);
      }
      return layers;
    }

    return { plant, noise };
  }

  /* ---------- Printing ---------- */

  // Extent of the plant once turned by angle (radians)
  function bounds(layers, angle) {
    const c = cos(angle), s = sin(angle);
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const see = ([px, py]) => {
      const x = px * c - py * s, y = px * s + py * c;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    };
    for (const list of Object.values(layers)) {
      for (const s of list) {
        s.fill?.forEach((ring) => ring.forEach(see));
        s.quads?.forEach((q) => q.forEach(see));
      }
    }
    return b;
  }

  // Quads wound one way, so a nonzero fill unions them without gaps
  function quadPath(quads) {
    const path = new Path2D();
    for (const q of quads) {
      let area = 0;
      for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        area += a[0] * b[1] - b[0] * a[1];
      }
      const pts = area < 0 ? [...q].reverse() : q;
      path.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) path.lineTo(pts[i][0], pts[i][1]);
      path.closePath();
    }
    return path;
  }

  function ringPath(rings) {
    const path = new Path2D();
    for (const ring of rings) {
      path.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i++) path.lineTo(ring[i][0], ring[i][1]);
      path.closePath();
    }
    return path;
  }

  function layerCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  function paint(ctx, shapes, k, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    for (const s of shapes) {
      ctx.globalAlpha = s.alpha;
      ctx.fill(s.fill ? ringPath(s.fill) : quadPath(s.quads));
      if (s.lines?.length) {
        // Veins are denser than the blade, so they print a shade paler
        ctx.globalAlpha = s.flo ? 0.14 : 0.3;
        ctx.lineWidth = (s.flo ? 0.5 : 0.8) / k;
        for (const line of s.lines) {
          ctx.beginPath();
          line.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function print(el, canvas, layers, noise, seed) {
    const box = el.getBoundingClientRect();
    const dpr = min(window.devicePixelRatio || 1, 2);
    const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
    if (!W || !H) return;
    canvas.width = W;
    canvas.height = H;

    // Fit the plant inside the box, centred. Upright, it stands on the bottom
    // edge; data-angle (degrees) lays it across the sheet instead.
    const angle = (Number(el.dataset.angle) || 0) * PI / 180;
    const b = bounds(layers, angle);
    const pad = 0.04 * min(W, H);
    const k = min((W - 2 * pad) / (b.x1 - b.x0), (H - 2 * pad) / (b.y1 - b.y0), 2.4 * dpr);
    const ox = W / 2 - ((b.x0 + b.x1) / 2) * k;
    const oy = angle ? H / 2 - ((b.y0 + b.y1) / 2) * k : H - pad - b.y1 * k;
    const [kc, ks] = [k * cos(angle), k * sin(angle)];
    const color = getComputedStyle(el).color;

    const sheet = layerCanvas(W, H);
    const sctx = sheet.getContext("2d");
    for (const [name, blur] of [["foliage", 0.5], ["flowers", 1.6]]) {
      const layer = layerCanvas(W, H);
      const lctx = layer.getContext("2d");
      lctx.setTransform(kc, ks, -ks, kc, ox, oy);
      paint(lctx, layers[name], k, color);
      sctx.filter = `blur(${blur * dpr}px)`;
      sctx.drawImage(layer, 0, 0);
    }

    const ctx = canvas.getContext("2d");
    // A faint halo where light crept under the edges, then the print itself
    ctx.filter = `blur(${7 * dpr}px)`;
    ctx.globalAlpha = 0.22;
    ctx.drawImage(sheet, 0, 0);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.drawImage(sheet, 0, 0);

    // Uneven exposure: soft blotches, then fine paper tooth
    ctx.globalCompositeOperation = "destination-in";
    const step = 10 * dpr;
    const mw = Math.ceil(W / step) + 1, mh = Math.ceil(H / step) + 1;
    const mottle = layerCanvas(mw, mh);
    const mctx = mottle.getContext("2d");
    const img = mctx.createImageData(mw, mh);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const n = noise(x * 0.09 + seed % 97, y * 0.09, 3.7);
        img.data[(y * mw + x) * 4 + 3] = 255 * min(1, max(0.35, mapval(n, 0.3, 0.7, 0.45, 1)));
      }
    }
    mctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mottle, 0, 0, mw * step, mh * step);

    const tooth = layerCanvas(128, 128);
    const tctx = tooth.getContext("2d");
    const grain = tctx.createImageData(128, 128);
    const rand = prng(seed ^ 0x9e3779b9);
    for (let i = 3; i < grain.data.length; i += 4) grain.data[i] = 255 * (0.72 + 0.28 * rand());
    tctx.putImageData(grain, 0, 0);
    ctx.fillStyle = ctx.createPattern(tooth, "repeat");
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    el.classList.add("is-printed");
  }

  function specimen(el) {
    const seed = Number(el.dataset.seed) || floor(Math.random() * 2 ** 31);
    const { plant, noise } = grower(prng(seed));
    const layers = plant();
    const canvas = document.createElement("canvas");
    canvas.className = "specimen__print";
    el.dataset.seed = seed;
    el.appendChild(canvas);

    let frame = 0, size = "";
    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const next = `${Math.round(width)}x${Math.round(height)}`;
      if (next === size) return;
      size = next;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => print(el, canvas, layers, noise, seed));
    }).observe(el);
  }

  // Decoration only: a plant that fails to grow leaves the others be
  function grow(el) {
    try { specimen(el); } catch (err) { console.warn("specimen", el.dataset.seed, err); }
  }

  // Overlapping area of two boxes
  const overlap = (a, b) =>
    max(0, min(a.x1, b.x1) - max(a.x0, b.x0)) * max(0, min(a.y1, b.y1) - max(a.y0, b.y0));

  // A [data-specimen-field] is scattered with plants, up to one per
  // data-spacing px of its height (default 560), turned every which way.
  // It sits behind the elements that follow it. Each plant goes where the
  // field is emptiest: clear of whatever data-avoid matches (tiles, text)
  // and of the other plants, choosing a smaller print to fit a smaller gap.
  // Past data-min plants, one is only added where there's real room; when
  // there isn't, the minimum still go in, tucked under what's least in the
  // way. Placement is fixed per visit, so a relayout with nothing changed
  // puts every plant back where it was.
  function field(el) {
    const seed = Number(el.dataset.seed) || floor(Math.random() * 2 ** 31);
    const rand = prng(seed);
    const spacing = Number(el.dataset.spacing) || 560;
    const least = Number(el.dataset.min) || 1;
    const avoid = el.dataset.avoid;
    const plants = [];

    // Tight boxes round what's already on the page, relative to the field.
    // Other prints count as plants rather than as solid things.
    function occupied() {
      const at = el.getBoundingClientRect();
      const range = document.createRange();
      const solid = [], prints = [];
      for (const a of avoid ? el.parentElement.querySelectorAll(avoid) : []) {
        range.selectNodeContents(a);
        const r = range.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const box = { x0: r.left - at.left, y0: r.top - at.top, x1: r.right - at.left, y1: r.bottom - at.top };
        (a.matches(".specimen") ? prints : solid).push(box);
      }
      return { solid, prints };
    }

    function layout() {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      const F = { x0: 0, y0: 0, x1: W, y1: H };
      const { solid, prints } = occupied();
      const jitter = prng(seed ^ 0x5bd1e995);
      const full = min(max(W * 0.5, 300), 780);
      // Most of a plant sits in the middle of its box: judge that part
      const core = (cx, cy, bw, bh) => ({ x0: cx - bw * 0.38, x1: cx + bw * 0.38, y0: cy - bh * 0.38, y1: cy + bh * 0.38 });
      const roomy = 0.3 * overlap(core(0, 0, full, full * 1.25), core(0, 0, full, full * 1.25));
      const n = max(least, Math.round(H / spacing));
      let shown = 0;
      for (; shown < n; shown++) {
        let best = null;
        for (const s of [1, 0.8, 0.62, 0.48]) {
          const bw = full * s, bh = bw * 1.25;
          for (let cx = 0; cx <= W; cx += W / 16) {
            for (let cy = 0; cy <= H; cy += 60) {
              const c = core(cx, cy, bw, bh);
              let score = overlap(c, F);
              for (const b of solid) score -= 2.5 * overlap(c, b);
              for (const b of prints) score -= 2 * overlap(c, b);
              // A little chance, so each visit finds its own arrangement
              score += 0.15 * overlap(c, c) * jitter();
              if (!best || score > best.score) best = { score, cx, cy, bw, bh, c };
            }
          }
        }
        if (shown >= least && best.score < roomy) break;
        prints.push(best.c);

        if (!plants[shown]) {
          const p = document.createElement("div");
          p.className = "specimen";
          p.dataset.seed = floor(rand() * 2 ** 31);
          p.dataset.angle = Math.round(mapval(rand(), 0, 1, -90, 90));
          plants[shown] = p;
          el.appendChild(p);
          grow(p);
        }
        const { cx, cy, bw, bh } = best;
        Object.assign(plants[shown].style, { left: `${cx - bw / 2}px`, top: `${cy - bh / 2}px`, width: `${bw}px`, height: `${bh}px` });
        if (plants[shown].hidden) plants[shown].hidden = false;
      }
      for (const p of plants.slice(shown)) if (!p.hidden) p.hidden = true;
    }

    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };
    new ResizeObserver(later).observe(el);
    // Tiles shown or hidden by the filters move the gaps without always
    // changing the field's size; the field's own prints don't count
    new MutationObserver((records) => {
      if (records.some((r) => !el.contains(r.target))) later();
    }).observe(el.parentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
    document.fonts?.ready.then(later);
  }

  document.querySelectorAll("[data-specimen]").forEach(grow);
  document.querySelectorAll("[data-specimen-field]").forEach(field);
})();
