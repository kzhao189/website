(() => {
  const projects = window.PROJECTS;
  const tiers = window.TIERS;
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const $ = (id) => document.getElementById(id);

  const root = document.documentElement;
  const work = $("work");
  const masthead = $("masthead");
  const nameWrap = $("name-wrap");
  const nameSlot = $("name-slot");
  const bar = $("bar");
  const intro = $("intro");
  const introRow = $("intro-row");
  const siteNav = document.querySelector(".site-nav");
  const barFilters = $("bar-filters");
  const view = $("project");
  const viewMedia = $("project-media");
  const viewTitle = $("project-title");
  const viewIntro = $("project-intro");
  const viewInfo = $("project-info");
  const viewLink = $("project-link");
  const viewBody = $("project-body");
  const backLink = $("back");

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  // Touch screens have no hover to start a tile's video or GIF, so they autoplay there.
  const canHover = matchMedia("(hover: hover)");
  const duration = () => (reducedMotion.matches ? 0 : 460);
  // Quick to leave, long soft settle.
  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

  // Projects this viewer has opened get a dog-eared tile; kept in this browser only.
  const VISITED_KEY = "visited";
  const visited = new Set();
  try { JSON.parse(localStorage.getItem(VISITED_KEY) || "[]").forEach((s) => visited.add(s)); } catch {}
  function markVisited(slug) {
    visited.add(slug);
    try { localStorage.setItem(VISITED_KEY, JSON.stringify([...visited])); } catch {}
  }

  let current = null;         // slug of the open project
  let openedFromGrid = false; // true when we pushed the project entry ourselves
  let busy = false;

  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- Rendering ---------- */

  function pauseGifUntilHover(img, src) {
    if (!/\.gif(?:$|[?#])/i.test(src)) {
      img.src = src;
      return;
    }
    img.dataset.gifSrc = src;
    let hovered = false;
    // The GIF is decoded off-screen, so the visible <img> only ever shows the
    // still frame, or the GIF itself while hovered.
    const probe = new Image();
    probe.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = probe.naturalWidth;
        canvas.height = probe.naturalHeight;
        canvas.getContext("2d").drawImage(probe, 0, 0);
        img.dataset.gifStill = canvas.toDataURL("image/png");
        if (!hovered) img.src = img.dataset.gifStill;
      } catch {
        // No still frame possible (e.g. opened from file://): show the GIF.
        img.src = src;
      }
    };
    probe.src = src;
    img.addEventListener("pointerenter", () => {
      hovered = true;
      img.src = src;
    });
    img.addEventListener("pointerleave", () => {
      hovered = false;
      if (img.dataset.gifStill) img.src = img.dataset.gifStill;
    });
  }

  // hoverPlay: gallery tiles hold still until hovered; project pages autoplay.
  function fillMedia(el, p, hoverPlay = false) {
    let fill;
    if (!canHover.matches) hoverPlay = false;
    if (p.video) {
      fill = h("video", "media__fill");
      fill.src = p.video;
      if (p.image) fill.poster = p.image;
      fill.muted = fill.loop = fill.playsInline = true;
      fill.autoplay = !hoverPlay;
      fill.setAttribute("muted", "");
      fill.setAttribute("playsinline", "");
      if (hoverPlay) {
        // Load enough to show the first frame when there is no poster.
        fill.preload = "auto";
        // A chosen start frame replaces the poster: the tile rests on it, plays
        // on from it when hovered and returns to it after.
        const start = p.posterTime || 0;
        if (start) {
          fill.removeAttribute("poster");
          fill.addEventListener("loadedmetadata", () => { fill.currentTime = start; }, { once: true });
        }
        fill.addEventListener("pointerenter", () => fill.play().catch(() => {}));
        fill.addEventListener("pointerleave", () => {
          fill.pause();
          fill.currentTime = start;
        });
      }
    } else if (p.image) {
      fill = h("img", "media__fill");
      fill.alt = "";
      if (hoverPlay) pauseGifUntilHover(fill, p.image);
      else fill.src = p.image;
    } else {
      fill = h("div", "media__fill");
      fill.style.background =
        `linear-gradient(135deg, hsl(${p.hue} 55% 62%), hsl(${(p.hue + 40) % 360} 50% 42%))`;
    }
    el.replaceChildren(fill);
  }

  function tileLink(p, cls) {
    const a = h("a", `tile ${cls}`);
    a.href = `#/p/${p.slug}`;
    a.dataset.slug = p.slug;
    return a;
  }

  function tileMedia(p, extra = "") {
    const m = h("div", `media tile__media ${extra}`.trim());
    fillMedia(m, p, true);
    return m;
  }

  // A folded-down corner. Each project gets its own fold (width and height
  // vary, so the crease sits at a different angle), seeded by its slug so it
  // stays the same across visits. The shape does the work: the tile's top and
  // right edges draw in toward the fold, and the crease and flap edges bow.
  const SVG_NS = "http://www.w3.org/2000/svg";
  function dogEar(slug) {
    let seed = 0;
    for (const c of slug) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const w = Math.round(68 * (0.8 + rand() * 0.45));
    const hgt = Math.round(68 * (0.8 + rand() * 0.45));

    const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
    const f = (pt) => `${pt[0].toFixed(1)},${pt[1].toFixed(1)}`;

    // Origin at the tile's top-right corner, y down. The edges are pulled in by
    // `pull` where they meet the fold; the crease runs from A to B and the
    // corner folds over it to land at P.
    const pull = 0.5 + Math.min(w, hgt) * 0.01;
    const A = [-w, pull], B = [-pull, hgt];
    const d = [B[0] - A[0], B[1] - A[1]];
    const L = Math.hypot(d[0], d[1]);
    const along = [d[0] / L, d[1] / L];
    const toCorner = [along[1], -along[0]];
    const t = -A[0] * along[0] - A[1] * along[1];
    const foot = add(A, along, t);
    const P = [2 * foot[0], 2 * foot[1]];
    const depth = Math.hypot(foot[0], foot[1]);
    const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];

    // The crease rolls toward the corner a little; the flap edges bulge outward.
    const crease = add(M, toCorner, 0.5 + depth * 0.015);
    const bulge = (a, b) => {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      const g = [(A[0] + B[0] + P[0]) / 3, (A[1] + B[1] + P[1]) / 3];
      if ((mid[0] - g[0]) * n[0] + (mid[1] - g[1]) * n[1] < 0) n = [-n[0], -n[1]];
      return add(mid, n, len * 0.015);
    };
    const flap = `M${f(A)} Q${f(crease)} ${f(B)} Q${f(bulge(B, P))} ${f(P)} Q${f(bulge(P, A))} ${f(A)}Z`;

    const S = Math.ceil(Math.max(w, hgt) * 2.5);
    const id = `ear-${slug}`;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "dog-ear");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", S);
    svg.setAttribute("height", S);
    svg.setAttribute("viewBox", `${-S} 0 ${S} ${S}`);
    svg.innerHTML = `
      <defs>
        <filter id="${id}-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="-2" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity="0.3"/>
        </filter>
        <linearGradient id="${id}-paper" gradientUnits="userSpaceOnUse"
          x1="${M[0].toFixed(1)}" y1="${M[1].toFixed(1)}" x2="${P[0].toFixed(1)}" y2="${P[1].toFixed(1)}">
          <stop offset="0" class="dog-ear__crease"/>
          <stop offset="1" class="dog-ear__tip"/>
        </linearGradient>
      </defs>
      <path d="${flap}" fill="url(#${id}-paper)" filter="url(#${id}-shadow)"/>`;

    // Mask for a box around the corner (bw x bh, anchored top-right): the
    // page minus the folded-away corner, with the edges easing in toward the
    // fold. The crease is tucked a touch under the flap.
    const run = Math.round(Math.max(w, hgt) * 0.35); // how far along each edge the pull starts
    const bw = w + run, bh = hgt + run;
    const X = (pt) => `${(pt[0] + bw).toFixed(2)},${pt[1].toFixed(2)}`;
    const mc = add(crease, toCorner, -1.2);
    const corner =
      `<svg xmlns="${SVG_NS}" width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}">` +
      `<path d="M0,0 C${X([-w - run * 0.45, 0])} ${X([-w - run * 0.12, pull])} ${X(A)}` +
      ` Q${X(mc)} ${X(B)}` +
      ` C${X([-pull, hgt + run * 0.12])} ${X([0, hgt + run * 0.45])} ${bw},${bh}` +
      ` L0,${bh}Z"/></svg>`;
    return {
      svg, w: bw, h: bh, mask: `url("data:image/svg+xml,${encodeURIComponent(corner)}")`,
      // For the fold animation: the crease's start point and direction, and
      // the unfolded corner it turns over from.
      origin: `calc(100% - ${w}px) ${pull.toFixed(2)}px`,
      axis: along,
      corner: `polygon(calc(100% - ${w}px) ${pull.toFixed(2)}px, 100% 0, calc(100% - ${pull.toFixed(2)}px) ${hgt}px)`,
    };
  }

  function card(p) {
    const a = tileLink(p, "card");
    a.dataset.tier = p.tier;
    if (visited.has(p.slug)) a.classList.add("is-visited");
    const cap = h("div", "card__cap");
    cap.append(h("span", "card__title", p.tileTitle || p.title));
    const role = (p.info || []).find((i) => i.label === "Role");
    if (role && role.value) cap.append(h("span", "card__role", role.value));
    if (p.summary) cap.append(h("span", "card__desc", p.summary));
    const media = tileMedia(p);
    const ear = dogEar(p.slug);
    media.style.setProperty("--ear-w", `${ear.w}px`);
    media.style.setProperty("--ear-h", `${ear.h}px`);
    media.style.setProperty("--ear-corner", ear.mask);
    // The ear sits on the card rather than in the masked media, so the fold
    // animation's image face isn't cut away with the corner.
    a._ear = ear;
    a.append(media, cap, ear.svg);
    return a;
  }

  // The corner lifts off the image and turns over along the crease in 3D:
  // the image side shows first, then the paper back as it settles.
  function foldEar(tile) {
    const ear = tile._ear;
    if (!ear || reducedMotion.matches) return;
    const front = h("div", "dog-ear__front");
    front.append(tile.querySelector(".media__fill").cloneNode(true));
    front.style.clipPath = ear.corner;
    tile.appendChild(front);

    const turn = (deg) => ({
      transform: `perspective(600px) rotate3d(${ear.axis[0]}, ${ear.axis[1]}, 0, ${deg}deg)`,
    });
    const timing = { duration: 650, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "both" };
    for (const el of [front, ear.svg]) el.style.transformOrigin = ear.origin;
    // Same sheet throughout: the paper side is the image side turned 180°.
    const a = front.animate([turn(0), turn(-180)], timing);
    ear.svg.animate([turn(180), turn(0)], timing);
    a.finished.then(() => {
      front.remove();
      ear.svg.getAnimations().forEach((x) => x.cancel());
    });
  }

  // Every project in one even grid; the category filters in the intro choose
  // which show.
  function renderWork() {
    const visibleProjects = new Set(["crystal-commanders", "snaptrap", "spellfish", "stranger-things-vr", "scan-it-planet"]);
    const labels = new Map(tiers.map((t) => [t.id, t.label]));
    const used = tiers.filter((t) => projects.some((p) => p.tier === t.id));
    let active = null; // one category id, or null for All

    // The same filters in the intro and in the docked bar, kept in step
    const groups = [$("filters"), barFilters];
    const grid = h("div", "gallery");
    const empty = h("p", "gallery__empty", "No projects here yet.");

    function apply() {
      let shown = 0;
      for (const tile of grid.children) {
        tile.hidden = active !== null && Number(tile.dataset.tier) !== active;
        if (!tile.hidden) shown++;
      }
      empty.hidden = shown > 0;
      for (const group of groups) {
        for (const chip of group.children) chip.setAttribute("aria-pressed", String(chip.value === String(active)));
      }
    }

    for (const group of groups) {
      for (const t of [{ id: null, label: "All" }, ...used]) {
        const chip = h("button", "chip", t.label);
        chip.type = "button";
        chip.value = String(t.id);
        chip.addEventListener("click", () => {
          active = t.id;
          apply();
          // From the bar, bring the top of the filtered gallery into view
          if (group === barFilters) scrollToWork();
        });
        group.appendChild(chip);
      }
    }

    for (const p of projects.filter((p) => labels.has(p.tier) && visibleProjects.has(p.slug))) grid.appendChild(card(p));
    work.append(grid, empty);
    apply();
  }

  // Two-column tiles take their height from the viewport, so the landing view
  // shows one full row and the top quarter of the next.
  function sizeTiles() {
    const grid = work.querySelector(".gallery");
    const top = grid.getBoundingClientRect().top + scrollY;
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    grid.style.setProperty("--tile-h", `${Math.max(220, (innerHeight - top - gap) / 1.25)}px`);
  }

  // YouTube / Vimeo links become embeds; anything else plays as a file.
  function embedUrl(src) {
    let m = src.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    m = src.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    return null;
  }

  // Figma file / prototype links -> Figma's embed.figma.com player, which loads much
  // faster than the old figma.com/embed wrapper. Embed links pass through.
  function figmaEmbed(src) {
    if (!src) return null;
    if (/^https:\/\/(embed\.figma\.com\/|(www\.)?figma\.com\/embed\b)/.test(src)) return src;
    if (!/^https:\/\/(www\.)?figma\.com\/(proto|design|file|board|slides|deck)\//.test(src)) return null;
    const url = new URL(src);
    url.hostname = "embed.figma.com";
    url.pathname = url.pathname.replace(/^\/file\//, "/design/");
    url.searchParams.set("embed-host", "share");
    return url.href;
  }

  // Warm up the connections to Figma's servers once a page has an embed on it.
  let figmaWarmed = false;
  function warmFigma() {
    if (figmaWarmed) return;
    figmaWarmed = true;
    for (const href of ["https://embed.figma.com", "https://static.figma.com"]) {
      const link = h("link");
      link.rel = "preconnect";
      link.href = href;
      link.crossOrigin = "";
      document.head.appendChild(link);
    }
  }

  function figure(child, caption) {
    const fig = h("figure", "block block--media");
    // Drop the placeholder tint once loaded so transparent PNGs/GIFs sit on the page bare.
    if (child.tagName === "IMG") child.addEventListener("load", () => child.classList.add("is-loaded"), { once: true });
    fig.appendChild(child);
    if (caption) fig.appendChild(h("figcaption", null, caption));
    return fig;
  }

  // Inline formatting: **bold**, *italic* / _italic_, ***both***.
  // Builds nodes rather than HTML so post text is never parsed as markup.
  // Markers can't sit next to whitespace on their inner side, so "2 * 3" stays literal.
  const INLINE = /\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*|\*\*(?!\s)(.+?)(?<!\s)\*\*(?!\*)|\*(?!\s)(.+?)(?<!\s)\*|\b_(?!\s)(.+?)(?<!\s)_\b/g;
  function inline(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1] != null) {
        const b = h("strong");
        b.append(h("em", null, m[1]));
        out.push(b);
      } else if (m[2] != null) {
        const b = h("strong");
        b.append(...inline(m[2]));
        out.push(b);
      } else {
        const i = h("em");
        i.append(...inline(m[3] ?? m[4]));
        out.push(i);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  function para(text) {
    const p = h("p");
    p.append(...inline(text));
    return p;
  }

  // Frame shapes for Figma embeds. Matches FIGMA_SHAPES in admin/admin.js.
  const FIGMA_SHAPES = { default: "8 / 5", wide: "16 / 9", standard: "4 / 3", tall: "5 / 8", phone: "9 / 16" };

  // Body blocks: { type: "text" | "textimage" | "heading" | "divider" | "image" | "video" | "gallery" | "figma", ... }.
  // Plain strings (the older format) are treated as paragraphs.
  function renderBlock(b) {
    if (typeof b === "string") return [para(b)];
    switch (b.type) {
      case "heading":
        return [h("h3", "block block--heading", b.text)];
      case "divider":
        return [h("hr", "block block--divider")];
      case "textimage": {
        // A passage with its image on the right: the same spread layoutBody makes.
        const text = renderBlock({ type: "text", text: b.text });
        const image = renderBlock({ type: "image", src: b.src, caption: b.caption, alt: b.alt });
        if (!text.length || !image.length) return [...text, ...image];
        const pair = h("div", "block pair pair--fill");
        const col = h("div", "pair__text");
        col.append(...text);
        pair.append(col, ...image);
        return [pair];
      }
      case "image": {
        if (!b.src) return [];
        const img = h("img");
        img.alt = b.alt || "";
        img.loading = "lazy";
        img.src = b.src;
        const fig = figure(img, b.caption);
        fig.classList.add("block--image");
        return [fig];
      }
      case "video": {
        if (!b.src) return [];
        const embed = embedUrl(b.src);
        let el;
        if (embed) {
          el = h("div", "block__embed");
          const frame = h("iframe");
          frame.src = embed;
          frame.title = b.caption || "Video";
          frame.allow = "autoplay; fullscreen; picture-in-picture";
          frame.allowFullscreen = true;
          frame.loading = "lazy";
          el.appendChild(frame);
        } else {
          el = h("video");
          el.src = b.src;
          el.controls = true;
          el.playsInline = true;
          el.preload = "metadata";
        }
        return [figure(el, b.caption)];
      }
      case "gallery": {
        const items = (b.items || []).filter((it) => it.src);
        if (!items.length) return [];
        const grid = h("div", b.uncropped ? "block gallery-grid gallery-grid--uncropped" : "block gallery-grid");
        grid.style.setProperty("--cols", b.columns || 3);
        if (b.width) grid.style.maxWidth = `${b.width}%`;
        for (const it of items) {
          const img = h("img");
          img.alt = it.alt || "";
          img.loading = "lazy";
          img.src = it.src;
          const fig = figure(img, it.caption);
          fig.classList.add("block--image");
          grid.appendChild(fig);
        }
        return [grid];
      }
      case "figma": {
        const embed = figmaEmbed(b.src);
        if (!embed) return [];
        warmFigma();
        const shape = FIGMA_SHAPES[b.shape] ? b.shape : "default";
        const box = h("div", `block__embed block__embed--figma block__embed--${shape}`);
        box.style.aspectRatio = FIGMA_SHAPES[shape];
        const frame = h("iframe");
        frame.src = embed;
        frame.title = b.caption || "Figma prototype";
        frame.allow = "fullscreen";
        frame.allowFullscreen = true;
        frame.loading = "lazy";
        box.appendChild(frame);
        return [figure(box, b.caption)];
      }
      default:
        return (b.text || "").split(/\n\s*\n/).filter((t) => t.trim()).map((t) => para(t.trim()));
    }
  }

  // Width / height of a loaded <img> or <video>, or 0 if not known yet.
  const ratioOf = (m) => {
    const w = m && (m.naturalWidth || m.videoWidth), ht = m && (m.naturalHeight || m.videoHeight);
    return w && ht ? w / ht : 0;
  };

  const isMedia = (b) => b && typeof b === "object" && (b.type === "image" || b.type === "video") && b.src;
  const isText = (b) => typeof b === "string" || (b && (b.type === "text" || !b.type));
  const GALLERY_ROW = 3;

  // Runs of media become justified rows: equal height, each item as wide as
  // its own proportions allow (flex-grow = aspect ratio, set once loaded).
  function gallery(items) {
    const wrap = h("div", "block gallery-rows");
    // Spread items evenly over the rows (4 → 2 + 2, 5 → 3 + 2), so no
    // single item ends up stretched across a row of its own.
    const rows = Math.ceil(items.length / GALLERY_ROW);
    for (let r = 0, i = 0; r < rows; r++) {
      const row = h("div", "gallery-row");
      const n = Math.ceil((items.length - i) / (rows - r));
      for (const b of items.slice(i, (i += n))) {
        const [fig] = renderBlock(b);
        const m = fig.querySelector("img, video");
        const grow = () => { const r = ratioOf(m); if (r) fig.style.flexGrow = r; };
        if (m) {
          m.addEventListener(m.tagName === "IMG" ? "load" : "loadedmetadata", grow, { once: true });
          grow();
        } else {
          fig.style.flexGrow = 16 / 9; // embeds are 16:9
        }
        row.appendChild(fig);
      }
      wrap.appendChild(row);
    }
    return wrap;
  }

  // Lays body blocks out like a printed spread, following the source site:
  // a passage followed by a single image sits beside it; two or more media
  // in a row form a gallery; anything else runs down the column.
  function layoutBody(blocks) {
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (isMedia(b)) {
        let j = i;
        while (isMedia(blocks[j + 1])) j++;
        if (j > i) { out.push(gallery(blocks.slice(i, j + 1))); i = j; continue; }
      }
      const next = blocks[i + 1];
      if (isText(b) && next && next.type === "image" && next.src && !isMedia(blocks[i + 2])) {
        const pair = h("div", "block pair");
        const text = h("div", "pair__text");
        text.append(...renderBlock(b));
        pair.append(text, ...renderBlock(next));
        out.push(pair);
        i++;
        continue;
      }
      out.push(...renderBlock(b));
    }
    return out;
  }

  // The cover is shown whole: its box takes the image's own proportions.
  // The gallery tile has usually loaded it already, so the size is known
  // before the open animation measures the box.
  function fitViewMedia(p) {
    const setRatio = (r) => r && viewMedia.style.setProperty("--ar", r);
    viewMedia.style.removeProperty("--ar");
    const tile = tileFor(p.slug);
    setRatio(ratioOf(tile && tile.querySelector(".media__fill")));
    const fill = viewMedia.querySelector(".media__fill");
    if (fill) {
      fill.addEventListener("load", () => setRatio(ratioOf(fill)), { once: true });
      fill.addEventListener("loadedmetadata", () => setRatio(ratioOf(fill)), { once: true });
    }
  }

  function renderProject(p) {
    fillMedia(viewMedia, p);
    fitViewMedia(p);
    viewTitle.textContent = p.title;
    const intro = (p.intro || "").trim();
    viewIntro.replaceChildren(...inline(intro));
    viewIntro.hidden = !intro;
    // Optional button to the game itself.
    const link = (p.link || "").trim();
    viewLink.hidden = !link;
    if (link) {
      viewLink.href = /^https?:/i.test(link) ? link : `https://${link}`;
      viewLink.textContent = `${(p.linkLabel || "").trim() || "Play the game"} ↗`;
    } else {
      viewLink.removeAttribute("href");
    }
    // Quick info: the date plus any label/value details on the post.
    const info = [p.date && { label: "Date", value: p.date }, ...(p.info || [])]
      .filter((d) => d && (d.label || d.value));
    viewInfo.replaceChildren(...info.map((d) => {
      const row = h("div", "project__info-row");
      const dd = h("dd");
      // Values that look like web addresses become links.
      if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(d.value || "")) {
        const a = h("a", null, d.value.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]);
        a.href = /^https?:/.test(d.value) ? d.value : `https://${d.value}`;
        a.target = "_blank";
        a.rel = "noopener";
        dd.appendChild(a);
      } else {
        dd.textContent = d.value;
      }
      row.append(h("dt", null, d.label), dd);
      return row;
    }));
    viewBody.replaceChildren(...layoutBody(p.body || []));
    document.title = `${p.title} — Katie Zhao`;
  }

  /* ---------- Masthead: the name fades with the intro, the bar docks with the filters ---------- */

  let mh = null;

  // cubic-bezier() as a pure function of x, so the scroll-linked dock stays
  // scrubbable. Solved by bisection: x(t) is monotonic for 0 <= x1, x2 <= 1.
  function cubicBezier(x1, y1, x2, y2) {
    const at = (a, b, t) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
    return (x) => {
      if (x <= 0 || x >= 1) return clamp(x);
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 18; i++) {
        if (at(x1, x2, t) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return at(y1, y2, t);
    };
  }
  // Eases in gently, then a long, soft settle into the bar.
  const DOCK_EASE = cubicBezier(0.45, 0, 0.1, 1);

  function measureMasthead() {
    nameWrap.style.transform = "";
    nameSlot.style.height = `${nameWrap.offsetHeight}px`;
    // The intro is sticky at top: 0, so the slot's viewport position is
    // the same at any scroll offset.
    const slot = nameSlot.getBoundingClientRect();
    nameWrap.style.left = `${slot.left}px`;
    nameWrap.style.top = `${slot.top}px`;

    // The bar finishes fading in as the work sheet reaches it.
    const dist = Math.max(80, work.offsetTop - bar.offsetHeight);
    // Work / About start a little way down, above the name, and rise into the bar.
    const navY = Math.max(0, Math.min(innerHeight * 0.12, slot.top - 12) - bar.offsetHeight / 2);
    mh = { dist, navY };
    updateMasthead();
  }

  function updateMasthead() {
    if (!mh) return;
    const p = clamp(scrollY / mh.dist);
    const e = DOCK_EASE(p);
    siteNav.style.transform = `translateY(${mh.navY * (1 - e)}px)`;
    // The bar, carrying the filters, fades in on the eased progress.
    const b = clamp((e - 0.55) / 0.4);
    bar.style.opacity = String(b * b * (3 - 2 * b));

    const docked = p >= 0.999;
    masthead.classList.toggle("is-docked", docked);
    barFilters.inert = !docked;

    // Name and description drift up as the work sheet slides over them.
    const q = clamp(scrollY / innerHeight);
    const drift = `translateY(${-q * 60}px)`;
    introRow.style.transform = nameWrap.style.transform = drift;
    // The intro (name, bio, filters, flower) fades out early, so it's gone
    // before the bar and the sheet close over it rather than being sliced.
    const f = clamp((p - 0.1) / 0.45);
    intro.style.opacity = nameWrap.style.opacity = String(1 - f * f * (3 - 2 * f));
  }

  // Work scrolls to the gallery; About is its own page (a plain link).
  function scrollToWork() {
    const top = work.getBoundingClientRect().top + scrollY - bar.offsetHeight;
    scrollTo({ top, behavior: reducedMotion.matches ? "auto" : "smooth" });
  }

  siteNav.addEventListener("click", (e) => {
    const link = e.target.closest("[data-go]");
    if (!link) return;
    e.preventDefault();
    scrollToWork();
  });

  /* ---------- Thumbnail → preview movement ---------- */

  const tileFor = (slug) => work.querySelector(`.tile[data-slug="${CSS.escape(slug)}"]`);

  const inViewport = (r) => r.bottom > 0 && r.top < innerHeight && r.width > 0;

  // clip-path that crops the overlay down to rect `r`.
  function insetFor(r) {
    const v = view.getBoundingClientRect();
    return `inset(${r.top - v.top}px ${v.right - r.right}px ${v.bottom - r.bottom}px ${r.left - v.left}px)`;
  }

  // Animate a clone of `source` from rect `from` to rect `to`. The card's
  // caption, shadow and (once folded) dog-ear ride along, whole at the
  // card's end and gone at the project's, so neither end pops or re-fades.
  function fly(source, from, to, card, closing) {
    const flyer = h("div", "flyer");
    const media = source.cloneNode(true);
    media.removeAttribute("id");
    media.classList.add("flyer__media");
    media.style.visibility = ""; // the source is hidden while we fly
    flyer.appendChild(media);

    const cap = card.querySelector(".card__cap").cloneNode(true);
    flyer.appendChild(cap);
    const ear = card.classList.contains("is-visited") && card._ear;
    if (ear) {
      flyer.classList.add("is-eared");
      flyer.style.setProperty("--ear-w", `${ear.w}px`);
      flyer.style.setProperty("--ear-h", `${ear.h}px`);
      flyer.style.setProperty("--ear-corner", ear.mask);
      const svg = ear.svg.cloneNode(true);
      svg.style.transformOrigin = ""; // left over from the fold animation
      flyer.appendChild(svg);
    }
    document.body.appendChild(flyer);

    // k is 1 at the card's end and 0 at the project's. Position rides on
    // transform; only the size changes layout.
    const frame = (r, k) => ({
      transform: `translate(${r.left}px, ${r.top}px)`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      filter: `drop-shadow(0 4px 4px rgb(0 0 0 / ${0.4 * k}))`,
      "--ear-k": k,
    });
    const timing = { duration: duration(), easing: EASE, fill: "forwards" };
    // The ear tucks into the corner over the card's half of the trip.
    const frames = closing
      ? [frame(from, 0), { "--ear-k": 0, offset: 0.5 }, frame(to, 1)]
      : [frame(from, 1), { "--ear-k": 0, offset: 0.5 }, frame(to, 0)];
    const anim = flyer.animate(frames, timing);
    cap.animate(closing
      ? [{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }]
      : [{ opacity: 1 }, { opacity: 0, offset: 0.3 }, { opacity: 0 }], timing);
    return anim.finished.then(() => flyer.remove());
  }

  // The page opens out of (or closes back into) the thumbnail's frame.
  function morphView(fromClip, toClip) {
    return view.animate([{ clipPath: fromClip }, { clipPath: toClip }], {
      duration: duration(),
      easing: EASE,
      fill: "forwards",
    }).finished;
  }

  function fade(el, from, to) {
    return el.animate([{ opacity: from }, { opacity: to }], {
      duration: duration() * 0.6,
      easing: "ease",
      fill: "forwards",
    }).finished;
  }

  const FULL = "inset(0px 0px 0px 0px round 0px)";

  async function openProject(slug, animate) {
    const p = bySlug.get(slug);
    if (!p) return goHome();

    busy = true;
    current = slug;
    renderProject(p);
    view.classList.remove("is-shown");
    view.hidden = false;
    view.scrollTop = 0;
    root.classList.add("is-locked");

    const tile = tileFor(slug);
    const thumb = tile && tile.querySelector(".tile__media");
    // A first visit folds the corner on the way back (closeProject); until
    // then the card stays flat.
    if (tile && !visited.has(slug)) tile.dataset.fold = "pending";
    markVisited(slug);
    const from = thumb && thumb.getBoundingClientRect();

    if (animate && from && inViewport(from)) {
      const to = viewMedia.getBoundingClientRect();
      tile.style.visibility = "hidden";
      viewMedia.style.visibility = "hidden";
      await Promise.all([fly(thumb, from, to, tile, false), morphView(insetFor(from), FULL)]);
      viewMedia.style.visibility = "";
      tile.style.visibility = "";
    } else {
      await fade(view, 0, 1);
    }

    view.getAnimations().forEach((a) => a.cancel());
    view.classList.add("is-shown");
    backLink.focus({ preventScroll: true });
    busy = false;
  }

  async function closeProject(animate) {
    if (!current) return;
    busy = true;
    const slug = current;
    current = null;

    root.classList.remove("is-locked");
    const tile = tileFor(slug);
    const thumb = tile && tile.querySelector(".tile__media");
    const to = thumb && thumb.getBoundingClientRect();
    const from = viewMedia.getBoundingClientRect();
    view.classList.remove("is-shown");

    if (animate && to && inViewport(to)) {
      const morph = morphView(FULL, insetFor(to));
      if (inViewport(from)) {
        tile.style.visibility = "hidden";
        viewMedia.style.visibility = "hidden";
        await Promise.all([fly(viewMedia, from, to, tile, true), morph]);
        tile.style.visibility = "";
        viewMedia.style.visibility = "";
      } else {
        // Hero scrolled away: the page closes into the tile as it dissolves.
        await Promise.all([morph, fade(view, 1, 0)]);
      }
    } else {
      await fade(view, 1, 0);
    }

    view.getAnimations().forEach((a) => a.cancel());
    view.hidden = true;
    document.title = "Katie Zhao";
    if (tile && tile.dataset.fold) {
      delete tile.dataset.fold;
      tile.classList.add("is-visited");
      foldEar(tile);
    }
    if (tile) tile.focus({ preventScroll: true });
    busy = false;
  }

  /* ---------- Routing ---------- */

  const parseHash = () => {
    const m = location.hash.match(/^#\/p\/([\w-]+)/);
    return m ? m[1] : null;
  };

  function route(animate) {
    const slug = parseHash();
    if (slug && slug !== current) openProject(slug, animate);
    else if (!slug && current) closeProject(animate);
  }

  function goHome() {
    // Pop our own history entry so the browser back button stays in sync;
    // otherwise (deep link) replace with the home route.
    if (openedFromGrid) {
      openedFromGrid = false;
      history.back();
    } else {
      history.replaceState(null, "", location.pathname + location.search);
      route(true);
    }
  }

  work.addEventListener("click", (e) => {
    const tile = e.target.closest(".tile");
    if (!tile) return;
    if (busy) { e.preventDefault(); return; }
    if (!(e.metaKey || e.ctrlKey || e.shiftKey)) openedFromGrid = true;
  });

  view.addEventListener("click", (e) => {
    if (!e.target.closest("[data-home]")) return;
    e.preventDefault();
    if (!busy) goHome();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current && !busy) goHome();
  });

  addEventListener("hashchange", () => {
    if (!parseHash()) openedFromGrid = false;
    route(true);
  });

  /* ---------- Init ---------- */

  renderWork();
  measureMasthead();
  addEventListener("scroll", updateMasthead, { passive: true });
  sizeTiles();
  addEventListener("resize", () => { measureMasthead(); sizeTiles(); });
  if (document.fonts) document.fonts.ready.then(() => { measureMasthead(); sizeTiles(); });
  route(false);
  // Arriving from another page's Work link.
  // Wait for load so the browser's own scroll restoration doesn't undo it.
  if (location.hash === "#work") {
    history.replaceState(null, "", location.pathname + location.search);
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const toWork = () => scrollTo({ top: work.getBoundingClientRect().top + scrollY - bar.offsetHeight });
    if (document.readyState === "complete") toWork();
    else addEventListener("load", () => requestAnimationFrame(toWork), { once: true });
  }
})();
