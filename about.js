// Fills About.html from window.ABOUT (set in projects.js by the editor).
// Without it, the page keeps the text written in the HTML.
(() => {
  const about = window.ABOUT;
  if (!about) return;

  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // Inline formatting, same rules as main.js: [link text](url), **bold**, *italic* / _italic_, ***both***.
  const INLINE = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*|\*\*(?!\s)(.+?)(?<!\s)\*\*(?!\*)|\*(?!\s)(.+?)(?<!\s)\*|\b_(?!\s)(.+?)(?<!\s)_\b/g;
  // Only web, mail and on-site links; anything else (e.g. "javascript:") stays plain text.
  const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#|\.{0,2}\/?[\w-]+(\.html)?([#?].*)?$)/i;
  function link(label, href) {
    if (/^www\./i.test(href)) href = `https://${href}`;
    const a = h("a");
    a.href = href;
    // Other sites open in a new tab; pages on this site open in place.
    if (/^https?:\/\//i.test(href) && new URL(href).host !== location.host) {
      a.target = "_blank";
      a.rel = "noopener";
    }
    a.append(...inline(label));
    return a;
  }
  function inline(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1] != null) {
        out.push(SAFE_HREF.test(m[2]) || /^www\./i.test(m[2]) ? link(m[1], m[2]) : m[0]);
      } else if (m[3] != null) {
        const b = h("strong");
        b.append(h("em", null, m[3]));
        out.push(b);
      } else if (m[4] != null) {
        const b = h("strong");
        b.append(...inline(m[4]));
        out.push(b);
      } else {
        const i = h("em");
        i.append(...inline(m[5] ?? m[6]));
        out.push(i);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  // Link names with a Flaticon brand icon; anything else shows its name.
  const ICONS = {
    linkedin: "linkedin", instagram: "instagram", artstation: "artstation",
    twitter: "twitter-alt", x: "twitter-alt", github: "github", youtube: "youtube",
    vimeo: "vimeo", behance: "behance", dribbble: "dribbble", discord: "discord", twitch: "twitch",
  };

  // The heading is optional: left blank, it's hidden from view but kept
  // for screen readers as "About".
  const title = document.getElementById("about-title");
  const heading = (about.title || "").trim();
  title.textContent = heading || "About";
  title.classList.toggle("visually-hidden", !heading);
  if (heading) document.title = `${heading} — Katie Zhao`;

  const bio = document.querySelector(".about__bio");
  // One blank line starts a new paragraph; each extra blank line adds a
  // line of space. Lines starting with "- " (or "* ", "• ") become a bullet
  // list, even straight under a line of text.
  const BULLET = /^[-*•]\s+/;
  const out = [];
  let blanks = 0;
  let last = null;
  for (const line of (about.bio || "").trim().split("\n").map((s) => s.trim())) {
    if (!line) { blanks++; last = null; continue; }
    if (blanks > 1) {
      const gap = h("div", "about__gap");
      gap.style.height = `${(blanks - 1) * 1.45}em`;
      out.push(gap);
    }
    blanks = 0;
    const bullet = BULLET.test(line);
    if (!last || (last.tagName === "UL") !== bullet) out.push(last = h(bullet ? "ul" : "p"));
    if (bullet) {
      const li = h("li");
      li.append(...inline(line.replace(BULLET, "")));
      last.append(li);
    } else {
      if (last.childNodes.length) last.append(h("br"));
      last.append(...inline(line));
    }
  }
  bio.replaceChildren(...out);

  // Photo on the right; without one the placeholder frame stays.
  if (about.photo) {
    const img = h("img");
    img.src = about.photo;
    img.alt = about.photoAlt || "Katie Zhao";
    document.getElementById("about-photo").replaceChildren(img);
  }

  const links = document.querySelector(".about__links");
  links.replaceChildren(...(about.links || []).filter((l) => l.url?.trim()).map((l) => {
    const label = (l.label || "").trim();
    const url = l.url.trim();
    const a = h("a");
    a.href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    a.target = "_blank";
    a.rel = "noopener";
    const icon = ICONS[label.toLowerCase()];
    if (icon) {
      a.setAttribute("aria-label", label);
      a.title = label;
      const i = h("i", `fi fi-brands-${icon}`);
      i.setAttribute("aria-hidden", "true");
      a.append(i);
    } else {
      a.className = "about__link--text";
      a.textContent = label || url.replace(/^https?:\/\/(www\.)?/, "");
    }
    return a;
  }));
})();
