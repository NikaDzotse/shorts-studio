// Run with Electron's Node: node scripts/run-electron-node.cjs scripts/test-presets-packaged.cjs <data from test-presets>
const fs = require("fs"), path = require("path"), assert = require("assert/strict"), { spawn } = require("child_process");
const DATA = path.resolve(process.argv[2] || "");
if (!path.basename(DATA).startsWith("shorts-presets-") || !fs.existsSync(path.join(DATA, "source.mp4"))) throw new Error("Pass an isolated test-presets data folder.");
const portFile = path.join(DATA, "DevToolsActivePort");
if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
const env = { ...process.env, SHORTS_STUDIO_DATA: DATA, SHORTS_STUDIO_HIDDEN: "1" }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(__dirname, "../dist/win-unpacked/Shorts Studio.exe"), ["--remote-debugging-port=0", "--disable-features=CalculateNativeWinOcclusion"], { env, stdio: "ignore" });
const connections = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 30000) { const at = Date.now(); while (Date.now() - at < timeout) { const v = await fn(); if (v) return v; await sleep(200); } throw new Error("Timed out"); }
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl); connections.push(ws);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const pending = new Map(); let id = 0;
  ws.onmessage = ({ data }) => { const r = JSON.parse(data); const p = pending.get(r.id); if (p) { pending.delete(r.id); r.error ? p.reject(new Error(r.error.message)) : p.resolve(r.result); } };
  const send = (method, params) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  return {
    eval: async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; },
    shot: async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(DATA, file), Buffer.from(r.data, "base64")); },
  };
}
(async () => {
  let code = 1;
  try {
    await until(() => fs.existsSync(portFile));
    const port = fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0];
    const page = async (pattern) => connect(await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === "page" && pattern.test(p.url))));
    const main = await page(/index\.html/);
    assert.equal(await main.eval("studio.version()"), require("../package.json").version);
    await until(() => main.eval("document.querySelector('#batch-preset').options.length > 1"));
    const preset = (await main.eval("studio.presets()")).find((p) => p.name === "Funny reactions");
    assert.ok(preset);
    const id = (await main.eval("studio.shorts()")).find((s) => s.status === "ready").id;
    await main.eval(`studio.openEditor(${JSON.stringify(id)})`);
    const editor = await page(/editor\.html/);
    await until(() => editor.eval("!!document.querySelector('#editor-preset')"));
    await editor.eval(`{const n=document.querySelector('#editor-preset'); n.value=${JSON.stringify(preset.id)}; n.dispatchEvent(new Event('change')); document.querySelector('#apply-preset').click();}`);
    await until(() => editor.eval("document.querySelector('#toast').textContent.includes('Applied')"));
    await editor.eval("document.querySelector('#save').click()");
    await until(() => editor.eval("/Rebuilt|failed/.test(document.querySelector('#status').textContent)"), 120000);
    assert.match(await editor.eval("document.querySelector('#status').textContent"), /Rebuilt/);
    const data = await main.eval(`studio.editData(${JSON.stringify(id)})`);
    assert.equal(data.data.theme, "clean"); assert.equal(data.data.frame.kicker, "MY SHOW"); assert.equal(data.data.words[0].w, "Keep");
    await editor.shot("packaged-presets.png");
    const exited = new Promise((r) => child.once("exit", () => r(true)));
    main.eval("setTimeout(() => window.close(), 50); true").catch(() => {});
    assert.equal(await Promise.race([exited, sleep(15000).then(() => false)]), true, "Packaged app must quit including helper windows");
    console.log("PASS: packaged version, preset persistence, apply, export, preserved words, and clean quit.");
    code = 0;
  } catch (e) { console.error(e.stack); }
  finally { for (const ws of connections) ws.close(); if (child.exitCode == null) child.kill(); process.exit(code); }
})();
