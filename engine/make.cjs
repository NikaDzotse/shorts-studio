"use strict";
// The Short maker: a Twitch clip -> a vertical Short (1080x1920). Trimmed to the good part, laid out for phones,
// captions word by word, chat from that moment as notes, the theme's frame, and everything from the editor (zooms,
// slow motion, freezes, sound effects, music, bleeps, stickers, your own text, joined clips).
// Jobs run one at a time; progress goes into the list of Shorts (store.cjs), which the windows show.
const fs = require("fs");
const path = require("path");
const P = require("./paths.cjs");
const S = require("./store.cjs");
const T = require("./twitch.cjs");
const Wh = require("./whisper.cjs");
const FX = require("./fx.cjs");
const OBS = require("./obs.cjs");
const pictures = require("./pictures.cjs");
const { run, probe, log } = require("./run.cjs");

// ---------- the Short: what the apps cover, and where the video goes ----------
const W = 1080, H = 1920, TOP = 150, BAND = 1500;       // the video band is y 150-1650 (see a theme's frame.html)
// each layout's defaults; the editor can change every one of these per Short
//   split:  a camera panel on top (faceH tall), the game underneath
//   stage / letterbox / center: one crop of the picture, h tall at y, over a blurred copy of the whole picture
const LAYOUTS = {
  split:     { geo: { faceH: 560 },           cap: { bottom: TOP + 560 + 48 }, notes: { width: 380, x: 24, slots: [TOP + 300] } },
  stage:     { geo: { h: 810, y: 450 },       cap: { bottom: 1372 },           notes: { width: 520, x: 40, slots: [470] } },
  letterbox: { geo: { h: 608, y: TOP + 446 }, cap: { bottom: 1335 },           notes: { width: 560, x: 50, slots: [424] } },
  center:    { geo: { h: BAND, y: TOP },      cap: { bottom: 1370 },           notes: { width: 420, x: 36, slots: [860] } },
};
// where each part of the picture comes from when you haven't set your own (in 1920x1080 pixels)
const DEFAULT_CROPS = {
  split: { face: { x: 0, y: 680, w: 640, h: 400 }, game: { x: 640, y: 0, w: 1280, h: 1080 } },
  stage: { main: { x: 240, y: 0, w: 1440, h: 1080 } },
  letterbox: { main: { x: 0, y: 0, w: 1920, h: 1080 } },
  center: { main: { x: 0, y: 0, w: 1920, h: 1080 } },
};
const BOTS = new Set(["streamelements", "nightbot", "streamlabs", "moobot", "fossabot", "sery_bot", "wizebot", "soundalerts", "streamerbot", "kofistreambot", "botrixoficial", "pokemoncommunitygame"]);

// ---------- the theme (themes\<id>) and your settings on top ----------
function theme(settings = S.settings()) {
  let id = settings.theme; if (!fs.existsSync(path.join(P.THEMES, id || "", "theme.json"))) id = "casefile";
  const t = JSON.parse(fs.readFileSync(path.join(P.THEMES, id, "theme.json"), "utf8")), dir = path.join(P.THEMES, id);
  const accent = /^#[0-9a-f]{6}$/i.test(settings.accent || "") ? settings.accent : t.accent;
  return { id, ...t, dir, frame: path.join(dir, "frame.html"), note: path.join(dir, "note.html"), accent,
    series: settings.series || t.series || "", stamp: settings.stamp || t.stamp || "", handle: settings.handle || (settings.channel ? "twitch.tv/" + settings.channel : ""),
    cap: { size: 70, group: 3, upper: t.captions.upper !== false, hi: settings.accent && t.captions.hi === t.accent ? accent : t.captions.hi, color: t.captions.color || "#ffffff", style: t.captions.style || "classic" } };
}

// a crop of box with the given aspect, centred, in the clip's own pixels (k = clip width / 1920), even numbers for the
// encoder, and kept inside the picture
function fit(box, aspect, k = 1, vw = 1920 * k, vh = 1080 * k) {
  let w = Math.min(box.w, 1920), h = Math.min(box.h, 1080);
  if (w / h > aspect) w = h * aspect; else h = w / aspect;
  const ev = (v) => Math.max(0, Math.round(v * k / 2) * 2);
  const r = { w: Math.max(2, ev(w)), h: Math.max(2, ev(h)), x: ev(box.x + (box.w - w) / 2), y: ev(box.y + (box.h - h) / 2) };
  r.w = Math.min(r.w, Math.floor(vw / 2) * 2); r.h = Math.min(r.h, Math.floor(vh / 2) * 2);
  r.x = Math.max(0, Math.min(r.x, Math.floor((vw - r.w) / 2) * 2)); r.y = Math.max(0, Math.min(r.y, Math.floor((vh - r.h) / 2) * 2));
  return r;
}
const okBox = (b) => b && [b.x, b.y, b.w, b.h].every((v) => Number.isFinite(+v)) && +b.w > 20 && +b.h > 20;
// the look a Short is drawn with: the layout's defaults, your saved crops, then whatever the editor changed
function look(layout, edits = {}, settings = S.settings(), th = theme(settings)) {
  const base = LAYOUTS[layout] || LAYOUTS.letterbox;
  const geo = { ...base.geo, ...(edits.layout === layout || !edits.layout ? edits.geo || {} : {}) };
  if (layout === "split") geo.faceH = Math.max(300, Math.min(BAND - 300, Math.round(+geo.faceH / 2) * 2 || base.geo.faceH));
  else { geo.h = Math.max(200, Math.min(BAND, Math.round(+geo.h / 2) * 2 || base.geo.h)); geo.y = Math.round(+geo.y); if (!Number.isFinite(geo.y)) geo.y = base.geo.y; }
  const mine = (settings.crops || {})[layout] || {}, own = (edits.layout === layout || !edits.layout) && edits.crops || {}, crops = {};
  for (const [k, def] of Object.entries(DEFAULT_CROPS[layout] || DEFAULT_CROPS.letterbox)) {
    const b = okBox(own[k]) ? own[k] : okBox(mine[k]) ? mine[k] : def;
    const aspect = k === "face" ? W / geo.faceH : k === "game" ? W / (BAND - geo.faceH) : W / geo.h;
    crops[k] = okBox(own[k]) ? { x: +b.x, y: +b.y, w: +b.w, h: +b.h } : fit(b, aspect);
  }
  const cap = { ...th.cap, ...base.cap, ...(edits.cap || {}) };
  const notes = { ...base.notes, ...(Number.isFinite(+edits.noteWidth) && +edits.noteWidth > 150 ? { width: Math.round(+edits.noteWidth) } : {}) };
  return { geo, crops, cap, notes };
}

