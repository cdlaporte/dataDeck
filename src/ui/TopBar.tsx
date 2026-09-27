import { startPresentation, useStore, type ThemePref } from '../state/store';
import { exportDeck, openFile, pickFile } from './actions';
import { BrandMark, IconDatabase, IconDownload, IconFolder, IconMonitor, IconMoon, IconPlay, IconSun } from './icons';

const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };

export function TopBar({ onChangeData }: { onChangeData: () => void }) {
  const deckName = useStore((s) => s.deckName);
  const dataset = useStore((s) => s.dataset);
  const table = useStore((s) => s.table);
  const slides = useStore((s) => s.slides.length);
  const theme = useStore((s) => s.theme);
  const ThemeIcon = theme === 'light' ? IconSun : theme === 'dark' ? IconMoon : IconMonitor;

  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        DataDeck
      </div>
      <span className="divider" />
      <input
        className="deck-name"
        value={deckName}
        aria-label="Deck name"
        onChange={(e) => useStore.setState({ deckName: e.target.value })}
      />
      {dataset && table && (
        <button type="button" className="btn ghost small dataset-chip" onClick={onChangeData} title="Change dataset">
          <IconDatabase size={14} />
          {dataset.name} · {table.rowCount.toLocaleString()} rows
        </button>
      )}
      <span className="spacer" />
      <button
        type="button"
        className="btn ghost small"
        title="Open a deck (.datadeck.json) or data file (CSV/TSV)"
        onClick={() => pickFile('.json,.csv,.tsv,.txt', (f) => void openFile(f))}
      >
        <IconFolder size={15} /> Open
      </button>
      <button type="button" className="btn ghost small" title="Download this deck as a .datadeck.json file" disabled={!dataset} onClick={exportDeck}>
        <IconDownload size={15} /> Export
      </button>
      <button
        type="button"
        className="btn icon ghost small"
        title={`Theme: ${theme}`}
        aria-label={`Theme: ${theme}. Switch theme`}
        onClick={() => useStore.setState({ theme: NEXT_THEME[theme] })}
      >
        <ThemeIcon size={15} />
      </button>
      <button type="button" className="btn primary" disabled={!slides} title="Present (P)" onClick={() => startPresentation()}>
        <IconPlay size={14} /> Present
      </button>
    </header>
  );
}
