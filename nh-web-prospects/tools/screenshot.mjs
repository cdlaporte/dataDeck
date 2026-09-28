// Screenshot concept sites at desktop + mobile widths and check for horizontal overflow.
// Usage: node tools/screenshot.mjs [slug ...]   (no args = every folder in sites/)
// Needs the `playwright` package: run `npm i --no-save playwright` in nh-web-prospects/tools first.
// (Or copy this file next to any node_modules/playwright and set SITES_DIR=/abs/path/to/sites.)
// Writes preview-desktop.jpg, preview-mobile.jpg (full page) and thumb.jpg (first screen) per site.
import { chromium } from 'playwright';
import { readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.SITES_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'sites');
const slugs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(root).filter((d) => existsSync(join(root, d, 'index.html')));

const browser = await chromium.launch(
  existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
let failures = 0;
for (const slug of slugs) {
  const dir = join(root, slug);
  const url = pathToFileURL(join(dir, 'index.html')).href;
  for (const [name, width, height, scale] of [
    ['desktop', 1440, 900, 1],
    ['mobile', 390, 844, 2],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    // Fetch web fonts from Node rather than the browser, so they load behind TLS-intercepting proxies
    // (run with NODE_EXTRA_CA_CERTS pointing at the proxy's CA bundle if needed).
    await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
      try {
        await route.fulfill({ response: await route.fetch() });
      } catch {
        await route.abort();
      }
    });
    // Freeze the clock on a Thursday morning (every business is open then) so "Open today" badges look right.
    await page.clock.setFixedTime(new Date('2026-10-01T10:30:00'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'networkidle' }).catch(() => page.goto(url));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) failures++;
    const shot = { type: 'jpeg', quality: 82 };
    await page.screenshot({ ...shot, path: join(dir, `preview-${name}.jpg`), fullPage: true });
    if (name === 'desktop')
      await page.screenshot({ ...shot, path: join(dir, 'thumb.jpg'), clip: { x: 0, y: 0, width, height } });
    console.log(`${slug} ${name}: ${overflow > 0 ? `OVERFLOW ${overflow}px` : 'ok'}`);
    await page.close();
  }
  for (const old of ['preview-desktop.png', 'preview-mobile.png', 'thumb.png']) rmSync(join(dir, old), { force: true });
}
await browser.close();
process.exitCode = failures ? 1 : 0;
