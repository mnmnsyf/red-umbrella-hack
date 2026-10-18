import type { CSSProperties } from 'react';
import { summarizeIncident } from '../lib/incident';
import { usePlaybackStore } from '../store';

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function fade(progress: number): number {
  return Math.max(0, Math.min(1, progress));
}

export default function IncidentReport() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  const resolved = scenario?.events.find((event) => event.type === 'resolved' && event.t <= t);
  if (!scenario || !resolved || resolved.type !== 'resolved') return null;

  const summary = summarizeIncident(scenario, resolved.t);
  const dt = t - resolved.t;
  const entry = fade(dt / 0.6);
  const isResolved = dt >= 2.4 || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const statsStart = 0.6 + summary.rows.length * 0.15;
  const cardStyle = {
    opacity: entry,
    transform: `translate(-50%, calc(-50% + ${12 * (1 - entry)}px))`,
  } satisfies CSSProperties;

  return (
    <section className={`hud-panel incident-report${isResolved ? ' resolved' : ' active'}`} style={cardStyle} aria-label="Incident report">
      <header className="incident-report-header">
        <div>
          <div className="incident-report-source"><strong>{resolved.incidentId}</strong> {resolved.detector}</div>
          <h2>{resolved.title}</h2>
          <p>Identified: {resolved.outcome}</p>
        </div>
        <span className="incident-report-status">{isResolved ? 'Resolved' : 'Active'}</span>
      </header>
      <div className="incident-report-timeline">
        {summary.rows.map((row, index) => (
          <div
            className={`incident-report-row ${row.by}`}
            key={`${row.t}-${index}`}
            style={{ opacity: fade((dt - 0.6 - index * 0.15) / 0.15) }}
          >
            <time>T+{formatTime(row.t)}</time>
            <span className="incident-report-event">{row.text}</span>
            <span className="incident-report-by">{row.by === 'auto' ? 'AUTO' : 'OFFICER'}</span>
          </div>
        ))}
      </div>
      <footer className="incident-report-stats" style={{ opacity: fade((dt - statsStart) / 0.3) }}>
        <div><strong>{summary.officerDecisions}</strong><span>Officer decisions</span></div>
        <div><strong>{summary.automatedSteps}</strong><span>Automated steps</span></div>
        <div><strong>{summary.alertToIdentified === null ? '—' : formatTime(summary.alertToIdentified)}</strong><span>Alert → identified</span></div>
      </footer>
    </section>
  );
}
