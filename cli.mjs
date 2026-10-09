#!/usr/bin/env node
/* node cli.mjs @handle [--limit N] [--details] [--csv]  →  JSON (or CSV) on stdout
   node cli.mjs VIDEO_ID                                →  one video in detail */
import { channel, video, videos } from './korhotube.mjs';
const a = process.argv.slice(2), who = a.find(x => !x.startsWith('--'));
if (!who) { console.error('usage: node cli.mjs @handle|channel-url|UC… [--limit N] [--details] [--csv]   |   node cli.mjs VIDEO_ID'); process.exit(2); }
const li = a.indexOf('--limit'), limit = li >= 0 ? +a[li + 1] : 5000;
if (/^[\w-]{11}$/.test(who) && !who.startsWith('@') && !who.startsWith('UC')) { console.log(JSON.stringify(await video(who), null, 2)); process.exit(0); }
const d = await channel(who, { limit });
if (a.includes('--details')) {
  const det = await videos(d.videos.map(v => v.id), { onEach: k => process.stderr.write(`\r${k + 1}/${d.count}`) });
  process.stderr.write('\n');
  d.videos = d.videos.map((v, k) => ({ ...v, ...det[k], published: det[k] && det[k].published || v.published }));
}
if (a.includes('--csv')) {
  const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  console.log('id,title,length,published,views,likes,category,tags,chapters,audio,subtitles,url');
  for (const v of d.videos) console.log([v.id, v.title, v.length, v.published, v.views, v.likes, v.category, (v.tags || []).join('|'), (v.chapters || []).map(c => c.time + ' ' + c.title).join('|'), (v.audio || []).map(x => x.name || x.id).join('|'), (v.subtitles || []).map(x => x.lang).join('|'), v.url].map(q).join(','));
} else console.log(JSON.stringify(d, null, 2));
console.error(`${d.channel.name} (${d.channel.id}): ${d.count} videos`);
