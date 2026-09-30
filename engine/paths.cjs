"use strict";
// Where everything lives. In the installed app the code sits in app.asar, and the programs and sounds (which ffmpeg
// and whisper must open as real files) sit next to it in resources\. While developing, resources\ is in the project.
const path = require("path");
let app = null;
try { app = require("electron").app; } catch (e) { /* plain node (tests) */ }

const ROOT = path.join(__dirname, "..");
const RES = app && app.isPackaged ? process.resourcesPath : path.join(ROOT, "resources");
const DATA = app ? app.getPath("userData") : path.join(ROOT, ".userdata");
const VIDEOS = app ? app.getPath("videos") : path.join(ROOT, ".videos");

module.exports = {
  ROOT, RES, DATA, VIDEOS,
  FFMPEG: path.join(RES, "bin", "ffmpeg.exe"),
  YTDLP: path.join(RES, "bin", "yt-dlp.exe"),
  WHISPER: path.join(RES, "bin", "whisper", "whisper-cli.exe"),
  SOUNDS: path.join(RES, "sounds"),
  THEMES: path.join(ROOT, "themes"),
  SHARED: path.join(ROOT, "shared"),
  MODELS: path.join(DATA, "models"),
  LIBRARY: path.join(DATA, "library"),            // your own sounds, music, pictures and emotes
  FONT: path.join(process.env.SystemRoot || "C:\\Windows", "Fonts", "ariblk.ttf"),   // Arial Black, on every Windows
};
