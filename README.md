# Baraq marketing site

A self-contained "coming soon" site for Baraq (براق) with a tiny dependency-free
Node server for the local waitlist. There is no build step, framework, external
JavaScript library, database account, or third-party form service.

## Structure

```
index.html          Thin client-side redirector -> /ar/ or /en/ by browser
                     language, with hreflang tags + noscript links so
                     crawlers and no-JS visitors still reach real content.
404.html            Bilingual, responsive not-found page. Static hosting must
                     serve this file with the HTTP 404 status.
ar/index.html        Canonical Arabic page (RTL).
en/index.html        Canonical English page (LTR).
css/style.css        Shared stylesheet (design tokens + components + 3D tilt).
js/config.js         Same-origin waitlist API path and readiness percentage.
js/main.js           Loading screen, theme toggle, scroll-reveal, pseudo-3D
                      pointer tilt, the "which character are you" quiz, and
                      the real waitlist form.
server.js            Serves the site, custom 404, and local waitlist API.
data/waitlist.json   Created automatically on first start; readable records.
assets/characters/   Optimized WebP character art (see "Asset sourcing").
assets/logo/         Logo marks + generated favicons.
robots.txt, sitemap.xml
```

Two real pages (not a client-side language toggle over one page) so each
language is independently crawlable and indexable, with reciprocal
`hreflang` tags.

## Custom 404 on static hosting

`404.html` is the site-wide bilingual not-found page and must be returned
with the real HTTP `404` status. Hosts such as GitHub Pages and Netlify use
the file automatically. For nginx, add `error_page 404 /404.html;` inside
the site/server block. For Caddy, route error status 404 to `/404.html` in a
`handle_errors` block while keeping the response status unchanged.

## Asset sourcing — real content, not placeholders

Every color, image, and line of copy here was pulled from real project
material, not invented:

- **Colors** — sampled from the actual character renders and the logo mark:
  Fahes `#2E7FBE`, Khota `#A6392A`, Rasheed `#2F7A3B`, Sada `#623793`,
  Kholasa `#B23A5C`, plus the logo's gold star as the shared accent
  `#E8A025`. Dark-mode variants are lightened versions of the same hues.
- **Character art** — sourced from the top-level `image/<character>/` folder
  (Arabic-named subfolders), NOT `Baraq-App/src/assets/characters/*`. Both
  folders look similar, but the mobile app's copy has several pose filenames
  that are byte-identical to `_full` (confirmed via MD5) — a pre-existing
  asset-pipeline gap in that app, not something worth propagating here. The
  top-level `image/` folder has genuinely distinct art for every pose, so
  all five characters (not just three) now do a real hover pose-swap
  (calm -> happy), each processed with alpha-transparency background removal.
- **Logo** — `image/logo_baraq_{light,dark,icon}.png` (identical content to
  the `Baraq-App` copies, confirmed via MD5, except `logo_baraq_dark.png`
  differs byte-for-byte between the two folders though both render the same
  visually -- just different PNG re-encodes).
- **Team names/roles, copy, quiz questions** — carried over from the first
  Artifact version of this site, then revised per direct instructions (see
  "Positioning" below) and corrected for Ibrahim's/Muath's actual roles.

### Header logo bug (found + fixed)

The header originally swapped between two full icon+wordmark images
(`logo-on-light.webp` for light backgrounds, `logo-on-dark.webp` for dark)
based on the theme. Two real bugs made this look broken:

1. **The dark-background flood-fill used the wrong target color** (the
   page's CSS `--bg` value instead of the logo PNG's actual background
   pixel color), so `logo-on-dark.webp` never actually had its background
   removed — it rendered as a faint opaque square in dark mode.
2. Even fixed, the *wordmark text* inside either image is illegible at a
   34–42px header height (the full lockup is a tall icon-over-text square,
   so the text portion renders at a few px tall).

Fix: the header now uses a separate **icon-only crop** (`icon-only.webp`,
gems with no text, auto-cropped from the transparent gap between the gem
cluster and the wordmark) next to a plain text label — one asset, no
theme-dependent swap, and the brand name is actually readable. The hero
uses the same clean icon plus live text, which also removes the white edge
artifact that appeared inside the baked Arabic wordmark.

### Re-generating the optimized image assets

The source PNGs are ~1.2–1.9MB each (1254×1254, white or near-navy
background needing removal). This repo ships only the processed output
(`assets/characters/*/{full,alt}.webp`, ~20–40KB each; `assets/logo/*.webp`
+ generated favicon PNGs) — regenerate them from `image/<character>/*.png`
with Pillow if the source art changes (BFS flood-fill from the four
corners using the image's *actual* background color, not an assumed one —
see the bug above for why that distinction matters; then resize + save as
WebP).

## Waitlist: local readable storage

Run `npm start` from this folder, then open `http://127.0.0.1:4173/ar/`.
The form stores name, email, language, source, and join time in
`data/waitlist.json`. Open that file with any text editor to inspect the
records. Duplicate emails are not added twice.

The server serializes writes and replaces the JSON file atomically, limits
request size and repeated submissions, validates input, and keeps the entire
`data/` directory inaccessible over HTTP. The live subscriber count reads
from the same local file. `data/waitlist.json` is intentionally ignored by
Git so real email addresses cannot be committed accidentally.

For a VPS, run the Node process behind Caddy/nginx and set `HOST=0.0.0.0` plus
the desired `PORT`. Do not deploy this folder through a plain static file
server: static hosting cannot write waitlist records.

## Positioning: pre-launch, startup-backed, on purpose

The project's own readiness review (4 Sep 2026) put it at 60–80% ready
depending on the section, with an explicit no-go for any public launch.
So this site deliberately has no fake "download now" buttons or invented
user counts — it's an honest "in development, join the waitlist" page, and
says so in a small transparency badge in the About section.

Positioning language is "a startup backed by the Innovation Youth Team" (not
"a volunteer initiative") — applied consistently in the hero eyebrow, the
About paragraph, the footer, and the JSON-LD `publisher` name across both
languages, not just one spot.

## Before a real public launch — priority order

1. **Add a real privacy policy** page/link (minors in the audience — this
   was flagged by the readiness spec itself, not just this README).
2. **Update the "in development" badge** in the About section as the
   platform's real readiness percentage changes.
3. Consider: a live build-progress badge tied to real internal reports; a
   real short Sada voice-to-text mini demo in-browser; a dynamic OG-image
   generator per quiz result; a small parents/schools explainer page.

## Performance

No external JS libraries and no bundler. Total page weight (HTML+CSS+JS+all
images) is roughly 1.2MB including the logo assets and every
character's two poses — still far below the ~2.3MB original single-file
artifact version (which embedded every image as base64, at lower quality).
Google Fonts is the only external dependency (two font families,
`font-display: swap`, preconnected).
