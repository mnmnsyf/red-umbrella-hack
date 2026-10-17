import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import { seabedDepthAt } from './Seabed';
import Callout from './fx/Callout';
import SonarPing from './fx/SonarPing';
import Pickable from './Pickable';

const PULSE_DURATION = 4;
const PULSE_RADIUS = 450;
const PINGER_INTERVAL = 3;

export default function Hydrophones() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  if (!scenario) return null;
  // Hydrophone tags matter while the array detects and locates; afterwards they only crowd the contact.
  const inspectAt = scenario.events.find((event) => event.type === 'phase' && event.phase === 'INSPECT')?.t ?? Infinity;
  const showTags = t < inspectAt;

  return (
    <>
      {scenario.hydrophones.map((hydrophone) => {
        const [x, , z] = hydrophone.pos;
        const seabedY = seabedDepthAt(x, z) * VEXAG;
        return (
          <group key={hydrophone.id}>
            <group position={[x, seabedY, z]}>
              <Pickable selection={{ kind: 'hydrophone', id: hydrophone.id }} radius={30} ringY={2}>
              <mesh position={[0, 9, 0]} renderOrder={10}>
                <cylinderGeometry args={[6, 8, 18, 16]} />
                <meshStandardMaterial color={COLORS.acoustic} roughness={0.5} transparent />
              </mesh>
              <mesh position={[0, 10, 0]} renderOrder={10}>
                <sphereGeometry args={[18, 20, 14]} />
                <meshBasicMaterial color={COLORS.acoustic} transparent opacity={0.16} depthWrite={false} />
              </mesh>
              </Pickable>
            </group>
            {showTags && <Callout position={[x, seabedY / VEXAG, z]} label={hydrophone.id} detail="Hydrophone" color={COLORS.acoustic} height={45} />}
          </group>
        );
      })}
      {scenario.events.map((event, index) => {
        if (event.type !== 'hear') return null;
        const hydrophone = scenario.hydrophones.find((item) => item.id === event.hydrophone);
        if (!hydrophone) return null;
        const [x, , z] = hydrophone.pos;
        return (
          <SonarPing
            key={index}
            position={[x, seabedDepthAt(x, z) + 1, z]}
            startTime={event.t}
            t={t}
            rhythm={event.rhythm}
            duration={event.rhythm === 'pinger' ? PINGER_INTERVAL : PULSE_DURATION}
            maxRadius={PULSE_RADIUS}
          />
        );
      })}
    </>
  );
}
