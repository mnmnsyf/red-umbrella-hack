import { useMemo } from 'react';
import { AdditiveBlending, RingGeometry } from 'three';
import { COLORS } from '../../theme';
import type { Vec3 } from '../../types';
import { scenePosition } from './coordinates';

interface SonarPingProps {
  position: Vec3;
  startTime: number;
  t: number;
  rhythm?: 'single' | 'pinger';
  duration?: number;
  maxRadius?: number;
}

export default function SonarPing({ position, startTime, t, rhythm = 'single', duration = 5, maxRadius = 210 }: SonarPingProps) {
  const geometry = useMemo(() => new RingGeometry(0.92, 1, 128), []);
  const elapsed = t - startTime;
  if (elapsed < 0 || duration <= 0 || (rhythm === 'single' && elapsed > duration)) return null;

  const age = rhythm === 'pinger' ? elapsed % duration : elapsed;
  const progress = age / duration;
  const radius = Math.max(1, maxRadius * progress);

  return (
    <mesh position={scenePosition(position)} rotation-x={-Math.PI / 2} scale={[radius, radius, 1]} geometry={geometry} renderOrder={10}>
      <meshBasicMaterial color={COLORS.acoustic} transparent opacity={(1 - progress) * 0.95} blending={AdditiveBlending} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
