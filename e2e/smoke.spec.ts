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
  // Regression: a note that re-enters (slide 1 has none) must rebuild its text.
  const note = page.locator('g.annotation text.note-text');
  await expect(note).toContainText('Heaviest penguin');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('g.annotation')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(note).toContainText('Heaviest penguin');
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

/** Screen-space bounding polygon (with padding) around the visible rows matching `species`. */
const clusterPolygon = (page: Page, species: string) =>
  page.evaluate((sp) => {
    const hooks = (window as unknown as Hooks).__datadeck;
    const e = hooks.engine();
    const table = hooks.store.getState().table;
    const col = table.columns.species.values as (string | null)[];
    const r = e.container.getBoundingClientRect();
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    e.sim.nodes.forEach((n, i) => {
      if (!e.visible[i] || col[i] !== sp) return;
      const x = r.left + n.x * e.transform.k + e.transform.x;
      const y = r.top + n.y * e.transform.k + e.transform.y;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    });
    const p = 14;
    return [
      [x0 - p, y0 - p],
      [x1 + p, y0 - p],
      [x1 + p, y1 + p],
      [x0 - p, y1 + p],
    ] as [number, number][];
  }, species);

async function drawLasso(page: Page, pts: [number, number][], shift = false) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const p of [...pts.slice(1), pts[0]]) await page.mouse.move(p[0], p[1], { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

test('lasso: drill in, exclude and annotate a selection', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.getByRole('button', { name: /Palmer penguins/ }).click();
  await page.locator('.field-name', { hasText: 'species' }).click();
  await settle(page, 500);

  // Lasso tool → Keep only (drill in).
  await page.keyboard.press('l');
  await drawLasso(page, await clusterPolygon(page, 'Gentoo'));
  await expect(page.locator('.selection-count')).toHaveText('124 selected');
  await page
    .getByRole('toolbar', { name: 'Selection actions' })
    .getByRole('button', { name: 'Keep only' })
    .click();
  await expect(page.locator('.stage-status')).toContainText('Showing 124 of 344');
  await expect(page.locator('.filter-card', { hasText: 'Selection' })).toContainText('Showing only 124');
  await page.getByRole('button', { name: 'Remove selection filter' }).click();
  await expect(page.locator('.stage-status')).toContainText('Showing 344 of 344');
  await settle(page, 500);

  // Shift-drag in the select tool → Exclude.
  await page.keyboard.press('v');
  await drawLasso(page, await clusterPolygon(page, 'Adelie'), true);
  await expect(page.locator('.selection-count')).toHaveText('152 selected');
  await page
    .getByRole('toolbar', { name: 'Selection actions' })
    .getByRole('button', { name: 'Exclude' })
    .click();
  await expect(page.locator('.stage-status')).toContainText('Showing 192 of 344');
  await page.getByRole('button', { name: 'Remove selection filter' }).click();
  await settle(page, 500);

  // Annotate a selection: the note circles the selected group and follows it.
  await page.keyboard.press('l');
  await drawLasso(page, await clusterPolygon(page, 'Chinstrap'));
  await page
    .getByRole('toolbar', { name: 'Selection actions' })
    .getByRole('button', { name: 'Annotate' })
    .click();
  await expect(page.getByLabel('Annotation title')).toHaveValue('68 selected');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('g.annotation text.note-text')).toContainText('68 selected');
  await expect(page.locator('.selection-bar')).toHaveCount(0);

  // Esc clears a selection.
  await page.keyboard.press('l');
  await drawLasso(page, await clusterPolygon(page, 'Gentoo'));
  await expect(page.locator('.selection-bar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.selection-bar')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('drag a field onto an axis, overlap, log scale, undo/redo', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.getByRole('button', { name: /Palmer penguins/ }).click();
  await expect(page.locator('.stage-status')).toContainText('344');

  // Drag a field from the Data panel onto the X axis zone → 2D.
  const stage = (await page.locator('.stage').boundingBox())!;
  await page
    .locator('.field-item', { hasText: 'body_mass_g' })
    .dragTo(page.locator('.stage'), { targetPosition: { x: stage.width / 2, y: stage.height - 100 } });
  await expect
    .poll(async () => (await state(page)).view.layout)
    .toMatchObject({ mode: '2d', x: 'body_mass_g' });
  // …and another onto the Y axis zone.
  await page
    .locator('.field-item', { hasText: 'flipper_length_mm' })
    .dragTo(page.locator('.stage'), { targetPosition: { x: 50, y: stage.height / 2 } });
  await expect
    .poll(async () => (await state(page)).view.layout)
    .toMatchObject({ mode: '2d', x: 'body_mass_g', y: 'flipper_length_mm' });
  await settle(page);
  await expect(page.locator('.guide-set:not(.leaving) g[data-orient="bottom"] .axis-title')).toHaveText(
    'body_mass_g',
  );

  // Collisions off.
  await page.getByRole('switch', { name: /overlap/i }).check();
  expect((await state(page)).view.overlap).toBe(true);

  // Log scale on the x axis.
  await page.getByRole('button', { name: 'Log scale for X axis' }).click();
  await settle(page);
  await expect(page.locator('.guide-set:not(.leaving) g[data-orient="bottom"] .axis-title')).toHaveText(
    'body_mass_g (log)',
  );

  // Undo / redo (keyboard); the edits above were separate steps.
  await page.locator('.stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await state(page)).view.layout.logX ?? false).toBe(false);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await state(page)).view.layout.logX).toBe(true);
  expect(errors).toEqual([]);
});

test('find a row, highlight an annotated selection, export a PDF', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.getByRole('button', { name: /Movies/ }).click();
  await expect(page.locator('.stage-status')).toContainText('3,201');
  await page.locator('.field-name', { hasText: 'Major Genre' }).click();
  await settle(page);

  // Find.
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByLabel('Search rows').fill('Titanic');
  await expect(page.locator('.find-hit').first()).toContainText('Titanic');
  await page.keyboard.press('Enter');
  await expect(page.locator('.selection-count')).toHaveText('1 selected');

  // Annotate the selection and highlight it: everything else turns grey.
  await page
    .getByRole('toolbar', { name: 'Selection actions' })
    .getByRole('button', { name: 'Annotate' })
    .click();
  await page.getByRole('switch', { name: 'Highlight these points' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.legend-chip')).toContainText('Highlighting 1 bubble');
  const colours = await page.evaluate(() => {
    const e = (
      window as unknown as { __datadeck: { engine: () => { targetRGBA: Float32Array } } }
    ).__datadeck.engine();
    const s = (window as unknown as Hooks).__datadeck.store.getState();
    const row = s.view.annotations[0].anchor.rows[0] as number;
    const other = row === 0 ? 1 : 0;
    const rgb = (i: number) =>
      Array.from(e.targetRGBA.slice(i * 4, i * 4 + 3)).map((v) => Math.round(v * 255));
    return { highlighted: rgb(row), other: rgb(other) };
  });
  expect(colours.other).toEqual([163, 162, 156]); // neutral grey (light theme)
  expect(colours.highlighted).not.toEqual([163, 162, 156]);

  // Two slides → PDF.
  await page.keyboard.press('s');
  await expect(page.locator('.slide-thumb')).toHaveCount(1);
  await page.keyboard.press('1');
  await page.keyboard.press('s');
  await expect(page.locator('.slide-thumb')).toHaveCount(2);
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: /PDF/ }).click(),
  ]);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(10_000);
  expect(errors).toEqual([]);
});

