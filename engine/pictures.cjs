"use strict";
// Pictures from web pages (the frame, chat notes, stickers): drawn in a hidden Electron window and saved as PNGs with
// a transparent background, for ffmpeg to lay over the video. One hidden window is kept and reused (a window opened
// right after another one closed fails to load), one picture job at a time.
const fs = require("fs");
const path = require("path");
const { BrowserWindow } = require("electron");
const { pathToFileURL } = require("url");

let win = null, chain = Promise.resolve();
function painter() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({ show: false, width: 1080, height: 1920, useContentSize: true, frame: false, transparent: true, backgroundColor: "#00000000",
    webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(30);
  return win;
}
const settle = (w) => w.webContents.executeJavaScript("document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))");

// runs fn with the page loaded: fn gets { eval(js), shot(rect, file) }
function withPage(file, query, width, height, fn) {
  const job = chain.then(async () => {
    const w = painter();
    w.setContentSize(width, height);
    // the settings go as one JSON parameter: Electron won't load a local page whose URL has an empty parameter
    const keys = Object.keys(query || {});
    await w.loadURL(pathToFileURL(file).href + (keys.length ? "?d=" + encodeURIComponent(JSON.stringify(query)) : ""));
    await settle(w);
    return fn({
      eval: (js) => w.webContents.executeJavaScript(js),
      // a part of the page as a PNG, at exactly rect's size (a high-DPI screen captures bigger: scaled back down)
      shot: async (rect, out) => {
        await settle(w);
        let img = await w.webContents.capturePage(rect);
        const s = img.getSize();
        if (s.width !== rect.width || s.height !== rect.height) img = img.resize({ width: rect.width, height: rect.height, quality: "best" });
        fs.writeFileSync(out, img.toPNG());
      },
    });
  });
  chain = job.catch(() => {});
  return job;
}
// a whole page (the 1080x1920 frame) as one PNG
const screenshot = (file, query, width, height, out) => withPage(file, query, width, height, (p) => p.shot({ x: 0, y: 0, width, height }, out));

// chat messages as notes (the theme's note.html: setNote(spec) returns its box) -> [{ file, w, h }]
async function notes(noteHtml, list, width, outDir) {
  for (const f of fs.readdirSync(outDir)) if (/^note-\d+\.png$/.test(f)) fs.rmSync(path.join(outDir, f));
  if (!list.length) return [];
  return withPage(noteHtml, {}, 1000, 700, async (p) => {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const r = await p.eval(`setNote(${JSON.stringify({ ...list[i], width })})`);
      const file = path.join(outDir, `note-${i}.png`);
      await p.shot({ x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.w, height: r.h }, file);
      out.push({ file, w: r.w, h: r.h });
    }
    return out;
  });
}
// stickers (shared\sticker.html) -> [{ file, w, h }]
async function stickers(stickerHtml, list, outDir) {
  for (const f of fs.readdirSync(outDir)) if (/^sticker-\d+\.png$/.test(f)) fs.rmSync(path.join(outDir, f));
  if (!list.length) return [];
  return withPage(stickerHtml, {}, 1400, 1400, async (p) => {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const r = await p.eval(`setSticker(${JSON.stringify(list[i])})`);
      const file = path.join(outDir, `sticker-${i}.png`);
      await p.shot({ x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.w, height: r.h }, file);
      out.push({ file, w: r.w, h: r.h });
    }
    return out;
  });
}
module.exports = { withPage, screenshot, notes, stickers };
