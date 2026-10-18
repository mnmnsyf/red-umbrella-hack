import { useMemo, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, RingGeometry, Vector3 } from 'three';
import type { Vec3 } from '../../types';
import { scenePosition } from './coordinates';

interface CalloutProps {
  position: Vec3;
  label: string;
  detail?: string;
  color: string;
  height?: number;
}

// A leader line from the object up through the water to a label card, so small or submerged things stay readable.
export default function Callout({ position, label, detail, color, height = 90 }: CalloutProps) {
  const ring = useMemo(() => new RingGeometry(0.7, 1, 48), []);
  const [x, y, z] = scenePosition(position);
  const submerged = y < -1;
  const anchor = useMemo(() => new Vector3(), []);
  const [lift, setLift] = useState(height - y);
  // Close up, a tall leader would push the card off screen; keep it proportional to the viewing distance.
  useFrame(({ camera }) => {
    const next = Math.min(height - y, Math.max(3, camera.position.distanceTo(anchor.set(x, y, z)) * 0.07));
    if (Math.abs(next - lift) > 1.5) setLift(next);
  });
  const top = y + lift;

  return (
    <>
      <Line points={[[x, y, z], [x, top, z]]} color={color} lineWidth={1.6} transparent opacity={0.85} depthTest={false} renderOrder={12} />
      {submerged && top > 1 && (
        <mesh geometry={ring} position={[x, 0.8, z]} rotation-x={-Math.PI / 2} scale={12} renderOrder={12}>
          <meshBasicMaterial color={color} side={DoubleSide} transparent opacity={0.9} depthTest={false} depthWrite={false} />
        </mesh>
      )}
      <Html position={[x, top, z]} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="scene-tag" style={{ borderColor: color }}>
          <span className="scene-tag-dot" style={{ background: color }} />
          <span>
            <strong>{label}</strong>
            {detail && <small>{detail}</small>}
          </span>
        </div>
      </Html>
    </>
  );
}
