// electron scripts/test-engine.cjs <clip slug> --channel <your channel> [--edit] [--theme clean]: makes a Short in a throwaway data folder (the model
// from dev-models is linked in, not downloaded), then optionally rebuilds it with effects from the editor.
const { app } = require("electron");
const fs = require("fs"), path = require("path"), os = require("os");
const ROOT = path.join(__dirname, "..");
const DATA = path.join(os.tmpdir(), "shorts-studio-test");
app.setPath("userData", DATA);
const argv = process.argv.slice(2), opt = (k) => argv.includes(k) ? argv[argv.indexOf(k) + 1] : null;
const slug = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")), channel = opt("--channel");
if (!slug || !channel) { console.error("usage: electron scripts/test-engine.cjs <clip slug> --channel <channel> [--edit] [--theme clean]"); process.exit(1); }
const themeArg = opt("--theme") || "casefile";
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(path.join(DATA, "models"), { recursive: true });
    const model = path.join(DATA, "models", "ggml-base.bin");
    if (!fs.existsSync(model)) fs.linkSync(path.join(ROOT, "dev-models", "ggml-base.bin"), model);
    const S = require("../engine/store.cjs"), M = require("../engine/make.cjs");
    S.saveSettings({ channel, theme: themeArg, outDir: path.join(DATA, "videos"), firstRun: false, layout: "stage" });
    S.events.on("change", (it) => it.step && console.log("  ", it.id.slice(0, 24), it.status, it.step));
    const t0 = Date.now();
    const id = await M.makeShort(slug);
    const it = S.get(id);
    console.log("MADE", id, it.status, it.seconds + "s", "notes", it.chatNotes, "chat", it.chatFrom, `${((Date.now() - t0) / 1000).toFixed(0)}s`, it.file);
    if (argv.includes("--edit")) {
      const d = M.editData(id), SND = path.join(ROOT, "resources", "sounds");
      S.saveEdits(id, { v: 2, layout: "stage", title: "Edited in the app", speeds: [{ a: 2, b: 4, speed: 0.5 }], freezes: [{ t: 6, d: 1 }],
        zooms: [{ t: 0.5, e: 2.5, z: 1.5, fx: 0.3, fy: 0.4 }], sfx: [{ file: path.join(SND, "sfx", "boom.wav"), t: 1 }], music: { file: path.join(SND, "music", "noir-drone.mp3") },
        stickers: [{ kind: "emoji", emoji: "😱", t: 0.5, e: 3, x: 760, y: 560, size: 180 }, { kind: "stamp", text: "EVIDENCE", t: 7, e: 10, x: 540, y: 1000, size: 360, rot: -8 }],
        cap: { style: "punch" }, words: d.words.map((w, i) => i === 1 ? { ...w, bleep: true } : w), texts: [{ text: "WAIT FOR IT", t: 6, e: 6.1, y: 900, size: 90, color: "#ffffff", box: true }] });
      const t1 = Date.now();
      await M.editShort(id);
      const e = S.get(id);
      console.log("EDITED", e.status, e.seconds + "s", e.error || "", `${((Date.now() - t1) / 1000).toFixed(0)}s`);
    }
  } catch (e) { console.error("FAILED", e.stack || e.message); }
  app.quit();
});
