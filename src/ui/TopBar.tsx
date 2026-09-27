import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { redo, undo } from '../state/history';
import { startPresentation, useStore, type ThemePref } from '../state/store';
import { exportDeck, openFile, pickFile } from './actions';
import { exportPdf, exportPng } from './exportDeck';
import {
  BrandMark,
  IconDatabase,
  IconDownload,
  IconFile,
  IconFolder,
  IconImage,
  IconMonitor,
  IconMoon,
  IconPlay,
  IconRedo,
  IconSun,
  IconUndo,
} from './icons';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };

export function TopBar({ onChangeData }: { onChangeData: () => void }) {
  const deckName = useStore((s) => s.deckName);
  const dataset = useStore((s) => s.dataset);
  const table = useStore((s) => s.table);
  const slides = useStore((s) => s.slides.length);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const [exportOpen, setExportOpen] = useState(false);
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
        <button
          type="button"
          className="btn ghost small dataset-chip"
          onClick={onChangeData}
          title="Change dataset"
        >
          <IconDatabase size={14} />
          {dataset.name} · {table.rowCount.toLocaleString()} rows
        </button>
      )}
      <span className="spacer" />
      <button
        type="button"
        className="btn icon ghost small"
        aria-label="Undo"
        title={`Undo (${MOD}Z)`}
        disabled={!canUndo}
        onClick={undo}
      >
        <IconUndo size={15} />
      </button>
      <button
        type="button"
        className="btn icon ghost small"
        aria-label="Redo"
        title={`Redo (${MOD}Shift+Z)`}
        disabled={!canRedo}
        onClick={redo}
      >
        <IconRedo size={15} />
      </button>
      <span className="divider" />
      <button
        type="button"
        className="btn ghost small"
        title="Open a deck (.datadeck.json) or data file (CSV/TSV)"
        onClick={() => pickFile('.json,.csv,.tsv,.txt', (f) => void openFile(f))}
      >
        <IconFolder size={15} /> Open
      </button>
      <Popover.Root open={exportOpen} onOpenChange={setExportOpen}>
        <Popover.Trigger asChild>
          <button type="button" className="btn ghost small" disabled={!dataset}>
            <IconDownload size={15} /> Export
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="popover" side="bottom" align="end" sideOffset={6}>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setExportOpen(false);
                exportDeck();
              }}
            >
              <IconFile size={15} /> Deck file (.datadeck.json)
            </button>
            <button
              type="button"
              className="menu-item"
              disabled={!slides}
              onClick={() => {
                setExportOpen(false);
                void exportPdf();
              }}
            >
              <IconDownload size={15} /> PDF — all slides
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setExportOpen(false);
                void exportPng();
              }}
            >
              <IconImage size={15} /> PNG — current view
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <button
        type="button"
        className="btn icon ghost small"
        title={`Theme: ${theme}`}
        aria-label={`Theme: ${theme}. Switch theme`}
        onClick={() => useStore.setState({ theme: NEXT_THEME[theme] })}
      >
        <ThemeIcon size={15} />
      </button>
      <button
        type="button"
        className="btn primary"
        disabled={!slides}
        title="Present (P)"
        onClick={() => startPresentation()}
      >
        <IconPlay size={14} /> Present
      </button>
    </header>
  );
}
