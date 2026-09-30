"use strict";
// Shorts Studio's main window: your clips (from Twitch) on the left, your Shorts on the right, first-run setup,
// settings and the upload helper. Everything goes through window.studio (preload.cjs).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : String(c));
    return n;
  }
  let toastT = 0;
  function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = "show" + (bad ? " bad" : ""); clearTimeout(toastT); toastT = setTimeout(() => (t.className = ""), 3500); }
  const tryIt = (p, what) => p.catch((e) => { toast((what ? what + ": " : "") + e.message, true); throw e; });
  const mmss = (s) => { s = Math.round(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const ago = (iso) => { const d = (Date.now() - Date.parse(iso)) / 1000; return d < 3600 ? Math.max(1, Math.round(d / 60)) + " min ago" : d < 86400 ? Math.round(d / 3600) + " h ago" : Math.round(d / 86400) + " days ago"; };
  const S = window.studio;
  let settings = null, themes = [], clips = [], shorts = [], presets = [], range = "week";
  const picked = new Set();
  function renderPresets() {
    const select = $("#batch-preset");
    select.replaceChildren(el("option", { value: "", text: "Use Settings" }), ...presets.map((p) => el("option", { value: p.id, text: p.name })));
    select.value = presets.some((p) => p.id === settings.presetId) ? settings.presetId : "";
    $("#preset-hint").textContent = presets.length ? "Applies to selected clips, pasted links, and Best of the week." : "Save a look in Edit → Look → Presets.";
  }

  function applyAccent() {
    const th = themes.find((t) => t.id === settings.theme) || themes[0];
    document.documentElement.style.setProperty("--accent", settings.accent || (th && th.accent) || "#ef443b");
    $("#channel-chip").textContent = settings.channel ? "twitch.tv/" + settings.channel : "Set your channel";
  }

  // ---------- clips ----------
  async function loadClips() {
    const box = $("#clips");
    if (!settings.channel) { box.replaceChildren(el("div", { class: "empty", text: "Set your Twitch channel in Settings to see your clips." })); return; }
    box.replaceChildren(el("div", { class: "empty", text: "Asking Twitch..." }));
    try { clips = await S.clips(settings.channel, range); } catch (e) { box.replaceChildren(el("div", { class: "empty", text: e.message })); return; }
    renderClips();
  }
  function renderClips() {
    const made = new Set(shorts.map((s) => s.slug));
    $("#clips").replaceChildren(...(clips.length ? clips.map((c) => {
      const card = el("div", { class: "clip" + (picked.has(c.slug) ? " on" : ""), title: c.title },
        el("div", { class: "th", style: c.thumb ? `background-image:url("${c.thumb}")` : "" }, el("span", { class: "dur", text: mmss(c.duration) }),
          made.has(c.slug) ? el("span", { class: "done", text: "SHORT MADE" }) : null, el("span", { class: "tick" })),
        el("div", { class: "body" }, el("div", { class: "t", text: c.title }), el("div", { class: "m", text: [c.by && "clipped by " + c.by, c.views + " views", ago(c.createdAt)].filter(Boolean).join(" · ") })));
      card.addEventListener("click", () => { picked.has(c.slug) ? picked.delete(c.slug) : picked.add(c.slug); renderClips(); });
      return card;
    }) : [el("div", { class: "empty", text: `No clips ${({ day: "today", week: "this week", month: "this month", all: "yet" })[range]}. Ask chat to clip the good bits!` })]));
    const n = picked.size;
    $("#make-selected").disabled = !n;
    $("#make-selected").textContent = n ? `Make ${n} Short${n > 1 ? "s" : ""}` : "Pick clips to make Shorts";
  }
  async function make(links) {
    const ids = await tryIt(S.make(links, $("#batch-preset").value), "Make");
    toast(`Making ${ids.length} Short${ids.length > 1 ? "s" : ""}. They appear on the right as they're done.`);
    picked.clear(); renderClips();
  }

  // ---------- your Shorts ----------
  function renderShorts() {
    const busy = shorts.filter((s) => s.status === "making" || s.status === "queued").length;
    $("#busy").hidden = !busy; $("#busy").textContent = busy ? `Making ${busy}...` : "";
    $("#shorts-count").textContent = shorts.length ? `${shorts.length} Short${shorts.length > 1 ? "s" : ""}` : "";
    $("#shorts").replaceChildren(...(shorts.length ? shorts.map(shortCard) : [el("div", { class: "empty", text: "Your Shorts show up here. Pick clips on the left and press Make Shorts." })]));
  }
  function shortCard(s) {
    const working = s.status === "making" || s.status === "queued", ready = s.status === "ready" && s.file;
    const status = s.status === "making" ? (s.step || "Making") + "..." : s.status === "queued" ? "Waiting..." : s.status === "ready" ? "Ready" : "Failed";
    const bust = s.updatedAt ? "?t=" + Date.parse(s.updatedAt) : "";
    return el("div", { class: "short" },
      el("div", { class: "th", style: s.thumb && !working ? `background-image:url("${S.fileUrl(s.thumb)}${bust}")` : "", title: ready ? "Play" : "", onclick: () => ready && play(s) },
        working ? el("div", { class: "spin", text: "◠" }) : null),
      el("div", { class: "body" },
        el("div", { class: "t", text: s.title || "Clip" }),
        el("div", { class: "m", text: [s.by && "clipped by " + s.by, s.seconds && Math.round(s.seconds) + " s", s.kind === "week" && s.clips && s.clips + " clips", s.chatNotes && s.chatNotes + " chat notes"].filter(Boolean).join(" · ") }),
        el("div", { class: "st " + s.status, text: status }),
        s.status === "failed" && s.error ? el("div", { class: "err", text: s.error }) : null,
        el("div", { class: "acts" },
          ready ? el("button", { text: "▶ Play", onclick: () => play(s) }) : null,
          ready && s.kind !== "week" ? el("button", { class: "primary", text: "✎ Edit", onclick: () => S.openEditor(s.id) }) : null,
          ready ? el("button", { text: "⬆ Upload", onclick: () => upload(s) }) : null,
          s.file && !working ? el("button", { text: "📂", title: "Show the file", onclick: () => S.reveal(s.file) }) : null,
          !working ? el("button", { text: s.status === "failed" ? "↻ Try again" : "↻ Remake", title: "Download the clip again and make it from scratch (your edits are forgotten)", onclick: () => S.remake(s.id).then(() => toast("Making it again")) }) : null,
          !working ? el("button", { class: "ghost", text: "🗑", title: "Delete (to the Recycle Bin)", onclick: () => { if (confirm(`Delete "${s.title}"? The files go to the Recycle Bin.`)) S.remove(s.id); } }) : null)));
  }
  function play(s) { const v = $("#player-video"); v.src = S.fileUrl(s.file) + "?t=" + Date.now(); $("#player").hidden = false; v.play().catch(() => {}); }

  // ---------- the upload helper: copy the words, show the file, open the upload page ----------
  function upload(s) {
    const tags = settings.hashtags || "";
    const tiktok = s.tiktokCaption || `${s.uploadTitle || s.title} ${tags}`.trim();
    const box = (label, value, rows) => { const t = el("textarea", { rows: String(rows) }); t.value = value; return el("div", { class: "copybox" }, el("div", { class: "row" }, el("h3", { text: label }), el("span", { class: "grow" }), el("button", { text: "Copy", onclick: () => S.copy(t.value).then(() => toast("Copied")) })), t); };
    $("#up-title").textContent = "Upload: " + (s.uploadTitle || s.title);
    $("#upload-body").replaceChildren(
      el("p", { class: "hint", text: "Copy the words, open the upload page, and drag the video in (Show the file opens its folder). The editor's Post tab changes these words." }),
      el("div", { class: "row" }, el("button", { text: "📂 Show the file", onclick: () => S.reveal(s.file) }), el("span", { class: "grow" })),
      el("h3", { text: "YouTube Shorts" }),
      box("Title", s.uploadTitle || s.title || "", 2), box("Description", s.description || "", 5),
      el("div", { class: "row" }, el("button", { class: "primary", text: "Open YouTube upload", onclick: () => S.openUpload("youtube") })),
      el("h3", { text: "TikTok" }),
      box("Caption", tiktok, 3),
      el("div", { class: "row" }, el("button", { class: "primary", text: "Open TikTok upload", onclick: () => S.openUpload("tiktok") })));
    $("#upload").hidden = false;
  }

  // ---------- themes (little live previews of each frame) ----------
  function themeCards(host, current, onPick) {
    host.replaceChildren(...themes.map((t) => {
      const q = encodeURIComponent(JSON.stringify({ demo: "1", accent: t.id === current && settings.accent ? settings.accent : t.accent, kicker: t.series || "", stamp: t.stamp || "", chan: settings.channel ? "twitch.tv/" + settings.channel : "twitch.tv/yourchannel" }));
      const pv = el("div", { class: "pv" }, el("iframe", { src: S.fileUrl(t.frame) + "?d=" + q, tabindex: "-1" }));
      const card = el("button", { class: "theme" + (t.id === current ? " on" : ""), onclick: () => onPick(t.id) }, pv, el("b", { text: t.name }), el("span", { class: "hint", text: t.description }));
      requestAnimationFrame(() => { const f = pv.querySelector("iframe"); f.style.transform = `scale(${pv.clientWidth / 1080})`; });
      return card;
    }));
  }

  // ---------- first run ----------
  async function welcome() {
    $("#welcome").hidden = false;
    let theme = settings.theme;
    const draw = () => themeCards($("#w-themes"), theme, (id) => { theme = id; draw(); });
    draw();
    const modelState = async () => { const m = await S.model(); $("#w-model-state").textContent = m.has ? "Downloaded ✓" : "Downloads when you press Start"; };
    $("#w-model").value = settings.model; modelState();
    $("#w-model").addEventListener("change", async () => { await S.saveSettings({ model: $("#w-model").value }); modelState(); });
    $("#w-start").addEventListener("click", async () => {
      const channel = $("#w-channel").value.trim().replace(/^.*twitch\.tv\//i, "").replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
      if (!channel) { toast("Type your Twitch channel name", true); return; }
      $("#w-start").disabled = true;
      settings = await S.saveSettings({ channel, theme, model: $("#w-model").value, firstRun: false });
      const m = await S.model();
      if (!m.has) {
        $("#w-start").textContent = "Getting the speech model...";
        const bar = $("#welcome .progress"); bar.hidden = false;
        const off = S.onModel((d) => { if (d.progress != null) bar.firstChild.style.width = Math.round(d.progress * 100) + "%"; });
        try { await S.downloadModel(settings.model); } catch (e) { toast("The speech model didn't download: " + e.message + ". It will try again with your first Short.", true); }
        off();
      }
      $("#welcome").hidden = true; applyAccent(); loadClips();
      S.emotes().catch(() => {});   // your emotes as stickers, quietly
    });
  }

  // ---------- settings ----------
  async function openSettings() {
    const s = settings = await S.settings(), obs = await S.obs(), m = await S.model();
    const save = (patch) => S.saveSettings(patch).then((x) => { settings = x; applyAccent(); });
    const text = (label, key, placeholder, hint) => { const i = el("input", { value: s[key] || "", placeholder: placeholder || "" }); i.addEventListener("change", () => save({ [key]: i.value.trim() })); return el("label", { class: "field" }, label, i, hint ? el("span", { class: "hint", text: hint }) : null); };
    const check = (label, key) => { const c = el("input", { type: "checkbox" }); c.checked = s[key] !== false; c.addEventListener("change", () => save({ [key]: c.checked })); return el("label", { class: "check" }, c, label); };
    const layout = el("select", {}, [["letterbox", "Whole picture"], ["split", "Camera + game"], ["stage", "Stage (4:3, big)"], ["center", "You, centred (fills the screen)"]].map(([v, t]) => el("option", { value: v, text: t, selected: s.layout === v })));
    layout.addEventListener("change", () => save({ layout: layout.value }));
    const accent = el("input", { type: "color", value: s.accent || (themes.find((t) => t.id === s.theme) || {}).accent || "#ef443b" });
    accent.addEventListener("input", () => save({ accent: accent.value }));
    const model = el("select", {}, el("option", { value: "base", text: "Standard, 148 MB", selected: s.model === "base" }), el("option", { value: "small", text: "Best, 466 MB (slower)", selected: s.model === "small" }));
    const modelState = el("span", { class: "hint", text: m.has ? "Downloaded ✓" : "Not downloaded yet" });
    model.addEventListener("change", async () => { await save({ model: model.value }); const x = await S.model(); modelState.textContent = x.has ? "Downloaded ✓" : "Downloads with your next Short"; });
    const lang = el("select", {}, [["auto", "Detect it"], ["en", "English"], ["ka", "Georgian"], ["es", "Spanish"], ["pt", "Portuguese"], ["de", "German"], ["fr", "French"], ["it", "Italian"], ["ru", "Russian"], ["uk", "Ukrainian"], ["pl", "Polish"], ["tr", "Turkish"], ["nl", "Dutch"], ["sv", "Swedish"], ["ja", "Japanese"], ["ko", "Korean"]]
      .map(([v, t]) => el("option", { value: v, text: t, selected: s.language === v })));
    lang.addEventListener("change", () => save({ language: lang.value }));
    const obsOn = el("input", { type: "checkbox" }); obsOn.checked = !!s.obs.enabled;
    const obsMap = el("div", { class: "obsmap" }, obs.scenes.length ? obs.scenes.flatMap((sc) => {
      const sel = el("select", {}, el("option", { value: "", text: "(your default layout)" }), [["letterbox", "Whole picture"], ["split", "Camera + game"], ["stage", "Stage"], ["center", "You, centred"]].map(([v, t]) => el("option", { value: v, text: t, selected: s.obs.map[sc] === v })));
      sel.addEventListener("change", () => { const map = { ...settings.obs.map }; if (sel.value) map[sc] = sel.value; else delete map[sc]; save({ obs: { ...settings.obs, map } }); });
      return [el("span", { text: sc }), sel];
    }) : [el("span", { class: "hint", text: "No OBS scenes found in OBS's logs on this PC." })]);
    obsOn.addEventListener("change", () => save({ obs: { ...settings.obs, enabled: obsOn.checked } }));
    const outDir = el("span", { class: "hint", text: s.outDir || "Videos\\Shorts Studio" });
    const drawThemes = () => themeCards(themesBox, settings.theme, (id) => save({ theme: id, accent: "" }).then(() => { accent.value = (themes.find((t) => t.id === id) || {}).accent || "#ef443b"; drawThemes(); }));
    const themesBox = el("div", { class: "themes" });
    $("#settings-body").replaceChildren(
      el("div", { class: "sec full" }, el("h3", { text: "Look" }), themesBox,
        el("div", { class: "row" }, el("span", { class: "hint", text: "Colour" }), accent, el("button", { class: "ghost", text: "Theme's colour", onclick: () => save({ accent: "" }).then(() => { accent.value = (themes.find((t) => t.id === settings.theme) || {}).accent; drawThemes(); }) }))),
      el("div", { class: "sec" }, el("h3", { text: "Your channel" }),
        text("Twitch channel", "channel", "yourchannel"),
        text("Channel line on the Short", "handle", "twitch.tv/" + (s.channel || "yourchannel"), "Empty = twitch.tv/<your channel>"),
        text("Small line over the title", "series", "", "Your show's name, for example. Empty = the theme's."),
        text("Stamp", "stamp", "", "Empty = the theme's (Case File: EVIDENCE)"),
        text("Hashtags", "hashtags", "#shorts #twitch")),
      el("div", { class: "sec" }, el("h3", { text: "New Shorts" }),
        el("label", { class: "field" }, "Layout", layout, el("span", { class: "hint", text: "In the editor you can change it per Short, and save your crops as the default for each layout." })),
        check("Captions", "captions"), check("Chat as notes on the Short", "chat"),
        el("h3", { text: "Captions" }),
        el("label", { class: "field" }, "Speech model", model, modelState), el("label", { class: "field" }, "Language you stream in", lang)),
      el("div", { class: "sec" }, el("h3", { text: "OBS scenes (optional)" }),
        el("label", { class: "check" }, obsOn, "Pick the layout from the OBS scene that was live"),
        el("span", { class: "hint", text: "Only when OBS runs on this PC: it reads OBS's own log files." }), obsMap),
      el("div", { class: "sec" }, el("h3", { text: "Library and files" }),
        el("div", { class: "row" }, el("button", { text: "Sound effects folder", onclick: () => S.openFolder("sfx") }), el("button", { text: "Music folder", onclick: () => S.openFolder("music") }), el("button", { text: "Pictures folder", onclick: () => S.openFolder("stickers") })),
        el("span", { class: "hint", text: "Drop your own sounds, royalty-free music or pictures in there; the editor's library shows them." }),
        el("div", { class: "row" }, el("button", { text: "Get my channel's emotes", onclick: () => tryIt(S.emotes(), "Emotes").then((r) => toast(`${r.found} emotes, ${r.added} new`)) })),
        el("div", { class: "row" }, el("span", { class: "hint", text: "Shorts are saved in" }), outDir),
        el("div", { class: "row" }, el("button", { text: "Change folder", onclick: async () => { const d = await S.chooseFolder(); if (d) { await save({ outDir: d }); outDir.textContent = d; } } }),
          el("button", { class: "ghost", text: "Open the log", onclick: () => S.openFolder("log") }))));
    drawThemes();
    $("#settings").hidden = false;
  }

  // ---------- wiring ----------
  async function start() {
    [settings, themes, shorts, presets] = await Promise.all([S.settings(), S.themes(), S.shorts(), S.presets()]);
    applyAccent(); renderShorts(); renderPresets();
    S.onPresets((items) => { presets = items; renderPresets(); });
    $("#batch-preset").addEventListener("change", () => S.saveSettings({ presetId: $("#batch-preset").value }).catch((e) => toast(e.message, true)));
    if (settings.firstRun || !settings.channel) welcome(); else loadClips();
    S.onShorts(async () => { shorts = await S.shorts(); renderShorts(); if (clips.length) renderClips(); });
    S.onSettings((s) => { const ch = s.channel !== settings.channel; settings = s; applyAccent(); renderPresets(); if (ch) loadClips(); });
    for (const b of document.querySelectorAll("#range button")) b.addEventListener("click", () => { range = b.dataset.r; for (const x of document.querySelectorAll("#range button")) x.classList.toggle("on", x === b); picked.clear(); loadClips(); });
    $("#reload").addEventListener("click", loadClips);
    $("#make-selected").addEventListener("click", () => make([...picked]).catch(() => {}));
    $("#make-links").addEventListener("click", () => { const l = $("#links").value.split(/\s+/).filter(Boolean); if (!l.length) return toast("Paste some clip links first", true); make(l).then(() => ($("#links").value = "")).catch(() => {}); });
    $("#best-of").addEventListener("click", () => { if (!settings.channel) return toast("Set your channel first", true); S.bestOf(settings.channel, $("#batch-preset").value).then(() => toast("Making this week's best-of")).catch((e) => toast(e.message, true)); });
    $("#open-settings").addEventListener("click", openSettings);
    $("#channel-chip").addEventListener("click", openSettings);
    $("#open-videos").addEventListener("click", () => S.openFolder("videos"));
    for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", () => { $("#" + b.dataset.close).hidden = true; if (b.dataset.close === "player") $("#player-video").pause(); });
    $("#player").addEventListener("click", (e) => { if (e.target.id === "player") { $("#player-video").pause(); $("#player").hidden = true; } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") for (const o of document.querySelectorAll(".overlay:not(#welcome)")) { o.hidden = true; $("#player-video").pause(); } });
  }
  start().catch((e) => toast("Couldn't start: " + e.message, true));
})();
