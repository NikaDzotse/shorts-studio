// Stand-in Google, YouTube, TikTok and byttenapple.com broker servers for the posting tests. They follow the real
// protocols: PKCE checks on sign-in, YouTube's resumable upload, TikTok's chunked upload and status. start() resolves
// with { base, M, platforms, close }; M records what arrived and holds switches (failChunkOnce, ttError, gRefreshDead).
const http = require("http"), crypto = require("crypto");
const sha = (s, enc) => crypto.createHash("sha256").update(s).digest(enc);
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const M = { grants: {}, yt: {}, tt: {}, refreshes: { g: 0, t: 0 }, revoked: 0, failChunkOnce: false, ttError: null, gRefreshDead: false };
let BASE = "";

function body(req) { return new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); }); }
const json = (res, code, obj, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE), p = u.pathname, raw = await body(req);
  // ----- Google -----
  if (p === "/g/auth") {
    const q = u.searchParams;
    if (q.get("code_challenge_method") !== "S256" || !q.get("scope").includes("youtube.upload")) return json(res, 400, { error: "bad request" });
    M.grants.g = { challenge: q.get("code_challenge"), redirect: q.get("redirect_uri") };
    res.writeHead(302, { Location: q.get("redirect_uri") + "?code=GCODE&state=" + q.get("state") }); return res.end();
  }
  if (p === "/g/token") {
    const f = new URLSearchParams(raw.toString());
    if (f.get("client_id") !== "gid" || f.get("client_secret") !== "gsecret") return json(res, 401, { error: "invalid_client" });
    if (f.get("grant_type") === "authorization_code") {
      if (f.get("code") !== "GCODE" || b64url(sha(f.get("code_verifier"))) !== M.grants.g.challenge || f.get("redirect_uri") !== M.grants.g.redirect) return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, { access_token: "GA1", refresh_token: "GR1", expires_in: 3600 });
    }
    M.refreshes.g++;
    if (M.gRefreshDead) return json(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    return json(res, 200, { access_token: "GA" + (M.refreshes.g + 1), expires_in: 3600 });
  }
  if (p === "/g/userinfo") return json(res, 200, { email: "streamer@example.com" });
  if (p === "/g/revoke") { M.revoked++; return json(res, 200, {}); }
  if (p === "/g/upload" && req.method === "POST") {
    if (!/^Bearer GA/.test(req.headers.authorization || "")) return json(res, 401, { error: { message: "Invalid Credentials" } });
    M.yt = { meta: JSON.parse(raw.toString()), size: +req.headers["x-upload-content-length"], got: [], chunks: 0 };
    res.writeHead(200, { Location: BASE + "/g/session/1" }); return res.end();
  }
  if (p === "/g/session/1" && req.method === "PUT") {
    const cr = req.headers["content-range"];
    const have = M.yt.got.reduce((n, b) => n + b.length, 0);
    if (/\*\//.test(cr)) { res.writeHead(308, have ? { Range: "bytes=0-" + (have - 1) } : {}); return res.end(); }
    const [, a, b, total] = cr.match(/bytes (\d+)-(\d+)\/(\d+)/).map(Number);
    if (a !== have) return json(res, 400, { error: { message: "wrong offset " + a + " vs " + have } });
    M.yt.chunks++;
    if (M.failChunkOnce && M.yt.chunks === 2) { M.failChunkOnce = false; return json(res, 503, { error: { message: "backend error" } }); }
    M.yt.got.push(raw);
    if (b + 1 < total) { res.writeHead(308, { Range: "bytes=0-" + b }); return res.end(); }
    return json(res, 200, { id: "VID" + Date.now(), status: { privacyStatus: M.yt.meta.status.privacyStatus } });
  }
  // ----- TikTok (and the byttenapple.com broker) -----
  if (p === "/t/auth") {
    const q = u.searchParams;
    if (q.get("client_key") !== "tkey" || !/^[0-9a-f]{64}$/.test(q.get("code_challenge")) || !q.get("scope").includes("video.publish")) return json(res, 400, { error: "bad request" });
    M.grants.t = { challenge: q.get("code_challenge"), redirect: q.get("redirect_uri") };
    res.writeHead(302, { Location: q.get("redirect_uri") + "?code=TCODE&state=" + q.get("state") }); return res.end();
  }
  if (p === "/t/broker/token") {
    const b = JSON.parse(raw.toString());
    if (b.code !== "TCODE" || sha(b.code_verifier, "hex") !== M.grants.t.challenge || b.redirect_uri !== M.grants.t.redirect) return json(res, 400, { error: "invalid_grant" });
    return json(res, 200, { access_token: "TA1", refresh_token: "TR1", open_id: "OID", scope: "user.info.basic,video.upload,video.publish", expires_in: 86400, refresh_expires_in: 31536000 });
  }
  if (p === "/t/broker/refresh") { M.refreshes.t++; return json(res, 200, { access_token: "TA" + (M.refreshes.t + 1), refresh_token: "TR" + (M.refreshes.t + 1), expires_in: 86400 }); }
  const ttOk = (data) => json(res, 200, { data, error: { code: "ok", message: "" } });
  if (p.startsWith("/t/api/")) {
    if (!/^Bearer TA/.test(req.headers.authorization || "")) return json(res, 401, { error: { code: "access_token_invalid", message: "bad token" } });
    const ap = p.slice(6);
    if (ap.startsWith("/user/info/")) return ttOk({ user: { display_name: "Streamer TT" } });
    if (M.ttError && ap.includes("/init/")) { const e = M.ttError; M.ttError = null; return json(res, 403, { error: { code: e, message: "nope" } }); }
    if (ap === "/post/publish/creator_info/query/") return ttOk({ creator_nickname: "Streamer TT", creator_username: "streamer", privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"], comment_disabled: false, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 600 });
    if (ap === "/post/publish/inbox/video/init/" || ap === "/post/publish/video/init/") {
      const b = JSON.parse(raw.toString()), si = b.source_info;
      M.tt = { mode: ap.includes("inbox") ? "draft" : "post", post_info: b.post_info || null, size: si.video_size, chunk: si.chunk_size, count: si.total_chunk_count, got: [], polls: 0 };
      return ttOk({ publish_id: "PUB1", upload_url: BASE + "/t/up/PUB1" });
    }
    if (ap === "/post/publish/status/fetch/") { M.tt.polls++; return ttOk({ status: M.tt.polls < 2 ? "PROCESSING_UPLOAD" : M.tt.mode === "draft" ? "SEND_TO_USER_INBOX" : "PUBLISH_COMPLETE" }); }
  }
  if (p === "/t/up/PUB1" && req.method === "PUT") {
    const [, a, b, total] = req.headers["content-range"].match(/bytes (\d+)-(\d+)\/(\d+)/).map(Number);
    M.tt.got.push({ a, b, len: raw.length, data: raw });
    res.writeHead(b + 1 < total ? 206 : 201); return res.end();
  }
  json(res, 404, { error: "no " + p });
});


function platforms() {
  return { youtube: { clientId: "gid", clientSecret: "gsecret", authUrl: BASE + "/g/auth", tokenUrl: BASE + "/g/token", userinfoUrl: BASE + "/g/userinfo", revokeUrl: BASE + "/g/revoke", uploadUrl: BASE + "/g/upload" },
    tiktok: { clientKey: "tkey", authUrl: BASE + "/t/auth", broker: BASE + "/t/broker", apiUrl: BASE + "/t/api" } };
}
function start() {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => { BASE = "http://127.0.0.1:" + server.address().port; r({ base: BASE, M, platforms: platforms(), close: () => server.close() }); }));
}
module.exports = { start };
