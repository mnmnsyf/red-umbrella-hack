import { headingAt, positionAt } from '../lib/interp';
import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import type { ScenarioEvent } from '../types';
import Model, { MODEL_URLS } from './Model';
import Callout from './fx/Callout';
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
  for (const event of scenario.events) {
    if (event.t > t) continue;
    if (event.type === 'reveal' && (!reveal || event.t > reveal.t)) reveal = event;
    if (event.type === 'estimate' && (!estimate || event.t < estimate.t)) estimate = event;
  }

  // "Research AUV · Harbor Ocean Lab · lost 2 days" becomes a short name over a smaller detail line.
  const [revealName, ...revealRest] = reveal?.text.split(' · ') ?? [''];
  const revealDetail = revealRest.length ? revealRest.join(' · ') : 'Identified · no threat';

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
      <ContactRings position={[x, y, z]} t={t} color={reveal ? COLORS.automatic : COLORS.protectedZone} />
      <Callout
        position={[x, y, z]}
        label={reveal ? revealName : estimate ? 'Unknown contact' : 'Acoustic contact'}
        detail={reveal ? revealDetail : `${Math.round(-y)} m deep · not confirmed`}
        color={reveal ? COLORS.automatic : COLORS.protectedZone}
        height={120}
      />
      <group position={[x, y * VEXAG, z]}>
        <Pickable selection={{ kind: 'contact', id: 'contact' }} radius={30}>
        <group rotation-y={yaw}>
        {!reveal && (
          <mesh>
            <sphereGeometry args={[20, 16, 12]} />
            <meshBasicMaterial
              color={COLORS.intruder}
              transparent
              opacity={0.08}
              depthWrite={false}
            />
          </mesh>
        )}
        <Model url={MODEL_URLS.auv} length={40} sink={0.5} opacity={reveal ? 1 : 0.7} />
        </group>
        </Pickable>
      </group>
    </>
  );
}