test('text boxes, note font size, theme-correct previews, compact strip', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.evaluate(() => (window as unknown as Hooks).__datadeck.store.setState({ theme: 'light' }));
  await page.getByRole('button', { name: /Palmer penguins/ }).click();
  await page.locator('.field-name', { hasText: 'species' }).click();
  await settle(page);

  // A plain text box: no subject circle, connector or rule.
  const stage = (await page.locator('.stage').boundingBox())!;
  await page.keyboard.press('t');
  await page.mouse.click(stage.x + 140, stage.y + stage.height - 180);
  await page.getByLabel('Annotation title').fill('Just text');
  await page
    .getByRole('group', { name: 'Font size' })
    .getByRole('button', { name: 'XL', exact: true })
    .click();
  await page.getByRole('button', { name: 'Done' }).click();
  const note = page.locator('g.annotation').first();
  await expect(note.locator('text.note-text tspan').first()).toHaveAttribute('font-size', '25');
  await expect(note.locator('circle.subject')).toHaveAttribute('display', 'none');
  await expect(note.locator('line.rule')).toHaveAttribute('display', 'none');
  expect((await state(page)).view.annotations[0]).toMatchObject({ style: 'text', fontSize: 24 });

  // Two slides, then switch theme: previews are redrawn in the new theme.
  await page.keyboard.press('s');
  await page.keyboard.press('1');
  await page.keyboard.press('s');
  await expect(page.locator('.slide-thumb')).toHaveCount(2);
  const before = (await state(page)).slides.map((s: { thumbnail: string; thumbnailTheme: string }) => [
    s.thumbnailTheme,
    s.thumbnail,
  ]);
  expect(before.map((b: string[]) => b[0])).toEqual(['light', 'light']);
  await page.evaluate(() => (window as unknown as Hooks).__datadeck.store.setState({ theme: 'dark' }));
  await expect
    .poll(async () => (await state(page)).slides.map((s: { thumbnailTheme: string }) => s.thumbnailTheme), {
      timeout: 30_000,
    })
    .toEqual(['dark', 'dark']);
  const after = (await state(page)).slides.map((s: { thumbnail: string }) => s.thumbnail);
  expect(after[0]).not.toBe(before[0][1]);

  // Compact strip: numbered chips, selectable, remembered across reloads.
  await page.getByRole('button', { name: 'Compact slide strip' }).click();
  await expect(page.locator('.slide-chip')).toHaveCount(2);
  await expect(page.locator('.slide-chip b')).toHaveText(['1', '2']);
  await page.locator('.slide-chip .chip').first().click();
  expect((await state(page)).activeSlideId).toBe((await state(page)).slides[0].id);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('.slide-chip')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('mean / median lines, custom category colours, axis text, note fades', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.getByText('Iris flowers').click();
  await expect(page.locator('.field-name', { hasText: 'petal_length' })).toBeVisible();
  const setLayout = (layout: Record<string, unknown>) =>
    page.evaluate((l) => {
      const s = (window as unknown as Hooks).__datadeck.store;
      s.setState({ view: { ...s.getState().view, layout: l } });
    }, layout);
  const refLabels = () => page.locator('.guide-set:not(.leaving) .ref-label');

  // Strip plot: one median segment per species, then means.
  await setLayout({ mode: '2d', x: 'petal_length', y: 'species' });
  const reference = page.getByRole('group', { name: 'Reference line' });
  await reference.getByRole('button', { name: 'Median' }).click();
  await expect(refLabels()).toHaveText(['1.5', '4.35', '5.55']);
  await expect(page.locator('.guide-set:not(.leaving) .ref.lane')).toHaveCount(3);
  await reference.getByRole('button', { name: 'Mean' }).click();
  await expect(refLabels()).toHaveText(['1.46', '4.26', '5.55']);
  expect((await state(page)).view.reference).toBe('mean');

  // Scatter: one line per axis. Larger axis text.
  await setLayout({ mode: '2d', x: 'petal_length', y: 'sepal_width' });
  await expect(refLabels()).toHaveText(['Mean 3.76', 'Mean 3.06']);
  await expect(page.locator('.guide-set:not(.leaving) text.tick-label').first()).toHaveAttribute(
    'font-size',
    '13',
  );
  await reference.getByRole('button', { name: 'None' }).click();
  await expect(refLabels()).toHaveCount(0);

  // Custom colour for one species: legend, state and autosave; reset; undo.
  await page.getByRole('button', { name: 'Color for virginica' }).click();
  await page.getByRole('button', { name: 'Use #e87ba4' }).click();
  await expect(page.getByRole('button', { name: 'Color for virginica' }).locator('.swatch')).toHaveCSS(
    'background-color',
    'rgb(232, 123, 164)',
  );
  expect((await state(page)).categoryColors).toEqual({ species: { virginica: '#e87ba4' } });
  await page.keyboard.press('s');
  await expect(page.locator('.slide-thumb')).toHaveCount(1);
  expect((await state(page)).slides[0].thumbnailStyle).toMatch(/^light\|/);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Color for virginica' }).locator('.swatch')).toHaveCSS(
    'background-color',
    'rgb(232, 123, 164)',
  );
  await page.getByRole('button', { name: 'Reset colors' }).click();
  expect((await state(page)).categoryColors).toEqual({});
  // The preview is redrawn without the custom colour.
  await expect
    .poll(async () => (await state(page)).slides[0].thumbnailStyle, { timeout: 30_000 })
    .toBe('light');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await state(page)).categoryColors).toEqual({ species: { virginica: '#e87ba4' } });

  // Notes fade out briefly before they are removed.
  await settle(page, 60);
  const stage = (await page.locator('.stage').boundingBox())!;
  await page.keyboard.press('t');
  await page.mouse.click(stage.x + 160, stage.y + stage.height - 200);
  await page.getByLabel('Annotation title').fill('Fading');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('g.annotation')).toHaveCount(1);
  await expect(page.locator('g.annotation')).toHaveCSS('opacity', '1');
  await page.evaluate(() => {
    const s = (window as unknown as Hooks).__datadeck.store;
    s.setState({ view: { ...s.getState().view, annotations: [] } });
  });
  await expect(page.locator('g.annotation.leaving')).toHaveCount(1);
  await expect(page.locator('g.annotation')).toHaveCount(0, { timeout: 1000 });
  expect(errors).toEqual([]);
});

