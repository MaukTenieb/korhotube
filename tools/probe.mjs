/* which YouTube doors answer from a data-centre address, and with what */
const id = process.argv[2] || 'r-le2_wt3Tk';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8', 'Cookie': 'CONSENT=YES+1; SOCS=CAI' };
const out = {};
const w = await fetch('https://www.youtube.com/watch?v=' + id + '&hl=en&gl=US&has_verified=1&bpctr=9999999999', { headers: H });
const html = await w.text();
out.watch = { status: w.status, len: html.length, player: html.includes('ytInitialPlayerResponse'), data: html.includes('ytInitialData'), consent: /consent\.youtube|before you continue/i.test(html), bot: /not a bot|confirm you.re not/i.test(html), visitor: (html.match(/"VISITOR_DATA":"([^"]+)"/) || [])[1] ? 'yes' : 'no', title: (html.match(/<title>([^<]*)/) || [])[1] };
const ver = (html.match(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/) || [])[1] || '2.20241001.00.00';
const vis = (html.match(/"VISITOR_DATA":"([^"]+)"/) || [])[1];
const clients = {
  WEB: { clientName: 'WEB', clientVersion: ver },
  MWEB: { clientName: 'MWEB', clientVersion: '2.20241001.01.00' },
  WEB_EMBEDDED_PLAYER: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20241001.01.00' },
  TVHTML5_SIMPLY_EMBEDDED_PLAYER: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0' },
  ANDROID_VR: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', androidSdkVersion: 32 },
  IOS: { clientName: 'IOS', clientVersion: '19.45.4', deviceModel: 'iPhone16,2' },
  ANDROID: { clientName: 'ANDROID', clientVersion: '19.44.38', androidSdkVersion: 30 }
};
for (const [n, c] of Object.entries(clients)) {
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', ...(vis ? { 'X-Goog-Visitor-Id': vis } : {}) },
      body: JSON.stringify({ context: { client: { ...c, hl: 'en', gl: 'US', ...(vis ? { visitorData: vis } : {}) }, ...(n.includes('EMBED') ? { thirdParty: { embedUrl: 'https://www.youtube.com/' } } : {}) }, videoId: id, contentCheckOk: true, racyCheckOk: true }) });
    const j = await r.json();
    const vd = j.videoDetails || {}, mf = j.microformat && j.microformat.playerMicroformatRenderer;
    out[n] = { http: r.status, play: j.playabilityStatus && j.playabilityStatus.status, reason: j.playabilityStatus && j.playabilityStatus.reason, title: vd.title, keywords: (vd.keywords || []).length, desc: (vd.shortDescription || '').length,
      micro: !!mf, publish: mf && mf.publishDate, category: mf && mf.category, caps: ((j.captions && j.captions.playerCaptionsTracklistRenderer && j.captions.playerCaptionsTracklistRenderer.captionTracks) || []).length,
      formats: ((j.streamingData && j.streamingData.adaptiveFormats) || []).length, audioTracks: [...new Set(((j.streamingData && j.streamingData.adaptiveFormats) || []).map(f => f.audioTrack && f.audioTrack.displayName).filter(Boolean))] };
  } catch (e) { out[n] = { error: String(e) }; }
}
try {
  const r = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'en', gl: 'US', ...(vis ? { visitorData: vis } : {}) } }, videoId: id }) });
  const t = await r.text();
  out.next = { http: r.status, len: t.length, chapters: (t.match(/macroMarkersListItemRenderer/g) || []).length, desc: t.includes('attributedDescription') || t.includes('structuredDescription'), likes: (t.match(/along with ([\d,]+) other/) || [])[1] || null, date: (t.match(/"dateText":\{"simpleText":"([^"]+)"/) || [])[1] || null };
} catch (e) { out.next = { error: String(e) }; }
console.log(JSON.stringify(out, null, 2));
