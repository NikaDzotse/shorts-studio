// Offline integration test: real Electron windows and FFmpeg, generated media, isolated settings.
// Run: electron scripts/test-presets.cjs
const fs = require("fs"), path = require("path"), os = require("os"), assert = require("assert/strict");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-presets-"));
process.env.SHORTS_STUDIO_DATA = DATA;
process.env.SHORTS_STUDIO_HIDDEN = "1";
const { app, BrowserWindow } = require("electron");
app.setPath("userData", DATA);
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const P = require("../engine/paths.cjs"), S = require("../engine/store.cjs"), Presets = require("../engine/presets.cjs");
const Run = require("../engine/run.cjs"), Wh = require("../engine/whisper.cjs"), T = require("../engine/twitch.cjs");
const run = Run.run, source = path.join(DATA, "source.mp4");
Run.run = (cmd, args, options) => cmd === P.YTDLP ? (fs.copyFileSync(source, path.join(options.cwd, "clip.mp4")), Promise.resolve("")) : run(cmd, args, options);
Wh.hasModel = () => true;
Wh.words = async () => [{ w: "Keep", s: 0.3, e: 0.7 }, { w: "my", s: 0.8, e: 1.0 }, { w: "words", s: 1.1, e: 1.6 }];
const clips = ["PresetFixtureOne", "PresetFixtureTwo"].map((slug, i) => ({ slug, title: `Clip ${i + 1}`, createdAt: `2026-09-30T12:0${i}:00Z`, views: 10,
  duration: 3, by: `Viewer ${i + 1}`, channel: "fixture", url: `https://clips.twitch.tv/${slug}`, videoId: null, videoOffset: null }));
