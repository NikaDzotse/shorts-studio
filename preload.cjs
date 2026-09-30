"use strict";
// The bridge between the windows and the app: window.studio.<name>(...) -> the handler of the same name in main.cjs.
// Every call resolves with the value or rejects with a readable message.
const { contextBridge, ipcRenderer } = require("electron");

const call = (name) => async (...args) => { const r = await ipcRenderer.invoke("studio:" + name, ...args); if (!r.ok) throw new Error(r.error); return r.value; };
const NAMES = ["settings", "saveSettings", "themes", "clips", "make", "bestOf", "shorts", "editData", "saveEdit", "remake", "remove", "reveal", "openFolder",
  "openUpload", "openLink", "copy", "openEditor", "library", "model", "downloadModel", "obs", "emotes", "chooseFolder", "version", "busy"];
const api = Object.fromEntries(NAMES.map((n) => [n, call(n)]));
const on = (ch) => (cb) => { const f = (e, data) => cb(data); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
api.onShorts = on("studio:shorts");
api.onSettings = on("studio:settings");
api.onModel = on("studio:model");
// turns a file path into a URL the page can show (file:///C:/...)
api.fileUrl = (p) => p ? "file:///" + String(p).replace(/\\/g, "/").split("/").map((x, i) => i === 0 ? x : encodeURIComponent(x)).join("/") : "";
contextBridge.exposeInMainWorld("studio", api);
