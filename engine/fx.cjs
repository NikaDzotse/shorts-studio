"use strict";
// Effects for make-short.cjs: the Short's timeline with slow motion and freeze frames, zooms that push in and ease
// out, bleeps, sound effects, background music that dips under your voice, and stickers.
// All times here are on the Short's own timeline (seconds from its start) unless they say "clip".
const fs = require("fs");
const path = require("path");
const P = require("./paths.cjs");
const pictures = () => require("./pictures.cjs");   // Electron only (loaded when a sticker is drawn)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const f3 = (v) => (+v).toFixed(3);
const AFMT = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";

// ---------- the timeline: kept parts, played at their speed, with freeze frames in between ----------
// segs: [[a, b]...] clip seconds to keep; speeds: [{ a, b, speed }] clip ranges (0.25-1 slow, up to 2 fast);
// freezes: [{ t, d }] hold the picture at clip time t for d seconds.
// -> pieces in order: { kind: "play", a, b, speed, at } | { kind: "freeze", t, d, at }, and the Short's length
function buildPieces(segs, speeds = [], freezes = [], dur = Infinity) {
  const sp = (speeds || []).map((s) => ({ a: +s.a, b: +s.b, speed: clamp(+s.speed || 1, 0.25, 2) })).filter((s) => s.b - s.a >= 0.1 && s.speed !== 1);
  const fz = (freezes || []).map((f) => ({ t: +f.t, d: clamp(+f.d || 1, 0.1, 10) })).filter((f) => Number.isFinite(f.t));
  const used = new Set(), out = [];
  segs.forEach(([a, b], si) => {
    const pts = new Set([a, b]);
    for (const s of sp) for (const x of [s.a, s.b]) if (x > a + 0.02 && x < b - 0.02) pts.add(x);
    // a freeze in a cut part belongs to the next kept part; one past the end belongs to the last
    const here = fz.filter((f) => !used.has(f) && (f.t <= b + 0.02 || si === segs.length - 1));
    for (const f of here) if (f.t > a + 0.02 && f.t < b - 0.02) pts.add(f.t);
    const cuts = [...pts].sort((x, y) => x - y);
    for (let i = 0; i < cuts.length - 1; i++) {
      const x = cuts[i], y = cuts[i + 1];
      for (const f of here) if (!used.has(f) && (Math.abs(f.t - x) <= 0.02 || f.t < x)) { out.push({ kind: "freeze", t: x, d: f.d }); used.add(f); }
      if (y - x < 0.02) continue;
      const s = sp.find((q) => x >= q.a - 0.01 && y <= q.b + 0.01);
      out.push({ kind: "play", a: x, b: y, speed: s ? s.speed : 1 });
    }
    for (const f of here) if (!used.has(f) && f.t >= b - 0.02) { out.push({ kind: "freeze", t: Math.max(a, Math.min(b, dur) - 0.05), d: f.d }); used.add(f); }
  });
  let acc = 0;
  for (const p of out) { p.at = acc; acc += p.kind === "freeze" ? p.d : (p.b - p.a) / p.speed; }
  return { pieces: out, outDur: acc };
}
// clip time -> Short time (null if it was cut; `snap` moves cut moments to the next kept one). A moment right at a
// freeze lands at the start of the freeze.
function mapper(pieces) {
  return (t, snap) => {
    for (const p of pieces) {
      if (p.kind === "freeze") { if (Math.abs(t - p.t) <= 0.02) return p.at; if (t < p.t) return snap ? p.at : null; continue; }
      if (t >= p.a && t <= p.b) return p.at + (t - p.a) / p.speed;
      if (t < p.a) return snap ? p.at : null;
    }
    return null;
  };
}
// Short time -> clip time
function unmapper(pieces) {
  return (s) => {
    for (const p of pieces) {
      const len = p.kind === "freeze" ? p.d : (p.b - p.a) / p.speed;
      if (s <= p.at + len) return p.kind === "freeze" ? p.t : p.a + Math.max(0, s - p.at) * p.speed;
    }
    const l = pieces[pieces.length - 1];
    return l ? (l.kind === "freeze" ? l.t : l.b) : s;
  };
}
// atempo only goes from 0.5 to 2: chain it for slower
function atempo(speed) {
  if (speed === 1) return "";
  const parts = []; let r = speed;
  while (r < 0.5) { parts.push(0.5); r /= 0.5; }
  while (r > 2) { parts.push(2); r /= 2; }
  parts.push(r);
  return parts.map((x) => `atempo=${x.toFixed(4)},`).join("");
}
// input 0 -> [src] (30 fps video on the Short's timeline) and [aud0] (48 kHz stereo)
function piecesGraph(pieces, clipDur) {
  const plays = pieces.filter((p) => p.kind === "play");
  let g = `[0:v]split=${pieces.length}` + pieces.map((_, i) => `[pv${i}]`).join("") + ";";
  if (plays.length) g += `[0:a]asplit=${plays.length}` + plays.map((_, i) => `[pa${i}]`).join("") + ";";
  let ai = 0; const cat = [];
  pieces.forEach((p, i) => {
    if (p.kind === "play") {
      // slow motion blends neighbouring frames so it doesn't stutter
      g += `[pv${i}]trim=start=${f3(p.a)}:end=${f3(p.b)},setpts=(PTS-STARTPTS)/${p.speed},${p.speed < 1 ? "framerate=fps=30" : "fps=30"}[v${i}];`;
      g += `[pa${ai++}]atrim=start=${f3(p.a)}:end=${f3(p.b)},asetpts=PTS-STARTPTS,${atempo(p.speed)}${AFMT}[a${i}];`;
    } else {
      // a freeze: one frame, held; silence under it (sound effects can fill it)
      const t = Math.max(0, Math.min(p.t, clipDur - 0.12));
      g += `[pv${i}]trim=start=${f3(t)}:duration=0.2,setpts=PTS-STARTPTS,fps=30,trim=end_frame=1,tpad=stop_mode=clone:stop_duration=${f3(p.d)},trim=duration=${f3(p.d)},setpts=PTS-STARTPTS[v${i}];`;
      g += `anullsrc=r=48000:cl=stereo,atrim=duration=${f3(p.d)},${AFMT}[a${i}];`;
    }
    cat.push(`[v${i}][a${i}]`);
  });
  return g + cat.join("") + `concat=n=${pieces.length}:v=1:a=1[src][aud0]`;
}

