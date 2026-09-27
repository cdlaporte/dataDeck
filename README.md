# DataDeck

Live, data-driven presentations. Load a dataset and every row becomes a bubble in a
force simulation that never stops running. Explore it along one dimension, two
dimensions, or many (t-SNE), encode colour and size, filter, and annotate. Then
**snapshot** each view into a slide and present them with seamless animated
transitions. The bubbles fly from one slide's layout to the next.

## Quick start

Requires **Node.js 22 LTS** (or 20.19+). Check with `node -v`. To upgrade:

```bash
nvm install && nvm use                                   # nvm reads .nvmrc (22)
# or: brew install node@22 && brew link --overwrite node@22
```

Then:

```bash
npm install
npm run dev          # or npm start → http://localhost:5173
```

After pulling updates, run `npm install` again. If you forget, the dev server tells you.

Pick one of the bundled samples, or drop in your own CSV/TSV:

| Sample          | Rows  | What's in it                                     |
| --------------- | ----- | ------------------------------------------------ |
| Iris flowers    | 150   | 4 measurements × 3 species                       |
| Palmer penguins | 344   | Bill/flipper/mass, species, island, sex          |
| Cars 1970–82    | 406   | MPG, horsepower, weight, origin, model year      |
| Movies          | 3,201 | Grosses, budgets, ratings, genres, release dates |
| SaaS customers  | 5,000 | Synthetic plans, revenue, usage, churn           |

## Using it

1. **Data panel (left).**
   - Every column is profiled and typed as **quantitative** (`#`), **categorical** (`Aa`), **date** (`D`) or **text/ID** (`T`).
   - Click a type badge to override the type.
   - Click a field name to lay the data out along that single dimension.
   - Filters combine with AND:
     - categorical fields get a checklist
     - numeric and date fields get a range slider over a histogram
2. **View panel (right).**
   - **Cluster**: all rows in one group.
   - **1D**:
     - quantitative and date fields become a beeswarm along an axis
     - categorical fields become equally spaced groups, each labelled with its count
   - **2D**: any field on either axis:
     - scatter for numeric × numeric
     - strip plot for categorical × numeric
     - grid of clusters for categorical × categorical
   - **t-SNE**:
     - Choose three or more dimensions. The embedding is computed live in a Web Worker, so you watch it form.
     - Perplexity, learning rate and iteration count are adjustable, and you can pause or re-run.
     - Numeric fields are z-scored; categorical fields are one-hot encoded.
   - **Colour** by any field (categorical palette or sequential ramp) and **size** by a quantitative field.
   - **Log** toggles beside quantitative axis fields spread out skewed data. Fields with zeros or negatives use a symmetric log.
   - **Let bubbles overlap** turns collisions off, so each bubble sits exactly on its value (1D numeric, 2D and t-SNE).
   - **Drag a field** from the Data panel onto the stage. Drop it on the **X axis** or **Y axis** zone (switching to 2D if needed), on **Color**, or in the middle to **show it on its own**.
3. **Annotate.**
   - Press **A**, or use the note tool, then click a bubble, a group label or empty space.
   - Notes are anchored to a data point, a category group or a canvas position, so they follow the data as it moves.
   - Drag a note to reposition it; double-click it to edit.
   - Press **T** (or use the text tool) to place a plain **text box** anywhere, with no dot or line.
   - Each note has its own **font size**: S, M, L, XL or 2XL.
   - **Highlight these points** in the note editor keeps the annotated bubbles in colour (or a colour you pick) and greys out everything else. This also appears in presentations and exports.
4. **Select with a lasso.**
   - Press **L** (or use the lasso tool), or hold **Shift** and drag in the normal tool, to draw around bubbles. Shift adds to the selection.
   - The selection bar lets you:
     - **Keep only** the selection, which drills in: everything else is filtered out
     - **Exclude** the selection
     - **Annotate** the selection with a note that circles the selected bubbles wherever they move
   - Selections survive layout changes, so you can select in a scatter and see where those points land in t-SNE. Esc clears the selection.
5. **Snapshot** (**S**) saves the current view as a slide. Click a slide to load it back into the editor. If you change a loaded slide, **Update slide** (**U**) saves the changes. Drag slides to reorder them.
   The chevron in the slide strip switches to a **compact strip** of numbered chips; hover a chip to see its preview. Previews are redrawn automatically when you switch between light and dark themes.
6. **Present** (**P**) goes fullscreen. Use ←/→ (or space) to move between slides and Esc to exit.

You can also:

