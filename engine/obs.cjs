"use strict";
// Optional: which OBS scene was live when a clip was made, from OBS's own log files (OBS on this PC). Settings can map
// scenes to layouts (for example "Just Chatting" -> You centred, "Gaming" -> Camera + game).
const fs = require("fs");
const path = require("path");

const DIR = path.join(process.env.APPDATA || "", "obs-studio", "logs");
// scene switches from OBS's logs, as [time, scene], oldest first
function timeline() {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d\d-\d\d \d\d-\d\d-\d\d\.txt$/.test(f)).sort().slice(-20); } catch (e) { return out; }
  for (const f of files) {
    const [, y, mo, d, h, mi, s] = f.match(/^(\d{4})-(\d\d)-(\d\d) (\d\d)-(\d\d)-(\d\d)/);
    let day = new Date(+y, +mo - 1, +d), last = +h * 3600 + +mi * 60 + +s;
    for (const line of fs.readFileSync(path.join(DIR, f), "utf8").split(/\r?\n/)) {
      // "User switched to scene" for your clicks (and bots'), "Switched to scene" when OBS starts up
      const m = line.match(/^(\d\d):(\d\d):(\d\d)\.(\d{3}): (?:User s|S)witched to scene '(.*)'$/);
      if (!m) continue;
      const secs = +m[1] * 3600 + +m[2] * 60 + +m[3];
      if (secs < last - 60) day = new Date(day.getTime() + 86400000);   // the log ran past midnight
      last = secs;
      out.push([new Date(day.getTime() + secs * 1000 + +m[4]), m[5]]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}
function sceneAt(when) { let scene = null; for (const [t, name] of timeline()) { if (t <= when) scene = name; else break; } return scene; }
// every scene the logs mention (for the settings)
const scenes = () => [...new Set(timeline().map(([, s]) => s))].sort();
const available = () => fs.existsSync(DIR);
module.exports = { timeline, sceneAt, scenes, available };
