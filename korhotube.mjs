/* KorhoTube — all the videos of a YouTube channel, as JSON. No API key, no third-party relay.
   It asks YouTube the way youtube.com itself does (the "InnerTube" browse endpoint), page after page,
   until the channel's uploads playlist is exhausted. Exact dates come from the channel's RSS feed
   (the latest 15); older videos keep YouTube's relative date ("3 years ago").
   video(id) / videos(ids) add, for each video: description, tags, hashtags, category, exact publish and upload dates,
   views, likes, chapters (timecodes), subtitle tracks and audio tracks (dubbing).

   Works in a Cloudflare Worker (default export) and in Node 18+ (import { channel } from './korhotube.mjs').
   MIT License — https://github.com/MaukTenieb/korhotube */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8', 'Cookie': 'CONSENT=YES+1; SOCS=CAI' };

/* @handle, channel URL, /c/ or /user/ URL, or a UC… id → { id, name, handle, client } */
export async function resolve(input) {
  input = String(input || '').trim();
  let url;
  if (/^UC[\w-]{22}$/.test(input)) url = 'https://www.youtube.com/channel/' + input;
  else if (/^@[\w.\-·]+$/.test(input)) url = 'https://www.youtube.com/' + input;
  else if (/^https?:\/\/(www\.|m\.)?youtube\.com\//i.test(input)) url = input.replace(/\/(videos|shorts|streams|featured|about|playlists)\/?$/, '');
  else if (/^[\w.\-]+$/.test(input)) url = 'https://www.youtube.com/@' + input;
  else throw new Error('not a channel: ' + input);
  const r = await fetch(url, { headers: H, redirect: 'follow' });
  if (!r.ok) throw new Error('channel page: HTTP ' + r.status);
  const html = await r.text();
  const id = (html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || html.match(/"channelId":"(UC[\w-]{22})"/) || [])[1];
  if (!id) throw new Error('no channel id found at ' + url);
  const name = unesc((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '');
  const handle = ((html.match(/"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/(@[^"]+)"/) || html.match(/"canonicalBaseUrl":"\/(@[^"]+)"/) || [])[1]) || '';
  const client = {
    clientName: 'WEB',
    clientVersion: (html.match(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/) || [])[1] || '2.20241001.00.00',
    hl: 'en', gl: 'US'
  };
  const key = (html.match(/"INNERTUBE_API_KEY":"([\w-]+)"/) || [])[1] || '';
  return { id, name, handle: decodeURIComponent(handle), client, key };
}

async function browse(ch, body) {
  const u = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false' + (ch.key ? '&key=' + ch.key : '');
  const r = await fetch(u, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '1', 'X-Youtube-Client-Version': ch.client.clientVersion, 'Origin': 'https://www.youtube.com' },
    body: JSON.stringify({ context: { client: ch.client }, ...body }) });
  if (!r.ok) throw new Error('browse: HTTP ' + r.status);
  return r.json();
}

/* every video-like object, whatever renderer YouTube uses this month */
function collect(node, out, tokens) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node) collect(x, out, tokens); return; }
  const p = node.playlistVideoRenderer;
  if (p && p.videoId) {
    out.push({ id: p.videoId, title: text(p.title), seconds: p.lengthSeconds ? +p.lengthSeconds : null,
      length: text(p.lengthText), info: (p.videoInfo && p.videoInfo.runs || []).map(r => r.text).join('') });
    return;
  }
  const l = node.lockupViewModel;
  if (l && l.contentId && (l.contentType || '').includes('VIDEO')) {
    const m = l.metadata && l.metadata.lockupMetadataViewModel;
    const rows = (m && m.metadata && m.metadata.contentMetadataViewModel && m.metadata.contentMetadataViewModel.metadataRows) || [];
    const len = (JSON.stringify(l.contentImage || {}).match(/"text":"(\d{1,2}(?::\d{2}){1,2})"/) || [])[1] || '';
    out.push({ id: l.contentId, title: m && m.title && m.title.content || '', seconds: len ? len.split(':').reduce((a, b) => a * 60 + +b, 0) : null, length: len,
      info: rows.flatMap(r => (r.metadataParts || []).map(x => x.text && x.text.content || '')).filter(Boolean).join(' • ') });
    return;
  }
  const c = node.continuationCommand;
  if (c && c.token) tokens.push(c.token);
  for (const k in node) collect(node[k], out, tokens);
}
const text = t => !t ? '' : t.simpleText || (t.runs || []).map(r => r.text).join('') || '';
const unesc = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/* the latest 15, with exact dates */
async function rss(id) {
  try {
    const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + id, { headers: H });
    if (!r.ok) return {};
    const x = await r.text(), d = {};
    for (const m of x.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>[\s\S]*?<published>([^<]+)<\/published>/g)) d[m[1]] = m[2];
    return d;
  } catch (e) { return {}; }
}

