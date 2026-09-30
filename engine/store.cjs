"use strict";
// Your settings and your list of Shorts, in the app's data folder (%APPDATA%\Shorts Studio). Every change is told to
// the windows through `events` ("change").
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const P = require("./paths.cjs");

const events = new EventEmitter();
const SETTINGS = path.join(P.DATA, "settings.json"), LIST = path.join(P.DATA, "shorts.json"), EDITS = path.join(P.DATA, "edits");

const DEFAULTS = {
  channel: "",                    // your Twitch login
  theme: "casefile",              // themes\<id>
  accent: "",                     // empty = the theme's own colour
  series: "",                     // the small line over the title (empty = the theme's)
  handle: "",                     // the channel line on the bottom card (empty = twitch.tv/<channel>)
  stamp: "",                      // the stamp on the bottom card (empty = the theme's)
  layout: "letterbox",            // for new Shorts: letterbox (whole picture) / split / stage / center
  presetId: "",                   // empty uses Settings; otherwise a saved look for new batches
  crops: {},                      // your own default crops per layout (saved from the editor)
  captions: true, chat: true,
  model: "base",                  // speech model: base (fast, 148 MB) or small (better, 466 MB)
  language: "auto",
  hashtags: "#shorts #twitch",
  outDir: "",                     // empty = Videos\Shorts Studio
  obs: { enabled: false, map: {} },   // match layouts to the OBS scene that was live (OBS on this PC)
  trim: { enabled: true, target: 30, targetMax: 35, maxPause: 0.7, keepPause: 0.3 },
  firstRun: true,
};

const read = (file, d) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return d; } };
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

function settings() { const s = read(SETTINGS, {}); return { ...DEFAULTS, ...s, obs: { ...DEFAULTS.obs, ...(s.obs || {}) }, trim: { ...DEFAULTS.trim, ...(s.trim || {}) } }; }
function saveSettings(patch) { const s = { ...settings(), ...patch }; write(SETTINGS, s); events.emit("settings", s); return s; }
const outDir = () => settings().outDir || path.join(P.VIDEOS, "Shorts Studio");

function list() { return read(LIST, []); }
function get(id) { return list().find((s) => s.id === id) || null; }
function update(id, patch) {
  const all = list(), i = all.findIndex((s) => s.id === id);
  const item = { ...(i >= 0 ? all[i] : { id, createdAt: new Date().toISOString() }), ...patch, updatedAt: new Date().toISOString() };
  if (i >= 0) all[i] = item; else all.unshift(item);
  write(LIST, all);
  events.emit("change", item);
  return item;
}
function remove(id) { write(LIST, list().filter((s) => s.id !== id)); try { fs.rmSync(path.join(EDITS, id + ".json")); } catch (e) { /* none */ } events.emit("change", { id, removed: true }); }
const edits = (id) => read(path.join(EDITS, id + ".json"), {});
const saveEdits = (id, e) => write(path.join(EDITS, id + ".json"), e);

module.exports = { events, settings, saveSettings, outDir, list, get, update, remove, edits, saveEdits, DEFAULTS };
