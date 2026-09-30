// Builds the Windows installer (dist\Shorts-Studio-Setup-<version>.exe). electron-builder 26 needs Node 22, so this
// runs on the Node inside Electron:  npm run dist  (= ELECTRON_RUN_AS_NODE=1 electron scripts/build.cjs)
process.noAsar = true;   // Electron reads .asar files as folders; the builder must see them as plain files
const builder = require("electron-builder");
builder.build({ targets: builder.Platform.WINDOWS.createTarget("nsis", builder.Arch.x64), publish: "never" })
  .then((files) => { console.log("built:\n  " + files.join("\n  ")); })
  .catch((e) => { console.error("BUILD FAILED", e.stack || e.message); process.exit(1); });
