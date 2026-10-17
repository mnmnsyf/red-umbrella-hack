import { distanceToZone } from '../lib/geo';
import { positionAt } from '../lib/interp';
import { usePlaybackStore } from '../store';

function formatTime(seconds: number): string {
  const whole = Math.ceil(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

export default function Countdown() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  if (!scenario || scenario.zones.length === 0 || scenario.vMax <= 0) return null;

  const locateStart = scenario.events.find((event) => event.type === 'phase' && event.phase === 'LOCATE')?.t;
  const endTime = scenario.events.find((event) => event.type === 'endcard')?.t;
  if (locateStart === undefined || t < locateStart || (endTime !== undefined && t >= endTime)) return null;

  const approval = scenario.events.find((event) => event.type === 'action' && event.mode === 'approved' && event.t <= t);
  const sampleTime = approval?.t ?? t;
  const position = positionAt(scenario.intruder.path, sampleTime);
  const distance = Math.min(...scenario.zones.map((zone) => distanceToZone(position, zone)));
  const remaining = Math.max(0, distance / scenario.vMax - scenario.tHuman);

  return (
    <section className={`hud-panel countdown${remaining < 60 ? ' urgent' : ''}`} aria-label="Decision countdown">
      <span className="label">{approval ? 'Decision made with' : 'Officer must decide in'}</span>
      <strong>{formatTime(remaining)}</strong>
      <span className="label">{approval ? 'to spare' : `before reach of ${scenario.zones[0].name}`}</span>
    </section>
  );
}