test('notes stay exactly where they were snapshotted, in presentation and previews', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.getByText('Palmer penguins').click();
  await page.locator('.field-name', { hasText: 'species' }).click();
  await settle(page);
  await page.locator('.title-input').fill('Penguins');
  await page.keyboard.press('Enter');

  // A note dragged up toward the legend: it used to flip away on its own.
  const stage = (await page.locator('.stage').boundingBox())!;
  await page.keyboard.press('a');
  await page.mouse.click(stage.x + stage.width * 0.55, stage.y + stage.height * 0.5);
  await page.getByRole('button', { name: 'Done' }).click();
  const note = page.locator('g.annotation-note').first();
  const b = (await note.boundingBox())!;
  await page.mouse.move(b.x + 10, b.y + 5);
  await page.mouse.down();
  await page.mouse.move(b.x + 11, b.y + 5);
  // Starting a drag doesn't jump the note.
  const nudged = (await note.boundingBox())!;
  expect(Math.abs(nudged.x - b.x - 1)).toBeLessThan(2);
  await page.mouse.move(b.x + 150, b.y - 90, { steps: 8 });
  await page.mouse.up();
  await settle(page, 30);

  // Positions relative to the stage, in the stage's own (unscaled) units.
  const measure = () =>
    page.evaluate(() => {
      const st = document.querySelector('.stage')!.getBoundingClientRect();
      const hooks = (window as unknown as Hooks).__datadeck;
      const scale = st.width / (hooks.engine() as unknown as { size(): { width: number } }).size().width;
      const rel = (sel: string) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return [(r.left - st.left) / scale, (r.top - st.top) / scale];
      };
      return { scale, note: rel('g.annotation-note'), title: rel('.title-input') };
    });
  const editor = await measure();
  expect(editor.scale).toBeCloseTo(1);
  const ann = (await state(page)).view.annotations[0];
  const anchorFree = ann.anchor.kind === 'free';
  expect(anchorFree).toBe(true);

  await page.keyboard.press('s');
  await expect(page.locator('.slide-thumb')).toHaveCount(1);
  const frame = (await state(page)).slides[0].frame;
  expect(frame).toEqual({ width: Math.round(stage.width), height: Math.round(stage.height) });

  // Presenting shows the same composition, scaled to fit the screen.
  await page.keyboard.press('p');
  await expect(page.locator('.slide-frame.framed')).toBeVisible();
  // The stage grows to fullscreen, then the frame scales up to fit it.
  await expect.poll(async () => (await measure()).scale).toBeGreaterThan(1.05);
  await settle(page, 60);
  const shown = await measure();
  const box = (await page.locator('.slide-frame').boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(frame.width / frame.height, 2);
  for (const k of ['note', 'title'] as const) {
    expect(Math.abs(shown[k][0] - editor[k][0])).toBeLessThan(2);
    expect(Math.abs(shown[k][1] - editor[k][1])).toBeLessThan(2);
  }
  expect((await state(page)).view.annotations[0]).toMatchObject({ dx: ann.dx, dy: ann.dy });

  await page.keyboard.press('Escape');
  await expect(page.locator('.slide-frame.framed')).toHaveCount(0);
  expect((await measure()).scale).toBeCloseTo(1);
  expect(errors).toEqual([]);
});

