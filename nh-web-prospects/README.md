# Southern NH web-design prospects

Ten real small businesses in southern New Hampshire that have no website, only a
Facebook page, or a free-builder site, each with a polished **concept website** to show the
owner, plus a client list and outreach drafts. Everything runs locally; nothing is deployed.

## Open it

Open `index.html` in a browser (double-click it). That's the **prospect board**:

- **Concept sites**: a card for each business, linking to its concept site and a mobile screenshot.
- **Client list**: contact info, the best way to reach each owner, a status tracker
  (saved in your browser) and a copy-ready outreach draft for each.
- **Backup leads**: 8 more researched businesses for the next batch.

Each concept site is a single self-contained file at `sites/<slug>/index.html`. You can open it
directly, email it, or drop the folder on any static host later.

## The ten

| # | Business | Town | Type | Web presence today |
|---|----------|------|------|--------------------|
| 1 | Chuck's Barber Shop | Nashua | Barber (since 1947) | Facebook only |
| 2 | Stubby's Diner | Candia | Diner | Facebook only |
| 3 | McQuesten Farm | Litchfield | Farm stand / PYO (since 1744) | Facebook + Instagram |
| 4 | Bigfoot Sourdough | Milford | Micro-bakery | Facebook + Instagram |
| 5 | Helen's Tailoring | Manchester | Tailor / bridal alterations | No website |
| 6 | Mercy of God African Market | Manchester | African grocery | Facebook only |
| 7 | Bosna Store | Manchester | Balkan grocery & café | Nothing (Yelp only) |
| 8 | House of Nails Spa | Windham | Nail salon | Free WordPress.com blog |
| 9 | Cherry Village Pizza | Hampstead | Pizzeria / Greek | Facebook only |
| 10 | Big 'N Small Pet Grooming | Merrimack | Pet grooming | Free GoDaddy subdomain |

## Files

| Path | What |
|------|------|
| `index.html` | Prospect board (gallery + client list + tracker) |
| `client-list.csv` | Full client list (10 prospects + 8 backups) for Excel / Google Sheets |
| `outreach/emails.md` | Personalized outreach message per business + a phone/walk-in script |
| `sites/<slug>/` | Concept site + `preview-desktop.png`, `preview-mobile.png`, `thumb.png` |
| `data/prospects.json` | Research data: the single source of truth |
| `data/outreach.json` | Outreach copy |
| `DESIGN_BRIEF.md` | Design rules every concept follows |
| `tools/build.mjs` | Regenerates the CSV, emails and board data from `data/*.json` |
| `tools/screenshot.mjs` | Regenerates screenshots (needs `npm i --no-save playwright` in `tools/`) |

## Before you send anything

1. **Replace `YOUR STUDIO`** (your business name) everywhere. It appears in the badge and footer of
   every concept site and in the email signature. Example:
   `grep -rl "YOUR STUDIO" . | xargs sed -i 's/YOUR STUDIO/Granite Pixel Co./g'`
   Also fill in `[Your Name]`, phone, website and **mailing address** in `data/outreach.json`, then run
   `node tools/build.mjs`. Cold commercial email in the US (CAN-SPAM) needs a physical postal
   address and a way to opt out. The signature already includes an opt-out line.
2. **Confirm each business is open, and check its details.** Research came from search listings. The
   research tool could not open Yelp, Facebook or the businesses' own pages, so a 30-second check of
   their Facebook page or Google Maps listing is worth it. Details worth checking are noted in the
   data: Big 'N Small's hours, Cherry Village's address, House of Nails' weekday opening time, and
   whether Bigfoot Sourdough's Bread Shed is active this season.
3. **Only Bigfoot Sourdough publicly lists an email.** For the others, send the same text as a
   Facebook message, call, or just stop in with the concept open on your phone or tablet. Walking in
   usually works best with mom-and-pop shops.
4. The concept sites say "Concept preview · not the official website" on purpose. Keep them
   private (email a screenshot or show them in person) rather than posting them publicly
   under the business's name.
5. Review highlights on each site are *themes* paraphrased from public reviews, not quotes. When a
   client signs, swap in real testimonials they approve.
