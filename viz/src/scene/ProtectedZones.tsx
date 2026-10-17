import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three';
import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import type { Zone } from '../types';
import { seabedDepthAt } from './Seabed';

function ZoneCurtain({ zone }: { zone: Zone }) {
  const [minX, minZ] = zone.min;
  const [maxX, maxZ] = zone.max;
  const corners: [number, number][] = [
    [minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ], [minX, minZ],
  ];
  const geometry = useMemo(() => {
    const vertices: number[] = [];
    for (let edge = 0; edge < 4; edge += 1) {
      const [startX, startZ] = corners[edge];
      const [endX, endZ] = corners[edge + 1];
      const segments = Math.ceil(Math.hypot(endX - startX, endZ - startZ) / 20);
      for (let part = 0; part < segments; part += 1) {
        const a = part / segments;
        const b = (part + 1) / segments;
        const ax = startX + (endX - startX) * a;
        const az = startZ + (endZ - startZ) * a;
        const bx = startX + (endX - startX) * b;
        const bz = startZ + (endZ - startZ) * b;
        const ay = seabedDepthAt(ax, az) * VEXAG;
        const by = seabedDepthAt(bx, bz) * VEXAG;
        vertices.push(
          ax, 0, az, ax, ay, az, bx, 0, bz,
          bx, 0, bz, ax, ay, az, bx, by, bz,
        );
      }
    }
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    result.computeVertexNormals();
    return result;
  }, [minX, minZ, maxX, maxZ]);

  return (
    <>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={COLORS.protectedZone} transparent opacity={0.12} depthWrite={false} side={DoubleSide} />
      </mesh>
      <Line points={corners.map(([x, z]) => [x, 2, z])} color={COLORS.protectedZone} lineWidth={1} />
      <Html position={[(minX + maxX) / 2, 14, (minZ + maxZ) / 2]} center zIndexRange={[10, 0]}>
        <div className="scene-label" style={{ borderColor: COLORS.protectedZone, color: COLORS.protectedZone }}>
          {zone.name}
        </div>
      </Html>
    </>
  );
}

export default function ProtectedZones() {
  const zones = usePlaybackStore((state) => state.scenario?.zones);
  return <>{zones?.map((zone) => <ZoneCurtain key={zone.name} zone={zone} />)}</>;
}
