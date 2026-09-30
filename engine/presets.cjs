"use strict";
// Presets contain reusable style only. Clip words, cuts, dates, credits and timed effects stay with their clip.
const fs = require("fs"), path = require("path"), { randomUUID } = require("crypto");
const P = require("./paths.cjs");
const FILE = path.join(P.DATA, "presets.json");
const copy = (v) => JSON.parse(JSON.stringify(v));
function style(input = {}) {
  const out = {};
  if (!["split", "stage", "letterbox", "center"].includes(input.layout)) throw new Error("Choose a layout before saving a preset.");
  out.layout = input.layout;
  const numbers = (src, spec) => Object.fromEntries(Object.entries(spec).filter(([k]) => typeof src?.[k] === "number" && Number.isFinite(src[k]))
    .map(([k, [lo, hi]]) => [k, Math.max(lo, Math.min(hi, src[k]))]));
  out.geo = numbers(input.geo, { faceH: [300, 1200], h: [200, 1500], y: [0, 1600] });
  out.crops = {};
  for (const k of out.layout === "split" ? ["face", "game"] : ["main"]) {
    const b = numbers(input.crops?.[k], { x: [0, 1920], y: [0, 1080], w: [22, 1920], h: [22, 1080] });
    if (Object.keys(b).length === 4) out.crops[k] = b;
  }
  out.cap = numbers(input.cap, { size: [30, 140], group: [1, 6], bottom: [0, 1920] });
  for (const k of ["hi", "color"]) if (/^#[0-9a-f]{6}$/i.test(input.cap?.[k] || "")) out.cap[k] = input.cap[k];
  if (["classic", "pop", "punch", "box", "reveal"].includes(input.cap?.style)) out.cap.style = input.cap.style;
  out.cap.upper = input.cap?.upper !== false;
  out.captions = input.captions !== false; out.chat = input.chat !== false;
  out.frame = numbers(input.frame, { titleSize: [0, 110], headY: [0, 1720], footY: [0, 1820] });
  for (const k of ["head", "foot"]) out.frame[k] = input.frame?.[k] !== false;
  for (const k of ["kicker", "chan", "stamp"]) if (typeof input.frame?.[k] === "string") out.frame[k] = input.frame[k].slice(0, 300);
  const appearance = input.appearance || {};
  if (!/^[a-z0-9_-]+$/i.test(appearance.theme || "") || !fs.existsSync(path.join(P.THEMES, appearance.theme, "theme.json")))
    throw new Error("This preset's theme is not available.");
  out.appearance = { theme: appearance.theme };
  if (/^#[0-9a-f]{6}$/i.test(appearance.accent || "")) out.appearance.accent = appearance.accent;
  Object.assign(out, numbers(input, { volume: [-20, 20], noteWidth: [151, 1080] }));
  out.music = input.music?.file ? { file: String(input.music.file), ...numbers(input.music, { vol: [-30, 12], offset: [0, 86400] }), duck: input.music.duck !== false } : null;
  return out;
}
function list() {
  try { const items = JSON.parse(fs.readFileSync(FILE, "utf8")); if (!Array.isArray(items)) throw new Error("Invalid preset list"); return items; }
  catch (e) { if (e.code === "ENOENT") return []; throw new Error("Couldn't read your presets. Your saved file has been kept."); }
}
function write(items) {
  fs.mkdirSync(P.DATA, { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(items, null, 2)); fs.renameSync(FILE + ".tmp", FILE);
}
function save({ id, name, edits } = {}) {
  name = String(name || "").trim();
  if (!name || name.length > 60) throw new Error("Give the preset a name of 1–60 characters.");
  const items = list(), index = items.findIndex((p) => p.id === id);
  if (id && index < 0) throw new Error("That preset was deleted. Save a new one instead.");
  if (items.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) throw new Error("That name is already used. Choose it and press Update preset, or use another name.");
  const preset = { id: id || randomUUID(), name, style: style(edits), updatedAt: new Date().toISOString() };
  if (index < 0) items.push(preset); else items[index] = preset;
  write(items); return preset;
}
function remove(id) { write(list().filter((p) => p.id !== id)); }
function resolve(id) {
  if (!id) return {};
  const p = list().find((p) => p.id === id);
  if (!p) throw new Error("That preset was deleted. Choose another preset.");
  const edits = style(p.style);
  if (edits.music && !fs.existsSync(edits.music.file)) throw new Error(`The music for “${p.name}” is missing. Choose another track in the editor and update the preset.`);
  return copy(edits);
}
module.exports = { list, save, remove, resolve, style };
