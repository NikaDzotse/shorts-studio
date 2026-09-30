# Shorts Studio

Turns your Twitch clips into vertical Shorts for YouTube and TikTok: trimmed to the good part, with captions, your chat
on screen, and a look you pick. There's a full editor for when you want to change things. Everything runs on your own
PC. You don't need a Twitch login, API keys or an account anywhere.

**[⬇ Download for Windows](https://github.com/NikaDzotse/shorts-studio/releases/latest)**

![Three Shorts made with Shorts Studio playing side by side](docs/demo.gif)

Left to right:
1. **Case File** look, "you centred" layout: an emoji, a zoom, a chat note from the VOD, an evidence stamp with a slam
   sound, a bleeped word and noir music.
2. **Case File**, "camera + game" layout.
3. **Clean** look.

![Your clips on the left, your Shorts on the right](docs/main.png)

![The editor: source clip, the Short, the settings for each part, and a timeline with every track](docs/editor.png)

## Install (Windows 10 or 11, 64-bit)

1. Download `Shorts-Studio-Setup-0.1.0.exe` from [Releases](https://github.com/NikaDzotse/shorts-studio/releases/latest)
   and run it.
2. Windows will probably show **"Windows protected your PC"**. The app isn't code-signed (a certificate costs money
   every year), so Windows doesn't know it yet. Click **More info**, then **Run anyway**.
3. Choose where to install it (the default is fine). You'll get a desktop shortcut.

## First start

- Type your **Twitch channel name** (the part after `twitch.tv/`).
- Pick a **look**:
  - **Clean**: a title bar, your channel in a pill, chat shown as bubbles.
  - **Case File**: a noir detective look. You can change the look and its colour in Settings at any time.
- Press **Start**. The first time, it downloads the speech model for captions (148 MB, once). You can pick the bigger
  "Best" model (466 MB) for better captions.

<img src="docs/welcome.png" alt="First start: your channel, a look, the speech model" width="700">

## Making Shorts

- **Your clips** shows your channel's clips from today, this week, this month or all time. Tick some and press
  **Make Shorts**.
- **Paste clip links** works for any channel's clips.
- **Best of the week** joins the week's top clips into one Short, about 10 s from each.
- Each Short takes about 20 to 40 seconds to make.

Every Short is saved to `Videos\Shorts Studio`. The **📁 Your Shorts folder** button opens it.

Chat on the Short comes from the stream's VOD. If your VODs are off or deleted, the Short has no chat.
Captions come from what's said in the clip.

## Editing

Press **✎ Edit** on a Short. The editor window has:

- **Timeline:** drag across the sound to keep or cut parts. Split, delete, and smart trim.
- **Look:** layout (camera + game, 4:3, whole picture, you centred), and drag the boxes to choose what's shown.
  "Use these crops for my next Shorts" remembers where your camera and game are.
- **Title:** the title card and the bottom card, including their words, position and when they show.
- **Captions:** fix any word, change timings, styles and colours, add emoji, bleep words.
- **Chat:** choose which chat messages show, reword them, and move them.
- **Text:** your own text on the Short.
- **Stickers:** emoji, arrows, circles, stamps, labels, your emotes, your own pictures.
- **FX:** zoom in on a moment, slow motion, freeze frame.
- **Sound:** your volume, sound effects, background music (it gets quieter while you talk).
- **Post:** the title, YouTube description and TikTok caption.
- **Join:** put other Shorts after this one.

Press **Save & rebuild** when you're done, then **▶ Watch result**.

![The Sound tab: volume, bleeps, music that dips under your voice, and sound effects](docs/editor-sound.png)

Your own sounds, music and pictures go in the folders the Sound tab opens. Press **↻ Refresh library** after
adding files.

## Uploading

Press **⬆ Upload** on a Short. It shows the title, description and TikTok caption with copy buttons, and opens the
YouTube or TikTok upload page. Drag the video file in and paste the words. Shorts Studio never logs into your
accounts.

<img src="docs/upload.png" alt="The upload helper: title, description and TikTok caption with Copy buttons" width="700">

## Where things are

- **Your Shorts:** `Videos\Shorts Studio`.
- **Settings, the speech model and your library:** `%APPDATA%\Shorts Studio`.
- **Log:** Settings, then **Open the log**. It helps if something fails.

Uninstalling (Windows Settings, then Apps) keeps your Shorts and settings.

## Credits and licences

Shorts Studio uses these, all included in the installer:

- [Electron](https://www.electronjs.org/) (MIT)
- [FFmpeg](https://ffmpeg.org/) (GPL v3; the gyan.dev essentials build, source at https://www.gyan.dev/ffmpeg/builds/)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) with the OpenAI Whisper models (MIT)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense)
- [wavesurfer.js](https://wavesurfer.xyz/) (BSD-3)

Sounds: see `resources\sounds\CREDITS.txt` in the install folder. They're either made for the app or CC0.

Twitch, YouTube and TikTok are trademarks of their owners. Shorts Studio isn't made by or connected to any of them.

---

## For developers

```
npm install
npm run tools            # ffmpeg, yt-dlp and whisper.cpp into resources\bin
npm run tools -- --model # the base speech model into dev-models\ (tests)
npm start                # run it
npm run dist             # dist\Shorts-Studio-Setup-<version>.exe
```

- `npm run dist` runs electron-builder on the Node that ships inside Electron (electron-builder 26 needs Node 22).
- Tests:
  - `electron scripts/test-engine.cjs <clip slug> --channel <channel> [--edit] [--theme clean]` makes a Short with no
    windows.
  - `electron scripts/test-ui.cjs <shots dir> [--fresh] [--save]` drives the real windows off-screen and saves
    screenshots.
  - `node scripts/run-electron-node.cjs scripts/test-packaged.cjs <shots dir>` does the same with the built app in
    `dist\win-unpacked`.

Code layout:

- `main.cjs`: the app.
- `preload.cjs`: the `window.studio` bridge.
- `engine\`: making Shorts (Twitch, yt-dlp, whisper, ffmpeg).
- `ui\`: the main window and the editor.
- `themes\<id>\`: `frame.html`, `note.html` and `theme.json` for each look. To add a look, copy a folder.
