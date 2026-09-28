# Design brief — concept sites for southern NH small businesses

Each concept is a **pitch mockup**: a polished, modern one-page website we show a
business owner to say "here's what your site could look like." It must look like a
real, premium small-business site, not a template.

## Hard rules

1. **One self-contained file**: `sites/<slug>/index.html`. All CSS and JS inline.
   The only external resources allowed are Google Fonts (`fonts.googleapis.com`).
   Always include solid system-font fallbacks so it still looks good offline.
2. **No stock photos, no external images.** Build visuals with CSS, gradients,
   patterns and inline SVG illustrations (e.g. a barber pole, a loaf of bread, a
   Highland cow silhouette, a pizza slice). Quality illustrations are a big part of
   the wow factor. Where a real photo obviously belongs, use a tasteful styled
   placeholder block labelled e.g. "Your storefront photo here" — at most 2 per site.
3. **Only use the facts provided in the business data below.** Never invent prices,
   awards, staff names, years, addresses, or menu items. If something would normally
   have a price and we don't know it, omit the price. Hours/phone/address must be
   exactly as given.
4. **No fabricated testimonials.** Do not write quotes attributed to named or fake
   customers. Instead use a "What neighbors say" / "Review highlights" section with
   short *themes* (e.g. "Generous portions", "Friendly, quick service") and a small
   caption: "Themes from public reviews — we'll swap in your real customer quotes."
5. Add a subtle, tasteful fixed badge (bottom-left, small, dismissible with a ×):
   `Concept preview · designed by YOUR STUDIO` (the literal text `YOUR STUDIO`
   is a find-and-replace token). Footer also says:
   "Concept site prepared by YOUR STUDIO. Not the official website of <Business>."
6. Phone numbers are `tel:` links; addresses link to
   `https://www.google.com/maps/search/?api=1&query=<url-encoded address>`.
   Social links go to the provided Facebook/Instagram URLs.
7. `<title>`: `<Business Name> · <Town>, NH`. Include a meta description and a
   simple inline-SVG favicon (data URI).

## Design quality bar

- **A distinct visual identity per business** that fits its personality: palette,
  type pairing, illustration style, motifs. Two sites should never look like the same
  template recoloured. Suggested direction is given per business; improve on it.
- Strong typographic hierarchy, generous whitespace, 8px spacing rhythm, max content
  width ~1120–1200px, comfortable line length (~65ch) for body text.
- Palette defined as CSS custom properties on `:root`. Body text contrast ≥ 4.5:1.
- **Mobile-first and fully responsive**: must look great at 375px wide, no horizontal
  scroll, tap targets ≥ 44px. Sticky header with a compact mobile menu (a simple
  toggle, working with JS; links still reachable). A sticky "Call" button on mobile
  is a great touch for local businesses.
- Sections (adapt to the business): hero with clear value prop + primary CTA (call /
  visit / order) · what we offer (services / menu / products) · story / about ·
  review-themes · hours + location (hours in a clean table, today's day highlighted
  via small JS) · contact CTA · footer.
- Tasteful motion only: subtle reveal-on-scroll (IntersectionObserver) and hover
  states; respect `prefers-reduced-motion`.
- Semantic HTML (header/nav/main/section/footer), alt text / aria-labels on SVGs,
  visible focus styles, a skip link.
- Keep each file reasonably lean (well under ~60KB).

- Reveal-on-scroll must never leave content invisible: content is visible by
  default, JS adds the hidden-until-revealed state, and under
  `prefers-reduced-motion: reduce` nothing is hidden (the screenshot tool uses it).

## Quality check (required)

Screenshot tool: `nh-web-prospects/tools/screenshot.mjs <slug>` (writes
`preview-desktop.jpg`, `preview-mobile.jpg`, `thumb.jpg` into the site folder and
prints an overflow check). Other agents build sites in parallel, so to avoid npm
races install Playwright in **your own** scratch dir, copy the script there and run
it with `SITES_DIR=/home/user/dataDeck/nh-web-prospects/sites node screenshot.mjs <slug>`.

After building, screenshot each site with Playwright (Chromium is pre-installed;
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; do NOT run `playwright install`).
If the `playwright` package isn't resolvable, `npm i --no-save playwright` inside
a scratch dir or use the repo's `@playwright/test` from `/home/user/dataDeck/node_modules`.
Take full-page shots at 1440px and 390px wide, save them to
`sites/<slug>/preview-desktop.jpg` and `sites/<slug>/preview-mobile.jpg`, then LOOK
at them (Read the PNGs) and fix anything off: overflow, cramped spacing, awkward
wrapping, weak contrast, broken illustrations. Iterate at least once. Also confirm
`document.documentElement.scrollWidth <= window.innerWidth` at 390px.
