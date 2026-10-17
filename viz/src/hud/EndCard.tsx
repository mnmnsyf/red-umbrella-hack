import { usePlaybackStore } from '../store';

export default function EndCard() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  const endcard = scenario?.events
    .filter((event) => event.type === 'endcard' && event.t <= t)
    .sort((a, b) => b.t - a.t)[0];

  if (!endcard || endcard.type !== 'endcard') return null;

  return (
    <section className="hud-panel end-card" aria-label="Outcome">
      {endcard.lines.map((line, index) => <p key={index}>{line}</p>)}
    </section>
  );
}
