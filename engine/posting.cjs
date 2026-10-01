"use strict";
// Posting a Short in the background: the progress and the result live on the Short (posting / posts), so every window
// sees them. TikTok posts scheduled for later are sent from here while Shorts Studio is open; one that came due while it
// was closed goes out when it opens again (and says how late). YouTube schedules itself (publishAt).
const S = require("./store.cjs");
const PUB = require("./publish.cjs");
const { log } = require("./run.cjs");

const running = new Set();   // "id:platform"
const PLATFORMS = ["youtube", "tiktok"];

function setPosting(id, platform, patch) {
  const s = S.get(id); if (!s) return;
  const posting = { ...(s.posting || {}) };
  if (patch) posting[platform] = { ...(posting[platform] || {}), ...patch }; else delete posting[platform];
  S.update(id, { posting });
}
function setResult(id, platform, result) {
  const s = S.get(id); if (!s) return;
  S.update(id, { posts: { ...(s.posts || {}), [platform]: result } });
}

// Starts an upload and returns at once; the Short shows how it goes.
function start(id, platform, opts) {
  if (!PLATFORMS.includes(platform)) throw new Error("Unknown platform");
  const key = id + ":" + platform;
  if (running.has(key)) throw new Error("It's already uploading.");
  const s = S.get(id);
  if (!s || !s.file || s.status !== "ready") throw new Error("This Short isn't ready yet.");
  running.add(key);
  setPosting(id, platform, { progress: 0, step: "Starting", error: null });
  let last = 0;
  const progress = (f, step) => { const now = Date.now(); if (f > 0 && f < 1 && now - last < 400) return; last = now; setPosting(id, platform, { progress: f, step, error: null }); };
  (async () => {
    try {
      const result = platform === "youtube" ? await PUB.youtubeUpload(s.file, opts, progress) : await PUB.tiktokSend(s.file, opts, progress);
      setResult(id, platform, { ...result, ...(opts.late ? { late: opts.late } : {}) });
      setPosting(id, platform, null);
      log("posting", id, platform, JSON.stringify(result));
    } catch (e) {
      log("posting", id, platform, "failed:", e.message);
      setPosting(id, platform, { progress: null, step: "", error: e.message });
    } finally { running.delete(key); }
  })();
  return true;
}

// ---------- TikTok at a set time ----------
function schedule(id, at, opts) {
  const when = new Date(at).getTime();
  if (!Number.isFinite(when) || when < Date.now() + 30000) throw new Error("Pick a time in the future.");
  const s = S.get(id); if (!s || !s.file) throw new Error("This Short isn't ready yet.");
  S.update(id, { tiktokPlan: { at: new Date(when).toISOString(), opts } });
  return true;
}
function unschedule(id) { S.update(id, { tiktokPlan: null }); return true; }
function tick() {
  for (const s of S.list()) {
    const plan = s.tiktokPlan;
    if (!plan || running.has(s.id + ":tiktok")) continue;
    const due = Date.parse(plan.at);
    if (!(due <= Date.now())) continue;
    const lateMin = Math.round((Date.now() - due) / 60000);
    S.update(s.id, { tiktokPlan: null });
    try { start(s.id, "tiktok", { ...plan.opts, ...(lateMin >= 2 ? { late: lateMin } : {}) }); }
    catch (e) { setPosting(s.id, "tiktok", { progress: null, step: "", error: "The scheduled post didn't go out: " + e.message }); }
  }
}
let timer = null;
function startScheduler() {
  // an upload that was running when Shorts Studio closed won't finish by itself
  for (const s of S.list()) for (const p of Object.keys(s.posting || {})) if (s.posting[p] && s.posting[p].error == null)
    setPosting(s.id, p, { progress: null, step: "", error: "Shorts Studio closed during the upload. Try again." });
  if (!timer) { timer = setInterval(tick, 20000); setTimeout(tick, 5000); }
}

module.exports = { start, schedule, unschedule, startScheduler, tick };
