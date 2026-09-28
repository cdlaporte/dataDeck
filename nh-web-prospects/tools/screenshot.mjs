// Screenshot concept sites at desktop + mobile widths and check for horizontal overflow.
// Usage: node tools/screenshot.mjs [slug ...]   (no args = every folder in sites/)
// Needs the `playwright` package: run `npm i --no-save playwright` in nh-web-prospects/tools first.
// (Or copy this file next to any node_modules/playwright and set SITES_DIR=/abs/path/to/sites.)
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.SITES_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'sites');
const slugs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(root).filter((d) => existsSync(join(root, d, 'index.html')));

const browser = await chromium.launch(
  existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
for (const slug of slugs) {
  const url = pathToFileURL(join(root, slug, 'index.html')).href;
  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['mobile', 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: name === 'mobile' ? 2 : 1 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'networkidle' }).catch(() => page.goto(url));
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: join(root, slug, `preview-${name}.png`), fullPage: true });
    if (name === 'desktop')
      await page.screenshot({ path: join(root, slug, 'thumb.png'), clip: { x: 0, y: 0, width, height } });
    console.log(`${slug} ${name}: ${overflow > 0 ? `OVERFLOW ${overflow}px` : 'ok'}`);
    await page.close();
  }
}
await browser.close();
