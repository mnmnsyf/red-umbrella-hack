import { Html } from '@react-three/drei';
import { headingAt, positionAt } from '../lib/interp';
import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import type { ScenarioEvent } from '../types';
import AlertMarker from './fx/AlertMarker';
import TrackTrail from './fx/TrackTrail';

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

  return (
    <>
      <TrackTrail
        path={path}
        t={t}
        startTime={scenario.intruder.visibleFrom}
        tailDuration={TRAIL_SECONDS}
        color={COLORS.intruder}
        opacity={reveal ? 0.5 : 0.25}
        width={3}
      />
      {estimate && !reveal && <AlertMarker position={[x, y, z]} t={t} startTime={estimate.t} radius={30} height={90} />}
      <group position={[x, y * VEXAG, z]} rotation-y={yaw}>
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
        <mesh rotation-z={Math.PI / 2} scale={3}>
          <capsuleGeometry args={[0.8, 4.4, 4, 8]} />
          <meshStandardMaterial
            color={COLORS.intruder}
            transparent={!reveal}
            opacity={reveal ? 1 : 0.25}
            depthWrite={Boolean(reveal)}
            roughness={0.65}
          />
        </mesh>
        {reveal && (
          <Html position={[0, 14, 0]} center>
            <div
              style={{
                padding: '5px 8px',
                border: `1px solid ${COLORS.neutral}`,
                borderRadius: 5,
                background: COLORS.background,
                color: COLORS.intruder,
                font: '12px Inter, system-ui, sans-serif',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              {reveal.text}
            </div>
          </Html>
        )}
      </group>
    </>
  );
}
