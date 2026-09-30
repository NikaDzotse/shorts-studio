// Drives the real app with its windows hidden and saves screenshots:
//   electron scripts/test-ui.cjs <shots dir> [--fresh] [--save] [--data <dir>]
// --fresh: an empty data folder (the welcome screen). --save: presses Save & rebuild in the editor and waits for it.
// Without --data it uses the engine test's folder (%TEMP%\shorts-studio-test), which has Shorts in it.
const fs = require("fs"), path = require("path"), os = require("os");
const argv = process.argv.slice(2);
const SHOTS = path.resolve(argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--data") || path.join(os.tmpdir(), "shorts-ui"));
const DATA = argv.includes("--data") ? argv[argv.indexOf("--data") + 1] : argv.includes("--fresh") ? path.join(os.tmpdir(), "shorts-studio-fresh-" + Date.now()) : path.join(os.tmpdir(), "shorts-studio-test");
process.env.SHORTS_STUDIO_DATA = DATA;
process.env.SHORTS_STUDIO_HIDDEN = "1";
fs.mkdirSync(SHOTS, { recursive: true });
const { app, BrowserWindow } = require("electron");
// Windows stops painting windows it thinks nobody can see (ours are off the screen)
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
require("../main.cjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
function watch(w, name) {
  w.webContents.on("console-message", (e, level, message, line, src) => {
    const lv = e.level != null ? e.level : level, msg = e.message != null ? e.message : message;
    if (lv === "error" || lv === "warning" || lv >= 2) problems.push(`[${name}] ${msg} (${(e.sourceId || src || "").split("/").pop()}:${e.lineNumber || line})`);
  });
  w.webContents.on("render-process-gone", (e, d) => problems.push(`[${name}] renderer gone: ${d.reason}`));
}
async function shot(w, name) {
  const img = await w.webContents.capturePage(undefined, { stayHidden: true });
  fs.writeFileSync(path.join(SHOTS, name + ".png"), img.toPNG());
  console.log("shot", name, img.getSize());
}
const js = (w, code) => w.webContents.executeJavaScript(code, true);
async function until(fn, ms = 20000, every = 300) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(every); } return null; }

let nth = 0;
app.on("browser-window-created", (e, w) => watch(w, nth++ ? "editor" : "main"));
app.whenReady().then(async () => {
  try {
    const main = await until(() => BrowserWindow.getAllWindows()[0]);
    await until(() => !main.webContents.isLoading());
    await sleep(2500);
    await shot(main, "01-main");
    console.log("thumbs:", await js(main, `[...document.querySelectorAll(".clip .th")].slice(0, 2).map((t) => t.style.backgroundImage.slice(0, 120)).join(" | ")`));
    const welcome = await js(main, `!document.querySelector("#welcome").hidden`);
    if (welcome) {
      await sleep(1500);
      await shot(main, "02-welcome");
      console.log("welcome text:", (await js(main, `document.querySelector("#welcome").innerText`)).replace(/\s+/g, " ").slice(0, 400));
    } else {
      console.log("main text:", (await js(main, `document.body.innerText`)).replace(/\s+/g, " ").slice(0, 600));
      await js(main, `document.querySelector("#open-settings").click()`); await sleep(1200);
      await shot(main, "02-settings");
      await js(main, `document.querySelector("[data-close=settings]").click()`); await sleep(300);
      const list = await js(main, `studio.shorts()`);
      const it = list.find((s) => s.status === "ready" && s.kind !== "week");
      if (it) {
        // the upload helper
        const up = await js(main, `(() => { const b = [...document.querySelectorAll(".short button")].find((b) => /Upload/.test(b.textContent)); if (b) b.click(); return !!b; })()`);
        if (up) { await sleep(700); await shot(main, "03-upload"); await js(main, `document.querySelector("[data-close=upload]").click()`); }
        // the editor
        await js(main, `studio.openEditor(${JSON.stringify(it.id)})`);
        const ed = await until(() => BrowserWindow.getAllWindows().find((w) => w !== main && /editor\.html/.test(w.webContents.getURL())));
        await until(() => !ed.webContents.isLoading());
        await sleep(3500);
        console.log("editor dom:", await js(ed, `JSON.stringify({ name: document.querySelector("#name").textContent, pane: document.querySelector("#ipane").children.length, vis: document.visibilityState, w: innerWidth, h: innerHeight, wave: document.querySelector("#wave").children.length })`));
        await shot(ed, "10-editor-look");
        for (const [i, t] of ["title", "captions", "chat", "text", "stickers", "fx", "sound", "post"].entries()) {
          await js(ed, `document.querySelector('#itabs [data-t=${t}]').click()`); await sleep(1200);
          console.log("  tab", t, await js(ed, `document.querySelector("#itabs .active").dataset.t + ": " + document.querySelector("#ipane").innerText.replace(/\s+/g, " ").slice(0, 140)`));
          await shot(ed, `${11 + i}-editor-${t}`);
        }
        console.log("editor status:", await js(ed, `document.querySelector("#status").textContent + " | " + document.querySelector("#outlen").textContent`));
        if (argv.includes("--save")) {
          await js(ed, `document.querySelector("#save").click()`);
          const t0 = Date.now();
          const end = await until(async () => { const s = await js(ed, `document.querySelector("#status").textContent`); return /Rebuilt|failed|Not saved/.test(s) ? s : null; }, 180000, 1000);
          console.log("save:", end, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
          await shot(ed, "20-editor-saved");
        }
        ed.destroy();
      } else console.log("no ready Short to edit");
    }
  } catch (e) { problems.push("harness: " + (e.stack || e.message)); }
  console.log(problems.length ? "PROBLEMS:\n  " + problems.join("\n  ") : "no console errors");
  app.exit(0);
});
