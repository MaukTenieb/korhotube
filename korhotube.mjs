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
    out.push({ id: l.contentId, title: m && m.title && m.title.content || '', seconds: null, length: '',
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
export async function video(id) {
  if (!/^[\w-]{11}$/.test(id)) throw new Error('not a video id: ' + id);
  const r = await fetch('https://www.youtube.com/watch?v=' + id + '&hl=en&gl=US&has_verified=1', { headers: H });
  if (!r.ok) throw new Error('watch page: HTTP ' + r.status);
  const html = await r.text();
  const pr = jsonAfter(html, 'ytInitialPlayerResponse = ') || jsonAfter(html, 'ytInitialPlayerResponse=') || {};
  const id0 = jsonAfter(html, 'ytInitialData = ') || jsonAfter(html, 'ytInitialData=') || {};
  const vd = pr.videoDetails || {}, mf = (pr.microformat && pr.microformat.playerMicroformatRenderer) || {};
  const st = pr.playabilityStatus || {};
  // chapters: YouTube's own markers first
  let chapters = [];
  for (const it of find(id0, 'macroMarkersListItemRenderer')) {
    const t = it.onTap && it.onTap.watchEndpoint && it.onTap.watchEndpoint.startTimeSeconds;
    if (t != null) chapters.push({ start: t, time: text(it.timeDescription), title: text(it.title) });
  }
  if (!chapters.length) for (const c of find(id0, 'chapterRenderer'))
    chapters.push({ start: Math.round((c.timeRangeStartMillis || 0) / 1000), time: '', title: text(c.title) });
  const seenT = new Set(); chapters = chapters.filter(c => !seenT.has(c.start) && seenT.add(c.start));
  const fromDesc = timecodes(vd.shortDescription);
  // audio tracks (dubbing) and subtitles
  const audio = new Map();
  for (const f of (pr.streamingData && pr.streamingData.adaptiveFormats) || []) {
    const a = f.audioTrack; if (a && a.id && !audio.has(a.id)) audio.set(a.id, { id: a.id, name: a.displayName, default: !!a.audioIsDefault });
  }
  const capR = (pr.captions && pr.captions.playerCaptionsTracklistRenderer) || {};
  for (const a of capR.audioTracks || []) if (a.audioTrackId && !audio.has(a.audioTrackId)) audio.set(a.audioTrackId, { id: a.audioTrackId, name: '', default: false });
  const subtitles = (capR.captionTracks || []).map(c => ({ lang: c.languageCode, name: text(c.name), auto: c.kind === 'asr' }));
  // likes and hashtags, from the page data
  const raw = JSON.stringify(id0);
  const like = (raw.match(/along with ([\d,.]+) other/) || raw.match(/"([\d,.]+[KM]?) likes"/) || [])[1];
  const hashtags = [...new Set((raw.match(/"text":"(#[^"#\s]{2,60})"/g) || []).map(x => x.slice(8, -1)))].slice(0, 30);
  return {
    id, url: 'https://www.youtube.com/watch?v=' + id, status: st.status || 'OK',
    title: vd.title || text(mf.title), channel: { id: vd.channelId || mf.externalChannelId, name: vd.author || mf.ownerChannelName },
    description: vd.shortDescription || text(mf.description),
    tags: vd.keywords || [], hashtags, category: mf.category || null,
    published: mf.publishDate || null, uploaded: mf.uploadDate || null,
    seconds: vd.lengthSeconds ? +vd.lengthSeconds : null, views: vd.viewCount ? +vd.viewCount : null,
    likes: like ? like.replace(/,/g, '') : null,
    live: !!vd.isLiveContent, familySafe: mf.isFamilySafe !== false, unlisted: !!mf.isUnlisted,
    countries: mf.availableCountries ? mf.availableCountries.length : null,
    chapters: chapters.length ? chapters : fromDesc, chaptersFrom: chapters.length ? 'youtube' : (fromDesc.length ? 'description' : null),
    audio: [...audio.values()], subtitles,
    thumbnails: ((vd.thumbnail && vd.thumbnail.thumbnails) || []).map(t => t.url)
  };
}
/* details for many videos, a few at a time */
export async function videos(ids, { concurrency = 4, onEach } = {}) {
  const out = new Array(ids.length); let i = 0;
  async function worker() { while (i < ids.length) { const k = i++; try { out[k] = await video(ids[k]); } catch (e) { out[k] = { id: ids[k], error: String(e.message || e) }; } if (onEach) onEach(k, out[k]); } }
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
      const data = ids.length === 1 ? await video(ids[0]).catch(e => ({ id: ids[0], error: String(e.message || e) })) : await videos(ids);
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
