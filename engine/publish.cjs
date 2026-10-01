"use strict";
// Posting finished Shorts to YouTube and TikTok from Shorts Studio.
// - Sign-in: the browser opens the platform's consent page and the answer comes back to this PC on a local address
//   (YouTube: any free port on 127.0.0.1; TikTok: http://localhost:8765/callback/, the address its app allows).
// - The keys stay on this PC in accounts.json, encrypted with Windows' own encryption (Electron safeStorage).
// - YouTube: a resumable upload; "Schedule" uses YouTube's own publish time, so the PC can be off by then.
// - TikTok: "Send to drafts" (finish in the TikTok app) or a Direct Post with the choices TikTok asks for.
//   TikTok can't schedule a post itself, so a scheduled TikTok post goes out from here: Shorts Studio must be open.
// - TikTok's sign-in needs the app's secret, which can't ship inside a desktop app: that one step goes through a small
//   service on byttenapple.com (gartic-gallery src/app/api/shorts-studio/tiktok), which holds the secret.
// Shorts Studio's own Google and TikTok apps come from platforms.json; until they're filled in, Connect says so.
// Every address can be pointed elsewhere for the tests: SHORTS_STUDIO_PLATFORMS (JSON) and SHORTS_STUDIO_TEST_BROWSER.
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const P = require("./paths.cjs");
const { log } = require("./run.cjs");

const DEFAULTS = {
  youtube: {
    clientId: "", clientSecret: "", audited: false,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke", userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    uploadUrl: "https://www.googleapis.com/upload/youtube/v3/videos",
  },
  tiktok: {
    clientKey: "", audited: false, port: 8765,
    authUrl: "https://www.tiktok.com/v2/auth/authorize/", apiUrl: "https://open.tiktokapis.com/v2",
    broker: "https://byttenapple.com/api/shorts-studio/tiktok",
  },
};
const YT_SCOPES = "openid email https://www.googleapis.com/auth/youtube.upload";
const TT_SCOPES = "user.info.basic,video.upload,video.publish";

function config() {
  let file = {}, env = {};
  try { file = JSON.parse(fs.readFileSync(path.join(P.RES, "platforms.json"), "utf8")); } catch (e) { /* not set up */ }
  try { env = JSON.parse(process.env.SHORTS_STUDIO_PLATFORMS || "{}"); } catch (e) { /* ignore */ }
  return {
    youtube: { ...DEFAULTS.youtube, ...(file.youtube || {}), ...(env.youtube || {}) },
    tiktok: { ...DEFAULTS.tiktok, ...(file.tiktok || {}), ...(env.tiktok || {}) },
  };
}

// ---------- the keys, encrypted on disk ----------
const FILE = path.join(P.DATA, "accounts.json");
function safeStorage() { try { const s = require("electron").safeStorage; return s && s.isEncryptionAvailable() ? s : null; } catch (e) { return null; } }
function loadAccounts() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (raw.enc) { const ss = safeStorage(); return ss ? JSON.parse(ss.decryptString(Buffer.from(raw.enc, "base64"))) : {}; }
    return raw;
  } catch (e) { return {}; }
}
function saveAccounts(a) {
  fs.mkdirSync(P.DATA, { recursive: true });
  const ss = safeStorage(), text = JSON.stringify(a);
  fs.writeFileSync(FILE, ss ? JSON.stringify({ enc: ss.encryptString(text).toString("base64") }) : text);
}
function setAccount(name, data) { const a = loadAccounts(); if (data) a[name] = data; else delete a[name]; saveAccounts(a); }

// What the windows show: is each platform set up in this copy, connected, and as whom.
function status() {
  const c = config(), a = loadAccounts();
  const one = (k) => ({ configured: !!(k === "youtube" ? c.youtube.clientId : c.tiktok.clientKey), audited: !!c[k].audited, connected: !!(a[k] && a[k].refresh_token), name: a[k] ? a[k].name || "" : "" });
  return { youtube: one("youtube"), tiktok: one("tiktok") };
}

