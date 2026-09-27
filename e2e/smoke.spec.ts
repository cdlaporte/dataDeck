import { expect, test, type Page } from '@playwright/test';

type Hooks = {
  __datadeck: {
    engine: () => {
      settle(ticks?: number): void;
      transform: { k: number; x: number; y: number };
      container: HTMLElement;
      sim: { nodes: { x: number; y: number }[]; tick(): void };
      visible: Uint8Array;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to app state
    store: { getState(): Record<string, any>; setState(p: Record<string, unknown>): void };
  };
};

async function open(page: Page, errors: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  // Keep the run hermetic: web fonts are optional.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
  await page.goto('/');
  await page.evaluate(
    () =>
      new Promise((res) => {
        const req = indexedDB.deleteDatabase('keyval-store');
        req.onsuccess = req.onerror = req.onblocked = () => res(null);
      }),
  );
  await page.reload();
}

const settle = (page: Page, ticks = 400) =>
  page.evaluate((t) => (window as unknown as Hooks).__datadeck.engine().settle(t), ticks);
const state = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__datadeck.store.getState());

/** Screen position of the right-most visible bubble. */
const rightmostBubble = (page: Page) =>
  page.evaluate(() => {
    const e = (window as unknown as Hooks).__datadeck.engine();
    const r = e.container.getBoundingClientRect();
    let best = -1;
    e.sim.nodes.forEach((n, i) => {
      if (e.visible[i] && (best < 0 || n.x > e.sim.nodes[best].x)) best = i;
    });
    const n = e.sim.nodes[best];
    return {
      x: r.left + n.x * e.transform.k + e.transform.x,
      y: r.top + n.y * e.transform.k + e.transform.y,
    };
  });

test('every sample loads and profiles', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  for (const [name, rows] of [
    ['Iris flowers', '150'],
    ['Palmer penguins', '344'],
    ['Cars 1970–82', '406'],
    ['Movies', '3,201'],
    ['SaaS customers', '5,000'],
  ]) {
    if (await page.getByRole('button', { name: /rows$/ }).isVisible()) {
      await page.getByRole('button', { name: /rows$/ }).click();
    }
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.locator('.stage-status')).toContainText(`of ${rows}`);
  }
  expect(errors).toEqual([]);
});

test('explore, annotate, snapshot, present and persist', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.getByRole('button', { name: /Palmer penguins/ }).click();
  await expect(page.locator('.stage-status')).toContainText('344 of 344');

  // Slide 1 — 1D categorical via the field list.
  await page.locator('.field-name', { hasText: 'island' }).click();
  await settle(page);
  await expect(page.locator('g.group')).toHaveCount(3);
  await page.getByLabel('Slide title').fill('Three islands');
  await page.keyboard.press('Enter');
  await page.keyboard.press('s');
  await expect(page.locator('.slide-thumb')).toHaveCount(1);

  // Slide 2 — 1D quantitative, size + colour encodings, a filter and an annotation.
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: '1D' }).click();
  await page.getByLabel('Layout field').click();
  await page.getByRole('option', { name: 'body_mass_g' }).click();
  await page.getByLabel('Size field').click();
  await page.getByRole('option', { name: 'flipper_length_mm' }).click();
  await expect(page.locator('.legend')).toContainText('flipper_length_mm');
  await page.locator('.field-item', { hasText: 'species' }).hover();
  await page.getByRole('button', { name: 'Filter by species' }).click();
  await page.locator('.check-item', { hasText: 'Chinstrap' }).locator('input').uncheck();
  await expect(page.locator('.stage-status')).toContainText('Showing 274');
  await settle(page);
  await expect(page.locator('.guide-set .tick-label').first()).toBeVisible();

  const pt = await rightmostBubble(page);
  await page.keyboard.press('a');
  await page.mouse.click(pt.x, pt.y);
  await page.getByLabel('Annotation text').fill('Heaviest penguin');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('g.annotation')).toHaveCount(1);
  await page.getByLabel('Slide title').fill('Gentoos are heavier');
  await page.keyboard.press('Enter');
  await page.getByRole('toolbar', { name: 'Stage tools' }).getByRole('button', { name: 'Snapshot' }).click();
  await expect(page.locator('.slide-thumb')).toHaveCount(2);

  // Slide 3 — 2D scatter.
  await page.keyboard.press('3');
  await expect(page.getByLabel('X axis field')).toBeVisible();
  await settle(page);
  await expect(page.locator('g[data-orient="left"]')).toHaveCount(1);
  await page.keyboard.press('s');
  await expect(page.locator('.slide-thumb')).toHaveCount(3);

  // Slide 4 — t-SNE runs live in a worker and its embedding is stored with the slide.
  await page.keyboard.press('4');
  await expect(page.locator('.progress-pill')).toBeVisible();
  await expect.poll(async () => (await state(page)).tsneStatus.state, { timeout: 120_000 }).toBe('done');
  expect((await state(page)).view.layout.coords.length).toBe(344 * 2);
  await page.keyboard.press('s');
  await expect(page.locator('.slide-thumb')).toHaveCount(4);

  // Present from the first slide.
  await page.locator('.slide-thumb .frame').first().click();
  await page.keyboard.press('p');
  await expect(page.locator('.app.presenting')).toBeVisible();
  await expect(page.locator('.present-count')).toHaveText('1 / 4');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.present-count')).toHaveText('2 / 4');
  await expect(page.getByLabel('Slide title')).toHaveValue('Gentoos are heavier');
  expect((await state(page)).view.filters).toHaveLength(1);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect((await state(page)).tsneStatus.state).toBe('done'); // stored coords, no recompute
  await page.keyboard.press('Escape');
  await expect(page.locator('.app.presenting')).toHaveCount(0);

  // Autosave → reload restores the deck.
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator('.slide-thumb')).toHaveCount(4);
  await expect(page.getByLabel('Slide title')).toHaveValue('Three islands');
  expect(errors).toEqual([]);
});

test('simulation CPU cost stays within a frame budget at 5,000 rows', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.getByRole('button', { name: /SaaS customers/ }).click();
  await expect(page.locator('.stage-status')).toContainText('of 5,000');
  await page.keyboard.press('2'); // 1D beeswarm: the heaviest collision workload
  const ms = await page.evaluate(() => {
    const e = (window as unknown as Hooks).__datadeck.engine();
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) e.sim.tick();
    return (performance.now() - t0) / 60;
  });
  console.log(`simulation tick @5k rows: ${ms.toFixed(2)} ms`);
  expect(ms).toBeLessThan(16);
  expect(errors).toEqual([]);
});
