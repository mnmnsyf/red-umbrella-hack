import { useMemo } from 'react';
import { Billboard } from '@react-three/drei';
import { BufferGeometry, Float32BufferAttribute, RingGeometry } from 'three';
import { COLORS } from '../../theme';
import type { Vec3 } from '../../types';
import { scenePosition } from './coordinates';

interface AlertMarkerProps {
  position: Vec3;
  t: number;
  startTime?: number;
  radius?: number;
  height?: number;
}

export default function AlertMarker({ position, t, startTime = 0, radius = 12, height = 60 }: AlertMarkerProps) {
  const ring = useMemo(() => new RingGeometry(0.88, 1, 64), []);
  const stem = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, height, 0], 3));
    return geometry;
  }, [height]);
  if (t < startTime) return null;

  const phase = (t - startTime) * Math.PI * 2;
  const pulse = 0.65 + 0.35 * Math.sin(phase);
  return (
    <group position={scenePosition(position)}>
      <lineSegments geometry={stem} renderOrder={10}>
        <lineBasicMaterial color={COLORS.protectedZone} transparent opacity={0.55} depthTest={false} depthWrite={false} toneMapped={false} />
      </lineSegments>
      <Billboard position={[0, height, 0]}>
        <mesh geometry={ring} scale={radius * (1 + 0.15 * pulse)} renderOrder={10}>
          <meshBasicMaterial color={COLORS.protectedZone} transparent opacity={0.45 + pulse * 0.4} depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  );
}
