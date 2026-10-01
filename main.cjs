"use strict";
// Shorts Studio: the app. Opens the main window (your clips and Shorts) and editor windows, and answers them through
// the preload bridge (window.studio). The work happens in engine\.
const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, Menu, screen, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

// tests: SHORTS_STUDIO_DATA uses a throwaway data folder, SHORTS_STUDIO_HIDDEN keeps the windows off the screen
if (process.env.SHORTS_STUDIO_DATA) app.setPath("userData", process.env.SHORTS_STUDIO_DATA);
const HIDDEN = !!process.env.SHORTS_STUDIO_HIDDEN;
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  // opening the app again brings up the main window (never the hidden one that draws cards and notes)
  app.on("second-instance", () => { if (!main) return createMain(); if (main.isMinimized()) main.restore(); main.show(); main.focus(); });
}

const P = require("./engine/paths.cjs");
const S = require("./engine/store.cjs");
const Presets = require("./engine/presets.cjs");
const PUB = require("./engine/publish.cjs");
const POST = require("./engine/posting.cjs");
const M = require("./engine/make.cjs");
const T = require("./engine/twitch.cjs");
const Wh = require("./engine/whisper.cjs");
const LIB = require("./engine/library.cjs");
const OBS = require("./engine/obs.cjs");
const { log, LOG } = require("./engine/run.cjs");

// a Short that was being made when the app last closed (or crashed) will never finish by itself
for (const s of S.list()) if (s.status === "making" || s.status === "queued")
  S.update(s.id, { status: "failed", step: "", error: "Shorts Studio closed before this was finished. Press ↻ Remake." });

let main = null;
const editors = new Map();
const PRELOAD = path.join(__dirname, "preload.cjs");
const ICON = path.join(__dirname, "build", "icon.png");
const webPreferences = { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true };

function createMain() {
  main = new BrowserWindow({ width: 1320, height: 880, minWidth: 900, minHeight: 620, backgroundColor: "#0d0e11", title: "Shorts Studio", icon: fs.existsSync(ICON) ? ICON : undefined, webPreferences, show: false });
  main.once("ready-to-show", () => reveal(main));
  main.loadFile(path.join(__dirname, "ui", "index.html"));
  main.on("close", (e) => {
    if (!M.busy() || app.__asked) return;
    const r = dialog.showMessageBoxSync(main, { type: "question", buttons: ["Quit anyway", "Keep working"], defaultId: 1, cancelId: 1, message: "A Short is still being made", detail: "Quitting stops it. You can make it again later." });
    if (r === 1) e.preventDefault(); else app.__asked = true;
  });
  main.on("closed", () => { main = null; for (const w of editors.values()) if (!w.isDestroyed()) w.close(); quitIfNothingOpen(); });
  guard(main);
}
function openEditor(id) {
  const open = editors.get(id);
  if (open && !open.isDestroyed()) { open.focus(); return; }
  const area = screen.getPrimaryDisplay().workAreaSize;
  const w = new BrowserWindow({ width: Math.min(1680, area.width), height: Math.min(1000, area.height), minWidth: 1100, minHeight: 700, backgroundColor: "#0d0e11",
    title: "Edit", icon: fs.existsSync(ICON) ? ICON : undefined, webPreferences, show: false });
  w.once("ready-to-show", () => reveal(w));
  w.loadFile(path.join(__dirname, "ui", "editor.html"), { query: { id } });
  w.on("closed", () => { editors.delete(id); quitIfNothingOpen(); });
  // the editor says "not yet" while it has unsaved changes; Electron shows nothing by itself, so ask here
  w.webContents.on("will-prevent-unload", (e) => {
    const r = dialog.showMessageBoxSync(w, { type: "question", buttons: ["Close without saving", "Keep editing"], defaultId: 1, cancelId: 1, message: "You have changes that aren't saved", detail: "Save & rebuild keeps them." });
    if (r === 0) { dropDraft(id); e.preventDefault(); }   // closing without saving: nothing to offer next time
  });
  editors.set(id, w);
  guard(w);
}
// The app ends when its own windows are gone. The hidden window that draws cards and notes doesn't count, so
// Electron's "window-all-closed" would never come and the app would stay running with nothing on screen.
function quitIfNothingOpen() {
  if (main && !main.isDestroyed()) return;
  for (const w of editors.values()) if (!w.isDestroyed()) return;
  app.quit();
}
const draftFile = (id) => path.join(P.DATA, "drafts", String(id).replace(/[^A-Za-z0-9_-]/g, "_") + ".json");
function dropDraft(id) { try { fs.unlinkSync(draftFile(id)); } catch (e) { /* there was none */ } }
// tests: shown (so it paints) but off the screen, see-through, click-through and not on the taskbar
function reveal(w) {
  if (!HIDDEN) return w.show();
  w.setSkipTaskbar(true); w.setIgnoreMouseEvents(true); w.setOpacity(0); w.setFocusable(false); w.setPosition(-20000, -20000); w.showInactive();
}
// links open in the browser, never inside the app
function guard(w) {
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  w.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
}
const send = (ch, data) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, data); };
S.events.on("change", (item) => send("studio:shorts", item));
S.events.on("settings", (s) => send("studio:settings", s));

