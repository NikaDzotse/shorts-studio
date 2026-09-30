"use strict";
// Shorts Studio - the big Short editor (one window per Short, opened from the main window's ✎ Edit).
// Everything a Short is made of can be changed here:
//   - which parts of the clip are kept: the waveform (wavesurfer.js); drag to keep or cut, split, delete, smart trim
//   - what is cut out of the picture: the boxes on the source clip (aspect locked to their place on the Short)
//   - where things sit on the Short: drag the captions, chat notes, your text, stickers, the picture, the seam
//   - every caption word and its timing and look; chat notes; your own text; stickers; zooms, slow motion, freezes;
//     sound effects, music, bleeps; the title and bottom cards; what gets posted; other Shorts joined after this one
// "Save & rebuild" hands the edits to the app (window.studio.saveEdit), which rebuilds the Short from the files it
// already has. ?dry=1 saves nowhere (tests).
(() => {
  const Q = new URLSearchParams(location.search);
  const ID = Q.get("id") || "", DRY = Q.has("dry");
  const studio = window.studio;
  const W = 1080, H = 1920, TOP = 150, BAND = 1500;       // the Short, and its video band (the same as make-short.cjs)
  const $ = (s, r = document) => r.querySelector(s);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const r2 = (v) => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : String(c));
    return n;
  }
  let toastTimer = 0;
  function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = "show" + (bad ? " bad" : ""); clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ""), 3000); }
  const fileSrc = (p) => studio.fileUrl(p);
  const fmt = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); return m + ":" + (t - m * 60).toFixed(2).padStart(5, "0"); };
  const typing = (t) => t && (t.tagName === "INPUT" && !["checkbox", "range", "color", "button"].includes(t.type) || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

  // ---------- loading (from the app) ----------
  let D = null, X = null, E = null, ws = null, SETTINGS = {}, THEMES = [], PRESETS = [], presetId = "", presetName = "";
  async function start() {
    wireStatic();
    const [got, list, lib, st, themes, presets] = await Promise.all([studio.editData(ID), studio.shorts(), studio.library(), studio.settings(), studio.themes(), studio.presets()]);
    THEMES = themes; PRESETS = presets;
    window.SHORTS = list; window.LIBRARY = lib; SETTINGS = st;
    X = got.item;
    if (!X) return blocked("This Short isn't there any more.");
    $("#name").textContent = X.title || "Short"; document.title = "Edit: " + (X.title || "Short");
    if (X.kind === "week") return blocked("A best-of is made from several clips, so it can't be edited here. Edit the Shorts it's made of, or join Shorts in the editor's Look tab.");
    if (!got.data) return blocked("This Short has nothing to edit yet. Press ↻ Remake on it in the main window, then Edit.");
    D = got.data;
    if (D.accent) document.documentElement.style.setProperty("--red", D.accent);
    E = fromD(); saved = JSON.stringify(E);
    $("#meta").textContent = [X.by && "clipped by " + X.by, X.scene, D.chatFrom === "vod" ? "chat from the VOD" : "no chat (no VOD for this clip)"].filter(Boolean).join(" · ");
    const v = $("#video");
    v.src = fileSrc(D.clip);
    initTimeline();
    new ResizeObserver(() => { sizeSource(); layoutPreview(); }).observe($("#ed"));
    sizeSource(); layoutPreview();
    v.addEventListener("loadeddata", () => (needDraw = true));
    v.addEventListener("seeked", () => (needDraw = true));
    refresh();
    requestAnimationFrame(loop);
    offerDraft();
    studio.onShorts(async (it) => {
      if (!it) return;
      window.SHORTS = await studio.shorts();
      if (it.id === ID) { X = { ...X, ...it }; if (waiting) { if (it.status === "making" || it.status === "queued") waiting.progress("Rebuilding: " + (it.step || "...")); else { const w = waiting; waiting = null; w.done(it); } } renderHead(); }
    });
    studio.onSettings((x) => { SETTINGS = x; });
    studio.onPresets((items) => {
      PRESETS = items;
      if (presetId && !items.some((p) => p.id === presetId)) { presetId = ""; presetName = ""; }
      if (tab === "look") renderPane();
    });
  }
  function blocked(text, ...extra) {
    $("#ed").replaceChildren(el("div", { class: "blocker" }, el("p", { text }), ...extra));
    for (const id of ["#save", "#undo", "#redo", "#revert"]) $(id).disabled = true;
  }
  // the rebuild's progress comes from the app (studio.onShorts, above)
  let waiting = null;
  function watchBuild(done, progress = () => {}) { waiting = { done, progress }; }

  // ---------- the edit ----------
  // E: what you are editing. Sizes and crops are kept for every layout, so trying another layout and coming back
  // keeps what you did there; only the chosen layout's are saved.
  function fromD() {
    const geoBy = {}, cropsBy = {};
    for (const [k, v] of Object.entries(D.layouts)) { geoBy[k] = clone(v.geo); cropsBy[k] = clone(v.crops); }
    geoBy[D.layout] = clone(D.geo); cropsBy[D.layout] = clone(D.crops);
    const f = D.frame || {}, fd = frameDefaults(), pick = (v, d) => typeof v === "string" ? v : d;
    const frame = { head: f.head !== false, foot: f.foot !== false, kicker: pick(f.kicker, fd.kicker), date: pick(f.date, fd.date), sub: pick(f.sub, ""),
      titleSize: +f.titleSize || 0, headY: Number.isFinite(+f.headY) && f.headY != null ? +f.headY : fd.headY,
      chan: pick(f.chan, fd.chan), byline: pick(f.byline, fd.byline), stamp: pick(f.stamp, fd.stamp), footY: Number.isFinite(+f.footY) && f.footY != null ? +f.footY : fd.footY,
      // when the cards show (clip seconds; null = the whole Short)
      headFrom: f.headFrom ?? null, headTo: f.headTo ?? null, footFrom: f.footFrom ?? null, footTo: f.footTo ?? null };
    // what gets posted (an empty title follows the title on the video; an empty TikTok caption is the title + hashtags)
    const post = D.post || {}, upTitle = pick(post.title, X.uploadTitle || "");
    const upload = { title: upTitle && upTitle !== (D.title || "") ? upTitle : "", description: pick(post.description, X.description || ""), tiktok: pick(post.tiktok, X.tiktokCaption || "") };
    // the effects come back as they were saved
    const ed = D.edits || {}, list = (k) => Array.isArray(ed[k]) ? clone(ed[k]) : [];
    const join = ed.join && Array.isArray(ed.join.ids) ? { ids: [...ed.join.ids], slam: ed.join.slam !== false, oneTitle: ed.join.oneTitle !== false } : { ids: [], slam: true, oneTitle: true };
    return { appearance: { theme: D.theme || SETTINGS.theme, accent: D.accent }, layout: D.layout, title: D.title || "", frame, upload, volume: +D.volume || 0,
      segs: clone(D.segs), geoBy, cropsBy, cap: { style: "classic", ...clone(D.cap) }, captions: D.captions !== false, words: clone(D.words),
      chatOn: D.chatOn !== false, notes: clone(D.notes), noteWidth: D.noteWidth, texts: (D.texts || []).map(normText),
      speeds: list("speeds"), freezes: list("freezes"), zooms: list("zooms"), sfx: list("sfx"), stickers: list("stickers"),
      music: ed.music && ed.music.file ? clone(ed.music) : null, join,
      cutsKnown: remember(remember(gaps(D.autoSegs || []), Array.isArray(ed.cutsKnown) ? ed.cutsKnown : []), gaps(D.segs || [])) };
  }
  // the frame as make-short.cjs draws it when nothing was changed (edit.js from before 2026-09-30 lacks some of these)
  function frameDefaults() {
    const f = D.frame || {};
    return { kicker: "", date: f.date || "", headY: 222, footY: 1400, chan: SETTINGS.channel ? "twitch.tv/" + SETTINGS.channel : "",
      byline: f.by ? "clipped by " + f.by : "", stamp: "", ...(D.frameDefaults || {}) };
  }
  const hashtags = () => (D.post && D.post.hashtags) || ["#shorts", "#twitch"];
  const normText = (x) => ({ text: String(x.text || ""), t: +x.t || 0, e: +x.e || (+x.t || 0) + 2, y: Math.round(+x.y || 900), size: Math.round(+x.size || 80), color: x.color || "#ffffff", box: !!x.box });
  function toEdits() {
    const l = E.layout;
    return { v: 2, appearance: E.appearance, title: E.title.trim(), layout: l, segs: segsN().map(([a, b]) => [r2(a), r2(b)]), geo: E.geoBy[l], crops: E.cropsBy[l], frame: E.frame,
      volume: E.volume, upload: { title: E.upload.title.trim(), description: E.upload.description, tiktok: E.upload.tiktok.trim() },
      captions: E.captions, cap: E.cap, words: E.words.map((w) => ({ w: w.w, s: r2(w.s), e: r2(w.e), ...(w.color ? { color: w.color } : {}), ...(w.bleep ? { bleep: true } : {}), ...(w.emoji ? { emoji: w.emoji } : {}) })),
      chat: E.chatOn, notes: E.notes.map((n) => ({ key: n.key, t: r2(n.t), x: Math.round(n.x), y: Math.round(n.y), hold: r2(n.hold), ...(n.text && n.text.trim() ? { text: n.text.trim() } : {}) })),
      noteWidth: Math.round(E.noteWidth), texts: E.texts.map((x) => ({ ...x, t: r2(x.t), e: r2(x.e) })),
      speeds: E.speeds.map((s) => ({ a: r2(s.a), b: r2(s.b), speed: s.speed })), freezes: E.freezes.map((f) => ({ t: r2(f.t), d: r2(f.d) })),
      zooms: E.zooms.map((z) => ({ ...z, t: r2(z.t), e: r2(z.e) })), sfx: E.sfx.map((x) => ({ ...x, t: r2(x.t) })), music: E.music,
      stickers: E.stickers.map((x) => ({ ...x, t: r2(x.t), e: r2(x.e) })), join: E.join,
      cutsKnown: remember(E.cutsKnown, gaps(segsN())).map(([a, b]) => [r2(a), r2(b)]) };
  }
  const dur = () => D.clipSeconds;
  const geo = () => E.geoBy[E.layout];
  const crops = () => E.cropsBy[E.layout];
  const defs = (l = E.layout) => D.layouts[l];
  const isSplit = () => E.layout === "split";

  // history: every change is one step back (a slider or a drag is one step, not hundreds)
  let hist = [], fut = [], saved = "", mergeKey = "", mergeAt = 0, ver = 0, busy = false, status = { kind: "", text: "" };
  function change(fn, { merge = "", insp = true, lanes = true, except = "", track = true } = {}) {
    const before = JSON.stringify(E), segsBefore = JSON.stringify(E.segs), cutsBefore = gaps(segsN());
    fn(E);
    // a part that was cut and is back in the Short stays under Cuts, so it can be cut again
    if (track && JSON.stringify(E.segs) !== segsBefore) E.cutsKnown = remember(E.cutsKnown || [], cutsBefore);
    if (JSON.stringify(E) === before) return false;
    const now = Date.now();
    if (!(merge && merge === mergeKey && now - mergeAt < 1500)) { hist.push(before); if (hist.length > 300) hist.shift(); }
    mergeKey = merge; mergeAt = now; fut = [];
    ver++; refresh({ insp, lanes, except }); keepDraft();
    return true;
  }
  function undo() { if (!hist.length) return; fut.push(JSON.stringify(E)); E = JSON.parse(hist.pop()); mergeKey = ""; ver++; refresh(); keepDraft(); }
  function redo() { if (!fut.length) return; hist.push(JSON.stringify(E)); E = JSON.parse(fut.pop()); mergeKey = ""; ver++; refresh(); keepDraft(); }
  // ---------- drafts: unsaved changes survive a crash or a killed app (the app keeps them in its data folder; saving,
  // or closing without saving, throws them away) ----------
  let draftTimer = 0;
  function keepDraft() {
    if (DRY) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { if (!E) return; const now = JSON.stringify(E); (now === saved ? studio.dropDraft(ID) : studio.saveDraft(ID, now)).catch(() => {}); }, 800);
  }
  function dropDraft() { clearTimeout(draftTimer); if (!DRY) studio.dropDraft(ID).catch(() => {}); }
  async function offerDraft() {
    if (DRY) return;
    const d = await studio.draft(ID).catch(() => null);
    if (!d || !d.E || d.E === saved) return;
    if (X.updatedAt && d.at < Date.parse(X.updatedAt)) return dropDraft();   // the Short was rebuilt since: the draft is out of date
    const when = new Date(d.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const bar = el("div", { id: "draftbar" },
      el("span", { text: `Changes from ${when} weren't saved (the editor closed before Save & rebuild).` }),
      el("button", { class: "primary", id: "draft-restore", text: "Restore them", onclick: () => {
        bar.remove(); hist.push(JSON.stringify(E)); E = JSON.parse(d.E); mergeKey = ""; ver++; refresh(); keepDraft();
        toast("Unsaved changes restored. Save & rebuild keeps them.");
      } }),
      el("button", { id: "draft-discard", text: "Discard", onclick: () => { bar.remove(); dropDraft(); } }));
    document.body.append(bar);
  }
  function refresh({ insp = true, lanes = true, except = "" } = {}) {
    document.documentElement.style.setProperty("--red", E.appearance.accent || "#ef443b");
    if (lanes) syncLanes(except); else renderTrackLabels();
    renderBoxes(); layoutPreview(); frameSrc(); overlayKey = ""; needDraw = true;
    $("#video").volume = Math.min(1, Math.pow(10, (E.volume || 0) / 20));   // the preview can only play it quieter
    if (insp) renderPane();
    renderHead();
  }

  // ---------- time: the kept parts, and clip time <-> Short time ----------
  // (overlapping parts join; touching ones stay apart so a split can be deleted)
  function segsN(segs = E.segs) {
    const s = segs.map(([a, b]) => [clamp(+a, 0, dur()), clamp(+b, 0, dur())]).filter(([a, b]) => b - a >= 0.1).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [a, b] of s) { const l = out[out.length - 1]; if (l && a < l[1] - 0.001) l[1] = Math.max(l[1], b); else out.push([a, b]); }
    return out;
  }
  // the Short's timeline: the kept parts at their speed, with freeze frames in between (the same as shorts\fx.cjs)
  function buildPieces(segs, speeds, freezes) {
    const sp = (speeds || []).map((s) => ({ a: +s.a, b: +s.b, speed: clamp(+s.speed || 1, 0.25, 2) })).filter((s) => s.b - s.a >= 0.1 && s.speed !== 1);
    const fz = (freezes || []).map((f) => ({ t: +f.t, d: clamp(+f.d || 1, 0.1, 10) })).filter((f) => Number.isFinite(f.t));
    const used = new Set(), out = [];
    segs.forEach(([a, b], si) => {
      const pts = new Set([a, b]);
      for (const s of sp) for (const x of [s.a, s.b]) if (x > a + 0.02 && x < b - 0.02) pts.add(x);
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
      for (const f of here) if (!used.has(f) && f.t >= b - 0.02) { out.push({ kind: "freeze", t: Math.max(a, b - 0.05), d: f.d }); used.add(f); }
    });
    let acc = 0;
    for (const p of out) { p.at = acc; acc += p.kind === "freeze" ? p.d : (p.b - p.a) / p.speed; }
    return { pieces: out, outDur: acc };
  }
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
  function unmapper(pieces) {
    return (s) => {
      for (const p of pieces) { const len = p.kind === "freeze" ? p.d : (p.b - p.a) / p.speed; if (s <= p.at + len) return p.kind === "freeze" ? p.t : p.a + Math.max(0, s - p.at) * p.speed; }
      const l = pieces[pieces.length - 1]; return l ? (l.kind === "freeze" ? l.t : l.b) : s;
    };
  }
  const bleepText = (x) => { const m = /^(.)(.*?)([.,!?…'"]*)$/s.exec(x); return m ? m[1] + "*".repeat(Math.max(2, Math.min(4, m[2].length))) + m[3] : "***"; };
  // how loud the preview plays a library file (the Short itself brings every file to the same level, see fx.cjs)
  const libEntry = (file) => { const L = window.LIBRARY || {}; return [...(L.sfx || []), ...(L.music || [])].find((x) => x.file === file); };
  const previewGain = (file, target, vol) => { const x = libEntry(file); const g = x ? clamp(Math.min(target - x.lufs, -1 - x.peak), -30, 12) : 0; return clamp(Math.pow(10, (g + (+vol || 0)) / 20), 0, 1); };
  const gaps = (segs) => { const out = []; let at = 0; for (const [a, b] of segs) { if (a - at > 0.01) out.push([at, a]); at = b; } if (dur() - at > 0.01) out.push([at, dur()]); return out; };
  // ---------- cuts: every part that was ever cut stays listed, so it can be put back and cut again ----------
  const overlaps = ([a, b], [c, d]) => Math.min(b, d) - Math.max(a, c) > 0.05;
  function mergeCuts(list) {
    const s = list.map(([a, b]) => [clamp(+a, 0, dur()), clamp(+b, 0, dur())]).filter(([a, b]) => b - a >= 0.1).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [a, b] of s) { const l = out[out.length - 1]; if (l && a < l[1] - 0.05) l[1] = Math.max(l[1], b); else out.push([a, b]); }
    return out;
  }
  // adds cuts to the list; a newer version of a cut (made shorter or longer on the timeline) replaces the old one
  const remember = (known, newer) => mergeCuts([...mergeCuts(known).filter((k) => !newer.some((n) => overlaps(k, n))), ...newer]);
  // the cuts now (the gaps between kept parts) and the ones put back, in time order
  function cutList() {
    const now = gaps(segsN()).filter(([a, b]) => b - a >= 0.1).map(([a, b]) => ({ a, b, on: true }));
    const back = (E.cutsKnown || []).filter((k) => !now.some((c) => overlaps([c.a, c.b], k))).map(([a, b]) => ({ a, b, on: false }));
    return [...now, ...back].sort((x, y) => x.a - y.a);
  }
  // parts that touch where a cut was removed become one part again (a split made on purpose stays split)
  const joinAt = (segs, pts) => { const out = []; for (const [x, y] of segs) { const l = out[out.length - 1]; if (l && Math.abs(x - l[1]) < 0.002 && pts.some((p) => Math.abs(p - x) < 0.002)) l[1] = Math.max(l[1], y); else out.push([x, y]); } return out; };
  function uncut(a, b) { sel = null; change((E) => { E.segs = joinAt(segsN([...segsN(), [a, b]]), [a, b]); }); toast(`Cut removed: ${(b - a).toFixed(1)} s is back in the Short`); }
  function recut(a, b) {
    const left = segsN(subtract(segsN(), a, b));
    if (!left.length) return toast("That would cut the whole clip", true);
    sel = null; change((E) => { E.segs = left; }); toast(`Cut again: ${(b - a).toFixed(1)} s out`);
  }
  // In/Out marks (I and O): a blue band over every track; X cuts it out, Enter keeps it
  const markRange = () => mark.in != null && mark.out != null && Math.abs(mark.out - mark.in) >= 0.05 ? { a: Math.min(mark.in, mark.out), b: Math.max(mark.in, mark.out) } : { a: null, b: null };
  function drawMark() {
    const has = markRange().a != null;
    for (const id of ["#mark-cut", "#mark-keep"]) { const b = $(id); if (b) b.disabled = !has; }
    if (!R.mark || !ws || !TR.total) return;
    R.mark.clearRegions();
    const put = (opts) => { const r = R.mark.addRegion({ drag: false, resize: false, ...opts }); if (r.element) { r.element.style.pointerEvents = "none"; r.element.style.top = "0px"; r.element.style.height = TR.total + "px"; } return r; };
    const { a, b } = markRange();
    if (a != null) { const r = put({ start: a, end: b, color: "rgba(106,168,255,.14)", content: label(`In–Out ${(b - a).toFixed(2)} s · X cuts it · Enter keeps it`) }); if (r.element) r.element.style.borderLeft = r.element.style.borderRight = "2px solid #6aa8ff"; }
    else for (const [t, name] of [[mark.in, "In"], [mark.out, "Out"]]) if (t != null) put({ start: t, color: "#6aa8ff", content: label(name) });
  }
  function setMark(which) {
    if (!E) return;
    mark[which] = r2(now()); drawMark();
    const { a, b } = markRange();
    toast(a != null ? `Marked ${fmt(a)} – ${fmt(b)} (${(b - a).toFixed(2)} s): X cuts it out, Enter keeps it` : `${which === "in" ? "In" : "Out"} at ${fmt(now())}. Now press ${which === "in" ? "O at the end" : "I at the start"}.`);
  }
  function clearMarks() { mark = { in: null, out: null }; drawMark(); }
  function cutMarked(keep) {
    if (!E) return;
    const { a, b } = markRange();
    if (a == null) return toast("Mark a part first: I at its start, O at its end");
    if (keep) change((E) => { E.segs = joinAt(segsN([...segsN(), [a, b]]), [a, b]); });
    else { const left = segsN(subtract(segsN(), a, b)); if (!left.length) return toast("That would cut the whole clip", true); change((E) => { E.segs = left; }); }
    toast(`${keep ? "Kept" : "Cut out"} ${fmt(a)} – ${fmt(b)} (${(b - a).toFixed(2)} s)`);
    clearMarks();
  }
  // edges you drag snap to where words start and end, the playhead and the marks (hold Alt to place them freely)
  function snap(t) {
    if (altHeld || !ws || !E) return t;
    const room = 8 / ((ws.getWrapper().scrollWidth || 800) / dur());
    let best = t, bestD = room;
    const test = (x) => { if (x == null) return; const d = Math.abs(x - t); if (d < bestD) { bestD = d; best = x; } };
    for (const w of E.words) { test(w.s); test(w.e); }
    test(now()); test(mark.in); test(mark.out); test(0); test(dur());
    return r2(best);
  }
  // cut by words: the words in time order; a cut takes the pause before the words with it and keeps the one after
  const sortedWords = () => [...E.words].sort((a, b) => a.s - b.s);
  function wordsRange(i, j, back) {
    const W = sortedWords(), a = W[i], b = W[j], prev = W[i - 1], next = W[j + 1];
    // putting words back brings the pauses around them too (up to 0.6 s each side), so it undoes a cut by words exactly
    if (back) return [prev ? Math.max(prev.e, a.s - 0.6) : Math.max(0, a.s - 0.6), next ? Math.min(next.s, b.e + 0.6) : Math.min(dur(), b.e + 0.6)];
    return [prev ? prev.e + Math.min(0.08, Math.max(0, a.s - prev.e) / 2) : Math.max(0, a.s - 0.08),
      next ? Math.max(b.e, Math.min(next.s - 0.02, b.e + 0.05)) : Math.min(dur(), b.e + 0.15)];
  }
  function cutWords(back) {
    if (!wsel || !E) return;
    const i = Math.min(wsel.a, wsel.b), j = Math.max(wsel.a, wsel.b), [a, b] = wordsRange(i, j, back).map(r2);
    if (b - a < 0.03) return;
    if (back) change((E) => { E.segs = joinAt(segsN([...segsN(), [a, b]]), [a, b]); });
    else { const left = segsN(subtract(segsN(), a, b)); if (!left.length) return toast("That would cut the whole clip", true); change((E) => { E.segs = left; }); }
    toast(`${back ? "Put back" : "Cut out"} ${j - i + 1} word${j > i ? "s" : ""} (${(b - a).toFixed(2)} s)`);
  }
  // a cut's exact times, typed in the Cuts tab
  function editCut(c, a2, b2) {
    a2 = r2(clamp(a2, 0, dur())); b2 = r2(clamp(b2, 0, dur()));
    if (b2 - a2 < 0.1) return toast("A cut needs at least 0.1 s", true);
    if (!c.on) return change((E) => { E.cutsKnown = remember(E.cutsKnown.filter((k) => !overlaps(k, [c.a, c.b])), [[a2, b2]]); });
    const left = segsN(subtract(joinAt(segsN([...segsN(), [c.a, c.b]]), [c.a, c.b]), a2, b2));
    if (!left.length) return toast("That would cut the whole clip", true);
    change((E) => { E.cutsKnown = E.cutsKnown.filter((k) => !overlaps(k, [c.a, c.b])); E.segs = left; }, { track: false });
  }
  // plays across a cut the way the Short will: a little before it, the jump, a little after
  function checkJoin(c) {
    if (c.on) { $("#skipcuts").checked = true; seekTo(Math.max(0, c.a - 1.5)); stopAt = Math.min(dur(), c.b + 1.5); }
    else { seekTo(Math.max(0, c.a - 0.5)); stopAt = Math.min(dur(), c.b + 0.5); }
    if ($("#video").paused) togglePlay();
  }
  function forgetCut(a, b) { sel = null; change((E) => { E.cutsKnown = E.cutsKnown.filter((k) => !overlaps(k, [a, b])); }); }
  const subtract = (segs, a, b) => segs.flatMap(([x, y]) => y <= a || x >= b ? [[x, y]] : [x < a ? [x, a] : null, y > b ? [b, y] : null].filter(Boolean));
  // captions exactly as make-short.cjs groups them
  function captionGroups(words, group) {
    const groups = []; let g = [];
    words.forEach((w, i) => { g.push(w); const next = words[i + 1]; if (g.length >= group || !next || next.s - w.e > 0.45 || /[.!?]$/.test(w.w)) { groups.push(g); g = []; } });
    return groups;
  }
  // everything on the Short's timeline, worked out again only when something changed
  let memo = { ver: -1 };
  function mm() {
    if (memo.ver === ver) return memo;
    const segs = segsN(), { pieces, outDur } = buildPieces(segs, E.speeds, E.freezes), map = mapper(pieces), unmap = unmapper(pieces);
    const words = (E.captions ? E.words : []).map((w, i) => ({ w: w.w, i, color: w.color, bleep: w.bleep, emoji: w.emoji, s: map(w.s), e: map(Math.min(w.e, dur())) })).filter((w) => w.s != null)
      .map((w) => ({ ...w, e: w.e == null ? w.s + 0.3 : Math.max(w.e, w.s + 0.1) }));
    // a clip-time stretch on the Short's timeline (null if it's all cut)
    const span = (t, e) => { const s = map(Math.max(0, +t || 0), true); if (s == null) return null; const x = map(Math.min(dur(), +e || 0), true); return { s, e: x == null ? outDur : x }; };
    const groups = captionGroups(words, clamp(Math.round(E.cap.group) || 3, 1, 6)), spans = [];
    groups.forEach((grp, gi) => grp.forEach((w, i) => {
      const nextStart = i + 1 < grp.length ? grp[i + 1].s : groups[gi + 1] ? groups[gi + 1][0].s : Infinity;
      spans.push({ s: w.s, e: i + 1 < grp.length ? nextStart : Math.min(nextStart, Math.max(w.e, w.s + 0.25) + 0.5), grp, i, gi });
    }));
    const byKey = new Map(D.chat.map((m) => [m.key, m]));
    const notes = E.chatOn ? E.notes.map((n, idx) => {
      const m = byKey.get(n.key); if (!m) return null;
      const at = map(Math.max(0, n.t), true); if (at == null || at > outDur - 0.3) return null;
      return { n, m, idx, at, until: Math.min(outDur, at + clamp(n.hold || 3, 0.5, 15)) };
    }).filter(Boolean) : [];
    const texts = E.texts.map((x, idx) => { const s = map(Math.max(0, x.t), true); if (s == null) return null; const e = map(Math.min(dur(), x.e), true); return { x, idx, s, e: e == null ? outDur : e }; }).filter((x) => x && x.e - x.s >= 0.1);
    // when each card shows on the Short (the same sums as make-short.cjs)
    const card = (on, from, to) => { if (!on) return null; const s = from == null ? 0 : map(Math.max(0, from), true) ?? outDur; const e = to == null ? outDur : map(Math.min(dur(), to), true) ?? outDur; return { s, e }; };
    const head = card(E.frame.head, E.frame.headFrom, E.frame.headTo), foot = card(E.frame.foot, E.frame.footFrom, E.frame.footTo);
    // zooms per panel (the camera or the game in split; the picture otherwise), stickers, an emoji over captions
    const zooms = { face: [], game: [], main: [] };
    E.zooms.forEach((z, idx) => { const sp = span(z.t, z.e); if (!sp || sp.e - sp.s < 0.2) return; zooms[isSplit() ? (z.target === "game" ? "game" : "face") : "main"].push({ ...sp, z: +z.z || 1.35, fx: z.fx ?? 0.5, fy: z.fy ?? 0.45, ramp: +z.ramp || 0.3, idx }); });
    const stickers = E.stickers.map((x, idx) => { const sp = span(x.t, x.e); return sp && sp.e - sp.s >= 0.1 ? { x, idx, ...sp } : null; }).filter(Boolean);
    const emojis = [];
    for (const sp of spans) if (sp.i === 0) { const w = sp.grp.find((q) => q.emoji); if (w) { const last = spans.filter((q) => q.gi === sp.gi).pop(); emojis.push({ emoji: w.emoji, s: sp.s, e: last.e }); } }
    // sounds: effects at their moment, the music bed, bleeps
    const sfx = E.sfx.map((x, idx) => ({ x, idx, at: map(Math.max(0, +x.t || 0), true) })).filter((x) => x.at != null && x.at < outDur - 0.05);
    const music = E.music && E.music.file ? (() => { const s = E.music.t == null ? 0 : map(Math.max(0, E.music.t), true) ?? 0, e = E.music.e == null ? outDur : map(Math.min(dur(), E.music.e), true) ?? outDur; return e - s > 0.5 ? { s, e } : null; })() : null;
    const bleeps = E.words.filter((w) => w.bleep).map((w) => span(w.s, w.e)).filter(Boolean);
    memo = { ver, segs, pieces, map, unmap, outDur, spans, notes, texts, head, foot, zooms, stickers, emojis, sfx, music, bleeps };
    return memo;
  }

  // ---------- the source clip and its crop boxes ----------
  let srcScale = 0.5;
  function sizeSource() {
    const wrap = $("#stage-wrap"); if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    let w = r.width - 20, h = w * 9 / 16;
    if (h > r.height - 6) { h = r.height - 6; w = h * 16 / 9; }
    if (w < 50) return;
    const src = $("#src"); src.style.width = w + "px"; src.style.height = h + "px"; srcScale = w / 1920;
    renderBoxes();
  }
  const BOX = { face: ["CAMERA", "#6aa8ff"], game: ["GAME", "#3fcf8e"], main: ["PICTURE", "#ef443b"] };
  // a crop of box with the given aspect, centred, inside the picture (make-short.cjs fit(), in 1920x1080 pixels)
  function fitBox(b, aspect) {
    let w = Math.min(b.w, 1920), h = Math.min(b.h, 1080);
    if (w / h > aspect) w = h * aspect; else h = w / aspect;
    return { x: clamp(b.x + (b.w - w) / 2, 0, 1920 - w), y: clamp(b.y + (b.h - h) / 2, 0, 1080 - h), w, h };
  }
  const aspects = () => { const g = geo(); return isSplit() ? { face: W / g.faceH, game: W / (BAND - g.faceH) } : { main: W / g.h }; };
  const roundBox = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
  // after a size change on the Short: the same spot of the picture, about as much of it, in the new shape
  function reaspect(e = E) {
    const g = e.geoBy[e.layout], a = e.layout === "split" ? { face: W / g.faceH, game: W / (BAND - g.faceH) } : { main: W / g.h }, c = e.cropsBy[e.layout];
    for (const k of Object.keys(a)) {
      const b = c[k]; if (!b) continue;
      let w = Math.sqrt(b.w * b.h * a[k]), h = w / a[k];
      if (w > 1920) { w = 1920; h = w / a[k]; } if (h > 1080) { h = 1080; w = h * a[k]; }
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      c[k] = roundBox({ x: clamp(cx - w / 2, 0, 1920 - w), y: clamp(cy - h / 2, 0, 1080 - h), w, h });
    }
  }
  function renderBoxes() {
    if (!E) return;
    const host = $("#boxes"), c = crops(), a = aspects(), keys = Object.keys(a), s = srcScale;
    for (const n of [...host.querySelectorAll(".box")]) if (!keys.includes(n.dataset.k)) n.remove();
    let dim = $("#dim");
    if (!dim) { dim = document.createElementNS("http://www.w3.org/2000/svg", "svg"); dim.id = "dim"; dim.setAttribute("viewBox", "0 0 1920 1080"); dim.setAttribute("preserveAspectRatio", "none");
      dim.innerHTML = '<path fill="rgba(0,0,0,.45)" fill-rule="evenodd"/>'; host.prepend(dim); }
    let d = "M0 0H1920V1080H0Z";
    for (const k of keys) {
      const b = fitBox(c[k], a[k]);
      d += `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`;
      let n = host.querySelector(`.box[data-k="${k}"]`);
      if (!n) {
        n = el("div", { class: "box", "data-k": k, style: `--c:${BOX[k][1]}` }, el("span", { class: "lab", text: BOX[k][0] }), ["nw", "ne", "sw", "se"].map((h) => el("i", { class: "h " + h, "data-h": h })));
        n.addEventListener("pointerdown", boxDown); host.append(n);
      }
      Object.assign(n.style, { left: b.x * s + "px", top: b.y * s + "px", width: b.w * s + "px", height: b.h * s + "px" });
    }
    dim.firstChild.setAttribute("d", d);
  }
  function boxDown(ev) {
    ev.preventDefault();
    const k = ev.currentTarget.dataset.k, h = ev.target.dataset.h || "", aspect = aspects()[k];
    const start = fitBox(crops()[k], aspect), x0 = ev.clientX, y0 = ev.clientY, s = srcScale, key = "crop" + k + x0 + y0;
    const move = (e) => {
      const dx = (e.clientX - x0) / s, dy = (e.clientY - y0) / s;
      let b;
      if (!h) b = { ...start, x: clamp(start.x + dx, 0, 1920 - start.w), y: clamp(start.y + dy, 0, 1080 - start.h) };
      else {
        // the opposite corner stays put; the size follows whichever way the pointer moved more
        const left = h.includes("w"), up = h.includes("n");
        const ax = left ? start.x + start.w : start.x, ay = up ? start.y + start.h : start.y;
        const wx = left ? start.w - dx : start.w + dx, wy = (up ? start.h - dy : start.h + dy) * aspect;
        const maxW = Math.min(left ? ax : 1920 - ax, (up ? ay : 1080 - ay) * aspect);
        const w = clamp(Math.abs(wx - start.w) > Math.abs(wy - start.w) ? wx : wy, 60, maxW), hh = w / aspect;
        b = { x: left ? ax - w : ax, y: up ? ay - hh : ay, w, h: hh };
      }
      change((E) => { E.cropsBy[E.layout][k] = roundBox(b); }, { merge: key, insp: false, lanes: false });
    };
    const upH = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", upH); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", upH);
  }

  // ---------- the Short preview ----------
  let pvK = 0.3, needDraw = true, overlayKey = "";
  const cv = $("#pv-canvas"), ctx = cv.getContext("2d");
  const tiny = Object.assign(document.createElement("canvas"), { width: 54, height: 75 }), tctx = tiny.getContext("2d");
  function layoutPreview() {
    const wrap = $("#pv-wrap"), col = $("#preview-col"); if (!wrap || !col) return;
    const h = wrap.getBoundingClientRect().height;
    const k = clamp(h / H, 0.12, 0.6);
    if (Math.abs(k - pvK) > 0.001 || !wrap.style.width) { pvK = k; $("#pv").style.transform = `scale(${k})`; wrap.style.width = Math.round(W * k + 20) + "px"; }
  }
  // the preview's clock on the Short's timeline: a freeze holds the picture while the time runs on
  let frozen = null;   // { at (Short s), d, t (clip s), started (ms), rate }
  function shortNow() {
    const m = mm();
    if (frozen) return frozen.at + Math.min(frozen.d, (performance.now() - frozen.started) / 1000 * frozen.rate);
    return m.map($("#video").currentTime, true) ?? m.outDur;
  }
  // how far a panel is zoomed at Short time s (like fx.cjs zoomChain: the biggest zoom wins, the first one active picks the spot)
  function zoomAt(list, s) {
    let z = 1, fx = 0.5, fy = 0.5, spot = false;
    for (const ev of list || []) {
      const r = Math.max(0.05, Math.min(ev.ramp, (ev.e - ev.s) / 2)), c = clamp(Math.min((s - ev.s) / r, (ev.e - s) / r), 0, 1), k = c * c * (3 - 2 * c);
      if (k > 0) { z = Math.max(z, 1 + (ev.z - 1) * k); if (!spot) { fx = clamp(ev.fx, 0, 1); fy = clamp(ev.fy, 0, 1); spot = true; } }
    }
    return { z, fx, fy };
  }
  function draw() {
    if (!E) return;
    const v = $("#video"), S = 0.5;
    ctx.fillStyle = "#0d0e11"; ctx.fillRect(0, 0, 540, 960);
    if (v.readyState < 2 || !v.videoWidth) return;
    const k = v.videoWidth / 1920, g = geo(), c = crops(), m = mm(), sNow = shortNow();
    const put = (b, aspect, y, h, zkey) => {
      const f = fitBox(b, aspect), zm = zoomAt(m.zooms[zkey], sNow), w = f.w / zm.z, hh = f.h / zm.z;
      ctx.drawImage(v, (f.x + (f.w - w) * zm.fx) * k, (f.y + (f.h - hh) * zm.fy) * k, w * k, hh * k, 0, y * S, W * S, h * S);
    };
    if (isSplit()) { put(c.face, W / g.faceH, TOP, g.faceH, "face"); put(c.game, W / (BAND - g.faceH), TOP + g.faceH, BAND - g.faceH, "game"); return; }
    if (!(g.h >= BAND && g.y <= TOP)) {
      // the blurred band behind: the whole picture cover-cropped to the band, shrunk to a few pixels and blown up again
      const vw = v.videoWidth, vh = v.videoHeight, sw = vh * W / BAND;
      tctx.drawImage(v, (vw - sw) / 2, 0, sw, vh, 0, 0, 54, 75);
      ctx.save(); ctx.beginPath(); ctx.rect(0, TOP * S, W * S, BAND * S); ctx.clip();
      ctx.filter = "blur(8px) brightness(0.7)"; ctx.drawImage(tiny, -12, TOP * S - 12, W * S + 24, BAND * S + 24); ctx.filter = "none";
      ctx.restore();
    }
    put(c.main, W / g.h, g.y, g.h, "main");
  }
  let frameTimer = 0, frameWant = "", cardsSent = "";
  $("#pv-frame").addEventListener("load", () => { cardsSent = "?"; });   // a fresh frame shows both cards: tell it again
  function frameSrc() {
    const f = E.frame;
    const q = new URLSearchParams({ title: E.title.trim() || "Clip", by: D.frame.by || "", date: f.date, kicker: f.kicker, stamp: f.stamp,
      sub: f.sub, chan: f.chan, byline: f.byline, hy: String(f.headY), fy: String(f.footY) });
    if (f.titleSize) q.set("tsize", String(f.titleSize));
    if (!E.frame.head) q.set("nohead", "1");
    if (!E.frame.foot) q.set("nofoot", "1");
    if ($("#zones").checked) q.set("zones", "1");
    if (E.appearance.accent) q.set("accent", E.appearance.accent);
    const frame = THEMES.find((t) => t.id === E.appearance.theme)?.frame || D.overlayHtml;
    const src = fileSrc(frame) + "?d=" + encodeURIComponent(JSON.stringify(Object.fromEntries(q)));
    if (src === frameWant) return;
    frameWant = src; clearTimeout(frameTimer); frameTimer = setTimeout(() => ($("#pv-frame").src = src), 200);
  }
  const shownWord = (w) => E.cap.upper ? String(w).toUpperCase() : String(w);
  // captions, notes and your text for this moment (the DOM is only touched when what's on screen changes)
  function drawOverlay() {
    const m = mm(), t = $("#video").currentTime, sNow = shortNow(), inCut = !frozen && m.map(t) == null;
    $("#cutflag").hidden = !inCut && !frozen;
    $("#cutflag").textContent = frozen ? `FREEZE · ${(frozen.d - (sNow - frozen.at)).toFixed(1)} s` : "CUT · not in the Short";
    const span = m.spans.find((x) => sNow >= x.s && sNow < x.e);
    const notes = m.notes.filter((x) => sNow >= x.at && sNow < x.until), texts = m.texts.filter((x) => sNow >= x.s && sNow < x.e);
    const stickers = m.stickers.filter((x) => sNow >= x.s && sNow < x.e), emoji = m.emojis.find((x) => sNow >= x.s && sNow < x.e);
    // the cards come and go at their times: the frame in the iframe is told which to show
    const headOn = !!m.head && sNow >= m.head.s && sNow < m.head.e, footOn = !!m.foot && sNow >= m.foot.s && sNow < m.foot.e;
    const cards = (headOn ? "h" : "") + (footOn ? "f" : "");
    if (cards !== cardsSent) { cardsSent = cards; try { $("#pv-frame").contentWindow.postMessage({ cards: { head: headOn, foot: footOn } }, "*"); } catch (e) { /* not loaded yet */ } }
    const key = [ver, span ? span.gi + ":" + span.i : "-", notes.map((x) => x.idx).join(","), texts.map((x) => x.idx).join(","), stickers.map((x) => x.idx).join(","), emoji ? emoji.s : "", cards, JSON.stringify(sel)].join("|");
    $("#pvtime").textContent = `${fmt(sNow)} / ${fmt(m.outDur)}`;
    if (key === overlayKey) return;
    overlayKey = key;
    // notes (under the frame, like the real Short)
    $("#pv-notes").replaceChildren(...notes.map(({ n, m: msg, idx }) => {
      const role = msg.role === 3 ? " mod" : msg.role === 2 ? " vip" : "";
      const who = el("div", { class: "who", style: msg.color && /^#([0-9a-f]{3}){1,2}$/i.test(msg.color) ? `color:${msg.color}` : "" }, msg.name || "viewer",
        msg.role === 3 || msg.role === 2 ? el("small", { text: msg.role === 3 ? "MOD" : "VIP" }) : null);
      const own = n.text && n.text.trim();
      const txt = el("div", { class: "txt" }, own ? own : Array.isArray(msg.parts) && msg.parts.some((p) => p.e) ? msg.parts.map((p) => p.e ? el("img", { src: p.e, alt: p.n || "" }) : p.t || "") : msg.text);
      const box = el("div", { class: "pnote" + (sel && sel.kind === "note" && sel.key === n.key ? " sel" : ""), "data-idx": idx, style: `left:${n.x + 16}px;top:${n.y + 16}px;width:${E.noteWidth}px` },
        el("div", { class: "note" + role }, el("div", { class: "pin" }), who, txt));
      box.addEventListener("pointerdown", (ev) => dragOnShort(ev, "note", idx));
      return box;
    }));
    const layer = [];
    // the frame's cards (drawn by overlay.html in the iframe): grab them to move them, double-click to change their words
    const f = E.frame;
    if (headOn) {
      const len = (E.title || "").length, size = f.titleSize || (len > 26 ? 44 : 56), lines = Math.min(f.titleSize ? 4 : 2, Math.max(1, Math.ceil(len * size * 0.78 / 790)));
      const g = el("div", { class: "grab" + (sel && sel.kind === "head" ? " sel" : ""), title: "Title card: drag to move, double-click to change the words",
        style: `top:${f.headY}px;height:${36 + (f.kicker || f.date ? 38 : 0) + lines * size * 1.05 + (f.sub ? 46 * Math.max(1, f.sub.split("\n").length) : 0)}px` });
      g.addEventListener("pointerdown", (ev) => dragOnShort(ev, "head"));
      layer.push(g);
    }
    if (footOn) {
      const g = el("div", { class: "grab" + (sel && sel.kind === "foot" ? " sel" : ""), title: "Bottom card: drag to move, double-click to change the words", style: `top:${f.footY}px;height:100px` });
      g.addEventListener("pointerdown", (ev) => dragOnShort(ev, "foot"));
      layer.push(g);
    }
    // stickers (drawn by shorts\sticker.js, the same as in the video), centred on their spot
    for (const { x, idx } of stickers) {
      const n = el("div", { class: "psticker" + (sel && sel.kind === "sticker" && sel.i === idx ? " sel" : ""), style: `left:${x.x}px;top:${x.y}px` });
      if (window.makeSticker) n.append(window.makeSticker(x, fileSrc));
      n.addEventListener("pointerdown", (ev) => dragOnShort(ev, "sticker", idx));
      layer.push(n);
    }
    if (emoji) layer.push(el("div", { class: "psticker", style: `left:480px;top:${Math.round(E.cap.bottom - (E.cap.size || 70) * 1.3 - 70)}px;pointer-events:none` },
      window.makeSticker ? window.makeSticker({ kind: "emoji", emoji: emoji.emoji, size: 130 }) : emoji.emoji));
    for (const { x, idx } of texts) {
      const n = el("div", { class: "utext" + (x.box ? " box" : "") + (sel && sel.kind === "text" && sel.i === idx ? " sel" : ""), style: `top:${x.y}px` },
        el("span", { text: x.text, style: `font-size:${x.size}px;color:${x.color}` }));
      n.addEventListener("pointerdown", (ev) => dragOnShort(ev, "text", idx));
      layer.push(n);
    }
    if (span) {
      // the caption styles, as make-short.cjs draws them (see captionsAss)
      const style = E.cap.style || "classic";
      const c = el("div", { class: "cap" + (style === "box" ? " box" : "") + (style === "pop" && span.i === 0 ? " pop" : "") + (sel && sel.kind === "cap" ? " sel" : ""),
        style: `bottom:${H - E.cap.bottom}px;font-size:${E.cap.size}px;color:${E.cap.color}` });
      const line = style === "box" ? el("span", { class: "inner" }) : c;
      span.grp.forEach((w, j) => {
        if (style === "reveal" && j > span.i) return;
        if (j) line.append(" ");
        const colour = j === span.i ? (w.color || E.cap.hi) : (w.color || "");
        line.append(el("span", { class: j === span.i && style === "punch" ? "punch" : "", text: w.bleep ? bleepText(shownWord(w.w)) : shownWord(w.w), style: colour ? `color:${colour}` : "" }));
      });
      if (line !== c) c.append(line);
      c.addEventListener("pointerdown", (ev) => dragOnShort(ev, "cap"));
      c.title = "Drag to move the captions, double-click to fix these words";
      layer.push(c);
    }
    $("#pv-text").replaceChildren(...layer);
  }
  // double-click something on the Short: straight to its words (counted by hand: the preview is redrawn between
  // the two clicks, so the browser's own dblclick would miss)
  let lastDown = { kind: "", idx: -1, t: 0 };
  function focusLater(sel) { requestAnimationFrame(() => { const i = document.querySelector(sel); if (i) { i.scrollIntoView({ block: "center" }); i.focus(); if (i.select) i.select(); } }); }
  function editOnShort(kind, idx) {
    $("#video").pause();
    if (kind === "head") { setTab("title"); focusLater("#f-title"); }
    else if (kind === "foot") { setTab("title"); focusLater("#f-byline"); }
    else if (kind === "text") { setTab("text"); focusLater(`#ipane .trow[data-i="${idx}"] textarea`); }
    else if (kind === "sticker") { sel = { kind: "sticker", i: idx }; setTab("stickers"); focusLater(`#ipane .srow[data-i="${idx}"]`); }
    else if (kind === "note") { setTab("chat"); focusLater(`#ipane .crow[data-key="${CSS.escape(E.notes[idx].key)}"] input.own`); }
    else if (kind === "cap") {
      const m = mm(), s = shortNow(), span = m.spans.find((x) => s >= x.s && s < x.e);
      if (!span) return;
      setTab("captions"); focusLater(`#ipane .wrow[data-i="${span.grp[span.i].i}"] input`);
    }
  }
  // drag things around on the Short itself
  function dragOnShort(ev, kind, idx) {
    ev.preventDefault(); ev.stopPropagation();
    const tNow = Date.now();
    if (lastDown.kind === kind && lastDown.idx === (idx ?? -1) && tNow - lastDown.t < 450 && ["head", "foot", "text", "note", "cap", "sticker"].includes(kind)) {
      lastDown = { kind: "", idx: -1, t: 0 }; editOnShort(kind, idx); return;
    }
    lastDown = { kind, idx: idx ?? -1, t: tNow };
    const x0 = ev.clientX, y0 = ev.clientY, k = pvK, key = "drag" + kind + x0 + y0;
    sel = kind === "note" ? { kind, key: E.notes[idx].key } : kind === "text" || kind === "sticker" ? { kind, i: idx } : { kind };
    const start = kind === "note" ? { ...E.notes[idx] } : kind === "text" ? { ...E.texts[idx] } : kind === "sticker" ? { ...E.stickers[idx] } : kind === "cap" ? { bottom: E.cap.bottom }
      : kind === "head" || kind === "foot" ? { ...E.frame } : { ...geo() };
    overlayKey = ""; markSelected();
    const move = (e) => {
      const dx = (e.clientX - x0) / k, dy = (e.clientY - y0) / k;
      change((E) => {
        if (kind === "note") { E.notes[idx].x = Math.round(clamp(start.x + dx, -16, W - 120)); E.notes[idx].y = Math.round(clamp(start.y + dy, 0, H - 120)); }
        else if (kind === "text") E.texts[idx].y = Math.round(clamp(start.y + dy, 0, H - 60));
        else if (kind === "sticker") { E.stickers[idx].x = Math.round(clamp(start.x + dx, 0, W)); E.stickers[idx].y = Math.round(clamp(start.y + dy, 0, H)); }
        else if (kind === "cap") E.cap.bottom = Math.round(clamp(start.bottom + dy, 200, H));
        else if (kind === "head") E.frame.headY = Math.round(clamp(start.headY + dy, 0, H - 200));
        else if (kind === "foot") E.frame.footY = Math.round(clamp(start.footY + dy, 0, H - 100));
        else if (kind === "picture") E.geoBy[E.layout].y = Math.round(clamp(start.y + dy, TOP - E.geoBy[E.layout].h + 100, TOP + BAND - 100));
        else if (kind === "seam") { E.geoBy[E.layout].faceH = Math.round(clamp(start.faceH + dy, 300, BAND - 300) / 2) * 2; reaspect(E); }
      }, { merge: key, insp: false, lanes: false });
    };
    const upH = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", upH); renderPane(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", upH);
  }
  // on the picture: framed layouts move it up and down; split moves the camera/game seam
  cv.addEventListener("pointerdown", (ev) => {
    if (!E) return;
    const r = cv.getBoundingClientRect(), y = (ev.clientY - r.top) / pvK, g = geo();
    if (isSplit()) { if (Math.abs(y - (TOP + g.faceH)) < 60) dragOnShort(ev, "seam"); }
    else if (y >= g.y && y <= g.y + g.h) dragOnShort(ev, "picture");
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!E) return;
    const r = cv.getBoundingClientRect(), y = (ev.clientY - r.top) / pvK, g = geo();
    cv.style.cursor = isSplit() ? (Math.abs(y - (TOP + g.faceH)) < 60 ? "ns-resize" : "default") : (y >= g.y && y <= g.y + g.h ? "ns-resize" : "default");
  });

  // ---------- the timeline (wavesurfer.js): one track for everything on the Short ----------
  // Top to bottom: the two cards, your text, stickers, chat notes, caption words, zooms, speed (slow motion and
  // freezes), the video (kept parts), the sound, sound effects and music. Everything is drawn inside wavesurfer's
  // wrapper (so it scrolls and zooms with it); the waveform is pushed down into its own track with padding.
  const R = {};
  const TRACKS = [
    { k: "head", name: "Title card", tab: "title", on: () => E.frame.head, set: (e, v) => (e.frame.head = v) },
    { k: "foot", name: "Bottom card", tab: "title", on: () => E.frame.foot, set: (e, v) => (e.frame.foot = v) },
    { k: "texts", name: "Text", tab: "text" },
    { k: "stickers", name: "Stickers", tab: "stickers" },
    { k: "notes", name: "Chat", tab: "chat", on: () => E.chatOn, set: (e, v) => (e.chatOn = v) },
    { k: "words", name: "Captions", tab: "captions", on: () => E.captions, set: (e, v) => (e.captions = v) },
    { k: "zoom", name: "Zoom", tab: "fx" },
    { k: "speed", name: "Speed", tab: "fx" },
    { k: "keep", name: "Video", tab: "look" },
    { k: "audio", name: "Sound", tab: "sound" },
    { k: "sfx", name: "Effects", tab: "sound" },
    { k: "music", name: "Music", tab: "sound" },
  ];
  const RULER = 18;
  let TR = {};
  // a short window gets slimmer tracks, so the Short preview stays big enough to judge
  function trackLayout() {
    const small = innerHeight < 860;
    const hs = small ? { head: 15, foot: 15, texts: 17, stickers: 17, notes: 18, words: 18, zoom: 15, speed: 15, keep: 22, audio: 34, sfx: 17, music: 17 }
      : { head: 18, foot: 18, texts: 20, stickers: 20, notes: 22, words: 22, zoom: 18, speed: 18, keep: 26, audio: 48, sfx: 20, music: 20 };
    const next = {}; let y = 0;
    for (const t of TRACKS) { next[t.k] = { top: y, h: hs[t.k] }; y += hs[t.k]; }
    next.total = y;
    const changed = JSON.stringify(next) !== JSON.stringify(TR);
    TR = next;
    if (changed) {
      document.documentElement.style.setProperty("--wave-h", TR.total + RULER + "px");
      const wave = $("#wave");
      wave.style.setProperty("--audio-top", TR.audio.top + "px");
      wave.style.setProperty("--audio-bottom", TR.total - TR.audio.top - TR.audio.h + "px");   // the tracks under the sound (the ruler goes below them)
      // the tracks' stripes behind everything
      wave.style.background = "linear-gradient(to bottom, " + TRACKS.map((t, i) => `${i % 2 ? "#13161b" : "#101216"} ${TR[t.k].top}px ${TR[t.k].top + TR[t.k].h}px`).join(", ") +
        `, #0c0d10 ${TR.total}px) 0 0 / 100% ${TR.total + RULER}px no-repeat`;
      if (ws) { ws.setOptions({ height: TR.audio.h }); syncLanes(); }
    }
    renderTrackLabels();
    return TR;
  }
  window.addEventListener("resize", () => { if (E) trackLayout(); });
  // the names on the left, with a dot to switch a track on or off
  function renderTrackLabels() {
    if (!E || !TR.total) return;
    $("#lanes").replaceChildren(...TRACKS.map((t) => {
      const on = t.on ? !!t.on() : true;
      const name = t.k === "audio" ? `Sound${E.volume ? ` ${E.volume > 0 ? "+" : ""}${E.volume} dB` : ""}` : t.name;
      return el("div", { class: "lane" + (on ? "" : " off"), style: `height:${TR[t.k].h}px`, title: t.on ? "Click the name to edit it, the dot to switch it " + (on ? "off" : "on") : "Click to edit it" },
        t.on ? el("button", { class: "eye", text: on ? "●" : "○", title: on ? "Switch off" : "Switch on", onclick: (ev) => { ev.stopPropagation(); change((e) => t.set(e, !on)); } }) : el("span", { class: "eye" }),
        el("span", { class: "nm", text: name, onclick: () => setTab(t.tab) }));
    }), el("div", { style: `height:${RULER}px` }));
  }
  const COL = { keep: "rgba(63,207,142,.30)", cut: "rgba(5,6,8,.64)", word: "rgba(235,229,216,.14)", bleep: "rgba(239,68,59,.5)", note: "rgba(180,140,255,.36)", mod: "rgba(106,168,255,.40)",
    vip: "rgba(227,169,72,.40)", text: "rgba(239,68,59,.40)", card: "rgba(200,204,212,.24)", sticker: "rgba(255,210,63,.32)", zoom: "rgba(106,168,255,.36)", slow: "rgba(63,207,142,.36)",
    freeze: "#6aa8ff", sfx: "rgba(227,169,72,.42)", music: "rgba(180,140,255,.30)" };
  let building = false, sel = null, dragMode = "keep", downY = 0;
  let mark = { in: null, out: null }, altHeld = false, stopAt = null, wsel = null, wdrag = false;
  const label = (text) => { const d = document.createElement("div"); d.textContent = text;
    d.style.cssText = "padding:1px 4px;font:11px/1.2 'Segoe UI',sans-serif;color:#ebe5d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;box-sizing:border-box;pointer-events:none"; return d; };
  // which track a y position (inside the wrapper) is in
  const trackAt = (y) => (TRACKS.find((t) => y >= TR[t.k].top && y < TR[t.k].top + TR[t.k].h) || { k: "ruler" }).k;
  const stickerName = (x) => x.kind === "emoji" ? x.emoji || "😂" : x.kind === "image" ? (x.name || "picture") : x.kind === "arrow" ? "➜ arrow" : x.kind === "circle" ? "◯ circle" : (x.text || x.kind);
  const soundName = (file) => { const x = libEntry(file); return x ? x.name : String(file || "").split(/[\\/]/).pop(); };
  const soundLen = (file) => { const x = libEntry(file); return x && x.dur ? x.dur : 1; };
  const LANES = ["keep", "cuts", "words", "notes", "texts", "head", "foot", "stickers", "zoom", "speed", "sfx", "music"];
  const TAB_OF = { cut: "cuts", uncut: "cuts", word: "captions", note: "chat", text: "text", head: "title", foot: "title", sticker: "stickers", zoom: "fx", slow: "fx", freeze: "fx", sfx: "sound", music: "sound" };
  function initTimeline() {
    const v = $("#video");
    trackLayout();
    for (const k of ["cut", "mark", ...LANES]) R[k] = WaveSurfer.Regions.create();
    ws = WaveSurfer.create({ container: "#wave", media: v, url: v.src, peaks: [D.peaks], duration: D.clipSeconds, height: TR.audio.h, normalize: true, barHeight: 0.92,
      waveColor: "#5b6272", progressColor: "#8d96a8", cursorColor: "#ef443b", cursorWidth: 2, autoScroll: true, autoCenter: true, dragToSeek: false,
      plugins: [WaveSurfer.Timeline.create({ height: RULER, style: { fontSize: "10px", color: "#8d919b" } }), WaveSurfer.Zoom.create({ scale: 0.3, maxZoom: 800 }),
        R.cut, R.mark, ...LANES.map((k) => R[k])] });
    ws.on("ready", () => { syncLanes(); fitZoom = ($("#wave").clientWidth || 800) / dur(); });
    ws.on("zoom", (px) => { if (fitZoom) $("#zoom").value = Math.round(100 * Math.log(Math.max(1, px / fitZoom)) / Math.log(40)); });
    // where a drag on empty timeline starts decides what it makes
    $("#wave").addEventListener("pointerdown", (e) => { const w = ws.getWrapper().getBoundingClientRect(); downY = e.clientY - w.top; }, true);
    dragSelection();
    R.keep.on("region-initialized", (r) => { const k = trackAt(downY); if (TR[k] && r.element) { r.element.style.top = TR[k].top + "px"; r.element.style.height = TR[k].h + "px"; } });
    R.keep.on("region-created", (r) => {
      if (building) return;
      const a = r2(r.start), b = r2(r.end), k = trackAt(downY); r.remove();
      if (b - a < 0.1) return;
      makeOnTrack(k, a, b);
    });
    R.keep.on("region-updated", (r) => { if (!r.data) return; change((E) => {
      const s = segsN(), old = s[r.data.i] || [r.start, r.end];
      let a = r.start, b = r.end;
      const moved = Math.abs(a - old[0]) > 0.001 && Math.abs(b - old[1]) > 0.001 && Math.abs((b - a) - (old[1] - old[0])) < 0.002;
      if (moved) { const na = snap(a); b += na - a; a = na; } else { if (Math.abs(a - old[0]) > 0.001) a = snap(a); if (Math.abs(b - old[1]) > 0.001) b = snap(b); }
      s[r.data.i] = [a, b]; E.segs = segsN(s);
    }); });
    R.words.on("region-updated", (r) => change((E) => { const w = E.words[r.data.i]; w.s = r2(r.start); w.e = r2(Math.max(r.end, r.start + 0.03)); E.words.sort((a, b) => a.s - b.s); }));
    R.notes.on("region-updated", (r) => change((E) => { const n = E.notes.find((x) => x.key === r.data.key); if (n) { n.t = r2(r.start); n.hold = r2(clamp(r.end - r.start, 0.5, 15)); } }));
    R.texts.on("region-updated", (r) => change((E) => { const x = E.texts[r.data.i]; x.t = r2(r.start); x.e = r2(Math.max(r.end, r.start + 0.2)); }));
    R.stickers.on("region-updated", (r) => change((E) => { const x = E.stickers[r.data.i]; x.t = r2(r.start); x.e = r2(Math.max(r.end, r.start + 0.2)); }));
    R.zoom.on("region-updated", (r) => change((E) => { const x = E.zooms[r.data.i]; x.t = r2(r.start); x.e = r2(Math.max(r.end, r.start + 0.3)); }));
    R.speed.on("region-updated", (r) => change((E) => {
      if (r.data.kind === "freeze") E.freezes[r.data.i].t = r2(r.start);
      else { const x = E.speeds[r.data.i]; x.a = r2(r.start); x.b = r2(Math.max(r.end, r.start + 0.2)); }
    }));
    R.sfx.on("region-updated", (r) => change((E) => { E.sfx[r.data.i].t = r2(r.start); }));
    R.music.on("region-updated", (r) => change((E) => { if (E.music) { E.music.t = r.start < 0.05 ? null : r2(r.start); E.music.e = r.end > dur() - 0.05 ? null : r2(r.end); } }));
    for (const k of ["head", "foot"]) R[k].on("region-updated", (r) => change((E) => {
      E.frame[k + "From"] = r.start < 0.05 ? null : r2(r.start); E.frame[k + "To"] = r.end > dur() - 0.05 ? null : r2(r.end);
    }));
    for (const k of LANES) {
      R[k].on("region-clicked", (r) => {
        if (!r.data) return;
        sel = r.data.kind === "note" ? { kind: "note", key: r.data.key } : { kind: r.data.kind, i: r.data.i };
        markSelected(); overlayKey = "";
        const want = TAB_OF[r.data.kind];
        if (want && want !== tab) setTab(want); else renderPane();
        requestAnimationFrame(() => { const row = document.querySelector("#ipane .sel-row"); if (row) row.scrollIntoView({ block: "nearest" }); });
      });
      R[k].on("region-double-clicked", (r) => {
        if (!r.data) return;
        const d = r.data;
        if (d.kind === "cut") return uncut(d.a, d.b);
        if (d.kind === "uncut") return recut(d.a, d.b);
        if (d.kind === "word") { setTab("captions"); focusLater(`#ipane .wrow[data-i="${d.i}"] input`); }
        else if (d.kind === "text") { setTab("text"); focusLater(`#ipane .trow[data-i="${d.i}"] textarea`); }
        else if (d.kind === "note") { setTab("chat"); focusLater(`#ipane .crow[data-key="${CSS.escape(d.key)}"] input.own`); }
        else if (d.kind === "head") { setTab("title"); focusLater("#f-title"); }
        else if (d.kind === "foot") { setTab("title"); focusLater("#f-byline"); }
        else if (d.kind === "sticker") { sel = { kind: "sticker", i: d.i }; setTab("stickers"); focusLater(`#ipane .srow[data-i="${d.i}"]`); }
      });
    }
  }
  // a drag across an empty track makes something there
  function makeOnTrack(k, a, b) {
    if (k === "keep" || k === "audio" || k === "ruler") {
      const sa = snap(a), sb = snap(b); if (sb - sa < 0.05) return;
      if (dragMode !== "keep" && !segsN(subtract(segsN(), sa, sb)).length) return toast("That would cut the whole clip", true);
      change((E) => { E.segs = dragMode === "keep" ? segsN([...E.segs, [sa, sb]]) : subtract(segsN(), sa, sb); });
    }
    else if (k === "texts") { change((E) => { E.texts.push({ text: "NEW TEXT", t: a, e: b, y: 900, size: 84, color: "#ffffff", box: true }); }); sel = { kind: "text", i: E.texts.length - 1 }; setTab("text"); focusLater(`#ipane .trow[data-i="${sel.i}"] textarea`); }
    else if (k === "head" || k === "foot") change((E) => { E.frame[k] = true; E.frame[k + "From"] = a < 0.05 ? null : a; E.frame[k + "To"] = b > dur() - 0.05 ? null : b; });
    else if (k === "stickers") addSticker({ kind: "emoji", emoji: "😂" }, a, b);
    else if (k === "zoom") addZoom(a, b);
    else if (k === "speed") { change((E) => { E.speeds.push({ a, b, speed: 0.5 }); }); sel = { kind: "slow", i: E.speeds.length - 1 }; setTab("fx"); }
    else if (k === "sfx") addSfx(lastSfx(), a);
    else if (k === "music") { const file = E.music ? E.music.file : ((window.LIBRARY || {}).music || [])[0]?.file; if (!file) return toast("No music in the library yet");
      change((E) => { E.music = { file, vol: 0, duck: true, offset: 0, ...(E.music || {}), t: a < 0.05 ? null : a, e: b > dur() - 0.05 ? null : b }; }); setTab("sound"); }
    else toast(k === "words" ? "Add caption words in the Captions tab" : "Tick chat messages in the Chat tab to put them here");
  }
  let fitZoom = 0, dragOff = null;
  // dragging across empty timeline: on Video or Sound it keeps that part, or cuts it (the colour shows which);
  // on the other tracks it makes a new one of those there
  function dragSelection() { if (dragOff) dragOff(); dragOff = R.keep.enableDragSelection({ color: dragMode === "keep" ? COL.keep : "rgba(239,68,59,.3)" }); }
  function lane(r, k) { if (r.element && TR[k]) { r.element.style.top = TR[k].top + 1 + "px"; r.element.style.height = TR[k].h - 2 + "px"; } }
  function add(k, opts, data, laneKey) { const r = R[k].addRegion(opts); r.data = data; lane(r, laneKey || k); return r; }
  function syncLanes(except = "") {
    if (!ws || !ws.getDuration()) return;
    building = true;
    try {
      const segs = segsN();
      R.cut.clearRegions();
      for (const [a, b] of gaps(segs)) { const r = R.cut.addRegion({ start: a, end: b, color: COL.cut, drag: false, resize: false }); if (r.element) { r.element.style.pointerEvents = "none"; r.element.style.height = TR.total + "px"; } }
      const redo = (k) => except !== k && (R[k].clearRegions(), true);
      // each cut on the Video track: a ✂ chip in the gap; a part that was cut and put back keeps a dashed line under it
      if (redo("cuts")) cutList().forEach((c, i) => {
        const r = R.cuts.addRegion({ start: c.a, end: c.b, drag: false, resize: false, color: c.on ? "rgba(239,68,59,.08)" : "rgba(239,68,59,.18)",
          content: c.on ? label(`✂ ${(c.b - c.a).toFixed(1)} s`) : undefined });
        r.data = { kind: c.on ? "cut" : "uncut", i, a: c.a, b: c.b };
        if (!r.element || !TR.keep) return;
        const st = r.element.style;
        if (c.on) { st.top = TR.keep.top + 1 + "px"; st.height = TR.keep.h - 2 + "px"; st.border = "1px dashed rgba(239,68,59,.75)"; st.borderRadius = "3px"; }
        else { st.top = TR.keep.top + TR.keep.h - 7 + "px"; st.height = "6px"; st.border = "1px dashed rgba(239,68,59,.9)"; st.borderRadius = "3px"; }
        r.element.title = c.on ? `Cut ${fmt(c.a)} – ${fmt(c.b)}: press Delete or double-click to put it back in the Short`
          : `Was cut ${fmt(c.a)} – ${fmt(c.b)}, now back in the Short: double-click to cut it again`;
      });
      if (redo("keep")) segs.forEach(([a, b], i) => add("keep", { start: a, end: b, color: COL.keep, content: label((b - a).toFixed(1) + " s"), minLength: 0.1 }, { kind: "keep", i }));
      if (redo("words")) E.words.forEach((w, i) => { const r = add("words", { start: w.s, end: Math.max(w.e, w.s + 0.03), color: w.bleep ? COL.bleep : COL.word, content: label((w.emoji || "") + (w.bleep ? bleepText(w.w) : w.w)), minLength: 0.03 }, { kind: "word", i }); dim(r, !E.captions); });
      if (redo("notes")) {
        const byKey = new Map(D.chat.map((m) => [m.key, m]));
        E.notes.forEach((n) => { const m = byKey.get(n.key); if (!m) return;
          const r = add("notes", { start: clamp(n.t, 0, dur()), end: clamp(n.t + (n.hold || 3), 0, dur()), color: m.role === 3 ? COL.mod : m.role === 2 ? COL.vip : COL.note,
            content: label(m.name + ": " + (n.text && n.text.trim() ? n.text : m.text)), minLength: 0.5 }, { kind: "note", key: n.key });
          dim(r, !E.chatOn); });
      }
      if (redo("texts")) E.texts.forEach((x, i) => add("texts", { start: clamp(x.t, 0, dur()), end: clamp(x.e, 0, dur()), color: COL.text, content: label(x.text.replace(/\s*\n\s*/g, " ")), minLength: 0.2 }, { kind: "text", i }));
      if (redo("stickers")) E.stickers.forEach((x, i) => add("stickers", { start: clamp(x.t, 0, dur()), end: clamp(x.e, 0, dur()), color: COL.sticker, content: label(stickerName(x)), minLength: 0.2 }, { kind: "sticker", i }));
      if (redo("zoom")) E.zooms.forEach((x, i) => add("zoom", { start: clamp(x.t, 0, dur()), end: clamp(x.e, 0, dur()), color: COL.zoom, content: label(`🔍 ${(+x.z || 1.35).toFixed(2)}x${isSplit() ? " " + (x.target === "game" ? "game" : "camera") : ""}`), minLength: 0.3 }, { kind: "zoom", i }));
      if (redo("speed")) {
        E.speeds.forEach((x, i) => add("speed", { start: clamp(x.a, 0, dur()), end: clamp(x.b, 0, dur()), color: COL.slow, content: label(`${x.speed}x`), minLength: 0.2 }, { kind: "slow", i }));
        E.freezes.forEach((x, i) => add("speed", { start: clamp(x.t, 0, dur()), color: COL.freeze, content: label(`❄ ${(+x.d).toFixed(1)} s`) }, { kind: "freeze", i }));
      }
      if (redo("sfx")) E.sfx.forEach((x, i) => add("sfx", { start: clamp(x.t, 0, dur()), end: clamp(x.t + soundLen(x.file), 0, dur()), color: COL.sfx, content: label("🔊 " + soundName(x.file)), resize: false, minLength: 0.05 }, { kind: "sfx", i }));
      if (redo("music") && E.music) add("music", { start: clamp(E.music.t ?? 0, 0, dur()), end: clamp(E.music.e ?? dur(), 0, dur()), color: COL.music, content: label("♪ " + soundName(E.music.file) + (E.music.duck !== false ? " · dips under your voice" : "")), minLength: 0.5 }, { kind: "music", i: 0 });
      // the two cards: one bar each, as long as the card shows (off = no bar; switch it on with the dot)
      for (const k of ["head", "foot"]) {
        if (!redo(k) || !E.frame[k]) continue;
        const from = E.frame[k + "From"] ?? 0, to = E.frame[k + "To"] ?? dur();
        const text = k === "head" ? [E.title, E.frame.sub].filter((x) => x && x.trim()).join(" · ").replace(/\s*\n\s*/g, " ") || "Title card" : E.frame.byline || "Bottom card";
        add(k, { start: clamp(from, 0, dur()), end: clamp(to, 0, dur()), color: COL.card, content: label(text), minLength: 0.3 }, { kind: k, i: 0 });
      }
    } finally { building = false; }
    drawMark();
    markSelected();
    renderTrackLabels();
  }
  const dim = (r, off) => { if (r.element && off) r.element.style.opacity = "0.35"; };
  function markSelected() {
    for (const k of LANES) for (const r of R[k] && R[k].getRegions ? R[k].getRegions() : []) {
      const on = sel && r.data && r.data.kind === sel.kind && (sel.kind === "note" ? r.data.key === sel.key : r.data.i === sel.i);
      if (r.element) r.element.style.outline = on ? "2px solid #fff" : "";
    }
  }
  function deleteSelected() {
    if (!sel) return;
    if (sel.kind === "cut" || sel.kind === "uncut") { const c = cutList()[sel.i]; if (!c) return; return sel.kind === "cut" ? uncut(c.a, c.b) : forgetCut(c.a, c.b); }
    const s = sel; sel = null;
    change((E) => {
      if (s.kind === "keep") { const segs = segsN(); segs.splice(s.i, 1); E.segs = segs; }
      else if (s.kind === "word") E.words.splice(s.i, 1);
      else if (s.kind === "note") E.notes = E.notes.filter((n) => n.key !== s.key);
      else if (s.kind === "text") E.texts.splice(s.i, 1);
      else if (s.kind === "sticker") E.stickers.splice(s.i, 1);
      else if (s.kind === "zoom") E.zooms.splice(s.i, 1);
      else if (s.kind === "slow") E.speeds.splice(s.i, 1);
      else if (s.kind === "freeze") E.freezes.splice(s.i, 1);
      else if (s.kind === "sfx") E.sfx.splice(s.i, 1);
      else if (s.kind === "music") E.music = null;
      else if (s.kind === "head" || s.kind === "foot") E.frame[s.kind] = false;
    });
  }
  function splitAtPlayhead() {
    const t = $("#video").currentTime, segs = segsN(), i = segs.findIndex(([a, b]) => t > a + 0.1 && t < b - 0.1);
    if (i < 0) return toast("Put the playhead inside a kept part to split it");
    change((E) => { const s = segsN(); const [a, b] = s[i]; s.splice(i, 1, [a, t], [t, b]); E.segs = s; });
    toast("Split. Click a part and press Delete to cut it out.");
  }
  // quick adds at the playhead (the toolbar buttons and keys Z, F, B)
  function addZoom(a, b) {
    const t = a ?? now(), e = b ?? Math.min(dur(), t + 1.6);
    change((E) => { E.zooms.push({ t: r2(t), e: r2(e), z: 1.45, fx: 0.5, fy: 0.42, target: isSplit() ? "face" : "main", ramp: 0.3 }); });
    sel = { kind: "zoom", i: E.zooms.length - 1 }; markSelected(); setTab("fx");
  }
  function addFreeze() {
    const t = now();
    if (!mm().segs.some(([a, b]) => t >= a - 0.02 && t <= b + 0.02)) return toast("Put the playhead inside a kept part to freeze it");
    change((E) => { E.freezes.push({ t: r2(t), d: 1.2 }); });
    sel = { kind: "freeze", i: E.freezes.length - 1 }; markSelected(); setTab("fx");
  }
  function addSlow() {
    const t = now();
    change((E) => { E.speeds.push({ a: r2(t), b: r2(Math.min(dur(), t + 2)), speed: 0.5 }); });
    sel = { kind: "slow", i: E.speeds.length - 1 }; markSelected(); setTab("fx");
  }
  function bleepAtPlayhead() {
    const t = now(), i = sel && sel.kind === "word" ? sel.i : E.words.findIndex((w) => t >= w.s - 0.05 && t < w.e + 0.05);
    if (i < 0 || !E.words[i]) return toast("Put the playhead on a word (or click one on the Captions track) to bleep it");
    change((E) => { E.words[i].bleep = !E.words[i].bleep; });
    toast(E.words[i].bleep ? `Bleeped "${E.words[i].w}"` : `"${E.words[i].w}" isn't bleeped any more`);
  }
  function addSticker(spec, a, b) {
    const t = a ?? now(), e = b ?? Math.min(dur(), t + 2.5);
    change((E) => { E.stickers.push({ size: spec.kind === "stamp" || spec.kind === "label" ? 360 : spec.kind === "arrow" || spec.kind === "circle" ? 280 : 200, x: 700, y: 540, rot: spec.kind === "stamp" ? -8 : 0, color: E.appearance.accent || "#ef443b", ...spec, t: r2(t), e: r2(e) }); });
    sel = { kind: "sticker", i: E.stickers.length - 1 }; markSelected(); setTab("stickers");
  }
  let lastSfxFile = "";
  const lastSfx = () => lastSfxFile || (((window.LIBRARY || {}).sfx || []).find((x) => /boom/i.test(x.name)) || ((window.LIBRARY || {}).sfx || [])[0] || {}).file;
  function addSfx(file, at) {
    if (!file) return toast("No sound effects in the library yet");
    lastSfxFile = file;
    change((E) => { E.sfx.push({ file, t: r2(at ?? now()), vol: 0 }); });
    sel = { kind: "sfx", i: E.sfx.length - 1 }; markSelected();
  }

  // ---------- the settings on the right ----------
  let tab = "look";
  function setTab(t) { tab = t; for (const b of document.querySelectorAll("#itabs button")) b.classList.toggle("active", b.dataset.t === t); renderPane(); }
  function slider(label, min, max, step, value, onInput, unit = "", show = (v) => v + unit) {
    const out = el("output", { text: show(+value) }), inp = el("input", { type: "range", min, max, step, value });
    inp.addEventListener("input", () => { out.textContent = show(+inp.value); onInput(+inp.value); });
    return el("label", { class: "field" }, el("span", { text: label }), inp, out);
  }
  // a labelled text box (textarea when area); onInput gets the text
  function field(id, label, value, onInput, { area = false, placeholder = "", rows = 2 } = {}) {
    const i = el(area ? "textarea" : "input", { id, placeholder, rows: area ? String(rows) : null, spellcheck: "true" }); i.value = value || "";
    i.addEventListener("input", () => onInput(i.value));
    return el("label", { class: "tfield" }, el("span", { text: label }), i);
  }
  function check(label, on, onChange) {
    const cb = el("input", { type: "checkbox" }); cb.checked = !!on; cb.addEventListener("change", () => onChange(cb.checked));
    return el("label", { class: "check" }, cb, label);
  }
  const num = (value, step, onChange, attrs = {}) => { const i = el("input", { type: "number", step, value: String(value), ...attrs }); i.addEventListener("change", () => { if (i.value !== "" && Number.isFinite(+i.value)) onChange(+i.value); }); return i; };
  const seekTo = (t) => { $("#video").currentTime = clamp(t, 0, dur()); needDraw = true; };
  const now = () => $("#video").currentTime;
  function renderPane() {
    if (!E) return;
    const pane = $("#ipane"), top = pane.scrollTop;
    pane.replaceChildren(...({ look: paneLook, cuts: paneCuts, title: paneTitle, captions: paneCaptions, chat: paneChat, text: paneText, stickers: paneStickers, fx: paneFx, sound: paneSound, post: panePost }[tab])());
    pane.scrollTop = top;
    // how many of each, on the tabs
    const badge = (t, name, n) => { const b = document.querySelector(`#itabs [data-t="${t}"]`); if (b) b.replaceChildren(name, n ? el("em", { text: String(n) }) : ""); };
    badge("chat", "Chat", E.chatOn ? E.notes.length : "off");
    badge("text", "Text", E.texts.length);
    badge("stickers", "Stickers", E.stickers.length);
    badge("fx", "FX", E.zooms.length + E.speeds.length + E.freezes.length);
    badge("sound", "Sound", E.sfx.length + (E.music ? 1 : 0) + E.words.filter((w) => w.bleep).length);
    badge("cuts", "Cuts", cutList().filter((c) => c.on).length);
    badge("look", "Look", E.join.ids.length ? "+" + E.join.ids.length : 0);
  }
  const LAYOUTS = [["split", "Camera + game"], ["stage", "Stage"], ["letterbox", "Whole"], ["center", "You, centred"]];
  function setLayout(k) {
    change((E) => {
      const od = defs(E.layout), nd = defs(k);
      E.layout = k;
      // anything still where the old layout put it moves to where the new one does
      if (Math.round(E.cap.bottom) === Math.round(od.capBottom)) E.cap.bottom = nd.capBottom;
      if (E.noteWidth === od.notes.width) E.noteWidth = nd.notes.width;
      for (const n of E.notes) if (n.x === od.notes.x && od.notes.slots.includes(n.y)) { n.x = nd.notes.x; n.y = nd.notes.slots[Math.min(od.notes.slots.indexOf(n.y), nd.notes.slots.length - 1)]; }
    });
  }
  function paneLook() {
    const g = geo(), l = E.layout;
    const sizes = isSplit()
      ? [slider("Camera height", 300, 1200, 2, g.faceH, (v) => change((E) => { E.geoBy.split.faceH = v; reaspect(E); }, { merge: "faceH", insp: false, lanes: false }), " px"),
        el("div", { class: "hint", text: "Or drag the line between camera and game on the preview." })]
      : [slider("Picture height", 200, 1500, 2, g.h, (v) => change((E) => { E.geoBy[l].h = v; reaspect(E); }, { merge: "h", insp: false, lanes: false }), " px"),
        slider("Picture top", 0, 1600, 2, g.y, (v) => change((E) => { E.geoBy[l].y = v; }, { merge: "y", insp: false, lanes: false }), " px"),
        el("div", { class: "hint", text: "Or drag the picture up and down on the preview. The rest of the band shows a blurred copy." })];
    return [
      presetSection(),
      el("div", { class: "sec" }, el("h3", { text: "Layout" }),
        el("div", { class: "layouts" }, LAYOUTS.map(([k, name]) => el("button", { class: "l-" + k + (k === l ? " on" : ""), onclick: () => setLayout(k) }, el("i"), name))),
        el("div", { class: "hint", text: { split: "Your camera on top, the game underneath.", stage: "A 4:3 crop, big: good for a game with the action in the middle.", letterbox: "The whole 16:9 picture.", center: "A tall crop that fills the Short: good for just-chatting and a camera." }[l] })),
      el("div", { class: "sec" }, el("h3", { text: "Sizes" }), ...sizes,
        el("div", { class: "row" },
          el("button", { text: "Reset this layout", title: "Sizes and crops back to the defaults", onclick: () => change((E) => { E.geoBy[l] = clone(defs(l).geo); E.cropsBy[l] = clone(defs(l).crops); }) }),
          isSplit() ? null : el("button", { text: "Whole picture in the box", onclick: () => change((E) => { E.cropsBy[l].main = roundBox(fitBox({ x: 0, y: 0, w: 1920, h: 1080 }, W / E.geoBy[l].h)); }) })),
        el("button", { text: "Use these crops for my next Shorts", title: "New Shorts in this layout start with these boxes (where your camera and game are)",
          onclick: () => studio.saveSettings({ crops: { ...(SETTINGS.crops || {}), [l]: clone(E.cropsBy[l]) } }).then(() => toast("Saved: new " + l + " Shorts start with these crops")).catch((e) => toast(e.message, true)) })),
      joinSection(),
      el("div", { class: "sec" }, el("h3", { text: "Words on the Short" }),
        el("div", { class: "hint", text: "Title, subtitle, the top line, the date and the bottom card are in the Title tab. Captions are in Captions, your own text in Text, and what gets posted in Post. Double-click anything on the preview to change its words." })),
      el("div", { class: "sec" }, el("h3", { text: "Keys" }), el("div", { class: "hint", text: "Space play/pause · ←/→ 0.1 s (Shift: 1 s) · S split · I / O mark a part, X cuts it, Enter keeps it · Delete removes what's selected · Ctrl+Z / Ctrl+Y · Ctrl+S save. Scroll on the waveform to zoom; hold Alt while dragging to skip snapping." })),
    ];
  }
  function presetSection() {
    const selected = PRESETS.find((p) => p.id === presetId);
    const select = el("select", { id: "editor-preset", "aria-label": "Saved editing preset" },
      el("option", { value: "", text: "Choose a preset…" }), ...PRESETS.map((p) => el("option", { value: p.id, text: p.name })));
    select.value = selected ? presetId : "";
    select.addEventListener("change", () => { presetId = select.value; presetName = PRESETS.find((p) => p.id === presetId)?.name || ""; renderPane(); });
    const name = el("input", { id: "preset-name", value: presetName, maxlength: "60", placeholder: "Gaming, Just Chatting, Funny reactions…", "aria-label": "Preset name" });
    name.addEventListener("input", () => { presetName = name.value; });
    const savePreset = async (replace) => {
      if (replace && !confirm(`Update “${selected.name}” with this look?`)) return;
      try {
        const p = await studio.savePreset({ ...(replace ? { id: presetId } : {}), name: name.value, edits: toEdits() });
        PRESETS = await studio.presets(); presetId = p.id; presetName = p.name; renderPane();
        toast(`Preset “${p.name}” saved. Choose it above Your clips for a batch.`);
      } catch (e) { toast(e.message, true); }
    };
    return el("div", { class: "sec presets" }, el("h3", { text: "Presets" }),
      el("div", { class: "row" }, select, el("button", { id: "apply-preset", text: "Apply", disabled: !selected, onclick: async () => {
        try {
          const p = await studio.presetStyle(presetId);
          change((E) => {
            E.layout = p.layout; E.geoBy[p.layout] = clone(p.geo); E.cropsBy[p.layout] = clone(p.crops);
            E.appearance = clone(p.appearance); E.cap = { ...E.cap, ...p.cap }; E.frame = { ...E.frame, ...p.frame };
            E.captions = p.captions; E.chatOn = p.chat; E.volume = p.volume ?? 0; E.noteWidth = p.noteWidth ?? E.noteWidth;
            E.music = p.music ? clone(p.music) : null;
          });
          toast(`Applied “${selected.name}”. Undo to go back; Save & rebuild to export.`);
        } catch (e) { toast(e.message, true); }
      } })),
      name,
      el("div", { class: "row" }, el("button", { id: "save-preset", text: "Save as new", onclick: () => savePreset(false) }),
        el("button", { id: "update-preset", text: "Update preset", disabled: !selected, onclick: () => savePreset(true) }),
        el("button", { id: "delete-preset", text: "Delete", disabled: !selected, onclick: async () => {
          if (!confirm(`Delete preset “${selected.name}”? Your Shorts keep their look.`)) return;
          try { await studio.deletePreset(presetId); toast("Preset deleted. Your Shorts are unchanged."); } catch (e) { toast(e.message, true); }
        } })),
      el("div", { class: "hint", text: "Saves layout, crops, theme, captions, title placement, branding, volume and music. Each clip keeps its own words, cuts and effects. Music starts at the beginning of each Short." }));
  }
  // when a card shows: its bar on the timeline, or the whole Short
  function cardTiming(k) {
    const f = E.frame, from = f[k + "From"], to = f[k + "To"], whole = from == null && to == null;
    const setT = (which) => (v) => change((E) => { E.frame[k + which] = v <= 0.05 && which === "From" ? null : v >= dur() - 0.05 && which === "To" ? null : r2(clamp(v, 0, dur())); });
    return el("div", { class: "row" }, el("span", { class: "hint", text: "Shows" }),
      num((from ?? 0).toFixed(1), "0.1", setT("From"), { title: "From (seconds in the clip)" }), el("span", { class: "hint", text: "to" }),
      num((to ?? dur()).toFixed(1), "0.1", setT("To"), { title: "To (seconds in the clip)" }),
      el("button", { text: whole ? "Whole Short ✓" : "Whole Short", disabled: whole, onclick: () => change((E) => { E.frame[k + "From"] = null; E.frame[k + "To"] = null; }) }),
      el("span", { class: "hint", text: "or drag its bar on the timeline" }));
  }
  // the title card and the bottom card: every word on them, their size and where they sit
  function paneTitle() {
    const f = E.frame, fr = (k) => (v) => change((E) => { E.frame[k] = v; }, { merge: "f." + k, insp: false, lanes: false });
    const warnHead = f.head && f.headY < 200, warnFoot = f.foot && f.footY + 100 > 1500;
    return [
      el("div", { class: "sec" },
        el("div", { class: "row" }, el("h3", { text: "Title card" }), el("span", { class: "grow" }), check("Show it", f.head, (v) => change((E) => { E.frame.head = v; }, { lanes: false }))),
        field("f-title", "Title", E.title, (v) => change((E) => { E.title = v; }, { merge: "title", insp: false, lanes: false }), { area: true, placeholder: "The big title (Enter starts a new line)" }),
        field("f-sub", "Subtitle", f.sub, fr("sub"), { area: true, placeholder: "A smaller line under the title (optional)" }),
        el("div", { class: "two" }, field("f-kicker", "Top line", f.kicker, fr("kicker"), { placeholder: "your show's name" }), field("f-date", "Date", f.date, fr("date"))),
        slider("Title size", 0, 110, 2, f.titleSize, fr("titleSize"), " px", (v) => v ? v + " px" : "auto"),
        slider("Card top", 0, 1700, 2, f.headY, fr("headY"), " px"),
        cardTiming("head"),
        el("div", { class: "hint" + (warnHead ? " warn" : ""), text: warnHead ? "Above y 200 the apps' own top bar covers the card." : "Drag the card on the preview too; double-click it to jump here. Size 'auto' shrinks long titles by itself." })),
      el("div", { class: "sec" },
        el("div", { class: "row" }, el("h3", { text: "Bottom card" }), el("span", { class: "grow" }), check("Show it", f.foot, (v) => change((E) => { E.frame.foot = v; }, { lanes: false }))),
        field("f-chan", "Channel line", f.chan, fr("chan"), { placeholder: "twitch.tv/yourchannel" }),
        el("div", { class: "hint", text: "What comes after the last / is red." }),
        field("f-byline", "Second line", f.byline, fr("byline"), { placeholder: "clipped by ..." }),
        field("f-stamp", "Stamp", f.stamp, fr("stamp"), { placeholder: "empty = no stamp" }),
        slider("Card top", 0, 1820, 2, f.footY, fr("footY"), " px"),
        cardTiming("foot"),
        el("div", { class: "hint" + (warnFoot ? " warn" : ""), text: warnFoot ? "Below y 1500 the apps' caption and buttons cover the card." : "Drag it on the preview too." })),
      el("div", { class: "row" },
        el("button", { text: "Back to the usual words", title: "The title from Twitch, and the usual top line, date, channel and stamp", onclick: () => change((E) => {
          const fd = frameDefaults(); E.title = X.title || E.title;
          Object.assign(E.frame, { kicker: fd.kicker, date: fd.date, sub: "", titleSize: 0, headY: fd.headY, chan: fd.chan, byline: fd.byline, stamp: fd.stamp, footY: fd.footY,
            headFrom: null, headTo: null, footFrom: null, footTo: null });
        }) })),
    ];
  }
  // what goes with the Short when you press Upload in the main window
  function panePost() {
    const u = E.upload, tags = hashtags().join(" "), vidTitle = (E.title.trim() || X.title || "").replace(/\s*\n\s*/g, " ");
    const count = (id, n, max) => el("span", { id, class: "hint" + (n > max ? " warn" : ""), text: `${n} / ${max}` });
    const title = field("p-title", "Title (YouTube and TikTok)", u.title, (v) => { change((E) => { E.upload.title = v; }, { merge: "u.title", insp: false, lanes: false }); $("#p-title-n").textContent = `${(v.trim() || vidTitle).length} / 100`; }, { placeholder: vidTitle });
    const usual = `${vidTitle}\n\nClipped by ${(D.frame && D.frame.by) || X.by || "chat"} live on twitch.tv/${SETTINGS.channel || (X && X.channel) || ""}\n\n${tags}`;
    return [
      el("div", { class: "sec" }, title,
        el("div", { class: "row" }, el("span", { class: "hint grow", text: "Empty = the title on the video." }), count("p-title-n", (u.title.trim() || vidTitle).length, 100))),
      el("div", { class: "sec" },
        field("p-desc", "YouTube description", u.description, (v) => change((E) => { E.upload.description = v; }, { merge: "u.desc", insp: false, lanes: false }), { area: true, rows: 7 }),
        el("div", { class: "row" }, el("button", { text: "The usual description", onclick: () => change((E) => { E.upload.description = usual; }) }))),
      el("div", { class: "sec" },
        field("p-tiktok", "TikTok caption", u.tiktok, (v) => change((E) => { E.upload.tiktok = v; }, { merge: "u.tk", insp: false, lanes: false }), { area: true, rows: 3, placeholder: `${u.title.trim() || vidTitle} ${tags}` }),
        el("div", { class: "hint", text: "Empty = the title and your hashtags. ⬆ Upload copies it for you to paste into TikTok." })),
      el("div", { class: "hint", text: "Save & rebuild keeps these with the Short. Then use ⬆ Upload on the Short in the main window." }),
    ];
  }
  // typed-over captions keep the timings of every word you didn't change; new or changed words share the time of
  // the ones they replace (lined up word by word, like a diff)
  function retime(old, typed) {
    const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
    const a = old.map((w) => norm(w.w)), b = typed.map(norm), N = a.length, M = b.length;
    const T = Array.from({ length: N + 1 }, () => new Uint16Array(M + 1));
    for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) T[i][j] = a[i] && a[i] === b[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
    const pairs = []; let i = 0, j = 0;
    while (i < N && j < M) { if (a[i] && a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (T[i + 1][j] >= T[i][j + 1]) i++; else j++; }
    const segs = segsN(), from0 = segs.length ? segs[0][0] : 0, to0 = segs.length ? segs[segs.length - 1][1] : dur();
    const out = new Array(M);
    for (const [pi, pj] of pairs) out[pj] = { ...old[pi], w: typed[pj] };   // keeps its timing, colour, bleep and emoji
    let pi0 = -1, pj0 = -1;
    for (const [pi, pj] of [...pairs, [N, M]]) {
      const n = pj - pj0 - 1;
      if (n > 0) {
        const olds = old.slice(pi0 + 1, pi);
        let lo = olds.length ? olds[0].s : pi0 >= 0 ? old[pi0].e : Math.min(from0, N ? old[0].s : from0);
        let hi = olds.length ? olds[olds.length - 1].e : pi < N ? old[pi].s : Math.max(to0, lo);
        let first = pj0 + 1, count = n;
        // no room (a word squeezed in between two spoken ones): share the time of the words either side
        if (hi - lo < 0.12 * n) {
          if (pj0 >= 0) { lo = old[pi0].s; first = pj0; count++; }
          if (pi < N) { hi = old[pi].e; count++; }
          if (hi - lo < 0.12 * count) hi = lo + 0.12 * count;
        }
        const step = (hi - lo) / count;
        for (let k = 0; k < count; k++) out[first + k] = { w: typed[first + k], s: r2(lo + k * step), e: r2(lo + (k + 1) * step) };
      }
      pi0 = pi; pj0 = pj;
    }
    return out;
  }
  let wordOpen = -1;   // the word whose colour / emoji line is open
  function paneCaptions() {
    const c = E.cap, m = mm(), t = now();
    const all = el("textarea", { rows: "4", spellcheck: "true" }); all.value = E.words.map((w) => w.w).join(" ");
    const useText = el("button", { class: "primary", text: "Use this text", onclick: () => {
      const typed = all.value.trim().split(/\s+/).filter(Boolean);
      if (!change((E) => { E.words = retime(E.words, typed); })) toast("Nothing changed");
    } });
    const inShort = (w) => m.map(w.s) != null;
    const rows = E.words.flatMap((w, i) => {
      const txt = el("input", { value: w.w, style: w.color ? `color:${w.color}` : "" });
      txt.addEventListener("input", () => change((E) => { E.words[i].w = txt.value; }, { merge: "w" + i, insp: false }));
      const row = el("div", { class: "wrow" + (inShort(w) ? "" : " cut") + (t >= w.s && t < w.e ? " now" : "") + (sel && sel.kind === "word" && sel.i === i ? " sel-row now" : ""), "data-i": i },
        el("button", { text: "▶", title: "Go to " + w.s.toFixed(2) + " s", onclick: () => { sel = { kind: "word", i }; markSelected(); seekTo(w.s); } }),
        txt,
        num(w.s.toFixed(2), "0.05", (v) => change((E) => { E.words[i].s = r2(v); if (E.words[i].e < v + 0.03) E.words[i].e = r2(v + 0.2); E.words.sort((a, b) => a.s - b.s); }), { title: "Starts (s)" }),
        num(w.e.toFixed(2), "0.05", (v) => change((E) => { E.words[i].e = r2(Math.max(v, E.words[i].s + 0.03)); }), { title: "Ends (s)" }),
        el("button", { class: w.bleep ? "on" : "", text: "🔇", title: w.bleep ? "Bleeped: click to un-bleep" : "Bleep this word", onclick: () => change((E) => { E.words[i].bleep = !E.words[i].bleep; }) }),
        el("button", { class: wordOpen === i || w.color || w.emoji ? "on" : "", text: w.emoji || "🎨", title: "Its own colour or an emoji", onclick: () => { wordOpen = wordOpen === i ? -1 : i; renderPane(); } }),
        el("button", { text: "✕", title: "Remove this word", onclick: () => change((E) => { E.words.splice(i, 1); }) }));
      if (wordOpen !== i) return [row];
      // this word's extras: its own colour (a key word), an emoji over the captions while it's on screen
      const emo = el("input", { value: w.emoji || "", placeholder: "emoji", style: "width:70px" });
      emo.addEventListener("input", () => change((E) => { E.words[i].emoji = emo.value.trim() || undefined; }, { merge: "emo" + i, insp: false }));
      return [row, el("div", { class: "wmore" },
        check("Own colour", !!w.color, (v) => change((E) => { E.words[i].color = v ? (E.words[i].color || "#ffd23f") : undefined; })),
        colorInput(w.color || "#ffd23f", (v) => change((E) => { E.words[i].color = v; }, { merge: "wc" + i, insp: false })),
        el("span", { class: "hint", text: "Emoji" }), emo,
        ["😂", "😱", "💀", "🔥", "👀", "😭"].map((x) => el("button", { text: x, onclick: () => change((E) => { E.words[i].emoji = E.words[i].emoji === x ? undefined : x; }) })))];
    });
    const shift = (d) => change((E) => { for (const w of E.words) { w.s = r2(Math.max(0, w.s + d)); w.e = r2(Math.max(w.s + 0.03, w.e + d)); } });
    return [
      el("div", { class: "sec" },
        el("div", { class: "row" }, check("Show captions", E.captions, (v) => change((E) => { E.captions = v; })), el("span", { class: "grow" }),
          el("button", { text: "🔇 Bleep word at playhead", title: "B", onclick: bleepAtPlayhead })),
        el("div", { class: "field" }, el("span", { text: "Style" }),
          el("div", { class: "seg" }, [["classic", "Classic"], ["pop", "Pop"], ["punch", "Punch"], ["box", "Box"], ["reveal", "Reveal"]].map(([k, name]) =>
            el("button", { class: (c.style || "classic") === k ? "on" : "", text: name, title: { classic: "The spoken word in colour", pop: "Each group pops in", punch: "The spoken word jumps", box: "On a dark card", reveal: "Words appear as they're said" }[k],
              onclick: () => change((E) => { E.cap.style = k; }, { lanes: false }) }))), el("span")),
        slider("Size", 30, 140, 1, c.size, (v) => change((E) => { E.cap.size = v; }, { merge: "size", insp: false, lanes: false }), " px"),
        slider("Bottom edge at", 300, 1900, 2, Math.round(c.bottom), (v) => change((E) => { E.cap.bottom = v; }, { merge: "bottom", insp: false, lanes: false }), " px"),
        el("div", { class: "field" }, el("span", { text: "Words at a time" }),
          el("div", { class: "seg" }, [1, 2, 3, 4].map((n) => el("button", { class: n === c.group ? "on" : "", text: String(n), onclick: () => change((E) => { E.cap.group = n; }) }))), el("span")),
        el("div", { class: "row" },
          check("CAPITALS", c.upper, (v) => change((E) => { E.cap.upper = v; }, { lanes: false })),
          el("span", { class: "grow" }),
          el("label", { class: "check" }, "Spoken word", colorInput(c.hi, (v) => change((E) => { E.cap.hi = v; }, { merge: "hi", insp: false, lanes: false }))),
          el("label", { class: "check" }, "Others", colorInput(c.color, (v) => change((E) => { E.cap.color = v; }, { merge: "color", insp: false, lanes: false })))),
        el("div", { class: "hint", text: "Drag the captions up and down on the preview too." })),
      el("div", { class: "sec" }, el("h3", { text: "Fix the words" }),
        el("div", { class: "hint", text: "All the captions as text. Type over anything (a wrong word, a name, a swear to hide as ***), add or remove words, then press Use this text. Words you didn't change keep their timing." }),
        all, el("div", { class: "row" }, useText, el("span", { class: "hint", text: "Or double-click a caption on the preview." }))),
      el("div", { class: "sec" },
        el("div", { class: "row" }, el("h3", { text: `Word by word (${E.words.length})` }), el("span", { class: "grow" }),
          el("button", { text: "+ At playhead", title: "Add a word where the playhead is", onclick: () => { const at = now(); change((E) => { E.words.push({ w: "word", s: r2(at), e: r2(Math.min(dur(), at + 0.4)) }); E.words.sort((a, b) => a.s - b.s); }); } }),
          el("button", { text: "Whisper's words", title: "Back to the words and timings Whisper heard", onclick: () => change((E) => { E.words = D.whisper.map((w) => ({ w: w.w, s: r2(w.s), e: r2(w.e) })); }) })),
        el("div", { class: "row" }, el("span", { class: "hint", text: "All captions:" }),
          el("button", { text: "0.1 s earlier", onclick: () => shift(-0.1) }), el("button", { text: "0.1 s later", onclick: () => shift(0.1) })),
        el("div", { class: "hint", text: "Fix a word by typing over it. The two numbers are when it starts and ends (seconds in the clip). You can also drag and stretch words on the timeline; double-click one to type." }),
        rows.length ? el("div", { class: "list" }, rows) : el("div", { class: "empty", text: "Whisper heard no words in this clip." })),
    ];
  }
  const colorInput = (value, onInput) => { const i = el("input", { type: "color", value: value || "#ffffff" }); i.addEventListener("input", () => onInput(i.value)); return i; };
  // like make-short.cjs scheduleNotes: one note per slot at a time, 3 s each, the same person at most every 6 s, up to 10
  function autoNotes() {
    const m = mm(), d = defs(), slots = d.notes.slots, free = slots.map(() => 0), out = [], lastBy = {};
    const msgs = D.chat.map((c) => ({ ...c, at: m.map(Math.max(0, c.rel - 1), true) })).filter((c) => c.at != null).sort((a, b) => a.at - b.at);
    for (const c of msgs) {
      if (c.at > m.outDur - 1.2) break;
      if (lastBy[c.name] != null && c.at - lastBy[c.name] < 6) continue;
      const s = free.findIndex((f) => f <= c.at + 0.8); if (s < 0) continue;
      const at = Math.max(c.at, free[s]);
      out.push({ key: c.key, t: r2(m.unmap(at)), x: d.notes.x, y: slots[s], hold: r2(Math.min(m.outDur, at + 3) - at) });
      lastBy[c.name] = at; free[s] = at + 3.15;
      if (out.length >= 10) break;
    }
    return out;
  }
  function paneChat() {
    const on = new Map(E.notes.map((n) => [n.key, n])), d = defs();
    const rows = D.chat.map((msg) => {
      const n = on.get(msg.key);
      const cb = el("input", { type: "checkbox" }); cb.checked = !!n;
      cb.addEventListener("change", () => change((E) => {
        if (cb.checked) E.notes.push({ key: msg.key, t: r2(clamp(msg.rel - 1, 0, dur() - 0.5)), x: d.notes.x, y: d.notes.slots[0], hold: 3 });
        else E.notes = E.notes.filter((x) => x.key !== msg.key);
      }));
      const upd = (f) => (v) => change((E) => { const x = E.notes.find((q) => q.key === msg.key); if (x) f(x, v); });
      let own = null;
      if (n) {
        own = el("input", { class: "own", placeholder: "Your wording on the Short (optional): fix a typo, hide a word", value: n.text || "" });
        own.addEventListener("input", () => change((E) => { const x = E.notes.find((q) => q.key === msg.key); if (x) x.text = own.value; }, { merge: "nt" + msg.key, insp: false, lanes: false }));
      }
      return el("div", { class: "crow" + (n ? " on" : "") + (sel && sel.kind === "note" && sel.key === msg.key ? " sel-row" : ""), "data-key": msg.key },
        cb, el("span", { class: "tm", text: msg.rel.toFixed(1) + "s" }),
        el("span", {}, el("span", { class: "nm", text: msg.name, style: msg.color ? `color:${msg.color}` : "" }), msg.text),
        own ? el("div", { class: "opts" }, own) : null,
        n ? el("div", { class: "opts" },
          "at", num(n.t.toFixed(2), "0.1", upd((x, v) => (x.t = r2(clamp(v, 0, dur())))), { title: "When it shows (seconds in the clip)" }),
          "for", num(n.hold.toFixed(1), "0.5", upd((x, v) => (x.hold = r2(clamp(v, 0.5, 15)))), { title: "How long (seconds)" }),
          "y", num(n.y, "10", upd((x, v) => (x.y = Math.round(clamp(v, 0, H - 100))))),
          el("button", { text: "▶", title: "Go there", onclick: () => { sel = { kind: "note", key: msg.key }; markSelected(); seekTo(n.t); } }),
          el("button", { text: "Now", title: "Show it from the playhead", onclick: () => { const at = now(); change((E) => { const x = E.notes.find((q) => q.key === msg.key); if (x) x.t = r2(at); }); } })) : null);
    });
    return [
      el("div", { class: "sec" },
        el("div", { class: "row" }, check("Show chat notes", E.chatOn, (v) => change((E) => { E.chatOn = v; })), el("span", { class: "grow" }),
          el("button", { text: "Auto-pick", title: "Pick and place them the way the maker does", onclick: () => change((E) => { E.notes = autoNotes(); }) }),
          el("button", { text: "None", onclick: () => change((E) => { E.notes = []; }) })),
        slider("Note width", 260, 760, 10, E.noteWidth, (v) => change((E) => { E.noteWidth = v; }, { merge: "nw", insp: false, lanes: false }), " px"),
        el("div", { class: "hint", text: "Tick a message to put it on the Short. Drag notes on the preview to move them, and on the timeline's Chat lane to change when and how long." })),
      el("div", { class: "sec" }, el("h3", { text: `Chat from this moment (${D.chat.length})` }),
        rows.length ? el("div", { class: "list" }, rows) : el("div", { class: "empty", text: "Nobody wrote anything during this clip." })),
    ];
  }
  function paneText() {
    const rows = E.texts.map((x, i) => {
      const ta = el("textarea", { rows: "2" }); ta.value = x.text;
      ta.addEventListener("input", () => change((E) => { E.texts[i].text = ta.value; }, { merge: "tx" + i, insp: false }));
      const upd = (f) => (v) => change((E) => f(E.texts[i], v));
      return el("div", { class: "trow" + (sel && sel.kind === "text" && sel.i === i ? " sel-row" : ""), "data-i": i }, ta,
        el("div", { class: "row" }, "from", num(x.t.toFixed(2), "0.1", upd((t, v) => (t.t = r2(clamp(v, 0, dur()))))), "to", num(x.e.toFixed(2), "0.1", upd((t, v) => (t.e = r2(clamp(v, t.t + 0.2, dur()))))),
          el("button", { text: "▶", onclick: () => { sel = { kind: "text", i }; markSelected(); seekTo(x.t); } })),
        el("div", { class: "row" }, "y", num(x.y, "10", upd((t, v) => (t.y = Math.round(clamp(v, 0, H - 60))))), "size", num(x.size, "2", upd((t, v) => (t.size = Math.round(clamp(v, 20, 160))))),
          colorInput(x.color, (v) => change((E) => { E.texts[i].color = v; }, { merge: "tc" + i, insp: false, lanes: false })),
          check("dark card", x.box, (v) => change((E) => { E.texts[i].box = v; }, { lanes: false })), el("span", { class: "grow" }),
          el("button", { text: "✕", title: "Remove", onclick: () => { sel = null; change((E) => { E.texts.splice(i, 1); }); } })));
    });
    return [
      el("div", { class: "sec" },
        el("button", { class: "primary", text: "+ Add text at the playhead", onclick: () => { const at = now(); change((E) => { E.texts.push({ text: "WAIT FOR IT", t: r2(at), e: r2(Math.min(dur(), at + 2.5)), y: 900, size: 84, color: "#ffffff", box: true }); }); sel = { kind: "text", i: E.texts.length - 1 }; renderPane(); } }),
        el("div", { class: "hint", text: "Your own words on the Short: a punchline, \"wait for it\", a name. Drag them up and down on the preview; stretch them on the timeline's Text lane. They stay in the safe column (x 60-900)." })),
      ...(rows.length ? rows : [el("div", { class: "empty", text: "No text yet." })]),
    ];
  }

  // ---------- stickers: emoji, your emotes, arrows, circles, stamps and labels ----------
  const EMOJI = ["😂", "😱", "💀", "🔥", "👀", "😭", "🤡", "🍎", "🔍", "❓", "❗", "💯", "😳", "🫠", "👏", "🙏", "💔", "😈", "🕵️", "🚨"];
  function paneStickers() {
    const lib = window.LIBRARY || {};
    const pick = (spec, text, title) => el("button", { class: "pick", title: title || "Add at the playhead", onclick: () => addSticker(spec) }, text);
    const emote = (x) => el("button", { class: "pick img", title: x.name, onclick: () => addSticker({ kind: "image", src: x.file, name: x.name }) }, el("img", { src: fileSrc(x.file), alt: x.name }));
    const rows = E.stickers.map((x, i) => {
      const upd = (f, merge) => (v) => change((E) => f(E.stickers[i], v), merge ? { merge: merge + i, insp: false } : {});
      const thumb = el("div", { class: "sthumb" }); if (window.makeSticker) { const s = window.makeSticker({ ...x, size: 60, rot: 0 }, fileSrc); thumb.append(s); }
      const kindFields = [];
      if (x.kind === "emoji") { const inp = el("input", { value: x.emoji || "", style: "width:70px" }); inp.addEventListener("input", () => upd((s, v) => (s.emoji = v), "se")(inp.value)); kindFields.push("emoji", inp); }
      if (x.kind === "stamp" || x.kind === "label") { const inp = el("input", { value: x.text || "", style: "width:140px" }); inp.addEventListener("input", () => upd((s, v) => (s.text = v), "st")(inp.value)); kindFields.push("text", inp); }
      if (["arrow", "circle", "stamp", "label"].includes(x.kind)) kindFields.push(colorInput(x.color || E.appearance.accent || "#ef443b", upd((s, v) => (s.color = v), "sc")));
      return el("div", { class: "srow" + (sel && sel.kind === "sticker" && sel.i === i ? " sel-row" : ""), "data-i": i, tabindex: "-1" },
        el("div", { class: "row" }, thumb, el("b", { text: stickerName(x) }), el("span", { class: "grow" }), ...kindFields),
        slider("Size", 40, 1000, 10, x.size || 200, upd((s, v) => (s.size = v), "ss"), " px"),
        slider("Rotate", -180, 180, 1, x.rot || 0, upd((s, v) => (s.rot = v), "sr"), "°"),
        x.kind === "circle" ? slider("Height", 0.3, 2, 0.05, x.ratio || 0.7, upd((s, v) => (s.ratio = v), "sh"), "", (v) => "×" + v) : null,
        el("div", { class: "row" }, "from", num(x.t.toFixed(2), "0.1", upd((s, v) => (s.t = r2(clamp(v, 0, dur()))))), "to", num(x.e.toFixed(2), "0.1", upd((s, v) => (s.e = r2(clamp(v, s.t + 0.2, dur()))))),
          "x", num(x.x, "10", upd((s, v) => (s.x = Math.round(clamp(v, 0, W))))), "y", num(x.y, "10", upd((s, v) => (s.y = Math.round(clamp(v, 0, H))))),
          el("span", { class: "grow" }),
          el("button", { text: "▶", onclick: () => { sel = { kind: "sticker", i }; markSelected(); seekTo(x.t); } }),
          el("button", { text: "✕", title: "Remove", onclick: () => { sel = null; change((E) => { E.stickers.splice(i, 1); }); } })));
    });
    return [
      el("div", { class: "sec" }, el("h3", { text: "Add at the playhead" }),
        el("div", { class: "picks" }, EMOJI.map((x) => pick({ kind: "emoji", emoji: x }, x))),
        el("div", { class: "picks" },
          pick({ kind: "arrow" }, "➜ Arrow"), pick({ kind: "circle" }, "◯ Circle"), ...(THEMES.find((t) => t.id === E.appearance.theme)?.stamps || D.stamps || ["EVIDENCE"]).map((t) => pick({ kind: "stamp", text: t }, t)), ...(THEMES.find((t) => t.id === E.appearance.theme)?.labels || D.labels || ["EXHIBIT A"]).map((t) => pick({ kind: "label", text: t }, t + " label"))),
        (lib.emotes || []).length ? el("div", {}, el("div", { class: "hint", text: "Your channel's emotes" }), el("div", { class: "picks" }, lib.emotes.map(emote))) : null,
        (lib.stickers || []).length ? el("div", {}, el("div", { class: "hint", text: "Your pictures" }), el("div", { class: "picks" }, lib.stickers.map(emote))) : null,
        el("div", { class: "hint", text: "Drag a sticker on the preview to move it, and on the timeline's Stickers track to change when it shows. Drag across the empty Stickers track to add one there. Add your own pictures with the Pictures folder button in the Sound tab, then Refresh library." })),
      ...(rows.length ? rows : [el("div", { class: "empty", text: "No stickers yet." })]),
    ];
  }

  // ---------- Cuts: everything cut out of the clip, to put back or cut again ----------
  function paneCuts() {
    const list = cutList(), out = list.filter((c) => c.on), back = list.filter((c) => !c.on);
    // the words, to cut or put back by selecting them
    const W = sortedWords(), m = mm(), inS = (w) => m.map((w.s + w.e) / 2) != null;
    const [i0, i1] = wsel ? [Math.min(wsel.a, wsel.b), Math.max(wsel.a, wsel.b)] : [-1, -2];
    const picked = W.slice(Math.max(0, i0), i1 + 1), anyIn = picked.some(inS), anyOut = picked.some((w) => !inS(w));
    const toks = W.map((w, i) => el("span", { class: "wtok" + (inS(w) ? "" : " out") + (i >= i0 && i <= i1 ? " picked" : ""), "data-i": i, text: w.w, title: `${fmt(w.s)} – ${fmt(w.e)}${inS(w) ? "" : " (cut out)"}` }));
    const box = el("div", { class: "wtext" }, ...toks.flatMap((t, i) => i ? [" ", t] : [t]));
    const paint = () => { const [x, y] = [Math.min(wsel.a, wsel.b), Math.max(wsel.a, wsel.b)]; for (const t of box.querySelectorAll(".wtok")) t.classList.toggle("picked", +t.dataset.i >= x && +t.dataset.i <= y); };
    box.addEventListener("pointerdown", (e) => { const t = e.target.closest(".wtok"); if (!t) return; e.preventDefault(); const i = +t.dataset.i;
      wsel = e.shiftKey && wsel ? { a: wsel.a, b: i } : { a: i, b: i }; wdrag = true; seekTo(W[i].s); paint(); });
    box.addEventListener("pointerover", (e) => { if (!wdrag) return; const t = e.target.closest(".wtok"); if (!t) return; wsel.b = +t.dataset.i; paint(); });
    const words = el("div", { class: "sec" },
      el("div", { class: "row" }, el("h3", { text: "Cut by words" }), el("span", { class: "grow" }),
        el("button", { class: anyIn ? "primary" : "", text: "✂ Cut these words", disabled: !anyIn, title: "Delete", onclick: () => cutWords(false) }),
        el("button", { text: "↺ Put them back", disabled: !anyOut, onclick: () => cutWords(true) })),
      W.length ? box : el("div", { class: "empty", text: "No words in this clip." }),
      el("div", { class: "hint", text: picked.length ? `${picked.length} word${picked.length === 1 ? "" : "s"} picked · ${fmt(picked[0].s)} – ${fmt(picked[picked.length - 1].e)} · Delete cuts them, Esc lets go`
        : "Click a word, or drag across words (Shift+click adds up to a word). Crossed-out words are cut out of the Short." }));
    const secs = out.reduce((t, c) => t + c.b - c.a, 0);
    const rows = list.map((c, i) => el("div", { class: "srow cutrow" + (c.on ? "" : " back") + (sel && (sel.kind === "cut" || sel.kind === "uncut") && sel.i === i ? " sel-row" : ""), "data-i": i },
      el("div", { class: "row" },
        el("b", { text: c.on ? "✂ Cut out" : "↺ Back in" }),
        el("span", { class: "mono", text: `${fmt(c.a)} – ${fmt(c.b)}` }), el("span", { class: "hint", text: (c.b - c.a).toFixed(2) + " s" }),
        el("span", { class: "grow" }),
        el("button", { text: c.on ? "▶ Check" : "▶", title: c.on ? "Play across the cut like the Short: a little before it, the jump, a little after" : "Play this part", onclick: () => { sel = { kind: c.on ? "cut" : "uncut", i }; markSelected(); checkJoin(c); } }),
        c.on ? el("button", { text: "Remove cut", title: "Put this part back in the Short", onclick: () => uncut(c.a, c.b) })
          : el("button", { text: "Cut again", title: "Take this part out of the Short again", onclick: () => recut(c.a, c.b) }),
        c.on ? null : el("button", { text: "✕", title: "Forget this cut (the part stays in the Short)", onclick: () => forgetCut(c.a, c.b) })),
      el("div", { class: "row times" }, el("span", { class: "hint", text: "from" }), num(c.a.toFixed(2), "0.05", (v) => editCut(c, v, c.b)),
        el("span", { class: "hint", text: "to" }), num(c.b.toFixed(2), "0.05", (v) => editCut(c, c.a, v)),
        el("span", { class: "hint", text: "seconds in the clip" }))));
    return [
      words,
      el("div", { class: "sec" },
        el("div", { class: "row" }, el("h3", { text: "Cuts" }), el("span", { class: "grow" }),
          el("button", { text: "Remove all cuts", disabled: !out.length, onclick: () => { sel = null; change((E) => { E.segs = [[0, dur()]]; }); } }),
          el("button", { text: "Cut all again", disabled: !back.length, onclick: () => {
            let left = segsN(); for (const c of back) left = subtract(left, c.a, c.b); left = segsN(left);
            if (!left.length) return toast("That would cut the whole clip", true);
            sel = null; change((E) => { E.segs = left; });
          } })),
        el("div", { class: "hint", text: "Everything cut out of the clip, and the cuts you put back. Remove cut puts that part back in the Short; Cut again takes it out again. Type a cut's times to move its edges; ▶ Check plays across it the way the Short will." }),
        el("div", { class: "hint", text: "Keys: I marks where a part starts and O where it ends (at the playhead); X cuts that part out, Enter keeps it. Edges you drag snap to words and the playhead; hold Alt to place them freely." }),
        el("div", { class: "hint", text: "On the timeline: click a ✂ cut on the Video track and press Delete, or double-click it. A part you put back keeps a dashed red line under it; double-click the line to cut it again." }),
        el("div", { class: "hint", text: out.length ? `${out.length} cut${out.length === 1 ? "" : "s"}, ${secs.toFixed(1)} s taken out. The Short is ${mm().outDur.toFixed(1)} s.` : `Nothing is cut out: the Short is the whole clip (${mm().outDur.toFixed(1)} s).` })),
      ...(rows.length ? rows : [el("div", { class: "empty", text: "No cuts yet. Drag across the Video track in cut mode, or Split and Delete, to take a part out." })]),
    ];
  }

  // ---------- FX: zoom, slow motion, freeze frames ----------
  function paneFx() {
    const zooms = E.zooms.map((x, i) => {
      const upd = (f, merge) => (v) => change((E) => f(E.zooms[i], v), merge ? { merge: merge + i, insp: false } : {});
      return el("div", { class: "srow" + (sel && sel.kind === "zoom" && sel.i === i ? " sel-row" : ""), "data-i": i },
        el("div", { class: "row" }, el("b", { text: `🔍 Zoom ${i + 1}` }), el("span", { class: "grow" }),
          isSplit() ? el("div", { class: "seg" }, [["face", "Camera"], ["game", "Game"]].map(([k, n]) => el("button", { class: (x.target === "game" ? "game" : "face") === k ? "on" : "", text: n, onclick: () => change((E) => { E.zooms[i].target = k; }) }))) : null),
        slider("How close", 1.05, 2.5, 0.05, x.z || 1.45, upd((s, v) => (s.z = v), "zz"), "", (v) => v.toFixed(2) + "x"),
        slider("Spot across", 0, 1, 0.01, x.fx ?? 0.5, upd((s, v) => (s.fx = v), "zx"), "", (v) => Math.round(v * 100) + "%"),
        slider("Spot down", 0, 1, 0.01, x.fy ?? 0.42, upd((s, v) => (s.fy = v), "zy"), "", (v) => Math.round(v * 100) + "%"),
        slider("Ease in/out", 0.1, 1, 0.05, x.ramp || 0.3, upd((s, v) => (s.ramp = v), "zr"), " s"),
        el("div", { class: "row" }, "from", num(x.t.toFixed(2), "0.1", upd((s, v) => (s.t = r2(clamp(v, 0, dur()))))), "to", num(x.e.toFixed(2), "0.1", upd((s, v) => (s.e = r2(clamp(v, s.t + 0.3, dur()))))),
          el("span", { class: "grow" }), el("button", { text: "▶", onclick: () => { sel = { kind: "zoom", i }; markSelected(); seekTo(Math.max(0, x.t - 0.5)); } }),
          el("button", { text: "✕", onclick: () => { sel = null; change((E) => { E.zooms.splice(i, 1); }); } })));
    });
    const slows = E.speeds.map((x, i) => {
      const upd = (f) => (v) => change((E) => f(E.speeds[i], v));
      return el("div", { class: "srow" + (sel && sel.kind === "slow" && sel.i === i ? " sel-row" : ""), "data-i": i },
        el("div", { class: "row" }, el("b", { text: "Speed" }), el("span", { class: "grow" }),
          el("div", { class: "seg" }, [0.25, 0.5, 0.75, 1.5, 2].map((s) => el("button", { class: x.speed === s ? "on" : "", text: s + "x", onclick: () => change((E) => { E.speeds[i].speed = s; }) })))),
        el("div", { class: "row" }, "from", num(x.a.toFixed(2), "0.1", upd((s, v) => (s.a = r2(clamp(v, 0, dur()))))), "to", num(x.b.toFixed(2), "0.1", upd((s, v) => (s.b = r2(clamp(v, s.a + 0.2, dur()))))),
          el("span", { class: "grow" }), el("button", { text: "▶", onclick: () => { sel = { kind: "slow", i }; markSelected(); seekTo(Math.max(0, x.a - 0.5)); } }),
          el("button", { text: "✕", onclick: () => { sel = null; change((E) => { E.speeds.splice(i, 1); }); } })));
    });
    const freezes = E.freezes.map((x, i) => el("div", { class: "srow" + (sel && sel.kind === "freeze" && sel.i === i ? " sel-row" : ""), "data-i": i },
      el("div", { class: "row" }, el("b", { text: "❄ Freeze " }), "at", num(x.t.toFixed(2), "0.05", (v) => change((E) => { E.freezes[i].t = r2(clamp(v, 0, dur())); })),
        el("span", { class: "grow" }), el("button", { text: "▶", onclick: () => { sel = { kind: "freeze", i }; markSelected(); seekTo(Math.max(0, x.t - 1)); } }),
        el("button", { text: "✕", onclick: () => { sel = null; change((E) => { E.freezes.splice(i, 1); }); } })),
      slider("Hold for", 0.3, 5, 0.1, x.d || 1.2, (v) => change((E) => { E.freezes[i].d = v; }, { merge: "fd" + i, insp: false }), " s")));
    // a freeze with "WAIT FOR IT" and a record scratch, the classic gag, in one click
    const gag = () => {
      const t = now(), scratch = ((window.LIBRARY || {}).sfx || []).find((x) => /scratch/i.test(x.name));
      if (!mm().segs.some(([a, b]) => t >= a - 0.02 && t <= b + 0.02)) return toast("Put the playhead inside a kept part");
      change((E) => {
        E.freezes.push({ t: r2(t), d: 1.4 });
        E.texts.push({ text: "WAIT FOR IT", t: r2(t), e: r2(Math.min(dur(), t + 0.1)), y: 900, size: 96, color: "#ffffff", box: true });
        if (scratch) E.sfx.push({ file: scratch.file, t: r2(t), vol: 0 });
      });
      toast("Freeze + WAIT FOR IT + record scratch added");
    };
    return [
      el("div", { class: "sec" }, el("div", { class: "row" }, el("h3", { text: "Zoom" }), el("span", { class: "grow" }), el("button", { class: "primary", text: "🔍 Zoom at playhead", title: "Z", onclick: () => addZoom() })),
        el("div", { class: "hint", text: "Pushes in on a spot, holds, and eases back out: the reaction shot. Stretch its bar on the Zoom track, or drag across the empty track to add one." })),
      ...zooms,
      el("div", { class: "sec" }, el("div", { class: "row" }, el("h3", { text: "Slow motion / speed up" }), el("span", { class: "grow" }), el("button", { class: "primary", text: "🐢 Slow-mo at playhead", onclick: addSlow })),
        el("div", { class: "hint", text: "The sound slows down with it (same pitch). Drag across the empty Speed track to add one." })),
      ...slows,
      el("div", { class: "sec" }, el("div", { class: "row" }, el("h3", { text: "Freeze frame" }), el("span", { class: "grow" }), el("button", { class: "primary", text: "❄ Freeze at playhead", title: "F", onclick: addFreeze })),
        el("div", { class: "row" }, el("button", { text: "❄ + WAIT FOR IT + record scratch", onclick: gag })),
        el("div", { class: "hint", text: "Holds the picture for a moment (silent, unless you add a sound effect there). Drag its marker on the Speed track." })),
      ...freezes,
    ];
  }

  // ---------- Sound: your volume, bleeps, sound effects, music ----------
  let audition = null;
  function hear(file, gain) {
    if (audition) { audition.pause(); audition = null; }
    audition = new Audio(fileSrc(file)); audition.volume = clamp(gain, 0, 1); audition.play().catch(() => {});
  }
  function paneSound() {
    const lib = window.LIBRARY || {}, groups = {};
    for (const x of lib.sfx || []) (groups[x.group] = groups[x.group] || []).push(x);
    const libList = Object.entries(groups).map(([g, list]) => el("div", {}, el("div", { class: "hint", text: g }),
      el("div", { class: "sounds" }, list.map((x) => el("div", { class: "snd" },
        el("button", { text: "▶", title: "Listen", onclick: () => hear(x.file, previewGain(x.file, -18, 0)) }),
        el("span", { text: x.name, title: `${x.dur} s` }),
        el("button", { text: "+", title: "Add at the playhead", onclick: () => addSfx(x.file) }))))));
    const placed = E.sfx.map((x, i) => el("div", { class: "srow" + (sel && sel.kind === "sfx" && sel.i === i ? " sel-row" : ""), "data-i": i },
      el("div", { class: "row" }, el("b", { text: "🔊 " + soundName(x.file) }), "at", num(x.t.toFixed(2), "0.05", (v) => change((E) => { E.sfx[i].t = r2(clamp(v, 0, dur())); })),
        el("span", { class: "grow" }), el("button", { text: "▶", onclick: () => { sel = { kind: "sfx", i }; markSelected(); seekTo(Math.max(0, x.t - 0.6)); } }),
        el("button", { text: "✕", onclick: () => { sel = null; change((E) => { E.sfx.splice(i, 1); }); } })),
      slider("Volume", -18, 12, 0.5, x.vol || 0, (v) => change((E) => { E.sfx[i].vol = v; }, { merge: "sv" + i, insp: false }), " dB", (v) => (v > 0 ? "+" : "") + v + " dB")));
    const music = lib.music || [], mu = E.music;
    const pickMusic = el("select", {}, el("option", { value: "", text: "No music" }), music.map((x) => el("option", { value: x.file, text: `${x.name} (${x.group})`, selected: mu && mu.file === x.file })));
    pickMusic.addEventListener("change", () => change((E) => { E.music = pickMusic.value ? { vol: 0, duck: true, offset: 0, t: null, e: null, ...(E.music || {}), file: pickMusic.value } : null; }));
    const bleeped = E.words.map((w, i) => ({ w, i })).filter((x) => x.w.bleep);
    return [
      el("div", { class: "sec" }, el("h3", { text: "Your sound" }),
        slider("Volume", -12, 12, 0.5, E.volume, (v) => change((E) => { E.volume = v; }, { merge: "vol", insp: false, lanes: false }), " dB", (v) => (v > 0 ? "+" : "") + v + " dB"),
        el("div", { class: "row" }, el("button", { text: "🔇 Bleep word at playhead", title: "B", onclick: bleepAtPlayhead }), el("span", { class: "grow" }),
          el("span", { class: "hint", text: bleeped.length ? `${bleeped.length} bleeped` : "No bleeps" })),
        bleeped.length ? el("div", { class: "picks" }, bleeped.map(({ w, i }) => el("button", { class: "pick", title: "Un-bleep", onclick: () => change((E) => { E.words[i].bleep = false; }) }, `${w.w} ✕`))) : null),
      el("div", { class: "sec" }, el("h3", { text: "Music" }), pickMusic,
        mu ? [
          slider("Volume", -12, 12, 0.5, mu.vol || 0, (v) => change((E) => { E.music.vol = v; }, { merge: "mv", insp: false }), " dB", (v) => (v > 0 ? "+" : "") + v + " dB"),
          check("Dip under my voice", mu.duck !== false, (v) => change((E) => { E.music.duck = v; })),
          slider("Start the song at", 0, Math.max(1, Math.floor((libEntry(mu.file) || {}).dur || 60)), 0.5, mu.offset || 0, (v) => change((E) => { E.music.offset = v; }, { merge: "mo", insp: false }), " s"),
          el("div", { class: "row" }, el("button", { text: "▶ Listen", onclick: () => hear(mu.file, previewGain(mu.file, -24, mu.vol)) }),
            el("button", { text: "Whole Short", disabled: mu.t == null && mu.e == null, onclick: () => change((E) => { E.music.t = null; E.music.e = null; }) }),
            el("span", { class: "hint", text: "Stretch its bar on the Music track to play it for part of the Short." }))] : null,
        el("div", { class: "hint", text: "0 dB sits well under your voice. It fades in and out by itself. Royalty-free only: TikTok and YouTube mute copyrighted songs. The YouTube Audio Library and Pixabay have free ones; use the Music folder button below." })),
      el("div", { class: "sec" }, el("div", { class: "row" }, el("h3", { text: "Sound effects" }), el("span", { class: "grow" }),
          el("button", { text: "↻ Refresh library", title: "After adding files to your library folders", onclick: refreshLibrary })),
        el("div", { class: "row" }, el("span", { class: "hint", text: "Your own files go in:" }),
          ...[["sfx", "Sounds"], ["music", "Music"], ["stickers", "Pictures"]].map(([k, t]) => el("button", { text: "📁 " + t + " folder", onclick: () => studio.openFolder(k).catch((e) => toast(e.message, true)) }))),
        el("div", { class: "hint", text: "▶ listens, + adds it at the playhead. Drag it on the Effects track; drag across the empty track to add the last one you used there." }),
        ...libList),
      ...placed,
    ];
  }
  function refreshLibrary() {
    studio.library().then((lib) => { window.LIBRARY = lib; renderPane(); syncLanes(); toast("Library refreshed"); }).catch((e) => toast("Library: " + e.message, true));
  }

  // ---------- Join: other Shorts after this one ----------
  function joinSection() {
    const others = (window.SHORTS || []).filter((s) => s.id !== ID && s.work && s.kind !== "week" && s.file && (s.status === "ready" || s.status === "uploaded"));
    const byId = new Map(others.map((s) => [s.id, s])), j = E.join;
    const add = el("select", {}, el("option", { value: "", text: "+ Add a Short after this one..." }), others.filter((s) => !j.ids.includes(s.id)).map((s) => el("option", { value: s.id, text: `${s.title} (${Math.round(s.seconds || 0)} s)` })));
    add.addEventListener("change", () => { if (add.value) change((E) => { E.join.ids.push(add.value); }); });
    const move = (i, d) => change((E) => { const a = E.join.ids; const [x] = a.splice(i, 1); a.splice(clamp(i + d, 0, a.length), 0, x); });
    const extra = j.ids.reduce((s, id) => s + ((byId.get(id) || {}).seconds || 0), 0);
    return el("div", { class: "sec" }, el("h3", { text: "Join clips" }),
      el("div", { class: "hint", text: "Other Shorts play after this one, each with its own edits, like the weekly best-of but picked by you." }),
      j.ids.length ? el("div", { class: "list" }, j.ids.map((id, i) => el("div", { class: "row" }, el("span", { class: "grow", text: `${i + 2}. ${(byId.get(id) || { title: "(gone)" }).title}` }),
        el("button", { text: "↑", disabled: i === 0, onclick: () => move(i, -1) }), el("button", { text: "↓", disabled: i === j.ids.length - 1, onclick: () => move(i, 1) }),
        el("button", { text: "✕", onclick: () => change((E) => { E.join.ids.splice(i, 1); }) })))) : null,
      add,
      j.ids.length ? [check("Case-file slam between the clips", j.slam !== false, (v) => change((E) => { E.join.slam = v; })),
        check("One title card over the whole thing (this one's)", j.oneTitle !== false, (v) => change((E) => { E.join.oneTitle = v; })),
        el("div", { class: "hint", text: `Adds about ${extra.toFixed(0)} s. The preview only plays this clip; ▶ Watch result after saving shows it all.` })] : null);
  }

  // ---------- the bar ----------
  function setStatus(kind, text) { status = { kind, text }; renderHead(); }
  function renderHead() {
    if (!E) return;
    const dirty = JSON.stringify(E) !== saved, st = $("#status");
    if (busy) { st.className = "busy"; st.textContent = status.text; }
    else if (dirty) { st.className = "dirty"; st.textContent = "Unsaved changes"; }
    else { st.className = status.kind; st.textContent = status.text; }
    $("#undo").disabled = !hist.length; $("#redo").disabled = !fut.length; $("#revert").disabled = !dirty && !hist.length;
    $("#save").disabled = busy;
    $("#watch").hidden = !(X && X.file) || busy;
    const m = mm(), out = $("#outlen");
    // with the joined clips (their own lengths as they are now)
    const joined = E.join.ids.reduce((s, id) => s + (((window.SHORTS || []).find((x) => x.id === id) || {}).seconds || 0), 0), total = m.outDur + joined;
    out.textContent = `Short ${m.outDur.toFixed(1)} s${joined ? ` + ${E.join.ids.length} joined = ${total.toFixed(1)} s` : ""} (clip ${dur().toFixed(1)} s)`;
    out.classList.toggle("long", total > 60);
    out.title = total > 60 ? "Over a minute: fine for YouTube, but Shorts under a minute do better" : "";
  }
  function save() {
    if (busy || !E) return;
    const edits = toEdits();
    if (!edits.segs.length) return toast("Keep at least one part of the clip", true);
    busy = true; setStatus("busy", "Sending...");
    (DRY ? Promise.resolve() : studio.saveEdit(ID, edits)).then(() => {
      saved = JSON.stringify(E); dropDraft();
      if (DRY) { window.__saved = edits; busy = false; setStatus("ok", "Saved (test: nothing was rebuilt)"); return; }
      setStatus("busy", "Rebuilding...");
      watchBuild((x) => {
        busy = false;
        if (x.status === "failed") { setStatus("bad", "Rebuild failed: " + (x.error || "")); toast("Rebuild failed: " + (x.error || ""), true); }
        else { setStatus("ok", `Rebuilt ✓ ${x.seconds != null ? x.seconds + " s" : ""}`); toast("Rebuilt. Press ▶ Watch result to see it."); }
      }, (s) => setStatus("busy", s));
    }).catch((e) => { busy = false; setStatus("bad", "Not saved: " + e.message); toast("Save: " + e.message, true); });
  }
  function watchResult() {
    if (!X || !X.file) return;
    $("#video").pause();
    const v = $("#result"); v.src = fileSrc(X.file) + "?t=" + Date.now(); $("#modal").hidden = false; v.play().catch(() => {});
  }

  // ---------- playback ----------
  // "Play like the Short": cuts jumped, slow parts slowed, freezes held, sound effects / music / bleeps heard
  const playing = () => !$("#video").paused || !!frozen;
  const likeShort = () => $("#skipcuts").checked;
  const baseRate = () => +$("#rate").value || 1;
  let passed = new Set(), lastS = null, musicEl = null, beep = null;
  function togglePlay() {
    const v = $("#video");
    if (frozen) { frozen = null; stopSounds(); return; }
    if (v.paused) {
      if (likeShort()) { const segs = mm().segs, t = v.currentTime; if (!segs.some(([a, b]) => t >= a && t < b - 0.05)) { const next = segs.find(([a]) => a > t); v.currentTime = next ? next[0] : segs.length ? segs[0][0] : 0; } }
      passed = new Set(mm().pieces.filter((p) => p.kind === "freeze" && p.t < v.currentTime - 0.03).map((p) => p.t));
      lastS = null; ensureAudio();
      v.play().catch(() => {});
    } else { v.pause(); stopSounds(); stopAt = null; }
  }
  function stopSounds() { if (musicEl) musicEl.pause(); beepOn(false); $("#video").muted = false; }
  // the bleep tone (Web Audio: the page makes it, no file needed)
  let actx = null;
  function ensureAudio() { try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) { /* no audio */ } }
  function beepOn(on) {
    if (on && !beep && actx) { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 1000; g.gain.value = 0.18; o.connect(g).connect(actx.destination); o.start(); beep = o; }
    else if (!on && beep) { try { beep.stop(); } catch (e) { /* stopped */ } beep = null; }
  }
  function playSounds(sNow) {
    const m = mm(), v = $("#video");
    // sound effects crossed since the last frame (not after a jump)
    if (lastS != null && sNow > lastS && sNow - lastS < 0.5) for (const x of m.sfx) if (x.at > lastS && x.at <= sNow) { const a = new Audio(fileSrc(x.x.file)); a.volume = previewGain(x.x.file, -18, x.x.vol); a.playbackRate = 1; a.play().catch(() => {}); }
    lastS = sNow;
    // music: in step with the Short, quieter while a word is being said
    if (m.music && E.music) {
      if (!musicEl || musicEl.dataset.file !== E.music.file) { if (musicEl) musicEl.pause(); musicEl = new Audio(fileSrc(E.music.file)); musicEl.loop = true; musicEl.dataset.file = E.music.file; }
      if (sNow >= m.music.s && sNow < m.music.e) {
        const len = musicEl.duration || 90, want = ((E.music.offset || 0) + sNow - m.music.s) % len;
        if (musicEl.paused) { musicEl.currentTime = want; musicEl.play().catch(() => {}); } else if (Math.abs(musicEl.currentTime - want) > 0.35) musicEl.currentTime = want;
        const talking = E.music.duck !== false && m.spans.some((x) => sNow >= x.s && sNow < x.e);
        musicEl.volume = previewGain(E.music.file, -24, E.music.vol) * (talking ? 0.4 : 1);
      } else if (!musicEl.paused) musicEl.pause();
    } else if (musicEl && !musicEl.paused) musicEl.pause();
    // bleeps: the clip goes quiet and the tone plays
    const bleeping = m.bleeps.some((b) => sNow >= b.s && sNow < b.e);
    v.muted = bleeping; beepOn(bleeping);
  }
  let lastRow = -1;
  function loop() {
    requestAnimationFrame(loop);
    if (!E) return;
    const v = $("#video"), t = v.currentTime, m = mm();
    if (likeShort() && frozen && (performance.now() - frozen.started) / 1000 * frozen.rate >= frozen.d) {
      // the freeze is over: on with the clip
      passed.add(frozen.t); frozen = null; v.play().catch(() => {});
    }
    if (!v.paused && likeShort()) {
      // jump over the cut parts, like the finished Short
      const segs = m.segs;
      if (segs.length && !segs.some(([a, b]) => t >= a - 0.02 && t < b)) { const next = segs.find(([a]) => a > t); if (next) v.currentTime = next[0]; else { v.pause(); stopSounds(); } }
      // a freeze coming up: hold the picture there
      const fz = m.pieces.find((p) => p.kind === "freeze" && !passed.has(p.t) && t >= p.t - 0.01 && t < p.t + 0.25);
      if (fz) { v.pause(); v.currentTime = fz.t; frozen = { at: fz.at, d: fz.d, t: fz.t, started: performance.now(), rate: baseRate() }; }
      // slow parts slower
      const piece = m.pieces.find((p) => p.kind === "play" && t >= p.a && t < p.b);
      const rate = baseRate() * (piece ? piece.speed : 1);
      if (Math.abs(v.playbackRate - rate) > 0.001) v.playbackRate = rate;
    } else if (!likeShort() && v.playbackRate !== baseRate()) v.playbackRate = baseRate();
    if (stopAt != null && !v.paused && t >= stopAt - 0.02 && t < stopAt + 1) { v.pause(); stopSounds(); stopAt = null; }
    $("#play").textContent = playing() ? "❚❚" : "▶";
    $("#tc").textContent = `${fmt(t)} / ${fmt(dur())}`;
    if (playing() || needDraw) { draw(); needDraw = false; }
    drawOverlay();
    if (playing() && likeShort()) playSounds(shortNow()); else if (!playing()) { stopSounds(); lastS = null; }
    // follow the spoken word in the words list
    if (tab === "captions") {
      const i = E.words.findIndex((w) => t >= w.s && t < w.e);
      if (i !== lastRow) {
        lastRow = i;
        for (const r of document.querySelectorAll("#ipane .wrow.now:not(.sel-row)")) r.classList.remove("now");
        const row = i >= 0 && document.querySelector(`#ipane .wrow[data-i="${i}"]`);
        if (row) { row.classList.add("now"); if (!v.paused) row.scrollIntoView({ block: "nearest" }); }
      }
    }
  }

  // ---------- wiring ----------
  function wireStatic() {
    $("#close").addEventListener("click", () => {
      if (E && JSON.stringify(E) !== saved && !confirm("Close without saving your changes?")) return;
      saved = E ? JSON.stringify(E) : saved; dropDraft();
      window.close();
    });
    $("#undo").addEventListener("click", undo);
    $("#redo").addEventListener("click", redo);
    $("#revert").addEventListener("click", () => { if (!E) return; if (!confirm("Throw away the changes since you opened the editor?")) return; change((e) => Object.assign(e, fromD()), { track: false }); });   // exactly what was saved, cut list included
    $("#save").addEventListener("click", save);
    $("#watch").addEventListener("click", watchResult);
    $("#modal-close").addEventListener("click", () => { $("#result").pause(); $("#modal").hidden = true; });
    $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") { $("#result").pause(); $("#modal").hidden = true; } });
    $("#play").addEventListener("click", togglePlay);
    $("#back5").addEventListener("click", () => seekTo(now() - 1));
    $("#fwd5").addEventListener("click", () => seekTo(now() + 1));
    $("#rate").addEventListener("change", () => ($("#video").playbackRate = +$("#rate").value));
    $("#video").addEventListener("seeking", () => { if (!frozen) { lastS = null; const t = $("#video").currentTime; passed = new Set(mm().pieces.filter((p) => p.kind === "freeze" && p.t < t - 0.03).map((p) => p.t)); } });
    $("#tb-zoom").addEventListener("click", () => addZoom());
    $("#tb-freeze").addEventListener("click", addFreeze);
    $("#tb-slow").addEventListener("click", addSlow);
    $("#tb-bleep").addEventListener("click", bleepAtPlayhead);
    $("#zones").addEventListener("change", () => E && frameSrc());
    for (const b of document.querySelectorAll("#itabs button")) b.addEventListener("click", () => setTab(b.dataset.t));
    for (const b of document.querySelectorAll("#dragmode button")) b.addEventListener("click", () => {
      dragMode = b.dataset.m;
      for (const x of document.querySelectorAll("#dragmode button")) x.classList.toggle("on", x === b);
      if (R.keep) dragSelection();
    });
    $("#split").addEventListener("click", splitAtPlayhead);
    $("#del").addEventListener("click", () => (sel ? deleteSelected() : toast("Click something on the timeline first")));
    $("#autotrim").addEventListener("click", () => change((E) => { E.segs = clone(D.autoSegs); }));
    $("#keepall").addEventListener("click", () => change((E) => { E.segs = [[0, dur()]]; }));
    $("#zoom").addEventListener("input", () => { if (ws && fitZoom) ws.zoom(fitZoom * Math.pow(40, +$("#zoom").value / 100)); });
    document.addEventListener("keydown", (e) => {
      if (!E) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (typing(e.target)) return;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seekTo(now() - (e.shiftKey ? 1 : 0.1)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seekTo(now() + (e.shiftKey ? 1 : 0.1)); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (wsel && tab === "cuts") cutWords(false); else deleteSelected(); }
      else if (e.key.toLowerCase() === "i" && !mod) { e.preventDefault(); setMark("in"); }
      else if (e.key.toLowerCase() === "o" && !mod) { e.preventDefault(); setMark("out"); }
      else if (e.key.toLowerCase() === "x" && !mod) { e.preventDefault(); cutMarked(false); }
      else if (e.key === "Enter" && e.target.tagName !== "BUTTON" && markRange().a != null) { e.preventDefault(); cutMarked(true); }
      else if (e.key.toLowerCase() === "s" && !mod) { e.preventDefault(); splitAtPlayhead(); }
      else if (e.key.toLowerCase() === "z" && !mod) { e.preventDefault(); addZoom(); }
      else if (e.key.toLowerCase() === "f" && !mod) { e.preventDefault(); addFreeze(); }
      else if (e.key.toLowerCase() === "b" && !mod) { e.preventDefault(); bleepAtPlayhead(); }
      else if (e.key === "Escape") { sel = null; wsel = null; clearMarks(); markSelected(); overlayKey = ""; renderPane(); }
    });
    window.addEventListener("beforeunload", (e) => { if (E && JSON.stringify(E) !== saved) { e.preventDefault(); e.returnValue = ""; } });
    // Alt held while dragging = no snapping; a word drag ends wherever the mouse is let go
    for (const ev of ["pointerdown", "pointermove", "pointerup"]) window.addEventListener(ev, (e) => { altHeld = e.altKey; if (ev === "pointerup" && wdrag) { wdrag = false; if (tab === "cuts") renderPane(); } }, true);
    $("#mark-in").addEventListener("click", () => setMark("in"));
    $("#mark-out").addEventListener("click", () => setMark("out"));
    $("#mark-cut").addEventListener("click", () => cutMarked(false));
    $("#mark-keep").addEventListener("click", () => cutMarked(true));
  }

  window.__editor = { get E() { return E; }, get D() { return D; }, toEdits: () => toEdits(), mm: () => mm(), change, setTab, setLayout,
    snap: (t) => snap(t), cutList: () => cutList(), get mark() { return mark; }, get wsel() { return wsel; } };   // for the self-test
  start();
})();
