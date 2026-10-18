import { usePlaybackStore } from '../store';
import type { Phase } from '../types';

const SUMMARY: Record<Phase, string> = {
  NONE: 'Harbour quiet. All hydrophones listening.',
  DETECT: 'Persistent unusual acoustic event. Possible intrusion. Not confirmed; verify.',
  LOCATE: 'Source triangulated from three hydrophones. Not confirmed; verify.',
  INSPECT: 'Drone boat dispatched to observe the contact.',
  HANDOFF: 'Officer decision needed before the contact nears the terminal.',
};

export default function ThreatCard() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  if (!scenario) return null;

  let phase: Phase = 'NONE';
  let score: number | null = null;
  let revealed = false;
  let resolved: Extract<typeof scenario.events[number], { type: 'resolved' }> | undefined;
  for (const event of scenario.events) {
    if (event.t > t) continue;
    if (event.type === 'phase') phase = event.phase;
    if (event.type === 'reveal') revealed = true;
    if (event.type === 'resolved') resolved = event;
    if (event.type === 'label') {
      const match = event.text.match(/score\s+([\d.]+)/i);
      if (match) score = Number(match[1]);
    }
  }

  const text = scenario.text;
  const state = resolved ? 'normal' : revealed ? 'watch' : phase === 'NONE' ? 'normal' : 'alert';
  const level = state === 'normal' ? 'NORMAL' : state === 'watch' ? 'WATCH' : 'ALERT';
  const summary = resolved
    ? `Incident ${resolved.incidentId} resolved. Harbour quiet. All hydrophones listening.`
    : revealed
      ? 'Contact identified as a lost research AUV. No threat. Closing incident.'
      : text?.summaries?.[phase] ?? SUMMARY[phase];

  return (
    <section className={`hud-panel threat-card ${state}`} aria-label="Threat level">
      <span className="label">Threat level</span>
      <div className="level">{level}</div>
      <div className="summary">{summary}</div>
      <div className="stats">
        <div><span className="label">Anomaly score</span><strong>{resolved ? '—' : score?.toFixed(1) ?? '—'}</strong></div>
        <div><span className="label">Phase</span><strong>{resolved ? 'Resolved' : phase === 'NONE' ? 'Watch' : phase[0] + phase.slice(1).toLowerCase()}</strong></div>
      </div>
    </section>
  );
}
