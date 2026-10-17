import { headingAt, positionAt } from '../lib/interp';
import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';

export default function SurfaceBoats() {
  const boats = usePlaybackStore((state) => state.scenario?.surfaceBoats);
  const t = usePlaybackStore((state) => state.t);

  return (
    <>
      {boats?.map((boat) => {
        const [x, y, z] = positionAt(boat.path, t);
        const yaw = headingAt(boat.path, t) - Math.PI / 2;
        return (
          <mesh key={boat.id} position={[x, y * VEXAG, z]} rotation-y={yaw}>
            <boxGeometry args={[40, 8, 12]} />
            <meshStandardMaterial color={COLORS.neutral} roughness={0.75} />
          </mesh>
        );
      })}
    </>
  );
}