test('notes scale with the window', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.getByText('Iris flowers').click();
  await page.locator('.field-name', { hasText: 'species' }).click();
  await settle(page);
  const stageBox = (await page.locator('.stage').boundingBox())!;
  await page.keyboard.press('a');
  await page.mouse.click(stageBox.x + stageBox.width * 0.4, stageBox.y + stageBox.height * 0.45);
  await page.getByLabel('Annotation title').fill('Scales');
  await page
    .getByRole('group', { name: 'Font size' })
    .getByRole('button', { name: 'L', exact: true })
    .click();
  await page.getByRole('button', { name: 'Done' }).click();

  const read = () =>
    page.evaluate(() => {
      const g = document.querySelector('g.annotation:not(.leaving)')!;
      const t = g.querySelector('g.annotation-note')!.getAttribute('transform')!;
      const [nx, ny] = t.match(/-?[\d.]+/g)!.map(Number);
      const c = g.querySelector('circle.subject')!;
      const size = (
        (window as unknown as Hooks).__datadeck.engine() as unknown as {
          size(): { width: number; height: number };
        }
      ).size();
      // Free notes sit in the plot area (margins as in plotRect, with a legend).
      const small = size.width < 640;
      const [ml, mr, mt, mb] = small ? [20, 20, 72, 72] : [48, 200, 108, 84];
      const plotX = (Number(c.getAttribute('cx')) - ml) / (size.width - ml - mr);
      const plotY = (Number(c.getAttribute('cy')) - mt) / (size.height - mt - mb);
      return {
        plot: [plotX, plotY],
        off: [nx - Number(c.getAttribute('cx')), ny - Number(c.getAttribute('cy'))],
        font: Number(g.querySelector('tspan')!.getAttribute('font-size')),
        size,
      };
    });
  const big = await read();
  expect(big.font).toBe(19);
  const note = (await state(page)).view.annotations[0];
  expect(note.frame).toEqual(big.size);
  expect(note.anchor).toMatchObject({ kind: 'free', space: 'plot' });

  await page.setViewportSize({ width: 1100, height: 700 });
  await expect.poll(async () => (await read()).size.width).toBeLessThan(big.size.width - 50);
  await settle(page, 30);
  const small = await read();
  const s = Math.min(small.size.width / big.size.width, small.size.height / big.size.height);
  expect(small.font / big.font).toBeCloseTo(s, 1);
  expect(small.off[0] / big.off[0]).toBeCloseTo(s, 1);
  expect(small.off[1] / big.off[1]).toBeCloseTo(s, 1);
  // The anchor keeps its place within the chart area.
  expect(small.plot[0]).toBeCloseTo(big.plot[0], 2);
  expect(small.plot[1]).toBeCloseTo(big.plot[1], 2);

  // Dragging at the small size stores offsets in the note's own frame units.
  const nb = (await page.locator('g.annotation-note').first().boundingBox())!;
  await page.mouse.move(nb.x + 8, nb.y + 4);
  await page.mouse.down();
  await page.mouse.move(nb.x + 28, nb.y + 4, { steps: 4 });
  await page.mouse.up();
  const moved = (await state(page)).view.annotations[0];
  expect(moved.dx - note.dx).toBeCloseTo(20 / s, 0);
  expect(moved.fontSize).toBe(18);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await read()).size.width).toBe(big.size.width);
  await settle(page, 30);
  const back = await read();
  expect(back.font).toBe(19);
  expect(back.off[0]).toBeCloseTo(moved.dx, 0);
  expect(errors).toEqual([]);
});
