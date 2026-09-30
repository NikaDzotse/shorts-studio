// Draws build\icon.png (512x512; electron-builder turns it into the .ico). Run with Electron:
//   node_modules\electron\dist\electron.exe scripts\make-icon.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("fs"), path = require("path");

const HTML = `<!doctype html><html><head><style>
html,body{margin:0;width:512px;height:512px;background:transparent;overflow:hidden}
.tile{position:absolute;left:16px;top:16px;width:480px;height:480px;border-radius:108px;background:linear-gradient(160deg,#23262e,#0d0e11);box-shadow:inset 0 0 0 3px #2e323c}
.card{position:absolute;left:156px;top:64px;width:200px;height:356px;border-radius:30px;background:#ebe5d8;transform:rotate(-7deg)}
.card.back{background:#3a3f4b;transform:rotate(9deg) translate(40px,10px)}
.screen{position:absolute;left:14px;top:14px;right:14px;bottom:14px;border-radius:19px;background:#15171c;overflow:hidden}
.play{position:absolute;left:62px;top:96px;width:0;height:0;border-top:50px solid transparent;border-bottom:50px solid transparent;border-left:82px solid #ef443b}
.bar{position:absolute;left:24px;height:16px;border-radius:8px;background:#ebe5d8}
.bar.a{top:236px;width:124px}.bar.b{top:262px;width:84px;background:#ef443b}
</style></head><body><div class="tile"></div><div class="card back"></div>
<div class="card"><div class="screen"><div class="play"></div><div class="bar a"></div><div class="bar b"></div></div></div></body></html>`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 400));
  let img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  if (img.getSize().width !== 512) img = img.resize({ width: 512, height: 512, quality: "best" });
  const out = path.join(__dirname, "..", "build", "icon.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log("icon:", out, img.getSize());
  app.quit();
});