// ---------- what the windows can ask for ----------
const handle = (name, fn) => ipcMain.handle("studio:" + name, async (e, ...args) => {
  try { return { ok: true, value: await fn(...args) }; } catch (err) { log("ipc", name, err.message); return { ok: false, error: err.message }; }
});
handle("settings", () => S.settings());
handle("saveSettings", (patch) => S.saveSettings(patch || {}));
handle("presets", () => Presets.list());
handle("presetStyle", (id) => Presets.resolve(id));
handle("savePreset", (data) => { const p = Presets.save(data); send("studio:presets", Presets.list()); return p; });
handle("deletePreset", (id) => { Presets.remove(id); if (S.settings().presetId === id) S.saveSettings({ presetId: "" }); send("studio:presets", Presets.list()); return true; });
handle("themes", () => fs.readdirSync(P.THEMES).filter((d) => fs.existsSync(path.join(P.THEMES, d, "theme.json")))
  .map((id) => ({ id, ...JSON.parse(fs.readFileSync(path.join(P.THEMES, id, "theme.json"), "utf8")), frame: path.join(P.THEMES, id, "frame.html") })));
handle("clips", (channel, range) => T.channelClips(channel, range));
handle("make", (links, presetId = S.settings().presetId) => {
  const style = Presets.resolve(presetId);
  const ids = [];
  for (const l of links || []) { const slug = T.slugFrom(l); if (!slug) continue; ids.push("c-" + slug.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60)); M.makeShort(slug, style).catch(() => {}); }
  if (!ids.length) throw new Error("No Twitch clip links in there");
  return ids;
});
handle("bestOf", (channel, presetId = S.settings().presetId) => { const style = Presets.resolve(presetId); M.bestOf(channel || S.settings().channel, { style }).catch(() => {}); return true; });
handle("shorts", () => S.list());
handle("editData", (id) => ({ item: S.get(id), data: M.editData(id) }));
handle("saveEdit", (id, edits) => { S.saveEdits(id, edits); dropDraft(id); M.editShort(id).catch(() => {}); return true; });
// an editor's unsaved changes, kept while you work so a crash doesn't lose them
handle("draft", (id) => { try { return JSON.parse(fs.readFileSync(draftFile(id), "utf8")); } catch (e) { return null; } });
handle("saveDraft", (id, state) => { fs.mkdirSync(path.dirname(draftFile(id)), { recursive: true }); fs.writeFileSync(draftFile(id), JSON.stringify({ at: Date.now(), E: String(state) })); return true; });
handle("dropDraft", (id) => { dropDraft(id); return true; });
handle("remake", (id) => { const s = S.get(id); if (!s) throw new Error("No such Short"); if (s.kind === "week") M.bestOf(s.channel, { style: s.presetStyle || {} }).catch(() => {}); else M.makeShort(s.slug, s.presetStyle || {}).catch(() => {}); return true; });
handle("remove", async (id) => {
  const s = S.get(id);
  // into the Recycle Bin, never deleted for good
  if (s) for (const f of [s.file, s.thumb, s.work]) if (f && fs.existsSync(f)) { try { await shell.trashItem(f); } catch (e) { log("trash", e.message); } }
  S.remove(id);
  return true;
});
handle("reveal", (file) => { if (file && fs.existsSync(file)) shell.showItemInFolder(file); return true; });
handle("openFolder", (which) => {
  const dir = which === "videos" ? S.outDir() : which === "log" ? path.dirname(LOG) : path.join(P.LIBRARY, ["sfx", "music", "stickers", "emotes"].includes(which) ? which : "");
  fs.mkdirSync(dir, { recursive: true }); return shell.openPath(dir);
});
const UPLOAD = { youtube: "https://www.youtube.com/upload", tiktok: "https://www.tiktok.com/tiktokstudio/upload", twitch: "https://www.twitch.tv/" };
handle("openUpload", (where) => { if (!UPLOAD[where]) throw new Error("Unknown place"); return shell.openExternal(UPLOAD[where]); });
handle("openLink", (url) => { if (!/^https:\/\/([a-z0-9-]+\.)*(twitch\.tv|youtube\.com|tiktok\.com|github\.com)\//i.test(url)) throw new Error("Not allowed"); return shell.openExternal(url); });
handle("copy", (text) => { clipboard.writeText(String(text || "")); return true; });
handle("openEditor", (id) => { openEditor(id); return true; });
handle("library", () => LIB.index());
handle("model", () => { const s = S.settings(); return { name: s.model, has: Wh.hasModel(s.model), mb: Wh.MODELS[s.model].mb, models: Wh.MODELS }; });
let downloading = null;
handle("downloadModel", (name) => {
  if (downloading) return downloading;
  downloading = Wh.download(name || S.settings().model, (f) => send("studio:model", { name, progress: f }))
    .then(() => { send("studio:model", { name, progress: 1, done: true }); return true; })
    .catch((e) => { send("studio:model", { name, error: e.message }); throw e; })
    .finally(() => { downloading = null; });
  return downloading;
});
handle("obs", () => ({ available: OBS.available(), scenes: OBS.scenes() }));
handle("emotes", () => T.emotes(S.settings().channel));
handle("chooseFolder", async () => { const r = await dialog.showOpenDialog(main, { properties: ["openDirectory", "createDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
handle("version", () => app.getVersion());
handle("busy", () => M.busy());

// ---------- posting to YouTube and TikTok ----------
handle("accounts", () => PUB.status());
handle("connect", (platform) => platform === "youtube" ? PUB.connectYouTube() : platform === "tiktok" ? PUB.connectTikTok() : Promise.reject(new Error("Unknown platform")));
handle("cancelConnect", () => { PUB.cancelSignIn(); return true; });
handle("disconnect", (platform) => PUB.disconnect(platform));
handle("tiktokCreator", () => PUB.tiktokCreator());
handle("post", (id, platform, opts) => POST.start(id, platform, opts || {}));
handle("scheduleTikTok", (id, at, opts) => POST.schedule(id, at, opts || {}));
handle("unscheduleTikTok", (id) => POST.unschedule(id));
// Dragging a finished Short out of the window, straight into an upload page (only the Shorts' own files)
ipcMain.on("studio:drag", (e, id) => {
  const s = S.get(id);
  if (!s || !s.file || !fs.existsSync(s.file)) return;
  let icon = s.thumb && fs.existsSync(s.thumb) ? nativeImage.createFromPath(s.thumb) : nativeImage.createEmpty();
  if (icon.isEmpty() && fs.existsSync(ICON)) icon = nativeImage.createFromPath(ICON);
  if (!icon.isEmpty()) icon = icon.resize({ height: 96 });
  e.sender.startDrag({ file: s.file, icon });
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createMain();
  POST.startScheduler();
  app.on("activate", () => { if (!main) createMain(); });
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (e) => {
  if (M.busy() && main && !app.__asked) {
    const r = dialog.showMessageBoxSync(main, { type: "question", buttons: ["Quit anyway", "Keep working"], defaultId: 1, message: "A Short is still being made", detail: "Quitting stops it. You can make it again later." });
    if (r === 1) { e.preventDefault(); return; }
    app.__asked = true;
  }
});
