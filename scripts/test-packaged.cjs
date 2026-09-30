// Tests the built app (dist\win-unpacked) for real: starts it off-screen with a debugging port, makes a Short from one
// of the channel's clips through window.studio, opens the editor, saves screenshots. Runs on Electron's Node (22):
//   node scripts/run-electron-node.cjs scripts/test-packaged.cjs <shots dir> [--data <dir>] [--slug <clip slug>]
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os");
const argv = process.argv.slice(2);
const opt = (k) => argv.includes(k) ? argv[argv.indexOf(k) + 1] : null;
const SHOTS = path.resolve(argv[0] && !argv[0].startsWith("--") ? argv[0] : path.join(os.tmpdir(), "shorts-packaged"));
const DATA = opt("--data") || path.join(os.tmpdir(), "shorts-studio-test");
const EXE = path.join(__dirname, "..", "dist", "win-unpacked", "Shorts Studio.exe");
const PORT = 9333;
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = { ...process.env, SHORTS_STUDIO_DATA: DATA, SHORTS_STUDIO_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, "--disable-features=CalculateNativeWinOcclusion"], { env, stdio: "ignore" });

async function targets() { try { return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch (e) { return []; } }
async function page(match) {
  for (let i = 0; i < 60; i++) { const t = (await targets()).find((x) => x.type === "page" && match.test(x.url)); if (t) return connect(t); await sleep(500); }
  throw new Error("no page " + match);
}
function connect(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl); let n = 0; const wait = new Map(), errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { const w = wait.get(d.id); wait.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value || a.description).join(" "));
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push(d.params.entry.text + " " + (d.params.entry.url || ""));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++n; wait.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const api = {
    errors, url: t.url,
    eval: async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text); return r.result.value; },
    shot: async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.data, "base64")); console.log("shot", name); },
    close: () => ws.close(),
  };
  return new Promise((res) => { ws.onopen = async () => { await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable"); res(api); }; });
}

(async () => {
  let code = 0;
  try {
    const main = await page(/index\.html/);
    await sleep(2500);
    console.log("version", await main.eval("studio.version()"), "| packaged paths ok:", await main.eval("studio.library().then((l) => l.sfx.length + ' sfx, ' + l.music.length + ' music')"));
    await main.shot("p01-main");
    const st = await main.eval("studio.settings()");
    let slug = opt("--slug");
    if (!slug) {
      const made = new Set((await main.eval("studio.shorts()")).map((s) => s.slug));
      const clips = await main.eval(`studio.clips(${JSON.stringify(st.channel)}, "week")`);
      const pick = clips.filter((c) => !made.has(c.slug) && c.duration <= 35).sort((a, b) => a.duration - b.duration)[0];
      if (!pick) throw new Error("no unmade clip this week");
      slug = pick.slug; console.log("making", pick.title, pick.duration + "s");
    }
    const [id] = await main.eval(`studio.make(["https://clips.twitch.tv/${slug}"])`);
    const t0 = Date.now(); let it = null;
    while (Date.now() - t0 < 240000) {
      it = (await main.eval("studio.shorts()")).find((s) => s.id === id);
      if (it && (it.status === "ready" || it.status === "failed")) break;
      await sleep(1500);
    }
    console.log("MADE", it && it.status, it && it.seconds + "s", it && it.error || "", `${((Date.now() - t0) / 1000).toFixed(0)}s`, "notes", it && it.chatNotes, it && it.chatFrom);
    await main.shot("p02-made");
    if (it && it.status === "ready") {
      await main.eval(`studio.openEditor(${JSON.stringify(id)})`);
      const ed = await page(/editor\.html/);
      await sleep(4000);
      await ed.shot("p03-editor");
      await ed.eval(`document.querySelector('#itabs [data-t=sound]').click()`); await sleep(800);
      await ed.shot("p04-editor-sound");
      console.log("editor:", await ed.eval(`document.querySelector("#name").textContent + " | " + document.querySelector("#outlen").textContent`));
      if (ed.errors.length) console.log("EDITOR ERRORS:\n  " + ed.errors.join("\n  "));
      ed.close();
    } else code = 1;
    if (main.errors.length) console.log("MAIN ERRORS:\n  " + main.errors.join("\n  "));
    // closing the main window must end the app (the hidden window that drew the cards is still there)
    const gone = new Promise((r) => child.once("exit", () => r(true)));
    main.eval("setTimeout(() => window.close(), 50), 1").catch(() => {});
    const quit = await Promise.race([gone, sleep(10000).then(() => false)]);
    console.log(quit ? "QUIT OK: the app ended when its window closed" : "STILL RUNNING 10 s after the window closed");
    if (!quit) code = 1;
    main.close();
  } catch (e) { console.error("TEST FAILED", e.stack || e.message); code = 1; }
  child.kill();
  process.exit(code);
})();