// ---------- the sound: loudness every 50 ms (from the 16 kHz mono WAV made for the captions) ----------
function wavData(wavFile) {
  const b = fs.readFileSync(wavFile); let o = 12, data = null, rate = 16000;
  while (o + 8 <= b.length) { const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === "fmt ") rate = b.readUInt32LE(o + 12);
    if (id === "data") { data = { at: o + 8, len: Math.min(sz, b.length - o - 8) }; break; } o += 8 + sz + (sz & 1); }
  return { b, data, rate };
}
function loudness(wavFile) {
  const { b, data, rate } = wavData(wavFile);
  const F = Math.round(rate * 0.05), n = Math.floor(data.len / 2 / F), db = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < F; j++) { const v = b.readInt16LE(data.at + (i * F + j) * 2) / 32768; s += v * v; } db[i] = 10 * Math.log10(s / F + 1e-10); }
  return db;
}
// the waveform for the editor: the loudest sample every 10 ms, 0-1
function peaks(wavFile) {
  const { b, data, rate } = wavData(wavFile);
  const F = Math.round(rate / 100), n = Math.floor(data.len / 2 / F), out = new Array(n);
  for (let i = 0; i < n; i++) { let m = 0; for (let j = 0; j < F; j++) { const v = Math.abs(b.readInt16LE(data.at + (i * F + j) * 2)); if (v > m) m = v; } out[i] = Math.round(m / 32.768) / 1000; }
  return out;
}
const percentile = (arr, p) => { const s = Array.from(arr).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

// ---------- smart trim: the parts of the clip to keep, in clip seconds ----------
function planTrim(db, words, dur, opt) {
  const step = 0.05, n = db.length;
  if (!opt.enabled || n < 20) return [[0, dur]];
  const floor = percentile(db, 0.2);
  const inWord = new Uint8Array(n);
  for (const w of words) for (let i = Math.floor(w.s / step); i <= Math.min(n - 1, Math.ceil(w.e / step)); i++) inWord[i] = 1;
  const active = (i) => inWord[i] || db[i] > floor + 9;
  let first = 0; while (first < n && !active(first)) first++;
  let last = n - 1; while (last > first && !active(last)) last--;
  if (first >= last) return [[0, dur]];
  const start = Math.max(0, first * step - 0.2), end = Math.min(dur, (last + 1) * step + 0.3);
  // jump-cut the long pauses in between (stop where the sound ends: the video can run a little past it)
  const stop = Math.min(n, Math.floor(end / step));
  const segs = []; let a = start, i = Math.ceil(start / step);
  while (i < stop) {
    if (active(i)) { i++; continue; }
    let j = i; while (j < stop && !active(j)) j++;
    if ((j - i) * step > opt.maxPause && j < stop) { segs.push([a, i * step + opt.keepPause / 2]); a = j * step - opt.keepPause / 2; }
    i = Math.max(j, i + 1);
  }
  segs.push([a, end]);
  let kept = segs.filter(([x, y]) => y - x > 0.15);
  if (kept.reduce((s, [x, y]) => s + y - x, 0) <= opt.targetMax) return kept;
  // too long: the best `target` seconds by loudness and talking, cut at word edges
  const frames = []; for (const [x, y] of kept) for (let t = x; t < y - step / 2; t += step) frames.push(t);
  const score = frames.map((t) => { const k = Math.min(n - 1, Math.floor(t / step)); return Math.max(0, Math.min(1, (db[k] - floor) / 25)) + (inWord[k] ? 0.8 : 0); });
  const win = Math.min(frames.length, Math.round(opt.target / step));
  let sum = 0; for (let k = 0; k < win; k++) sum += score[k];
  let best = sum, bestAt = 0;
  for (let k = win; k < frames.length; k++) { sum += score[k] - score[k - win]; if (sum > best) { best = sum; bestAt = k - win + 1; } }
  let from = frames[bestAt], to = frames[bestAt + win - 1] + step;
  const startOf = words.filter((w) => w.s <= from && w.s > from - 0.8).pop(); if (startOf) from = Math.max(0, startOf.s - 0.1);
  const endOf = words.find((w) => w.e >= to && w.e < to + 1.0); if (endOf) to = Math.min(dur, endOf.e + 0.25);
  kept = kept.map(([x, y]) => [Math.max(x, from), Math.min(y, to)]).filter(([x, y]) => y - x > 0.15);
  return kept.length ? kept : [[0, Math.min(dur, opt.target)]];
}
// the editor's keep-parts: in order, inside the clip, overlaps joined, slivers dropped
function normSegs(segs, dur) {
  const s = (Array.isArray(segs) ? segs : []).map(([a, b]) => [Math.max(0, +a), Math.min(dur, +b)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b - a >= 0.1).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) { const last = out[out.length - 1]; if (last && a <= last[1] + 0.02) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}

// ---------- captions (ASS subtitles, drawn by ffmpeg's libass) ----------
const assColor = (hex, fallback) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")) || /^#?([0-9a-f]{6})$/i.exec(fallback); const v = m[1]; return `&H${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}&`.toUpperCase(); };
function captionGroups(words, group = 3) {
  const groups = []; let g = [];
  words.forEach((w, i) => { g.push(w); const next = words[i + 1]; if (g.length >= group || !next || next.s - w.e > 0.45 || /[.!?]$/.test(w.w)) { groups.push(g); g = []; } });
  return groups;
}
// when each word shows: until the next one starts; a group's last word lingers a little, but never into the next group
function captionSpans(words, group) {
  const groups = captionGroups(words, group), spans = [];
  groups.forEach((grp, gi) => grp.forEach((w, i) => {
    const nextStart = i + 1 < grp.length ? grp[i + 1].s : groups[gi + 1] ? groups[gi + 1][0].s : Infinity;
    spans.push({ grp, i, gi, s: w.s, e: i + 1 < grp.length ? nextStart : Math.min(nextStart, Math.max(w.e, w.s + 0.25) + 0.5) });
  }));
  return spans;
}
// a bleeped word keeps its first letter and its punctuation: "Fuck." -> "F***."
function bleepText(x) { const m = /^(.)(.*?)([.,!?…'"]*)$/s.exec(x); return m ? m[1] + "*".repeat(Math.max(2, Math.min(4, m[2].length))) + m[3] : "***"; }
// words: on the Short's timeline ({ w, s, e, color, bleep }); cap: size, group, upper, hi, color, style, bottom;
// texts: [{ text, s, e, y, size, color, box }]. Styles: classic, pop, punch, box, reveal. Text stays in x 60-900.
function captionsAss(words, cap, texts = []) {
  const style = ["classic", "pop", "punch", "box", "reveal"].includes(cap.style) ? cap.style : "classic";
  const t = (s) => { const cs = Math.max(0, Math.round(s * 100)); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; };
  const clean = (w) => { const x = String(w).replace(/[{}\\]/g, "").replace(/\r?\n/g, " "); return cap.upper ? x.toUpperCase() : x; };
  const shown = (w) => w.bleep ? bleepText(clean(w.w)) : clean(w.w);
  const hi = assColor(cap.hi, "#ef443b"), fg = assColor(cap.color, "#ffffff");
  const lines = [];
  for (const { grp, i, s, e } of captionSpans(words, Math.max(1, Math.min(6, Math.round(+cap.group) || 3)))) {
    const parts = [];
    grp.forEach((x, j) => {
      if (style === "reveal" && j > i) return;
      const own = x.color ? assColor(x.color, "#ffffff") : null;
      if (j === i) {
        const punch = style === "punch" ? "\\fscx122\\fscy122\\t(0,130,\\fscx100\\fscy100)" : "";
        parts.push(`{\\c${own || hi}${punch}}${shown(x)}{\\c${fg}${punch ? "\\fscx100\\fscy100" : ""}}`);
      } else parts.push(own ? `{\\c${own}}${shown(x)}{\\c${fg}}` : shown(x));
    });
    const pop = style === "pop" && i === 0 ? "{\\fscx72\\fscy72\\t(0,110,\\fscx100\\fscy100)}" : "";
    lines.push(`Dialogue: 0,${t(s)},${t(e)},${style === "box" ? "CapBox" : "Cap"},,0,0,0,,${pop}${parts.join(" ")}`);
  }
  for (const x of texts) {
    const txt = String(x.text || "").replace(/[{}\\]/g, "").split(/\r?\n/).join("\\N");
    if (!txt.trim() || !(x.e > x.s)) continue;
    const size = Math.max(20, Math.min(160, Math.round(+x.size) || 64));
    lines.push(`Dialogue: 1,${t(x.s)},${t(x.e)},${x.box ? "TxtBox" : "Txt"},,0,0,${Math.max(0, Math.min(H - 60, Math.round(+x.y) || 900))},,{\\fs${size}\\c${assColor(x.color, "#ffffff")}}${txt}`);
  }
  const size = Math.max(30, Math.min(140, Math.round(+cap.size) || 70)), mv = Math.max(0, H - Math.round(+cap.bottom)), prim = fg.replace("&H", "&H00").replace(/&$/, "");
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial Black,${size},${prim},&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,6,3,2,60,180,${mv},1
Style: CapBox,Arial Black,${size},${prim},&H00FFFFFF,&H30110E0D,&H30110E0D,-1,0,0,0,100,100,0,0,3,12,0,2,60,180,${mv},1
Style: Txt,Arial Black,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,6,3,8,60,180,900,1
Style: TxtBox,Arial Black,64,&H00FFFFFF,&H00FFFFFF,&H28110E0D,&H28110E0D,-1,0,0,0,100,100,0,0,3,14,0,8,60,180,900,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}

// ---------- chat notes: one per slot at a time, each on screen for `hold` seconds, the same person at most every 6 s ----------
function scheduleNotes(msgs, slots, outDur, hold = 3.0) {
  const free = slots.map(() => 0), out = [], lastBy = {};
  for (const m of msgs) {
    if (m.at > outDur - 1.2) break;
    if (lastBy[m.login] != null && m.at - lastBy[m.login] < 6) continue;
    const s = free.findIndex((f) => f <= m.at + 0.8); if (s < 0) continue;
    const at = Math.max(m.at, free[s]);
    out.push({ ...m, at, until: Math.min(outDur, at + hold), slot: s });
    lastBy[m.login] = at; free[s] = at + hold + 0.15;
    if (out.length >= 10) break;
  }
  return out;
}

// ---------- the ffmpeg picture ----------
// pieces: fx.buildPieces (the kept parts, slow motion, freezes) -> [src] + [aud0]; zooms: { face, game, main } on the Short's timeline
function graph(layout, lk, vw, vh, pieces, { clipDur = Infinity, zooms = {} } = {}) {
  const k = vw / 1920, bg = `color=c=0x0d0e11:s=${W}x${H}:r=30[bg]`, { geo, crops } = lk;
  const z = (key, w, h) => FX.zoomChain(zooms[key] || [], w, h);
  let g = FX.piecesGraph(pieces, clipDur) + ";";
  if (layout === "split") {
    const faceH = geo.faceH, gameH = BAND - faceH, f = fit(crops.face, W / faceH, k, vw, vh), m = fit(crops.game, W / gameH, k, vw, vh);
    g += `[src]split=2[s1][s2];[s1]crop=${f.w}:${f.h}:${f.x}:${f.y},scale=${W}:${faceH}${z("face", W, faceH)}[face];[s2]crop=${m.w}:${m.h}:${m.x}:${m.y},scale=${W}:${gameH}${z("game", W, gameH)}[game];${bg};` +
      `[bg][face]overlay=0:${TOP}:shortest=1[a];[a][game]overlay=0:${TOP + faceH}[b]`;
  } else {
    const h = geo.h, c = fit(crops.main, W / h, k, vw, vh);
    const fg = `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${W}:${h}${z("main", W, h)}`;
    if (h >= BAND && geo.y <= TOP) g += `[src]${fg}[fg];${bg};[bg][fg]overlay=0:${geo.y}:shortest=1[b]`;
    else g += `[src]split=2[s1][s2];[s1]scale=${W}:${BAND}:force_original_aspect_ratio=increase,crop=${W}:${BAND},gblur=sigma=28,eq=brightness=-0.2[blur];` +
      `[s2]${fg}[fg];${bg};[bg][blur]overlay=0:${TOP}:shortest=1[a];[a][fg]overlay=0:${geo.y}[b]`;
  }
  return g;
}

const slug = (s) => String(s || "clip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "clip";
const day = (d) => d.toLocaleDateString("en-GB").replace(/\//g, ".");
const thumbAt = (dur) => String(Math.max(0, Math.min(1, (dur || 2) / 2)).toFixed(2));

// download + sound + words for one clip, into work
async function prepare(clip, work, step) {
  fs.mkdirSync(work, { recursive: true });
  for (const f of fs.readdirSync(work)) if (/^(clip\.|audio\.wav$|words\.json$|caps\.ass$|note-\d+\.png$|whisper\.json$)/.test(f)) fs.rmSync(path.join(work, f));
  await step("Downloading");
  let got = null;
  for (let i = 0; i < 6 && !got; i++) {
    try { await run(P.YTDLP, ["--no-update", "--ffmpeg-location", path.dirname(P.FFMPEG), "-f", "1080/best[ext=mp4]/best", "--no-part", "--no-playlist", "-o", "clip.%(ext)s", clip.url], { cwd: work }); got = fs.readdirSync(work).find((f) => /^clip\.(mp4|mkv|webm)$/.test(f)); }
    catch (e) { if (i === 5) throw new Error("Couldn't download the clip: " + e.message); await new Promise((r) => setTimeout(r, 5000)); }
  }
  const info = await probe(path.join(work, got)), vw = info.width, vh = info.height, dur = info.duration || clip.duration;
  await step("Listening");
  await run(P.FFMPEG, ["-y", "-i", got, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "audio.wav"], { cwd: work });
  const s = S.settings();
  if (!Wh.hasModel(s.model)) await Wh.download(s.model, (f) => step(`Getting the speech model (${Wh.MODELS[s.model].mb} MB) ${Math.round(f * 100)}%`));
  await step("Writing captions");
  const words = await Wh.words(path.join(work, "audio.wav"), { model: s.model, language: s.language });
  fs.writeFileSync(path.join(work, "words.json"), JSON.stringify({ words }));
  return { got, vw, vh, dur, words, db: loudness(path.join(work, "audio.wav")) };
}
// a Short's clip, sound and words from its work folder (downloaded again only if they're gone)
async function load(s, step) {
  const clip = { title: s.title, createdAt: s.madeAt, by: s.by, duration: s.clipSeconds, url: s.clipUrl, videoId: s.videoId, videoOffset: s.videoOffset, channel: s.channel };
  const got = fs.existsSync(s.work) && fs.readdirSync(s.work).find((f) => /^clip\.(mp4|mkv|webm)$/.test(f));
  if (got && fs.existsSync(path.join(s.work, "audio.wav")) && fs.existsSync(path.join(s.work, "words.json"))) {
    await step("Loading");
    const info = await probe(path.join(s.work, got)), vw = info.width, vh = info.height, dur = info.duration || clip.duration;
    return { clip, p: { got, vw, vh, dur, words: JSON.parse(fs.readFileSync(path.join(s.work, "words.json"), "utf8")).words, db: loudness(path.join(s.work, "audio.wav")) } };
  }
  return { clip, p: await prepare(clip, s.work, step) };
}

// ---------- one Short: trim + layout + captions + chat + frame + effects -> out ----------
// edits (from the editor, times in clip seconds): title, layout, segs, geo, crops, cap, captions, words [{w, s, e, color,
// bleep, emoji}], chat, notes [{key, t, x, y, hold, text}], noteWidth, texts, frame {head, foot, kicker, date, sub,
// titleSize, headY, chan, byline, stamp, footY, headFrom/To, footFrom/To}, volume, speeds, freezes, zooms, sfx, music,
// stickers, upload, join. hideHead: no title card (a joined Short puts one over all of it); noEditData: a joined part.
async function render(clip, p, work, out, { layout, step, edits = {}, post = {}, trim, hideHead = false, noEditData = false, kicker }) {
  edits = edits || {};
  const settings = S.settings(), th = theme(settings);
  trim = trim || settings.trim;
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const volumeDb = Math.round(clampN(+edits.volume || 0, -20, 20) * 2) / 2;
  layout = LAYOUTS[edits.layout] ? edits.layout : LAYOUTS[layout] ? layout : "letterbox";
  // what smart trim would keep; a short clip is mostly reaction, so it isn't trimmed down to nothing
  let autoSegs = planTrim(p.db, p.words, p.dur, trim);
  const autoKept = autoSegs.reduce((s, [a, b]) => s + b - a, 0);
  if (autoKept < Math.min(p.dur, 3) || (p.dur <= 12 && autoKept < p.dur * 0.6)) autoSegs = [[0, p.dur]];
  const segs = normSegs(edits.segs, p.dur).length ? normSegs(edits.segs, p.dur) : autoSegs;
  const { pieces, outDur } = FX.buildPieces(segs, Array.isArray(edits.speeds) ? edits.speeds : [], Array.isArray(edits.freezes) ? edits.freezes : [], p.dur);
  const map = FX.mapper(pieces), unmap = FX.unmapper(pieces);
  const kept = segs.reduce((s, [a, b]) => s + b - a, 0);

  let srcWords = p.words;
  if (Array.isArray(edits.words) && edits.words.length && typeof edits.words[0] === "object") {
    srcWords = edits.words.map((w) => ({ w: String(w.w || "").trim(), s: +w.s, e: +w.e, ...(w.color ? { color: w.color } : {}), ...(w.bleep ? { bleep: true } : {}), ...(w.emoji ? { emoji: String(w.emoji) } : {}) }))
      .filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e)).map((w) => ({ ...w, e: Math.max(w.e, w.s + 0.05) })).sort((a, b) => a.s - b.s);
  }
  const captionsOn = edits.captions != null ? edits.captions !== false : settings.captions !== false;
  const lk = look(layout, edits, settings, th);
  const group = Math.max(1, Math.min(6, Math.round(+lk.cap.group) || 3));
  const words = (captionsOn ? srcWords : []).map((w) => ({ ...w, s: map(w.s), e: map(Math.min(w.e, p.dur)) })).filter((w) => w.s != null).map((w) => ({ ...w, e: w.e == null ? w.s + 0.3 : Math.max(w.e, w.s + 0.1) }));
  const span = (t, e) => { const s = map(Math.max(0, +t || 0), true); if (s == null) return null; const x = map(Math.min(p.dur, +e || 0), true); return { s, e: x == null ? outDur : x }; };
  const texts = (Array.isArray(edits.texts) ? edits.texts : []).map((x) => { const sp = span(x.t, x.e); return sp && { ...x, ...sp }; }).filter((x) => x && x.e - x.s >= 0.1);
  const bleeps = srcWords.filter((w) => w.bleep).map((w) => span(w.s, w.e)).filter((b) => b && b.e - b.s > 0.03);
  try { fs.rmSync(path.join(work, "caps.ass")); } catch (e) { /* none yet */ }
  const subs = words.length || texts.length;
  if (subs) { fs.writeFileSync(path.join(work, "caps.ass"), captionsAss(words, lk.cap, texts)); if (fs.existsSync(P.FONT)) fs.copyFileSync(P.FONT, path.join(work, "ariblk.ttf")); }

  // chat from the clip's moment in the VOD, shifted a second earlier (chat reacts a little late)
  await step("Chat");
  let chat = [], chatFrom = "none";
  if (clip.videoId && clip.videoOffset != null) {
    try {
      chat = (await T.vodChat(clip.videoId, clip.videoOffset, clip.videoOffset + p.dur + 2))
        .filter((m) => !BOTS.has(String(m.login).toLowerCase()) && String(m.login).toLowerCase() !== String(clip.channel || "").toLowerCase() && !/^[!/]/.test(m.text) && m.text.trim());
      chatFrom = "vod";
    } catch (e) { log("chat:", e.message); }
  }
  const all = chat.map((m) => ({ ...m, key: m.rel.toFixed(2) + "|" + m.login, at: map(Math.max(0, m.rel - 1), true) }));
  const chatOn = edits.chat != null ? edits.chat !== false : settings.chat !== false;
  let notes;
  if (!chatOn) notes = [];
  else if (Array.isArray(edits.notes)) {
    const byKey = new Map(all.map((m) => [m.key, m])), num = (v) => v != null && v !== "" && Number.isFinite(+v);
    notes = edits.notes.map((n) => {
      const m = byKey.get(n.key); if (!m) return null;
      const at = map(Math.max(0, +n.t || 0), true); if (at == null || at > outDur - 0.3) return null;
      const own = typeof n.text === "string" && n.text.trim() ? n.text.trim() : null;
      return { ...m, ...(own ? { text: own, parts: null, own } : {}), at, until: Math.min(outDur, at + Math.max(0.5, Math.min(15, +n.hold || 3))),
        x: num(n.x) ? Math.round(+n.x) : lk.notes.x, y: num(n.y) ? Math.round(+n.y) : lk.notes.slots[0] };
    }).filter(Boolean).slice(0, 30);
  } else notes = scheduleNotes(all.filter((m) => m.at != null), lk.notes.slots, outDur).map((n) => ({ ...n, x: lk.notes.x, y: lk.notes.slots[n.slot] }));
  await step("Drawing");
  const pics = await pictures.notes(th.note, notes.map((n) => ({ name: n.name, color: n.color, role: n.role, text: n.text, parts: n.parts, accent: th.accent })), lk.notes.width, work);

  // zooms, stickers (plus an emoji over the captions for a group with an emoji word), sound effects, music
  const zooms = {};
  for (const zm of Array.isArray(edits.zooms) ? edits.zooms : []) {
    const sp = span(zm.t, zm.e); if (!sp || sp.e - sp.s < 0.2) continue;
    const key = layout === "split" ? (zm.target === "game" ? "game" : "face") : "main";
    (zooms[key] = zooms[key] || []).push({ ...sp, z: clampN(+zm.z || 1.35, 1.02, 3), fx: Number.isFinite(+zm.fx) ? +zm.fx : 0.5, fy: Number.isFinite(+zm.fy) ? +zm.fy : 0.45, ramp: +zm.ramp || 0.3 });
  }
  const stickers = [];
  for (const st of Array.isArray(edits.stickers) ? edits.stickers : []) { const sp = span(st.t, st.e); if (sp && sp.e - sp.s >= 0.1) stickers.push({ ...st, ...sp }); }
  if (captionsOn) {
    const byGroup = new Map();
    for (const sp of captionSpans(words, group)) { const g = byGroup.get(sp.gi) || { s: sp.s, e: sp.e, grp: sp.grp }; g.e = Math.max(g.e, sp.e); byGroup.set(sp.gi, g); }
    for (const g of byGroup.values()) { const w = g.grp.find((x) => x.emoji); if (w) stickers.push({ kind: "emoji", emoji: w.emoji, size: 130, x: 480, y: Math.round(lk.cap.bottom - (+lk.cap.size || 70) * 1.3 - 70), s: g.s, e: g.e }); }
  }
  const stickerPics = await FX.renderStickers(stickers.map(({ kind, emoji, src, text, color, size, rot, ratio }) => ({ kind, emoji, src, text, color, size, rot, ratio })), work);
  const sfx = (Array.isArray(edits.sfx) ? edits.sfx : []).filter((x) => x && x.file && fs.existsSync(x.file))
    .map((x) => ({ file: x.file, at: map(Math.max(0, +x.t || 0), true), vol: +x.vol || 0 })).filter((x) => x.at != null && x.at < outDur - 0.05);
  let music = null;
  if (edits.music && edits.music.file && fs.existsSync(edits.music.file)) {
    const m = edits.music, s = m.t == null ? 0 : map(Math.max(0, +m.t), true) ?? 0, e = m.e == null ? outDur : map(Math.min(p.dur, +m.e), true) ?? outDur;
    if (e - s > 0.5) music = { file: m.file, s, e, vol: Number.isFinite(+m.vol) ? +m.vol : 0, duck: m.duck !== false, offset: +m.offset || 0 };
  }

  // the frame's words and places: the theme and your settings, then whatever the editor changed
  const fe = edits.frame || {}, str = (v, d) => typeof v === "string" ? v : d, numIn = (v, d, lo, hi) => v != null && v !== "" && Number.isFinite(+v) ? Math.round(Math.max(lo, Math.min(hi, +v))) : d;
  const created = new Date(clip.createdAt || Date.now());
  const frameDefaults = { kicker: kicker || th.series, date: day(created), sub: "", titleSize: 0, headY: 222, chan: th.handle,
    byline: clip.by ? "clipped by " + clip.by : "", stamp: th.stamp, footY: 1400 };
  const frame = { by: clip.by || "", head: fe.head !== false, foot: fe.foot !== false,
    kicker: str(fe.kicker, frameDefaults.kicker), date: str(fe.date, frameDefaults.date), sub: str(fe.sub, ""), titleSize: numIn(fe.titleSize, 0, 0, 110),
    headY: numIn(fe.headY, 222, 0, H - 200), chan: str(fe.chan, frameDefaults.chan), byline: str(fe.byline, frameDefaults.byline), stamp: str(fe.stamp, frameDefaults.stamp), footY: numIn(fe.footY, 1400, 0, H - 100),
    headFrom: fe.headFrom ?? null, headTo: fe.headTo ?? null, footFrom: fe.footFrom ?? null, footTo: fe.footTo ?? null };
  const cardTime = (from, to) => {
    const s = from == null ? 0 : map(Math.max(0, +from), true) ?? outDur, e = to == null ? outDur : map(Math.min(p.dur, +to), true) ?? outDur;
    return { s, e, timed: s > 0.05 || e < outDur - 0.05 };
  };
  const headT = cardTime(frame.headFrom, frame.headTo), footT = cardTime(frame.footFrom, frame.footTo);

  // everything the editor needs, next to the Short
  if (!noEditData) {
    const layouts = {};
    for (const name of Object.keys(LAYOUTS)) { const d = look(name, {}, settings, th); layouts[name] = { geo: d.geo, crops: d.crops, capBottom: d.cap.bottom, notes: d.notes }; }
    const r2 = (v) => +(+v).toFixed(2), shown = new Set(notes.map((n) => n.key));
    fs.writeFileSync(path.join(work, "edit.json"), JSON.stringify({
      v: 2, clip: path.resolve(work, p.got), clipSeconds: r2(p.dur), vw: p.vw, vh: p.vh, layout, outDur: r2(outDur),
      title: edits.title || clip.title || "", frame, frameDefaults, overlayHtml: th.frame, theme: th.id, accent: th.accent, stamps: th.stamps, labels: th.labels,
      volume: volumeDb, post: { ...post, hashtags: String(settings.hashtags || "").split(/\s+/).filter(Boolean) },
      segs: segs.map(([a, b]) => [r2(a), r2(b)]), autoSegs: autoSegs.map(([a, b]) => [r2(a), r2(b)]),
      words: srcWords.map((w) => ({ ...w, s: r2(w.s), e: r2(w.e) })), whisper: p.words, captions: captionsOn,
      cap: lk.cap, geo: lk.geo, crops: lk.crops, noteWidth: lk.notes.width, layouts,
      chatFrom, chatOn,
      chat: all.map((m) => ({ key: m.key, rel: m.rel, name: m.name, text: m.text, role: m.role, color: m.color, parts: m.parts, shown: shown.has(m.key) })),
      notes: notes.map((n) => ({ key: n.key, t: r2(unmap(n.at)), x: n.x, y: n.y, hold: r2(n.until - n.at), ...(n.own ? { text: n.own } : {}) })),
      texts: Array.isArray(edits.texts) ? edits.texts : [],
      peaks: peaks(path.join(work, "audio.wav")), peaksPerSecond: 100, edits }));
  }

  await step("Framing");
  const q = { title: edits.title || clip.title || "Clip", by: frame.by, date: frame.date, kicker: frame.kicker, stamp: frame.stamp,
    sub: frame.sub, chan: frame.chan, byline: frame.byline, hy: String(frame.headY), fy: String(frame.footY), accent: th.accent };
  if (frame.titleSize) q.tsize = String(frame.titleSize);
  const base = { ...q };
  if (!frame.head || headT.timed || hideHead) base.nohead = "1";
  if (!frame.foot || footT.timed) base.nofoot = "1";
  await pictures.screenshot(th.frame, base, W, H, path.join(work, "overlay.png"));
  const cards = []; let headCard = null;
  for (const [k, tm, on] of [["head", headT, frame.head], ["foot", footT, frame.foot]]) {
    try { fs.rmSync(path.join(work, `card-${k}.png`)); } catch (e) { /* none */ }
    const wanted = k === "head" && hideHead ? on : on && tm.timed && tm.e - tm.s >= 0.2;
    if (!wanted) continue;
    await pictures.screenshot(th.frame, { ...q, only: k }, W, H, path.join(work, `card-${k}.png`));
    if (k === "head" && hideHead) headCard = { file: path.join(work, "card-head.png"), s: headT.s, e: headT.timed ? headT.e : null };
    else cards.push({ file: `card-${k}.png`, s: tm.s, e: tm.e });
  }

  await step("Rendering");
  let g = graph(layout, lk, p.vw, p.vh, pieces, { clipDur: p.dur, zooms });
  let last = "b";
  notes.forEach((n, i) => {
    g += `;[${i + 2}:v]format=rgba,fade=t=in:st=${n.at.toFixed(2)}:d=0.25:alpha=1,fade=t=out:st=${Math.max(n.at, n.until - 0.3).toFixed(2)}:d=0.3:alpha=1[n${i}];` +
      `[${last}][n${i}]overlay=${n.x}:${n.y}:enable='between(t,${n.at.toFixed(2)},${n.until.toFixed(2)})'[o${i}]`;
    last = `o${i}`;
  });
  g += `;[${last}][1:v]overlay=0:0[c]`;
  let top = "c", input = 2 + pics.length;
  const fades = (s, e, d) => `fade=t=in:st=${s.toFixed(2)}:d=${d}:alpha=1,fade=t=out:st=${Math.max(s, e - d).toFixed(2)}:d=${d}:alpha=1`;
  cards.forEach((c, i) => { g += `;[${input++}:v]format=rgba,${fades(c.s, c.e, 0.25)}[k${i}];[${top}][k${i}]overlay=0:0:enable='between(t,${c.s.toFixed(2)},${c.e.toFixed(2)})'[ck${i}]`; top = `ck${i}`; });
  stickerPics.forEach((pic, i) => {
    const st = stickers[i], x = Math.round((+st.x || 480) - pic.w / 2), y = Math.round((+st.y || 900) - pic.h / 2);
    g += `;[${input++}:v]format=rgba,${fades(st.s, st.e, 0.15)}[st${i}];[${top}][st${i}]overlay=${x}:${y}:enable='between(t,${st.s.toFixed(2)},${st.e.toFixed(2)})'[sk${i}]`;
    top = `sk${i}`;
  });
  g += subs ? `;[${top}]subtitles=caps.ass:fontsdir=.[v]` : `;[${top}]null[v]`;
  const sound = FX.audioGraph({ outDur, volumeDb, bleeps, sfx, music, firstInput: input });
  g += sound.graph;
  const still = (file) => ["-loop", "1", "-t", String(Math.ceil(outDur + 1)), "-i", file];
  const stills = [...pics.flatMap((pic) => still(path.basename(pic.file))), ...cards.flatMap((c) => still(c.file)), ...stickerPics.flatMap((pic) => still(path.basename(pic.file)))];
  await run(P.FFMPEG, ["-y", "-i", p.got, "-loop", "1", "-t", String(Math.ceil(outDur + 1)), "-i", "overlay.png", ...stills, ...sound.inputs, "-filter_complex", g,
    "-map", "[v]", "-map", "[aud]", "-t", outDur.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", out], { cwd: work });
  return { outDur, cut: p.dur - kept, notes: notes.length, layout, chatFrom, headCard };
}

// several Shorts in one: parts [{ file, dur }] joined in order with the theme's transition (and its sound)
async function joinParts(parts, out, work, th = theme()) {
  const n = parts.length;
  if (n === 1) { fs.copyFileSync(parts[0].file, out); return parts[0].dur; }
  const D = 0.35, kind = (th.join && th.join.transition) || "fade";
  let g = parts.map((_, i) => `[${i}:v]fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${i}];[${i}:a]${FX.AFMT},asetpts=PTS-STARTPTS[a${i}]`).join(";");
  let lv = "v0", la = "a0", off = 0; const joins = [];
  for (let i = 1; i < n; i++) {
    off += parts[i - 1].dur - D; joins.push(off);
    g += `;[${lv}][v${i}]xfade=transition=${kind}:duration=${D}:offset=${off.toFixed(3)}[xv${i}];[${la}][a${i}]acrossfade=d=${D}[xa${i}]`;
    lv = `xv${i}`; la = `xa${i}`;
  }
  const args = ["-y", ...parts.flatMap((p) => ["-i", p.file])];
  const sound = th.join && th.join.sound ? path.join(P.SOUNDS, "sfx", th.join.sound) : null;
  if (sound && fs.existsSync(sound)) {
    args.push("-i", sound);
    g += `;[${n}:a]${FX.AFMT},volume=0.8,asplit=${joins.length}` + joins.map((_, i) => `[s${i}]`).join("") + ";" +
      joins.map((j, i) => `[s${i}]adelay=${Math.round(j * 1000)}:all=1[d${i}]`).join(";") + `;[${la}]` + joins.map((_, i) => `[d${i}]`).join("") + `amix=inputs=${joins.length + 1}:normalize=0:duration=first[mix]`;
    la = "mix";
  }
  await run(P.FFMPEG, [...args, "-filter_complex", g, "-map", `[${lv}]`, "-map", `[${la}]`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out], { cwd: work });
  return parts.reduce((s, p) => s + p.dur, 0) - D * (n - 1);
}

// ---------- jobs (one at a time) ----------
const queue = []; let running = false;
function enqueue(fn) { return new Promise((res, rej) => { queue.push({ fn, res, rej }); pump(); }); }
async function pump() {
  if (running || !queue.length) return;
  running = true; const j = queue.shift();
  try { j.res(await j.fn()); } catch (e) { j.rej(e); } finally { running = false; pump(); }
}
const stepper = (id, extra = {}) => (x) => { log(id, x); return S.update(id, { status: "making", step: x, error: null, ...extra }); };
const describe = (title, by, channel, tags) => `${title}\n\n${by ? `Clipped by ${by} ` : ""}live on twitch.tv/${channel}\n\n${tags}`;
function layoutFor(clip, settings) {
  if (settings.obs && settings.obs.enabled) {
    const scene = OBS.sceneAt(new Date(Date.parse(clip.createdAt) - (clip.duration || 30) * 500));
    if (scene && settings.obs.map[scene] && LAYOUTS[settings.obs.map[scene]]) return { layout: settings.obs.map[scene], scene };
    return { layout: settings.layout, scene };
  }
  return { layout: settings.layout, scene: null };
}

// a clip (link or slug) -> a Short
function makeShort(slugOrUrl) {
  const clipSlug = T.slugFrom(slugOrUrl);
  if (!clipSlug) return Promise.reject(new Error("That doesn't look like a Twitch clip link"));
  const id = "c-" + clipSlug.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  if (!S.get(id)) S.update(id, { status: "queued", step: "Waiting", slug: clipSlug, title: "Clip" }); else S.update(id, { status: "queued", step: "Waiting", error: null });
  return enqueue(async () => {
    const step = stepper(id);
    try {
      await step("Asking Twitch");
      const clip = await T.clip(clipSlug), settings = S.settings(), { layout, scene } = layoutFor(clip, settings);
      const made = new Date(clip.createdAt), dir = path.join(S.outDir(), made.toISOString().slice(0, 10)), name = `${made.toTimeString().slice(0, 5).replace(":", "")}-${slug(clip.title)}`;
      const work = path.join(dir, name), out = path.join(dir, name + ".mp4"), thumb = path.join(dir, name + ".jpg");
      S.update(id, { title: clip.title, by: clip.by, views: clip.views, channel: clip.channel, clipUrl: clip.url, madeAt: clip.createdAt, clipSeconds: clip.duration,
        videoId: clip.videoId, videoOffset: clip.videoOffset, layout, scene, work, file: out, thumb });
      const p = await prepare(clip, work, step);
      const description = describe(clip.title, clip.by, clip.channel, settings.hashtags);
      const r = await render(clip, p, work, out, { layout, step, post: { title: clip.title, description, tiktok: "" } });
      await run(P.FFMPEG, ["-y", "-ss", thumbAt(r.outDur), "-i", out, "-frames:v", "1", "-vf", "scale=270:-2", thumb], { cwd: work });
      S.update(id, { status: "ready", step: "", seconds: +r.outDur.toFixed(1), trimmed: +r.cut.toFixed(1), chatNotes: r.notes, chatFrom: r.chatFrom, layout: r.layout,
        uploadTitle: clip.title, description, tiktokCaption: "", edits: null });
      log(id, `ready: ${out}`);
      return id;
    } catch (e) { log(id, "failed:", e.message); S.update(id, { status: "failed", error: e.message }); throw e; }
  });
}

// the editor's Save: rebuild from the files already there, with the saved edits (and any joined Shorts)
function editShort(id) {
  const s0 = S.get(id);
  if (!s0 || !s0.work) return Promise.reject(new Error("That Short can't be edited"));
  S.update(id, { status: "queued", step: "Waiting", error: null });
  return enqueue(async () => {
    const s = S.get(id), edits = S.edits(id), step = stepper(id), settings = S.settings(), th = theme(settings);
    try {
      const { clip, p } = await load(s, step);
      const up = edits.upload || {}, text = (v) => typeof v === "string" ? v : null;
      const post = { title: ((text(up.title) || "").trim() || edits.title || s.uploadTitle || s.title || "").replace(/\s*\n\s*/g, " "),
        description: text(up.description) ?? s.description ?? "", tiktok: text(up.tiktok) ?? s.tiktokCaption ?? "" };
      const join = edits.join || {}, joinIds = (Array.isArray(join.ids) ? join.ids : []).filter((x) => x && x !== id && S.get(x) && S.get(x).work);
      const oneTitle = joinIds.length > 0 && join.oneTitle !== false;
      const r = await render(clip, p, s.work, joinIds.length ? path.join(s.work, "main.mp4") : s.file, { layout: s.layout, step, edits, post, hideHead: oneTitle });
      let total = r.outDur;
      if (joinIds.length) {
        const parts = [{ file: path.join(s.work, "main.mp4"), dur: r.outDur }];
        for (const [i, jid] of joinIds.entries()) {
          const js = S.get(jid), jstep = (x) => step(`Clip ${i + 2} of ${joinIds.length + 1}: ${x}`);
          const loaded = await load(js, jstep), jwork = path.join(s.work, "join-" + i);
          fs.mkdirSync(jwork, { recursive: true });
          const jr = await render(loaded.clip, { ...loaded.p, got: path.join(js.work, loaded.p.got) }, jwork, path.join(jwork, "part.mp4"),
            { layout: js.layout, step: jstep, edits: S.edits(jid), hideHead: oneTitle, noEditData: true });
          parts.push({ file: path.join(jwork, "part.mp4"), dur: jr.outDur });
        }
        await step("Joining");
        const target = oneTitle && r.headCard ? path.join(s.work, "joined.mp4") : s.file;
        total = await joinParts(parts, target, s.work, join.slam === false ? { join: { transition: "fade" } } : th);
        if (oneTitle && r.headCard) {
          const c = r.headCard, e = c.e == null ? total : c.e;
          await run(P.FFMPEG, ["-y", "-i", target, "-loop", "1", "-t", String(Math.ceil(total + 1)), "-i", c.file, "-filter_complex",
            `[1:v]format=rgba,fade=t=in:st=${c.s.toFixed(2)}:d=0.25:alpha=1,fade=t=out:st=${Math.max(c.s, e - 0.25).toFixed(2)}:d=0.25:alpha=1[h];[0:v][h]overlay=0:0:enable='between(t,${c.s.toFixed(2)},${e.toFixed(2)})'[v]`,
            "-map", "[v]", "-map", "0:a", "-t", total.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", s.file], { cwd: s.work });
        }
      }
      await run(P.FFMPEG, ["-y", "-ss", thumbAt(total), "-i", s.file, "-frames:v", "1", "-vf", "scale=270:-2", s.thumb], { cwd: s.work });
      S.update(id, { status: "ready", step: "", seconds: +total.toFixed(1), trimmed: +r.cut.toFixed(1), chatNotes: r.notes, chatFrom: r.chatFrom, layout: r.layout,
        joined: joinIds.length || 0, uploadTitle: post.title, description: post.description, tiktokCaption: post.tiktok, edited: true });
      return id;
    } catch (e) { log(id, "edit failed:", e.message); S.update(id, { status: "failed", error: e.message }); throw e; }
  });
}

// best of the week: the channel's top clips, each cut to its best ~10 s, joined
function bestOf(channel, { count = 6, segment = 10 } = {}) {
  const now = new Date(), id = "week-" + now.toISOString().slice(0, 10);
  S.update(id, { status: "queued", step: "Waiting", kind: "week", title: "Best of the week", channel, error: null });
  return enqueue(async () => {
    const step = stepper(id), settings = S.settings(), th = theme(settings);
    try {
      await step("Finding the week's clips");
      const pick = (await T.channelClips(channel, "week")).filter((c) => c.duration >= 5).slice(0, count).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      if (pick.length < 2) throw new Error(`Only ${pick.length} clip${pick.length === 1 ? "" : "s"} this week - a best-of needs at least 2`);
      const dir = path.join(S.outDir(), "best-of"), work = path.join(dir, id), out = path.join(dir, id + ".mp4"), thumb = path.join(dir, id + ".jpg");
      const parts = [];
      for (const [i, c] of pick.entries()) {
        const clip = await T.clip(c.slug), pstep = (x) => step(`Clip ${i + 1} of ${pick.length}: ${x}`), pdir = path.join(work, "part-" + i);
        const p = await prepare(clip, pdir, pstep);
        const r = await render(clip, p, pdir, path.join(pdir, "part.mp4"), { layout: layoutFor(clip, settings).layout, step: pstep, trim: { ...settings.trim, target: segment, targetMax: segment + 2 }, kicker: "BEST OF THE WEEK", noEditData: true });
        parts.push({ file: path.join(pdir, "part.mp4"), dur: r.outDur });
      }
      await step("Joining");
      const total = await joinParts(parts, out, work, th);
      await run(P.FFMPEG, ["-y", "-ss", thumbAt(total), "-i", out, "-frames:v", "1", "-vf", "scale=270:-2", thumb], { cwd: work });
      const title = `Best of the week on ${channel}`, by = [...new Set(pick.map((c) => c.by).filter(Boolean))].join(", ");
      S.update(id, { status: "ready", step: "", file: out, thumb, work, seconds: +total.toFixed(1), views: pick.reduce((s, c) => s + c.views, 0), by, uploadTitle: title,
        description: describe(title, by, channel, settings.hashtags), clips: pick.length });
      return id;
    } catch (e) { log(id, "failed:", e.message); S.update(id, { status: "failed", error: e.message }); throw e; }
  });
}
// the editor's data for a Short (written by render)
function editData(id) { const s = S.get(id); if (!s || !s.work) return null; try { return JSON.parse(fs.readFileSync(path.join(s.work, "edit.json"), "utf8")); } catch (e) { return null; } }

module.exports = { LAYOUTS, DEFAULT_CROPS, theme, look, fit, planTrim, captionsAss, captionSpans, bleepText, render, joinParts, prepare, makeShort, editShort, bestOf, editData, busy: () => running || queue.length > 0 };
