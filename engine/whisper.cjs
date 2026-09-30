"use strict";
// Captions: whisper.cpp (bundled) turns the clip's sound into words with their times. The speech model is downloaded
// once, on first use, into the app's data folder.
const fs = require("fs");
const os = require("os");
const path = require("path");
const P = require("./paths.cjs");
const { run } = require("./run.cjs");

const MODELS = {
  base: { file: "ggml-base.bin", mb: 148, url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin" },
  small: { file: "ggml-small.bin", mb: 466, url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" },
};
const modelPath = (name) => path.join(P.MODELS, (MODELS[name] || MODELS.base).file);
const hasModel = (name) => { try { return fs.statSync(modelPath(name)).size > 50e6; } catch (e) { return false; } };

// downloads the model (onProgress(0..1)); a half-finished download is thrown away and started again
async function download(name, onProgress = () => {}) {
  const m = MODELS[name] || MODELS.base, to = modelPath(name), part = to + ".part";
  if (hasModel(name)) return to;
  fs.mkdirSync(P.MODELS, { recursive: true });
  const r = await fetch(m.url, { redirect: "follow" });
  if (!r.ok) throw new Error(`Couldn't download the speech model (${r.status})`);
  const total = +r.headers.get("content-length") || m.mb * 1e6; let got = 0;
  const out = fs.createWriteStream(part);
  for await (const chunk of r.body) { out.write(chunk); got += chunk.length; onProgress(Math.min(1, got / total)); }
  await new Promise((res) => out.end(res));
  fs.renameSync(part, to);
  return to;
}

// wav (16 kHz mono) -> [{ w, s, e }] in seconds
async function words(wav, { model = "base", language = "auto" } = {}) {
  if (!hasModel(model)) await download(model);
  const out = path.join(path.dirname(wav), "whisper");
  const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
  await run(P.WHISPER, ["-m", modelPath(model), "-f", wav, "-ml", "1", "-sow", "-oj", "-of", out, "-l", language || "auto", "-np", "-t", String(threads)], { cwd: path.dirname(P.WHISPER) });
  const j = JSON.parse(fs.readFileSync(out + ".json", "utf8"));
  return (j.transcription || []).map((x) => ({ w: String(x.text || "").trim(), s: x.offsets.from / 1000, e: x.offsets.to / 1000 }))
    .filter((x) => x.w && !/^\[.*\]$/.test(x.w) && !/^\(.*\)$/.test(x.w));   // no "[MUSIC]" / "(laughs)" markers
}

module.exports = { MODELS, modelPath, hasModel, download, words };
