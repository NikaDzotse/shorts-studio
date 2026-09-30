"use strict";
// Gathers the programs Shorts Studio ships with into resources\bin (run before building the installer):
//   ffmpeg.exe                 copied from FFMPEG_DIR if set or found, else the gyan.dev "essentials" build
//   yt-dlp.exe                 github.com/yt-dlp/yt-dlp (public domain)
//   whisper\whisper-cli.exe    github.com/ggml-org/whisper.cpp (MIT), the CPU build, with its DLLs
// and, for testing on this PC only, the base speech model into dev-models\ (the app downloads its own on first run).
//   node scripts/fetch-tools.cjs [--model]
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BIN = path.join(ROOT, "resources", "bin");
const TMP = path.join(ROOT, ".tools-tmp");
const WHISPER_ZIP = "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip";
const YTDLP = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const FFMPEG_ZIP = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const MODEL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const LOCAL_FFMPEG = [process.env.FFMPEG_DIR].filter(Boolean);   // set FFMPEG_DIR to copy an ffmpeg you already have

async function download(url, to) {
  console.log("downloading", url);
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const total = +r.headers.get("content-length") || 0; let got = 0, last = 0;
  const out = fs.createWriteStream(to);
  for await (const chunk of r.body) {
    out.write(chunk); got += chunk.length;
    if (total && got - last > total / 10) { last = got; process.stdout.write(`  ${Math.round(got / total * 100)}%`); }
  }
  await new Promise((res) => out.end(res));
  console.log(`\n  ${(got / 1e6).toFixed(1)} MB -> ${path.relative(ROOT, to)}`);
}
// Windows' own tar (bsdtar) reads zips; a GNU tar from Git Bash would take "C:" for a remote host
const unzip = (zip, dir) => { fs.mkdirSync(dir, { recursive: true }); execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", dir]); };
const findFile = (dir, name) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { const x = findFile(p, name); if (x) return x; } else if (f.name.toLowerCase() === name) return p; } return null; };

(async () => {
  fs.mkdirSync(BIN, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });
  // ffmpeg
  if (!fs.existsSync(path.join(BIN, "ffmpeg.exe"))) {
    const local = LOCAL_FFMPEG.find((d) => fs.existsSync(path.join(d, "ffmpeg.exe")));
    if (local) {
      for (const f of ["ffmpeg.exe"]) fs.copyFileSync(path.join(local, f), path.join(BIN, f));
      const lic = path.join(local, "..", "LICENSE"); if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(BIN, "FFMPEG-LICENSE.txt"));
      console.log("ffmpeg copied from", local);
    } else {
      const zip = path.join(TMP, "ffmpeg.zip"); await download(FFMPEG_ZIP, zip); unzip(zip, path.join(TMP, "ffmpeg"));
      for (const f of ["ffmpeg.exe"]) fs.copyFileSync(findFile(path.join(TMP, "ffmpeg"), f), path.join(BIN, f));
      const lic = findFile(path.join(TMP, "ffmpeg"), "license"); if (lic) fs.copyFileSync(lic, path.join(BIN, "FFMPEG-LICENSE.txt"));
    }
  }
  // yt-dlp
  if (!fs.existsSync(path.join(BIN, "yt-dlp.exe"))) await download(YTDLP, path.join(BIN, "yt-dlp.exe"));
  // whisper.cpp: whisper-cli.exe and the DLLs next to it
  const wdir = path.join(BIN, "whisper");
  if (!fs.existsSync(path.join(wdir, "whisper-cli.exe"))) {
    const zip = path.join(TMP, "whisper.zip"); await download(WHISPER_ZIP, zip); unzip(zip, path.join(TMP, "whisper"));
    const cli = findFile(path.join(TMP, "whisper"), "whisper-cli.exe"); if (!cli) throw new Error("no whisper-cli.exe in the zip");
    fs.mkdirSync(wdir, { recursive: true });
    for (const f of fs.readdirSync(path.dirname(cli))) if (/\.(exe|dll)$/i.test(f) && (f === "whisper-cli.exe" || /\.dll$/i.test(f))) fs.copyFileSync(path.join(path.dirname(cli), f), path.join(wdir, f));
    const lic = findFile(path.join(TMP, "whisper"), "license"); if (lic) fs.copyFileSync(lic, path.join(wdir, "LICENSE.txt"));
    console.log("whisper.cpp:", fs.readdirSync(wdir).join(", "));
  }
  // the speech model, for testing here
  if (process.argv.includes("--model")) {
    const m = path.join(ROOT, "dev-models", "ggml-base.bin");
    fs.mkdirSync(path.dirname(m), { recursive: true });
    if (!fs.existsSync(m)) await download(MODEL, m);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("tools ready in resources\\bin");
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
