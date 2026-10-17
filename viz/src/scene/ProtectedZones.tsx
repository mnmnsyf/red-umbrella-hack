import { useEffect, useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, MeshBasicMaterial } from 'three';
import { useRef } from 'react';
import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import type { Zone } from '../types';
import { seabedDepthAt } from './Seabed';

function ZoneCurtain({ zone }: { zone: Zone }) {
  const select = usePlaybackStore((state) => state.select);
  const setHovered = usePlaybackStore((state) => state.setHovered);
  const hovered = usePlaybackStore((state) => state.hovered);
  const selected = usePlaybackStore((state) => state.selection);
  const active = selected?.kind === 'zone' && selected.id === zone.name;
  const over = hovered?.kind === 'zone' && hovered.id === zone.name;
  const ring = useRef<MeshBasicMaterial>(null);
  const [minX, minZ] = zone.min;
  const [maxX, maxZ] = zone.max;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const radius = Math.min(maxX - minX, maxZ - minZ) / 2;
  useFrame(({ clock }) => {
    if (ring.current && active) ring.current.opacity = 0.75 + 0.15 * Math.sin(clock.elapsedTime * 3);
  });
  useEffect(() => () => {
    const current = usePlaybackStore.getState().hovered;
    if (current?.kind === 'zone' && current.id === zone.name) {
      usePlaybackStore.getState().setHovered(null);
      document.body.style.cursor = '';
    }
  }, [zone.name]);
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
      <mesh
        position={[centerX, 2, centerZ]}
        rotation-x={-Math.PI / 2}
        onClick={(event) => {
          if (event.delta > 4) return;
          event.stopPropagation();
          select({ kind: 'zone', id: zone.name });
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered({ kind: 'zone', id: zone.name });
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          const current = usePlaybackStore.getState().hovered;
          if (current?.kind === 'zone' && current.id === zone.name) {
            setHovered(null);
            document.body.style.cursor = '';
          }
        }}
      >
        <planeGeometry args={[maxX - minX, maxZ - minZ]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
      </mesh>
      {(over || active) && (
        <mesh position={[centerX, 2.5, centerZ]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[radius * 0.82, radius, 48]} />
          <meshBasicMaterial ref={ring} color={COLORS.acoustic} transparent opacity={active ? 0.9 : 0.5} depthWrite={false} side={DoubleSide} />
        </mesh>
      )}
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
