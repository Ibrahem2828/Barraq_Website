# Baraq marketing site

A self-contained, static "coming soon" site for Baraq (براق) — no build step, no
framework, no external JS libraries. Deploy by copying this folder as-is to
any static host or the same VPS the rest of the platform runs on (behind
Caddy/nginx, exactly like the ops guide's `HOST_PORT` pattern used for the
other services — this one just needs a static file root, not a container).

## Structure

```
index.html          Thin client-side redirector -> /ar/ or /en/ by browser
                     language, with hreflang tags + noscript links so
                     crawlers and no-JS visitors still reach real content.
ar/index.html        Canonical Arabic page (RTL).
en/index.html        Canonical English page (LTR).
css/style.css        Shared stylesheet (design tokens + components + 3D tilt).
js/config.js         The one thing to edit when the backend domain changes.
js/main.js           Loading screen, theme toggle, scroll-reveal, pseudo-3D
                      pointer tilt, the "which character are you" quiz, and
                      the real waitlist form (calls the Django backend).
assets/characters/   Optimized WebP character art (see "Asset sourcing").
assets/logo/         Logo marks + generated favicons.
robots.txt, sitemap.xml
```

Two real pages (not a client-side language toggle over one page) so each
language is independently crawlable and indexable, with reciprocal
`hreflang` tags.

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
cluster and the wordmark) next to a plain `<span>براق</span>` text label —
one asset, no theme-dependent swap, and the brand name is actually
readable. The full icon+wordmark lockup (`assets/logo/wordmark.webp`) is
still used at hero size, where the text is large enough to read, with a
gentle pulse animation.

### Re-generating the optimized image assets

The source PNGs are ~1.2–1.9MB each (1254×1254, white or near-navy
background needing removal). This repo ships only the processed output
(`assets/characters/*/{full,alt}.webp`, ~20–40KB each; `assets/logo/*.webp`
+ generated favicon PNGs) — regenerate them from `image/<character>/*.png`
with Pillow if the source art changes (BFS flood-fill from the four
corners using the image's *actual* background color, not an assumed one —
see the bug above for why that distinction matters; then resize + save as
WebP).

## Waitlist: real backend, not a demo

The waitlist form posts to the Django backend's `apps/waitlist` app
(`Baraaq_back/backend/apps/waitlist/`) — real Postgres storage, not a
`.xlsx` file written directly by the request (concurrent writes to a
shared spreadsheet aren't safe under multiple gunicorn workers). It
collects **name + email**, and exposes a live subscriber count the site
displays as an animated social-proof counter.

**Exporting to Excel**: Django admin -> Waitlist entries -> select rows (or
"select all") -> action "Export selected as Excel" -> downloads a
formatted `.xlsx` (bold header row, frozen top row, filter dropdowns,
sized columns) with Name / Email / Locale / Source / Joined At. This is
the "professional Excel export" deliverable, layered on top of the real
database rather than replacing it.

`js/config.js` holds the one thing that needs to match the deployed
backend: `API_BASE_URL`. The backend also needs this site's own origin
added to `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` (see
`Baraaq_back/backend/.env.example`) — without that, the browser blocks the
response even though the request itself reaches Django fine.

If the backend is unreachable (not deployed yet, CORS misconfigured, ...)
the form shows a friendly inline error instead of a fake "success", and the
counter just stays hidden instead of showing a stale/zero number.

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

No external JS libraries, no bundler. Total page weight (HTML+CSS+JS+all
images) is roughly 1.2MB including the full-resolution wordmark and every
character's two poses — still far below the ~2.3MB original single-file
artifact version (which embedded every image as base64, at lower quality).
Google Fonts is the only external dependency (two font families,
`font-display: swap`, preconnected).
