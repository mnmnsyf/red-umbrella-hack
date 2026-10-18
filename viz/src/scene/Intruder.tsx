import { Html } from '@react-three/drei';
import { headingAt, positionAt } from '../lib/interp';
import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import type { ScenarioEvent } from '../types';
import Model, { MODEL_URLS } from './Model';
import AlertMarker from './fx/AlertMarker';
import ContactRings from './fx/ContactRings';
import TrackTrail from './fx/TrackTrail';
import Pickable from './Pickable';

const TRAIL_SECONDS = 60;

export default function Intruder() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  if (!scenario || t < scenario.intruder.visibleFrom) return null;

  const path = scenario.intruder.path;
  const [x, y, z] = positionAt(path, t);
  const yaw = headingAt(path, t) - Math.PI / 2;
  let reveal: Extract<ScenarioEvent, { type: 'reveal' }> | undefined;
  let estimate: Extract<ScenarioEvent, { type: 'estimate' }> | undefined;
  const resolvedTime = scenario.events.find((event) => event.type === 'resolved')?.t;
  for (const event of scenario.events) {
    if (event.t > t) continue;
    if (event.type === 'reveal' && (!reveal || event.t > reveal.t)) reveal = event;
    if (event.type === 'estimate' && (!estimate || event.t < estimate.t)) estimate = event;
  }

  return (
    <>
      <TrackTrail
        path={path}
        t={t}
        startTime={scenario.intruder.visibleFrom}
        tailDuration={TRAIL_SECONDS}
        color={COLORS.intruder}
        opacity={reveal ? 0.6 : 0.4}
        width={3}
      />
      <ContactRings position={[x, y, z]} t={t} resolvedTime={resolvedTime} color={reveal ? COLORS.automatic : COLORS.protectedZone} />
      {estimate && !reveal && <AlertMarker position={[x, y, z]} t={t} startTime={estimate.t} radius={30} height={90} />}
      <group position={[x, y * VEXAG, z]}>
        <Pickable selection={{ kind: 'contact', id: 'contact' }} radius={30}>
        <group rotation-y={yaw}>
        {!reveal && (
          <mesh>
            <sphereGeometry args={[11, 16, 12]} />
            <meshBasicMaterial
              color={COLORS.intruder}
              transparent
              opacity={0.055}
              depthWrite={false}
            />
          </mesh>
        )}
        <Model url={MODEL_URLS.auv} length={22} sink={0.5} opacity={reveal ? 1 : 0.55} />
        {reveal && (
          <Html position={[0, 14, 0]} center zIndexRange={[10, 0]}>
            <div className="scene-label callout" style={{ borderLeftColor: COLORS.automatic }}>
              {reveal.text}
            </div>
          </Html>
        )}
        </group>
        </Pickable>
      </group>
    </>
  );
}
