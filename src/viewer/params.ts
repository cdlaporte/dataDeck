export type ViewerParams = {
  /** URL of the .datadeck.json file to show. */
  deck: string | null;
  /** 1-based slide to start on. */
  slide: number;
  /** Where Esc / the exit button go; defaults to the previous page. */
  back: string | null;
  /** Forces a theme; otherwise the system setting is used. */
  theme: 'light' | 'dark' | null;
};

export function readViewerParams(search: string): ViewerParams {
  const q = new URLSearchParams(search);
  const slide = Number.parseInt(q.get('slide') ?? '', 10);
  const theme = q.get('theme');
  return {
    deck: q.get('deck') || null,
    slide: Number.isFinite(slide) && slide > 0 ? slide : 1,
    back: q.get('back') || null,
    theme: theme === 'light' || theme === 'dark' ? theme : null,
  };
}
