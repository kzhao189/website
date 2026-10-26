// Post editor. Talks to admin/server.py:
//   GET  /api/content         -> { tiers, posts }
//   PUT  /api/content         <- { tiers, posts }  (writes posts.json + projects.js)
//   POST /api/upload?name=... <- raw file          -> { path: "media/..." }
(() => {
  const $ = (id) => document.getElementById(id);
  const tree = $("tree");
  const pane = $("pane");
  const saveBtn = $("save");
  const status = $("status");
  const toast = $("toast");

  const BLOCKS = {
    text: "Text",
    textimage: "Text + Image",
    heading: "Heading",
    divider: "Line",
    image: "Image",
    video: "Video",
    gallery: "Gallery",
    figma: "Figma",
  };
  // What the heading colour picker shows before a colour is chosen: the site's paper white.
  const HEADING_DEFAULT = "#f4f1e8";
  // Frame shapes for Figma embeds. Matches FIGMA_SHAPES in main.js.
  const FIGMA_SHAPES = {
    default: ["Default 800×500", "8 / 5"],
    wide: ["Wide 16:9", "16 / 9"],
    standard: ["Standard 4:3", "4 / 3"],
    tall: ["Tall 5:8", "5 / 8"],
    phone: ["Phone 9:16", "9 / 16"],
  };
  // Accepts a plain link or Figma's <iframe> embed code; keeps just the URL.
  const pastedSrc = (v) => {
    const m = v.match(/<iframe[^>]*\ssrc="([^"]+)"/i);
    return (m ? m[1].replace(/&amp;/g, "&") : v).trim() || null;
  };
  const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg)$/i;
  const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

  // The cyanotype paper colour, as HSL. Matches SITE_DEFAULT in server.py.
  const SITE_DEFAULT = { hue: 218, sat: 89, light: 18 };
  const MIN_LIGHT = 4;                 // "Max dark"
  const PAPER_WHITE = [244, 241, 232]; // the site's type colour

  // What About.html shows before anything is saved from the editor.
  const ABOUT_DEFAULT = {
    title: "About",
    bio: "Hi! I'm Katie, a game interaction + XR designer developing immersive experiences with user-centered, artistic flair.",
    links: [
      { label: "LinkedIn", url: "https://www.linkedin.com/in/kyzhao/" },
      { label: "Instagram", url: "https://www.instagram.com/mayy.muu/" },
      { label: "ArtStation", url: "https://www.artstation.com/mayymuu" },
      { label: "Twitter", url: "https://twitter.com/mayymuu" },
    ],
  };
  // Link names that get a brand icon on the About page (see about.js).
  const ABOUT_ICONS = "LinkedIn, Instagram, ArtStation, Twitter, X, GitHub, YouTube, Vimeo, Behance, Dribbble, Discord, Twitch";

  let data = { tiers: [], posts: [], site: { ...SITE_DEFAULT }, about: structuredClone(ABOUT_DEFAULT) };
  let view = null;              // { post } | { categories: true } | { site: true } | { about: true } | null
  let dirty = false;
  const freshSlugs = new WeakSet(); // new posts whose slug still follows the title

  /* ---------- Helpers ---------- */

  function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "value") n.value = v; // textareas ignore the attribute
      else if (k === "dataset") Object.assign(n.dataset, v);
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k in n && typeof v !== "string") n[k] = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) n.append(c);
    return n;
  }

  const slugify = (s) =>
    s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-") || "post";

  function uniqueSlug(base, self) {
    let slug = base, n = 1;
    while (data.posts.some((p) => p !== self && p.slug === slug)) slug = `${base}-${++n}`;
    return slug;
  }

  const isUrl = (s) => /^(https?:)?\/\//.test(s);
  const mediaSrc = (path) => (!path || isUrl(path) ? path : `/${path}`);

  function embedUrl(src) {
    let m = src.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    m = src.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    return null;
  }

  // Figma file / prototype links -> Figma's embed.figma.com player. Embed links pass through.
  // Matches figmaEmbed in main.js.
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

  const swatch = (hue) =>
    `linear-gradient(135deg, hsl(${hue} 55% 62%), hsl(${(hue + 40) % 360} 50% 42%))`;

  let toastTimer;
  function notify(msg, error = false) {
    toast.textContent = msg;
    toast.classList.toggle("is-error", error);
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-on"), error ? 5000 : 2200);
  }

  function setDirty(v = true) {
    dirty = v;
    saveBtn.disabled = !v;
    status.classList.toggle("is-dirty", v);
    status.textContent = v ? "Unsaved changes" : "All changes saved";
  }

  // Field edits update the model and the sidebar, but not the open pane,
  // so the input keeps focus.
  function changed() {
    setDirty();
    renderTree();
  }

  const move = (arr, from, to) => arr.splice(to, 0, arr.splice(from, 1)[0]);
  // Categories are stored as "tiers" (window.TIERS on the site) and each post's
  // `tier` is its category id. They drive the filter toggles on the home page.
  const postsIn = (tierId) => data.posts.filter((p) => p.tier === tierId);
  const tierOf = (post) => data.tiers.find((t) => t.id === post.tier);

  /* ---------- Server ---------- */

  async function load() {
    const res = await fetch("/api/content");
    if (!res.ok) throw new Error(`Couldn't load content (${res.status})`);
    data = await res.json();
    data.site = { ...SITE_DEFAULT, ...data.site };
    data.about = { ...structuredClone(ABOUT_DEFAULT), ...data.about };
    // Posts all carry the same weight now, so categories no longer pick a layout.
    for (const t of data.tiers) delete t.layout;
    for (const p of data.posts) {
      // Older posts stored the body as a list of paragraphs.
      p.body = (p.body || []).map((b) => (typeof b === "string" ? { type: "text", text: b } : b));
      p.hue ??= Math.floor(Math.random() * 360);
    }
  }

  async function save() {
    const slugs = new Set();
    for (const p of data.posts) {
      if (!p.title.trim()) return notify("Every post needs a title.", true);
      if (slugs.has(p.slug)) return notify(`Two posts share the URL “${p.slug}”.`, true);
      slugs.add(p.slug);
    }
    saveBtn.disabled = true;
    status.textContent = "Saving…";
    try {
      const res = await fetch("/api/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || res.statusText);
      setDirty(false);
      notify("Saved — the site is updated.");
    } catch (err) {
      setDirty(true);
      notify(`Save failed: ${err.message}`, true);
    }
  }

  function upload(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/upload?name=${encodeURIComponent(file.name)}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let out = {};
        try { out = JSON.parse(xhr.responseText); } catch {}
        xhr.status === 200 ? resolve(out.path) : reject(new Error(out.error || xhr.statusText));
      };
      xhr.onerror = () => reject(new Error("network error"));
      xhr.send(file);
    });
  }

  /* ---------- Sidebar ---------- */

  let dragged = null;

  function clearDropMarks() {
    tree.querySelectorAll(".drop-before, .drop-after, .is-over")
      .forEach((n) => n.classList.remove("drop-before", "drop-after", "is-over"));
  }

  function dropPost(target, after) {
    if (!dragged || dragged === target) return;
    data.posts.splice(data.posts.indexOf(dragged), 1);
    data.posts.splice(data.posts.indexOf(target) + (after ? 1 : 0), 0, dragged);
    setDirty();
    renderTree();
  }

  function postItem(p) {
    const thumb = el("span", { class: "post-item__thumb" });
    thumb.style.background = p.image ? `center / cover url("${mediaSrc(p.image)}")` : swatch(p.hue);

    const item = el("button", {
      class: `post-item${view?.post === p ? " is-active" : ""}`,
      draggable: true,
      title: p.title,
      onclick: () => select({ post: p }),
      ondragstart: (e) => {
        dragged = p;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", p.slug);
        requestAnimationFrame(() => item.classList.add("is-dragging"));
      },
      ondragend: () => { dragged = null; item.classList.remove("is-dragging"); clearDropMarks(); },
      ondragover: (e) => {
        if (!dragged) return;
        e.preventDefault();
        e.stopPropagation();
        const r = item.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        clearDropMarks();
        item.classList.add(after ? "drop-after" : "drop-before");
      },
      ondrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = item.getBoundingClientRect();
        dropPost(p, e.clientY > r.top + r.height / 2);
      },
    },
      el("span", { class: "post-item__grip", "aria-hidden": "true" }, "⋮⋮"),
      thumb,
      el("span", { class: "post-item__title" }, p.title || "Untitled"),
      p.draft && el("span", { class: "pill" }, "Draft"),
      el("span", { class: "post-item__cat" }, tierOf(p)?.label || ""),
    );
    return item;
  }

  // One list in site order; drag to reorder.
  function renderTree() {
    tree.replaceChildren(data.posts.length
      ? el("div", { class: "tree__list" }, data.posts.map(postItem))
      : el("div", { class: "tree__empty" }, "No posts yet"));
  }

  /* ---------- Shared editor pieces ---------- */

  function field(label, input, hint) {
    return el("label", { class: "field" }, el("span", {}, label), input, hint && el("small", {}, hint));
  }

  function textInput(obj, key, props = {}, onInput) {
    return el(props.rows ? "textarea" : "input", {
      class: "input",
      value: obj[key] ?? "",
      ...props,
      oninput: (e) => { obj[key] = e.target.value; onInput?.(e.target.value); changed(); },
    });
  }

  // A click-or-drop target for one media file. `accept` is "image" or "video".
  function mediaDrop({ value, accept, onChange, empty, hue }) {
    const pattern = accept === "image" ? IMAGE_EXT : VIDEO_EXT;
    const picker = el("input", { type: "file", accept: `${accept}/*`, hidden: true });
    const box = el("div", { class: "drop", tabindex: "0", role: "button" });

    function preview() {
      if (!value) {
        const kids = [el("div", { class: "drop__hint" }, empty)];
        if (hue != null) {
          const sw = el("div", { class: "drop__swatch" });
          sw.style.background = swatch(hue);
          sw.style.opacity = "0.35";
          kids.unshift(sw);
        }
        return kids;
      }
      const embed = accept === "video" && embedUrl(value);
      if (embed) {
        const frame = el("iframe", { src: embed, title: "Video preview", allow: "fullscreen" });
        frame.style.cssText = "width:100%;aspect-ratio:16/9;border:0;display:block";
        return [frame];
      }
      return [accept === "image"
        ? el("img", { src: mediaSrc(value), alt: "" })
        : el("video", { src: mediaSrc(value), controls: true, muted: true, playsInline: true })];
    }
    box.replaceChildren(...preview());

    async function take(file) {
      if (!file) return;
      if (!pattern.test(file.name)) return notify(`That isn't a${accept === "image" ? "n image" : " video"} file.`, true);
      const bar = el("div", { class: "drop__bar" });
      bar.style.transform = "scaleX(0)";
      box.replaceChildren(el("div", { class: "drop__hint" }, `Uploading ${file.name}…`), bar);
      try {
        const path = await upload(file, (f) => (bar.style.transform = `scaleX(${f})`));
        onChange(path);
      } catch (err) {
        notify(`Upload failed: ${err.message}`, true);
        box.replaceChildren(...preview());
      }
    }

    picker.addEventListener("change", () => take(picker.files[0]));
    box.addEventListener("click", (e) => { if (e.target === box || !value) picker.click(); });
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); picker.click(); } });
    box.addEventListener("dragover", (e) => {
      if (![...e.dataTransfer.types].includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      box.classList.add("is-over");
    });
    box.addEventListener("dragleave", () => box.classList.remove("is-over"));
    box.addEventListener("drop", (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      box.classList.remove("is-over");
      take(e.dataTransfer.files[0]);
    });

    const actions = el("div", { class: "media-actions" },
      el("button", { class: "btn btn--sm", type: "button", onclick: () => picker.click() }, value ? "Replace" : "Upload"),
      value && el("button", { class: "btn btn--sm btn--danger", type: "button", onclick: () => onChange(null) }, "Remove"),
      value && el("code", {}, value),
    );
    return el("div", {}, box, actions, picker);
  }

  // Scrub the cover video to pick the frame its home page tile rests on.
  // Stored as post.posterTime (seconds); unset means the cover image / first frame.
  function keyframePicker(post) {
    const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
    const video = el("video", { muted: true, playsInline: true, preload: "auto" });
    // Load it as a blob so it can be scrubbed even if the server can't seek.
    fetch(mediaSrc(post.video)).then((r) => r.blob()).then((b) => { video.src = URL.createObjectURL(b); })
      .catch(() => { video.src = mediaSrc(post.video); });
    const time = el("code", {}, post.posterTime != null ? fmt(post.posterTime) : "Not set");
    const clear = el("button", { class: "btn btn--sm", type: "button", disabled: post.posterTime == null, onclick: () => {
      delete post.posterTime;
      setDirty();
      renderPane();
    } }, "Clear");
    const slider = el("input", {
      type: "range", min: "0", max: "1", step: "0.01", value: "0", disabled: true,
      oninput: (e) => {
        const t = Number(e.target.value);
        video.currentTime = t;
        post.posterTime = Math.round(t * 100) / 100;
        time.textContent = fmt(post.posterTime);
        clear.disabled = false;
        setDirty();
      },
    });
    video.addEventListener("loadedmetadata", () => {
      slider.max = String(video.duration);
      slider.disabled = false;
      const t = Math.min(post.posterTime ?? 0, video.duration);
      slider.value = String(t);
      video.currentTime = t;
    });

    return el("div", { class: "keyframe" },
      el("div", { class: "keyframe__frame" }, video),
      slider,
      el("div", { class: "media-actions" }, time, clear),
    );
  }

  /* ---------- Post editor ---------- */

  // A gallery block's images as editable tiles, plus a tile that takes more.
  function galleryEditor(b, restructure) {
    const items = (b.items ||= []);
    const picker = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });

    async function take(files) {
      for (const file of files) {
        if (!IMAGE_EXT.test(file.name)) { notify(`Skipped ${file.name}: not an image.`, true); continue; }
        notify(`Uploading ${file.name}…`);
        try {
          items.push({ src: await upload(file), caption: "", alt: "" });
          restructure();
        } catch (err) {
          notify(`Upload failed: ${err.message}`, true);
        }
      }
    }
    picker.addEventListener("change", () => take([...picker.files]));

    const add = el("div", {
      class: "drop gallery-edit__add", tabindex: "0", role: "button",
      onclick: () => picker.click(),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); picker.click(); } },
      ondragover: (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); add.classList.add("is-over"); } },
      ondragleave: () => add.classList.remove("is-over"),
      ondrop: (e) => { e.preventDefault(); add.classList.remove("is-over"); take([...e.dataTransfer.files]); },
    }, el("div", { class: "drop__hint" }, items.length ? "+ Add images" : "Drop images here, or click to choose"));

    const tiles = items.map((it, k) => el("div", { class: "gallery-edit__item" },
      el("img", { src: mediaSrc(it.src), alt: "" }),
      el("div", { class: "gallery-edit__bar" },
        el("button", { class: "icon-btn", type: "button", title: "Move left", disabled: k === 0, onclick: () => { move(items, k, k - 1); restructure(); } }, "←"),
        el("button", { class: "icon-btn", type: "button", title: "Move right", disabled: k === items.length - 1, onclick: () => { move(items, k, k + 1); restructure(); } }, "→"),
        el("button", { class: "icon-btn", type: "button", title: "Remove image", onclick: () => { items.splice(k, 1); restructure(); } }, "✕"),
      ),
      textInput(it, "caption", { placeholder: "Caption" }),
      textInput(it, "alt", { placeholder: "Alt text" }),
    ));

    return el("div", { class: "gallery-edit" }, tiles, add, picker);
  }

  function blockEditor(post, b, i) {
    const n = post.body.length;
    const restructure = () => { setDirty(); renderPane(); };
    const set = (patch) => { Object.assign(b, patch); restructure(); };

    let body;
    switch (b.type) {
      case "heading":
        body = [textInput(b, "text", { placeholder: "Heading" })];
        break;
      case "divider":
        // Nothing to fill in: a preview of the line it draws.
        body = [el("hr", { class: "divider-preview" })];
        break;
      case "image":
        body = [
          mediaDrop({ value: b.src, accept: "image", empty: "Drop an image here, or click to choose", onChange: (src) => set({ src }) }),
          el("div", { class: "grid" },
            field("Image caption", textInput(b, "caption", { placeholder: "Write an optional caption" }), "Shown below the image on the site."),
            field("Alt text", textInput(b, "alt", { placeholder: "Describe the image for screen readers" })),
          ),
        ];
        break;
      case "textimage":
        body = [
          el("div", { class: "split-edit" },
            textInput(b, "text", { rows: 8, placeholder: "Write here. Leave a blank line between paragraphs. **bold**, *italic*" }),
            mediaDrop({ value: b.src, accept: "image", empty: "Drop the image for the right side, or click to choose", onChange: (src) => set({ src }) }),
          ),
          el("div", { class: "grid" },
            field("Image caption", textInput(b, "caption", { placeholder: "Write an optional caption" }), "Shown below the image on the site."),
            field("Alt text", textInput(b, "alt", { placeholder: "Describe the image for screen readers" })),
          ),
        ];
        break;
      case "video": {
        const linked = b.src && isUrl(b.src);
        body = [
          mediaDrop({ value: b.src, accept: "video", empty: "Drop a video file (mp4, webm, mov), or click to choose", onChange: (src) => set({ src }) }),
          el("div", { class: "grid" },
            field("…or paste a YouTube / Vimeo link",
              el("input", {
                class: "input",
                type: "url",
                placeholder: "https://youtu.be/…",
                value: linked ? b.src : "",
                onchange: (e) => set({ src: e.target.value.trim() || null }),
              })),
            field("Caption", textInput(b, "caption", { placeholder: "Optional" })),
          ),
        ];
        break;
      }
      case "gallery":
        body = [
          galleryEditor(b, restructure),
          el("div", { class: "grid grid--3" },
            field("Columns",
              el("select", { class: "input", onchange: (e) => set({ columns: Number(e.target.value) }) },
                [2, 3, 4].map((c) => el("option", { value: String(c), selected: (b.columns || 3) === c }, String(c)))),
              "Phones show two columns."),
            field("Max width (% of page)",
              el("input", {
                class: "input",
                type: "number",
                min: "10",
                max: "100",
                step: "5",
                placeholder: "100",
                value: b.width ?? "",
                onchange: (e) => {
                  const w = Math.min(100, Math.max(10, Number(e.target.value) || 100));
                  set({ width: w < 100 ? w : null });
                },
              }),
              "Leave blank to fill the page."),
            el("div", { class: "field" },
              el("span", {}, "Cropping"),
              el("label", { class: "check" },
                el("input", { type: "checkbox", checked: !!b.uncropped, onchange: (e) => set({ uncropped: e.target.checked }) }),
                "Uncropped"),
              el("small", {}, b.uncropped ? "Images keep their shape, stacked in columns." : "Images are cropped to matching tiles."),
            ),
          ),
        ];
        break;
      case "figma": {
        const embed = figmaEmbed(b.src);
        const frame = embed && el("iframe", { class: "figma-preview", src: embed, title: "Figma preview", allow: "fullscreen" });
        if (frame) frame.style.aspectRatio = FIGMA_SHAPES[FIGMA_SHAPES[b.shape] ? b.shape : "default"][1];
        body = [
          field("Figma link",
            el("input", {
              class: "input",
              type: "url",
              placeholder: "https://www.figma.com/proto/…, or paste the embed code",
              value: b.src || "",
              onchange: (e) => set({ src: pastedSrc(e.target.value) }),
            }),
            b.src && !embed ? "That doesn't look like a Figma file or prototype link." : "Paste a Share link or the <iframe> embed code. The file has to be viewable by anyone with the link."),
          frame,
          el("div", { class: "grid" },
            field("Frame shape",
              el("select", { class: "input", onchange: (e) => set({ shape: e.target.value }) },
                Object.entries(FIGMA_SHAPES).map(([k, [label]]) => el("option", { value: k, selected: (FIGMA_SHAPES[b.shape] ? b.shape : "default") === k }, label)))),
            field("Caption", textInput(b, "caption", { placeholder: "Optional" })),
          ),
        ];
        break;
      }
      default:
        body = [textInput(b, "text", { rows: 6, placeholder: "Write here. Leave a blank line between paragraphs. **bold**, *italic*" })];
    }

    return el("div", { class: `block block--${b.type}` },
      el("div", { class: "block__bar" },
        el("span", {}, BLOCKS[b.type] || b.type),
        el("button", { class: "icon-btn", type: "button", title: "Move up", disabled: i === 0, onclick: () => { move(post.body, i, i - 1); restructure(); } }, "↑"),
        el("button", { class: "icon-btn", type: "button", title: "Move down", disabled: i === n - 1, onclick: () => { move(post.body, i, i + 1); restructure(); } }, "↓"),
        el("button", { class: "icon-btn", type: "button", title: "Remove block", onclick: () => {
          const hasContent = b.text?.trim() || b.src || b.items?.length;
          if (hasContent && !confirm("Remove this block?")) return;
          post.body.splice(i, 1);
          restructure();
        } }, "✕"),
      ),
      el("div", { class: "block__body" }, body),
    );
  }

  function addRow(post) {
    const add = (type, extra = {}) => {
      const fresh = type === "text" || type === "heading" ? { text: "" }
        : type === "gallery" ? { items: [], columns: 3 }
        : type === "textimage" ? { text: "", src: null, caption: "", alt: "" }
        : type === "divider" ? {}
        : { src: null, caption: "" };
      post.body.push({ type, ...fresh, ...extra });
      setDirty();
      renderPane();
      // Focus the new block's first field.
      requestAnimationFrame(() => pane.querySelector(".block:last-child .input")?.focus());
    };

    // Dropping files here adds one image/video block per file.
    async function dropFiles(files) {
      for (const file of files) {
        const type = IMAGE_EXT.test(file.name) ? "image" : VIDEO_EXT.test(file.name) ? "video" : null;
        if (!type) { notify(`Skipped ${file.name}: not an image or video.`, true); continue; }
        notify(`Uploading ${file.name}…`);
        try {
          const src = await upload(file);
          post.body.push({ type, src, caption: "" });
          setDirty();
          renderPane();
        } catch (err) {
          notify(`Upload failed: ${err.message}`, true);
        }
      }
    }

    const row = el("div", {
      class: "add-row",
      ondragover: (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); row.classList.add("is-over"); } },
      ondragleave: () => row.classList.remove("is-over"),
      ondrop: (e) => { e.preventDefault(); row.classList.remove("is-over"); dropFiles([...e.dataTransfer.files]); },
    },
      "Add:",
      Object.entries(BLOCKS).map(([type, label]) =>
        el("button", { class: "btn btn--sm", type: "button", onclick: () => add(type) }, `+ ${label}`)),
      el("small", {}, "or drop images / videos here"),
    );
    return row;
  }

  // Label/value pairs shown beside the title on the post page, after the date.
  function infoEditor(post) {
    post.info ||= [];
    const restructure = () => { setDirty(); renderPane(); };
    return el("div", { class: "info-list" },
      post.info.map((d, i) => el("div", { class: "info-row" },
        textInput(d, "label", { placeholder: "Label, e.g. Role" }),
        textInput(d, "value", { placeholder: "Value, e.g. Lead designer" }),
        el("button", { class: "icon-btn", type: "button", title: "Move up", disabled: i === 0, onclick: () => { move(post.info, i, i - 1); restructure(); } }, "↑"),
        el("button", { class: "icon-btn", type: "button", title: "Remove", onclick: () => { post.info.splice(i, 1); restructure(); } }, "✕"),
      )),
      el("div", { class: "media-actions" },
        el("button", { class: "btn btn--sm", type: "button", onclick: () => {
          post.info.push({ label: "", value: "" });
          restructure();
          requestAnimationFrame(() => [...pane.querySelectorAll(".info-row .input")].at(-2)?.focus());
        } }, "+ Add detail"),
      ),
    );
  }

  // What the home page tile shows under the cover. The role is the "Role"
  // row of Quick info, so editing it here and there stays in sync.
  function tileEditor(post) {
    post.info ||= [];
    const roleRow = () => post.info.find((d) => d.label === "Role");
    const role = el("input", {
      class: "input",
      value: roleRow()?.value ?? "",
      placeholder: "e.g. Lead UI/X Designer, Game Design",
      oninput: (e) => {
        let row = roleRow();
        if (!row) post.info.unshift(row = { label: "Role", value: "" });
        row.value = e.target.value;
        changed();
      },
      onchange: (e) => {
        if (!e.target.value.trim()) post.info = post.info.filter((d) => d !== roleRow());
        renderPane();
      },
    });

    return el("div", { class: "grid" },
      field("Tile name", textInput(post, "tileTitle", { placeholder: post.title || "Same as the post title" }),
        "Leave blank to use the post title"),
      field("Role", role, "Also listed as “Role” in Quick info"),
      el("div", { class: "span-2" },
        field("Description", textInput(post, "summary", { rows: 3, placeholder: "One or two sentences about the project" }))),
      field("Game link", textInput(post, "link", { type: "url", placeholder: "https://… (optional)" }),
        "Adds a button under the description. Leave blank for no button"),
      field("Button text", textInput(post, "linkLabel", { placeholder: "Play the game" }),
        "Leave blank for “Play the game”"),
    );
  }

  function postPane(post) {
    const slugInput = el("input", {
      class: "input",
      value: post.slug,
      oninput: (e) => {
        freshSlugs.delete(post);
        post.slug = slugify(e.target.value);
        changed();
      },
      onblur: (e) => { e.target.value = post.slug = uniqueSlug(post.slug, post); },
    });

    const title = textInput(post, "title", { class: "input input--title", placeholder: "Post title" }, (v) => {
      if (freshSlugs.has(post)) slugInput.value = post.slug = uniqueSlug(slugify(v), post);
      heading.textContent = v || "Untitled";
    });
    const heading = el("h2", {}, post.title || "Untitled");

    const tierSelect = el("select", {
      class: "input",
      onchange: (e) => { post.tier = Number(e.target.value); changed(); },
    }, data.tiers.map((t) => el("option", { value: String(t.id), selected: t.id === post.tier }, t.label || "Untitled")));

    const hue = el("input", {
      type: "range", min: "0", max: "359", value: String(post.hue ?? 0),
      oninput: (e) => { post.hue = Number(e.target.value); changed(); },
      onchange: () => renderPane(),
    });

    return [
      el("div", { class: "pane__title" },
        heading,
        !post.draft && el("a", { class: "btn btn--ghost", href: `/${post.slug}`, target: "_blank", rel: "noopener", title: "Save first to see your latest changes" }, "View ↗"),
        el("button", { class: "btn btn--danger", type: "button", onclick: () => {
          if (!confirm(`Delete “${post.title || "Untitled"}”? This can't be undone after you save.`)) return;
          data.posts.splice(data.posts.indexOf(post), 1);
          setDirty();
          select(null);
        } }, "Delete"),
      ),

      el("section", { class: "card" },
        el("div", { class: "grid" },
          el("div", { class: "span-2" }, field("Title", title)),
          field("Category", tierSelect, "The home page filter that shows this post"),
          field("Date", textInput(post, "date", { placeholder: "e.g. 03 / 2026" })),
          field("URL", slugInput, `/${post.slug}`),
          el("div", { class: "field" },
            el("span", {}, "Visibility"),
            el("label", { class: "check" },
              el("input", { type: "checkbox", checked: !post.draft, onchange: (e) => { post.draft = !e.target.checked; changed(); renderPane(); } }),
              post.draft ? "Draft — hidden from the site" : "Published"),
          ),
        ),
      ),

      el("section", { class: "card" },
        el("h3", {}, "Home page tile"),
        tileEditor(post),
      ),

      el("section", { class: "card" },
        el("h3", {}, "Project description"),
        el("p", { class: "layout-help", style: "margin: -6px 0 12px" },
          "Shown under the title on the post page, left of Quick info."),
        textInput(post, "intro", { rows: 4, placeholder: "A short paragraph about the project (optional). **bold**, *italic*" }),
      ),

      el("section", { class: "card" },
        el("h3", {}, "Quick info"),
        el("p", { class: "layout-help", style: "margin: -6px 0 12px" },
          "Shown to the right of the title on the post page, after the date."),
        infoEditor(post),
      ),

      el("section", { class: "card" },
        el("h3", {}, "Cover"),
        el("div", { class: "grid" },
          field("Image", mediaDrop({
            value: post.image, accept: "image", hue: post.hue,
            empty: "Drop the cover image here, or click to choose",
            onChange: (v) => { post.image = v; setDirty(); renderTree(); renderPane(); },
          }), "Used for the thumbnail and project header"),
          field("Video (optional)", mediaDrop({
            value: post.video, accept: "video",
            empty: "Drop a short looping clip to play instead of the image",
            onChange: (v) => { post.video = v; delete post.posterTime; setDirty(); renderPane(); },
          }), "Plays muted on a loop; the image is its poster"),
          post.video && !embedUrl(post.video) && el("div", { class: "span-2" },
            field("Tile start frame", keyframePicker(post),
              "Drag to choose the frame the home page tile shows before it's hovered. Leave unset to use the cover image.")),
        ),
        !post.image && field("Placeholder colour (used until there's a cover image)", hue),
      ),

      el("section", { class: "card" },
        el("h3", {}, "Content"),
        el("div", { class: "blocks" }, post.body.map((b, i) => blockEditor(post, b, i))),
        addRow(post),
      ),
    ];
  }

  /* ---------- Categories editor ---------- */

  function categoriesPane() {
    const rerender = () => { setDirty(); renderTree(); renderPane(); };
    const rows = data.tiers.map((t, i) => {
      const count = postsIn(t.id).length;
      return el("div", { class: "tier-row" },
        el("span", { class: "tier-row__num" }, String(i + 1).padStart(2, "0")),
        textInput(t, "label", { placeholder: "Category name" }),
        el("span", { class: "tier-row__count" }, `${count} post${count === 1 ? "" : "s"}`),
        el("div", { class: "tier-row__btns" },
          el("button", { class: "icon-btn", type: "button", title: "Move up", disabled: i === 0, onclick: () => { move(data.tiers, i, i - 1); rerender(); } }, "↑"),
          el("button", { class: "icon-btn", type: "button", title: "Move down", disabled: i === data.tiers.length - 1, onclick: () => { move(data.tiers, i, i + 1); rerender(); } }, "↓"),
          el("button", {
            class: "icon-btn", type: "button",
            title: count ? `Move its ${count} post(s) to another category first` : "Delete category",
            disabled: count > 0 || data.tiers.length === 1,
            onclick: () => { data.tiers.splice(i, 1); rerender(); },
          }, "✕"),
        ),
      );
    });

    return [
      el("div", { class: "pane__title" }, el("h2", {}, "Categories")),
      el("section", { class: "card" },
        el("h3", {}, "Filters on the home page"),
        rows,
        el("div", { class: "media-actions" },
          el("button", { class: "btn", type: "button", onclick: () => {
            const id = Math.max(0, ...data.tiers.map((t) => t.id)) + 1;
            data.tiers.push({ id, label: "New category" });
            rerender();
          } }, "+ Add category"),
        ),
        el("p", { class: "layout-help" },
          "Each category is a filter toggle above the work grid, in this order. " +
          "Categories with no published posts are hidden on the site."),
      ),
    ];
  }

  /* ---------- Background editor ---------- */

  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return [f(0), f(8), f(4)];
  }
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (h, s, l) => (luminance(PAPER_WHITE) + 0.05) / (luminance(hslToRgb(h, s, l)) + 0.05);
  // "Max light": the lightest shade of this hue that keeps the white type
  // readable (WCAG AA, 4.5:1).
  function maxLight(h, s) {
    let l = MIN_LIGHT;
    while (l < 60 && contrast(h, s, l + 1) >= 4.5) l++;
    return l;
  }

  function sitePane() {
    const s = data.site;
    const hsl = (h, sat, l) => `hsl(${h} ${sat}% ${l}%)`;
    const preview = el("div", { class: "bg-preview" },
      el("span", { class: "bg-preview__name" }, "Katie Zhao"),
      el("span", { class: "bg-preview__text" }, "Interaction designer, usually on games."));
    const readout = el("code", {});

    const slider = (key, min, max) => el("input", {
      type: "range", class: "bg-slider", min: String(min), max: String(max), value: String(s[key]),
      oninput: (e) => { s[key] = Number(e.target.value); update(); setDirty(); },
    });
    const hue = slider("hue", 0, 359);
    const sat = slider("sat", 0, 100);
    const light = slider("light", MIN_LIGHT, maxLight(s.hue, s.sat));
    const setLight = (l) => { s.light = l; update(); setDirty(); };
    const darkBtn = el("button", { class: "btn btn--sm", type: "button", onclick: () => setLight(MIN_LIGHT) }, "Max dark");
    const lightBtn = el("button", { class: "btn btn--sm", type: "button", onclick: () => setLight(maxLight(s.hue, s.sat)) }, "Max light");

    function update() {
      const max = maxLight(s.hue, s.sat);
      s.light = Math.min(Math.max(s.light, MIN_LIGHT), max);
      light.max = String(max);
      light.value = String(s.light);
      darkBtn.disabled = s.light === MIN_LIGHT;
      lightBtn.disabled = s.light === max;
      // The scanned paper, tinted as on the site (sunprint.css --tint)
      const c = hsl(s.hue, s.sat, s.light);
      preview.style.background = `linear-gradient(${c}, ${c}), url("/media/paper-tile.webp") 0 0 / 800px 800px, ${c}`;
      preview.style.backgroundBlendMode = "color, normal";
      hue.style.background = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => hsl(h, Math.max(s.sat, 40), 45)).join(", ")})`;
      sat.style.background = `linear-gradient(to right, ${hsl(s.hue, 0, s.light)}, ${hsl(s.hue, 100, s.light)})`;
      light.style.background = `linear-gradient(to right, ${hsl(s.hue, s.sat, MIN_LIGHT)}, ${hsl(s.hue, s.sat, max)})`;
      readout.textContent = `${hsl(s.hue, s.sat, s.light)} · text contrast ${contrast(s.hue, s.sat, s.light).toFixed(1)}:1`;
    }
    update();

    return [
      el("div", { class: "pane__title" }, el("h2", {}, "Background")),
      el("section", { class: "card" },
        el("h3", {}, "Paper colour"),
        preview,
        el("div", { class: "bg-controls" },
          field("Hue", hue),
          field("Saturation", sat),
          field("Shade", light, "Lighter shades stop where the white text would get hard to read"),
        ),
        el("div", { class: "media-actions" },
          darkBtn,
          lightBtn,
          el("button", { class: "btn btn--sm btn--ghost", type: "button", onclick: () => {
            Object.assign(s, SITE_DEFAULT);
            hue.value = String(s.hue);
            sat.value = String(s.sat);
            update();
            setDirty();
          } }, "Reset"),
          readout,
        ),
        el("p", { class: "layout-help" },
          "The cyanotype paper behind every page. The paper texture is laid over it on the site."),
      ),
      headingCard(s),
    ];
  }

  // One colour for every section heading in the posts; unset, they match the body text.
  function headingCard(s) {
    const sample = el("span", { class: "bg-preview__name" }, "Witchy Fishing");
    const show = () => { sample.style.color = s.heading || ""; reset.disabled = !s.heading; };
    const picker = el("input", {
      class: "color-input",
      type: "color",
      title: "Heading colour",
      value: s.heading || HEADING_DEFAULT,
      oninput: (e) => { s.heading = e.target.value; show(); setDirty(); },
    });
    const reset = el("button", { class: "btn btn--sm btn--ghost", type: "button", onclick: () => {
      delete s.heading;
      picker.value = HEADING_DEFAULT;
      show();
      setDirty();
    } }, "Default");
    // Shown on the paper as it is now, so the colour can be judged against it
    const c = `hsl(${s.hue} ${s.sat}% ${s.light}%)`;
    const preview = el("div", { class: "bg-preview" }, sample);
    preview.style.background = `linear-gradient(${c}, ${c}), url("/media/paper-tile.webp") 0 0 / 800px 800px, ${c}`;
    preview.style.backgroundBlendMode = "color, normal";
    show();
    return el("section", { class: "card" },
      el("h3", {}, "Heading colour"),
      preview,
      el("div", { class: "media-actions" }, picker, reset),
      el("p", { class: "layout-help" }, "Section headings in every post. Default matches the body text."),
    );
  }

  /* ---------- About page editor ---------- */

  function aboutPane() {
    const a = data.about;
    const restructure = () => { setDirty(); renderPane(); };
    const links = el("div", { class: "info-list" },
      a.links.map((d, i) => el("div", { class: "info-row" },
        textInput(d, "label", { placeholder: "Name, e.g. LinkedIn" }),
        textInput(d, "url", { type: "url", placeholder: "https://…" }),
        el("button", { class: "icon-btn", type: "button", title: "Move up", disabled: i === 0, onclick: () => { move(a.links, i, i - 1); restructure(); } }, "↑"),
        el("button", { class: "icon-btn", type: "button", title: "Remove", onclick: () => { a.links.splice(i, 1); restructure(); } }, "✕"),
      )),
      el("div", { class: "media-actions" },
        el("button", { class: "btn btn--sm", type: "button", onclick: () => {
          a.links.push({ label: "", url: "" });
          restructure();
          requestAnimationFrame(() => [...pane.querySelectorAll(".info-row .input")].at(-2)?.focus());
        } }, "+ Add link"),
      ),
    );

    return [
      el("div", { class: "pane__title" }, el("h2", {}, "About page")),
      el("section", { class: "card" },
        el("div", { class: "grid" },
          el("div", { class: "span-2" }, field("Heading", textInput(a, "title", { placeholder: "No heading" }),
            "Optional. Leave blank to hide the heading")),
          el("div", { class: "span-2" }, field("Bio", textInput(a, "bio", { rows: 8, placeholder: "Write here. Leave a blank line between paragraphs. **bold**, *italic*" }),
            "Start lines with “- ” for a bullet list. Extra blank lines add space")),
        ),
      ),
      el("section", { class: "card" },
        el("h3", {}, "Photo"),
        el("div", { class: "grid" },
          field("Image", mediaDrop({
            value: a.photo,
            accept: "image",
            empty: "Drop a photo here, or click to choose",
            onChange: (path) => { a.photo = path; restructure(); },
          }), "Shown on the right of the page. Leave empty for a placeholder frame"),
          field("Description", textInput(a, "photoAlt", { placeholder: "Katie Zhao" }),
            "For screen readers: what the photo shows"),
        ),
      ),
      el("section", { class: "card" },
        el("h3", {}, "Links"),
        el("p", { class: "layout-help", style: "margin: -6px 0 12px" },
          `Shown under the bio. These names get an icon: ${ABOUT_ICONS}. Anything else shows as its name.`),
        links,
      ),
    ];
  }

  /* ---------- Views ---------- */

  function renderPane() {
    if (view?.post) pane.replaceChildren(...postPane(view.post));
    else if (view?.about) pane.replaceChildren(...aboutPane());
    else if (view?.categories) pane.replaceChildren(...categoriesPane());
    else if (view?.site) pane.replaceChildren(...sitePane());
    else pane.replaceChildren(el("div", { class: "empty" },
      el("h2", {}, "Pick a post to edit"),
      el("p", {}, "Or create a new one. Drag posts in the sidebar to change their order on the site."),
    ));
  }

  function select(next) {
    view = next;
    const hash = next?.post ? `#post=${next.post.slug}` : next?.about ? "#about" : next?.categories ? "#categories" : next?.site ? "#background" : "";
    history.replaceState(null, "", location.pathname + hash);
    renderTree();
    renderPane();
    window.scrollTo(0, 0);
  }

  $("new-post").addEventListener("click", () => {
    const tier = view?.post?.tier ?? data.tiers[0]?.id;
    const post = {
      tier,
      slug: uniqueSlug("new-post"),
      title: "",
      date: "",
      hue: Math.floor(Math.random() * 360),
      image: null,
      video: null,
      draft: true,
      body: [{ type: "text", text: "" }],
    };
    freshSlugs.add(post);
    data.posts.push(post);
    setDirty();
    select({ post });
    pane.querySelector(".input--title")?.focus();
  });

  $("edit-about").addEventListener("click", () => select({ about: true }));
  $("edit-categories").addEventListener("click", () => select({ categories: true }));
  $("edit-background").addEventListener("click", () => select({ site: true }));
  saveBtn.addEventListener("click", save);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (dirty) save();
    }
  });
  addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
  // Stop stray file drops from navigating away from the editor.
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => e.preventDefault());

  /* ---------- Init ---------- */

  load().then(() => {
    setDirty(false);
    const m = location.hash.match(/^#post=([\w-]+)/);
    const post = m && data.posts.find((p) => p.slug === m[1]);
    select(post ? { post }
      : location.hash === "#about" ? { about: true }
      : location.hash === "#categories" ? { categories: true }
      : location.hash === "#background" ? { site: true }
      : null);
  }).catch((err) => {
    status.textContent = "Couldn't load";
    pane.replaceChildren(el("div", { class: "empty" },
      el("h2", {}, "Editor server not running"),
      el("p", {}, `${err.message}. Start it with: python admin/server.py`),
    ));
  });
})();
