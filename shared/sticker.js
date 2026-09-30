// Draws one sticker for a Short. Shared by sticker.html (which make-short.cjs screenshots into the video) and the big
// editor's preview, so both look the same.
//   makeSticker(spec, toUrl) -> an element `spec.size` px wide (arrows, circles and stamps rotate by spec.rot)
// spec.kind:
//   emoji  { emoji }                       a big colour emoji
//   image  { src }                         a picture file: your channel emotes, or anything in library\stickers
//   arrow  { color }                       a thick hand-drawn-looking arrow pointing right (rotate it)
//   circle { color, ratio }                a ring to circle something (ratio: height / width)
//   stamp  { text, color }                 a rubber stamp, like EVIDENCE
//   label  { text, color }                 a case-file label: text on a paper tag
// toUrl turns a file path into something an <img> can load (file:/// by default).
(function () {
  const fileUrl = (p) => /^(https?:|file:|data:)/.test(p) ? p : "file:///" + String(p).replace(/\\/g, "/").split("/").map((x, i) => i === 0 ? x : encodeURIComponent(x)).join("/");
  const safe = (c, d) => /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : d;
  function makeSticker(s, toUrl) {
    const size = Math.max(20, Math.min(1080, +s.size || 200)), rot = +s.rot || 0, color = safe(s.color, "#ef443b");
    const box = document.createElement("div");
    box.className = "sticker";
    box.style.cssText = `position:relative;display:inline-block;width:${size}px;line-height:0;transform:rotate(${rot}deg);transform-origin:50% 50%;`;
    if (s.kind === "emoji") {
      box.style.lineHeight = "1";
      box.style.width = "auto";
      box.innerHTML = "";
      const e = document.createElement("span");
      e.textContent = s.emoji || "😂";
      e.style.cssText = `display:inline-block;font:${Math.round(size * 0.86)}px/1 "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45));`;
      box.append(e);
    } else if (s.kind === "image") {
      const img = document.createElement("img");
      img.src = (toUrl || fileUrl)(s.src || "");
      img.alt = s.name || "";
      img.style.cssText = `width:${size}px;height:auto;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45));`;
      box.append(img);
    } else if (s.kind === "arrow") {
      box.innerHTML = `<svg viewBox="0 0 200 100" width="${size}" height="${size / 2}" style="overflow:visible;filter:drop-shadow(0 6px 8px rgba(0,0,0,.5))">
        <path d="M6 58 C 50 50, 95 46, 132 44 L 128 18 L 194 50 L 126 86 L 130 62 C 95 64, 52 68, 10 74 Z" fill="${color}" stroke="#111" stroke-width="7" stroke-linejoin="round"/></svg>`;
    } else if (s.kind === "circle") {
      const ratio = Math.max(0.3, Math.min(2, +s.ratio || 0.7)), h = size * ratio, sw = Math.max(6, size * 0.045);
      box.innerHTML = `<svg viewBox="0 0 ${size} ${h}" width="${size}" height="${h}" style="overflow:visible;filter:drop-shadow(0 4px 6px rgba(0,0,0,.5))">
        <path d="M ${size * 0.52} ${sw} C ${size * 0.95} ${sw * 0.6}, ${size - sw} ${h * 0.45}, ${size * 0.9} ${h * 0.75} C ${size * 0.75} ${h - sw}, ${size * 0.2} ${h - sw}, ${sw * 1.5} ${h * 0.65}
          C ${sw * 0.5} ${h * 0.35}, ${size * 0.15} ${sw * 1.2}, ${size * 0.6} ${sw * 1.6}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
    } else if (s.kind === "stamp" || s.kind === "label") {
      const t = document.createElement("div");
      const text = String(s.text || (s.kind === "stamp" ? "EVIDENCE" : "EXHIBIT A")).toUpperCase();
      // the text size follows the width asked for
      const fs = Math.max(14, Math.round(size / Math.max(4, text.length * 0.72)));
      t.textContent = text;
      t.style.cssText = s.kind === "stamp"
        ? `display:inline-block;border:${Math.max(4, fs * 0.16)}px solid ${color};color:${color};padding:${fs * 0.28}px ${fs * 0.5}px ${fs * 0.2}px;border-radius:${fs * 0.22}px;` +
          `font:900 ${fs}px/1 "Courier New",monospace;letter-spacing:.12em;white-space:nowrap;background:rgba(13,14,17,.18);box-shadow:0 0 0 ${Math.max(2, fs * 0.06)}px rgba(0,0,0,.25) inset;`
        : `display:inline-block;background:#e9dfc7;color:#1b1b1b;padding:${fs * 0.4}px ${fs * 0.7}px;border-radius:4px;border-left:${fs * 0.3}px solid ${color};` +
          `font:700 ${fs}px/1 "Courier New",monospace;letter-spacing:.08em;white-space:nowrap;box-shadow:0 8px 16px rgba(0,0,0,.45);`;
      box.style.width = "auto";
      box.style.lineHeight = "1";
      box.append(t);
    }
    return box;
  }
  window.makeSticker = makeSticker;
})();
