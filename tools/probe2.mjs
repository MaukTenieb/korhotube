/* what the watch page still carries when the player is bot-walled: meta tags and microdata; and the subtitle list */
const id = process.argv[2] || 'aircAruvnKk';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.8', 'Cookie': 'CONSENT=YES+1; SOCS=CAI' };
const html = await (await fetch('https://www.youtube.com/watch?v=' + id + '&hl=en', { headers: H })).text();
const metas = [...html.matchAll(/<meta\s+(?:name|property|itemprop)="([^"]+)"\s+content="([^"]*)"/g)].map(m => [m[1], m[2].slice(0, 120)]);
const out = { metas };
for (const k of ['"keywords":[', '"category":"', '"publishDate":"', '"uploadDate":"', '"audioTrack"', '"captionTracks"', '"lengthSeconds":"', '"viewCount":"', '"shortDescription":"'])
  out['has ' + k] = html.includes(k);
for (const u of ['https://www.youtube.com/api/timedtext?type=list&v=' + id, 'https://video.google.com/timedtext?type=list&v=' + id]) {
  try { const r = await fetch(u, { headers: H }); const t = await r.text(); out[u.split('/')[2] + ' timedtext'] = { http: r.status, body: t.slice(0, 300) }; } catch (e) { out[u] = String(e); }
}
try { const r = await fetch('https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=' + id); out.oembed = r.status; } catch (e) {}
console.log(JSON.stringify(out, null, 1));
