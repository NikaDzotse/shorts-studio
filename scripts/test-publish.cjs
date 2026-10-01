// Tests posting (engine/publish.cjs + engine/posting.cjs) against stand-in Google, YouTube, TikTok and broker servers that
// follow the real protocols: sign-in redirects with PKCE checks, YouTube's resumable upload (one piece fails once),
// TikTok's chunked upload and status, tokens that run out, error codes, the TikTok scheduler. No windows, no network.
//   electron scripts/test-publish.cjs
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-publish-"));
const { app } = require("electron");
app.setPath("userData", DATA);

const MOCK = require("./publish-mock.cjs");
let M, BASE;
let fails = 0;
const expect = (what, ok, got = "") => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + what + (got !== "" ? "   [" + got + "]" : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(100); } return null; }
async function rejects(fn) { try { await fn(); return ""; } catch (e) { return e.message; } }

app.whenReady().then(async () => {
  try {
    const mock = await MOCK.start(); M = mock.M; BASE = mock.base;
    // a finished Short: a real small video, and a bigger file for TikTok's pieces
    const small = path.join(DATA, "short.mp4"), big = path.join(DATA, "big.mp4");
    const src = (function find(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { const r = find(f); if (r) return r; } else if (/\.mp4$/.test(e.name) && fs.statSync(f).size > 1e6) return f; } return null; })(path.join(os.tmpdir(), "shorts-studio-test", "videos"));
    fs.copyFileSync(src, small);
    fs.writeFileSync(big, crypto.randomBytes(23 * 1024 * 1024 + 12345));
    fs.writeFileSync(path.join(DATA, "shorts.json"), JSON.stringify([{ id: "s1", status: "ready", file: small, title: "Test Short", thumb: "" }, { id: "s2", status: "ready", file: big, title: "Big one" }]));

    process.env.SHORTS_STUDIO_TEST_BROWSER = "1";
    process.env.SHORTS_STUDIO_TT_POLL_MS = "50";
    const PUB = require("../engine/publish.cjs");
    console.log("not set up");
    let st = PUB.status();
    expect("without platforms.json, both say not set up", !st.youtube.configured && !st.tiktok.configured, JSON.stringify(st));
    expect("Connect explains it isn't set up", /isn't set up/.test(await rejects(() => PUB.connectYouTube())));

    process.env.SHORTS_STUDIO_PLATFORMS = JSON.stringify(mock.platforms);
    console.log("YouTube");
    st = await PUB.connectYouTube();
    expect("connect YouTube (PKCE checked by the stand-in)", st.connected && st.name === "streamer@example.com", JSON.stringify(st));
    expect("the keys on disk are encrypted", /"enc"/.test(fs.readFileSync(PUB.FILE, "utf8")) && !/GR1/.test(fs.readFileSync(PUB.FILE, "utf8")));
    const prog = [];
    let r = await PUB.youtubeUpload(small, { title: "<Big> moment", description: "desc <b>", tags: ["#shorts", "#twitch"], privacy: "public" }, (f) => prog.push(f));
    const sent = Buffer.concat(M.yt.got);
    expect("upload: every byte arrives, in order", sent.equals(fs.readFileSync(small)), sent.length + " / " + fs.statSync(small).size);
    expect("upload: < and > taken out, tags without #", M.yt.meta.snippet.title === "Big moment" && M.yt.meta.snippet.description === "desc b" && M.yt.meta.snippet.tags.join() === "shorts,twitch", JSON.stringify(M.yt.meta.snippet));
    expect("upload: public, not for kids, link to the Short", M.yt.meta.status.privacyStatus === "public" && M.yt.meta.status.selfDeclaredMadeForKids === false && /youtube\.com\/shorts\/VID/.test(r.url), r.url);
    expect("upload: progress goes up to 1", prog.length > 1 && prog[prog.length - 1] === 1, prog.map((x) => x.toFixed(2)).join(" "));
    M.failChunkOnce = true;
    await PUB.youtubeUpload(big, { title: "Big file", privacy: "public" });
    const bigSent = Buffer.concat(M.yt.got);
    expect("upload: 23 MB in 8 MB pieces; the piece that failed is sent again", bigSent.equals(fs.readFileSync(big)) && !M.failChunkOnce && M.yt.chunks === 4, "piece requests " + M.yt.chunks + " (3 pieces + 1 resend)");
    const when = new Date(Date.now() + 86400000);
    r = await PUB.youtubeUpload(small, { title: "Later", privacy: "public", publishAt: when.toISOString(), kids: false, synthetic: true });
    expect("schedule: private with YouTube's publish time", M.yt.meta.status.privacyStatus === "private" && M.yt.meta.status.publishAt === when.toISOString() && M.yt.meta.status.containsSyntheticMedia === true, JSON.stringify(M.yt.meta.status));
    // the key runs out: refreshed once, then the upload goes on
    let acc = JSON.parse(require("electron").safeStorage.decryptString(Buffer.from(JSON.parse(fs.readFileSync(PUB.FILE, "utf8")).enc, "base64")));
    acc.youtube.expires_at = Date.now() - 1000;
    fs.writeFileSync(PUB.FILE, JSON.stringify({ enc: require("electron").safeStorage.encryptString(JSON.stringify(acc)).toString("base64") }));
    const before = M.refreshes.g;
    await PUB.youtubeUpload(small, { title: "After refresh", privacy: "unlisted" });
    expect("an old key is refreshed before the upload", M.refreshes.g === before + 1 && M.yt.meta.status.privacyStatus === "unlisted", "refreshes " + (M.refreshes.g - before));

    console.log("TikTok");
    st = await PUB.connectTikTok();
    expect("connect TikTok (hex PKCE, secret only at the broker)", st.connected && st.name === "Streamer TT", JSON.stringify(st));
    const ci = await PUB.tiktokCreator();
    expect("creator info: nickname and privacy options", ci.creator_nickname === "Streamer TT" && ci.privacy_level_options.length === 3);
    r = await PUB.tiktokSend(small, { mode: "draft" });
    const tsent = Buffer.concat(M.tt.got.map((g) => g.data));
    expect("drafts: the whole file in one piece (under 5 MB) or TikTok's pieces", tsent.equals(fs.readFileSync(small)) && M.tt.mode === "draft", M.tt.count + " piece(s), " + tsent.length + " bytes");
    expect("drafts: says it's in your TikTok drafts", r.status === "in your TikTok drafts", r.status);
    r = await PUB.tiktokSend(big, { mode: "post", caption: "caption #tag", privacy: "PUBLIC_TO_EVERYONE", allowComment: true, allowDuet: false, allowStitch: false });
    const pieces = M.tt.got.map((g) => `${g.a}-${g.b}`).join(" ");
    expect("post: 23 MB goes as 2 pieces, the last one takes the rest", M.tt.count === 2 && M.tt.got.length === 2 && M.tt.got[1].b === fs.statSync(big).size - 1 && M.tt.got[0].len === 10 * 1024 * 1024, pieces);
    expect("post: TikTok gets the choices", M.tt.post_info.privacy_level === "PUBLIC_TO_EVERYONE" && M.tt.post_info.disable_comment === false && M.tt.post_info.disable_duet === true && M.tt.post_info.title === "caption #tag", JSON.stringify(M.tt.post_info));
    expect("post: posted", r.status === "posted" && r.mode === "post", r.status);
    expect("post without picking who can see it is refused", /Pick who can see it/.test(await rejects(() => PUB.tiktokSend(small, { mode: "post", caption: "x" }))));
    M.ttError = "spam_risk_too_many_posts";
    expect("TikTok's limit gives a clear message", /limit of posts for today/.test(await rejects(() => PUB.tiktokSend(small, { mode: "draft" }))));

    console.log("in the background (posting.cjs)");
    const S = require("../engine/store.cjs"), POST = require("../engine/posting.cjs");
    const seen = [];
    S.events.on("change", (it) => { if (it.id === "s1" && it.posting && it.posting.youtube) seen.push(it.posting.youtube.step); });
    POST.start("s1", "youtube", { title: "From the window", privacy: "public" });
    const done = await until(() => { const s = S.get("s1"); return s.posts && s.posts.youtube && !(s.posting || {}).youtube ? s : null; });
    expect("the window sees progress and then the result", done && done.posts.youtube.id && seen.length >= 2, seen.join(" > "));
    expect("one upload at a time per platform", /already uploading/.test(await (async () => { POST.start("s2", "tiktok", { mode: "draft" }); try { POST.start("s2", "tiktok", { mode: "draft" }); return ""; } catch (e) { return e.message; } })()));
    await until(() => S.get("s2").posts && S.get("s2").posts.tiktok);
    expect("a time in the past can't be scheduled", /future/.test((() => { try { POST.schedule("s1", Date.now() - 1000, {}); return ""; } catch (e) { return e.message; } })()));
    POST.schedule("s1", Date.now() + 60000, { mode: "draft" });
    S.update("s1", { tiktokPlan: { ...S.get("s1").tiktokPlan, at: new Date(Date.now() - 5 * 60000).toISOString() } });   // as if the app had been closed
    POST.tick();
    const late = await until(() => { const s = S.get("s1"); return s.posts && s.posts.tiktok ? s : null; });
    expect("a scheduled TikTok post goes out (and says it was 5 min late)", late && !late.tiktokPlan && late.posts.tiktok.late === 5, late && JSON.stringify(late.posts.tiktok));
    M.ttError = "unaudited_client_can_only_post_to_private_accounts";
    POST.start("s2", "tiktok", { mode: "post", privacy: "SELF_ONLY", caption: "x" });
    const failed = await until(() => { const p = (S.get("s2").posting || {}).tiktok; return p && p.error ? p : null; });
    expect("a failed post shows TikTok's reason on the Short", failed && /approves Shorts Studio/.test(failed.error), failed && failed.error);

    console.log("signing out");
    M.gRefreshDead = true;
    acc = JSON.parse(require("electron").safeStorage.decryptString(Buffer.from(JSON.parse(fs.readFileSync(PUB.FILE, "utf8")).enc, "base64")));
    acc.youtube.expires_at = 0;
    fs.writeFileSync(PUB.FILE, JSON.stringify({ enc: require("electron").safeStorage.encryptString(JSON.stringify(acc)).toString("base64") }));
    const msg = await rejects(() => PUB.youtubeUpload(small, { title: "x" }));
    expect("a revoked sign-in says connect again, and forgets the key", /Connect YouTube again/.test(msg) && !PUB.status().youtube.connected, msg);
    st = await PUB.disconnect("tiktok");
    expect("disconnect TikTok", !st.connected && !PUB.status().tiktok.connected);
  } catch (e) { fails++; console.log("  FAIL  " + (e.stack || e.message)); }
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  app.exit(fails ? 1 : 0);
});
