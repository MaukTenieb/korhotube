# KorhoTube

All the videos of a YouTube channel, as JSON, with every detail: tags, hashtags, chapters (timecodes), dubbing (audio tracks), subtitles, exact dates, views, likes, category. No API key, no third-party relay.

KorhoTube asks YouTube the way youtube.com itself does: the InnerTube `browse` endpoint, page after page, through the channel's uploads playlist until it ends. The RSS feed only gives the latest 15; KorhoTube gives all of them. Exact publication dates come from the RSS feed for those 15; older videos keep YouTube's relative date (`3 years ago`).

One file, `korhotube.mjs`, runs in two places:

## Command line (Node 18+)

```
node cli.mjs @handle                      # the whole channel, JSON
node cli.mjs @handle --details            # … and every detail of every video
node cli.mjs @handle --details --csv      # the same as CSV
node cli.mjs https://www.youtube.com/channel/UC… --limit 100
node cli.mjs dQw4w9WgXcQ                  # one video in detail
```

## Details per video

From the watch page (`ytInitialPlayerResponse`, `ytInitialData`):

| Field | Source |
|---|---|
| `description`, `tags`, `seconds`, `views`, `live` | `videoDetails` |
| `published`, `uploaded`, `category`, `familySafe`, `unlisted`, `countries` | `microformat` |
| `chapters` | YouTube's chapter markers; otherwise the timecodes written in the description (`chaptersFrom` says which) |
| `audio` | audio tracks: one per language when the video is dubbed (`id`, `name`, `default`) |
| `subtitles` | subtitle tracks (`lang`, `name`, `auto` for automatic captions) |
| `likes`, `hashtags` | page data |

## Cloudflare Worker (free plan)

1. dash.cloudflare.com → Workers & Pages → Create → Worker → Deploy, then Edit code.
2. Paste `korhotube.mjs` in place of the sample, then Deploy.
3. Optional: Settings → Variables → `ALLOWED_ORIGINS` = `https://you.github.io` (comma-separated), so only your sites spend your quota.

```
GET https://korhotube.<you>.workers.dev/?channel=@handle&limit=500
GET https://korhotube.<you>.workers.dev/?video=ID,ID,ID        (40 at most per call)
```

The free plan allows 50 outgoing requests per call: list the channel first, then ask for details in batches of 40.

Answers carry CORS headers, so a web page can call the Worker directly; they are cached at the edge for an hour.

## Output

```json
{
  "channel": { "id": "UC…", "name": "…", "handle": "@…", "url": "https://www.youtube.com/channel/UC…" },
  "count": 244,
  "fetched": "2026-10-10T05:41:00.000Z",
  "videos": [
    { "id": "…", "title": "…", "seconds": 213, "length": "3:33", "info": "1.2K views • 2 years ago",
      "url": "https://www.youtube.com/watch?v=…", "thumb": "https://i.ytimg.com/vi/…/hqdefault.jpg", "published": "2026-09-30T18:00:00+00:00" }
  ]
}
```

## Is it still working?

`.github/workflows/check.yml` runs KorhoTube against real channels every day and writes the result to `check/`. If YouTube changes its pages, the check turns red.

## Limits

- Public videos only: no members-only, private or unlisted videos.
- YouTube can change its internal format at any time; the parser looks for any video-like object rather than one fixed path, which absorbs most changes.
- Respect YouTube's terms of service and the creators' rights. KorhoTube lists videos; it does not download them.

<!-- network:start -->
## Mauk Tenieb on GitHub

- [mauktenieb.github.io](https://mauktenieb.github.io/): Start here: every site and link.
- [katabase](https://github.com/MaukTenieb/katabase) · [site](https://mauktenieb.github.io/katabase): Korhogo Fauna: concept albums, 18 avatars, lore.
- [insertkoin](https://github.com/MaukTenieb/insertkoin) · [site](https://mauktenieb.github.io/insertkoin/): Insert Koin, the browser arcade: Puck You!, Fauna Chess, Erratik, Faunarratik, Katabatik.
- [3615](https://github.com/MaukTenieb/3615) · [site](https://mauktenieb.github.io/3615/): 3615 KORHOGO, a Minitel terminal in the browser.
- [korhogo](https://github.com/MaukTenieb/korhogo) · [site](https://mauktenieb.github.io/korhogo/): The first Korhogo site.
- [reporhogo](https://github.com/MaukTenieb/reporhogo) · [site](https://mauktenieb.github.io/reporhogo/): One topic, forty-one code forges (MIT).
- [Photofauna](https://github.com/MaukTenieb/Photofauna) · [site](https://mauktenieb.github.io/insertkoin/fotofauna.html): The pocket photo emulator.
- [detour](https://github.com/MaukTenieb/detour): Cuts a sheet of eight portraits into a sprite strip (Python).
- [torview](https://github.com/MaukTenieb/torview) · [site](https://mauktenieb.github.io/torview/): Minimal Tor webview browser (Go).
- [faunator](https://github.com/MaukTenieb/faunator) · [site](https://mauktenieb.github.io/faunator/): Tor inside a web page: web and .onion, no extension (MIT).

Artist: https://github.com/MaukTenieb · Music and sales: https://mauktenieb.bandcamp.com · Journal: https://korhogo.substack.com · Bio: https://orcid.org/0009-0007-9096-8267
<!-- network:end -->

## License

MIT. Made for the VHS deck of [Insert Koin](https://mauktenieb.github.io/insertkoin/).