// ---------- zoom: push in on a spot, hold, ease back out ----------
// events: [{ s, e, z, fx, fy, ramp }] on the Short's timeline (fx/fy: the spot to zoom on, 0-1 across the panel)
const smooth = (c) => `(${c})*(${c})*(3-2*(${c}))`;
function zoomChain(events, w, h) {
  if (!events.length) return "";
  const k = events.map((ev) => { const r = Math.max(0.05, Math.min(ev.ramp || 0.3, (ev.e - ev.s) / 2)); return smooth(`clip(min((t-${f3(ev.s)})/${f3(r)},(${f3(ev.e)}-t)/${f3(r)}),0,1)`); });
  const Z = "(1+" + events.reduce((acc, ev, i) => acc == null ? `${(ev.z - 1).toFixed(3)}*${k[i]}` : `max(${acc},${(ev.z - 1).toFixed(3)}*${k[i]})`, null) + ")";
  const pick = (key) => events.reduceRight((acc, ev, i) => `if(gt(${k[i]},0),${clamp(+ev[key], 0, 1).toFixed(3)},${acc})`, "0.5");
  return `,scale=w='trunc(${w}*${Z}/2)*2':h='trunc(${h}*${Z}/2)*2':eval=frame,crop=${w}:${h}:x='(iw-${w})*${pick("fx")}':y='(ih-${h})*${pick("fy")}'`;
}

