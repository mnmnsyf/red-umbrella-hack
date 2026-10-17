import { Html, Line } from '@react-three/drei';
import { DoubleSide, Quaternion, Vector3 } from 'three';
import { headingAt, positionAt } from '../lib/interp';
import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import type { ScenarioEvent } from '../types';
import { seabedDepthAt } from './Seabed';

const SCAN_RADIUS = 28;
const RESULT_CHIPS = {
  undetermined: { text: 'Undetermined', color: COLORS.approval },
  suspicious: { text: 'Suspicious', color: COLORS.approval },
  clear: { text: 'Clear', color: COLORS.automatic },
  identified: { text: 'Identified', color: COLORS.automatic },
} as const;

export default function DroneBoat() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  if (!scenario) return null;

  const path = scenario.droneBoat.path;
  const [x, y, z] = positionAt(path, t);
  const yaw = headingAt(path, t) - Math.PI / 2;
  const nextIndex = path.findIndex((frame) => frame.t > t);
  const previous = path[nextIndex - 1];
  const next = path[nextIndex];
  const moving = previous && next && previous.pos.some((value, axis) => value !== next.pos[axis]);

  let activeScan: Extract<ScenarioEvent, { type: 'scan' }> | undefined;
  let completedScan: Extract<ScenarioEvent, { type: 'scan' }> | undefined;
  for (const event of scenario.events) {
    if (event.type !== 'scan' || t < event.t) continue;
    if (t < event.t + event.dur) {
      if (!activeScan || event.t > activeScan.t) activeScan = event;
    } else if (!completedScan || event.t > completedScan.t) {
      completedScan = event;
    }
  }

  const [intruderX, , intruderZ] = positionAt(scenario.intruder.path, t);
  const scanTop = new Vector3(x, y * VEXAG - 2, z);
  const scanBottom = new Vector3(
    intruderX,
    seabedDepthAt(intruderX, intruderZ) * VEXAG + 2,
    intruderZ,
  );
  const scanAxis = scanTop.clone().sub(scanBottom);
  const scanLength = scanAxis.length();
  const scanRotation = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    scanAxis.normalize(),
  );
  const scanCenter = scanTop.clone().add(scanBottom).multiplyScalar(0.5);
  const scanProgress = activeScan ? (t - activeScan.t) / activeScan.dur : 0;
  const sweepFraction = Math.max(0.03, 1 - Math.abs(2 * scanProgress - 1));
  const sweepCenter = scanTop.clone().lerp(scanBottom, sweepFraction);
  const chip = completedScan ? RESULT_CHIPS[completedScan.result] : null;

  return (
    <>
      <group position={[x, y * VEXAG, z]} rotation-y={yaw}>
        <mesh>
          <boxGeometry args={[14, 4, 6]} />
          <meshStandardMaterial color={COLORS.acoustic} roughness={0.55} />
        </mesh>
        <mesh position={[0, 5, 0]}>
          <cylinderGeometry args={[0.45, 0.45, 7, 8]} />
          <meshStandardMaterial color={COLORS.acoustic} roughness={0.55} />
        </mesh>
      </group>
      {moving && (
        <Line
          points={[
            [x, y * VEXAG + 1, z],
            [next.pos[0], next.pos[1] * VEXAG + 1, next.pos[2]],
          ]}
          color={COLORS.acoustic}
          transparent
          opacity={0.25}
          lineWidth={1}
          dashed
          dashSize={8}
          gapSize={8}
        />
      )}
      {activeScan && (
        <>
          <mesh position={scanCenter} quaternion={scanRotation} scale={[SCAN_RADIUS, scanLength, SCAN_RADIUS]}>
            <coneGeometry args={[1, 1, 32, 1, true]} />
            <meshBasicMaterial
              color={COLORS.acoustic}
              transparent
              opacity={0.18}
              side={DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh position={sweepCenter} rotation-x={-Math.PI / 2} scale={SCAN_RADIUS * sweepFraction}>
            <ringGeometry args={[0.96, 1, 48]} />
            <meshBasicMaterial
              color={COLORS.acoustic}
              transparent
              opacity={0.7}
              side={DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
      {!activeScan && chip && (
        <Html position={[x, y * VEXAG + 14, z]} center>
          <div style={{
            padding: '4px 7px',
            border: `1px solid ${chip.color}`,
            borderRadius: 5,
            background: COLORS.background,
            color: chip.color,
            font: '12px Inter, system-ui, sans-serif',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}>
            {chip.text}
          </div>
        </Html>
      )}
    </>
  );
}
