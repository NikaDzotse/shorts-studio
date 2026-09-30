"use strict";
// The editor's library: the sounds and music that come with the app (resources\sounds) plus your own files in the
// app's data folder (library\sfx, music, stickers, emotes). Each sound's loudness is measured once and remembered, so
// the Short can bring every file to the same level.
const fs = require("fs");
const path = require("path");
const P = require("./paths.cjs");
const FX = require("./fx.cjs");
const { probe } = require("./run.cjs");

const USER = { sfx: path.join(P.LIBRARY, "sfx"), music: path.join(P.LIBRARY, "music"), stickers: path.join(P.LIBRARY, "stickers"), emotes: path.join(P.LIBRARY, "emotes") };
const CACHE = path.join(P.LIBRARY, "levels.json");
const AUDIO = /\.(mp3|wav|ogg|m4a|flac)$/i, PICS = /\.(png|jpe?g|webp|gif)$/i;
const nice = (f) => path.basename(f).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const MADE = new Set(["boom", "bleep", "record-scratch", "dun-dun-dunnn", "sad-trombone", "rimshot", "riser", "noir-drone", "tension-pulse", "case-file-slam"]);

async function duration(file) {
  return +(await probe(file)).duration.toFixed(2) || 0;
}
async function index() {
  for (const d of Object.values(USER)) fs.mkdirSync(d, { recursive: true });
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch (e) { /* first time */ }
  const seen = {};
  const sounds = async (dirs) => {
    const out = [];
    for (const [dir, group] of dirs) {
      let files = []; try { files = fs.readdirSync(dir).filter((f) => AUDIO.test(f)).sort(); } catch (e) { continue; }
      for (const f of files) {
        const file = path.join(dir, f), st = fs.statSync(file), key = file + "|" + st.size + "|" + st.mtimeMs;
        let m = cache[key];
        if (!m) { const lv = FX.loudness(file); m = { lufs: lv.lufs, peak: lv.peak, dur: await duration(file) }; }
        seen[key] = m;
        const base = f.replace(/\.[^.]+$/, "");
        out.push({ name: nice(f), file, dur: m.dur, lufs: m.lufs, peak: m.peak, group: group === "app" ? (MADE.has(base) ? "Made for Shorts Studio" : "Free sounds (CC0)") : group });
      }
    }
    return out;
  };
  const pics = (dir) => { try { return fs.readdirSync(dir).filter((f) => PICS.test(f)).sort().map((f) => ({ name: f.replace(/\.[^.]+$/, ""), file: path.join(dir, f) })); } catch (e) { return []; } };
  const lib = {
    at: Date.now(), dir: P.LIBRARY,
    sfx: await sounds([[path.join(P.SOUNDS, "sfx"), "app"], [USER.sfx, "Added by you"]]),
    music: await sounds([[path.join(P.SOUNDS, "music"), "app"], [USER.music, "Added by you"]]),
    emotes: pics(USER.emotes), stickers: pics(USER.stickers),
  };
  try { fs.writeFileSync(CACHE, JSON.stringify(seen)); } catch (e) { /* only a cache */ }
  return lib;
}
module.exports = { index, USER };
