# Setting up posting to YouTube and TikTok

This is for whoever publishes Shorts Studio, not for the people using it. Posting from the app needs Shorts Studio's own
app at Google and at TikTok, made once and then approved by both. Until they're filled in, the app's Connect buttons say
posting "isn't set up in this copy yet" and everyone drags the Short into the upload page instead.

What goes where:

| | Where it goes | Public? |
|---|---|---|
| Google client ID + client secret | `resources/platforms.json` → `youtube` | Yes. Google treats a desktop app's secret as public. |
| TikTok client key | `resources/platforms.json` → `tiktok.clientKey` | Yes |
| TikTok client secret | Railway, on the byttenapple.com service: `SHORTS_STUDIO_TIKTOK_CLIENT_KEY` and `SHORTS_STUDIO_TIKTOK_CLIENT_SECRET` | **No.** Never put it in the app. |

The pages the reviews ask for are already live:

- **Home page:** https://byttenapple.com/assets/shorts-studio
- **Privacy policy:** https://byttenapple.com/assets/shorts-studio/privacy
- **Terms:** https://byttenapple.com/assets/shorts-studio/terms

## YouTube (Google Cloud)

1. At [console.cloud.google.com](https://console.cloud.google.com), create a project called **Shorts Studio**.
2. Go to **APIs & Services → Library** and enable **YouTube Data API v3**.
3. Fill in **Google Auth Platform → Branding**:
   - **App name:** Shorts Studio.
   - **Logo:** `build/logo-120.png`.
   - **Support email:** yours.
   - **App home page, privacy policy and terms:** the three links above.
   - **Authorized domain:** `byttenapple.com`. Google asks you to prove you own it in
     [Search Console](https://search.google.com/search-console), with a DNS TXT record on the domain.
4. Under **Audience**, choose **External**.
   - While the app is in testing, add your Google account and your friends' under **Test users** (up to 100).
   - Only test users can connect until Google verifies the app.
5. Under **Data access**, add these scopes: `.../auth/youtube.upload`, `openid` and `.../auth/userinfo.email`.
6. Under **Clients**, create a client and pick the application type **Desktop app**.
   - Copy its **client ID** and **client secret** into `resources/platforms.json` → `youtube.clientId` / `youtube.clientSecret`.
   - Then `npm run dist`. Connecting YouTube now works for test users, and uploads stay **private** (step 8).
7. **Verification** (needed because `youtube.upload` is a sensitive scope):
   - Press **Publish app**, then submit it for verification.
   - Google wants a short video showing:
     - the Connect YouTube sign-in, with the app name on the consent screen;
     - what the app does with the permission (the Upload dialog uploading a Short).
   - Explain the scope like this: "Uploads the vertical videos the user makes in Shorts Studio to their own channel, only when they press Upload or schedule one."
8. **YouTube API audit**, which lifts the "uploads stay private" lock:
   - Fill in the [YouTube API Services audit and quota extension form](https://support.google.com/youtube/contact/yt_api_form).
   - Describe it as: a desktop app; users upload their own Shorts to their own channel; no YouTube data is stored or sent anywhere else. Give the privacy and terms links, and attach screenshots of the Upload dialog.
9. When it's approved, set `youtube.audited` to `true` in `platforms.json` (that removes the "stays private" note in the app) and release a new version.

## TikTok

1. At [developers.tiktok.com](https://developers.tiktok.com), go to **Manage apps** and create an app called **Shorts Studio**.
   - Category: video editing / creator tools.
   - Platform: **Desktop**.
   - Icon: `build/icon.png`.
   - Terms and privacy: the links above.
   - TikTok may ask you to verify `byttenapple.com` (a DNS TXT record or a file).
2. Add these products:
   - **Login Kit:** on the Desktop platform, add the redirect URI `http://localhost:8765/callback/` exactly as written.
   - **Content Posting API:** turn on **Direct Post**.
   - Scopes: `user.info.basic`, `video.upload`, `video.publish`.
3. Copy the keys:
   - The **client key** goes into `resources/platforms.json` → `tiktok.clientKey`.
   - The **client key and client secret** go into the Railway variables `SHORTS_STUDIO_TIKTOK_CLIENT_KEY` and `SHORTS_STUDIO_TIKTOK_CLIENT_SECRET`, on the service that runs byttenapple.com, then redeploy.
4. Test in the **Sandbox**: add your TikTok account as a target user, `npm run dist`, and connect from the app.
   - **Send to drafts** works there.
   - **Post** only works on a private account, and the post stays private.
5. **Submit the app for review** with a demo video:
   - Connect TikTok.
   - The Upload dialog showing your TikTok name.
   - Choosing who can see it; Comment, Duet and Stitch; the commercial-content choice; the Music Usage Confirmation line.
   - A post or draft arriving on TikTok.

   The dialog already follows TikTok's Content Sharing Guidelines:
   - nothing is picked for you;
   - settings switched off in the TikTok account are greyed out;
   - TikTok's duration limit is checked;
   - branded content can't be private.
6. After the app is approved, apply for the **Direct Post audit** (Content Posting API → Apply for audit). It lifts the private-only rule. When it passes, set `tiktok.audited` to `true` and release a new version.

## Releasing

- `npm run dist`, then attach the installer to a GitHub release **twice**: once as `Shorts-Studio-Setup-<version>.exe`, and once as
  `Shorts-Studio-Setup.exe`. The byttenapple.com download button always points to the latest release's `Shorts-Studio-Setup.exe`.
- Then bump `SHORTS_STUDIO_VERSION` in gartic-gallery `src/lib/shorts-studio-release.ts`.

## Testing without the real platforms

`scripts/publish-mock.cjs` has stand-in Google, YouTube, TikTok and broker servers that follow the real protocols.

- `electron scripts/test-publish.cjs` tests the posting engine.
- `electron scripts/test-posting-ui.cjs <folder>` clicks through the real Upload dialog and Settings.

`SHORTS_STUDIO_PLATFORMS` (JSON) points the app at any servers you like.
