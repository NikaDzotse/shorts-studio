// electron scripts/test-frame.cjs: loads a theme frame with a query, to find why it fails
const { app, BrowserWindow } = require("electron");
const path = require("path");
app.whenReady().then(async () => {
  const file = path.join(__dirname, "..", "themes", "casefile", "frame.html");
  for (const [label, opts, query] of [["sub x", { offscreen: true }, { title: "Hello", sub: "x" }], ["foo empty", { offscreen: true }, { title: "Hello", foo: "" }], ["empty first", { offscreen: true }, { foo: "", title: "Hello" }], ["not offscreen empty", {}, { title: "Hello", foo: "" }]]) {
    const win = new BrowserWindow({ show: false, width: 1080, height: 1920, transparent: true, frame: false, webPreferences: { ...opts, sandbox: true } });
    win.webContents.on("did-fail-load", (e, code, desc, url) => console.log("  did-fail-load", code, desc, url.slice(0, 80)));
    win.webContents.on("console-message", (e) => console.log("  console:", e.message || e));
    try { await win.loadURL(require("url").pathToFileURL(file).href + "?" + new URLSearchParams(query)); console.log(label, "OK", await win.webContents.executeJavaScript("location.search.slice(0,60)")); }
    catch (e) { console.log(label, "FAILED", e.message.slice(0, 60)); }
    win.destroy();
  }
  app.quit();
});
