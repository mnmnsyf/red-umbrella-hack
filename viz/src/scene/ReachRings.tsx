import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { distanceToZone } from '../lib/geo';
import { positionAt } from '../lib/interp';
import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import type { Vec3, Zone } from '../types';

const REACH_SECONDS = [60, 120, 180];
const CIRCLE_SEGMENTS = 96;

function ringTouchesZone(pos: Vec3, radius: number, zone: Zone): boolean {
  const farthestCorner = Math.max(
    ...[zone.min[0], zone.max[0]].flatMap((x) =>
      [zone.min[1], zone.max[1]].map((z) => Math.hypot(x - pos[0], z - pos[2])),
    ),
  );
  return distanceToZone(pos, zone) <= radius && radius <= farthestCorner;
}

function ReachRing({ seconds, vMax, pos, zones }: { seconds: number; vMax: number; pos: Vec3; zones: Zone[] }) {
  const radius = vMax * seconds;
  const points = useMemo(() => Array.from({ length: CIRCLE_SEGMENTS + 1 }, (_, index) => {
    const angle = index * Math.PI * 2 / CIRCLE_SEGMENTS;
    return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius] as Vec3;
  }), [radius]);
  const color = zones.some((zone) => ringTouchesZone(pos, radius, zone))
    ? COLORS.protectedZone
    : COLORS.neutral;

  return (
    <group position={[pos[0], pos[1] * VEXAG, pos[2]]}>
      <Line points={points} color={color} transparent opacity={0.3} lineWidth={1} />
      <Html position={[radius, 8, 0]} center zIndexRange={[10, 0]}>
        <div className="scene-label" style={{ color, border: 0, background: 'transparent', boxShadow: 'none' }}>
          {seconds / 60} min
        </div>
      </Html>
    </group>
  );
}

export default function ReachRings() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  if (!scenario || scenario.truthVisible === false) return null;

  const locateStart = scenario.events.find((event) => event.type === 'phase' && event.phase === 'LOCATE')?.t;
  if (locateStart === undefined || t < locateStart) return null;

  const pos = positionAt(scenario.intruder.path, t);
  return (
    <>
      {REACH_SECONDS.map((seconds) => (
        <ReachRing key={seconds} seconds={seconds} vMax={scenario.vMax} pos={pos} zones={scenario.zones} />
      ))}
    </>
  );
}
