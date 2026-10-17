import { usePlaybackStore } from '../store';
import type { ScenarioEvent } from '../types';

type ActionEvent = Extract<ScenarioEvent, { type: 'action' }>;

const MODE_LABELS: Record<ActionEvent['mode'], string> = {
  auto: 'AUTO',
  approval: 'NEEDS OFFICER',
  approved: 'APPROVED',
};

function formatTime(seconds: number): string {
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

export default function ActionLog() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  const actions = scenario?.events
    .map((event, index) => ({ event, index }))
    .filter((entry): entry is { event: ActionEvent; index: number } => entry.event.type === 'action' && entry.event.t <= t)
    .sort((a, b) => b.event.t - a.event.t || b.index - a.index) ?? [];

  if (actions.length === 0) return null;

  return (
    <section className="hud-panel action-log" aria-label="Action log">
      <div className="action-log-head">
        <h2>Event log</h2>
        <span className="label">{actions.length} {actions.length === 1 ? 'action' : 'actions'}</span>
      </div>
      <p className="action-legend">Green = system decides · Amber = officer decides</p>
      <div className="action-list">
        {actions.map(({ event, index }) => (
          <div className="action-item" key={index}>
            <time className="action-time">{formatTime(event.t)}</time>
            <div className="action-content">
              <span className={`action-chip ${event.mode}`}>{MODE_LABELS[event.mode]}</span>
              <span className="action-text">{event.text}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
