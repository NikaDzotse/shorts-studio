"use strict";
// Twitch without developer keys: the public GraphQL the Twitch website itself uses (the same client id the web player
// sends). It's not an official API, so Twitch could change it; everything that uses it fails softly.
const fs = require("fs");
const path = require("path");
const P = require("./paths.cjs");

const GQL = "https://gql.twitch.tv/gql", CLIENT = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const CHAT_HASH = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a";   // VideoCommentsByOffsetOrCursor
async function gql(query, variables = {}) {
  const r = await fetch(GQL, { method: "POST", headers: { "Client-Id": CLIENT, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error("Twitch said " + r.status);
  const j = await r.json();
  if (j.errors && !j.data) throw new Error("Twitch: " + j.errors.map((e) => e.message).join(", "));
  return j.data;
}

const PERIODS = { day: "LAST_DAY", week: "LAST_WEEK", month: "LAST_MONTH", all: "ALL_TIME" };
const clipOf = (n, login) => ({ slug: n.slug, title: n.title || "Clip", createdAt: n.createdAt, views: n.viewCount || 0, duration: n.durationSeconds || 0,
  by: (n.curator && n.curator.displayName) || "", thumb: n.thumbnailURL || "", url: `https://clips.twitch.tv/${n.slug}`, channel: login });

// a channel's clips, most viewed first
async function channelClips(login, range = "week", first = 60) {
  const d = await gql(`query($login: String!, $first: Int!, $period: ClipsPeriod) { user(login: $login) { login displayName
    clips(first: $first, criteria: { period: $period, sort: VIEWS_DESC }) { edges { node { slug title createdAt viewCount durationSeconds curator { displayName } thumbnailURL } } } } }`,
  { login: login.toLowerCase(), first, period: PERIODS[range] || "LAST_WEEK" });
  if (!d.user) throw new Error(`There's no Twitch channel called "${login}"`);
  return d.user.clips.edges.map((e) => clipOf(e.node, d.user.login));
}
// one clip, with where it sits in its VOD (for the chat)
async function clip(slug) {
  const d = await gql(`query($slug: ID!) { clip(slug: $slug) { slug title createdAt viewCount durationSeconds videoOffsetSeconds thumbnailURL
    video { id createdAt } broadcaster { login displayName } curator { displayName } } }`, { slug });
  if (!d.clip) throw new Error("Twitch doesn't know that clip (deleted, or a typo in the link?)");
  const c = d.clip;
  return { ...clipOf(c, c.broadcaster ? c.broadcaster.login : ""), channelName: c.broadcaster ? c.broadcaster.displayName : "",
    videoId: c.video ? c.video.id : null, videoOffset: c.videoOffsetSeconds ?? null };
}
// "https://clips.twitch.tv/Slug", "twitch.tv/channel/clip/Slug?..." or the bare slug
function slugFrom(text) {
  const t = String(text || "").trim();
  const m = /clips\.twitch\.tv\/(?:embed\?clip=)?([A-Za-z0-9_-]+)/.exec(t) || /twitch\.tv\/[^/]+\/clip\/([A-Za-z0-9_-]+)/.exec(t);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null;
}

// the chat under a stretch of a VOD: [{ rel (seconds from `from`), login, name, color, text, parts, role }]
async function vodChat(videoId, from, to) {
  const out = []; let vars = { videoID: videoId, contentOffsetSeconds: Math.max(0, Math.floor(from) - 2) };
  for (let page = 0; page < 20; page++) {
    const r = await fetch(GQL, { method: "POST", headers: { "Client-Id": CLIENT },
      body: JSON.stringify([{ operationName: "VideoCommentsByOffsetOrCursor", variables: vars, extensions: { persistedQuery: { version: 1, sha256Hash: CHAT_HASH } } }]) });
    const c = (await r.json())[0]?.data?.video?.comments;
    if (!c || !c.edges.length) break;
    for (const { node: n } of c.edges) {
      const at = n.contentOffsetSeconds;
      if (at < from || at > to || !n.commenter) continue;
      const badges = (n.message.userBadges || []).map((b) => b.setID);
      out.push({ rel: +(at - from).toFixed(2), login: n.commenter.login, name: n.commenter.displayName, color: n.message.userColor || "",
        text: n.message.fragments.map((f) => f.text).join(""),
        parts: n.message.fragments.map((f) => f.emote ? { e: `https://static-cdn.jtvnw.net/emoticons/v2/${f.emote.emoteID}/default/dark/2.0`, n: f.text } : { t: f.text }),
        role: badges.includes("broadcaster") ? 4 : badges.includes("moderator") ? 3 : badges.includes("vip") ? 2 : 1 });
    }
    const last = c.edges[c.edges.length - 1];
    if (last.node.contentOffsetSeconds > to || !c.pageInfo?.hasNextPage) break;
    vars = { videoID: videoId, cursor: last.cursor };
  }
  return out;
}

// the channel's own emotes, saved as pictures for stickers (library\emotes)
async function emotes(login) {
  const d = await gql(`query($login: String!) { user(login: $login) { subscriptionProducts { emotes { id token } } } }`, { login: login.toLowerCase() });
  const list = (d.user && d.user.subscriptionProducts || []).flatMap((p) => p.emotes || []);
  const dir = path.join(P.LIBRARY, "emotes"); fs.mkdirSync(dir, { recursive: true });
  let got = 0;
  for (const e of list) {
    const to = path.join(dir, e.token.replace(/[^A-Za-z0-9_-]/g, "_") + ".png");
    if (fs.existsSync(to)) continue;
    const r = await fetch(`https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/static/dark/3.0`);
    if (r.ok) { fs.writeFileSync(to, Buffer.from(await r.arrayBuffer())); got++; }
  }
  return { found: list.length, added: got };
}

module.exports = { gql, channelClips, clip, slugFrom, vodChat, emotes };
