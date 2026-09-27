import { useState } from 'react';
import { SAMPLES, loadSample, type SampleInfo } from '../data/samples';
import { loadDataset, useStore } from '../state/store';
import { openFile, pickFile } from './actions';
import { BrandMark, IconFolder, IconUpload, IconX } from './icons';

export function Welcome({ compact, onDone }: { compact?: boolean; onDone?: () => void }) {
  const [over, setOver] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const error = useStore((s) => s.error);

  const open = async (sample: SampleInfo) => {
    setLoading(sample.file);
    try {
      loadDataset(await loadSample(sample));
      onDone?.();
    } catch (err) {
      useStore.setState({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(null);
    }
  };

  const handleFile = async (f: File) => {
    await openFile(f);
    if (!useStore.getState().error) onDone?.();
  };

  return (
    <div className="welcome-inner">
      {!compact && (
        <div className="welcome-hero">
          <div>
            <div className="brand" style={{ fontSize: 16 }}>
              <BrandMark size={28} /> DataDeck
            </div>
            <h1>Turn a dataset into a living presentation.</h1>
            <p className="lede">
              Every row becomes a bubble in a live force layout. Explore dimensions, filter and annotate, then
              snapshot each view into a slide — and present them with seamless, animated transitions.
            </p>
          </div>
          <HeroArt />
        </div>
      )}
      {compact && <h2 style={{ margin: '0 0 18px', fontSize: 20 }}>Choose a dataset</h2>}

      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            type="button"
            className="btn icon ghost small"
            aria-label="Dismiss"
            onClick={() => useStore.setState({ error: null })}
          >
            <IconX size={14} />
          </button>
        </div>
      )}

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void handleFile(f);
        }}
      >
        <div className="dropzone-icon">
          <IconUpload size={22} />
        </div>
        <div>
          <h3>Drop a CSV or TSV file</h3>
          <p>The first row should contain column names. Works best with up to a few thousand rows.</p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => pickFile('.csv,.tsv,.txt', (f) => void handleFile(f))}
          >
            <IconUpload size={15} /> Upload data
          </button>
          <button type="button" className="btn" onClick={() => pickFile('.json', (f) => void handleFile(f))}>
            <IconFolder size={15} /> Open deck
          </button>
        </div>
      </div>

      <h3 className="samples-title">Or start with a sample</h3>
      <div className="samples">
        {SAMPLES.map((s) => (
          <button
            key={s.file}
            type="button"
            className="sample-card"
            disabled={!!loading}
            onClick={() => void open(s)}
          >
            <h4>{s.name}</h4>
            <p>{s.description}</p>
            <div className="sample-meta">
              <span>{s.rows.toLocaleString()} rows</span>
              <span>{s.columns} columns</span>
              {loading === s.file && <span>Loading…</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Static decorative illustration of the bubble field. */
function HeroArt() {
  const palette = ['#2a78d6', '#eb6834', '#1baf7a'];
  const dots: { x: number; y: number; r: number; c: string }[] = [];
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const centers = [
    [110, 150],
    [240, 110],
    [300, 210],
  ];
  centers.forEach(([cx, cy], g) => {
    for (let i = 0; i < 46; i++) {
      const a = i * 2.39996;
      const d = 5.2 * Math.sqrt(i + 0.5);
      dots.push({
        x: cx + d * Math.cos(a) + rand() * 2,
        y: cy + d * Math.sin(a) + rand() * 2,
        r: 3 + rand() * 2.2,
        c: palette[g],
      });
    }
  });
  return (
    <svg
      className="hero-art"
      viewBox="0 0 400 300"
      role="img"
      aria-label="Bubbles grouped into three clusters"
    >
      <text x="24" y="36" fontSize="14" fontWeight="700" fill="var(--text-primary)">
        Three clusters, one story
      </text>
      <text x="24" y="54" fontSize="10.5" fill="var(--text-secondary)">
        Snapshot a view · present it live
      </text>
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.c} stroke="var(--surface-1)" strokeWidth="1" />
      ))}
      <path d="M300 180 L330 140 L372 140" fill="none" stroke="var(--text-primary)" strokeWidth="1" />
      <circle cx="300" cy="210" r="34" fill="none" stroke="var(--text-primary)" strokeWidth="1" />
      <text x="332" y="134" fontSize="10.5" fontWeight="600" fill="var(--text-primary)">
        Outliers
      </text>
    </svg>
  );
}
