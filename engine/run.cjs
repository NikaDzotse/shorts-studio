"use strict";
// Running the bundled programs (ffmpeg, yt-dlp, whisper) and keeping a log.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const P = require("./paths.cjs");

const LOG = path.join(P.DATA, "shorts-studio.log");
function log(...a) {
  const line = new Date().toISOString().slice(11, 19) + " " + a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ");
  console.log(line);
  try { fs.mkdirSync(P.DATA, { recursive: true }); fs.appendFileSync(LOG, line + "\n"); } catch (e) { /* logging never breaks anything */ }
}
// resolves with stdout; rejects with the last lines of stderr
function run(cmd, args, { cwd, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => { err += d; if (onLine) for (const l of String(d).split(/\r?\n|\r/)) if (l.trim()) onLine(l); });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} failed (${code}): ${(err || out).trim().split(/\r?\n/).slice(-3).join(" | ")}`)));
  });
}
// a video or sound file's size and length, read from what ffmpeg prints about it (no ffprobe: it would add 100 MB)
function probe(file) {
  return new Promise((resolve) => {
    const p = spawn(P.FFMPEG, ["-hide_banner", "-i", file], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => resolve({ width: 0, height: 0, duration: 0 }));
    p.on("close", () => {
      const d = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/), v = err.match(/Stream #[^\n]*Video:[^\n]*?, (\d{2,5})x(\d{2,5})[\s,[]/);
      resolve({ width: v ? +v[1] : 0, height: v ? +v[2] : 0, duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0 });
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { run, probe, log, sleep, LOG };
