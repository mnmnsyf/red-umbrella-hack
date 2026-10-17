import { useMemo } from 'react';
import { CircleGeometry, DoubleSide, RingGeometry } from 'three';
import { COLORS } from '../../theme';
import type { Vec3 } from '../../types';
import { scenePosition } from './coordinates';

interface EstimateDiskProps {
  position: Vec3;
  startTime: number;
  t: number;
  radius: number;
  shrinkTo: number;
  shrinkDur: number;
}

export default function EstimateDisk({ position, startTime, t, radius, shrinkTo, shrinkDur }: EstimateDiskProps) {
  const circle = useMemo(() => new CircleGeometry(1, 96), []);
  const ring = useMemo(() => new RingGeometry(0.975, 1, 96), []);
  if (t < startTime) return null;

  const progress = shrinkDur <= 0 ? 1 : Math.min(1, (t - startTime) / shrinkDur);
  const currentRadius = radius + (shrinkTo - radius) * progress;
  return (
    <group position={scenePosition(position)} rotation-x={-Math.PI / 2} scale={[currentRadius, currentRadius, 1]}>
      <mesh geometry={circle} renderOrder={10}>
        <meshBasicMaterial color={COLORS.acoustic} transparent opacity={0.07} depthTest={false} depthWrite={false} side={DoubleSide} toneMapped={false} />
      </mesh>
      <mesh geometry={ring} renderOrder={10}>
        <meshBasicMaterial color={COLORS.acoustic} transparent opacity={0.8} depthTest={false} depthWrite={false} side={DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}
