// Drives the real main window (off-screen) through posting, against the stand-in servers in publish-mock.cjs:
// drag a Short out, connect YouTube and TikTok, upload, TikTok's required choices, post, schedule, Settings → Posting.
//   electron scripts/test-posting-ui.cjs <shots dir>
const fs = require("fs"), path = require("path"), os = require("os");
const SHOTS = path.resolve(process.argv[2] || path.join(os.tmpdir(), "shorts-posting-ui"));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-posting-ui-"));
fs.mkdirSync(SHOTS, { recursive: true });
const { app, BrowserWindow } = require("electron");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
process.env.SHORTS_STUDIO_DATA = DATA;
process.env.SHORTS_STUDIO_HIDDEN = "1";
process.env.SHORTS_STUDIO_TEST_BROWSER = "1";
process.env.SHORTS_STUDIO_TT_POLL_MS = "50";

// a finished Short to post (a real one from the engine test's folder)
const TEST = path.join(os.tmpdir(), "shorts-studio-test", "videos");
const mp4 = (function find(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { const r = find(f); if (r) return r; } else if (/\.mp4$/.test(e.name) && fs.existsSync(f.replace(/\.mp4$/, ".jpg"))) return f; } return null; })(TEST);
const file = path.join(DATA, "short.mp4"), thumb = path.join(DATA, "short.jpg");
fs.copyFileSync(mp4, file); fs.copyFileSync(mp4.replace(/\.mp4$/, ".jpg"), thumb);
fs.writeFileSync(path.join(DATA, "shorts.json"), JSON.stringify([{ id: "s1", status: "ready", file, thumb, title: "Big moment on stream", by: "aviewer", seconds: 13, updatedAt: new Date().toISOString() }]));
fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify({ channel: "teststreamer", firstRun: false, hashtags: "#shorts #twitch" }));

const drags = [];
app.on("web-contents-created", (e, wc) => { wc.startDrag = (item) => drags.push(item.file); });
const MOCK = require("./publish-mock.cjs");
let fails = 0;
const expect = (what, ok, got = "") => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + what + (got !== "" ? "   [" + got + "]" : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; }

