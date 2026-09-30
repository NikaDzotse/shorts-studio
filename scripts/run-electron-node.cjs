// Runs a script on the Node that ships inside Electron (22.x) instead of the system Node.
const { spawnSync } = require("child_process");
const r = spawnSync(require("electron"), process.argv.slice(2), { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
process.exit(r.status == null ? 1 : r.status);