// ---------- sign-in: browser + local redirect ----------
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = () => b64url(crypto.randomBytes(48)).slice(0, 64);
function openBrowser(url) {
  if (process.env.SHORTS_STUDIO_TEST_BROWSER) { fetch(url).catch(() => {}); return; }   // tests: the stand-in consent page answers at once
  require("electron").shell.openExternal(url);
}
// Waits for one redirect on the loopback address (IPv4, and IPv6 too because "localhost" may resolve to ::1).
// Never listens on the network, so Windows doesn't ask about the firewall.
function catchRedirect(port, pathName, timeoutMs = 5 * 60000) {
  return new Promise((resolveReady, rejectReady) => {
    const servers = [];
    let done, ready = false, timer;
    const result = new Promise((res, rej) => { done = { res, rej }; });
    const finish = (err, q) => { clearTimeout(timer); for (const s of servers) try { s.close(); } catch (e) { /* closed */ } err ? done.rej(err) : done.res(q); };
    const handler = (req, res) => {
      const u = new URL(req.url, "http://localhost");
      if (pathName && !u.pathname.startsWith(pathName)) { res.writeHead(404); return res.end(); }
      const ok = !u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Shorts Studio</title><body style="font:18px 'Segoe UI',system-ui;background:#0d0e11;color:#ebe5d8;padding:48px">
        <h2 style="margin:0 0 8px">${ok ? "Connected" : "Not connected"}</h2><p>${ok ? "You can close this tab and go back to Shorts Studio." : "The sign-in was cancelled. Go back to Shorts Studio to try again."}</p></body>`);
      finish(null, u.searchParams);
    };
    const listen = (host) => new Promise((res) => {
      const s = http.createServer(handler);
      s.once("error", (e) => res({ error: e }));
      s.listen(port, host, () => { servers.push(s); res({ port: s.address().port }); });
    });
    (async () => {
      const v4 = await listen("127.0.0.1");
      if (v4.error) return rejectReady(v4.error.code === "EADDRINUSE" ? new Error(`Port ${port} is in use by another program, so the sign-in can't come back. Close it and try again.`) : v4.error);
      if (port) await listen("::1");   // fine if this PC has no IPv6
      timer = setTimeout(() => finish(new Error("The sign-in took too long. Try again.")), timeoutMs);
      ready = true;
      resolveReady({ port: v4.port, result, cancel: () => finish(new Error("Cancelled")) });
    })();
  });
}
let pending = null;   // one sign-in at a time
function cancelSignIn() { if (pending) pending.cancel(); }

async function form(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}
async function jsonPost(url, body, token) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