// ---------- loudness: every sound effect and song is brought to the same level first, so the volume sliders mean
// the same thing for a quiet typewriter click and a loud meme sound ----------
const { spawnSync } = require("child_process");
const measured = new Map();
function loudness(file) {
  if (measured.has(file)) return measured.get(file);
  const r = spawnSync(P.FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=framelog=quiet:peak=true", "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
  const txt = (r.stderr || "") + (r.stdout || ""), i = /I:\s+(-?[\d.]+) LUFS/.exec(txt), pk = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(txt);
  const out = { lufs: i ? +i[1] : -20, peak: pk && pk[1] !== "-inf" ? +pk[1] : -1 };
  if (!(out.lufs > -70)) out.lufs = out.peak - 12;          // too short to measure (a click): go by its peak
  measured.set(file, out);
  return out;
}
// the gain that brings a file to `target` LUFS (never past -1 dB peak, never more than +12 dB)
const levelTo = (file, target) => { const m = loudness(file); return clamp(Math.min(target - m.lufs, -1 - m.peak), -30, 12); };

// ---------- sound: your volume, bleeps, sound effects, music (dipping under your voice) ----------
// sfx vol / music vol are dB on top of that level: sound effects sit at about your voice's loudness, music well under it
// in: [aud0]. inputs: the extra audio files are added by the caller at firstInput.. (sfx..., then music)
// -> { graph (ends in [aud]), inputs: [ffmpeg args...] }
function audioGraph({ outDur, volumeDb = 0, bleeps = [], sfx = [], music = null, firstInput }) {
  let g = "", cur = "aud0", n = firstInput;
  const inputs = [], mix = [];
  const chain = (label, f) => { g += `;[${cur}]${f}[${label}]`; cur = label; };
  if (volumeDb) chain("av", `volume=${volumeDb}dB`);
  const between = bleeps.map((b) => `between(t,${f3(b.s)},${f3(b.e)})`).join("+");
  if (bleeps.length) {
    chain("am", `volume='if(${between},0,1)':eval=frame`);
    // (the sine source is made at 1/8 of full scale: 2.2 brings the tone to about -12 dB, as loud as speech)
    g += `;sine=frequency=1000:sample_rate=48000,${AFMT},atrim=duration=${f3(outDur)},volume='if(${between},2.2,0)':eval=frame[beep]`;
    mix.push("[beep]");
  }
  for (const [i, s] of sfx.entries()) {
    inputs.push("-i", s.file);
    const ms = Math.round(s.at * 1000);
    g += `;[${n++}:a]${AFMT},volume=${(levelTo(s.file, -18) + (+s.vol || 0)).toFixed(1)}dB,adelay=${ms}|${ms}[fx${i}]`;
    mix.push(`[fx${i}]`);
  }
  if (music) {
    inputs.push("-stream_loop", "-1", "-i", music.file);
    const len = Math.max(0.5, music.e - music.s), ms = Math.round(music.s * 1000), fadeOut = Math.min(1.5, len / 3);
    g += `;[${n++}:a]atrim=start=${f3(music.offset || 0)},asetpts=PTS-STARTPTS,${AFMT},atrim=duration=${f3(len)},volume=${(levelTo(music.file, -31) + (+music.vol || 0)).toFixed(1)}dB,` +
      `afade=t=in:d=${Math.min(1, len / 3).toFixed(2)},afade=t=out:st=${f3(len - fadeOut)}:d=${fadeOut.toFixed(2)},adelay=${ms}|${ms}[mus]`;
    if (music.duck !== false) {
      // dips under your voice: the compressor listens to the clip's sound
      g += `;[${cur}]asplit=2[voice][side];[mus][side]sidechaincompress=threshold=0.02:ratio=10:attack=20:release=450[musd]`;
      cur = "voice"; mix.push("[musd]");
    } else mix.push("[mus]");
  }
  if (mix.length) g += `;[${cur}]${mix.join("")}amix=inputs=${mix.length + 1}:normalize=0:duration=first:dropout_transition=0,alimiter=limit=0.97[aud]`;
  else g += `;[${cur}]anull[aud]`;
  return { graph: g, inputs, next: n };
}

// ---------- stickers (sticker.html draws them, like the chat notes) ----------
// stickers: [{ kind, ... }] -> [{ file, w, h }] PNGs in outDir, each tight around the sticker (rotation included)
// stickers (shared\sticker.html) -> [{ file, w, h }] PNGs in outDir, each tight around the sticker (rotation included)
async function renderStickers(stickers, outDir) {
  return pictures().stickers(path.join(P.SHARED, "sticker.html"), stickers, outDir);
}

module.exports = { buildPieces, mapper, unmapper, piecesGraph, zoomChain, audioGraph, renderStickers, loudness, levelTo, atempo, AFMT };