/* the whole channel */
export async function channel(input, { limit = 5000 } = {}) {
  const ch = await resolve(input);
  const videos = [], seen = new Set();
  let tokens = [], page = 0;
  const first = await browse(ch, { browseId: 'VLUU' + ch.id.slice(2) });
  collect(first, videos, tokens);
  while (tokens.length && videos.length < limit && page < 200) {
    const t = tokens.pop(); tokens = [];
    const next = await browse(ch, { continuation: t });
    collect(next, videos, tokens); page++;
  }
  const dates = await rss(ch.id);
  const list = [];
  for (const v of videos) {
    if (seen.has(v.id)) continue; seen.add(v.id);
    list.push({ ...v, url: 'https://www.youtube.com/watch?v=' + v.id, thumb: 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg', published: dates[v.id] || null });
    if (list.length >= limit) break;
  }
  return { channel: { id: ch.id, name: ch.name, handle: ch.handle, url: 'https://www.youtube.com/channel/' + ch.id }, count: list.length, fetched: new Date().toISOString(), videos: list };
}


/* ---- one video, in detail: everything the watch page carries ----
   title, description, tags (keywords), hashtags, category, exact publish and upload dates, length, views, likes,
   live or not, family-safe, countries, chapters (YouTube's own, else timecodes found in the description),
   subtitle tracks, and audio tracks (dubbing: one per language when the creator added them). */
function jsonAfter(html, marker) {
  const i = html.indexOf(marker); if (i < 0) return null;
  let j = html.indexOf('{', i), depth = 0, inStr = false, esc = false;
  for (let k = j; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { if (--depth === 0) { try { return JSON.parse(html.slice(j, k + 1)); } catch (e) { return null; } } }
  }
  return null;
}
function find(node, key, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const x of node) find(x, key, out); return out; }
  if (key in node) out.push(node[key]);
  for (const k in node) find(node[k], key, out);
  return out;
}
const hms = s => { const p = String(s).split(':').map(Number); return p.reduce((a, b) => a * 60 + b, 0); };
function timecodes(desc) {
  const out = [];
  for (const line of String(desc || '').split('\n')) {
    const m = line.match(/(?:^|[\s(\[])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=[\s)\]\-–—:.|]|$)/);
    if (!m) continue;
    const title = line.replace(m[1], '').replace(/^[\s\-–—:.|()\[\]]+|[\s\-–—:.|()\[\]]+$/g, '').trim();
    out.push({ start: hms(m[1]), time: m[1], title });
  }
  return out.length >= 2 ? out : [];
}
const CATS = { 1: 'Film & Animation', 2: 'Autos & Vehicles', 10: 'Music', 15: 'Pets & Animals', 17: 'Sports', 19: 'Travel & Events', 20: 'Gaming', 22: 'People & Blogs', 23: 'Comedy', 24: 'Entertainment', 25: 'News & Politics', 26: 'Howto & Style', 27: 'Education', 28: 'Science & Technology', 29: 'Nonprofits & Activism' };
const isoDay = t => { const d = new Date(String(t || '').replace(/^(Premiered|Streamed live on|Started streaming on)\s+/i, '') + ' UTC'); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
async function nextData(id, version) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: version || '2.20241001.00.00', hl: 'en', gl: 'US' } }, videoId: id }) });
  if (!r.ok) throw new Error('next: HTTP ' + r.status);
  return r.json();
}
/* One video, in detail. Three sources, each used when it answers:
   1. InnerTube "next" (answers from anywhere, servers included): title, description, date, views, likes, chapters, hashtags.
   2. The watch page's player data (answers from home connections; servers get a bot check): tags, category,
      exact publish and upload dates, audio tracks (dubbing), subtitle tracks, length, countries.
   3. The YouTube Data API, if a key is given ({ key } or env YT_KEY): tags, category, languages, caption flag.
   `sources` says which answered; nothing is invented when one is silent. */
