import { usePlaybackStore } from '../store';

export default function HandoffBanner() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  const banner = scenario?.events
    .filter((event) => event.type === 'banner' && event.style === 'handoff' && event.t <= t)
    .sort((a, b) => b.t - a.t)[0];

  if (!banner || banner.type !== 'banner') return null;

  return <div className="hud-panel handoff-banner" role="status">{banner.text}</div>;
}
