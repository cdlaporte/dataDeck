# DataDeck

Live, data-driven presentations. Load a dataset and every row becomes a bubble in a
force simulation that never stops running. Explore it along one dimension, two
dimensions, or many (t-SNE), encode colour and size, filter, and annotate. Then
**snapshot** each view into a slide and present them with seamless animated
transitions. The bubbles fly from one slide's layout to the next.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

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
3. **Annotate.**
   - Press **A**, or use the note tool, then click a bubble, a group label or empty space.
   - Notes are anchored to a data point, a category group or a canvas position, so they follow the data as it moves.
   - Drag a note to reposition it; double-click it to edit.
4. **Snapshot** (**S**) saves the current view as a slide. Click a slide to load it back into the editor. If you change a loaded slide, **Update slide** (**U**) saves the changes. Drag slides to reorder them.
5. **Present** (**P**) goes fullscreen. Use ←/→ (or space) to move between slides and Esc to exit.

You can also:

- drag any bubble; the live simulation pushes its neighbours aside
- scroll to zoom and drag the background to pan (the zoom is saved with the slide)
- hover a bubble for its details
- click a legend entry to hide or show that category

Decks autosave to IndexedDB. **Export** downloads a self-contained `.datadeck.json`
file with the dataset, field types and slides; **Open** loads one back, or a new CSV/TSV.

### Keyboard shortcuts

| Key           | Action                                  |
| ------------- | --------------------------------------- |
| `S`           | Snapshot view as a new slide            |
| `U`           | Update the selected slide from the view |
| `P`           | Present from the selected slide         |
| `A` / `V`     | Annotate tool / select tool             |
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