- drag any bubble; the live simulation pushes its neighbours aside
- scroll to zoom and drag the background to pan (the zoom is saved with the slide)
- choose the **Motion** preset at the bottom of the View panel: **Calm**, **Balanced** or **Lively**
- hover a bubble for its details
- click a legend entry to hide or show that category

Press **⌘/Ctrl+F** to find a row by name (or any text or category value). Enter selects it, and Shift+Enter selects every match. From there you can keep it, exclude it, or annotate and highlight it.
Undo and redo (**⌘/Ctrl+Z**, **⇧⌘/Ctrl+Shift+Z**) cover view edits, filters, annotations and slides.

Decks autosave to IndexedDB. **Export** offers three formats:

- a self-contained `.datadeck.json` file (dataset, field types and slides); **Open** loads one back, or a new CSV/TSV
- a **PDF** with one page per slide
- a **PNG** of the current view

### Keyboard shortcuts

| Key           | Action                                  |
| ------------- | --------------------------------------- |
| `S`           | Snapshot view as a new slide            |
| `U`           | Update the selected slide from the view |
| `P`           | Present from the selected slide         |
| `A` / `V`     | Annotate tool / select tool             |
| `L`           | Lasso tool (or Shift-drag anytime)      |
| `T`           | Text box tool                           |
| `⌘/Ctrl+F`    | Find a data point                       |
| `⌘/Ctrl+Z`    | Undo (add Shift to redo)                |
| `Esc`         | Clear selection, back to select tool    |
| `1`–`4`       | Cluster / 1D / 2D / t-SNE               |
| `0`           | Reset zoom                              |
| `←` `→` `Esc` | Previous / next / exit (presenting)     |

## Architecture

```
src/
  data/      CSV parsing (PapaParse), type inference + profiling, filters, formatting, samples
  state/     types (ViewState = the slide model), zustand store and actions
  engine/    framework-free core, driven by the store
    Engine.ts        orchestrator: frame loop, camera, picking, t-SNE worker, callbacks
    Simulation.ts    one persistent d3-force simulation (targets + collision)
    collide.ts       uniform-grid collision force (replaces d3.forceCollide for speed)
    Renderer.ts      three.js: every bubble in one instanced draw call, SDF circle shader
    layouts/         pure functions: (rows, spec, viewport) → per-row targets + axes/groups
    encodings.ts     colour and size scales + legends
    tsne.ts          t-SNE (sparse kNN affinities, exact repulsion), tsne.worker.ts
  overlay/   SVG layer: axes, live group labels, annotation callouts
  ui/        React components (panels, stage, slide strip, presentation controls)
  persist/   IndexedDB autosave, .datadeck import/export
```

Key ideas:

- **One simulation, forever.** Changing the view never rebuilds the simulation. The engine
  swaps per-row target positions, force strengths and collision radii and reheats, so
  every change is a transition. Filtered-out rows shrink to nothing where they stand and
  grow back in place.
- **Smooth, frame-rate-independent motion.** The simulation ticks at a fixed 60 Hz, so a
  120 Hz display doesn't double the speed. Targets glide from the old layout to the new one,
  a speed limit prevents fling, and alpha decays to a small resting value so groups come
  to rest instead of churning.
- **Calm dense clumps.** Collisions move positions directly (position-based dynamics),
  so they add no bounce energy. Bubbles inside a group's packed radius are not pulled
  inward, so the interior isn't squeezed. Collision passes scale with the number of
  visible bubbles. See `src/engine/jitter.test.ts` for the measured budget.
- **ViewState is the slide.** Layout, encodings, filters, annotations, camera and title
  are plain JSON. A snapshot is a deep copy, plus the final t-SNE embedding so
  presentations replay without recomputing.
- **Per-frame work stays out of React.** Positions, labels and annotation callouts are
  updated imperatively each frame. React re-renders only when the view or data changes.

## Development

```bash
npm run typecheck    # tsc -b
npm run lint         # eslint
npm test             # vitest unit tests (profiling, layouts, collision, t-SNE, deck files)
npm run e2e          # Playwright smoke tests (builds, serves, drives the real UI)
npm run build        # production bundle in dist/
npm run samples      # regenerate public/samples/ (downloads the public datasets)
```

`npm run e2e` uses Playwright's Chromium. To use a pre-installed browser instead, set
`PW_CHROMIUM_PATH=/path/to/chrome`. The suite runs with software WebGL, so it works on
headless machines without a GPU.

## Data sources

Iris (Fisher, 1936), Palmer penguins (Horst, Hill & Gorman, CC0), and the Cars and
Movies datasets from [vega-datasets](https://github.com/vega/vega-datasets). The SaaS
customers dataset is synthetic and generated by `scripts/genSamples.mjs`.