// ---------- YouTube ----------
async function connectYouTube() {
  const c = config().youtube;
  if (!c.clientId) throw new Error("YouTube posting isn't set up in this copy of Shorts Studio yet.");
  cancelSignIn();
  const srv = pending = await catchRedirect(0, "/");
  try {
    const redirect = `http://127.0.0.1:${srv.port}/`, v = verifier(), state = b64url(crypto.randomBytes(12));
    openBrowser(c.authUrl + "?" + new URLSearchParams({ client_id: c.clientId, redirect_uri: redirect, response_type: "code", scope: YT_SCOPES,
      code_challenge: b64url(crypto.createHash("sha256").update(v).digest()), code_challenge_method: "S256", state, access_type: "offline", prompt: "consent" }));
    const q = await srv.result;
    if (q.get("error")) throw new Error(q.get("error") === "access_denied" ? "You didn't allow it, so YouTube isn't connected." : "Google said: " + q.get("error"));
    if (q.get("state") !== state || !q.get("code")) throw new Error("The sign-in didn't come back right. Try again.");
    const t = await form(c.tokenUrl, { client_id: c.clientId, client_secret: c.clientSecret, code: q.get("code"), code_verifier: v, grant_type: "authorization_code", redirect_uri: redirect });
    if (!t.json.refresh_token) throw new Error("Google didn't hand out a key: " + (t.json.error_description || t.json.error || t.status));
    let name = "";
    try { const u = await (await fetch(c.userinfoUrl, { headers: { Authorization: "Bearer " + t.json.access_token } })).json(); name = u.email || u.name || ""; } catch (e) { /* the name is only for show */ }
    setAccount("youtube", { refresh_token: t.json.refresh_token, access_token: t.json.access_token, expires_at: Date.now() + (t.json.expires_in || 3600) * 1000, name, at: new Date().toISOString() });
    log("publish", "YouTube connected", name);
    return status().youtube;
  } finally { pending = null; }
}
async function youtubeToken() {
  const c = config().youtube, a = loadAccounts().youtube;
  if (!a || !a.refresh_token) throw new Error("Connect YouTube first.");
  if (a.access_token && a.expires_at > Date.now() + 60000) return a.access_token;
  const t = await form(c.tokenUrl, { client_id: c.clientId, client_secret: c.clientSecret, refresh_token: a.refresh_token, grant_type: "refresh_token" });
  if (!t.json.access_token) {
    if (t.json.error === "invalid_grant") { setAccount("youtube", null); throw new Error("YouTube's sign-in ran out. Connect YouTube again."); }
    throw new Error("YouTube sign-in failed: " + (t.json.error_description || t.json.error || t.status));
  }
  setAccount("youtube", { ...a, access_token: t.json.access_token, expires_at: Date.now() + (t.json.expires_in || 3600) * 1000 });
  return t.json.access_token;
}
// YouTube refuses < and > in titles and descriptions
const ytText = (s, max) => String(s || "").replace(/[<>]/g, "").slice(0, max);
// opts: { title, description, tags[], privacy: public|unlisted|private, publishAt (ISO, in the future), kids, synthetic }
async function youtubeUpload(file, opts, progress = () => {}) {
  const c = config().youtube;
  const token = await youtubeToken();
  const size = fs.statSync(file).size;
  const status = { privacyStatus: opts.publishAt ? "private" : opts.privacy || "public", selfDeclaredMadeForKids: !!opts.kids, containsSyntheticMedia: !!opts.synthetic };
  if (opts.publishAt) status.publishAt = new Date(opts.publishAt).toISOString();
  const meta = { snippet: { title: ytText(opts.title, 100) || "Short", description: ytText(opts.description, 5000), categoryId: "20", tags: (opts.tags || []).map((t) => String(t).replace(/^#/, "")).filter(Boolean).slice(0, 30) }, status };
  progress(0, "Starting the upload");
  const init = await fetch(c.uploadUrl + "?uploadType=resumable&part=snippet,status", { method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
    body: JSON.stringify(meta) });
  if (!init.ok) throw new Error(youtubeError(init.status, await init.text()));
  const where = init.headers.get("location");
  // 8 MB pieces (a multiple of 256 KB, as YouTube wants); a piece that fails is sent again
  const CHUNK = 8 * 1024 * 1024, fd = fs.openSync(file, "r");
  try {
    let sent = 0, tries = 0;
    while (true) {
      const end = Math.min(size, sent + CHUNK), buf = Buffer.alloc(end - sent);
      fs.readSync(fd, buf, 0, buf.length, sent);
      let r;
      try { r = await fetch(where, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(buf.length), "Content-Range": `bytes ${sent}-${end - 1}/${size}` }, body: buf }); }
      catch (e) { if (++tries > 4) throw new Error("The connection dropped during the upload. Try again."); await new Promise((s) => setTimeout(s, 2000 * tries)); sent = await youtubeResumeAt(where, size, sent); continue; }
      if (r.status === 308) { const range = r.headers.get("range"); sent = range ? +range.split("-")[1] + 1 : end; tries = 0; progress(sent / size, "Uploading to YouTube"); continue; }
      if (r.status >= 500 && ++tries <= 4) { await new Promise((s) => setTimeout(s, 2000 * tries)); sent = await youtubeResumeAt(where, size, sent); continue; }
      const v = await r.json().catch(() => ({}));
      if (!r.ok || !v.id) throw new Error(youtubeError(r.status, JSON.stringify(v)));
      progress(1, "Done");
      return { id: v.id, url: "https://youtube.com/shorts/" + v.id, privacy: v.status && v.status.privacyStatus, publishAt: status.publishAt || null, at: new Date().toISOString() };
    }
  } finally { fs.closeSync(fd); }
}
async function youtubeResumeAt(where, size, fallback) {
  try {
    const r = await fetch(where, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` } });
    if (r.status === 308) { const range = r.headers.get("range"); return range ? +range.split("-")[1] + 1 : 0; }
  } catch (e) { /* try from where we were */ }
  return fallback;
}
function youtubeError(code, text) {
  if (/quotaExceeded|uploadLimitExceeded/.test(text)) return "YouTube's daily upload limit for Shorts Studio is used up. Try again tomorrow, or upload this one by hand.";
  if (/youtubeSignupRequired/.test(text)) return "This Google account has no YouTube channel yet. Make one on youtube.com, then try again.";
  if (code === 401) return "YouTube's sign-in ran out. Connect YouTube again.";
  let msg = ""; try { msg = JSON.parse(text).error.message; } catch (e) { msg = String(text).slice(0, 160); }
  return `YouTube said ${code}${msg ? ": " + msg : ""}`;
}

// ---------- TikTok ----------
async function connectTikTok() {
  const c = config().tiktok;
  if (!c.clientKey) throw new Error("TikTok posting isn't set up in this copy of Shorts Studio yet.");
  cancelSignIn();
  const srv = pending = await catchRedirect(c.port, "/callback");
  try {
    const redirect = `http://localhost:${c.port}/callback/`, v = verifier(), state = b64url(crypto.randomBytes(12));
    // TikTok's desktop sign-in wants the SHA-256 of the verifier as hex, not base64url
    openBrowser(c.authUrl + "?" + new URLSearchParams({ client_key: c.clientKey, response_type: "code", scope: TT_SCOPES, redirect_uri: redirect, state,
      code_challenge: crypto.createHash("sha256").update(v).digest("hex"), code_challenge_method: "S256" }));
    const q = await srv.result;
    if (q.get("error")) throw new Error(q.get("error") === "access_denied" ? "You didn't allow it, so TikTok isn't connected." : "TikTok said: " + (q.get("error_description") || q.get("error")));
    if (q.get("state") !== state || !q.get("code")) throw new Error("The sign-in didn't come back right. Try again.");
    const t = await jsonPost(c.broker + "/token", { code: q.get("code"), code_verifier: v, redirect_uri: redirect });
    if (!t.json.refresh_token) throw new Error("TikTok didn't hand out a key: " + (t.json.error_description || t.json.error || t.status));
    const acct = tiktokAccount(t.json);
    try {
      const u = await (await fetch(c.apiUrl + "/user/info/?fields=open_id,display_name,avatar_url", { headers: { Authorization: "Bearer " + acct.access_token } })).json();
      acct.name = (u.data && u.data.user && u.data.user.display_name) || "";
    } catch (e) { /* the name is only for show */ }
    setAccount("tiktok", acct);
    log("publish", "TikTok connected", acct.name);
    return status().tiktok;
  } finally { pending = null; }
}
function tiktokAccount(j, old = {}) {
  return { ...old, access_token: j.access_token, refresh_token: j.refresh_token || old.refresh_token, open_id: j.open_id || old.open_id, scope: j.scope || old.scope,
    expires_at: Date.now() + (j.expires_in || 86400) * 1000, refresh_expires_at: j.refresh_expires_in ? Date.now() + j.refresh_expires_in * 1000 : old.refresh_expires_at, at: old.at || new Date().toISOString() };
}
async function tiktokToken() {
  const c = config().tiktok, a = loadAccounts().tiktok;
  if (!a || !a.refresh_token) throw new Error("Connect TikTok first.");
  if (a.access_token && a.expires_at > Date.now() + 60000) return a.access_token;
  const t = await jsonPost(c.broker + "/refresh", { refresh_token: a.refresh_token });
  if (!t.json.access_token) {
    if (/invalid_grant|refresh_token/i.test(String(t.json.error || ""))) { setAccount("tiktok", null); throw new Error("TikTok's sign-in ran out. Connect TikTok again."); }
    throw new Error("TikTok sign-in failed: " + (t.json.error_description || t.json.error || t.status));
  }
  setAccount("tiktok", { ...tiktokAccount(t.json, a), name: a.name });
  return t.json.access_token;
}
async function tiktokApi(p, body) {
  const c = config().tiktok, token = await tiktokToken();
  const r = await jsonPost(c.apiUrl + p, body, token);
  const err = r.json.error || {};
  if (err.code && err.code !== "ok") throw new Error(tiktokError(err));
  if (!r.ok) throw new Error(`TikTok said ${r.status}`);
  return r.json.data || {};
}
function tiktokError(err) {
  const known = {
    spam_risk_too_many_posts: "TikTok's limit of posts for today is reached. Try again tomorrow.",
    spam_risk_user_banned_from_posting: "TikTok isn't letting this account post right now.",
    reached_active_user_cap: "Shorts Studio has reached TikTok's daily limit of people posting. Try again tomorrow.",
    unaudited_client_can_only_post_to_private_accounts: "Until TikTok approves Shorts Studio, it can only post to private accounts. Send it to your drafts instead.",
    privacy_level_option_mismatch: "Pick who can see it again (TikTok changed the options).",
    access_token_invalid: "TikTok's sign-in ran out. Connect TikTok again.",
    scope_not_authorized: "TikTok didn't give Shorts Studio permission for this. Connect TikTok again and allow everything.",
  };
  return known[err.code] || "TikTok said: " + (err.message || err.code);
}
// Who's posting, which audiences they may pick, and what they've switched off (TikTok wants all of it shown).
async function tiktokCreator() { return tiktokApi("/post/publish/creator_info/query/", {}); }
// opts: { mode: "draft"|"post", caption, privacy, allowComment, allowDuet, allowStitch, brandOrganic, brandContent }
async function tiktokSend(file, opts, progress = () => {}) {
  const size = fs.statSync(file).size, MB = 1024 * 1024;
  // TikTok's pieces: the whole file under 5 MB; otherwise 10 MB pieces, the last one taking the rest
  const chunk = size < 5 * MB ? size : 10 * MB, count = size < 5 * MB ? 1 : Math.max(1, Math.floor(size / chunk));
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count };
  progress(0, "Starting");
  let init;
  if (opts.mode === "post") {
    if (!opts.privacy) throw new Error("Pick who can see it.");
    init = await tiktokApi("/post/publish/video/init/", { source_info, post_info: {
      title: String(opts.caption || "").slice(0, 2200), privacy_level: opts.privacy,
      disable_comment: !opts.allowComment, disable_duet: !opts.allowDuet, disable_stitch: !opts.allowStitch,
      video_cover_timestamp_ms: 1000, brand_organic_toggle: !!opts.brandOrganic, brand_content_toggle: !!opts.brandContent } });
  } else init = await tiktokApi("/post/publish/inbox/video/init/", { source_info });
  if (!init.upload_url) throw new Error("TikTok didn't give an upload address.");
  const fd = fs.openSync(file, "r");
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunk, end = i === count - 1 ? size - 1 : start + chunk - 1, buf = Buffer.alloc(end - start + 1);
      fs.readSync(fd, buf, 0, buf.length, start);
      let r, tries = 0;
      while (true) {
        try { r = await fetch(init.upload_url, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(buf.length), "Content-Range": `bytes ${start}-${end}/${size}` }, body: buf }); }
        catch (e) { r = null; }
        if (r && (r.ok || r.status === 206)) break;
        if (++tries > 3) throw new Error(`TikTok upload failed at part ${i + 1}${r ? ": " + r.status : ""}.`);
        await new Promise((s) => setTimeout(s, 2000 * tries));
      }
      progress((end + 1) / size, "Uploading to TikTok");
    }
  } finally { fs.closeSync(fd); }
  // wait until TikTok has it (a draft) or has posted it
  progress(1, "TikTok is processing it");
  for (let i = 0; i < 40; i++) {
    const st = await tiktokApi("/post/publish/status/fetch/", { publish_id: init.publish_id });
    if (st.status === "SEND_TO_USER_INBOX") return { publishId: init.publish_id, mode: "draft", status: "in your TikTok drafts", at: new Date().toISOString() };
    if (st.status === "PUBLISH_COMPLETE") return { publishId: init.publish_id, mode: "post", status: "posted", postId: (st.publicaly_available_post_id || [])[0] || null, at: new Date().toISOString() };
    if (st.status === "FAILED") throw new Error("TikTok turned it down: " + (st.fail_reason || "no reason given"));
    await new Promise((s) => setTimeout(s, +(process.env.SHORTS_STUDIO_TT_POLL_MS || 3000)));
  }
  return { publishId: init.publish_id, mode: opts.mode, status: "TikTok is still processing it", at: new Date().toISOString() };
}

async function disconnect(name) {
  const a = loadAccounts()[name];
  if (name === "youtube" && a && a.refresh_token) {
    try { await fetch(config().youtube.revokeUrl + "?token=" + encodeURIComponent(a.refresh_token), { method: "POST" }); } catch (e) { /* forget it here anyway */ }
  }
  setAccount(name, null);
  return status()[name];
}

module.exports = { config, status, connectYouTube, connectTikTok, cancelSignIn, disconnect, youtubeUpload, tiktokCreator, tiktokSend, FILE };