T.clip = async (slug) => clips.find((c) => c.slug === slug);
T.channelClips = async () => clips;
S.saveSettings({ firstRun: false, channel: "fixture", theme: "casefile", outDir: path.join(DATA, "videos"), trim: { enabled: false } });
const errors = [];
app.on("browser-window-created", (_, w) => {
  w.webContents.on("console-message", (e) => { if (e.level === "error") errors.push(e.message); });
  w.webContents.on("render-process-gone", (_, d) => errors.push(d.reason));
});
require("../main.cjs");
const M = require("../engine/make.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 30000) { const start = Date.now(); while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error("Timed out waiting for test state"); }
const js = (w, code) => w.webContents.executeJavaScript(code, true);
const click = (w, selector) => js(w, `document.querySelector(${JSON.stringify(selector)}).click()`);
async function value(w, selector, text) { return js(w, `{ const n = document.querySelector(${JSON.stringify(selector)}); n.value = ${JSON.stringify(text)}; n.dispatchEvent(new Event('input', {bubbles:true})); n.dispatchEvent(new Event('change', {bubbles:true})); }`); }
async function screenshot(w, file) { fs.writeFileSync(path.join(DATA, file), (await w.webContents.capturePage(undefined, { stayHidden: true })).toPNG()); }
app.whenReady().then(async () => {
  try {
    await run(P.FFMPEG, ["-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
    const main = await until(() => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("index.html")));
    await until(() => js(main, "document.querySelectorAll('.clip').length === 2"));
    const id = await M.makeShort(clips[0].slug);
    await js(main, `studio.openEditor(${JSON.stringify(id)})`);
    const ed = await until(() => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("editor.html")));
    await until(() => js(ed, "!!document.querySelector('#preset-name')"));
    // Saving through the real UI; no export is needed to save a preset.
    await value(ed, "#preset-name", "Gaming"); await click(ed, "#save-preset");
    await until(() => Presets.list().length === 1);
    const first = Presets.list()[0];
    assert.equal(first.name, "Gaming"); assert.ok(!("words" in first.style));
    assert.ok(!("date" in first.style.frame)); assert.ok(!("byline" in first.style.frame));
    assert.throws(() => Presets.save({ name: "gaming", edits: first.style }), /already used/);
    assert.throws(() => Presets.save({ name: " ", edits: first.style }), /name/);
    assert.throws(() => Presets.save({ name: "Broken", edits: { ...first.style, appearance: { theme: "../outside" } } }), /theme/);
    assert.equal(Presets.list().length, 1);
    // A different saved look, including music, must not import clip-specific content or music end times.
    const music = path.join(P.SOUNDS, "music", fs.readdirSync(path.join(P.SOUNDS, "music")).find((f) => /\.(wav|mp3)$/i.test(f)));
    const custom = { ...first.style, appearance: { theme: "clean", accent: "#22cc88" }, layout: "split", geo: { faceH: 600 },
      crops: { face: { x: 100, y: 100, w: 720, h: 400 }, game: { x: 600, y: 0, w: 1080, h: 900 } },
      cap: { ...first.style.cap, style: "box", size: 54, bottom: 1200 }, volume: -3,
      frame: { ...first.style.frame, headY: 260, footY: 1380, kicker: "MY SHOW", chan: "twitch.tv/fixture", stamp: "NICE", date: "WRONG DATE", byline: "WRONG VIEWER", sub: "WRONG SUBTITLE" },
      music: { file: music, vol: -8, duck: true, offset: 0, t: 1, e: 2 }, title: "WRONG TITLE", words: [{ w: "WRONG" }], segs: [[0, 0.5]], upload: { title: "WRONG POST" } };
    const second = await js(main, `studio.savePreset(${JSON.stringify({ name: "Just Chatting", edits: custom })})`);
    for (const key of ["title", "words", "segs", "upload"]) assert.ok(!(key in second.style));
    assert.ok(!("t" in second.style.music)); assert.ok(!("e" in second.style.music));
    const savedFile = JSON.parse(fs.readFileSync(path.join(DATA, "presets.json")));
    assert.equal(savedFile.length, 2);
    await until(() => js(ed, "document.querySelector('#editor-preset').options.length === 3"));
    await value(ed, "#editor-preset", second.id); await click(ed, "#apply-preset");
    await until(() => js(ed, "document.querySelector('.l-split').classList.contains('on')"));
    await until(() => js(ed, "document.querySelector('#pv-frame').src.includes('/clean/')"));
    assert.equal(await js(ed, "document.querySelector('#name').textContent"), "Clip 1");
    await click(ed, "#undo");
    assert.equal(await js(ed, "document.querySelector('.l-letterbox').classList.contains('on')"), true);
    await click(ed, "#redo");
    assert.equal(await js(ed, "document.querySelector('.l-split').classList.contains('on')"), true);
    await click(ed, "#save");
    await until(() => js(ed, "/Rebuilt|failed/.test(document.querySelector('#status').textContent)"), 120000);
    assert.match(await js(ed, "document.querySelector('#status').textContent"), /Rebuilt/);
    const data = M.editData(id);
    assert.equal(data.theme, "clean"); assert.equal(data.accent, "#22cc88"); assert.equal(data.layout, "split");
    assert.equal(data.words[0].w, "Keep"); assert.equal(data.frame.byline, "clipped by Viewer 1");
    assert.equal(data.frame.kicker, "MY SHOW"); assert.equal(data.cap.size, 54); assert.equal(data.edits.music.file, music);
    await screenshot(ed, "editor-presets.png");
    // Reopening restores the exact look even when global Settings uses a different theme.
    ed.close();
    await until(() => ed.isDestroyed());
    await js(main, `studio.openEditor(${JSON.stringify(id)})`);
    const reopened = await until(() => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("editor.html")));
    await until(() => js(reopened, "!!document.querySelector('.l-split.on')"));
    // A batch captures the style before jobs queue. Editing/deleting the preset cannot change queued Shorts.
    await value(main, "#batch-preset", second.id);
    await js(main, "document.querySelectorAll('.clip').forEach(n => n.click())");
    await click(main, "#make-selected");
    await until(() => M.busy());
    await js(main, `studio.deletePreset(${JSON.stringify(second.id)})`);
    await until(() => !M.busy(), 180000);
    for (const item of S.list()) {
      assert.equal(item.status, "ready", item.error);
      const d = M.editData(item.id);
      assert.equal(d.theme, "clean"); assert.equal(d.frame.kicker, "MY SHOW");
      assert.equal(d.title, item.title); assert.equal(d.frame.byline, "clipped by " + item.by);
      assert.equal(d.words[0].w, "Keep"); assert.equal(d.edits.music.file, music);
    }
    assert.equal(S.settings().presetId, "");
    await until(() => js(main, "document.querySelector('#batch-preset').value === ''"));
    await screenshot(main, "main-presets.png");
    const missing = Presets.save({ name: "Missing music", edits: { ...first.style, music: { file: path.join(DATA, "missing.wav") } } });
    assert.throws(() => Presets.resolve(missing.id), /music.*missing/);
    const renamed = Presets.save({ id: first.id, name: "Funny reactions", edits: custom });
    assert.equal(Presets.list().filter((p) => p.id === first.id).length, 1); assert.equal(renamed.name, "Funny reactions");
    assert.deepEqual(errors, []);
    console.log("PASS: preset CRUD, content isolation, missing music, live UI, undo/redo, reopen, actual exports and batch snapshots.");
    console.log("Screenshots and isolated data:", DATA);
    app.exit(0);
  } catch (e) { console.error(e.stack); console.error("Test data:", DATA); app.exit(1); }
});
