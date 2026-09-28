import { getEngine } from '../engine/instance';
import { withoutHistory } from '../state/history';
import { sanitizeView, useStore } from '../state/store';
import type { ViewState } from '../state/types';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function fileBase(): string {
  return (
    useStore
      .getState()
      .deckName.replace(/[^\w\- ]+/g, '')
      .trim() || 'deck'
  );
}

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

/** Shows `view` on the stage and fast-forwards the simulation so it is fully settled. */
async function renderView(view: ViewState) {
  withoutHistory(() => useStore.setState({ view }));
  await nextFrame();
  getEngine()?.settle(480);
  await nextFrame();
}

/** Downloads every slide as one page of a PDF. */
export async function exportPdf() {
  const state = useStore.getState();
  const engine = getEngine();
  if (!engine || !state.table || !state.slides.length || state.exporting) return;
  const saved = { view: state.view, activeSlideId: state.activeSlideId, selection: state.selection };
  useStore.setState({ exporting: 'Preparing PDF…', selection: [], editingAnnotationId: null });
  try {
    const { jsPDF } = await import('jspdf');
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (const [i, slide] of state.slides.entries()) {
      useStore.setState({ exporting: `Rendering slide ${i + 1} of ${state.slides.length}…` });
      const view = sanitizeView(slide.view, state.table);
      // Render at the slide's own frame so pages match what was snapshotted.
      useStore.setState({ renderFrame: slide.frame ?? null });
      await nextFrame();
      engine.syncSize();
      await renderView(view);
      const canvas = await engine.captureImage({
        scale: 2,
        title: view.title,
        caption: view.caption,
        legend: true,
      });
      if (!canvas) continue;
      const w = canvas.width / 2;
      const h = canvas.height / 2;
      const orientation = w >= h ? 'landscape' : 'portrait';
      if (!pdf) pdf = new jsPDF({ orientation, unit: 'px', format: [w, h], hotfixes: ['px_scaling'] });
      else pdf.addPage([w, h], orientation);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
    }
    pdf?.save(`${fileBase()}.pdf`);
  } finally {
    withoutHistory(() => useStore.setState({ view: saved.view, activeSlideId: saved.activeSlideId }));
    useStore.setState({ exporting: null, selection: saved.selection, renderFrame: null });
  }
}

/** Downloads the current view as a 2× PNG. */
export async function exportPng() {
  const { view, table, exporting } = useStore.getState();
  const engine = getEngine();
  if (!engine || !table || exporting) return;
  const canvas = await engine.captureImage({
    scale: 2,
    title: view.title,
    caption: view.caption,
    legend: true,
  });
  if (canvas)
    download(canvas.toDataURL('image/png'), `${fileBase()}${view.title ? ` - ${view.title}` : ''}.png`);
}
