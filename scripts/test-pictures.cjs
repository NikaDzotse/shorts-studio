// electron scripts/test-pictures.cjs: does an offscreen window capture a transparent PNG at the exact size?
const { app, nativeImage } = require("electron");
const fs = require("fs"), path = require("path"), os = require("os");
app.whenReady().then(async () => {
  const pics = require("../engine/pictures.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pics-"));
  const html = path.join(dir, "t.html");
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;background:transparent"><div style="position:absolute;left:100px;top:200px;width:300px;height:150px;background:rgba(239,68,59,.8);border-radius:40px;font:900 60px Arial Black;color:#fff">HELLO</div></body></html>`);
  const out = path.join(dir, "t.png");
  await pics.screenshot(html, {}, 1080, 1920, out);
  const img = nativeImage.createFromPath(out), size = img.getSize(), bmp = img.toBitmap();
  const px = (x, y) => { const i = (y * size.width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i], bmp[i + 3]]; };   // BGRA
  console.log(JSON.stringify({ size, corner: px(5, 5), inside: px(250, 275) }));
  app.quit();
});
