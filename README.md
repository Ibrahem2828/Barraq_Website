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
css/style.css        Shared stylesheet (design tokens + components).
js/main.js           Shared script: theme toggle, scroll-reveal, the
                      "which character are you" quiz, the waitlist demo form.
assets/characters/   Optimized WebP character art (see "Asset sourcing").
assets/logo/         Logo + generated favicons.
robots.txt, sitemap.xml
```

Two real pages (not a client-side language toggle over one page) so each
language is independently crawlable and indexable, with reciprocal
`hreflang` tags — this was an explicit follow-up recommendation from the
first version of this site (a single-file prototype published as a Claude
Artifact) once real SEO mattered, not just a demo.

## Asset sourcing — real content, not placeholders

Every color, image, and line of copy here was pulled from real project
material, not invented:

- **Colors** — sampled from the actual character renders and the logo mark:
  Fahes `#2E7FBE`, Khota `#A6392A`, Rasheed `#2F7A3B`, Sada `#623793`,
  Kholasa `#B23A5C`, plus the logo's gold star as the shared accent
  `#E8A025`. Dark-mode variants are lightened versions of the same hues.
- **Character art** — sourced from `Baraq-App/src/assets/characters/*`,
  the same PNGs the mobile app ships. Several "pose" filenames in that
  folder are byte-identical to `_full` (confirmed via MD5 — a pre-existing
  asset gap, not something this site introduced); only `fahes` (`happy`),
  `sada` (`happy`), and `kholasa` (`summary`) had a genuinely distinct second
  pose, so only those three character cards do a hover image-swap. `khota`
  and `rasheed` show one pose with a hover lift/glow instead of a fake swap
  — ask the design team for real alternate poses if that swap matters later.
- **Logo** — `Baraq-App/src/assets/logos/logo_baraq_{light,dark,icon}.png`.
- **Team names/roles, copy, quiz questions** — carried over verbatim from
  the first Artifact version of this site (which itself was built from the
  account's feature form, technical assessment, and readiness spec).

### Re-generating the optimized image assets

The source PNGs are ~1.2–1.9MB each (1254×1254, several with a near-white
background needing removal). This repo ships only the processed output
(`assets/characters/*/{full,alt}.webp`, ~20–35KB each; `assets/logo/*.webp`
+ generated favicon PNGs) — regenerate them from the source assets with
Pillow if the source art changes:

```python
# flood-fills a near-white background transparent (BFS from the four
# corners, so it doesn't eat white pixels *inside* the character, like
# eyes), then resizes to a sane display size and saves as WebP.
# See git history of this README for the exact script used.
```

## Positioning: pre-launch, on purpose

The project's own readiness review (4 Sep 2026) put it at 60–80% ready
depending on the section, with an explicit no-go for any public launch.
So this site deliberately has no fake "download now" buttons or invented
user counts — it's a honest "in development, join the waitlist" page, and
says so in a small transparency badge in the About section.

**The waitlist form does not save anything yet.** It only shows a success
message locally (see `js/main.js`, `waitlistForm` handler). Wire it to a
real service (Google Forms, Mailchimp, a simple serverless endpoint, etc.)
before sharing this URL publicly — and add a real privacy policy first,
since the target audience includes minors (high-school students, 14–18).

## Before a real public launch — priority order

1. **Wire the waitlist form** to an actual email/CRM service.
2. **Add a real privacy policy** page/link (minors in the audience — this
   was flagged by the readiness spec itself, not just this README).
3. **Update the "in development" badge** in the About section as the
   platform's real readiness percentage changes.
4. Re-generate character art from real transparent-PNG sources if the
   design team provides them, instead of the flood-fill cleanup used here.
5. Consider: a live build-progress badge tied to real internal reports; a
   real short Sada voice-to-text mini demo in-browser; a dynamic OG-image
   generator per quiz result; a small parents/schools explainer page.

## Performance

No external JS libraries, no bundler. Total page weight (HTML+CSS+JS+all
images) is well under 500KB per language, versus ~2.3MB for the original
single-file artifact version (which embedded every image as base64).
Google Fonts is the only external dependency (two font families,
`font-display: swap`, preconnected).
