import { getEngine } from '../engine/instance';
import { useStore } from '../state/store';
import { IconPause, IconPlay } from './icons';

export function TsneProgress() {
  const isTsne = useStore((s) => s.view.layout.mode === 'tsne');
  const status = useStore((s) => s.tsneStatus);
  if (!isTsne || !['preparing', 'running', 'paused'].includes(status.state)) return null;
  const pct = status.total ? (status.iteration / status.total) * 100 : 0;
  return (
    <div className="progress-pill" role="status">
      <span>
        {status.state === 'preparing'
          ? 'Preparing t-SNE…'
          : `t-SNE ${status.iteration.toLocaleString()} / ${status.total.toLocaleString()}`}
      </span>
      <span className="progress-bar">
        <i style={{ width: `${pct}%` }} />
      </span>
      {status.state === 'paused' ? (
        <button
          type="button"
          className="btn icon small ghost"
          aria-label="Resume t-SNE"
          onClick={() => getEngine()?.resumeTsne()}
        >
          <IconPlay size={14} />
        </button>
      ) : (
        <button
          type="button"
          className="btn icon small ghost"
          aria-label="Pause t-SNE"
          disabled={status.state !== 'running'}
          onClick={() => getEngine()?.pauseTsne()}
        >
          <IconPause size={14} />
        </button>
      )}
    </div>
  );
}
