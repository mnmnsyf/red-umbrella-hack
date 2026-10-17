import { Html, Line } from '@react-three/drei';
import { DoubleSide } from 'three';
import { positionAt } from '../lib/interp';
import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import type { ScenarioEvent, Vec3 } from '../types';
import { seabedDepthAt } from './Seabed';
import BearingLine from './fx/BearingLine';
import EstimateDisk from './fx/EstimateDisk';

const BEARING_LENGTH = 1500;

function noiseFor(id: string): number {
  let seed = 2166136261;
  for (const character of id) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  seed = Math.imul(seed ^ (seed >>> 16), 2246822507);
  seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
  return ((seed ^ (seed >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
}

export default function BearingLines() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  if (!scenario) return null;

  let bearings: Extract<ScenarioEvent, { type: 'bearings' }> | undefined;
  let estimate: Extract<ScenarioEvent, { type: 'estimate' }> | undefined;
  let label: Extract<ScenarioEvent, { type: 'label' }> | undefined;
  let firstHear: Extract<ScenarioEvent, { type: 'hear' }> | undefined;
  let revealTime = Infinity;
  for (const event of scenario.events) {
    if (event.t > t) continue;
    if (event.type === 'hear' && (!firstHear || event.t < firstHear.t)) firstHear = event;
    if (event.type === 'bearings' && (!bearings || event.t > bearings.t)) bearings = event;
    if (event.type === 'estimate' && (!estimate || event.t > estimate.t)) estimate = event;
    if (event.type === 'label' && (!label || event.t > label.t)) label = event;
    if (event.type === 'reveal') revealTime = Math.min(revealTime, event.t);
  }

  const truePosition = bearings ? positionAt(scenario.intruder.path, bearings.t) : null;
  const bearingOpacity = bearings ? Math.min(1, (t - bearings.t) / 2) : 0;
  const firstHydrophone = scenario.hydrophones.find((hydrophone) => hydrophone.id === firstHear?.hydrophone);
  const labelPosition: Vec3 = t >= revealTime
    ? positionAt(scenario.intruder.path, t)
    : estimate?.pos ?? (firstHydrophone
      ? [firstHydrophone.pos[0], seabedDepthAt(firstHydrophone.pos[0], firstHydrophone.pos[2]), firstHydrophone.pos[2]]
      : positionAt(scenario.intruder.path, t));

  return (
    <>
      {truePosition && scenario.hydrophones.map((hydrophone) => {
        const [x, , z] = hydrophone.pos;
        const angle = Math.atan2(truePosition[2] - z, truePosition[0] - x)
          + noiseFor(hydrophone.id) * bearings!.noiseDeg * Math.PI / 180;
        return (
          <BearingLine
            key={hydrophone.id}
            position={[x, seabedDepthAt(x, z) + 1.25, z]}
            bearingDeg={90 - angle * 180 / Math.PI}
            length={BEARING_LENGTH}
            opacity={bearingOpacity}
          />
        );
      })}

      {estimate && (
        <group position={[estimate.pos[0], estimate.pos[1] * VEXAG, estimate.pos[2]]}>
          <mesh rotation-x={-Math.PI / 2} position-y={1}>
            <ringGeometry args={[4, 6, 32]} />
            <meshBasicMaterial color={COLORS.acoustic} side={DoubleSide} depthWrite={false} />
          </mesh>
          <Line
            points={[[0, 0, 0], [0, -estimate.pos[1] * VEXAG, 0]]}
            color={COLORS.acoustic}
            transparent
            opacity={0.5}
            lineWidth={1}
          />
        </group>
      )}
      {estimate && (
        <EstimateDisk
          position={estimate.pos}
          startTime={estimate.t}
          t={t}
          radius={estimate.radius}
          shrinkTo={estimate.shrinkTo}
          shrinkDur={estimate.shrinkDur}
        />
      )}
      {label && (
        <Html position={[labelPosition[0], labelPosition[1] * VEXAG + 24, labelPosition[2]]} center zIndexRange={[10, 0]}>
          <div className="scene-label callout">
            {label.text}
          </div>
        </Html>
      )}
    </>
  );
}
