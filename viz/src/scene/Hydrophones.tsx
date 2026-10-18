import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import { seabedDepthAt } from './Seabed';
import SonarPing from './fx/SonarPing';
import Pickable from './Pickable';

const PULSE_DURATION = 4;
const PULSE_RADIUS = 450;
const PINGER_INTERVAL = 3;

export default function Hydrophones() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  if (!scenario) return null;

  return (
    <>
      {scenario.hydrophones.map((hydrophone) => {
        const [x, , z] = hydrophone.pos;
        const seabedY = seabedDepthAt(x, z) * VEXAG;
        return (
          <group key={hydrophone.id} position={[x, seabedY, z]}>
            <Pickable selection={{ kind: 'hydrophone', id: hydrophone.id }} radius={30} ringY={2}>
            <mesh position={[0, 4, 0]}>
              <cylinderGeometry args={[3, 4, 8, 12]} />
              <meshStandardMaterial color={COLORS.acoustic} roughness={0.5} />
            </mesh>
            <mesh position={[0, 5, 0]}>
              <sphereGeometry args={[9, 16, 12]} />
              <meshBasicMaterial color={COLORS.acoustic} transparent opacity={0.18} depthWrite={false} />
            </mesh>
            </Pickable>
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