export async function video(id, { key } = {}) {
  if (!/^[\w-]{11}$/.test(id)) throw new Error('not a video id: ' + id);
  const v = { id, url: 'https://www.youtube.com/watch?v=' + id, sources: [] };
  // 1. next
  try {
    const n = await nextData(id);
    const raw = JSON.stringify(n);
    const pri = find(n, 'videoPrimaryInfoRenderer')[0] || {}, sec = find(n, 'videoSecondaryInfoRenderer')[0] || {};
    v.title = text(pri.title) || null;
    const ad = sec.attributedDescription || (find(n, 'attributedDescriptionBodyText')[0]);
    v.description = (ad && ad.content) || text(sec.description) || '';
    v.date = isoDay(text(pri.dateText)); v.dateText = text(pri.dateText) || null;
    const vc = find(n, 'videoViewCountRenderer')[0];
    const views = vc && (text(vc.originalViewCount) || text(vc.viewCount));
    v.views = views ? +String(views).replace(/[^\d]/g, '') || null : null;
    v.likes = ((raw.match(/along with ([\d,.]+) other/) || [])[1] || '').replace(/,/g, '') || null;
    const owner = find(n, 'videoOwnerRenderer')[0];
    v.channel = { id: owner && owner.navigationEndpoint && owner.navigationEndpoint.browseEndpoint && owner.navigationEndpoint.browseEndpoint.browseId || null, name: owner ? text(owner.title) : null };
    let chapters = [];
    for (const it of find(n, 'macroMarkersListItemRenderer')) {
      const t = it.onTap && it.onTap.watchEndpoint && it.onTap.watchEndpoint.startTimeSeconds;
      if (t != null) chapters.push({ start: t, time: text(it.timeDescription), title: text(it.title) });
    }
    const seenT = new Set(); chapters = chapters.filter(c => !seenT.has(c.start) && seenT.add(c.start));
    const fromDesc = timecodes(v.description);
    v.chapters = chapters.length ? chapters : fromDesc; v.chaptersFrom = chapters.length ? 'youtube' : (fromDesc.length ? 'description' : null);
    v.hashtags = [...new Set([...(v.description.match(/#[\p{L}\p{N}_]{2,60}/gu) || []), ...find(pri, 'superTitleLink').flatMap(x => (x.runs || []).map(r => r.text.trim())).filter(t => t.startsWith('#'))])];
    v.sources.push('next');
  } catch (e) { v.nextError = String(e.message || e); }
  // 2. watch page player data
  try {
    const r = await fetch('https://www.youtube.com/watch?v=' + id + '&hl=en&gl=US&has_verified=1', { headers: H });
    const html = await r.text();
    const pr = jsonAfter(html, 'ytInitialPlayerResponse = ') || {};
    const vd = pr.videoDetails, mf = pr.microformat && pr.microformat.playerMicroformatRenderer;
    if (vd && vd.videoId) {
      v.tags = vd.keywords || []; v.seconds = vd.lengthSeconds ? +vd.lengthSeconds : null; v.live = !!vd.isLiveContent;
      if (!v.description) v.description = vd.shortDescription || '';
      if (!v.title) v.title = vd.title;
      if (v.views == null && vd.viewCount) v.views = +vd.viewCount;
      if (mf) { v.category = mf.category || null; v.published = mf.publishDate || null; v.uploaded = mf.uploadDate || null; v.familySafe = mf.isFamilySafe !== false; v.unlisted = !!mf.isUnlisted; v.countries = mf.availableCountries ? mf.availableCountries.length : null; }
      const audio = new Map();
      for (const f of (pr.streamingData && pr.streamingData.adaptiveFormats) || []) { const a = f.audioTrack; if (a && a.id && !audio.has(a.id)) audio.set(a.id, { id: a.id, name: a.displayName, default: !!a.audioIsDefault }); }
      const capR = (pr.captions && pr.captions.playerCaptionsTracklistRenderer) || {};
      for (const a of capR.audioTracks || []) if (a.audioTrackId && !audio.has(a.audioTrackId)) audio.set(a.audioTrackId, { id: a.audioTrackId, name: '', default: false });
      v.audio = [...audio.values()];
      v.subtitles = (capR.captionTracks || []).map(c => ({ lang: c.languageCode, name: text(c.name), auto: c.kind === 'asr' }));
      v.sources.push('player');
    } else v.playerBlocked = (pr.playabilityStatus && pr.playabilityStatus.reason) || 'no player data';
  } catch (e) { v.playerBlocked = String(e.message || e); }
  // 3. Data API
  key = key || (typeof process !== 'undefined' && process.env && process.env.YT_KEY) || '';
  if (key && !v.sources.includes('player')) {
    try {
      const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=' + id + '&key=' + key);
      const it = ((await r.json()).items || [])[0];
      if (it) {
        const sn = it.snippet || {};
        v.tags = sn.tags || []; v.category = CATS[sn.categoryId] || sn.categoryId || null;
        v.published = sn.publishedAt || v.published || null; v.language = sn.defaultLanguage || null; v.audioLanguage = sn.defaultAudioLanguage || null;
        v.captions = (it.contentDetails || {}).caption === 'true';
        const st = it.statistics || {}; if (v.views == null && st.viewCount) v.views = +st.viewCount; if (!v.likes && st.likeCount) v.likes = st.likeCount;
        v.sources.push('api');
      }
    } catch (e) { v.apiError = String(e.message || e); }
  }
  if (!v.published && v.date) v.published = v.date;
  return v;
}
/* details for many videos, a few at a time */
export async function videos(ids, { concurrency = 4, onEach, key } = {}) {
  const out = new Array(ids.length); let i = 0;
  async function worker() { while (i < ids.length) { const k = i++; try { out[k] = await video(ids[k], { key }); } catch (e) { out[k] = { id: ids[k], error: String(e.message || e) }; } if (onEach) onEach(k, out[k]); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}

/* ---- Cloudflare Worker: GET /?channel=@handle[&limit=N]  ·  GET /?video=ID[,ID…] (40 at most: the free plan allows 50 fetches per request) ----
   Set ALLOWED_ORIGINS (comma-separated) in the Worker's variables to keep your quota for your own sites;
   leave it empty to answer everyone. Answers are cached at the edge for an hour. */
export default {
  async fetch(req, env, ctx) {
    const allowed = String((env && env.ALLOWED_ORIGINS) || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    const ok = !allowed.length || allowed.includes(origin);
    const cors = { 'Access-Control-Allow-Origin': allowed.length ? (ok ? origin : allowed[0]) : '*', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    if (origin && !ok) return new Response('{"error":"origin not allowed"}', { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    const u = new URL(req.url), q = u.searchParams.get('channel'), vq = u.searchParams.get('video');
    if (vq) {
      const ids = vq.split(',').filter(x => /^[\w-]{11}$/.test(x)).slice(0, 40);
      const data = ids.length === 1 ? await video(ids[0], { key: env && env.YT_KEY }).catch(e => ({ id: ids[0], error: String(e.message || e) })) : await videos(ids, { key: env && env.YT_KEY });
      return new Response(JSON.stringify(data), { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (!q) return new Response('{"usage":"?channel=@handle&limit=500 or ?video=ID,ID"}', { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    const cache = typeof caches !== 'undefined' ? caches.default : null, key = new Request(u.origin + '/?channel=' + encodeURIComponent(q.toLowerCase()) + '&limit=' + (u.searchParams.get('limit') || ''));
    if (cache) { const hit = await cache.match(key); if (hit) { const r = new Response(hit.body, hit); Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v)); return r; } }
    try {
      const data = await channel(q, { limit: Math.min(5000, +u.searchParams.get('limit') || 5000) });
      const res = new Response(JSON.stringify(data), { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
      if (cache && ctx) ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }
};
