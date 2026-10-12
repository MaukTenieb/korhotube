# KorhoTube

KorhoTube lists the videos of a YouTube channel as JSON, with tags, hashtags, chapters, audio tracks, subtitles, dates, views, likes and category. KorhoTube queries YouTube's InnerTube endpoint directly.

KorhoTube asks YouTube the way youtube.com itself does: the InnerTube `browse` endpoint, page after page, through the channel's uploads playlist until it ends. The RSS feed lists the latest 15 videos; KorhoTube pages through the uploads playlist to its end. Exact publication dates come from the RSS feed for those 15; older videos keep YouTube's relative date (`3 years ago`).

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

Three sources, each used when it answers; `sources` in the output says which did, and nothing is filled in when one is silent.

| Source | Answers from | Gives |
|---|---|---|
| InnerTube `next` | anywhere, servers included | `title`, `description`, `date`, `views`, `likes`, `chapters` (YouTube's markers, else the timecodes written in the description; `chaptersFrom` says which), `hashtags`, `channel` |
| The watch page's player data | home connections (servers get YouTube's bot check: `playerBlocked`) | `tags`, `category`, exact `published` and `uploaded` dates, `audio` (dubbing: one track per language), `subtitles`, `seconds`, `countries` |
| YouTube Data API (optional key: `YT_KEY`) | anywhere | `tags`, `category`, `language`, `audioLanguage`, `captions` (yes/no) |

On a home computer, `node cli.mjs @handle --details` reads InnerTube and the player data, and the Data API when `YT_KEY` holds a key. On a server or in the Worker, the player data is refused; add a free Data API key (`YT_KEY`) to get tags and category back. Audio tracks and subtitle lists only come from the player data.

## Cloudflare Worker (free plan)

1. dash.cloudflare.com → Workers & Pages → Create → Worker → Deploy, then Edit code.
2. Paste `korhotube.mjs` in place of the sample, then Deploy.
3. Optional: Settings → Variables → `ALLOWED_ORIGINS` = `https://you.github.io` (comma-separated), so only your sites spend your quota; `YT_KEY` = a YouTube Data API key, for tags and category.

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
## Provenance

Built for [Insert Koin](https://mauktenieb.github.io/insertkoin/), Mauk Tenieb's Korhogo world, games and machines in a browser: it feeds its VHS deck.

Other tools by Mauk Tenieb: [Detour](https://github.com/MaukTenieb/detour): cuts portrait sheets into sprite strips and places the eye lights · [FaunaTor](https://github.com/MaukTenieb/faunator): reads web and .onion pages through Tor clients that run in the page · [Reporhogo](https://github.com/MaukTenieb/reporhogo): searches forty-one code forges for a topic and lists the repositories it finds · [Photofauna](https://github.com/MaukTenieb/Photofauna): a photo editor with 44 looks, part of Insert Koin · [TorView](https://github.com/MaukTenieb/torview): a desktop browser in Go that routes its traffic through the official Tor daemon.

Index of Mauk Tenieb's sites: https://mauktenieb.github.io/
<!-- network:end -->

## License

MIT. Made for the VHS deck of [Insert Koin](https://mauktenieb.github.io/insertkoin/).
