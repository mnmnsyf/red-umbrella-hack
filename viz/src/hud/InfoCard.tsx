import { distanceToZone } from '../lib/geo';
import { headingAt, positionAt } from '../lib/interp';
import { usePlaybackStore, type Selection } from '../store';
import { COLORS } from '../theme';
import type { Keyframe, Scenario, Vec3, Zone } from '../types';
import { displayPositionOf } from '../scene/selectable';
import { seabedDepthAt } from '../scene/Seabed';

type Row = [label: string, value: string];
type Card = { type: string; title: string; subtitle?: string; rows: Row[]; status: string; color: string };

function formatTime(seconds: number): string {
  const whole = Math.ceil(Math.max(0, seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function speed(path: Keyframe[], t: number): string {
  const now = positionAt(path, t);
  const before = positionAt(path, t - 1);
  const meters = Math.hypot(now[0] - before[0], now[2] - before[2]);
  return `${meters.toFixed(1)} m/s · ${(meters * 1.944).toFixed(1)} kn`;
}

function horizontalDistance(a: Vec3, b: Vec3): string {
  return `${Math.round(Math.hypot(a[0] - b[0], a[2] - b[2]))} m`;
}

function latestEvent<T extends Scenario['events'][number]['type']>(scenario: Scenario, type: T, t: number) {
  return scenario.events.filter((event): event is Extract<Scenario['events'][number], { type: T }> =>
    event.type === type && event.t <= t).sort((a, b) => b.t - a.t)[0];
}

function reach(position: Vec3, zone: Zone, scenario: Scenario): string {
  return scenario.vMax > 0 ? formatTime(distanceToZone(position, zone) / scenario.vMax) : '—';
}

function cardFor(selection: Selection, scenario: Scenario, t: number): Card | null {
  const displayPosition = displayPositionOf(selection, scenario, t);
  if (!displayPosition) return null;
  const contact = positionAt(scenario.intruder.path, t);
  const contactVisible = t >= scenario.intruder.visibleFrom;

  switch (selection.kind) {
    case 'hydrophone': {
      const hydrophone = scenario.hydrophones.find((item) => item.id === selection.id);
      if (!hydrophone) return null;
      const [x, , z] = hydrophone.pos;
      const hear = scenario.events.filter((event) => event.type === 'hear' && event.hydrophone === selection.id && event.t <= t)
        .sort((a, b) => b.t - a.t)[0];
      return {
        type: 'HYDROPHONE', title: hydrophone.id,
        rows: [
          ['Depth', `${Math.abs(seabedDepthAt(x, z)).toFixed(1)} m`],
          ['Status', hear ? `Heard contact at T+${formatTime(hear.t)}` : 'Listening'],
          ['Distance to contact', contactVisible ? horizontalDistance(displayPosition, contact) : '—'],
        ],
        status: hear ? 'Contact' : 'Quiet', color: hear ? COLORS.protectedZone : COLORS.acoustic,
      };
    }
    case 'contact': {
      const reveal = latestEvent(scenario, 'reveal', t);
      const scan = scenario.events.filter((event): event is Extract<Scenario['events'][number], { type: 'scan' }> =>
        event.type === 'scan' && event.t + event.dur <= t)
        .sort((a, b) => b.t - a.t)[0];
      const zone = scenario.zones[0];
      return {
        type: 'CONTACT', title: reveal?.text ?? 'Unknown contact',
        rows: [
          ['Depth', `${Math.abs(contact[1]).toFixed(1)} m`],
          ['Speed', speed(scenario.intruder.path, t)],
          ...(zone ? [[`Distance to ${zone.name}`, `${Math.round(distanceToZone(contact, zone))} m`],
            ['Time to reach (no response)', reach(contact, zone, scenario)]] as Row[] : []),
          ['Classification', scan?.result ?? 'Not yet inspected'],
        ],
        status: reveal ? 'Identified' : 'Unconfirmed', color: reveal ? COLORS.automatic : COLORS.approval,
      };
    }
    case 'drone': {
      const task = scenario.events.filter((event): event is Extract<Scenario['events'][number], { type: 'action' }> =>
        event.type === 'action' && event.mode === 'auto' && event.t <= t)
        .sort((a, b) => b.t - a.t)[0];
      const scan = latestEvent(scenario, 'scan', t);
      const scanText = scan
        ? t < scan.t + scan.dur
          ? `Scanning… ${Math.round(((t - scan.t) / scan.dur) * 100)}%`
          : scan.result
        : '—';
      return {
        type: 'DRONE BOAT', title: 'Drone boat',
        rows: [
          ['Task', task?.text ?? 'Standing by'],
          ['Distance to contact', horizontalDistance(displayPosition, contact)],
          ['Speed', speed(scenario.droneBoat.path, t)],
          ['Scan', scanText],
        ],
        status: 'Autonomous', color: COLORS.automatic,
      };
    }
    case 'ferry': {
      const boat = scenario.surfaceBoats.find((item) => item.id === selection.id);
      if (!boat) return null;
      const heading = headingAt(boat.path, t);
      const compass = ((Math.round(Math.atan2(-Math.sin(heading), Math.cos(heading)) * 180 / Math.PI) % 360) + 360) % 360;
      return {
        type: 'FERRY', title: 'Passenger ferry', subtitle: boat.id,
        rows: [['Speed', speed(boat.path, t)], ['Heading', `${compass}°`], ['Note', 'Normal harbor traffic']],
        status: 'No action', color: COLORS.neutral,
      };
    }
    case 'zone': {
      const zone = scenario.zones.find((item) => item.name === selection.id);
      if (!zone) return null;
      const seconds = scenario.vMax > 0 ? distanceToZone(contact, zone) / scenario.vMax : Infinity;
      return {
        type: 'PROTECTED ZONE', title: zone.name,
        rows: [
          ['Contact distance', contactVisible ? `${Math.round(distanceToZone(contact, zone))} m` : '—'],
          ['Time to reach (no response)', contactVisible && Number.isFinite(seconds) ? formatTime(seconds) : '—'],
          ['Size', `${zone.max[0] - zone.min[0]} × ${zone.max[1] - zone.min[1]} m`],
        ],
        status: contactVisible && seconds < 60 ? 'At risk' : 'Protected',
        color: contactVisible && seconds < 60 ? COLORS.protectedZone : COLORS.acoustic,
      };
    }
    case 'lighthouse':
      return {
        type: 'LIGHTHOUSE', title: 'Angels Gate Light',
        rows: [['Location', 'Port of Los Angeles entrance'], ['Light', 'Green flash every 15 s'], ['Built', '1913']],
        status: 'Landmark', color: COLORS.neutral,
      };
  }
}

export default function InfoCard() {
  const selection = usePlaybackStore((state) => state.selection);
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  const freeCamera = usePlaybackStore((state) => state.freeCamera);
  const backToDirector = usePlaybackStore((state) => state.backToDirector);
  const card = selection && scenario ? cardFor(selection, scenario, t) : null;

  return (
    <>
      {card && (
        <section className="hud-panel info-card" aria-label={`${card.type} details`}>
          <button type="button" className="info-close" aria-label="Close information card" onClick={backToDirector}>×</button>
          <span className="info-type">{card.type}</span>
          <h2>{card.title}</h2>
          {card.subtitle && <span className="info-subtitle">{card.subtitle}</span>}
          <dl className="info-rows">
            {card.rows.map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <span className="info-chip" style={{ color: card.color, borderColor: card.color }}>{card.status}</span>
          <button type="button" className="info-back" onClick={backToDirector}>Back to director view</button>
        </section>
      )}
      {freeCamera && !card && (
        <button type="button" className="hud-panel free-camera-back" onClick={backToDirector}>Back to director view</button>
      )}
    </>
  );
}
