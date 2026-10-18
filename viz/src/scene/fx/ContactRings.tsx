import { useMemo } from 'react';
import { DoubleSide, RingGeometry } from 'three';
import type { Vec3 } from '../../types';
import { scenePosition } from './coordinates';

interface ContactRingsProps {
  position: Vec3;
  t: number;
  resolvedTime?: number;
  color: string;
  radius?: number;
  count?: number;
  period?: number;
}

// Concentric rings that drift outward around a contact, like the red rings in the key art.
export default function ContactRings({ position, t, resolvedTime, color, radius = 70, count = 3, period = 3 }: ContactRingsProps) {
  const geometry = useMemo(() => new RingGeometry(0.94, 1, 96), []);
  const phase = (t / period) % 1;
  const fade = resolvedTime === undefined ? 1 : Math.max(0, Math.min(1, 1 - (t - resolvedTime) / 1.5));

  return (
    <group position={scenePosition(position)} rotation-x={-Math.PI / 2}>
      {Array.from({ length: count }, (_, index) => {
        const progress = (index + phase) / count;
        const scale = radius * (0.25 + progress * 0.75);
        return (
          <mesh key={index} geometry={geometry} scale={[scale, scale, 1]} renderOrder={10}>
            <meshBasicMaterial color={color} transparent opacity={(0.85 * (1 - progress) + 0.1) * fade} side={DoubleSide} depthTest={false} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}