(async () => {
  const mock = await MOCK.start();
  process.env.SHORTS_STUDIO_PLATFORMS = JSON.stringify(mock.platforms);
  require("../main.cjs");
  const S = require("../engine/store.cjs");
  await app.whenReady();
  try {
    const main = await until(() => BrowserWindow.getAllWindows()[0]);
    await until(() => !main.webContents.isLoading());
    await sleep(1500);
    const js = (code) => main.webContents.executeJavaScript(code, true);
    const shot = async (name) => { await main.webContents.capturePage(); await sleep(400); fs.writeFileSync(path.join(SHOTS, name + ".png"), (await main.webContents.capturePage()).toPNG()); };
    const click = (sel, text) => js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)}) && !x.disabled); if (b) b.click(); return !!b; })()`);
    const toastText = () => js(`document.querySelector("#toast").textContent`);
    const pick = (name, value) => js(`(() => { const r = document.querySelector('input[name=${name}][value=${value}]'); r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);

    // the card: drag the picture out
    await js(`document.querySelector(".short .th").dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }))`);
    await sleep(300);
    expect("dragging a Short's picture hands its video file to Windows", drags[0] === file, drags[0]);

    // the dialog, before connecting
    await click(".short button", "Upload");
    await until(() => js(`!document.querySelector("#upload").hidden`));
    await sleep(800);
    await shot("01-upload-not-connected");
    await js(`document.querySelector(".dragtile").dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }))`);
    await sleep(300);
    expect("the dialog's drag tile hands over the file too", drags.length === 2 && drags[1] === file);
    expect("not connected: Connect buttons and the manual way", await js(`document.querySelector("#upload-body").textContent.includes("Connect YouTube") && document.querySelector("#upload-body").textContent.includes("Open TikTok upload")`));

    // YouTube
    await click("#upload-body button", "Connect YouTube");
    await until(() => js(`document.querySelector("#upload-body").textContent.includes("Posting as streamer@example.com")`));
    expect("Connect YouTube: the browser sign-in comes back and the dialog says who", await js(`document.querySelector("#upload-body").textContent.includes("Posting as streamer@example.com")`));
    await click("#upload-body button", "Upload to YouTube");
    await sleep(300);
    expect("Upload without the made-for-kids answer is stopped", /made for kids/.test(await toastText()), await toastText());
    await pick("yt-kids", "no");
    await shot("02-youtube-connected");
    await click("#upload-body button", "Upload to YouTube");
    const yt = await until(() => { const s = S.get("s1"); return s.posts && s.posts.youtube ? s.posts.youtube : null; });
    await sleep(500);
    expect("Upload to YouTube: done, the status line links it", yt && /youtube\.com\/shorts/.test(yt.url) && (await js(`document.querySelector("#youtube-status").textContent`)).includes("YouTube ✓"), await js(`document.querySelector("#youtube-status").textContent`));
    expect("YouTube got the title, the hashtags and 'not for kids'", mock.M.yt.meta.snippet.title === "Big moment on stream" && mock.M.yt.meta.snippet.tags.join() === "shorts,twitch" && mock.M.yt.meta.status.selfDeclaredMadeForKids === false, JSON.stringify(mock.M.yt.meta.snippet.tags));
    expect("the Short's card shows it's on YouTube", await js(`[...document.querySelectorAll(".short .post")].some((p) => p.textContent.includes("YouTube ✓"))`));

    // TikTok
    await click("#upload-body button", "Connect TikTok");
    await until(() => js(`document.querySelector("#upload-body").textContent.includes("Posting as Streamer TT")`));
    expect("Connect TikTok", await js(`document.querySelector("#upload-body").textContent.includes("Posting as Streamer TT")`));
    await pick("tt-mode", "post");
    await until(() => js(`document.querySelector(".ttreq") && document.querySelector(".ttreq").textContent.includes("Posting to Streamer TT")`));
    const req = await js(`(() => { const r = document.querySelector(".ttreq"), sel = r.querySelector("select"); return { text: r.textContent, privacy: sel.value, boxes: [...r.querySelectorAll("input[type=checkbox]")].map((b) => b.checked + (b.disabled ? "(off)" : "")) }; })()`);
    expect("TikTok's rules: shows the account, no audience picked yet, everything unticked, Stitch greyed (off on the account)", req.privacy === "" && req.boxes.slice(0, 3).join() === "false,false,false(off)" && /Music Usage Confirmation/.test(req.text), JSON.stringify(req.boxes));
    await js(`document.querySelector(".ttreq").scrollIntoView({ block: "center" })`); await sleep(300);
    await shot("03-tiktok-post-choices");
    await click("#upload-body button", "Post to TikTok");
    await sleep(300);
    expect("Post without choosing who can see it is stopped", /Choose who can see it/.test(await toastText()), await toastText());
    await js(`(() => { const sel = document.querySelector(".ttreq select"); sel.value = "PUBLIC_TO_EVERYONE"; sel.dispatchEvent(new Event("change")); const c = document.querySelector(".ttreq input[type=checkbox]"); c.checked = true; c.dispatchEvent(new Event("change")); })()`);
    await js(`(() => { const all = [...document.querySelectorAll(".ttreq input[type=checkbox]")]; const d = all[3]; d.checked = true; d.dispatchEvent(new Event("change")); })()`);   // "commercial content"
    await sleep(200);
    await click("#upload-body button", "Post to TikTok");
    await sleep(300);
    expect("commercial content ticked but not which kind: stopped", /brand/.test(await toastText()), await toastText());
    await js(`(() => { const own = [...document.querySelectorAll(".ttreq label")].find((l) => l.textContent.startsWith("Your brand")).querySelector("input"); own.checked = true; own.dispatchEvent(new Event("change")); })()`);
    await sleep(200);
    await js(`document.querySelector(".ttreq").scrollIntoView({ block: "center" })`); await sleep(300);
    await shot("04-tiktok-ready");
    await click("#upload-body button", "Post to TikTok");
    const tt = await until(() => { const s = S.get("s1"); return s.posts && s.posts.tiktok ? s.posts.tiktok : null; });
    expect("Post to TikTok: posted, with exactly the choices made", tt && tt.status === "posted" && mock.M.tt.post_info.privacy_level === "PUBLIC_TO_EVERYONE" && mock.M.tt.post_info.disable_comment === false && mock.M.tt.post_info.disable_duet === true && mock.M.tt.post_info.brand_organic_toggle === true && mock.M.tt.post_info.brand_content_toggle === false, JSON.stringify(mock.M.tt.post_info));
    // schedule one
    await pick("tt-mode", "schedule");
    await sleep(300);
    await js(`(() => { const sel = document.querySelector(".ttreq select"); if (sel) { sel.value = "MUTUAL_FOLLOW_FRIENDS"; sel.dispatchEvent(new Event("change")); } })()`);
    await click("#upload-body button", "Schedule on TikTok");
    const plan = await until(() => S.get("s1").tiktokPlan);
    await sleep(600);
    expect("Schedule on TikTok: saved for later, the card says so", plan && plan.opts.privacy === "MUTUAL_FOLLOW_FRIENDS" && await js(`[...document.querySelectorAll(".short .post")].some((p) => p.textContent.includes("TikTok: goes out"))`), plan && plan.at);
    await shot("05-tiktok-scheduled");
    await js(`document.querySelector("[data-close=upload]").click()`);
    await click(".short button", "Upload");
    await until(() => js(`document.querySelector("#upload-body").textContent.includes("Cancel the schedule")`));
    await click("#upload-body button", "Cancel the schedule");
    await until(() => !S.get("s1").tiktokPlan);
    expect("cancel the schedule", !S.get("s1").tiktokPlan);
    await js(`document.querySelector("[data-close=upload]").click()`);

    // Settings → Posting
    await js(`document.querySelector("#open-settings").click()`);
    await until(() => js(`document.querySelector("#settings-body").textContent.includes("Posting as Streamer TT")`));
    await js(`(() => { const sec = [...document.querySelectorAll("#settings .sec")].find((x) => x.textContent.startsWith("Posting")); sec.scrollIntoView(); })()`);
    await sleep(400);
    await shot("06-settings-posting");
    await js(`(() => { const sec = [...document.querySelectorAll("#settings .sec")].find((x) => x.textContent.startsWith("Posting")); [...sec.querySelectorAll("button")].filter((b) => b.textContent === "Disconnect")[1].click(); })()`);
    await until(() => js(`document.querySelector("#settings-body").textContent.includes("Connect TikTok")`));
    expect("Settings: disconnect TikTok", await js(`document.querySelector("#settings-body").textContent.includes("Connect TikTok")`));
  } catch (e) { fails++; console.log("  FAIL  " + (e.stack || e.message)); }
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  app.exit(fails ? 1 : 0);
})();
